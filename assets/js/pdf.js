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
  function drawClassPage(pdf, state, labels, pageW, pageH, margin) {
    pdf.setFont('times', 'bold');
    pdf.setFontSize(15);
    pdf.setTextColor(0, 40, 85);
    pdf.text('Coverage by class', margin, margin + 14);

    var runs = U.subjectRuns(state.assignments, state.tutors);
    if (!runs.length) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      pdf.text('No class is covered yet.', margin, margin + 36);
      return;
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text('One lane per class, with everyone who may be in during that run. ' +
      'A tutor covers all of their classes at once, so the same shift appears under each of them.',
      margin, margin + 26);

    pdf.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    pdf.setLineWidth(2);
    pdf.line(margin, margin + 34, pageW - margin, margin + 34);

    var totals = U.subjectSlotTotals(runs);
    var covered = [];
    for (var i = 0; i < U.SUBJECTS.length; i++) {
      if (totals[i] > 0) covered.push(i);
    }

    // The legend is measured before the grid is laid out, for the reason the
    // notes band is on page one: another class shortens the grid rather than
    // running off the foot of the page.
    var legendRows = Math.min(4, covered.length);
    var legendH = 26 + legendRows * 12;

    var win = U.scheduleWindow(U.mainShifts(state.assignments));
    var slotCount = win.end - win.start;
    var gridTop = margin + 44;
    var gridBottom = pageH - margin - legendH;
    var headH = 15;
    var gutterW = 44;
    var colW = (pageW - margin * 2 - gutterW) / U.DAYS;
    var DAY_PAD = 3;
    var rowH = (gridBottom - gridTop - headH) / slotCount;
    var bodyTop = gridTop + headH;
    var geom = {
      pageW: pageW, margin: margin, gridTop: gridTop, headH: headH, gutterW: gutterW,
      colW: colW, bodyTop: bodyTop, rowH: rowH, win: win, slotCount: slotCount
    };

    drawGridFrame(pdf, geom);

    /* ---- blocks ---- */
    for (var day = 0; day < U.DAYS; day++) {
      var dayRuns = runs.filter(function (r) { return r.day === day; });
      if (!dayRuns.length) continue;

      // Lanes follow the order of the class list rather than the order the day
      // happens to fill up in, so a class keeps its place across the week.
      var lanes = [];
      dayRuns.forEach(function (r) {
        if (lanes.indexOf(r.subject) === -1) lanes.push(r.subject);
      });
      lanes.sort(function (a, b) { return a - b; });
      var laneW = (colW - DAY_PAD * 2) / lanes.length;

      dayRuns.forEach(function (r) {
        var colors = U.subjectColors(r.subject, false);
        var bg = U.hexToRgb(colors.bg);
        var bar = U.hexToRgb(colors.bar);
        var bx = margin + gutterW + colW * day + DAY_PAD + laneW * lanes.indexOf(r.subject) + 1;
        var by = bodyTop + (r.startSlot - win.start) * rowH + 0.5;
        var bw = laneW - 2;
        var bh = (r.endSlot - r.startSlot) * rowH - 1;

        pdf.setFillColor(bg[0], bg[1], bg[2]);
        pdf.setDrawColor(107, 119, 137);
        pdf.setLineWidth(0.4);
        pdf.rect(bx, by, bw, bh, 'FD');
        pdf.setFillColor(bar[0], bar[1], bar[2]);
        pdf.rect(bx, by, 3, bh, 'F');

        // A hair tighter than page one, which never has to fit four lanes in
        // a column; the two points buy a short code that would not otherwise
        // clear the ellipsis.
        var textX = bx + 5;
        var textW = bw - 6;
        pdf.setTextColor(INK[0], INK[1], INK[2]);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.text(truncate(pdf, U.SUBJECTS[r.subject].short, textW), textX, by + 8);

        if (bh > 20) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(6);
          /* A four-lane day cannot hold "10:00 AM–12:00 PM", and "10:00 …" says
           * less than a bare start time does, so the stamp gives up the end,
           * then the AM/PM, before it gives up characters. The block's height
           * shows how long the run is, and the hour gutter down the left says
           * which half of the day it is in.
           */
          var startMin = U.slotStartMinutes(r.startSlot);
          var stamps = [
            U.formatRange(r.startSlot, r.endSlot),
            U.formatMinutes(startMin),
            U.formatMinutes(startMin, { omitSuffix: true })
          ];
          var stamp = stamps[stamps.length - 1];
          for (var si = 0; si < stamps.length; si++) {
            if (pdf.getTextWidth(stamps[si]) <= textW) { stamp = stamps[si]; break; }
          }
          pdf.text(truncate(pdf, stamp, textW), textX, by + 16);
        }
        if (bh > 28) {
          // Four classes on a day leave the lanes narrow, so the names wrap
          // down the block and stop at its foot instead of being crammed on
          // one line. Sorted, so the same people always read the same way.
          var names = r.tutorIds.map(function (id) {
            var tutor = TS.store.getTutor(id);
            return tutor ? labels[tutor.id] : '';
          }).filter(function (n) { return !!n; }).sort();

          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(6);
          var lines = pdf.splitTextToSize(names.join(', '), textW);
          var room = Math.floor((bh - 20) / 7);
          for (var li = 0; li < lines.length && li < room; li++) {
            pdf.text(truncate(pdf, lines[li], textW), textX, by + 24 + li * 7);
          }
        }
      });
    }

    drawDayDividers(pdf, geom);

    /* ---- legend: the classes, and how much of each is on offer ---- */
    var legendTop = bodyTop + slotCount * rowH + 22;
    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    pdf.setLineWidth(0.6);
    pdf.line(margin, legendTop - 14, pageW - margin, legendTop - 14);

    // Four to a column, and the columns close up if a centre runs enough
    // classes to need more than two of them, so the hours never slide off the
    // right-hand edge.
    var legendPitch = Math.min(190, (pageW - margin * 2) / Math.ceil(covered.length / 4));

    pdf.setFontSize(7);
    covered.forEach(function (subject, n) {
      var col = Math.floor(n / 4);
      var rowI = n % 4;
      var lx = margin + col * legendPitch;
      var ly = legendTop + rowI * 12;
      var colors = U.subjectColors(subject, false);
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
      pdf.text(truncate(pdf, U.SUBJECTS[subject].short, 30), lx + 20, ly);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text(truncate(pdf, U.SUBJECTS[subject].label, 96), lx + 20 + 32, ly);
      pdf.text(U.hoursLabel(totals[subject]) + ' a week', lx + 20 + 132, ly);
    });
  }

  /* ---- the text listing ----
   * Drawn twice: once behind each calendar, so a double-sided print gives
   * every sheet a calendar on one face and the listing on the other.
   */
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
    // Blocks stop short of the column edge, so a day's shifts never touch the
    // next day's divider.
    var DAY_PAD = 3;
    var rowH = (gridBottom - gridTop - headH) / slotCount;
    var bodyTop = gridTop + headH;

    var geom = {
      pageW: pageW, margin: margin, gridTop: gridTop, headH: headH, gutterW: gutterW,
      colW: colW, bodyTop: bodyTop, rowH: rowH, win: win, slotCount: slotCount
    };

    /* ---- day columns, hour lines and times ---- */
    drawGridFrame(pdf, geom);

    /* ---- blocks ---- */
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
        var laneW = (colW - DAY_PAD * 2) / place.lanes;
        var bx = margin + gutterW + colW * day + DAY_PAD + laneW * place.lane + 1;
        var by = bodyTop + (a.startSlot - win.start) * rowH + 0.5;
        var bw = laneW - 2;
        var bh = (a.endSlot - a.startSlot) * rowH - 1;

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

    /* ---- page 2: the text listing ---- */
    pdf.addPage();
    drawListing(pdf, state, labels, pageW, pageH, margin);

    /* ---- page 3: the same week, read by class ---- */
    pdf.addPage();
    drawClassPage(pdf, state, labels, pageW, pageH, margin);

    /* ---- page 4: the listing again, backing the class calendar ---- */
    pdf.addPage();
    drawListing(pdf, state, labels, pageW, pageH, margin);

    var name = 'life-science-tutor-schedule' +
      (s.term ? '-' + s.term.replace(/\s+/g, '-').toLowerCase() : '') + '.pdf';
    return { pdf: pdf, filename: name };
  }

  function download(state) {
    var built = build(state);
    built.pdf.save(built.filename);
    return built;
  }

  TS.pdf = { build: build, download: download, available: available, drawQr: drawQr };
})(typeof window !== 'undefined' ? window : globalThis);
