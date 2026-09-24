(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;
  var doc = root.document;

  var onChangeCb = null;
  var onNoticeCb = null;
  var viewStart = 0;   // first slot the grid is currently drawing, set by render

  function rowHeight(container) {
    var v = root.getComputedStyle(container).getPropertyValue('--row-h');
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 26;
  }

  /* ---- lane packing ------------------------------------------------------
   * Overlapping blocks are grouped into clusters, and every block in a cluster
   * is drawn at the same width. Without the cluster step, a block would change
   * width halfway down whenever a neighbour started or ended.
   */
  function layoutDay(blocks) {
    var sorted = blocks.slice().sort(function (a, b) {
      return a.startSlot - b.startSlot || a.endSlot - b.endSlot;
    });
    var clusters = [];
    var current = null;

    sorted.forEach(function (b) {
      if (current && b.startSlot < current.end) {
        current.items.push(b);
        current.end = Math.max(current.end, b.endSlot);
      } else {
        current = { items: [b], end: b.endSlot };
        clusters.push(current);
      }
    });

    var placement = {};
    clusters.forEach(function (cluster) {
      var laneEnds = [];
      cluster.items.forEach(function (b) {
        var lane = -1;
        for (var i = 0; i < laneEnds.length; i++) {
          if (laneEnds[i] <= b.startSlot) { lane = i; break; }
        }
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
        laneEnds[lane] = b.endSlot;
        placement[b.id] = { lane: lane };
      });
      cluster.items.forEach(function (b) { placement[b.id].lanes = laneEnds.length; });
    });

    return placement;
  }

  /* ---- placement rules --------------------------------------------------- */

  function checkPlacement(state, assignment, day, start, end) {
    var s = state.settings;
    var tutor = TS.store.getTutor(assignment.tutorId);
    if (!tutor) return { ok: false, reason: 'That tutor no longer exists.' };
    if (start < 0 || end > U.SLOTS_PER_DAY) return { ok: false, reason: 'That runs outside 7:00 AM–8:30 PM.' };
    if (end - start < s.minShiftSlots) {
      return { ok: false, reason: 'Shifts must be at least ' + (s.minShiftSlots / 2) + ' hour(s) long.' };
    }

    for (var i = start; i < end; i++) {
      if (!tutor.availability[U.idx(day, i)]) {
        return { ok: false, reason: tutor.firstName + ' is not available then.' };
      }
    }

    var others = state.assignments.filter(function (a) { return a.id !== assignment.id; });

    var sameTutorDay = others.filter(function (a) { return a.tutorId === tutor.id && a.day === day; });
    for (var k = 0; k < sameTutorDay.length; k++) {
      var o = sameTutorDay[k];
      if (start < o.endSlot && end > o.startSlot) {
        return { ok: false, reason: tutor.firstName + ' already has a shift at that time.' };
      }
    }

    var weekSlots = (end - start);
    others.forEach(function (a) {
      if (a.tutorId === tutor.id) weekSlots += a.endSlot - a.startSlot;
    });
    if (weekSlots > tutor.maxHoursPerWeek * 2) {
      return { ok: false, reason: 'That puts ' + tutor.firstName + ' over their ' + tutor.maxHoursPerWeek + ' hour weekly cap.' };
    }

    var row = new Array(U.SLOTS_PER_DAY);
    for (var r = 0; r < U.SLOTS_PER_DAY; r++) row[r] = 0;
    sameTutorDay.forEach(function (a) {
      for (var x = a.startSlot; x < a.endSlot; x++) row[x] = 1;
    });
    for (var y = start; y < end; y++) row[y] = 1;

    var maxRun = Math.round(s.breakAfterHours * 2) - 1;
    var run = 0;
    for (var z = 0; z < U.SLOTS_PER_DAY; z++) {
      if (row[z]) {
        run++;
        if (run > maxRun) {
          return {
            ok: false,
            reason: tutor.firstName + ' would work more than ' + (maxRun / 2) +
              ' hours straight. Add a 30 minute break.'
          };
        }
      } else run = 0;
    }

    // Concurrency is the one rule the user may knowingly break. It is a
    // property of the tutoring center, so a shift held anywhere else clears it
    // without being measured against it.
    if (U.offRoom(assignment)) return { ok: true, overCapacity: false, overSlots: 0 };

    // Measured with the shift in place: whether it may run past the evening
    // cap depends on whether it started before the evening did.
    var placed = {};
    Object.keys(assignment).forEach(function (k) { placed[k] = assignment[k]; });
    placed.day = day;
    placed.startSlot = start;
    placed.endSlot = end;
    var cap = U.capacity(s, others.concat([placed]));
    var over = 0;
    for (var c = start; c < end; c++) {
      if (cap.counts[U.idx(day, c)] > cap.limits[U.idx(day, c)]) over++;
    }

    return { ok: true, overCapacity: over > 0, overSlots: over };
  }

  /* ---- rendering ---------------------------------------------------------- */

  function render(container, state, options) {
    var dark = TS.theme.isDark();
    var labels = U.displayNames(state.tutors);
    var rh = rowHeight(container);
    var cap = U.capacity(state.settings, state.assignments);
    var selected = (options && options.selectedTutorId)
      ? TS.store.getTutor(options.selectedTutorId) : null;
    // The grid is the tutoring center and nothing else; embedded classes and
    // open labs are listed beside it, so they do not stretch its hours either.
    var drawn = U.mainShifts(state.assignments);
    var win = U.editorWindow(state.tutors, drawn);
    var rows = win.end - win.start;

    container.setAttribute('data-drawing', selected ? '1' : '0');
    viewStart = win.start;

    container.innerHTML = '';
    container.style.setProperty('--rows', rows);

    var head = doc.createElement('div');
    head.className = 'calendar__head calendar__head--gutter';
    head.innerHTML = '<span class="visually-hidden">Time</span>';
    container.appendChild(head);

    U.DAY_NAMES.forEach(function (name) {
      var h = doc.createElement('div');
      h.className = 'calendar__head';
      h.textContent = name;
      container.appendChild(h);
    });

    var gutter = doc.createElement('div');
    gutter.className = 'calendar__gutter';
    gutter.style.height = (rows * rh) + 'px';
    for (var s = win.start; s <= win.end; s++) {
      if (U.slotStartMinutes(s) % 60 !== 0 && s !== win.end) continue;
      var tick = doc.createElement('span');
      tick.className = 'calendar__tick';
      tick.style.top = ((s - win.start) * rh) + 'px';
      // The end labels sit inside the grid instead of straddling its edge, so
      // neither is clipped by the pinned day names or the bottom of the box.
      if (s === win.start) tick.style.transform = 'translateY(1px)';
      else if (s === win.end) tick.style.transform = 'translateY(-100%)';
      tick.textContent = U.formatMinutes(U.slotStartMinutes(s));
      gutter.appendChild(tick);
    }
    container.appendChild(gutter);

    for (var d = 0; d < U.DAYS; d++) {
      var col = doc.createElement('div');
      col.className = 'calendar__day';
      col.setAttribute('data-day', d);
      col.style.height = (rows * rh) + 'px';

      var dayBlocks = drawn.filter(function (a) { return a.day === d; });
      var placement = layoutDay(dayBlocks);

      // While a tutor is selected for drawing, their open hours are tinted, so
      // it is obvious where a new shift is allowed to land before the drag.
      if (selected) {
        var availStart = null;
        for (var av = win.start; av <= win.end; av++) {
          var free = av < win.end && selected.availability[U.idx(d, av)];
          if (free && availStart === null) availStart = av;
          else if (!free && availStart !== null) {
            var band = doc.createElement('div');
            band.className = 'availband';
            band.style.top = ((availStart - win.start) * rh) + 'px';
            band.style.height = ((av - availStart) * rh) + 'px';
            col.appendChild(band);
            availStart = null;
          }
        }
      }

      // Over-capacity bands sit under the blocks so the stripe reads as a
      // property of the time, not of any one tutor.
      var bandStart = null;
      for (var bs = win.start; bs <= win.end; bs++) {
        var over = bs < win.end && cap.counts[U.idx(d, bs)] > cap.limits[U.idx(d, bs)];
        if (over && bandStart === null) bandStart = bs;
        else if (!over && bandStart !== null) {
          var stripe = doc.createElement('div');
          stripe.className = 'overband';
          stripe.style.top = ((bandStart - win.start) * rh) + 'px';
          stripe.style.height = ((bs - bandStart) * rh) + 'px';
          col.appendChild(stripe);
          bandStart = null;
        }
      }

      dayBlocks.forEach(function (a) {
        col.appendChild(buildBlock(a, state, labels, placement[a.id], rh, dark, win));
      });

      container.appendChild(col);
    }
  }

  function buildBlock(a, state, labels, place, rh, dark, win) {
    var tutor = TS.store.getTutor(a.tutorId);
    var colors = U.blockColors(tutor.colorIndex, dark);
    var mask = U.subjectMask(tutor.subjects);
    var shorts = U.maskToShort(mask);
    var lanes = (place && place.lanes) || 1;
    var lane = (place && place.lane) || 0;
    var len = a.endSlot - a.startSlot;

    var node = doc.createElement('div');
    node.className = 'block';
    node.setAttribute('data-id', a.id);
    // A group rather than a button: the block holds the lock control, and a
    // button is not allowed to contain another one.
    node.setAttribute('role', 'group');
    node.setAttribute('tabindex', '0');
    if (a.locked) node.setAttribute('data-locked', '1');
    if (U.usesHatch(tutor.colorIndex)) node.setAttribute('data-hatch', '1');
    if (len <= 2) node.setAttribute('data-short', '1');

    node.style.top = ((a.startSlot - win.start) * rh + 1) + 'px';
    node.style.height = (len * rh - 3) + 'px';
    node.style.left = 'calc(' + (lane / lanes * 100) + '% + 2px)';
    node.style.width = 'calc(' + (100 / lanes) + '% - 4px)';
    node.style.background = colors.bg;
    node.style.borderColor = colors.bar;
    node.style.color = colors.ink;

    var full = (tutor.firstName + ' ' + tutor.lastName).trim();
    var range = U.formatRange(a.startSlot, a.endSlot);
    var subjectText = shorts.length ? U.listSentence(U.maskToLabels(mask)) : 'no subjects assigned';

    // Screen readers get the full name and spelled-out subjects even though
    // the grid shows an abbreviated label and short codes.
    node.setAttribute('aria-label',
      full + ', ' + U.DAY_NAMES[a.day] + ' ' + range + ', ' + subjectText +
      (a.locked ? ', locked' : ''));

    node.innerHTML =
      '<span class="block__handle block__handle--top" data-edge="start"></span>' +
      '<button type="button" class="block__lock" data-lock="1" aria-pressed="' +
        (a.locked ? 'true' : 'false') + '" aria-label="' +
        (a.locked ? 'Unlock' : 'Lock') + ' ' + TS.tutors.esc(full) + ', ' +
        U.DAY_NAMES[a.day] + ' ' + TS.tutors.esc(range) + '">' +
        (a.locked ? '🔒' : '🔓') + '</button>' +
      // A locked shift has no remove button: locking is what protects a shift
      // from being taken away, here as much as from Clear schedule.
      (a.locked ? '' :
        '<button type="button" class="block__remove" data-remove="1" aria-label="Remove ' +
        TS.tutors.esc(full) + ', ' + U.DAY_NAMES[a.day] + ' ' + TS.tutors.esc(range) +
        '">×</button>') +
      // Where the shift is held is not something a drag can change, so the
      // block carries a way into the dialog that can.
      '<button type="button" class="block__edit" data-edit="1" aria-label="Edit ' +
        TS.tutors.esc(full) + ', ' + U.DAY_NAMES[a.day] + ' ' + TS.tutors.esc(range) +
        '">✎</button>' +
      '<span class="block__name">' + TS.tutors.esc(labels[tutor.id]) + '</span>' +
      '<span class="block__time">' + TS.tutors.esc(range) + '</span>' +
      '<span class="block__subjects">' + (shorts.join(' · ') || '—') + '</span>' +
      '<span class="block__handle block__handle--bottom" data-edge="end"></span>';

    return node;
  }

  /* ---- floating embedded tutors & open labs -------------------------------
   * Held somewhere other than the room the calendar is about, so they are
   * listed beside it under their own headings rather than drawn in it. They
   * are still the tutor's hours, so each one carries the same lock and remove
   * controls a block does, and the same dialog behind Edit -- which is also
   * the only way to change where a shift is held.
   */
  function renderAside(container, state, handlers) {
    var dark = TS.theme.isDark();
    var labels = U.displayNames(state.tutors);
    // Read the way the week is: by day, then by time, then by name.
    var shifts = U.offRoomShifts(state.assignments).slice().sort(function (a, b) {
      return a.day - b.day || a.startSlot - b.startSlot || a.endSlot - b.endSlot ||
        U.compareNames(labels[a.tutorId] || '', labels[b.tutorId] || '');
    });

    container.innerHTML = '';

    U.SHIFT_KINDS.forEach(function (kind) {
      if (kind.key === 'main') return;
      var group = shifts.filter(function (a) { return a.kind === kind.key; });

      // Neither kind staffs the center, so neither one should need a shift
      // there first: each heading adds straight into itself.
      var head = doc.createElement('div');
      head.className = 'offroom__head';

      var heading = doc.createElement('h3');
      heading.className = 'offroom__kind';
      heading.textContent = kind.plural;
      head.appendChild(heading);

      var add = doc.createElement('button');
      add.type = 'button';
      add.className = 'btn btn--small';
      add.textContent = 'Add';
      add.setAttribute('aria-label', 'Add a ' + kind.label.toLowerCase());
      add.addEventListener('click', function () { handlers.onAdd(kind.key); });
      head.appendChild(add);

      container.appendChild(head);

      if (!group.length) {
        var empty = doc.createElement('p');
        empty.className = 'offroom__empty';
        empty.textContent = 'None yet.';
        container.appendChild(empty);
        return;
      }

      var list = doc.createElement('ul');
      list.className = 'offroom__list';

      group.forEach(function (a) {
        var tutor = TS.store.getTutor(a.tutorId);
        if (!tutor) return;
        var colors = U.blockColors(tutor.colorIndex, dark);
        var shorts = U.maskToShort(U.subjectMask(tutor.subjects));
        var full = (tutor.firstName + ' ' + tutor.lastName).trim();
        var range = U.formatRange(a.startSlot, a.endSlot);
        var where = U.roomLabel(a, state.settings);

        var li = doc.createElement('li');
        li.className = 'offroom__item';
        li.style.background = colors.bg;
        li.style.borderLeftColor = colors.bar;
        li.style.color = colors.ink;
        if (a.locked) li.setAttribute('data-locked', '1');
        if (U.usesHatch(tutor.colorIndex)) li.setAttribute('data-hatch', '1');

        li.innerHTML =
          '<div class="offroom__who">' + TS.tutors.esc(labels[tutor.id]) +
            (a.locked ? ' <span aria-hidden="true">🔒</span>' : '') + '</div>' +
          '<div class="offroom__when">' + U.DAY_ABBR[a.day] + ' ' + TS.tutors.esc(range) + '</div>' +
          '<div class="offroom__room">' + TS.tutors.esc(where) + '</div>' +
          '<div class="offroom__subjects">' + (shorts.join(' · ') || '—') + '</div>' +
          '<span class="visually-hidden">' + TS.tutors.esc(full) + ', ' +
            U.DAY_NAMES[a.day] + ', ' + kind.label + (a.locked ? ', locked' : '') + '</span>';

        var actions = doc.createElement('div');
        actions.className = 'offroom__actions';

        var edit = doc.createElement('button');
        edit.type = 'button';
        edit.className = 'btn btn--small';
        edit.textContent = 'Edit';
        edit.setAttribute('aria-label', 'Edit ' + full + ', ' + U.DAY_NAMES[a.day] + ' ' + range);
        edit.addEventListener('click', function () { handlers.onEdit(a.id); });
        actions.appendChild(edit);

        var lock = doc.createElement('button');
        lock.type = 'button';
        lock.className = 'btn btn--small';
        lock.textContent = a.locked ? 'Unlock' : 'Lock';
        lock.setAttribute('aria-pressed', a.locked ? 'true' : 'false');
        lock.addEventListener('click', function () { handlers.onLock(a.id, !a.locked); });
        actions.appendChild(lock);

        // As on the calendar, locking is what protects a shift, so a locked
        // row offers no way to remove it.
        if (!a.locked) {
          var del = doc.createElement('button');
          del.type = 'button';
          del.className = 'btn btn--small btn--danger';
          del.textContent = 'Remove';
          del.setAttribute('aria-label', 'Remove ' + full + ', ' + U.DAY_NAMES[a.day] + ' ' + range);
          del.addEventListener('click', function () { handlers.onRemove(a.id); });
          actions.appendChild(del);
        }

        li.appendChild(actions);
        list.appendChild(li);
      });

      container.appendChild(list);
    });
  }

  /* ---- interaction -------------------------------------------------------- */

  function attach(container, getState, callbacks) {
    onChangeCb = callbacks.onChange;
    onNoticeCb = callbacks.onNotice;

    var drag = null;
    var draw = null;

    function selectedTutorId() {
      return callbacks.getSelectedTutorId ? callbacks.getSelectedTutorId() : null;
    }

    function slotAt(colEl, clientY, rh) {
      var top = colEl.getBoundingClientRect().top;
      var slot = viewStart + Math.floor((clientY - top) / rh);
      return Math.max(viewStart, Math.min(U.SLOTS_PER_DAY, slot));
    }

    function paintGhost() {
      if (!draw) return;
      draw.ghost.style.top = ((draw.start - viewStart) * draw.rh + 1) + 'px';
      draw.ghost.style.height = ((draw.end - draw.start) * draw.rh - 3) + 'px';
      draw.ghost.textContent = U.formatRange(draw.start, draw.end);
    }

    // Dragging across empty grid paints a new shift for the selected tutor:
    // the whole manual path, with no optimizer run and nothing else disturbed.
    function startDraw(e) {
      var colEl = e.target.closest('.calendar__day');
      if (!colEl || !selectedTutorId()) return;

      e.preventDefault();
      var rh = rowHeight(container);
      var anchor = Math.min(U.SLOTS_PER_DAY - 1, slotAt(colEl, e.clientY, rh));
      var ghost = doc.createElement('div');
      ghost.className = 'block block--ghost';
      colEl.appendChild(ghost);

      draw = {
        col: colEl,
        day: parseInt(colEl.getAttribute('data-day'), 10),
        anchor: anchor,
        start: anchor,
        end: anchor + 1,
        rh: rh,
        ghost: ghost
      };
      paintGhost();
    }

    function removeShift(a) {
      if (a.locked) {
        notice('That shift is locked. Unlock it first if you want it gone.', 'warn');
        return;
      }
      var tutor = TS.store.getTutor(a.tutorId);
      var who = tutor ? tutor.firstName : 'That shift';
      TS.store.removeAssignment(a.id);
      TS.store.commit('remove');
      notice('Removed ' + who + ', ' + U.DAY_NAMES[a.day] + ' ' +
        U.formatRange(a.startSlot, a.endSlot) + '. Ctrl+Z brings it back.', 'info');
    }

    container.addEventListener('click', function (e) {
      var removeBtn = e.target.closest('.block__remove');
      if (removeBtn) {
        var doomed = TS.store.getAssignment(removeBtn.closest('.block').getAttribute('data-id'));
        if (doomed) removeShift(doomed);
        return;
      }
      var editBtn = e.target.closest('.block__edit');
      if (editBtn) {
        if (callbacks.onEdit) callbacks.onEdit(editBtn.closest('.block').getAttribute('data-id'));
        return;
      }
      if (!e.target.closest('.block__lock')) return;
      var a = TS.store.getAssignment(e.target.closest('.block').getAttribute('data-id'));
      if (!a) return;
      a.locked = !a.locked;
      TS.store.commit('lock');
      notice(a.locked
        ? 'Shift locked. Auto-optimize will leave it exactly where it is.'
        : 'Shift unlocked.', 'info');
    });

    container.addEventListener('mousedown', function (e) {
      if (e.target.closest('.block__lock') || e.target.closest('.block__remove') ||
          e.target.closest('.block__edit')) return;
      var blockEl = e.target.closest('.block');
      if (!blockEl) { startDraw(e); return; }
      var state = getState();
      var a = TS.store.getAssignment(blockEl.getAttribute('data-id'));
      if (!a || a.locked) return;

      e.preventDefault();
      var edge = e.target.getAttribute('data-edge');
      drag = {
        el: blockEl,
        assignment: a,
        edge: edge || null,
        startY: e.clientY,
        startX: e.clientX,
        originStart: a.startSlot,
        originEnd: a.endSlot,
        originDay: a.day,
        rh: rowHeight(container),
        colWidth: container.querySelector('.calendar__day').getBoundingClientRect().width,
        moved: false
      };
      blockEl.style.zIndex = '5';
    });

    doc.addEventListener('mousemove', function (e) {
      if (draw) {
        var at = slotAt(draw.col, e.clientY, draw.rh);
        draw.start = Math.min(draw.anchor, at);
        draw.end = Math.max(draw.anchor + 1, at);
        paintGhost();
        return;
      }
      if (!drag) return;
      var dSlots = Math.round((e.clientY - drag.startY) / drag.rh);
      var dDays = drag.edge ? 0 : Math.round((e.clientX - drag.startX) / drag.colWidth);
      if (dSlots || dDays) drag.moved = true;

      var start = drag.originStart, end = drag.originEnd;
      if (drag.edge === 'start') start = Math.min(drag.originEnd - 1, drag.originStart + dSlots);
      else if (drag.edge === 'end') end = Math.max(drag.originStart + 1, drag.originEnd + dSlots);
      else { start += dSlots; end += dSlots; }

      drag.preview = {
        day: Math.max(0, Math.min(U.DAYS - 1, drag.originDay + dDays)),
        start: start,
        end: end
      };
      drag.el.style.top = ((start - viewStart) * drag.rh + 1) + 'px';
      drag.el.style.height = ((end - start) * drag.rh - 3) + 'px';
    });

    doc.addEventListener('mouseup', function () {
      if (draw) {
        var d = draw;
        draw = null;
        d.ghost.parentNode.removeChild(d.ghost);
        if (callbacks.onCreate) callbacks.onCreate(d.day, d.start, d.end);
        return;
      }
      if (!drag) return;
      var d = drag;
      drag = null;
      d.el.style.zIndex = '';

      if (!d.moved || !d.preview) { onChangeCb(); return; }
      commitMove(getState(), d.assignment, d.preview.day, d.preview.start, d.preview.end);
    });

    container.addEventListener('keydown', function (e) {
      var blockEl = e.target.closest('.block');
      if (!blockEl) return;
      var a = TS.store.getAssignment(blockEl.getAttribute('data-id'));
      if (!a) return;

      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        a.locked = !a.locked;
        TS.store.commit('lock');
        notice(a.locked
        ? 'Shift locked. Auto-optimize will leave it exactly where it is.'
        : 'Shift unlocked.', 'info');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeShift(a);
        return;
      }
      if (a.locked) return;

      var step = e.shiftKey ? 0 : 1;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (e.shiftKey) commitMove(getState(), a, a.day, a.startSlot, a.endSlot - 1);
        else commitMove(getState(), a, a.day, a.startSlot - 1, a.endSlot - 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.shiftKey) commitMove(getState(), a, a.day, a.startSlot, a.endSlot + 1);
        else commitMove(getState(), a, a.day, a.startSlot + 1, a.endSlot + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        commitMove(getState(), a, a.day - 1, a.startSlot, a.endSlot);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        commitMove(getState(), a, a.day + 1, a.startSlot, a.endSlot);
      }
      void step;
    });

    container.addEventListener('dblclick', function (e) {
      // the corner buttons have already done their own work
      if (e.target.closest('.block__lock') || e.target.closest('.block__remove') ||
          e.target.closest('.block__edit')) return;
      var blockEl = e.target.closest('.block');
      if (!blockEl) return;
      var a = TS.store.getAssignment(blockEl.getAttribute('data-id'));
      if (!a) return;
      a.locked = !a.locked;
      TS.store.commit('lock');
    });
  }

  function commitMove(state, assignment, day, start, end) {
    if (day < 0 || day >= U.DAYS) { onChangeCb(); return; }
    var check = checkPlacement(state, assignment, day, start, end);
    if (!check.ok) {
      notice(check.reason, 'warn');
      onChangeCb();
      return;
    }

    if (check.overCapacity) {
      var ok = root.confirm(
        'That goes over the cap of ' + U.capSummary(state.settings) + ' for ' +
        (check.overSlots / 2) + ' hour(s).\n\n' +
        'Place it anyway? It will be flagged on the schedule.'
      );
      if (!ok) { onChangeCb(); return; }
    }

    assignment.day = day;
    assignment.startSlot = start;
    assignment.endSlot = end;
    assignment.overCapacity = !!check.overCapacity;
    // Dragging a block up against another of the tutor's own is the same thing
    // as drawing it there: one shift, not two that touch.
    TS.store.mergeTouching(assignment.tutorId, day);
    TS.store.commit('move');
  }

  function notice(message, kind) {
    if (onNoticeCb) onNoticeCb(message, kind);
  }

  TS.calendar = {
    render: render,
    renderAside: renderAside,
    attach: attach,
    layoutDay: layoutDay,
    checkPlacement: checkPlacement,
    commitMove: commitMove
  };
})(typeof window !== 'undefined' ? window : globalThis);
