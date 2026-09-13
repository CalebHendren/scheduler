(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;

  var NAVY = [16, 48, 95];
  var ORANGE = [254, 80, 0];
  var INK = [20, 24, 31];
  var MUTED = [58, 69, 83];
  var RULE = [185, 195, 209];
  var FAINT = [237, 241, 246];
  var TINT = [242, 246, 251];

  // Blocks stop short of the column edge, so a day's shifts never touch the
  // next day's divider.
  var DAY_PAD = 3;

  function available() {
    return !!(root.jspdf && root.jspdf.jsPDF);
  }

  function truncate(pdf, text, maxWidth) {
    if (pdf.getTextWidth(text) <= maxWidth) return text;
    var s = text;
    while (s.length > 1 && pdf.getTextWidth(s + '…') > maxWidth) s = s.slice(0, -1);
    return s + '…';
  }

  function drawQr(pdf, text, x, y, size) {
    var grid = TS.qr.modules(text);
    if (!grid) return;
    var count = grid.length;
    var cell = size / count;

    pdf.setFillColor(255, 255, 255);
    pdf.rect(x - 3, y - 3, size + 6, size + 6, 'F');
    pdf.setFillColor(0, 0, 0);

    // Horizontal runs rather than one rect per module keeps the PDF small and
    // fully vector, so the code stays scannable at any zoom or print size.
    for (var r = 0; r < count; r++) {
      var runStart = -1;
      for (var c = 0; c <= count; c++) {
        var on = c < count && grid[r][c];
        if (on && runStart === -1) runStart = c;
        else if (!on && runStart !== -1) {
          pdf.rect(x + runStart * cell, y + r * cell, (c - runStart) * cell, cell, 'F');
          runStart = -1;
        }
      }
    }
  }

  /* Each kind held somewhere other than the center, as one labelled run of
   * text. The same footnote the old handouts carried, and cheap enough on a
   * crowded page: "Floating Embedded Tutors: Bailey Tue & Thu 12:30-2:00 PM
   * (OMN 286)".
   */
  function offRoomRuns(state, labels) {
    var groups = U.groupOffRoom(state.assignments);
    return U.SHIFT_KINDS.map(function (kind) {
      if (kind.key === 'main') return null;
      var text = groups.filter(function (g) { return g.kind === kind.key; })
        .map(function (g) {
          var tutor = TS.store.getTutor(g.tutorId);
          if (!tutor) return '';
          return labels[tutor.id] + ' ' + U.daysLabel(g.days) + ' ' +
            U.formatRange(g.startSlot, g.endSlot) + ' (' + (g.room || 'room TBA') + ')';
        }).filter(function (line) { return !!line; }).join('  ·  ');
      return text ? { label: kind.plural + ':', text: text } : null;
    }).filter(function (run) { return !!run; });
  }

  /* ---- the grid frame, shared by both calendars ----
   * The class view is page one's grid with different things standing in the
   * columns, so the day band, the wash, the hour rules and the dividers are
   * drawn from one place and the two pages cannot drift apart.
   */
  function drawGridFrame(pdf, g) {
    pdf.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.rect(g.margin, g.gridTop, g.pageW - g.margin * 2, g.headH, 'F');
    pdf.setFont('times', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(255, 255, 255);
    for (var d = 0; d < U.DAYS; d++) {
      pdf.text(U.DAY_NAMES[d], g.margin + g.gutterW + g.colW * d + g.colW / 2, g.gridTop + 11, { align: 'center' });
    }

    /* Every other day carries a faint wash. Where two days both run blocks to
     * their edges, the wash is what tells the eye which column it is reading.
     */
    for (var shade = 1; shade < U.DAYS; shade += 2) {
      pdf.setFillColor(TINT[0], TINT[1], TINT[2]);
      pdf.rect(g.margin + g.gutterW + g.colW * shade, g.bodyTop, g.colW, g.slotCount * g.rowH, 'F');
    }

    pdf.setLineWidth(0.4);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    for (var slot = g.win.start; slot <= g.win.end; slot++) {
      var y = g.bodyTop + (slot - g.win.start) * g.rowH;
      var onHour = U.slotStartMinutes(slot) % 60 === 0;
      pdf.setDrawColor.apply(pdf, onHour ? RULE : FAINT);
      pdf.line(g.margin + g.gutterW, y, g.pageW - g.margin, y);
      if (onHour || slot === g.win.end) {
        pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        pdf.text(U.formatMinutes(U.slotStartMinutes(slot)), g.margin + g.gutterW - 4, y + 3, { align: 'right' });
      }
    }
  }

  // Called after the blocks so the dividers sit over them: a heavy navy rule
  // down the full height of the grid, continued as a white rule through the
  // day-name band.
  function drawDayDividers(pdf, g) {
    var gridEnd = g.bodyTop + g.slotCount * g.rowH;
    for (var dv = 0; dv <= U.DAYS; dv++) {
      var x = g.margin + g.gutterW + g.colW * dv;
      pdf.setLineWidth(1.4);
      pdf.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
      pdf.line(x, g.bodyTop, x, gridEnd);
      if (dv > 0 && dv < U.DAYS) {
        pdf.setLineWidth(0.8);
        pdf.setDrawColor(255, 255, 255);
        pdf.line(x, g.gridTop + 2, x, g.gridTop + g.headH - 2);
      }
    }
    pdf.setLineWidth(0.8);
    pdf.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.line(g.margin + g.gutterW, gridEnd, g.pageW - g.margin, gridEnd);
  }

  /* ---- the week read by class ----
   * A tutor covers every class they signed up for at once, so one shift comes
   * out as a block under each of their classes. A student who only cares about
   * one class reads down its lane and ignores the rest of the page.
   */
  /* ---- what a calendar page draws inside its grid ----
   * The page around them is the same either way: header, notes, the band of
   * shifts held elsewhere, the QR block. Only the blocks and the legend that
   * decodes them tell the two calendars apart, so only those two are written
   * twice.
   */

  function drawTutorBlocks(pdf, state, labels, g) {
    var drawn = U.mainShifts(state.assignments);
    for (var day = 0; day < U.DAYS; day++) {
      var dayBlocks = drawn.filter(function (a) { return a.day === day; });
      var placement = TS.calendar.layoutDay(dayBlocks);

      dayBlocks.forEach(function (a) {
        var place = placement[a.id] || { lane: 0, lanes: 1 };
        var tutor = TS.store.getTutor(a.tutorId);
        if (!tutor) return;

        var colors = U.blockColors(tutor.colorIndex, false);
        var bg = U.hexToRgb(colors.bg);
        var bar = U.hexToRgb(colors.bar);
        var laneW = (g.colW - DAY_PAD * 2) / place.lanes;
        var bx = g.margin + g.gutterW + g.colW * day + DAY_PAD + laneW * place.lane + 1;
        var by = g.bodyTop + (a.startSlot - g.win.start) * g.rowH + 0.5;
        var bw = laneW - 2;
        var bh = (a.endSlot - a.startSlot) * g.rowH - 1;

        pdf.setFillColor(bg[0], bg[1], bg[2]);
        pdf.setDrawColor(107, 119, 137);
        pdf.setLineWidth(0.4);
        pdf.rect(bx, by, bw, bh, 'FD');
        pdf.setFillColor(bar[0], bar[1], bar[2]);
        pdf.rect(bx, by, 3, bh, 'F');

        var textX = bx + 6;
        var textW = bw - 8;
        pdf.setTextColor(INK[0], INK[1], INK[2]);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.text(truncate(pdf, labels[tutor.id], textW), textX, by + 8);

        if (bh > 20) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(6);
          pdf.text(truncate(pdf, U.formatRange(a.startSlot, a.endSlot), textW), textX, by + 16);
        }
        if (bh > 28) {
          var shorts = U.maskToShort(U.subjectMask(tutor.subjects)).join(' · ') || '—';
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(6);
          pdf.text(truncate(pdf, shorts, textW), textX, by + 24);
        }
      });
    }
  }

  /* One lane per group of classes covered that day, in the order the class list
   * gives, so a class keeps its place across the week. A tutor teaching several
   * classes covers them all at once and so appears in several lanes -- that is
   * the page, not double counting.
   */
  function drawClassBlocks(pdf, state, labels, g) {
    var runs = U.coverageRuns(state.assignments, state.tutors);
    var allLanes = U.coverageLanes();

    for (var day = 0; day < U.DAYS; day++) {
      var dayRuns = runs.filter(function (run) { return run.day === day; });
      if (!dayRuns.length) continue;

      var lanes = [];
      dayRuns.forEach(function (run) {
        if (lanes.indexOf(run.lane) === -1) lanes.push(run.lane);
      });
      lanes.sort(function (a, b) { return a - b; });

      dayRuns.forEach(function (run) {
        var colors = U.laneColors(allLanes[run.lane], false);
        var bg = U.hexToRgb(colors.bg);
        var bar = U.hexToRgb(colors.bar);
        var laneW = (g.colW - DAY_PAD * 2) / lanes.length;
        var bx = g.margin + g.gutterW + g.colW * day + DAY_PAD +
          laneW * lanes.indexOf(run.lane) + 1;
        var by = g.bodyTop + (run.startSlot - g.win.start) * g.rowH + 0.5;
        var bw = laneW - 2;
        var bh = (run.endSlot - run.startSlot) * g.rowH - 1;

        pdf.setFillColor(bg[0], bg[1], bg[2]);
        pdf.setDrawColor(107, 119, 137);
        pdf.setLineWidth(0.4);
        pdf.rect(bx, by, bw, bh, 'FD');
        pdf.setFillColor(bar[0], bar[1], bar[2]);
        pdf.rect(bx, by, 3, bh, 'F');

        // A lane here can be a third of a day column rather than a half, so the
        // text starts a shade closer in -- two points is the difference between
        // MICRO fitting and MICRO being cut to an ellipsis.
        var textX = bx + 5;
        var textW = bw - 6;
        pdf.setTextColor(INK[0], INK[1], INK[2]);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.text(truncate(pdf, run.label, textW), textX, by + 8);

        if (bh > 20) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(6);
          pdf.text(fitRange(pdf, run.startSlot, run.endSlot, textW), textX, by + 16);
        }
        if (bh > 28) {
          var who = run.tutorIds.map(function (id) {
            var tutor = TS.store.getTutor(id);
            return tutor ? labels[tutor.id] : '';
          }).filter(function (name) { return !!name; }).sort();

          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(6);
          var lines = pdf.splitTextToSize(who.join(', ') || 'unstaffed', textW);
          var room = Math.floor((bh - 20) / 7);
          lines.slice(0, Math.max(0, room)).forEach(function (line, i) {
            pdf.text(line, textX, by + 24 + i * 7);
          });
        }
      });
    }
  }

  /* The times are the first thing to go when a lane is narrow, but an ellipsis
   * says less than a shorter truth: the range gives way to the start time, and
   * the start time to its bare clock reading, before anything is cut.
   */
  function fitRange(pdf, startSlot, endSlot, width) {
    var full = U.formatRange(startSlot, endSlot);
    if (pdf.getTextWidth(full) <= width) return full;
    var from = U.formatMinutes(U.slotStartMinutes(startSlot));
    if (pdf.getTextWidth(from) <= width) return from;
    return truncate(pdf, U.formatMinutes(U.slotStartMinutes(startSlot), { omitSuffix: true }), width);
  }

  function drawTutorLegend(pdf, state, labels, legendX, legendY) {
    pdf.setFontSize(7);
    state.tutors.forEach(function (t, i) {
      var col = Math.floor(i / 4);
      var rowI = i % 4;
      var lx = legendX + col * 130;
      var ly = legendY + rowI * 12;
      var colors = U.blockColors(t.colorIndex, false);
      var bg = U.hexToRgb(colors.bg);
      var bar = U.hexToRgb(colors.bar);

      pdf.setFillColor(bg[0], bg[1], bg[2]);
      pdf.setDrawColor(107, 119, 137);
      pdf.setLineWidth(0.3);
      pdf.rect(lx, ly - 6, 16, 8, 'FD');
      pdf.setFillColor(bar[0], bar[1], bar[2]);
      pdf.rect(lx, ly - 6, 3, 8, 'F');

      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      pdf.text(truncate(pdf, labels[t.id], 60), lx + 20, ly);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text(
        truncate(pdf, U.maskToShort(U.subjectMask(t.subjects)).join(' · ') || '—', 46),
        lx + 20 + 62, ly
      );
    });
  }

  /* Wider columns than the tutor legend, because a class name is longer than a
   * first name and there are only ever a handful of them.
   */
  function drawClassLegend(pdf, state, legendX, legendY) {
    var lanes = U.coverageLanes();
    var totals = U.coverageLaneHours(U.coverageRuns(state.assignments, state.tutors));
    pdf.setFontSize(7);
    lanes.forEach(function (lane, i) {
      var col = Math.floor(i / 4);
      var rowI = i % 4;
      var lx = legendX + col * 175;
      var ly = legendY + rowI * 12;
      var colors = U.laneColors(lane, false);
      var bg = U.hexToRgb(colors.bg);
      var bar = U.hexToRgb(colors.bar);

      pdf.setFillColor(bg[0], bg[1], bg[2]);
      pdf.setDrawColor(107, 119, 137);
      pdf.setLineWidth(0.3);
      pdf.rect(lx, ly - 6, 16, 8, 'FD');
      pdf.setFillColor(bar[0], bar[1], bar[2]);
      pdf.rect(lx, ly - 6, 3, 8, 'F');

      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      pdf.text(truncate(pdf, U.laneLabel(lane), 100), lx + 20, ly);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text(truncate(pdf, U.hoursLabel(totals[i]) + ' a week', 48), lx + 20 + 105, ly);
    });
  }

  function drawListing(pdf, state, labels, pageW, pageH, margin) {
    var y2 = margin + 14;
    pdf.setFont('times', 'bold');
    pdf.setFontSize(15);
    pdf.setTextColor(0, 40, 85);
    pdf.text('Schedule listing', margin, y2);
    y2 += 8;

    pdf.setFontSize(9);
    var anyRows = false;
    for (var dl = 0; dl < U.DAYS; dl++) {
      var blocks = state.assignments
        .filter(function (a) { return a.day === dl; })
        .sort(function (a, b) { return a.startSlot - b.startSlot; });
      if (!blocks.length) continue;
      anyRows = true;

      y2 += 16;
      if (y2 > pageH - margin - 20) { pdf.addPage(); y2 = margin + 20; }
      pdf.setFont('times', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(0, 40, 85);
      pdf.text(U.DAY_NAMES[dl], margin, y2);
      pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
      pdf.line(margin, y2 + 3, pageW - margin, y2 + 3);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      blocks.forEach(function (a) {
        var tutor = TS.store.getTutor(a.tutorId);
        y2 += 12;
        if (y2 > pageH - margin - 10) { pdf.addPage(); y2 = margin + 20; }
        pdf.text(
          labels[tutor.id] + ', ' + U.formatRange(a.startSlot, a.endSlot) + ' — ' +
          (U.maskToLabels(U.subjectMask(tutor.subjects)).join(', ') || 'no classes assigned') +
          (U.offRoom(a)
            ? ' (' + U.shiftKind(a.kind).label.toLowerCase() + ', ' + (a.room || 'room TBA') + ')'
            : ''),
          margin + 8, y2
        );
      });
    }
    if (!anyRows) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      pdf.text('No shifts are scheduled yet.', margin, y2 + 18);
    }
  }

  // Building and saving are separate so the document can be inspected without
  // triggering a download.
  function build(state) {
    if (!available()) {
      throw new Error('The PDF library did not load. Use Print / Save as PDF instead.');
    }

    var s = state.settings;
    var labels = U.displayNames(state.tutors);
    var pdf = new root.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });

    pdf.setProperties({
      title: s.title + (s.term ? ' — ' + s.term : ''),
      subject: 'Weekly tutoring schedule, ' + s.location,
      author: s.contactName,
      creator: 'Chatt State Tutor Scheduler ' + U.VERSION
    });
    if (pdf.setLanguage) pdf.setLanguage('en-US');

    var pageW = pdf.internal.pageSize.getWidth();
    var pageH = pdf.internal.pageSize.getHeight();
    var margin = 28;

    drawCalendarPage(pdf, state, labels, pageW, pageH, margin, false);

    /* ---- page 2: the text listing ---- */
    pdf.addPage();
    drawListing(pdf, state, labels, pageW, pageH, margin);

    /* ---- page 3: the same handout, with the week read by class ---- */
    pdf.addPage();
    drawCalendarPage(pdf, state, labels, pageW, pageH, margin, true);

    /* ---- page 4: the listing again, backing the class calendar ---- */
    pdf.addPage();
    drawListing(pdf, state, labels, pageW, pageH, margin);

    var name = 'life-science-tutor-schedule' +
      (s.term ? '-' + s.term.replace(/\s+/g, '-').toLowerCase() : '') + '.pdf';
    return { pdf: pdf, filename: name };
  }

  /* A whole handout page: the header, the week, the band of shifts held
   * elsewhere, the notes and the QR block. `byClass` swaps the grid for the
   * class-centric reading of the same week and the legend along with it, and
   * changes nothing else -- the two pages are meant to be twins.
   */
  function drawCalendarPage(pdf, state, labels, pageW, pageH, margin, byClass) {
    var s = state.settings;

    /* ---- header ---- */
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.text('CHATTANOOGA STATE COMMUNITY COLLEGE', margin, margin + 6);

    pdf.setFont('times', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(0, 40, 85);
    pdf.text(s.title, margin, margin + 26);

    var whereY = margin + 40;
    if (s.term) {
      pdf.setFont('times', 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      pdf.text(s.term, margin, whereY);
      whereY += 12;
    }
    if (s.effective) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text(s.effective, margin, whereY);
      whereY += 11;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(INK[0], INK[1], INK[2]);
    pdf.text(s.location, margin, whereY);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    if (s.contactName) pdf.text(s.contactName, pageW - margin, margin + 14, { align: 'right' });
    if (s.contactEmail) {
      pdf.text(s.contactEmail, pageW - margin, (s.contactName ? margin + 25 : margin + 14),
        { align: 'right' });
    }

    pdf.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    pdf.setLineWidth(2);
    pdf.line(margin, whereY + 7, pageW - margin, whereY + 7);

    /* ---- grid geometry ---- */
    // The grid is the tutoring center; embedded classes and open labs are
    // listed in their own band under it.
    var drawn = U.mainShifts(state.assignments);
    var win = U.scheduleWindow(drawn);
    var slotCount = win.end - win.start;

    var gridTop = whereY + 18;
    // The notes band is measured before the grid is laid out, so a long note
    // shortens the grid rather than running off the page. The band of shifts
    // held elsewhere is measured the same way, for the same reason.
    var noteLines = s.notes
      ? pdf.splitTextToSize(s.notes, pageW - margin * 2 - 12)
      : [];
    var noteH = noteLines.length ? 16 + noteLines.length * 9 : 0;

    // The label column is as wide as the widest kind name, so the entries of
    // both runs line up whatever the kinds are called.
    var offRuns = offRoomRuns(state, labels);
    pdf.setFont('times', 'bold');
    pdf.setFontSize(9);
    var offLabelW = 0;
    offRuns.forEach(function (run) {
      offLabelW = Math.max(offLabelW, pdf.getTextWidth(run.label) + 8);
    });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    var offRowCount = 0;
    offRuns.forEach(function (run) {
      run.lines = pdf.splitTextToSize(run.text, pageW - margin * 2 - offLabelW);
      offRowCount += run.lines.length;
    });
    var offH = offRowCount ? 14 + offRowCount * 9 : 0;

    var footH = 92 + noteH + offH;
    var gridBottom = pageH - margin - footH;
    var headH = 15;
    var gutterW = 44;
    var colW = (pageW - margin * 2 - gutterW) / U.DAYS;
    var rowH = (gridBottom - gridTop - headH) / slotCount;
    var bodyTop = gridTop + headH;

    var geom = {
      pageW: pageW, margin: margin, gridTop: gridTop, headH: headH, gutterW: gutterW,
      colW: colW, bodyTop: bodyTop, rowH: rowH, win: win, slotCount: slotCount
    };

    /* ---- day columns, hour lines and times ---- */
    drawGridFrame(pdf, geom);

    /* ---- blocks ----
     * The one place the two calendars differ, along with the legend that
     * decodes them. Everything else on the page is the same either way.
     */
    if (byClass) drawClassBlocks(pdf, state, labels, geom);
    else drawTutorBlocks(pdf, state, labels, geom);

    /* ---- day dividers ---- */
    var gridEnd = bodyTop + slotCount * rowH;
    drawDayDividers(pdf, geom);

    /* ---- floating embedded tutors & open labs ---- */
    if (offRowCount) {
      var offY = gridEnd + 17;
      offRuns.forEach(function (run) {
        pdf.setFont('times', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(0, 40, 85);
        pdf.text(run.label, margin, offY);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(INK[0], INK[1], INK[2]);
        run.lines.forEach(function (line, i) {
          pdf.text(line, margin + offLabelW, offY + i * 9);
        });
        offY += run.lines.length * 9;
      });
    }

    /* ---- important notes ---- */
    if (noteLines.length) {
      var noteTop = gridEnd + 10 + offH;
      pdf.setFillColor(252, 250, 247);
      pdf.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
      pdf.setLineWidth(0.5);
      pdf.rect(margin, noteTop, pageW - margin * 2, noteH - 6, 'FD');
      pdf.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]);
      pdf.rect(margin, noteTop, 3, noteH - 6, 'F');

      pdf.setFont('times', 'bold');
      pdf.setFontSize(9.5);
      pdf.setTextColor(0, 40, 85);
      pdf.text('Important notes', margin + 9, noteTop + 11);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      noteLines.forEach(function (line, i) {
        pdf.text(line, margin + 9, noteTop + 22 + i * 9);
      });
    }

    /* ---- footer: QR, url, legend ---- */
    var footY = gridBottom + 12 + noteH + offH;
    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    pdf.setLineWidth(0.6);
    pdf.line(margin, footY - 8, pageW - margin, footY - 8);

    drawQr(pdf, s.qrUrl, margin + 3, footY, 58);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(INK[0], INK[1], INK[2]);
    pdf.text('Need help outside these hours?', margin + 72, footY + 10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(s.qrCaption, margin + 72, footY + 21);
    pdf.setFont('helvetica', 'bold');
    pdf.text(s.qrUrl, margin + 72, footY + 32);

    var legendX = margin + 260;
    var legendY = footY + 6;
    if (byClass) drawClassLegend(pdf, state, legendX, legendY);
    else drawTutorLegend(pdf, state, labels, legendX, legendY);
  }

  function download(state) {
    var built = build(state);
    built.pdf.save(built.filename);
    return built;
  }

  TS.pdf = { build: build, download: download, available: available, drawQr: drawQr };
})(typeof window !== 'undefined' ? window : globalThis);
