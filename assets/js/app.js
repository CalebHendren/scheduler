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

    // Contact details start empty and are filled in under Schedule settings,
    // so every piece of the line is optional, separator included.
    var parts = [];
    if (s.contactName) parts.push(esc(s.contactName));
    if (s.contactEmail) {
      parts.push('<a href="mailto:' + esc(s.contactEmail) + '">' + esc(s.contactEmail) + '</a>');
    }
    var line = $('header-contact-line');
    line.innerHTML = parts.join(' · ');
    line.hidden = !parts.length;

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
    if (st.offRoomHours) {
      parts.push('<span class="stats__item">Classes &amp; labs <strong>' +
        st.offRoomHours.toFixed(1) + ' h</strong></span>');
    }
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

  // What the undo notice calls each kind of change.
  var CHANGE_LABELS = {
    'add-tutor': 'adding a tutor', 'edit-tutor': 'editing a tutor',
    'remove-tutor': 'removing a tutor', 'add-shift': 'adding a shift',
    'move': 'moving a shift', 'remove': 'removing a shift',
    'edit-shift': 'editing a shift', 'classes': 'a change to the class list',
    'lock': 'locking a shift', 'lock-tutor': 'locking a tutor’s shifts',
    'lock-all': 'locking every shift', 'fit-tutor': 'auto-fitting a tutor',
    optimize: 'auto-optimizing', clear: 'clearing the schedule',
    sample: 'loading the sample roster', reset: 'starting over',
    settings: 'a settings change', 'import-csv': 'a CSV import',
    'import': 'an import', replace: 'loading a file', theme: 'a theme change'
  };

  function renderUndo() {
    var btn = $('btn-undo');
    btn.disabled = !TS.store.canUndo();
  }

  function undoChange() {
    var reason = TS.store.undo();
    if (!reason) { notice('There is nothing left to undo.', 'info'); return; }
    notice('Undid ' + (CHANGE_LABELS[reason] || 'the last change') + '.', 'info');
  }

  function redoChange() {
    var reason = TS.store.redo();
    if (!reason) return;
    notice('Redid ' + (CHANGE_LABELS[reason] || 'the last change') + '.', 'info');
  }

  function renderLockAll(state) {
    var btn = $('btn-lock-all');
    var shifts = state.assignments;
    var allLocked = shifts.length > 0 && shifts.every(function (a) { return a.locked; });
    btn.textContent = allLocked ? 'Unlock all shifts' : 'Lock all shifts';
    btn.setAttribute('aria-pressed', allLocked ? 'true' : 'false');
    btn.disabled = !shifts.length;
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
        'Hover one to edit, lock or remove it, or press L or Delete. ' +
        'A class or a lab is an Add away in the list beside the grid.';
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
      onLockAll: lockAllFor,
      selectedId: selectedTutorId
    });
    TS.calendar.render($('calendar'), state, { selectedTutorId: selectedTutorId });
    TS.calendar.renderAside($('offroom'), state, {
      onEdit: editShift,
      onRemove: removeShiftById,
      onLock: setShiftLock,
      onAdd: addShiftByDialog
    });
    renderCalendarHint(state);
    renderLockAll(state);
    renderUndo();
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

  // Locking the finished week, so Auto-optimize and Clear schedule can both be
  // pressed without putting anything at risk.
  function lockEverything() {
    var shifts = TS.store.state.assignments;
    if (!shifts.length) return;
    var lock = !shifts.every(function (a) { return a.locked; });
    var n = 0;
    shifts.forEach(function (a) {
      if (a.locked === lock) return;
      a.locked = lock;
      n++;
    });
    if (!n) return;
    TS.store.commit('lock-all');
    notice(lock
      ? 'All ' + shifts.length + ' shifts are locked. Auto-optimize and Clear schedule will ' +
        'both leave them alone.'
      : 'All shifts unlocked.', 'info');
  }

  // Locking a whole tutor at once: the usual case is one person whose hours are
  // already settled while the rest of the week is still moving.
  function lockAllFor(id, locked) {
    var tutor = TS.store.getTutor(id);
    if (!tutor) return;
    var n = 0;
    TS.store.state.assignments.forEach(function (a) {
      if (a.tutorId !== id || a.locked === locked) return;
      a.locked = locked;
      n++;
    });
    if (!n) return;
    TS.store.commit('lock-tutor');
    notice(n + ' shift(s) ' + (locked ? 'locked' : 'unlocked') + ' for ' + tutor.firstName +
      (locked ? '. Auto-optimize will work around them.' : '.'), 'info');
  }

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
  function placeShift(tutorId, day, start, end, kind, room) {
    var state = TS.store.state;
    var candidate = {
      id: null, tutorId: tutorId, day: day, startSlot: start, endSlot: end,
      kind: U.shiftKind(kind).key, room: room || ''
    };
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
      kind: candidate.kind, room: candidate.room,
      locked: false, overCapacity: !!check.overCapacity
    });
    var joined = TS.store.mergeTouching(tutorId, day);
    TS.store.commit('add-shift');

    if (joined) {
      var grown = null;
      TS.store.state.assignments.forEach(function (a) {
        if (a.tutorId === tutorId && a.day === day &&
            a.startSlot <= start && a.endSlot >= end) grown = a;
      });
      var tutor = TS.store.getTutor(tutorId);
      notice('Joined onto the shift next to it — ' + tutor.firstName + ' now works ' +
        U.DAY_NAMES[day] + ' ' + U.formatRange(grown.startSlot, grown.endSlot) + '.', 'info');
    }
    return null;
  }

  function createFromDrag(day, start, end) {
    if (!selectedTutorId) return;
    var problem = placeShift(selectedTutorId, day, start, end, 'main', '');
    if (problem) notice(problem, 'warn');
  }

  /* The dialog can place a shift anywhere, so the button over the calendar and
   * the ones in the list beside it are the same call with a different kind to
   * start on -- an embedded class or an open lab never needs a shift at the
   * center first.
   */
  function addShiftByDialog(kind) {
    var state = TS.store.state;
    if (!state.tutors.length) {
      notice('Add at least one tutor first, or load the sample roster.', 'warn');
      return;
    }
    TS.tutors.openShiftDialog(state,
      { tutorId: selectedTutorId || state.tutors[0].id, day: 0, kind: U.shiftKind(kind).key },
      function (value) {
        return placeShift(value.tutorId, value.day, value.startSlot, value.endSlot,
          value.kind, value.room);
      });
  }

  /* Editing one shift in the dialog. Times and days can be dragged on the
   * calendar, but which tutor works it and which room it is held in cannot,
   * and a shift away from the center has no block to drag in the first place.
   */
  function editShift(id) {
    var state = TS.store.state;
    var a = TS.store.getAssignment(id);
    if (!a) return;
    if (a.locked) {
      notice('That shift is locked. Unlock it first if you want to change it.', 'warn');
      return;
    }
    // Moving a shift out of the center leaves a real hole in it, so the rest of
    // the week is rebuilt around the newly open time rather than waiting for
    // someone to notice and press the button.
    var leavesTheCenter = U.inMainRoom(a);
    TS.tutors.openShiftDialog(state, a, function (value) {
      var check = TS.calendar.checkPlacement(state, value, value.day, value.startSlot, value.endSlot);
      if (!check.ok) return check.reason;
      if (check.overCapacity && !root.confirm(
        'That puts more than ' + state.settings.maxConcurrent + ' tutors at the center at once for ' +
        (check.overSlots / 2) + ' hour(s).\n\nSave it anyway? It will be flagged on the schedule.'
      )) {
        return 'Cancelled — nothing was changed.';
      }

      a.tutorId = value.tutorId;
      a.day = value.day;
      a.startSlot = value.startSlot;
      a.endSlot = value.endSlot;
      a.kind = value.kind;
      a.room = value.room;
      a.overCapacity = !!check.overCapacity;
      TS.store.mergeTouching(a.tutorId, a.day);
      TS.store.commit('edit-shift');

      if (leavesTheCenter && U.offRoom(a)) {
        optimize('Those hours left ' + (state.settings.location || 'the center') +
          ', so the schedule was rebuilt around the hole.');
      }
      return null;
    });
  }

  function removeShiftById(id) {
    var a = TS.store.getAssignment(id);
    if (!a) return;
    if (a.locked) {
      notice('That shift is locked. Unlock it first if you want it gone.', 'warn');
      return;
    }
    var tutor = TS.store.getTutor(a.tutorId);
    var who = tutor ? tutor.firstName : 'That shift';
    TS.store.removeAssignment(id);
    TS.store.commit('remove');
    notice('Removed ' + who + ', ' + U.DAY_NAMES[a.day] + ' ' +
      U.formatRange(a.startSlot, a.endSlot) + '. Ctrl+Z brings it back.', 'info');
  }

  function setShiftLock(id, locked) {
    var a = TS.store.getAssignment(id);
    if (!a || a.locked === locked) return;
    a.locked = locked;
    TS.store.commit('lock');
    notice(locked
      ? 'Shift locked. Auto-optimize will leave it exactly where it is.'
      : 'Shift unlocked.', 'info');
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

  /* `why` is prefixed to the notice when something other than the button asked
   * for this, so a schedule that redraws itself says what set it off.
   */
  function optimize(why) {
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

    running = { solver: solver, cancelled: false, why: why || '' };

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
    var why = running ? running.why : '';
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
    notice((why ? why + ' ' : '') + 'Scheduled ' + st.totalHours.toFixed(1) + ' hours covering ' +
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
    { key: 'term', label: 'Semester', type: 'text', placeholder: 'Fall 2026' },
    { key: 'effective', label: 'Effective dates', type: 'text', placeholder: 'Aug 24 – Dec 11' },
    { key: 'notes', label: 'Important notes', type: 'textarea',
      placeholder: 'Closures, the last day of tutoring, anything else on the handout' },
    { key: 'location', label: 'Location (the main calendar)', type: 'text',
      hint: 'The room the weekly calendar is about. Embedded classes and open labs carry ' +
        'their own room, set on the shift itself.' },
    { key: 'contactName', label: 'Contact name', type: 'text',
      placeholder: 'Who to ask about the schedule' },
    { key: 'contactEmail', label: 'Contact email', type: 'email',
      placeholder: 'name@example.edu' },
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
    // Don't fight the user mid-edit -- but only a half-typed field is at risk,
    // and a button press (adding a class, say) has to be able to redraw.
    var active = doc.activeElement;
    if (active && body.contains(active) &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

    var s = state.settings;
    var html = '';

    SETTING_FIELDS.forEach(function (f) {
      var ph = f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '';
      html += '<div class="field"><label for="set-' + f.key + '">' + esc(f.label) + '</label>' +
        (f.type === 'textarea'
          ? '<textarea id="set-' + f.key + '" data-setting="' + f.key + '" rows="4"' + ph + '>' +
              esc(s[f.key]) + '</textarea>'
          : '<input type="' + f.type + '" id="set-' + f.key + '" data-setting="' + f.key +
              '" value="' + esc(s[f.key]) + '"' + ph + '>') +
        (f.hint ? '<p class="field__hint">' + esc(f.hint) + '</p>' : '') +
        '</div>';
    });

    html += '<fieldset><legend>Classes</legend>' +
      '<p class="field__hint" style="margin-top:0">What the tutors are here to help with. ' +
      'The short code is what fits on a block; the name is what the handout spells out.</p>' +
      '<ul class="classes" id="class-list">' +
      s.subjects.map(function (c) {
        return '<li>' +
          '<input type="text" data-class-key="' + esc(c.key) + '" data-class-field="label" ' +
            'value="' + esc(c.label) + '" aria-label="Class name">' +
          '<input type="text" data-class-key="' + esc(c.key) + '" data-class-field="short" ' +
            'value="' + esc(c.short) + '" aria-label="Short code" class="classes__short">' +
          '<button type="button" class="btn btn--small btn--danger" data-remove-class="' +
            esc(c.key) + '" aria-label="Remove ' + esc(c.label) + '">×</button>' +
          '</li>';
      }).join('') +
      '</ul>' +
      '<button type="button" class="btn btn--small" id="btn-add-class"' +
        (s.subjects.length >= U.MAX_SUBJECTS ? ' disabled' : '') + '>Add class</button>' +
      '</fieldset>';

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
      var classKey = t.getAttribute('data-class-key');

      if (classKey) {
        // The key stays put while the wording changes, so renaming a class
        // keeps every tutor who could already teach it.
        var found = null;
        s.subjects.forEach(function (c) { if (c.key === classKey) found = c; });
        if (!found) return;
        var field = t.getAttribute('data-class-field');
        var text = t.value.trim();
        if (!text) { t.value = found[field]; return; }
        found[field] = text;
        TS.store.commit('classes');
        return;
      }

      if (key) s[key] = t.value;
      else if (numKey) s[numKey] = parseFloat(t.value) || 0;
      else if (boolKey) s[boolKey] = t.checked;
      else return;

      TS.store.commit('settings');
    });

    $('settings-body').addEventListener('click', function (e) {
      var s = TS.store.state.settings;

      if (e.target.id === 'btn-add-class') {
        if (s.subjects.length >= U.MAX_SUBJECTS) {
          notice('That is as many classes as a schedule can hold.', 'warn');
          return;
        }
        s.subjects.push({ key: U.subjectKey(U.uid('class')), short: 'NEW', label: 'New class' });
        TS.store.commit('classes');
        var added = $('settings-body').querySelector('.classes li:last-child input');
        if (added) { added.focus(); added.select(); }
        return;
      }

      var removeBtn = e.target.closest('[data-remove-class]');
      if (!removeBtn) return;

      var doomedKey = removeBtn.getAttribute('data-remove-class');
      var doomed = null;
      s.subjects.forEach(function (c) { if (c.key === doomedKey) doomed = c; });
      if (!doomed) return;
      if (s.subjects.length === 1) {
        notice('A schedule needs at least one class. Rename this one instead.', 'warn');
        return;
      }

      // Tutors marked for the class are what makes this worth confirming: the
      // schedule loses a reason each of them was on it.
      var marked = TS.store.state.tutors.filter(function (t) { return t.subjects[doomedKey]; });
      if (!root.confirm('Remove ' + doomed.label +
          (marked.length ? ' and un-mark the ' + marked.length + ' tutor(s) who teach it' : '') +
          '?')) return;

      s.subjects = s.subjects.filter(function (c) { return c.key !== doomedKey; });
      marked.forEach(function (t) { delete t.subjects[doomedKey]; });
      TS.store.commit('classes');
      notice(doomed.label + ' removed' +
        (marked.length ? ', and un-marked for ' + marked.length + ' tutor(s)' : '') +
        '. Ctrl+Z brings it back.', 'info');
    });
  }

  /* ---- import / export --------------------------------------------------- */

  function exportJson() {
    downloadText('life-science-tutor-schedule.json', TS.store.toJson(), 'application/json');
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
    $('btn-optimize').addEventListener('click', function () { optimize(); });
    $('btn-cancel').addEventListener('click', cancelOptimize);
    $('btn-add-tutor').addEventListener('click', addTutor);
    $('btn-lock-all').addEventListener('click', lockEverything);
    $('btn-undo').addEventListener('click', undoChange);

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

    $('btn-add-shift').addEventListener('click', function () { addShiftByDialog('main'); });

    TS.calendar.attach($('calendar'), function () { return TS.store.state; }, {
      onChange: renderAll,
      onNotice: notice,
      onCreate: createFromDrag,
      onEdit: editShift,
      getSelectedTutorId: function () { return selectedTutorId; }
    });

    // Ctrl+Z anywhere but a text field, where the browser's own undo belongs.
    doc.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var key = String(e.key).toLowerCase();
      if (key !== 'z' && key !== 'y') return;

      var el = e.target;
      var tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
          (el && el.isContentEditable)) return;
      if (doc.getElementById('dialog-root').firstChild) return;

      e.preventDefault();
      if (key === 'y' || e.shiftKey) redoChange();
      else undoChange();
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
    $('app-version').textContent = 'Version ' + U.VERSION + '.';
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

    var contact = TS.store.state.settings;
    if (!contact.contactName && !contact.contactEmail) {
      notice('Add a contact name and email under Schedule settings — they go on the printed ' +
        'schedule so people know who to ask.', 'info');
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  TS.app = { renderAll: renderAll, notice: notice, optimize: optimize };
})(typeof window !== 'undefined' ? window : globalThis);
