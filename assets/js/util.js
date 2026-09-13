(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});

  /* The app's version, and the only place it is written down. A push to main
   * that changes it is what publishes a release: CI reads this line, tags the
   * commit and attaches the single-file build. Semantic versioning -- a new
   * feature is a minor bump, a fix is a patch.
   */
  var VERSION = '1.1.0';

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

  /* ---- the tutor palette ----
   * The eight Okabe-Ito colorblind-safe hues lead, because a roster that fits
   * inside them is readable to a red-green colorblind eye without anything
   * else having to work. The seven after them widen the list far enough that a
   * normal roster never has to repeat one -- the old eight meant a ninth tutor
   * was handed blue again, which is what put two blues side by side.
   *
   * The seven were picked against the same measure the solver below uses, with
   * the bar set at the original eight: the three closest pairs in the list are
   * still Okabe-Ito's own, so nothing added here made the palette harder to
   * read. Which tutor gets which is not this list's order, though --
   * assignColors picks from the finished schedule.
   */
  var PALETTE = [
    '#0072B2', '#D55E00', '#009E73', '#E69F00',
    '#56B4E9', '#CC79A7', '#999933', '#6E6E6E',
    '#2222B9', '#B92222', '#B9228C', '#27D37D',
    '#9C5821', '#8B5CF6', '#1DDDD4'
  ];

  /* Classes are coloured from the far end of the same list. They are a
   * different scheme on a different page, and starting where the tutors leave
   * off is what stops the coverage page looking like a recoloured copy of the
   * one before it.
   */
  var SUBJECT_OFFSET = 8;

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

  /* ---- coverage by class ----
   * The schedule is written tutor by tutor, but the question a student arrives
   * with is the other way round: when can I get help with Micro? These turn one
   * into the other.
   *
   * A class is covered for as long as someone who teaches it is on shift at the
   * center, so one tutor signed up for three classes covers all three at once,
   * and comes out as three separate runs -- which is the point. Shifts held
   * somewhere else are somebody's hours but not the center's cover, and are
   * left out here exactly as they are left out of the grid.
   */
  function subjectRuns(assignments, tutors) {
    var masks = {}, runs = [];
    (tutors || []).forEach(function (t) { masks[t.id] = subjectMask(t.subjects); });

    var shifts = mainShifts(assignments).filter(function (a) { return masks[a.tutorId]; });

    for (var subject = 0; subject < SUBJECTS.length; subject++) {
      var bit = SUBJECTS[subject].bit;
      var teaching = shifts.filter(function (a) { return masks[a.tutorId] & bit; });
      if (!teaching.length) continue;

      for (var day = 0; day < DAYS; day++) {
        var today = teaching.filter(function (a) { return a.day === day; });
        if (!today.length) continue;

        // Who is on for this class in each half hour; a run is a stretch with
        // somebody in it, however many people come and go inside it.
        var who = [];
        for (var slot = 0; slot < SLOTS_PER_DAY; slot++) who.push(null);
        today.forEach(function (a) {
          for (var slot = a.startSlot; slot < a.endSlot; slot++) {
            if (!who[slot]) who[slot] = [];
            if (who[slot].indexOf(a.tutorId) === -1) who[slot].push(a.tutorId);
          }
        });

        var open = null;
        for (var s = 0; s <= SLOTS_PER_DAY; s++) {
          var covered = s < SLOTS_PER_DAY && who[s];
          if (covered && !open) open = { start: s, tutorIds: [] };
          if (covered) {
            who[s].forEach(function (id) {
              if (open.tutorIds.indexOf(id) === -1) open.tutorIds.push(id);
            });
          } else if (open) {
            runs.push({
              subject: subject, subjectKey: SUBJECTS[subject].key,
              day: day, startSlot: open.start, endSlot: s, tutorIds: open.tutorIds
            });
            open = null;
          }
        }
      }
    }
    return runs;
  }

  // Half hours a week each class is covered for, indexed the same as SUBJECTS,
  // which is what lets the coverage page say how much of each is on offer.
  function subjectSlotTotals(runs) {
    var totals = [];
    for (var i = 0; i < SUBJECTS.length; i++) totals.push(0);
    (runs || []).forEach(function (run) {
      totals[run.subject] += run.endSlot - run.startSlot;
    });
    return totals;
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

  // How much white a block fill is cut with: enough hue to tell two blocks
  // apart, pale enough to read black text over.
  var BLOCK_TINT = 0.86;

  // Block colors are derived rather than hand-picked, so the contrast test
  // covers every color of every ring instead of a curated subset.
  function shadeBlock(hue, dark) {
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
      bg: mix(hue, SURFACE_LIGHT, BLOCK_TINT),
      ink: INK_LIGHT
    };
  }

  function blockColors(colorIndex, dark) {
    return shadeBlock(PALETTE[colorIndex % PALETTE.length], dark);
  }

  function subjectColors(subjectIndex, dark) {
    return shadeBlock(PALETTE[(SUBJECT_OFFSET + subjectIndex) % PALETTE.length], dark);
  }

  // Past the end of the list a color has to come round again, and the repeat is
  // drawn with a diagonal hatch so the pair stays distinct anyway.
  function usesHatch(colorIndex) { return colorIndex >= PALETTE.length; }

  /* ---- how different two colors look ---- */

  // CIE L*a*b* under D65. Hex arithmetic answers "are these the same bytes";
  // Lab answers the question the schedule actually asks, which is whether two
  // blocks look alike to someone glancing at the page.
  function hexToLab(hex) {
    var lin = hexToRgb(hex).map(function (v) {
      var c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    var f = [
      (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047,
      (0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]),
      (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883
    ].map(function (t) {
      return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t) + 16 / 116;
    });
    return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
  }

  function deltaE(a, b) {
    var la = hexToLab(a), lb = hexToLab(b);
    var dl = la[0] - lb[0], da = la[1] - lb[1], db = la[2] - lb[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  /* Building a ring asks the same handful of questions about the same few
   * hundred colors over and over, so the conversions are kept rather than
   * redone. Pure functions of the hex, so the cache never goes stale.
   */
  var labCache = {};
  function labOf(hex, vision) {
    var key = vision + hex;
    if (labCache[key] === undefined) {
      labCache[key] = hexToLab(vision === 'normal' ? hex : simulateCvd(hex, vision));
    }
    return labCache[key];
  }

  function labGap(a, b) {
    var dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  // Two palette slots compared the way they are drawn: the tint is most of the
  // block, the identity bar the rest, so the tint counts double. Slots past the
  // palette wrap onto the same hues, which is exactly what the caller needs to
  // know -- slot 0 and slot 11 are the same blue.
  /* Vienot, Brettel & Mollon (1999): drop the color onto the plane a dichromat
   * still has, and what comes back is what that reader sees. Red-green is the
   * common case and the one that matters here -- an evenly spaced ring of hues
   * always contains a red and a green that a deuteranope reads as one color.
   */
  function simulateCvd(hex, kind) {
    var rgb = hexToRgb(hex);
    var l = 17.8824 * rgb[0] + 43.5161 * rgb[1] + 4.11935 * rgb[2];
    var m = 3.45565 * rgb[0] + 27.1554 * rgb[1] + 3.86714 * rgb[2];
    var s = 0.0299566 * rgb[0] + 0.184309 * rgb[1] + 1.46709 * rgb[2];
    if (kind === 'protan') l = 2.02344 * m - 2.52581 * s;
    else m = 0.494207 * l + 1.24827 * s;
    return rgbToHex([
      0.080944479 * l - 0.130504409 * m + 0.116772127 * s,
      -0.0102485335 * l + 0.0540193266 * m - 0.113614708 * s,
      -0.0003652968 * l - 0.0041216156 * m + 0.693512259 * s
    ]);
  }

  // The worst case across readers, which is the smallest of the three gaps: two
  // colors are only as distinct as the eye that can least tell them apart.
  function colorGap(a, b) {
    return Math.min(
      labGap(labOf(a, 'normal'), labOf(b, 'normal')),
      labGap(labOf(a, 'protan'), labOf(b, 'protan')),
      labGap(labOf(a, 'deutan'), labOf(b, 'deutan'))
    );
  }

  /* How far apart two colors land once they are drawn as blocks: the fill is
   * most of what the eye gets and counts double, the identity bar is the rest.
   * The light theme is the one that prints, so it is the one measured.
   */
  function blockGap(hueA, hueB) {
    return (2 * colorGap(mix(hueA, SURFACE_LIGHT, BLOCK_TINT), mix(hueB, SURFACE_LIGHT, BLOCK_TINT)) +
      colorGap(hueA, hueB)) / 3;
  }

  // The palette is fixed, so every number below it is too: worked out once.
  var slotGapCache = {};
  var widestSlotGap = 0;

  function slotDistance(a, b) {
    var ia = a % PALETTE.length, ib = b % PALETTE.length;
    if (ia === ib) return 0;
    var key = Math.min(ia, ib) + ':' + Math.max(ia, ib);
    if (slotGapCache[key] === undefined) {
      slotGapCache[key] = blockGap(PALETTE[ia], PALETTE[ib]);
    }
    return slotGapCache[key];
  }

  function slotSpread() {
    if (!widestSlotGap) {
      for (var a = 0; a < PALETTE.length; a++) {
        for (var b = a + 1; b < PALETTE.length; b++) {
          widestSlotGap = Math.max(widestSlotGap, slotDistance(a, b));
        }
      }
    }
    return widestSlotGap;
  }

  // 1 when two slots are indistinguishable, near 0 when nothing about them is
  // shared. Cubed so a merely different-ish pair costs almost nothing and only
  // the genuinely confusable pairs -- the two blues, the two purples -- push
  // the solver around.
  function slotClash(a, b) {
    var clash = Math.pow(Math.max(0, 1 - slotDistance(a, b) / slotSpread()), 3);
    // A repeated color is drawn with a diagonal hatch, which carries most of the
    // distinction by itself.
    if (usesHatch(a) !== usesHatch(b)) clash *= 0.45;
    return clash;
  }

  /* ---- dynamic color assignment ---- */

  // Shifts on the same day share a column; a day apart puts them side by side.
  // Both read as "next to each other" on the printed page, so both constrain
  // what colors the two tutors can wear.
  var DAY_FALLOFF = [1, 0.8, 0.35, 0.15, 0.1];
  var NEAR_SLOTS = 6;       // three hours: still one glance
  var LEGEND_WEIGHT = 0.06; // in the legend every tutor is beside every other
  var TAKEN_COST = 1e6;     // a slot already spoken for is never the answer
  var CLASH_POWER = 3;      // see seatCost: one bad pair costs more than many mild ones

  function shiftProximity(a, b) {
    var dayWeight = DAY_FALLOFF[Math.min(Math.abs(a.day - b.day), DAY_FALLOFF.length - 1)];
    var gap = Math.max(a.startSlot, b.startSlot) - Math.min(a.endSlot, b.endSlot);
    if (gap >= NEAR_SLOTS) return 0;
    return dayWeight * (gap <= 0 ? 1 : 1 - gap / NEAR_SLOTS);
  }

  // How close a pair of tutors ever comes to each other, as a weight from the
  // legend floor up to 1. Repeated near misses accumulate, without any one pair
  // ever outweighing the rest of the week.
  function proximityMatrix(tutors, assignments) {
    var seat = {}, n = tutors.length, w = [], i, j;
    for (i = 0; i < n; i++) {
      seat[tutors[i].id] = i;
      w.push([]);
      for (j = 0; j < n; j++) w[i].push(i === j ? 0 : LEGEND_WEIGHT);
    }
    var shifts = (assignments || []).filter(function (a) {
      return seat[a.tutorId] !== undefined;
    });
    for (i = 0; i < shifts.length; i++) {
      for (j = i + 1; j < shifts.length; j++) {
        var ia = seat[shifts[i].tutorId], ib = seat[shifts[j].tutorId];
        if (ia === ib) continue;
        var near = shiftProximity(shifts[i], shifts[j]);
        if (near <= 0) continue;
        w[ia][ib] = w[ib][ia] = 1 - (1 - w[ia][ib]) * (1 - near);
      }
    }
    return w;
  }

  /*
   * What it costs tutor `i` to wear `slot`, given who already holds what.
   * `skip` leaves one tutor out, which is what makes pricing a swap cheap.
   *
   * Raised to a power rather than summed flat: a handful of mildly similar
   * pairs is a schedule nobody complains about, and one pair of blocks that
   * read as the same color is the whole complaint. Convex cost means the
   * solver will happily take the first to avoid the second.
   *
   * `tier` prices the wrap. Every clash term is under 1 and there are fewer
   * than `tier` of them, so charging a whole tier for each round past the
   * first means no repeated color is taken while an unused one is free. Two
   * tutors trading slots keep the rounds between them, so the tier cancels out
   * of a swap and never blocks one.
   */
  function seatCost(i, slot, chosen, w, skip, tier) {
    var sum = tier * Math.floor(slot / PALETTE.length);
    for (var k = 0; k < chosen.length; k++) {
      if (k === i || k === skip || chosen[k] < 0) continue;
      sum += chosen[k] === slot ? TAKEN_COST
        : Math.pow(w[i][k] * slotClash(slot, chosen[k]), CLASH_POWER);
    }
    return sum;
  }

  function cheapestSeat(i, chosen, slots, w, tier) {
    var best = slots[0], bestCost = Infinity;
    for (var s = 0; s < slots.length; s++) {
      var cost = seatCost(i, slots[s], chosen, w, -1, tier);
      if (cost < bestCost) { bestCost = cost; best = slots[s]; }
    }
    return best;
  }

  /*
   * Picks a color for every tutor from where they land in the week rather than
   * from the order they were typed in, so two tutors whose blocks sit next to
   * each other never come out the same blue. `options.only` re-seats just those
   * tutors and leaves everyone else's color where it is.
   *
   * Returns a map of tutor id to color index. Deterministic: the same roster
   * and the same schedule always produce the same colors.
   */
  function assignColors(tutors, assignments, options) {
    var opts = options || {};
    var list = (tutors || []).filter(Boolean);
    var n = list.length, out = {}, i;
    if (!n) return out;

    var w = proximityMatrix(list, assignments);
    var load = w.map(function (row) {
      return row.reduce(function (sum, v) { return sum + v; }, 0);
    });

    var chosen = [], loose = [], span = n;
    for (i = 0; i < n; i++) {
      var held = opts.only && opts.only.indexOf(list[i].id) === -1;
      var keeping = held && typeof list[i].colorIndex === 'number';
      chosen.push(keeping ? list[i].colorIndex : -1);
      if (keeping) span = Math.max(span, list[i].colorIndex + 1);
      if (!held) loose.push(i);
    }

    // The whole palette, plus a hatched round for every wrap this roster
    // forces, so there is always a free slot and no two tutors ever share one.
    // `span` also covers a color a held tutor is already wearing.
    var rounds = Math.max(1, Math.ceil(span / PALETTE.length));
    var slots = [];
    for (i = 0; i < rounds * PALETTE.length; i++) slots.push(i);

    // Hardest first: a tutor who is next to everyone has the fewest good
    // options left if they are colored last.
    loose.sort(function (a, b) {
      return load[b] - load[a] || (list[a].id < list[b].id ? -1 : 1);
    });
    loose.forEach(function (t) { chosen[t] = cheapestSeat(t, chosen, slots, w, n); });

    // Greedy settles the hard cases but can strand an easy one, and once every
    // slot is spoken for the only move left is trading two of them.
    for (var pass = 0; pass < 12; pass++) {
      var improved = false;
      for (var a = 0; a < loose.length; a++) {
        var x = loose[a];
        for (var b = a + 1; b < loose.length; b++) {
          var y = loose[b];
          var before = seatCost(x, chosen[x], chosen, w, y, n) + seatCost(y, chosen[y], chosen, w, x, n);
          var after = seatCost(x, chosen[y], chosen, w, y, n) + seatCost(y, chosen[x], chosen, w, x, n);
          if (after < before - 1e-9) {
            var swap = chosen[x]; chosen[x] = chosen[y]; chosen[y] = swap;
            improved = true;
          }
        }
        var moved = cheapestSeat(x, chosen, slots, w, n);
        if (moved !== chosen[x] &&
            seatCost(x, moved, chosen, w, -1, n) < seatCost(x, chosen[x], chosen, w, -1, n) - 1e-9) {
          chosen[x] = moved;
          improved = true;
        }
      }
      if (!improved) break;
    }

    for (i = 0; i < n; i++) out[list[i].id] = chosen[i];
    return out;
  }

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
    subjectRuns: subjectRuns,
    subjectSlotTotals: subjectSlotTotals,
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
    subjectColors: subjectColors,
    usesHatch: usesHatch,
    deltaE: deltaE,
    colorGap: colorGap,
    blockGap: blockGap,
    slotClash: slotClash,
    shiftProximity: shiftProximity,
    proximityMatrix: proximityMatrix,
    assignColors: assignColors,
    uid: uid
  };
})(typeof window !== 'undefined' ? window : globalThis);
