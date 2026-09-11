(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;
  var doc = root.document;
  var esc = TS.tutors.esc;

  var $ = function (id) { return doc.getElementById(id); };
  var running = null;
  var selectedTutorId = null;   // the tutor new shifts are drawn for

  /* ---- small helpers ----------------------------------------------------- */

  function downloadText(filename, text, mime) {
    var blob = new root.Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = root.URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000);
  }

  var pendingFileHandler = null;
  function pickFile(accept, handler) {
    var input = $('file-input');
    input.value = '';
    input.setAttribute('accept', accept);
    pendingFileHandler = handler;
    input.click();
  }

  function notice(message, kind, extra) {
    var box = $('messages');
    var node = doc.createElement('div');
    node.className = 'notice notice--' + (kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'info');
    node.innerHTML = '<div><div>' + esc(message) + '</div>' +
      (extra && extra.length
        ? '<ul class="notice__list">' + extra.slice(0, 12).map(function (w) {
            return '<li>' + esc(w) + '</li>';
          }).join('') +
          (extra.length > 12 ? '<li>…and ' + (extra.length - 12) + ' more.</li>' : '') +
          '</ul>'
        : '') +
      '</div>';

    var close = doc.createElement('button');
    close.type = 'button';
    close.className = 'btn btn--small btn--quiet';
    close.textContent = 'Dismiss';
    close.style.marginLeft = 'auto';
    close.addEventListener('click', function () { node.remove(); });
    node.appendChild(close);

    box.insertBefore(node, box.firstChild);
    if (kind === 'info' && !(extra && extra.length)) {
      root.setTimeout(function () { node.remove(); }, 6000);
    }
  }

  /* ---- render ------------------------------------------------------------ */

  function renderHeader(state) {
    var s = state.settings;
    $('app-title').textContent = s.title;
    doc.title = s.title + ' — Chattanooga State';
    $('header-location').textContent = s.location;
    $('header-contact').textContent = s.contactName;
    var mail = $('header-email');
    mail.textContent = s.contactEmail;
    mail.href = 'mailto:' + s.contactEmail;

    $('qr-caption').textContent = s.qrCaption;
    $('qr-url').textContent = s.qrUrl;
    $('qr-holder').innerHTML = TS.qr.toSvg(s.qrUrl, { label: 'QR code linking to ' + s.qrUrl });
  }

  function renderStats(state) {
    var st = TS.optimizer.stats(state, state.assignments);
    var s = state.settings;
    var parts = [];

    parts.push('<span class="stats__item">Scheduled <strong>' +
      st.totalHours.toFixed(1) + (s.weeklyBudgetEnabled ? ' / ' + s.weeklyBudgetHours : '') +
      ' h</strong></span>');
    parts.push('<span class="stats__item">Coverage <strong>' +
      st.coveredSlots + ' / ' + st.totalSlots + '</strong></span>');
    parts.push('<span class="stats__item">Doubled <strong>' + st.doubledHours.toFixed(1) + ' h</strong></span>');
    parts.push('<span class="stats__item">Subjects/hour <strong>' + st.avgSubjects.toFixed(2) + '</strong></span>');
    if (st.overCapacitySlots) {
      parts.push('<span class="stats__item stats__item--over">Over cap <strong>' +
        (st.overCapacitySlots / 2).toFixed(1) + ' h</strong></span>');
    }
    $('stats').innerHTML = parts.join('');
  }

  function renderGaps(state) {
    var list = $('gaps');
    var gaps = TS.optimizer.analyzeGaps(state, state.assignments);
    if (!gaps.length) {
      list.innerHTML = '<li>Every half hour from 7:00 AM to 8:30 PM has at least one tutor.</li>';
      return;
    }
    list.innerHTML = gaps.map(function (g) {
      return '<li><span class="gaps__when">' + U.DAY_NAMES[g.day] + ' ' +
        esc(U.formatRange(g.start, g.end)) + '</span> — ' +
        '<span class="gaps__why">' + esc(TS.optimizer.GAP_REASONS[g.reason] || g.reason) + '</span></li>';
    }).join('');
  }

  function renderCalendarHint(state) {
    var hint = $('calendar-hint');
    var tutor = selectedTutorId ? TS.store.getTutor(selectedTutorId) : null;
    if (tutor) {
      var label = U.displayNames(state.tutors)[tutor.id];
      hint.innerHTML = 'Adding shifts for <strong>' + esc(label) + '</strong> — drag down a ' +
        'shaded column to place one. Esc when you are done.';
    } else {
      hint.textContent = 'Drag a block to move it, drag its edge to resize. ' +
        'Pick a tutor’s “Add shifts” to draw new ones.';
    }
  }

  function renderAll() {
    var state = TS.store.state;
    if (selectedTutorId && !TS.store.getTutor(selectedTutorId)) selectedTutorId = null;
    renderHeader(state);
    TS.tutors.renderRoster($('roster'), state, {
      onEdit: editTutor,
      onRemove: removeTutor,
      onFit: fitTutor,
      onSelect: selectTutor,
      selectedId: selectedTutorId
    });
    TS.calendar.render($('calendar'), state, { selectedTutorId: selectedTutorId });
    renderCalendarHint(state);
    renderStats(state);
    renderGaps(state);
    TS.printview.render($('print-view'), state);
    renderSettings(state);
  }

  /* ---- tutors ------------------------------------------------------------ */

  function addTutor() {
    TS.tutors.openTutorDialog(null, TS.store.state.settings, function (payload) {
      TS.store.addTutor(payload);
      TS.store.commit('add-tutor');
      notice(payload.firstName + ' added.', 'info');
    });
  }

  function editTutor(id) {
    var tutor = TS.store.getTutor(id);
    if (!tutor) return;
    TS.tutors.openTutorDialog(tutor, TS.store.state.settings, function (payload) {
      Object.keys(payload).forEach(function (k) { tutor[k] = payload[k]; });

      // Shifts that no longer fit the edited availability would otherwise sit
      // there invisibly breaking the rules.
      var dropped = 0;
      TS.store.state.assignments = TS.store.state.assignments.filter(function (a) {
        if (a.tutorId !== id) return true;
        for (var s = a.startSlot; s < a.endSlot; s++) {
          if (!tutor.availability[U.idx(a.day, s)]) { dropped++; return false; }
        }
        return true;
      });
      TS.store.commit('edit-tutor');
      if (dropped) {
        notice(dropped + ' shift(s) were removed because they fell outside ' +
          tutor.firstName + '’s new availability.', 'warn');
      }
    });
  }

  function removeTutor(id) {
    var tutor = TS.store.getTutor(id);
    if (!tutor) return;
    var full = (tutor.firstName + ' ' + tutor.lastName).trim();
    if (!root.confirm('Remove ' + full + ' and all of their scheduled shifts?')) return;
    TS.store.removeTutor(id);
    TS.store.commit('remove-tutor');
    notice(full + ' removed.', 'info');
  }

  /* ---- building by hand -------------------------------------------------- */

  function selectTutor(id) {
    selectedTutorId = selectedTutorId === id ? null : id;
    renderAll();
    if (selectedTutorId) {
      var t = TS.store.getTutor(selectedTutorId);
      notice('Drag down a shaded column to give ' + t.firstName + ' a shift. ' +
        'The shading is when they are available.', 'info');
    }
  }

  // One place decides whether a hand-placed shift is allowed, so the dialog and
  // the drag path can never disagree about the rules.
  function placeShift(tutorId, day, start, end) {
    var state = TS.store.state;
    var candidate = { id: null, tutorId: tutorId, day: day, startSlot: start, endSlot: end };
    var check = TS.calendar.checkPlacement(state, candidate, day, start, end);
    if (!check.ok) return check.reason;

    if (check.overCapacity && !root.confirm(
      'That puts more than ' + state.settings.maxConcurrent + ' tutors on at once for ' +
      (check.overSlots / 2) + ' hour(s).\n\nPlace it anyway? It will be flagged on the schedule.'
    )) {
      return 'Cancelled — nothing was added.';
    }

    TS.store.addAssignment({
      tutorId: tutorId, day: day, startSlot: start, endSlot: end,
      locked: false, overCapacity: !!check.overCapacity
    });
    TS.store.commit('add-shift');
    return null;
  }

  function createFromDrag(day, start, end) {
    if (!selectedTutorId) return;
    var problem = placeShift(selectedTutorId, day, start, end);
    if (problem) notice(problem, 'warn');
  }

  function addShiftByDialog() {
    var state = TS.store.state;
    if (!state.tutors.length) {
      notice('Add at least one tutor first, or load the sample roster.', 'warn');
      return;
    }
    TS.tutors.openShiftDialog(state, { tutorId: selectedTutorId || state.tutors[0].id, day: 0 },
      function (value) {
        return placeShift(value.tutorId, value.day, value.startSlot, value.endSlot);
      });
  }

  function fitTutor(id) {
    var state = TS.store.state;
    var tutor = TS.store.getTutor(id);
    if (!tutor) return;

    if (!U.subjectMask(tutor.subjects)) {
      notice(tutor.firstName + ' has no subjects checked, so there is nothing to schedule them for.', 'warn');
      return;
    }
    if (!tutor.availability.some(function (v) { return v; })) {
      notice(tutor.firstName + ' has no availability set yet. Edit them to add some.', 'warn');
      return;
    }

    var result = TS.optimizer.fitTutor(state, id);
    if (!result.added.length) {
      notice('There is no legal spot left for ' + tutor.firstName +
        '. Their available hours are already staffed to the limit, or their caps are full.', 'warn');
      return;
    }

    state.assignments = result.assignments;
    TS.store.commit('fit-tutor');

    notice('Placed ' + (result.addedSlots / 2) + ' hours for ' + tutor.firstName +
      ' in ' + result.added.length + ' shift(s). Everyone else’s schedule is untouched.' +
      (result.replaced ? ' Their ' + result.replaced + ' previous unlocked shift(s) were redrawn.' : ''),
      'info');
  }

  /* ---- optimizer --------------------------------------------------------- */

  function setRunning(on) {
    $('progress').setAttribute('data-active', on ? 'true' : 'false');
    $('btn-optimize').disabled = on;
    $('btn-cancel').hidden = !on;
  }

  function optimize() {
    var state = TS.store.state;
    if (!state.tutors.length) {
      notice('Add at least one tutor first, or load the sample roster.', 'warn');
      return;
    }
    var schedulable = state.tutors.filter(function (t) {
      return U.subjectMask(t.subjects) && t.maxHoursPerWeek > 0 &&
        t.availability.some(function (v) { return v; });
    });
    if (!schedulable.length) {
      notice('No tutor has both a subject checked and some availability set.', 'warn');
      return;
    }

    var solver = TS.optimizer.createSolver(state, { iterations: 120000 });
    setRunning(true);
    $('progress-text').textContent = 'Building a first schedule…';

    running = { solver: solver, cancelled: false };

    function tick() {
      if (!running || running.cancelled) return;
      var done = false;
      // Slices keep the main thread responsive; a Web Worker is not an option
      // because Chrome blocks workers on the file:// origin.
      var started = root.performance ? root.performance.now() : Date.now();
      do {
        done = solver.step(3000);
      } while (!done && ((root.performance ? root.performance.now() : Date.now()) - started) < 12);

      var pct = Math.round(solver.progress * 100);
      $('progress-bar').style.width = pct + '%';
      $('progress-text').textContent = solver.progress > 0
        ? 'Improving the schedule… ' + pct + '%'
        : 'Building a first schedule…';

      if (done) {
        finishOptimize(solver);
        return;
      }
      root.requestAnimationFrame(tick);
    }

    root.requestAnimationFrame(tick);
  }

  function finishOptimize(solver) {
    var state = TS.store.state;
    state.assignments = solver.result();
    running = null;
    setRunning(false);
    TS.store.commit('optimize');

    var st = TS.optimizer.stats(state, state.assignments);
    var problems = TS.optimizer.validate(state, state.assignments);
    if (problems.length) {
      notice('The optimizer produced a schedule that breaks its own rules. Please report this.',
        'error', problems);
      return;
    }
    notice('Scheduled ' + st.totalHours.toFixed(1) + ' hours covering ' +
      st.coveredSlots + ' of ' + st.totalSlots + ' half hours, ' +
      st.doubledHours.toFixed(1) + ' of them with two tutors.', 'info');
  }

  function cancelOptimize() {
    if (!running) return;
    running.cancelled = true;
    running = null;
    setRunning(false);
    notice('Optimization cancelled. The schedule is unchanged.', 'info');
  }

  /* ---- settings ---------------------------------------------------------- */

  var SETTING_FIELDS = [
    { key: 'title', label: 'Schedule title', type: 'text' },
    { key: 'term', label: 'Term', type: 'text', placeholder: 'Fall 2026' },
    { key: 'effective', label: 'Effective dates', type: 'text', placeholder: 'Aug 24 – Dec 11' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'contactName', label: 'Contact name', type: 'text' },
    { key: 'contactEmail', label: 'Contact email', type: 'email' },
    { key: 'qrUrl', label: 'QR code link', type: 'url' },
    { key: 'qrCaption', label: 'QR caption', type: 'text' }
  ];

  var RULE_FIELDS = [
    { key: 'maxConcurrent', label: 'Max tutors at one time', min: 1, max: 4, step: 1 },
    { key: 'defaultMaxHours', label: 'Default weekly hours', min: 1, max: 40, step: 0.5 },
    { key: 'maxHoursPerDay', label: 'Max hours per day', min: 1, max: 14, step: 0.5 },
    { key: 'breakAfterHours', label: 'Break required after (hours)', min: 2, max: 12, step: 0.5 }
  ];

  function renderSettings(state) {
    var body = $('settings-body');
    if (doc.activeElement && body.contains(doc.activeElement)) return; // don't fight the user mid-edit

    var s = state.settings;
    var html = '';

    SETTING_FIELDS.forEach(function (f) {
      html += '<div class="field"><label for="set-' + f.key + '">' + esc(f.label) + '</label>' +
        '<input type="' + f.type + '" id="set-' + f.key + '" data-setting="' + f.key + '" value="' +
        esc(s[f.key]) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '></div>';
    });

    html += '<fieldset><legend>Scheduling rules</legend><div class="grid-2">';
    RULE_FIELDS.forEach(function (f) {
      html += '<div class="field"><label for="set-' + f.key + '">' + esc(f.label) + '</label>' +
        '<input type="number" id="set-' + f.key + '" data-setting-num="' + f.key +
        '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + s[f.key] + '"></div>';
    });
    html += '</div>' +
      '<div class="field"><label for="set-minShiftSlots">Minimum shift length</label>' +
        '<select id="set-minShiftSlots" data-setting-num="minShiftSlots">' +
          [1, 2, 3, 4, 5, 6].map(function (n) {
            return '<option value="' + n + '"' + (n === s.minShiftSlots ? ' selected' : '') + '>' +
              (n / 2) + ' hour' + (n === 2 ? '' : 's') + '</option>';
          }).join('') +
        '</select></div>' +
      '<div class="field field--inline">' +
        '<input type="checkbox" id="set-evenDistribution" data-setting-bool="evenDistribution"' +
        (s.evenDistribution ? ' checked' : '') + '>' +
        '<label for="set-evenDistribution">Distribute hours evenly across tutors</label></div>' +
      '</fieldset>';

    html += '<fieldset><legend>Weekly hour budget</legend>' +
      '<div class="field field--inline">' +
        '<input type="checkbox" id="set-weeklyBudgetEnabled" data-setting-bool="weeklyBudgetEnabled"' +
        (s.weeklyBudgetEnabled ? ' checked' : '') + '>' +
        '<label for="set-weeklyBudgetEnabled">Limit total scheduled hours</label></div>' +
      '<div class="field"><label for="set-weeklyBudgetHours">Total hours per week, all tutors</label>' +
        '<input type="number" id="set-weeklyBudgetHours" data-setting-num="weeklyBudgetHours" ' +
        'min="0" max="400" step="0.5" value="' + s.weeklyBudgetHours + '"' +
        (s.weeklyBudgetEnabled ? '' : ' disabled') + '>' +
        '<p class="field__hint">Off by default. Turn it on when the department caps total ' +
        'paid hours regardless of what each tutor is approved for.</p></div>' +
      '</fieldset>';

    body.innerHTML = html;
  }

  function wireSettings() {
    $('settings-body').addEventListener('change', function (e) {
      var t = e.target;
      var s = TS.store.state.settings;
      var key = t.getAttribute('data-setting');
      var numKey = t.getAttribute('data-setting-num');
      var boolKey = t.getAttribute('data-setting-bool');

      if (key) s[key] = t.value;
      else if (numKey) s[numKey] = parseFloat(t.value) || 0;
      else if (boolKey) s[boolKey] = t.checked;
      else return;

      TS.store.commit('settings');
    });
  }

  /* ---- import / export --------------------------------------------------- */

  function exportJson() {
    downloadText('tutor-schedule.json', TS.store.toJson(), 'application/json');
  }

  function importJson() {
    pickFile('.json,application/json', function (text, name) {
      try {
        TS.store.fromJson(text);
        notice('Loaded ' + name + '.', 'info');
      } catch (e) {
        notice('That file could not be read as a schedule: ' + (e && e.message), 'error');
      }
    });
  }

  function exportCsv() {
    var state = TS.store.state;
    if (!state.tutors.length) { notice('There are no tutors to export yet.', 'warn'); return; }
    downloadText('tutors.csv', TS.csv.exportTutors(state.tutors), 'text/csv');
  }

  function importCsv() {
    pickFile('.csv,text/csv', function (text, name) {
      var result;
      try {
        result = TS.csv.importTutors(text);
      } catch (e) {
        notice('That CSV could not be parsed: ' + (e && e.message), 'error');
        return;
      }
      if (!result.tutors.length) {
        notice('No tutors were found in ' + name + '.', 'error', result.warnings);
        return;
      }

      var replace = TS.store.state.tutors.length
        ? root.confirm('Replace the current ' + TS.store.state.tutors.length +
            ' tutor(s) with the ' + result.tutors.length + ' in this file?\n\n' +
            'Cancel to add them alongside the existing roster instead.')
        : true;

      if (replace) {
        TS.store.state.tutors = [];
        TS.store.state.assignments = [];
      }
      result.tutors.forEach(function (t) { TS.store.addTutor(t); });
      TS.store.commit('import-csv');

      notice('Imported ' + result.tutors.length + ' tutor(s) from ' + name + '.',
        result.warnings.length ? 'warn' : 'info', result.warnings);
    });
  }

  /* ---- boot -------------------------------------------------------------- */

  function wire() {
    $('btn-optimize').addEventListener('click', optimize);
    $('btn-cancel').addEventListener('click', cancelOptimize);
    $('btn-add-tutor').addEventListener('click', addTutor);

    $('btn-clear').addEventListener('click', function () {
      var kept = TS.store.state.assignments.filter(function (a) { return a.locked; });
      if (!TS.store.state.assignments.length) return;
      if (!root.confirm('Remove all unlocked shifts from the schedule?')) return;
      TS.store.state.assignments = kept;
      TS.store.commit('clear');
      notice(kept.length ? 'Cleared. ' + kept.length + ' locked shift(s) kept.' : 'Schedule cleared.', 'info');
    });

    $('btn-print').addEventListener('click', function () { root.print(); });

    $('btn-pdf').addEventListener('click', function () {
      try {
        TS.pdf.download(TS.store.state);
      } catch (e) {
        notice(e && e.message ? e.message : 'The PDF could not be generated.', 'error');
      }
    });

    $('btn-export-json').addEventListener('click', exportJson);
    $('btn-import-json').addEventListener('click', importJson);
    $('btn-export-csv').addEventListener('click', exportCsv);
    $('btn-import-csv').addEventListener('click', importCsv);
    $('btn-template-csv').addEventListener('click', function () {
      downloadText('tutor-template.csv', TS.csv.templateCsv(), 'text/csv');
    });

    $('btn-sample').addEventListener('click', function () {
      if (TS.store.state.tutors.length &&
          !root.confirm('Replace the current roster and schedule with the sample?')) return;
      TS.store.loadSample();
      notice('Sample roster loaded. Press Auto-optimize for a full schedule, or use a ' +
        'tutor’s “Add shifts” to place them by hand.', 'info');
    });

    $('btn-reset').addEventListener('click', function () {
      if (!root.confirm('Erase all tutors, settings and shifts stored in this browser?')) return;
      TS.store.reset();
      notice('Everything cleared.', 'info');
    });

    $('file-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file || !pendingFileHandler) return;
      var handler = pendingFileHandler;
      pendingFileHandler = null;
      var reader = new root.FileReader();
      reader.onload = function () { handler(String(reader.result), file.name); };
      reader.onerror = function () { notice('That file could not be read.', 'error'); };
      reader.readAsText(file);
    });

    $('theme-select').addEventListener('change', function (e) {
      TS.store.state.settings.theme = e.target.value;
      TS.theme.apply(e.target.value);
      TS.store.commit('theme');
    });

    $('btn-add-shift').addEventListener('click', addShiftByDialog);

    TS.calendar.attach($('calendar'), function () { return TS.store.state; }, {
      onChange: renderAll,
      onNotice: notice,
      onCreate: createFromDrag,
      getSelectedTutorId: function () { return selectedTutorId; }
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !selectedTutorId) return;
      if (doc.getElementById('dialog-root').firstChild) return; // the dialog owns Esc
      selectedTutorId = null;
      renderAll();
    });

    wireSettings();
  }

  function boot() {
    var loaded = TS.store.load();
    TS.theme.init(TS.store.state.settings.theme);
    $('theme-select').value = TS.store.state.settings.theme;

    TS.store.on(function () { renderAll(); });
    TS.theme.onChange(function () { renderAll(); });

    wire();
    renderAll();

    if (!TS.store.storageAvailable()) {
      var hint = $('save-hint');
      if (hint) {
        hint.textContent = 'This browser will not let the page remember your work between ' +
          'visits, so export a file before you close the tab.';
      }
      notice('Your work cannot be saved automatically in this browser, so it will be lost when ' +
        'you close the tab. Use Export JSON to keep it. (Private windows and browsers with ' +
        'site data turned off both do this.)', 'warn');
    } else if (!loaded && !TS.store.state.tutors.length) {
      notice('Welcome. Add your tutors, then either build the week by hand with “Add shifts” ' +
        'or press Auto-optimize. Loading the sample roster shows how it all works.', 'info');
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  TS.app = { renderAll: renderAll, notice: notice, optimize: optimize };
})(typeof window !== 'undefined' ? window : globalThis);
