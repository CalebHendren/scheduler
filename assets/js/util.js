(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});

  /* The app's version, and the only place it is written down. A push to main
   * that changes it is what publishes a release: CI reads this line, tags the
   * commit and attaches the single-file build. Semantic versioning -- a new
   * feature is a minor bump, a fix is a patch.
   */
  var VERSION = '1.0.0';

  var DAY_START_MIN = 7 * 60;      // 7:00 AM
  var SLOT_MINUTES = 30;
  var SLOTS_PER_DAY = 27;          // 7:00 AM through 8:30 PM
  var DAYS = 5;
  var TOTAL_SLOTS = DAYS * SLOTS_PER_DAY;

  var DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  var DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  /* The four Life Science classes the schedule ships with. A coordinator can add
   * their own -- Chemistry, say -- so the live list is kept in settings and
   * SUBJECTS is rewritten in place to match it, which leaves the array every
   * module captured at load time valid. Bits are positional and a mask is always
   * recomputed from tutor.subjects, so reordering the list cannot corrupt a saved
   * schedule.
   */
  var DEFAULT_SUBJECTS = [
    { key: 'bio',   short: 'BIO',   label: 'Biology' },
    { key: 'micro', short: 'MICRO', label: 'Microbiology' },
    { key: 'ap1',   short: 'AP1',   label: 'Anatomy & Physiology I' },
    { key: 'ap2',   short: 'AP2',   label: 'Anatomy & Physiology II' }
  ];

  var MAX_SUBJECTS = 16;           // a subject mask is a bitfield

  function defaultSubjects() {
    return DEFAULT_SUBJECTS.map(function (s, i) {
      return { key: s.key, bit: 1 << i, short: s.short, label: s.label };
    });
  }

  function subjectKey(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  }

  function normalizeSubjectList(list) {
    var out = [];
    var seen = {};
    (list || []).forEach(function (s) {
      if (!s || out.length >= MAX_SUBJECTS) return;
      var label = String(s.label || s.short || s.key || '').trim();
      if (!label) return;
      var key = subjectKey(s.key) || subjectKey(label);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push({
        key: key,
        bit: 1 << out.length,
        short: String(s.short || '').trim() || label.slice(0, 6).toUpperCase(),
        label: label
      });
    });
    // An empty list would leave every tutor unschedulable, so the defaults stand.
    return out.length ? out : defaultSubjects();
  }

  var SUBJECTS = defaultSubjects();

  function setSubjects(list) {
    var next = normalizeSubjectList(list);
    SUBJECTS.length = 0;
    next.forEach(function (s) { SUBJECTS.push(s); });
    return SUBJECTS;
  }

  /* Where a shift is worked. The main calendar is one room -- the tutoring
   * center -- and a shift is either in it or somewhere else on campus: an
   * embedded tutor sitting in the class as it is taught, or an open lab in a
   * named room. Off-room shifts are still the tutor's paid hours, but they do
   * not staff the center, so they are listed beside the calendar rather than
   * drawn in it, and they never count toward its coverage or its concurrency.
   */
  var SHIFT_KINDS = [
    { key: 'main', label: 'At the tutoring center', short: '', plural: '' },
    { key: 'embedded', label: 'Floating embedded tutor', short: 'Embedded',
      plural: 'Floating Embedded Tutors' },
    { key: 'lab', label: 'Open lab', short: 'Open lab', plural: 'Open Labs' }
  ];

  function shiftKind(key) {
    for (var i = 0; i < SHIFT_KINDS.length; i++) {
      if (SHIFT_KINDS[i].key === key) return SHIFT_KINDS[i];
    }
    return SHIFT_KINDS[0];
  }

  function inMainRoom(a) { return !a || !a.kind || a.kind === 'main'; }
  function offRoom(a) { return !inMainRoom(a); }
  function mainShifts(list) { return (list || []).filter(inMainRoom); }
  function offRoomShifts(list) { return (list || []).filter(offRoom); }

  function roomLabel(a, settings) {
    if (a && a.room) return a.room;
    if (inMainRoom(a)) return (settings && settings.location) || '';
    return 'room TBA';
  }

  // "Mon, Wed & Fri" -- an ampersand rather than "and", because these read as
  // labels on a schedule and not as sentences.
  function daysLabel(days) {
    var names = (days || []).map(function (d) { return DAY_ABBR[d]; });
    if (names.length < 2) return names.join('');
    return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
  }

  /* One entry per tutor, kind, room and time, carrying the days it runs. A
   * floating tutor who covers the same window on Tuesday and Thursday is one
   * line on the handout -- "Tue & Thu 12:30-2:00 PM" -- not the same line twice.
   */
  function groupOffRoom(assignments) {
    var order = [];
    var byKey = {};
    offRoomShifts(assignments)
      .slice()
      .sort(function (a, b) {
        return a.startSlot - b.startSlot || a.endSlot - b.endSlot || a.day - b.day;
      })
      .forEach(function (a) {
        var key = [a.tutorId, a.kind, a.room, a.startSlot, a.endSlot].join('|');
        if (!byKey[key]) {
          byKey[key] = {
            tutorId: a.tutorId, kind: a.kind, room: a.room,
            startSlot: a.startSlot, endSlot: a.endSlot, days: [], ids: []
          };
          order.push(byKey[key]);
        }
        if (byKey[key].days.indexOf(a.day) === -1) byKey[key].days.push(a.day);
        byKey[key].ids.push(a.id);
      });
    order.forEach(function (g) { g.days.sort(function (x, y) { return x - y; }); });
    return order;
  }

  // Okabe-Ito colorblind-safe hues. Brand-adjacent blue and vermillion lead so a
  // typical roster reads as one family with the navy/royal chrome.
  var PALETTE = [
    '#0072B2', '#D55E00', '#009E73', '#E69F00',
    '#56B4E9', '#CC79A7', '#999933', '#6E6E6E'
  ];

  // The day is modelled 7:00 AM to 8:30 PM because someone may be available
  // then, but a schedule is drawn over the hours actually in play, never
  // narrower than the 9-to-5 core it is expected to look like.
  var CORE_START_SLOT = 4;         // 9:00 AM
  var CORE_END_SLOT = 20;          // 5:00 PM

  function clampWindow(start, end) {
    return {
      start: Math.max(0, Math.min(CORE_START_SLOT, start)),
      end: Math.min(SLOTS_PER_DAY, Math.max(CORE_END_SLOT, end))
    };
  }

  // What the finished schedule occupies: what the handout and the PDF draw.
  function scheduleWindow(assignments) {
    var start = CORE_START_SLOT, end = CORE_END_SLOT;
    (assignments || []).forEach(function (a) {
      if (a.startSlot < start) start = a.startSlot;
      if (a.endSlot > end) end = a.endSlot;
    });
    return clampWindow(start, end);
  }

  // The same, widened to every hour anyone is available, so the editing grid
  // always has somewhere to put a shift a tutor has offered to work.
  function editorWindow(tutors, assignments) {
    var w = scheduleWindow(assignments);
    var start = w.start, end = w.end;
    (tutors || []).forEach(function (t) {
      if (!t || !t.availability) return;
      for (var d = 0; d < DAYS; d++) {
        for (var s = 0; s < start; s++) {
          if (t.availability[idx(d, s)]) { start = s; break; }
        }
        for (var e = SLOTS_PER_DAY; e > end; e--) {
          if (t.availability[idx(d, e - 1)]) { end = e; break; }
        }
      }
    });
    return clampWindow(start, end);
  }

  function idx(day, slot) { return day * SLOTS_PER_DAY + slot; }
  function slotStartMinutes(slot) { return DAY_START_MIN + slot * SLOT_MINUTES; }
  function slotEndMinutes(slot) { return DAY_START_MIN + (slot + 1) * SLOT_MINUTES; }

  function formatMinutes(mins, opts) {
    opts = opts || {};
    var h24 = Math.floor(mins / 60);
    var m = mins % 60;
    var suffix = h24 >= 12 ? 'PM' : 'AM';
    var h = h24 % 12;
    if (h === 0) h = 12;
    var text = h + ':' + (m < 10 ? '0' : '') + m;
    if (opts.omitSuffix) return text;
    return text + ' ' + suffix;
  }

  // "2:00 - 5:00 PM", collapsing a shared AM/PM into the tail.
  function formatRange(startSlot, endSlot) {
    var a = slotStartMinutes(startSlot);
    var b = slotStartMinutes(endSlot);
    var sameHalf = (a >= 720) === (b >= 720);
    return formatMinutes(a, { omitSuffix: sameHalf }) + '–' + formatMinutes(b);
  }

  function minutesToHhmm(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function hhmmToSlot(hhmm) {
    var parts = String(hhmm).split(':');
    var mins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    return Math.round((mins - DAY_START_MIN) / SLOT_MINUTES);
  }

  function hoursLabel(halfHours) {
    return (Math.round((halfHours / 2) * 10) / 10) + ' h';
  }

  function subjectMask(subjects) {
    var mask = 0;
    for (var i = 0; i < SUBJECTS.length; i++) {
      if (subjects && subjects[SUBJECTS[i].key]) mask |= SUBJECTS[i].bit;
    }
    return mask;
  }

  function maskToShort(mask) {
    var out = [];
    for (var i = 0; i < SUBJECTS.length; i++) {
      if (mask & SUBJECTS[i].bit) out.push(SUBJECTS[i].short);
    }
    return out;
  }

  function maskToLabels(mask) {
    var out = [];
    for (var i = 0; i < SUBJECTS.length; i++) {
      if (mask & SUBJECTS[i].bit) out.push(SUBJECTS[i].label);
    }
    return out;
  }

  function popcount(n) {
    var c = 0;
    while (n) { c += n & 1; n >>= 1; }
    return c;
  }

  function listSentence(items) {
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
  }

  /*
   * Schedule labels: first name alone, until two tutors share one. Within a
   * colliding group, sort by last name and let the first keep the bare first
   * name; everyone after takes the shortest last-name prefix not already in
   * use. "Anna Harden, Anna Henry" becomes "Anna", "Anna H".
   */
  function displayNames(tutors) {
    var out = {};
    var groups = [];
    var byKey = {};

    tutors.forEach(function (t, i) {
      var key = String(t.firstName || '').trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(byKey, key)) {
        byKey[key] = [];
        groups.push(byKey[key]);
      }
      byKey[key].push({ t: t, order: i });
    });

    groups.forEach(function (members) {
      if (members.length === 1) {
        out[members[0].t.id] = String(members[0].t.firstName || '').trim() || '(unnamed)';
        return;
      }
      members.sort(function (a, b) {
        var la = String(a.t.lastName || '').trim().toLowerCase();
        var lb = String(b.t.lastName || '').trim().toLowerCase();
        if (la !== lb) return la < lb ? -1 : 1;
        return a.order - b.order;
      });

      var used = [];
      members.forEach(function (m, i) {
        var fn = String(m.t.firstName || '').trim() || '(unnamed)';
        var last = String(m.t.lastName || '').trim();
        var label = null;

        if (i === 0) {
          label = fn;
        } else {
          for (var len = 1; len <= last.length; len++) {
            var cand = fn + ' ' + last.slice(0, len);
            if (used.indexOf(cand) === -1) { label = cand; break; }
          }
          if (label === null) {
            var n = 2;
            while (used.indexOf(fn + ' (' + n + ')') !== -1) n++;
            label = fn + ' (' + n + ')';
          }
        }
        used.push(label);
        out[m.t.id] = label;
      });
    });

    return out;
  }

  /* ---- color math, shared by the app and the CI contrast test ---- */

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }

  function mix(a, b, amount) {
    var ra = hexToRgb(a), rb = hexToRgb(b);
    return rgbToHex([
      ra[0] + (rb[0] - ra[0]) * amount,
      ra[1] + (rb[1] - ra[1]) * amount,
      ra[2] + (rb[2] - ra[2]) * amount
    ]);
  }

  function relativeLuminance(hex) {
    var rgb = hexToRgb(hex).map(function (v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function contrastRatio(a, b) {
    var la = relativeLuminance(a), lb = relativeLuminance(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  var SURFACE_LIGHT = '#FFFFFF';
  var SURFACE_DARK = '#18212F';
  var INK_LIGHT = '#14181F';
  var INK_DARK = '#EEF3F9';

  // Block colors are derived rather than hand-picked, so the contrast test
  // covers every slot in the palette instead of a curated subset.
  function blockColors(colorIndex, dark) {
    var hue = PALETTE[colorIndex % PALETTE.length];
    if (dark) {
      return {
        hue: hue,
        bar: mix(hue, '#FFFFFF', 0.18),
        bg: mix(hue, SURFACE_DARK, 0.80),
        ink: INK_DARK
      };
    }
    return {
      hue: hue,
      bar: hue,
      bg: mix(hue, SURFACE_LIGHT, 0.86),
      ink: INK_LIGHT
    };
  }

  function usesHatch(colorIndex) { return colorIndex >= PALETTE.length; }

  function uid(prefix) {
    return (prefix || 'id') + '-' +
      Math.random().toString(36).slice(2, 9) +
      Date.now().toString(36).slice(-4);
  }

  TS.util = {
    VERSION: VERSION,
    DAY_START_MIN: DAY_START_MIN,
    SLOT_MINUTES: SLOT_MINUTES,
    SLOTS_PER_DAY: SLOTS_PER_DAY,
    DAYS: DAYS,
    TOTAL_SLOTS: TOTAL_SLOTS,
    CORE_START_SLOT: CORE_START_SLOT,
    CORE_END_SLOT: CORE_END_SLOT,
    scheduleWindow: scheduleWindow,
    editorWindow: editorWindow,
    DAY_NAMES: DAY_NAMES,
    DAY_ABBR: DAY_ABBR,
    SUBJECTS: SUBJECTS,
    DEFAULT_SUBJECTS: DEFAULT_SUBJECTS,
    MAX_SUBJECTS: MAX_SUBJECTS,
    defaultSubjects: defaultSubjects,
    subjectKey: subjectKey,
    normalizeSubjectList: normalizeSubjectList,
    setSubjects: setSubjects,
    SHIFT_KINDS: SHIFT_KINDS,
    shiftKind: shiftKind,
    inMainRoom: inMainRoom,
    offRoom: offRoom,
    mainShifts: mainShifts,
    offRoomShifts: offRoomShifts,
    roomLabel: roomLabel,
    daysLabel: daysLabel,
    groupOffRoom: groupOffRoom,
    PALETTE: PALETTE,
    SURFACE_LIGHT: SURFACE_LIGHT,
    SURFACE_DARK: SURFACE_DARK,
    INK_LIGHT: INK_LIGHT,
    INK_DARK: INK_DARK,
    idx: idx,
    slotStartMinutes: slotStartMinutes,
    slotEndMinutes: slotEndMinutes,
    formatMinutes: formatMinutes,
    formatRange: formatRange,
    minutesToHhmm: minutesToHhmm,
    hhmmToSlot: hhmmToSlot,
    hoursLabel: hoursLabel,
    subjectMask: subjectMask,
    maskToShort: maskToShort,
    maskToLabels: maskToLabels,
    popcount: popcount,
    listSentence: listSentence,
    displayNames: displayNames,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    mix: mix,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    blockColors: blockColors,
    usesHatch: usesHatch,
    uid: uid
  };
})(typeof window !== 'undefined' ? window : globalThis);
