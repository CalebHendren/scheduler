(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;

  var COLUMNS = [
    'First', 'Last', 'Biology', 'Microbiology', 'AP1', 'AP2',
    'MaxHoursPerWeek', 'MaxHoursPerDay', 'MinHoursPerWeek', 'Availability', 'Notes'
  ];

  /* ---- RFC 4180 encode / decode ---------------------------------------- */

  function encodeField(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function encodeRows(rows) {
    return rows.map(function (row) {
      return row.map(encodeField).join(',');
    }).join('\r\n') + '\r\n';
  }

  // Hand-rolled because a quoted field may legally contain commas and
  // newlines, which a split(',') import would silently corrupt.
  function parseRows(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;

    text = String(text).replace(/^﻿/, '');

    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }

    return rows.filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ''; });
    });
  }

  /* ---- availability text ----------------------------------------------- */

  var DAY_TOKENS = {
    m: 0, mo: 0, mon: 0, monday: 0,
    t: 1, tu: 1, tue: 1, tues: 1, tuesday: 1,
    w: 2, we: 2, wed: 2, weds: 2, wednesday: 2,
    r: 3, th: 3, thu: 3, thur: 3, thurs: 3, thursday: 3,
    f: 4, fr: 4, fri: 4, friday: 4
  };

  function runsForDay(avail, day) {
    var runs = [];
    var start = null;
    for (var s = 0; s <= U.SLOTS_PER_DAY; s++) {
      var on = s < U.SLOTS_PER_DAY && avail[U.idx(day, s)];
      if (on && start === null) start = s;
      else if (!on && start !== null) { runs.push([start, s]); start = null; }
    }
    return runs;
  }

  function formatAvailability(avail) {
    var signatures = [];
    var bySignature = {};

    for (var d = 0; d < U.DAYS; d++) {
      var runs = runsForDay(avail, d);
      if (!runs.length) continue;
      var sig = runs.map(function (r) {
        return U.minutesToHhmm(U.slotStartMinutes(r[0])) + '-' + U.minutesToHhmm(U.slotStartMinutes(r[1]));
      }).join(', ');
      if (!bySignature[sig]) { bySignature[sig] = []; signatures.push(sig); }
      bySignature[sig].push(U.DAY_ABBR[d]);
    }

    // Days sharing identical hours collapse into one clause, so a typical
    // roster reads as "Mon/Wed/Fri 12:00-17:00" rather than three clauses.
    return signatures.map(function (sig) {
      return bySignature[sig].join('/') + ' ' + sig;
    }).join('; ');
  }

  function parseTimeParts(text) {
    var s = String(text).trim().toLowerCase().replace(/\./g, '');
    var m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 24 || min > 59) return null;
    return { hour: h, minute: min, meridiem: m[3] || null, hadColon: !!m[2] };
  }

  function withMeridiem(parts, meridiem) {
    var h = parts.hour;
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    return h * 60 + parts.minute;
  }

  /*
   * A bare hour is resolved against the 7:00 AM - 8:30 PM schedule day rather
   * than assumed to be 24-hour: "1-4pm" means the afternoon, and nobody types
   * a shift starting at 1:00 AM.
   */
  function resolveBare(parts) {
    if (parts.hadColon && parts.hour >= 13) return parts.hour * 60 + parts.minute;
    if (parts.hour >= 13) return parts.hour * 60 + parts.minute;
    if (parts.hour >= 1 && parts.hour <= 6) return (parts.hour + 12) * 60 + parts.minute;
    if (parts.hour === 12) return 12 * 60 + parts.minute;
    return parts.hour * 60 + parts.minute;
  }

  function parseTime(text) {
    var parts = parseTimeParts(text);
    if (!parts) return null;
    return parts.meridiem ? withMeridiem(parts, parts.meridiem) : resolveBare(parts);
  }

  // "1-4pm": the trailing meridiem governs both ends unless that inverts them.
  function parseTimeRange(startText, endText) {
    var a = parseTimeParts(startText);
    var b = parseTimeParts(endText);
    if (!a || !b) return null;

    var end = b.meridiem ? withMeridiem(b, b.meridiem) : resolveBare(b);
    var start;
    if (a.meridiem) {
      start = withMeridiem(a, a.meridiem);
    } else if (b.meridiem) {
      start = withMeridiem(a, b.meridiem);
      if (start >= end) start = resolveBare(a);
    } else {
      start = resolveBare(a);
    }
    return { start: start, end: end };
  }

  function parseDayList(text) {
    var out = [];
    var cleaned = String(text).trim();
    if (!cleaned) return out;

    cleaned.split(/[\/,&+]|\s+and\s+/).forEach(function (part) {
      part = part.trim().toLowerCase();
      if (!part) return;
      var range = part.match(/^([a-z]+)\s*(?:-|–|through|thru|to)\s*([a-z]+)$/);
      if (range) {
        var a = DAY_TOKENS[range[1]], b = DAY_TOKENS[range[2]];
        if (a === undefined || b === undefined) return;
        for (var d = Math.min(a, b); d <= Math.max(a, b); d++) out.push(d);
        return;
      }
      var single = DAY_TOKENS[part.replace(/[^a-z]/g, '')];
      if (single !== undefined) out.push(single);
    });

    return out.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
  }

  function parseAvailability(text, warn) {
    var avail = new Array(U.TOTAL_SLOTS);
    for (var i = 0; i < U.TOTAL_SLOTS; i++) avail[i] = 0;
    var raw = String(text || '').trim();
    if (!raw) return avail;

    raw.split(/;|\n/).forEach(function (clause) {
      clause = clause.trim();
      if (!clause) return;

      // "Mon/Wed 12:00-17:00, 18:00-20:00" -- days first, then time ranges.
      var split = clause.match(/^([^0-9]+?)\s+(.*)$/);
      if (!split) { warn('Could not read availability clause "' + clause + '"'); return; }

      var days = parseDayList(split[1]);
      if (!days.length) { warn('Unrecognized day(s) in "' + clause + '"'); return; }

      var any = false;
      split[2].split(',').forEach(function (range) {
        var parts = range.split(/-|–|to/);
        if (parts.length < 2) { warn('Could not read time range "' + range.trim() + '"'); return; }
        var span = parseTimeRange(parts[0], parts[1]);
        if (!span) {
          warn('Could not read time range "' + range.trim() + '"');
          return;
        }

        var startSlot = Math.round((span.start - U.DAY_START_MIN) / U.SLOT_MINUTES);
        var endSlot = Math.round((span.end - U.DAY_START_MIN) / U.SLOT_MINUTES);
        var clampedStart = Math.max(0, startSlot);
        var clampedEnd = Math.min(U.SLOTS_PER_DAY, endSlot);

        if (clampedEnd <= clampedStart) {
          warn('Time range "' + range.trim() + '" falls outside 7:00 AM-8:30 PM');
          return;
        }
        if (clampedStart !== startSlot || clampedEnd !== endSlot) {
          warn('Trimmed "' + range.trim() + '" to the 7:00 AM-8:30 PM schedule window');
        }

        days.forEach(function (d) {
          for (var s = clampedStart; s < clampedEnd; s++) avail[U.idx(d, s)] = 1;
        });
        any = true;
      });

      if (!any) warn('No usable times in "' + clause + '"');
    });

    return avail;
  }

  /* ---- tutor rows ------------------------------------------------------ */

  function truthy(value) {
    var s = String(value || '').trim().toLowerCase();
    return s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 'x';
  }

  function exportTutors(tutors) {
    var rows = [COLUMNS.slice()];
    tutors.forEach(function (t) {
      rows.push([
        t.firstName,
        t.lastName,
        t.subjects.bio ? 'Yes' : 'No',
        t.subjects.micro ? 'Yes' : 'No',
        t.subjects.ap1 ? 'Yes' : 'No',
        t.subjects.ap2 ? 'Yes' : 'No',
        t.maxHoursPerWeek,
        typeof t.maxHoursPerDay === 'number' ? t.maxHoursPerDay : '',
        t.minHoursPerWeek || 0,
        formatAvailability(t.availability),
        t.notes || ''
      ]);
    });
    return encodeRows(rows);
  }

  function headerIndex(header) {
    var map = {};
    header.forEach(function (name, i) {
      map[String(name).trim().toLowerCase().replace(/[^a-z0-9]/g, '')] = i;
    });
    return map;
  }

  function importTutors(text) {
    var rows = parseRows(text);
    var warnings = [];
    var tutors = [];

    if (!rows.length) {
      return { tutors: [], warnings: ['The file is empty.'] };
    }

    var map = headerIndex(rows[0]);
    if (map.first === undefined) {
      return { tutors: [], warnings: ['No "First" column found. Export a CSV first to see the expected columns.'] };
    }

    function cell(row, key) {
      var i = map[key];
      return i === undefined ? '' : String(row[i] === undefined ? '' : row[i]).trim();
    }

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var lineNo = r + 1;
      var first = cell(row, 'first');
      if (!first) {
        warnings.push('Row ' + lineNo + ': skipped, no first name.');
        continue;
      }

      var rowWarnings = [];
      var availability = parseAvailability(cell(row, 'availability'), function (msg) {
        rowWarnings.push('Row ' + lineNo + ' (' + first + '): ' + msg);
      });

      var maxWeek = parseFloat(cell(row, 'maxhoursperweek'));
      var maxDay = parseFloat(cell(row, 'maxhoursperday'));
      var minWeek = parseFloat(cell(row, 'minhoursperweek'));

      tutors.push({
        firstName: first,
        lastName: cell(row, 'last'),
        subjects: {
          bio: truthy(cell(row, 'biology')),
          micro: truthy(cell(row, 'microbiology')),
          ap1: truthy(cell(row, 'ap1')),
          ap2: truthy(cell(row, 'ap2'))
        },
        maxHoursPerWeek: isFinite(maxWeek) ? maxWeek : 15,
        maxHoursPerDay: isFinite(maxDay) ? maxDay : null,
        minHoursPerWeek: isFinite(minWeek) ? minWeek : 0,
        availability: availability,
        notes: cell(row, 'notes')
      });

      var mask = 0;
      if (truthy(cell(row, 'biology'))) mask++;
      if (truthy(cell(row, 'microbiology'))) mask++;
      if (truthy(cell(row, 'ap1'))) mask++;
      if (truthy(cell(row, 'ap2'))) mask++;
      if (!mask) rowWarnings.push('Row ' + lineNo + ' (' + first + '): no subjects checked, so they cannot be scheduled.');

      warnings = warnings.concat(rowWarnings);
    }

    return { tutors: tutors, warnings: warnings };
  }

  function templateCsv() {
    return encodeRows([
      COLUMNS.slice(),
      ['Anna', 'Harden', 'No', 'No', 'Yes', 'Yes', 15, '', 0, 'Mon/Wed/Fri 12:00-17:00', ''],
      ['Marcus', 'Bell', 'Yes', 'No', 'No', 'No', 15, '', 0, 'Mon-Thu 08:00-13:00', '']
    ]);
  }

  TS.csv = {
    COLUMNS: COLUMNS,
    encodeRows: encodeRows,
    parseRows: parseRows,
    formatAvailability: formatAvailability,
    parseAvailability: parseAvailability,
    parseDayList: parseDayList,
    parseTime: parseTime,
    parseTimeRange: parseTimeRange,
    exportTutors: exportTutors,
    importTutors: importTutors,
    templateCsv: templateCsv
  };
})(typeof window !== 'undefined' ? window : globalThis);
