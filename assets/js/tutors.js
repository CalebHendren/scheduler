(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;
  var doc = root.document;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(tag, attrs, html) {
    var node = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === null || attrs[k] === undefined) return;
        node.setAttribute(k, attrs[k]);
      });
    }
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  /* ---- availability <-> windows ---------------------------------------- */

  function windowsFromAvailability(avail) {
    var out = [];
    for (var d = 0; d < U.DAYS; d++) {
      U.availabilityRuns(avail, d).forEach(function (r) {
        out.push({ day: d, start: r[0], end: r[1] });
      });
    }
    return out;
  }

  function availabilityFromWindows(windows) {
    var a = U.emptyAvailability();
    windows.forEach(function (w) {
      if (w.end <= w.start) return;
      for (var s = Math.max(0, w.start); s < Math.min(U.SLOTS_PER_DAY, w.end); s++) {
        a[U.idx(w.day, s)] = 1;
      }
    });
    return a;
  }

  function availabilityHours(avail) {
    var n = 0;
    for (var i = 0; i < avail.length; i++) if (avail[i]) n++;
    return n / 2;
  }

  /* ---- roster ----------------------------------------------------------- */

  function renderRoster(container, state, handlers) {
    container.innerHTML = '';
    if (!state.tutors.length) {
      container.appendChild(el('li', { class: 'roster__empty' },
        'No tutors yet. Add one, or load the sample roster to see how it works.'));
      return;
    }

    var labels = U.displayNames(state.tutors);
    var dark = TS.theme.isDark();

    state.tutors.forEach(function (t) {
      var colors = U.blockColors(t.colorIndex, dark);
      var mask = U.subjectMask(t.subjects);
      var shorts = U.maskToShort(mask);
      var full = (t.firstName + ' ' + t.lastName).trim();
      var label = labels[t.id];
      var scheduled = TS.store.slotsFor(t.id) / 2;

      var li = doc.createElement('li');
      var row = el('div', { class: 'roster__row' });

      var swatch = el('div', { class: 'roster__swatch' });
      swatch.style.background = colors.bg;
      swatch.style.borderLeft = '5px solid ' + colors.bar;
      row.appendChild(swatch);

      var info = el('div', { class: 'roster__info' });
      info.innerHTML =
        '<div class="roster__name">' + esc(full || label) +
        (label !== full ? ' <span class="roster__label">shows as “' + esc(label) + '”</span>' : '') +
        '</div>' +
        '<div class="chips">' +
        (shorts.length
          ? shorts.map(function (s) { return '<span class="chip">' + s + '</span>'; }).join('')
          : '<span class="chip">no subjects</span>') +
        '</div>' +
        '<div class="roster__meta">' +
        scheduled + ' of ' + t.maxHoursPerWeek + ' h scheduled · ' +
        availabilityHours(t.availability) + ' h available' +
        '</div>' +
        (t.email
          ? '<div class="roster__email"><a href="mailto:' + esc(t.email) + '">' + esc(t.email) + '</a></div>'
          : '');
      row.appendChild(info);

      var selected = handlers.selectedId === t.id;
      if (selected) row.setAttribute('data-selected', '1');

      var actions = el('div', { class: 'roster__actions' });

      var pick = el('button', {
        type: 'button', class: 'btn btn--small' + (selected ? ' btn--primary' : ''),
        'aria-pressed': selected ? 'true' : 'false',
        'aria-label': (selected ? 'Stop adding shifts for ' : 'Add shifts for ') + full
      }, selected ? 'Stop adding' : 'Add shifts');
      pick.addEventListener('click', function () { handlers.onSelect(t.id); });

      var fit = el('button', {
        type: 'button', class: 'btn btn--small',
        'aria-label': 'Auto-fit ' + full + ' around the existing schedule'
      }, 'Auto-fit');
      fit.addEventListener('click', function () { handlers.onFit(t.id); });

      var shifts = TS.store.state.assignments.filter(function (a) { return a.tutorId === t.id; });
      var allLocked = shifts.length > 0 && shifts.every(function (a) { return a.locked; });
      var lock = el('button', {
        type: 'button', class: 'btn btn--small',
        'aria-pressed': allLocked ? 'true' : 'false',
        disabled: shifts.length ? null : 'disabled',
        'aria-label': (allLocked ? 'Unlock all ' : 'Lock all ') + shifts.length +
          ' shift(s) for ' + full
      }, allLocked ? 'Unlock all' : 'Lock all');
      lock.addEventListener('click', function () { handlers.onLockAll(t.id, !allLocked); });

      var edit = el('button', { type: 'button', class: 'btn btn--small' }, 'Edit');
      edit.addEventListener('click', function () { handlers.onEdit(t.id); });
      var del = el('button', {
        type: 'button', class: 'btn btn--small btn--danger',
        'aria-label': 'Remove ' + full, title: 'Remove ' + full
      }, '×');
      del.addEventListener('click', function () { handlers.onRemove(t.id); });

      actions.appendChild(pick);
      actions.appendChild(fit);
      actions.appendChild(lock);
      actions.appendChild(edit);
      actions.appendChild(del);
      row.appendChild(actions);

      li.appendChild(row);
      container.appendChild(li);
    });
  }

  /* ---- dialog ----------------------------------------------------------- */

  var openDialogEl = null;

  function closeDialog() {
    if (!openDialogEl) return;
    openDialogEl.parentNode.removeChild(openDialogEl);
    openDialogEl = null;
    doc.removeEventListener('keydown', onDialogKeydown, true);
  }

  function onDialogKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(); return; }
    if (e.key !== 'Tab' || !openDialogEl) return;

    // Focus stays inside the dialog while it is open.
    var focusable = openDialogEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function timeOptions(selected, isEnd) {
    var out = [];
    var lo = isEnd ? 1 : 0;
    var hi = isEnd ? U.SLOTS_PER_DAY : U.SLOTS_PER_DAY - 1;
    for (var s = lo; s <= hi; s++) {
      out.push('<option value="' + s + '"' + (s === selected ? ' selected' : '') + '>' +
        esc(U.formatMinutes(U.slotStartMinutes(s))) + '</option>');
    }
    return out.join('');
  }

  /* A typed-in shift, for building a schedule by hand without reaching for the
   * optimizer, and for anyone working without a mouse. With preset.id it edits
   * that shift instead of adding one -- which is also the only way to say where
   * a shift is held, since a drag cannot move a block to another room. */
  function openShiftDialog(state, preset, onSave) {
    closeDialog();

    var labels = U.displayNames(state.tutors);
    var start = typeof preset.startSlot === 'number' ? preset.startSlot : 0;
    var end = typeof preset.endSlot === 'number' ? preset.endSlot : Math.min(U.SLOTS_PER_DAY, start + 4);
    var editing = !!preset.id;
    var kind = U.shiftKind(preset.kind).key;

    var backdrop = el('div', { class: 'dialog-backdrop' });
    var dialog = el('div', {
      class: 'dialog dialog--narrow', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'shift-dialog-title'
    });

    dialog.innerHTML =
      '<div class="dialog__head"><h2 id="shift-dialog-title">' +
        (editing ? 'Edit shift' : 'Add a shift') + '</h2></div>' +
      '<div class="dialog__body">' +
        '<div class="field"><label for="f-shift-tutor">Tutor</label>' +
          '<select id="f-shift-tutor">' +
            state.tutors.map(function (t) {
              return '<option value="' + esc(t.id) + '"' +
                (t.id === preset.tutorId ? ' selected' : '') + '>' + esc(labels[t.id]) + '</option>';
            }).join('') +
          '</select></div>' +
        '<div class="field"><label for="f-shift-day">Day</label>' +
          '<select id="f-shift-day">' +
            U.DAY_NAMES.map(function (n, i) {
              return '<option value="' + i + '"' + (i === (preset.day || 0) ? ' selected' : '') +
                '>' + esc(n) + '</option>';
            }).join('') +
          '</select></div>' +
        '<div class="grid-2">' +
          '<div class="field"><label for="f-shift-start">Starts</label>' +
            '<select id="f-shift-start">' + timeOptions(start, false) + '</select></div>' +
          '<div class="field"><label for="f-shift-end">Ends</label>' +
            '<select id="f-shift-end">' + timeOptions(end, true) + '</select></div>' +
        '</div>' +
        '<div class="field"><label for="f-shift-kind">Where</label>' +
          '<select id="f-shift-kind">' +
            U.SHIFT_KINDS.map(function (k) {
              return '<option value="' + k.key + '"' + (k.key === kind ? ' selected' : '') + '>' +
                esc(k.key === 'main' ? state.settings.location || k.label : k.label) + '</option>';
            }).join('') +
          '</select>' +
          '<p class="field__hint">A floating embedded tutor sits in the class as it is taught, ' +
            'and an open lab is held in its own room. Neither one staffs the tutoring center, ' +
            'so they are listed beside the calendar instead of drawn in it.</p></div>' +
        '<div class="field" id="f-shift-room-field"' + (kind === 'main' ? ' hidden' : '') + '>' +
          '<label for="f-shift-room">Room</label>' +
          '<input type="text" id="f-shift-room" value="' + esc(preset.room || '') +
            '" placeholder="OMN 286"></div>' +
        '<p class="field__hint" id="shift-dialog-note"></p>' +
      '</div>' +
      '<div class="dialog__foot">' +
        '<button type="button" class="btn" id="btn-cancel-shift">Cancel</button>' +
        '<button type="button" class="btn btn--primary" id="btn-save-shift">' +
          (editing ? 'Save changes' : 'Add shift') + '</button>' +
      '</div>';

    backdrop.appendChild(dialog);
    doc.getElementById('dialog-root').appendChild(backdrop);
    openDialogEl = backdrop;
    doc.addEventListener('keydown', onDialogKeydown, true);

    var note = dialog.querySelector('#shift-dialog-note');

    var kindSelect = dialog.querySelector('#f-shift-kind');
    var roomField = dialog.querySelector('#f-shift-room-field');
    var roomInput = dialog.querySelector('#f-shift-room');

    kindSelect.addEventListener('change', function () {
      var offRoom = kindSelect.value !== 'main';
      roomField.hidden = !offRoom;
      if (offRoom) roomInput.focus();
    });

    function read() {
      var value = {
        id: preset.id || null,
        tutorId: dialog.querySelector('#f-shift-tutor').value,
        day: parseInt(dialog.querySelector('#f-shift-day').value, 10),
        startSlot: parseInt(dialog.querySelector('#f-shift-start').value, 10),
        endSlot: parseInt(dialog.querySelector('#f-shift-end').value, 10),
        kind: kindSelect.value
      };
      value.room = value.kind === 'main' ? '' : roomInput.value.trim();
      return value;
    }

    dialog.querySelector('#btn-cancel-shift').addEventListener('click', closeDialog);
    dialog.querySelector('#btn-save-shift').addEventListener('click', function () {
      var value = read();
      if (value.endSlot <= value.startSlot) {
        note.textContent = 'The end time has to come after the start time.';
        return;
      }
      // A room off the main calendar has to say which room, or the handout
      // tells a student to go and find a door number that is not there.
      if (value.kind !== 'main' && !value.room) {
        note.textContent = 'Give the room this is held in, like OMN 286.';
        roomInput.focus();
        return;
      }
      // The caller owns the rules, so it can refuse and leave the dialog open
      // with the reason showing rather than silently dropping the shift.
      var problem = onSave(value);
      if (problem) { note.textContent = problem; return; }
      closeDialog();
    });

    dialog.querySelector('#f-shift-tutor').focus();
  }

  function openTutorDialog(tutor, settings, onSave) {
    closeDialog();

    var isNew = !tutor;
    var subjects = {};
    U.SUBJECTS.forEach(function (s) {
      subjects[s.key] = !!(tutor && tutor.subjects && tutor.subjects[s.key]);
    });
    var working = {
      firstName: tutor ? tutor.firstName : '',
      lastName: tutor ? tutor.lastName : '',
      email: tutor ? tutor.email || '' : '',
      subjects: subjects,
      maxHoursPerWeek: tutor ? tutor.maxHoursPerWeek : settings.defaultMaxHours,
      minHoursPerWeek: tutor ? tutor.minHoursPerWeek : 0,
      availability: tutor ? tutor.availability.slice() : availabilityFromWindows([]),
      notes: tutor ? tutor.notes : ''
    };

    var backdrop = el('div', { class: 'dialog-backdrop' });
    var dialog = el('div', {
      class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tutor-dialog-title'
    });

    dialog.innerHTML =
      '<div class="dialog__head"><h2 id="tutor-dialog-title">' +
        (isNew ? 'Add tutor' : 'Edit tutor') + '</h2></div>' +
      '<div class="dialog__body">' +
        '<div class="grid-2">' +
          '<div class="field"><label for="f-first">First name</label>' +
            '<input type="text" id="f-first" value="' + esc(working.firstName) + '" required></div>' +
          '<div class="field"><label for="f-last">Last name</label>' +
            '<input type="text" id="f-last" value="' + esc(working.lastName) + '">' +
            '<p class="field__hint">Used only if two tutors share a first name.</p></div>' +
        '</div>' +
        '<div class="field"><label for="f-email">Email</label>' +
          '<input type="email" id="f-email" value="' + esc(working.email) + '"' +
          ' placeholder="name@chattanoogastate.edu" autocomplete="off">' +
          '<p class="field__hint">Not printed. Used by “Email all” in the Tutors panel.</p></div>' +
        '<div class="field"><fieldset><legend>Classes they can tutor</legend>' +
          '<div class="subject-grid">' +
            U.SUBJECTS.map(function (s) {
              return '<label><input type="checkbox" data-subject="' + s.key + '"' +
                (working.subjects[s.key] ? ' checked' : '') + '> ' + esc(s.label) + '</label>';
            }).join('') +
          '</div></fieldset></div>' +
        '<div class="grid-2">' +
          '<div class="field"><label for="f-max">Approved hours per week</label>' +
            '<input type="number" id="f-max" min="0" max="40" step="0.5" value="' + working.maxHoursPerWeek + '"></div>' +
        '</div>' +
        '<div class="field"><fieldset><legend>Availability</legend>' +
          '<div id="painter"></div>' +
          '<p class="painter__readout" id="painter-readout" aria-live="polite"></p>' +
          '<p class="painter__hint">Click and drag to paint. With the keyboard, move with the ' +
            'arrow keys and press Space to toggle a half hour.</p>' +
          '<div id="windows-holder"></div>' +
          '<button type="button" class="btn btn--small" id="btn-add-window">Add time window</button>' +
          '<p class="field__hint" id="avail-summary"></p>' +
        '</fieldset></div>' +
        '<div class="field"><label for="f-notes">Notes</label>' +
          '<input type="text" id="f-notes" value="' + esc(working.notes) + '"></div>' +
      '</div>' +
      '<div class="dialog__foot">' +
        '<button type="button" class="btn" id="btn-cancel-dialog">Cancel</button>' +
        '<button type="button" class="btn btn--primary" id="btn-save-tutor">' +
          (isNew ? 'Add tutor' : 'Save changes') + '</button>' +
      '</div>';

    backdrop.appendChild(dialog);
    doc.getElementById('dialog-root').appendChild(backdrop);
    openDialogEl = backdrop;
    doc.addEventListener('keydown', onDialogKeydown, true);

    var painterHolder = dialog.querySelector('#painter');
    var windowsHolder = dialog.querySelector('#windows-holder');
    var summary = dialog.querySelector('#avail-summary');

    function syncSummary() {
      var h = availabilityHours(working.availability);
      summary.textContent = h ? (h + ' hours available per week.') : 'No availability set yet.';
    }

    /* -- painter -- */
    var painting = false;
    var paintValue = 1;

    /* Each cell is the half hour between two lines, and each time is written on
     * the line it names -- "9:00" sits on the line where 9:00 starts, not in the
     * middle of a row -- so painting from the 9:00 line to the 1:00 line is
     * 9:00 to 1:00. The last line of the day is labelled too, so a shift can be
     * read to its end.
     */
    function tick(slot, cls) {
      return '<span class="painter__tick' + (cls ? ' ' + cls : '') + '">' +
        esc(U.formatMinutes(U.slotStartMinutes(slot), { omitSuffix: true })) + '</span>';
    }

    function renderPainter() {
      var html = '<div class="painter"><span class="painter__corner"></span>';
      U.DAY_ABBR.forEach(function (d) {
        html += '<span class="painter__day">' + d + '</span>';
      });
      for (var s = 0; s < U.SLOTS_PER_DAY; s++) {
        var onHour = U.slotStartMinutes(s) % 60 === 0;
        html += '<span class="painter__time">' + (onHour ? tick(s) : '') +
          (s === U.SLOTS_PER_DAY - 1 ? tick(s + 1, 'painter__tick--end') : '') + '</span>';
        for (var d2 = 0; d2 < U.DAYS; d2++) {
          var label = U.DAY_NAMES[d2] + ' ' + U.formatRange(s, s + 1);
          html += '<button type="button" class="painter__cell" data-day="' + d2 + '" data-slot="' + s +
            '" data-hour="' + (onHour ? 1 : 0) + '" data-on="' + working.availability[U.idx(d2, s)] +
            '" aria-pressed="' + (working.availability[U.idx(d2, s)] ? 'true' : 'false') +
            '" aria-label="' + esc(label) + '" title="' + esc(label) + '"></button>';
        }
      }
      html += '</div>';
      painterHolder.innerHTML = html;
      showReadout(null);
    }

    /* -- the readout: what the pointer is on, in words --
     * The grid alone makes a half hour easy to miss by one row, so the exact
     * time under the pointer is spelled out, and while painting, the whole
     * stretch from where the drag began: "Painting Tuesday 1:30-4:00 PM".
     */
    var readout = dialog.querySelector('#painter-readout');
    var dragFrom = null;

    function daySpan(a, b) {
      var lo = Math.min(a, b), hi = Math.max(a, b);
      return lo === hi ? U.DAY_NAMES[lo] : U.DAY_ABBR[lo] + '–' + U.DAY_ABBR[hi];
    }

    function showReadout(cell) {
      if (!cell) {
        readout.textContent = 'Point at a half hour to see exactly when it starts and ends.';
        return;
      }
      var day = +cell.getAttribute('data-day'), slot = +cell.getAttribute('data-slot');
      if (painting && dragFrom) {
        readout.textContent = (paintValue ? 'Adding ' : 'Clearing ') +
          daySpan(dragFrom.day, day) + ' ' +
          U.formatRange(Math.min(dragFrom.slot, slot), Math.max(dragFrom.slot, slot) + 1);
        return;
      }
      readout.textContent = U.DAY_NAMES[day] + ' ' + U.formatRange(slot, slot + 1) + ' — ' +
        (working.availability[U.idx(day, slot)] ? 'available' : 'not available');
    }

    function setCell(day, slot, value) {
      working.availability[U.idx(day, slot)] = value;
      var cell = painterHolder.querySelector('[data-day="' + day + '"][data-slot="' + slot + '"]');
      if (cell) {
        cell.setAttribute('data-on', value);
        cell.setAttribute('aria-pressed', value ? 'true' : 'false');
      }
    }

    painterHolder.addEventListener('mousedown', function (e) {
      var cell = e.target.closest('.painter__cell');
      if (!cell) return;
      e.preventDefault();
      var day = +cell.getAttribute('data-day'), slot = +cell.getAttribute('data-slot');
      paintValue = working.availability[U.idx(day, slot)] ? 0 : 1;
      painting = true;
      dragFrom = { day: day, slot: slot };
      setCell(day, slot, paintValue);
      showReadout(cell);
    });

    painterHolder.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.painter__cell');
      if (!cell) return;
      if (painting) setCell(+cell.getAttribute('data-day'), +cell.getAttribute('data-slot'), paintValue);
      showReadout(cell);
    });

    painterHolder.addEventListener('mouseleave', function () {
      if (!painting) showReadout(null);
    });

    painterHolder.addEventListener('focusin', function (e) {
      var cell = e.target.closest('.painter__cell');
      if (cell) showReadout(cell);
    });

    function endPaint() {
      if (!painting) return;
      painting = false;
      dragFrom = null;
      renderWindows();
      syncSummary();
    }
    doc.addEventListener('mouseup', endPaint);

    painterHolder.addEventListener('keydown', function (e) {
      var cell = e.target.closest('.painter__cell');
      if (!cell) return;
      var day = +cell.getAttribute('data-day'), slot = +cell.getAttribute('data-slot');
      var nd = day, ns = slot;

      if (e.key === 'ArrowRight') nd = Math.min(U.DAYS - 1, day + 1);
      else if (e.key === 'ArrowLeft') nd = Math.max(0, day - 1);
      else if (e.key === 'ArrowDown') ns = Math.min(U.SLOTS_PER_DAY - 1, slot + 1);
      else if (e.key === 'ArrowUp') ns = Math.max(0, slot - 1);
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setCell(day, slot, working.availability[U.idx(day, slot)] ? 0 : 1);
        showReadout(cell);
        renderWindows();
        syncSummary();
        return;
      } else return;

      e.preventDefault();
      var next = painterHolder.querySelector('[data-day="' + nd + '"][data-slot="' + ns + '"]');
      if (next) next.focus();
    });

    /* -- time-window rows, kept in step with the painter -- */
    function renderWindows() {
      var windows = windowsFromAvailability(working.availability);
      if (!windows.length) {
        windowsHolder.innerHTML = '<p class="field__hint">No time windows yet.</p>';
        return;
      }
      var html = '<ul class="windows">';
      windows.forEach(function (w, i) {
        html += '<li>' +
          '<select data-win="' + i + '" data-part="day" aria-label="Day">' +
            U.DAY_NAMES.map(function (n, d) {
              return '<option value="' + d + '"' + (d === w.day ? ' selected' : '') + '>' + n + '</option>';
            }).join('') +
          '</select>' +
          '<select data-win="' + i + '" data-part="start" aria-label="Start time">' +
            timeOptions(w.start, false) + '</select>' +
          '<span aria-hidden="true">to</span>' +
          '<select data-win="' + i + '" data-part="end" aria-label="End time">' +
            timeOptions(w.end, true) + '</select>' +
          '<button type="button" class="btn btn--small btn--danger" data-remove-win="' + i +
            '" aria-label="Remove this window">×</button>' +
          '</li>';
      });
      html += '</ul>';
      windowsHolder.innerHTML = html;
    }

    function currentWindows() { return windowsFromAvailability(working.availability); }

    function commitWindows(windows) {
      working.availability = availabilityFromWindows(windows);
      renderPainter();
      renderWindows();
      syncSummary();
    }

    windowsHolder.addEventListener('change', function (e) {
      var select = e.target;
      if (!select.hasAttribute('data-win')) return;
      var windows = currentWindows();
      var w = windows[+select.getAttribute('data-win')];
      if (!w) return;
      var part = select.getAttribute('data-part');
      var value = +select.value;

      if (part === 'day') w.day = value;
      else if (part === 'start') { w.start = value; if (w.end <= w.start) w.end = Math.min(U.SLOTS_PER_DAY, w.start + 1); }
      else { w.end = value; if (w.end <= w.start) w.start = Math.max(0, w.end - 1); }

      commitWindows(windows);
    });

    windowsHolder.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove-win]');
      if (!btn) return;
      var windows = currentWindows();
      windows.splice(+btn.getAttribute('data-remove-win'), 1);
      commitWindows(windows);
    });

    dialog.querySelector('#btn-add-window').addEventListener('click', function () {
      var windows = currentWindows();
      windows.push({ day: 0, start: U.hhmmToSlot('09:00'), end: U.hhmmToSlot('12:00') });
      commitWindows(windows);
    });

    dialog.addEventListener('change', function (e) {
      var key = e.target.getAttribute && e.target.getAttribute('data-subject');
      if (key) working.subjects[key] = e.target.checked;
    });

    dialog.querySelector('#btn-cancel-dialog').addEventListener('click', function () {
      doc.removeEventListener('mouseup', endPaint);
      closeDialog();
    });

    backdrop.addEventListener('mousedown', function (e) {
      if (e.target === backdrop) { doc.removeEventListener('mouseup', endPaint); closeDialog(); }
    });

    dialog.querySelector('#btn-save-tutor').addEventListener('click', function () {
      var first = dialog.querySelector('#f-first').value.trim();
      if (!first) {
        dialog.querySelector('#f-first').focus();
        return;
      }
      var payload = {
        firstName: first,
        lastName: dialog.querySelector('#f-last').value.trim(),
        email: dialog.querySelector('#f-email').value.trim(),
        subjects: working.subjects,
        maxHoursPerWeek: parseFloat(dialog.querySelector('#f-max').value) || 0,
        minHoursPerWeek: working.minHoursPerWeek,
        availability: working.availability,
        notes: dialog.querySelector('#f-notes').value.trim()
      };
      doc.removeEventListener('mouseup', endPaint);
      closeDialog();
      onSave(payload);
    });

    renderPainter();
    renderWindows();
    syncSummary();
    dialog.querySelector('#f-first').focus();
  }

  TS.tutors = {
    renderRoster: renderRoster,
    openTutorDialog: openTutorDialog,
    openShiftDialog: openShiftDialog,
    esc: esc
  };
})(typeof window !== 'undefined' ? window : globalThis);
