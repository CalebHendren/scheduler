/*
 * Engine-agnostic test suite. Runs in Node (tools/test-optimizer.mjs) and in a
 * headless browser (tools/selftest.html) against exactly the same sources the
 * app ships, so the CI gate and a local spot check cannot drift apart.
 */
(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;

  function Runner() {
    this.passed = 0;
    this.failed = 0;
    this.failures = [];
    this.lines = [];
  }

  Runner.prototype.ok = function (condition, label, detail) {
    if (condition) {
      this.passed++;
    } else {
      this.failed++;
      this.failures.push(label + (detail ? ' — ' + detail : ''));
    }
  };

  Runner.prototype.eq = function (actual, expected, label) {
    this.ok(actual === expected, label, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  };

  Runner.prototype.note = function (text) { this.lines.push(text); };

  /* ---- fixtures ---------------------------------------------------------- */

  function fixtureState(options) {
    var opts = options || {};
    var state = TS.store.emptyState();
    state.tutors = TS.store.sampleTutors().map(function (t, i) {
      t.colorIndex = i;
      t.maxHoursPerWeek = 15;
      return TS.store.normalizeTutor(t);
    });
    state.tutors.forEach(function (t, i) { t.id = 'tutor-' + i; });
    state.settings.weeklyBudgetEnabled = !!opts.budget;
    state.settings.weeklyBudgetHours = opts.budgetHours || 80;
    return state;
  }

  function tutorNamed(state, first, last) {
    for (var i = 0; i < state.tutors.length; i++) {
      if (state.tutors[i].firstName === first && (!last || state.tutors[i].lastName === last)) {
        return state.tutors[i];
      }
    }
    return null;
  }

  function dayRuns(state, tutorId, day) {
    var row = [];
    for (var s = 0; s < U.SLOTS_PER_DAY; s++) row.push(0);
    state.assignments.forEach(function (a) {
      if (a.tutorId !== tutorId || a.day !== day) return;
      for (var s = a.startSlot; s < a.endSlot; s++) row[s] = 1;
    });
    var runs = [], run = 0;
    for (var i = 0; i <= U.SLOTS_PER_DAY; i++) {
      if (i < U.SLOTS_PER_DAY && row[i]) run++;
      else if (run) { runs.push(run); run = 0; }
    }
    return runs;
  }

  /* ---- 1. display names -------------------------------------------------- */

  function testDisplayNames(r) {
    function names(list) {
      var tutors = list.map(function (n, i) {
        return { id: 't' + i, firstName: n[0], lastName: n[1] };
      });
      var map = U.displayNames(tutors);
      return tutors.map(function (t) { return map[t.id]; });
    }

    var two = names([['Anna', 'Harden'], ['Anna', 'Henry']]);
    r.eq(two[0], 'Anna', 'Anna Harden keeps the bare first name');
    r.eq(two[1], 'Anna H', 'Anna Henry takes one initial');

    var reversed = names([['Anna', 'Henry'], ['Anna', 'Harden']]);
    r.eq(reversed[0], 'Anna H', 'labels do not depend on entry order (Henry)');
    r.eq(reversed[1], 'Anna', 'labels do not depend on entry order (Harden)');

    var three = names([['Anna', 'Hall'], ['Anna', 'Harden'], ['Anna', 'Henry']]);
    r.eq(three[0], 'Anna', 'three-way: Hall sorts first');
    r.eq(three[1], 'Anna H', 'three-way: Harden takes one letter');
    r.eq(three[2], 'Anna He', 'three-way: Henry grows to two letters');

    var mixed = names([['Anna', 'Harden'], ['Bea', 'Fox']]);
    r.eq(mixed[0], 'Anna', 'no collision leaves first names bare (Anna)');
    r.eq(mixed[1], 'Bea', 'no collision leaves first names bare (Bea)');

    var identical = names([['Anna', 'Henry'], ['Anna', 'Henry']]);
    r.ok(identical[0] !== identical[1], 'identical full names still get distinct labels',
      identical.join(' / '));

    var missing = names([['Anna', ''], ['Anna', '']]);
    r.ok(missing[0] !== missing[1], 'missing last names still get distinct labels',
      missing.join(' / '));

    var unique = {};
    var many = names([['Sam', 'Ash'], ['Sam', 'Ashe'], ['Sam', 'Ashby'], ['Sam', 'Barr']]);
    many.forEach(function (n) { unique[n] = true; });
    r.eq(Object.keys(unique).length, 4, 'four same-first-name tutors get four distinct labels');
  }

  /* ---- 2. contrast ------------------------------------------------------- */

  function testContrast(r) {
    // The identity bar is decorative; the text on the block is what has to
    // clear AA, in both themes and for every palette slot including wraps.
    for (var i = 0; i < U.PALETTE.length + 2; i++) {
      var light = U.blockColors(i, false);
      var dark = U.blockColors(i, true);
      var lr = U.contrastRatio(light.ink, light.bg);
      var dr = U.contrastRatio(dark.ink, dark.bg);
      r.ok(lr >= 4.5, 'palette ' + i + ' light block text is AA', lr.toFixed(2) + ':1');
      r.ok(dr >= 4.5, 'palette ' + i + ' dark block text is AA', dr.toFixed(2) + ':1');
    }

    var brand = {
      navy: '#10305F', blue: '#0B57BE', blueDark: '#002855',
      orange: '#FE5000', orangeText: '#C63F00'
    };
    var white = '#FFFFFF';
    var darkSurface = '#18212F';
    var darkGround = '#0E1520';

    r.ok(U.contrastRatio(white, brand.navy) >= 4.5, 'header text on navy is AA',
      U.contrastRatio(white, brand.navy).toFixed(2) + ':1');
    r.ok(U.contrastRatio(brand.blue, white) >= 4.5, 'brand blue as text/button on white is AA',
      U.contrastRatio(brand.blue, white).toFixed(2) + ':1');
    r.ok(U.contrastRatio(white, brand.blue) >= 4.5, 'white on brand blue button is AA',
      U.contrastRatio(white, brand.blue).toFixed(2) + ':1');
    r.ok(U.contrastRatio(brand.blueDark, white) >= 4.5, 'PMS 295 text on white is AA');
    r.ok(U.contrastRatio(brand.orangeText, white) >= 4.5, 'darkened orange text on white is AA',
      U.contrastRatio(brand.orangeText, white).toFixed(2) + ':1');
    r.ok(U.contrastRatio(brand.orange, white) >= 3.0, 'brand orange clears 3:1 for focus rings',
      U.contrastRatio(brand.orange, white).toFixed(2) + ':1');

    r.ok(U.contrastRatio('#EEF3F9', darkSurface) >= 4.5, 'dark theme body text is AA');
    r.ok(U.contrastRatio('#AEBBCA', darkSurface) >= 4.5, 'dark theme muted text is AA',
      U.contrastRatio('#AEBBCA', darkSurface).toFixed(2) + ':1');
    r.ok(U.contrastRatio('#6FA8FF', darkGround) >= 4.5, 'dark theme accent is AA',
      U.contrastRatio('#6FA8FF', darkGround).toFixed(2) + ':1');
    r.ok(U.contrastRatio('#FF7A3D', darkGround) >= 3.0, 'dark theme orange clears 3:1');

    // Adjacent tutors must not resolve to visually identical fills.
    for (var a = 0; a < U.PALETTE.length; a++) {
      for (var b = a + 1; b < U.PALETTE.length; b++) {
        var ca = U.hexToRgb(U.blockColors(a, false).bg);
        var cb = U.hexToRgb(U.blockColors(b, false).bg);
        var spread = Math.max(
          Math.abs(ca[0] - cb[0]), Math.abs(ca[1] - cb[1]), Math.abs(ca[2] - cb[2])
        );
        r.ok(spread >= 8, 'palette tints ' + a + ' and ' + b + ' are distinguishable',
          'max channel delta ' + spread);
      }
    }
  }

  /* ---- 3. CSV ------------------------------------------------------------ */

  function testCsv(r) {
    var state = fixtureState();
    var text = TS.csv.exportTutors(state.tutors);
    var back = TS.csv.importTutors(text);

    r.eq(back.warnings.length, 0, 'a clean export re-imports without warnings',
      back.warnings.join(' | '));
    r.eq(back.tutors.length, state.tutors.length, 'round trip keeps every tutor');

    var identical = true;
    for (var i = 0; i < state.tutors.length; i++) {
      var a = state.tutors[i], b = back.tutors[i];
      if (a.firstName !== b.firstName || a.lastName !== b.lastName) identical = false;
      if (U.subjectMask(a.subjects) !== U.subjectMask(b.subjects)) identical = false;
      if (a.maxHoursPerWeek !== b.maxHoursPerWeek) identical = false;
      for (var s = 0; s < U.TOTAL_SLOTS; s++) {
        if ((a.availability[s] ? 1 : 0) !== (b.availability[s] ? 1 : 0)) identical = false;
      }
    }
    r.ok(identical, 'round trip preserves names, subjects, caps and availability');

    var warnings = [];
    var avail = TS.csv.parseAvailability('Mon-Fri 3pm-8pm', function (m) { warnings.push(m); });
    r.eq(warnings.length, 0, '"Mon-Fri 3pm-8pm" parses cleanly', warnings.join(' | '));
    var count = 0;
    for (var k = 0; k < U.TOTAL_SLOTS; k++) count += avail[k] ? 1 : 0;
    r.eq(count, 5 * 10, '"Mon-Fri 3pm-8pm" is 25 hours');

    warnings = [];
    TS.csv.parseAvailability('Mon 06:00-09:00', function (m) { warnings.push(m); });
    r.ok(warnings.length > 0, 'a range starting before 7:00 AM warns that it was trimmed');

    var quoted = TS.csv.parseRows('First,Notes\r\n"Ann","likes, commas\nand newlines"\r\n');
    r.eq(quoted.length, 2, 'quoted fields with commas and newlines stay one row');
    r.eq(quoted[1][1], 'likes, commas\nand newlines', 'quoted field content survives intact');

    var messy = TS.csv.importTutors('First,Last,AP1,Availability\nJo,Lin,yes,"Tues/Thurs 1-4pm"\n');
    r.eq(messy.tutors.length, 1, 'a hand-typed row imports');
    r.ok(messy.tutors[0].subjects.ap1, '"yes" checks the subject box');
    var jo = 0;
    for (var m = 0; m < U.TOTAL_SLOTS; m++) jo += messy.tutors[0].availability[m] ? 1 : 0;
    r.eq(jo, 12, '"Tues/Thurs 1-4pm" is 6 hours across two days');
  }

  /* ---- 4. the ten-tutor fixture ------------------------------------------ */

  function checkSchedule(r, state, label) {
    var problems = TS.optimizer.validate(state, state.assignments);
    r.eq(problems.length, 0, label + ': no hard constraint is violated', problems.slice(0, 6).join(' | '));

    state.tutors.forEach(function (t) {
      var hours = TS.optimizer.stats(state, state.assignments).perTutor.filter(function (p) {
        return p.id === t.id;
      })[0];
      r.ok(hours.hours <= t.maxHoursPerWeek + 1e-9,
        label + ': ' + t.firstName + ' ' + t.lastName + ' is within their cap',
        hours.hours + ' h of ' + t.maxHoursPerWeek);
    });
  }

  function testFixtureBudgetOff(r) {
    var state = fixtureState({ budget: false });
    state.assignments = TS.optimizer.optimize(state, { seed: 7, iterations: 90000 });
    var st = TS.optimizer.stats(state, state.assignments);

    r.note('Config B (budget off): ' + st.totalHours.toFixed(1) + ' h, coverage ' +
      st.coveredSlots + '/' + st.totalSlots + ', doubled ' + st.doubledHours.toFixed(1) +
      ' h, subjects/hour ' + st.avgSubjects.toFixed(2));

    checkSchedule(r, state, 'Config B');
    r.eq(st.coveredSlots, U.TOTAL_SLOTS, 'Config B: every half hour is covered');
    r.ok(st.overCapacitySlots === 0, 'Config B: nothing exceeds two tutors at once');

    var priya = tutorNamed(state, 'Priya');
    var tueRuns = dayRuns(state, priya.id, 1);
    var thuRuns = dayRuns(state, priya.id, 3);
    var maxRun = Math.round(state.settings.breakAfterHours * 2) - 1;
    r.ok(tueRuns.every(function (n) { return n <= maxRun; }),
      'Config B: Priya never works past the break threshold on Tuesday', JSON.stringify(tueRuns));
    r.ok(thuRuns.every(function (n) { return n <= maxRun; }),
      'Config B: Priya never works past the break threshold on Thursday', JSON.stringify(thuRuns));

    var labels = U.displayNames(state.tutors);
    var harden = tutorNamed(state, 'Anna', 'Harden');
    var henry = tutorNamed(state, 'Anna', 'Henry');
    r.eq(labels[harden.id], 'Anna', 'fixture: Anna Harden shows as "Anna"');
    r.eq(labels[henry.id], 'Anna H', 'fixture: Anna Henry shows as "Anna H"');

    return st;
  }

  function testFixtureBudgetOn(r) {
    var state = fixtureState({ budget: true, budgetHours: 80 });
    state.assignments = TS.optimizer.optimize(state, { seed: 7, iterations: 90000 });
    var st = TS.optimizer.stats(state, state.assignments);

    r.note('Config A (80 h budget): ' + st.totalHours.toFixed(1) + ' h, coverage ' +
      st.coveredSlots + '/' + st.totalSlots + ', doubled ' + st.doubledHours.toFixed(1) +
      ' h, subjects/hour ' + st.avgSubjects.toFixed(2));
    r.note('  per tutor: ' + st.perTutor.map(function (p) {
      var t = null;
      for (var i = 0; i < state.tutors.length; i++) if (state.tutors[i].id === p.id) t = state.tutors[i];
      return t.firstName.charAt(0) + t.lastName.charAt(0) + ' ' + p.hours;
    }).join(', '));

    checkSchedule(r, state, 'Config A');
    r.ok(st.totalHours <= 80 + 1e-9, 'Config A: total stays inside the 80 hour budget',
      st.totalHours + ' h');
    r.eq(st.coveredSlots, U.TOTAL_SLOTS, 'Config A: every half hour is still covered');
    r.ok(st.totalHours >= 79, 'Config A: the budget is actually spent', st.totalHours + ' h');

    var eli = tutorNamed(state, 'Eli');
    var eliHours = st.perTutor.filter(function (p) { return p.id === eli.id; })[0].hours;
    r.ok(eliHours <= 7, 'Config A: Eli cannot exceed his 7 available hours', eliHours + ' h');

    // Equity is soft, so this guards the shape of the result rather than an
    // exact split: nobody gets starved, and nobody hoovers up the budget.
    var hours = st.perTutor.map(function (p) { return p.hours; });
    var lowest = Math.min.apply(null, hours);
    var highest = Math.max.apply(null, hours);
    r.ok(lowest >= 3, 'Config A: no tutor is starved of hours', 'lowest is ' + lowest + ' h');
    r.ok(highest <= 15, 'Config A: no tutor exceeds their cap', 'highest is ' + highest + ' h');
    r.note('  spread ' + lowest + '-' + highest + ' h against an 8 h fair share');

    return st;
  }

  function testCoverageBeatsDuplication(r) {
    // Monday 3:00-5:00 PM only has Anna Harden and Devon free, and both are
    // AP1. A correct optimizer still pairs them rather than leaving a hole.
    var state = fixtureState({ budget: false });
    state.assignments = TS.optimizer.optimize(state, { seed: 3, iterations: 60000 });

    var covered = true;
    for (var s = U.hhmmToSlot('15:00'); s < U.hhmmToSlot('17:00'); s++) {
      var n = 0;
      for (var i = 0; i < state.assignments.length; i++) {
        var a = state.assignments[i];
        if (a.day === 0 && a.startSlot <= s && a.endSlot > s) n++;
      }
      if (n === 0) covered = false;
    }
    r.ok(covered, 'Monday 3-5 PM is staffed even though only two AP1 tutors are free');
  }

  /* ---- 5. randomized fuzz ------------------------------------------------ */

  function testFuzz(r) {
    var rand = TS.optimizer.mulberry32(4242);
    var runs = 12;
    var allClean = true;
    var details = '';

    for (var n = 0; n < runs; n++) {
      var state = TS.store.emptyState();
      var count = 2 + Math.floor(rand() * 9);
      state.settings.weeklyBudgetEnabled = rand() < 0.5;
      state.settings.weeklyBudgetHours = 20 + Math.floor(rand() * 90);
      state.settings.maxConcurrent = 1 + Math.floor(rand() * 3);
      state.settings.minShiftSlots = 1 + Math.floor(rand() * 4);
      state.settings.breakAfterHours = 3 + Math.floor(rand() * 6);

      for (var t = 0; t < count; t++) {
        var avail = [];
        var density = 0.15 + rand() * 0.7;
        for (var i = 0; i < U.TOTAL_SLOTS; i++) avail.push(rand() < density ? 1 : 0);
        state.tutors.push(TS.store.normalizeTutor({
          id: 'f' + n + '-' + t,
          firstName: 'T' + t,
          lastName: 'L' + t,
          colorIndex: t,
          subjects: {
            bio: rand() < 0.5, micro: rand() < 0.5,
            ap1: rand() < 0.5, ap2: rand() < 0.5
          },
          maxHoursPerWeek: 2 + Math.floor(rand() * 20),
          maxHoursPerDay: rand() < 0.3 ? 1 + Math.floor(rand() * 8) : null,
          availability: avail
        }));
      }

      state.assignments = TS.optimizer.optimize(state, { seed: 100 + n, iterations: 12000 });
      var problems = TS.optimizer.validate(state, state.assignments);
      if (problems.length) {
        allClean = false;
        details += 'run ' + n + ': ' + problems.slice(0, 3).join(', ') + '; ';
      }
    }

    r.ok(allClean, 'fuzz: ' + runs + ' random rosters all produce legal schedules', details);
  }

  function testLockedBlocksSurvive(r) {
    var state = fixtureState({ budget: false });
    state.assignments = TS.optimizer.optimize(state, { seed: 11, iterations: 30000 });
    if (!state.assignments.length) { r.ok(false, 'locked test needs a schedule to lock'); return; }

    var target = state.assignments[0];
    target.locked = true;
    var signature = target.tutorId + ':' + target.day + ':' + target.startSlot + ':' + target.endSlot;

    state.assignments = TS.optimizer.optimize(state, { seed: 12, iterations: 30000 });
    var survived = state.assignments.some(function (a) {
      return a.locked && (a.tutorId + ':' + a.day + ':' + a.startSlot + ':' + a.endSlot) === signature;
    });
    r.ok(survived, 'a locked shift is preserved exactly across re-optimization', signature);
  }

  function testContiguousBlocks(r) {
    var state = fixtureState({ budget: false });
    state.assignments = TS.optimizer.optimize(state, { seed: 21, iterations: 30000 });

    var touching = state.assignments.filter(function (a) {
      return state.assignments.some(function (b) {
        return b !== a && b.tutorId === a.tutorId && b.day === a.day && b.startSlot === a.endSlot;
      });
    });
    r.eq(touching.length, 0, 'back-to-back shifts for one tutor come out as a single block',
      touching.slice(0, 3).map(function (a) {
        return a.tutorId + ' ' + U.DAY_NAMES[a.day] + ' ending ' + a.endSlot;
      }).join(' | '));
  }

  function testFitOneTutor(r) {
    var state = fixtureState({ budget: false });
    state.assignments = TS.optimizer.optimize(state, { seed: 31, iterations: 30000 });

    // Stand in for a mid-semester hire: one tutor with no shifts, everyone else
    // already told what they are working.
    var hire = state.tutors[3];
    state.assignments = state.assignments.filter(function (a) { return a.tutorId !== hire.id; });
    var before = state.assignments.map(function (a) {
      return a.id + ':' + a.tutorId + ':' + a.day + ':' + a.startSlot + ':' + a.endSlot;
    }).sort().join('|');

    var result = TS.optimizer.fitTutor(state, hire.id);
    var after = result.assignments
      .filter(function (a) { return a.tutorId !== hire.id; })
      .map(function (a) {
        return a.id + ':' + a.tutorId + ':' + a.day + ':' + a.startSlot + ':' + a.endSlot;
      }).sort().join('|');

    r.eq(after, before, 'fitting one tutor leaves every other shift exactly where it was');
    r.ok(result.added.length > 0, 'the fitted tutor gets shifts', hire.firstName);
    r.ok(result.addedSlots <= hire.maxHoursPerWeek * 2,
      'the fitted tutor stays inside their weekly cap', (result.addedSlots / 2) + ' h');

    state.assignments = result.assignments;
    r.eq(TS.optimizer.validate(state, state.assignments).length, 0,
      'a schedule with a fitted tutor breaks no rule',
      TS.optimizer.validate(state, state.assignments).slice(0, 4).join(' | '));

    // Pressing the button twice must not stack a second copy of their week.
    var twice = TS.optimizer.fitTutor(state, hire.id);
    var hours = twice.assignments.filter(function (a) { return a.tutorId === hire.id; })
      .reduce(function (n, a) { return n + (a.endSlot - a.startSlot); }, 0);
    r.ok(hours <= hire.maxHoursPerWeek * 2,
      'auto-fitting the same tutor twice does not double their hours', (hours / 2) + ' h');
  }

  function testScheduleWindow(r) {
    function label(w) {
      return U.formatMinutes(U.slotStartMinutes(w.start)) + '-' + U.formatMinutes(U.slotStartMinutes(w.end));
    }
    function tutorFree(day, from, to) {
      var a = new Array(U.TOTAL_SLOTS);
      for (var i = 0; i < U.TOTAL_SLOTS; i++) a[i] = 0;
      for (var s = from; s < to; s++) a[U.idx(day, s)] = 1;
      return { availability: a };
    }
    var CORE = '9:00 AM-5:00 PM';

    r.eq(label(U.scheduleWindow([])), CORE, 'an empty schedule still shows the 9-to-5 core');
    r.eq(label(U.scheduleWindow([{ day: 0, startSlot: 6, endSlot: 16 }])), CORE,
      'a schedule inside 9-to-5 does not shrink below it');
    r.eq(label(U.scheduleWindow([{ day: 0, startSlot: 1, endSlot: 6 }])), '7:30 AM-5:00 PM',
      'an early shift opens the top of the grid');
    r.eq(label(U.scheduleWindow([{ day: 4, startSlot: 20, endSlot: 27 }])), '9:00 AM-8:30 PM',
      'a late shift opens the bottom of the grid');

    // The editor has to offer the hours a tutor is free for, even before any
    // shift is placed there; the printed schedule does not.
    var early = [tutorFree(2, 0, 4)];
    r.eq(label(U.editorWindow(early, [])), '7:00 AM-5:00 PM',
      'the editor opens up for availability outside the core');
    r.eq(label(U.scheduleWindow([])), CORE,
      'the printed window ignores availability nobody is working');
    r.eq(label(U.editorWindow([tutorFree(1, 8, 14)], [])), CORE,
      'availability inside the core leaves the editor at 9-to-5');
  }

  function testEmptyRoster(r) {
    var state = TS.store.emptyState();
    var result = TS.optimizer.optimize(state, { iterations: 500 });
    r.eq(result.length, 0, 'an empty roster optimizes to an empty schedule');
    r.eq(TS.optimizer.validate(state, result).length, 0, 'an empty schedule is valid');
    r.eq(TS.optimizer.analyzeGaps(state, result).length, 5, 'an empty schedule reports five all-day gaps');
  }

  function run() {
    var r = new Runner();
    var started = Date.now();

    testDisplayNames(r);
    testScheduleWindow(r);
    testContrast(r);
    testCsv(r);
    testEmptyRoster(r);
    testFixtureBudgetOff(r);
    testFixtureBudgetOn(r);
    testCoverageBeatsDuplication(r);
    testContiguousBlocks(r);
    testFitOneTutor(r);
    testLockedBlocksSurvive(r);
    testFuzz(r);

    r.note('Completed in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s');
    return r;
  }

  TS.tests = { run: run, fixtureState: fixtureState };
})(typeof window !== 'undefined' ? window : globalThis);
