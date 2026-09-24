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
    var code = TS.qr.runs(text);
    if (!code) return;
    var cell = size / code.count;

    pdf.setFillColor(255, 255, 255);
    pdf.rect(x - 3, y - 3, size + 6, size + 6, 'F');
    pdf.setFillColor(0, 0, 0);
    code.runs.forEach(function (run) {
      pdf.rect(x + run[1] * cell, y + run[0] * cell, run[2] * cell, cell, 'F');
    });
  }

  /* A block's box, in either calendar: the tinted fill, a thin border, and
   * the solid bar down its left edge that carries the colour in greyscale. */
  function drawBlockBox(pdf, colors, bx, by, bw, bh) {
    var bg = U.hexToRgb(colors.bg);
    var bar = U.hexToRgb(colors.bar);
    pdf.setFillColor(bg[0], bg[1], bg[2]);
    pdf.setDrawColor(107, 119, 137);
    pdf.setLineWidth(0.4);
    pdf.rect(bx, by, bw, bh, 'FD');
    pdf.setFillColor(bar[0], bar[1], bar[2]);
    pdf.rect(bx, by, 3, bh, 'F');
  }

  // The same thing in miniature, for a legend entry.
  function drawSwatch(pdf, colors, x, y) {
    var bg = U.hexToRgb(colors.bg);
    var bar = U.hexToRgb(colors.bar);
    pdf.setFillColor(bg[0], bg[1], bg[2]);
    pdf.setDrawColor(107, 119, 137);
    pdf.setLineWidth(0.3);
    pdf.rect(x, y - 6, 16, 8, 'FD');
    pdf.setFillColor(bar[0], bar[1], bar[2]);
    pdf.rect(x, y - 6, 3, 8, 'F');
  }

  /* A portrait day column split three ways is narrow, and a name cut to
   * "Natha..." is no name at all: the text steps down through `sizes` until it
   * fits, and is only cut short at the smallest. Leaves the font at that size.
   */
  /* The sizes a block's text starts at, then the ones it steps down to where a
   * lane is too narrow for it: first the size the handout used before its text
   * was enlarged, then one smaller still. */
  var NAME_PT = [8.5, 7.5, 6.5];   // a tutor's name, bold
  var CODE_PT = [8.5, 7.5, 6.5, 6]; // a class code, bold
  var SMALL_PT = [7, 6, 5.5];       // times, class lists and the names in a class block

  function fitText(pdf, text, width, sizes) {
    for (var i = 0; i < sizes.length; i++) {
      pdf.setFontSize(sizes[i]);
      if (pdf.getTextWidth(text) <= width) return text;
    }
    return truncate(pdf, text, width);
  }

  /* Each kind held somewhere other than the center, as one labelled run of
   * text. The same footnote the old handouts carried, and cheap enough on a
   * crowded page: "Floating Embedded Tutors: Bailey Tue & Thu 12:30-2:00 PM
   * (OMN 286)".
   */
  function offRoomRuns(state, labels) {
    var groups = U.groupOffRoom(state.assignments, labels);
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
    pdf.setFontSize(11);
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
    pdf.setFontSize(7.5);
    for (var slot = g.win.start; slot <= g.win.end; slot++) {
      var y = g.bodyTop + (slot - g.win.start) * g.rowH;
      var onHour = U.slotStartMinutes(slot) % 60 === 0;
      pdf.setDrawColor.apply(pdf, onHour ? RULE : FAINT);
      pdf.line(g.margin + g.gutterW, y, g.pageW - g.margin, y);
      if (onHour || slot === g.win.end) {
        pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        // The first label sits just under its line, where the day band above
        // would otherwise cover it.
        pdf.text(U.formatMinutes(U.slotStartMinutes(slot)), g.margin + g.gutterW - 4,
          slot === g.win.start ? y + 7 : y + 3, { align: 'right' });
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

        var laneW = (g.colW - DAY_PAD * 2) / place.lanes;
        var bx = g.margin + g.gutterW + g.colW * day + DAY_PAD + laneW * place.lane + 1;
        var by = g.bodyTop + (a.startSlot - g.win.start) * g.rowH + 0.5;
        var bw = laneW - 2;
        var bh = (a.endSlot - a.startSlot) * g.rowH - 1;
        drawBlockBox(pdf, U.blockColors(tutor.colorIndex, false), bx, by, bw, bh);

        var textX = bx + 6;
        var textW = bw - 8;
        pdf.setTextColor(INK[0], INK[1], INK[2]);
        pdf.setFont('helvetica', 'bold');
        pdf.text(fitText(pdf, labels[tutor.id], textW, NAME_PT), textX, by + 9);

        if (bh > 22) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(SMALL_PT[0]);
          pdf.text(fitRange(pdf, a.startSlot, a.endSlot, textW), textX, by + 17.5);
        }
        if (bh > 30) {
          var shorts = U.maskToShort(U.subjectMask(tutor.subjects)).join(' · ') || '—';
          pdf.setFont('helvetica', 'bold');
          pdf.text(fitText(pdf, shorts, textW, SMALL_PT), textX, by + 26);
        }
      });
    }
  }

  /* The week read by class: one lane per group of classes covered that day, in
   * the order the class list gives, so a class keeps its place across the week.
   * A tutor teaching several classes covers them all at once and so appears in
   * several lanes -- that is the page, not double counting. A student who only
   * cares about one class reads down its lane and ignores the rest.
   */
  function drawClassBlocks(pdf, state, labels, g) {
    var runs = U.coverageRuns(state.assignments, state.tutors);

    for (var day = 0; day < U.DAYS; day++) {
      var dayRuns = runs.filter(function (run) { return run.day === day; });
      if (!dayRuns.length) continue;

      var lanes = [];
      dayRuns.forEach(function (run) {
        if (lanes.indexOf(run.lane) === -1) lanes.push(run.lane);
      });
      lanes.sort(function (a, b) { return a - b; });

      dayRuns.forEach(function (run) {
        var laneW = (g.colW - DAY_PAD * 2) / lanes.length;
        var bx = g.margin + g.gutterW + g.colW * day + DAY_PAD +
          laneW * lanes.indexOf(run.lane) + 1;
        var by = g.bodyTop + (run.startSlot - g.win.start) * g.rowH + 0.5;
        var bw = laneW - 2;
        var bh = (run.endSlot - run.startSlot) * g.rowH - 1;
        drawBlockBox(pdf, U.coverageColors(run, false), bx, by, bw, bh);

        // A lane here can be a third of a day column rather than a half, so the
        // text starts a shade closer in -- two points is the difference between
        // MICRO fitting and MICRO being cut to an ellipsis.
        var textX = bx + 5;
        var textW = bw - 6;
        pdf.setTextColor(INK[0], INK[1], INK[2]);
        pdf.setFont('helvetica', 'bold');
        pdf.text(fitText(pdf, run.label, textW, CODE_PT), textX, by + 9);

        // The first stretch starts under the class code; the rest under
        // their rule.
        var place = function (seg, i) {
          var segTop = g.bodyTop + (seg.startSlot - g.win.start) * g.rowH + 0.5;
          return {
            rule: segTop,
            top: i === 0 ? by + 18 : segTop + 8,
            bottom: g.bodyTop + (seg.endSlot - g.win.start) * g.rowH - 0.5
          };
        };
        var merged = U.mergeCrampedSegments(run.segments, function (seg, i) {
          var at = place(seg, i);
          return segmentLines(pdf, seg, labels, textW, at.top, at.bottom).fits;
        });
        merged.forEach(function (seg, i) {
          var at = place(seg, i);
          if (i > 0) {
            pdf.setDrawColor(150, 158, 170);
            pdf.setLineWidth(0.3);
            pdf.line(bx + 3.5, at.rule, bx + bw, at.rule);
          }
          drawSegmentText(pdf, seg, labels, textX, at.top, textW, at.bottom);
        });
      });
    }
  }

  /* One stretch of a class block with the same tutors in it: who, then its
   * hours, both in the block's plain small type. The page is about the class,
   * so the time claims its lines first -- whole, broken after the dash
   * ("9:00 AM-" over "4:00 PM") when there is room for that, or shortened to
   * one line -- and the names wrap into whatever is left above it, cut with
   * an ellipsis or left out when there is nothing left.
   */
  var SEG_LINE = 8;

  // What a stretch would print, and whether every name in it fits.
  function segmentLines(pdf, seg, labels, width, top, bottom) {
    var room = Math.max(0, Math.floor((bottom - top + SEG_LINE - 1) / SEG_LINE));
    var who = U.sortedNames(seg.tutorIds.map(function (id) {
      var tutor = TS.store.getTutor(id);
      return tutor ? labels[tutor.id] : '';
    }));

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(SMALL_PT[0]);

    var range = U.formatRange(seg.startSlot, seg.endSlot);
    var dash = range.indexOf('–');
    var timeLines = !room ? []
      : pdf.getTextWidth(range) <= width ? [range]
      : room >= 3 && dash !== -1 && pdf.getTextWidth(range.slice(0, dash + 1)) <= width &&
          pdf.getTextWidth(range.slice(dash + 1)) <= width
        ? [range.slice(0, dash + 1), range.slice(dash + 1)]
        : [fitRange(pdf, seg.startSlot, seg.endSlot, width)];
    var timePt = pdf.getFontSize();

    var nameRoom = room - timeLines.length;
    // A name too wide for the lane at full size is set smaller rather than
    // broken in two: the size the handout used before, then one smaller.
    var text = who.join(', ') || 'unstaffed';
    var namePt = SMALL_PT[SMALL_PT.length - 1];
    for (var k = 0; k < SMALL_PT.length; k++) {
      pdf.setFontSize(SMALL_PT[k]);
      var fitsLane = text.split(' ').every(function (w) { return pdf.getTextWidth(w) <= width; });
      if (fitsLane) { namePt = SMALL_PT[k]; break; }
    }
    pdf.setFontSize(namePt);
    var names = pdf.splitTextToSize(text, width);
    var fits = names.length <= nameRoom;
    if (!fits) {
      names = names.slice(0, Math.max(0, nameRoom));
      if (nameRoom > 0) names[nameRoom - 1] = truncate(pdf, names[nameRoom - 1] + '…', width);
    }
    return { names: names, times: timeLines, namePt: namePt, timePt: timePt, fits: fits };
  }

  function drawSegmentText(pdf, seg, labels, x, top, width, bottom) {
    var fit = segmentLines(pdf, seg, labels, width, top, bottom);
    pdf.setTextColor(INK[0], INK[1], INK[2]);
    pdf.setFontSize(fit.namePt);
    fit.names.forEach(function (line, i) {
      pdf.text(line, x, top + i * SEG_LINE);
    });
    pdf.setFontSize(fit.timePt);
    fit.times.forEach(function (line, i) {
      pdf.text(line, x, top + (fit.names.length + i) * SEG_LINE);
    });
  }

  /* The times are the first thing to go when a lane is narrow, but an ellipsis
   * says less than a shorter truth: the range gives way to its spoken form,
   * "9-12", then to the start time, and that to its bare clock reading, before
   * anything is cut.
   */
  function fitRange(pdf, startSlot, endSlot, width) {
    var full = U.formatRange(startSlot, endSlot);
    if (pdf.getTextWidth(full) <= width) return full;
    // The short form, stepping down a size or two before the end time goes.
    var compact = U.formatRangeCompact(startSlot, endSlot);
    var start = pdf.getFontSize();
    var sizes = [start].concat(SMALL_PT.filter(function (pt) { return pt < start; }));
    for (var i = 0; i < sizes.length; i++) {
      pdf.setFontSize(sizes[i]);
      if (pdf.getTextWidth(compact) <= width) return compact;
    }
    pdf.setFontSize(start);
    var from = U.formatMinutes(U.slotStartMinutes(startSlot));
    if (pdf.getTextWidth(from) <= width) return from;
    return truncate(pdf, U.formatMinutes(U.slotStartMinutes(startSlot), { omitSuffix: true }), width);
  }

  /* A legend reads down columns of four, as many columns as the roster needs.
   * Where the space beside the QR block is too narrow for that -- a portrait
   * page -- the columns run deeper and, failing that, narrower, so the legend
   * stays on the page. */
  function legendGrid(count, width, minW, maxW) {
    var fit = Math.max(1, Math.floor(width / minW));
    var rows = count <= fit * 4 ? 4 : Math.min(6, Math.ceil(count / fit));
    var cols = Math.max(1, Math.ceil(count / rows));
    return { rows: rows, colW: Math.min(maxW, width / cols) };
  }

  function drawTutorLegend(pdf, state, labels, legendX, legendY, width) {
    var grid = legendGrid(state.tutors.length, width, 140, 170);
    pdf.setFontSize(8);
    // The class list starts just past the longest name, so it has the rest of
    // the column.
    pdf.setFont('helvetica', 'bold');
    var nameW = Math.min(66, Math.max.apply(null, state.tutors.map(function (t) {
      return pdf.getTextWidth(labels[t.id]);
    }).concat([0])));
    state.tutors.forEach(function (t, i) {
      var lx = legendX + Math.floor(i / grid.rows) * grid.colW;
      var ly = legendY + (i % grid.rows) * 13;
      drawSwatch(pdf, U.blockColors(t.colorIndex, false), lx, ly);

      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      pdf.text(truncate(pdf, labels[t.id], nameW), lx + 20, ly);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text(
        truncate(pdf, U.maskToShort(U.subjectMask(t.subjects)).join(' · ') || '—', grid.colW - 30 - nameW),
        lx + 28 + nameW, ly
      );
    });
  }

  /* Wider columns than the tutor legend, because a class name is longer than a
   * first name and there are only ever a handful of them.
   */
  function drawClassLegend(pdf, state, legendX, legendY, width) {
    var lanes = U.coverageLanes();
    var totals = U.coverageLaneHours(U.coverageRuns(state.assignments, state.tutors));
    var grid = legendGrid(lanes.length, width, 175, 175);
    pdf.setFontSize(8);
    lanes.forEach(function (lane, i) {
      var lx = legendX + Math.floor(i / grid.rows) * grid.colW;
      var ly = legendY + (i % grid.rows) * 13;
      drawSwatch(pdf, U.laneColors(lane, false), lx, ly);

      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      pdf.text(truncate(pdf, U.laneLabel(lane), grid.colW - 84), lx + 20, ly);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text(truncate(pdf, U.hoursLabel(totals[i]) + ' a week', 56), lx + grid.colW - 58, ly);
    });
  }

  function drawListing(pdf, state, labels, pageW, pageH, margin) {
    var y2 = margin + 14;
    pdf.setFont('times', 'bold');
    pdf.setFontSize(16);
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
      pdf.setFontSize(12);
      pdf.setTextColor(0, 40, 85);
      pdf.text(U.DAY_NAMES[dl], margin, y2);
      pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
      pdf.line(margin, y2 + 3, pageW - margin, y2 + 3);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      blocks.forEach(function (a) {
        var tutor = TS.store.getTutor(a.tutorId);
        y2 += 13.5;
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
      pdf.setFontSize(11);
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
    var pdf = new root.jspdf.jsPDF({
      orientation: s.orientation === 'portrait' ? 'portrait' : 'landscape', unit: 'pt', format: 'letter'
    });

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

    /* For each 7 weeks printed -- both by default -- the tutor calendar, then
     * the same handout with the week read by class. Printed double sided,
     * those are the two faces of one sheet. With the listing turned on, it
     * follows each calendar instead, so each sheet then carries a calendar on
     * one face and the listing on the other.
     */
    var listing = !!s.includeListing;
    var first = true;
    var page = function () { if (!first) pdf.addPage(); first = false; };
    TS.store.printViews().forEach(function (view) {
      page();
      drawCalendarPage(pdf, view, labels, pageW, pageH, margin, false);
      if (listing) {
        page();
        drawListing(pdf, view, labels, pageW, pageH, margin);
      }
      page();
      drawCalendarPage(pdf, view, labels, pageW, pageH, margin, true);
      if (listing) {
        page();
        drawListing(pdf, view, labels, pageW, pageH, margin);
      }
    });

    return { pdf: pdf, filename: TS.store.printName() + '.pdf' };
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
    pdf.setFontSize(8);
    pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.text('CHATTANOOGA STATE COMMUNITY COLLEGE', margin, margin + 6);

    pdf.setFont('times', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(0, 40, 85);
    pdf.text(s.title, margin, margin + 26);

    var whereY = margin + 40;
    // Which 7 weeks this is, beside the semester: the two halves' handouts
    // look alike, and one posted for the wrong half is easy to miss.
    pdf.setFont('times', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.text([s.term, state.periods[state.activePeriod].label].filter(Boolean).join(' · '),
      margin, whereY);
    whereY += 13;
    if (s.effective) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text(s.effective, margin, whereY);
      whereY += 12;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(INK[0], INK[1], INK[2]);
    pdf.text(s.location, margin, whereY);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9.5);
    if (s.contactName) pdf.text(s.contactName, pageW - margin, margin + 14, { align: 'right' });
    if (s.contactEmail) {
      pdf.text(s.contactEmail, pageW - margin, (s.contactName ? margin + 26 : margin + 14),
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
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    var noteLines = s.notes
      ? pdf.splitTextToSize(s.notes, pageW - margin * 2 - 12)
      : [];
    // The box is this less the 8 points kept clear above the footer rule, and
    // still clears the last line's descenders.
    var noteH = noteLines.length ? 25 + noteLines.length * 10.5 : 0;

    // The label column is as wide as the widest kind name, so the entries of
    // both runs line up whatever the kinds are called.
    var offRuns = offRoomRuns(state, labels);
    pdf.setFont('times', 'bold');
    pdf.setFontSize(10);
    var offLabelW = 0;
    offRuns.forEach(function (run) {
      offLabelW = Math.max(offLabelW, pdf.getTextWidth(run.label) + 8);
    });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    var offRowCount = 0;
    offRuns.forEach(function (run) {
      run.lines = pdf.splitTextToSize(run.text, pageW - margin * 2 - offLabelW);
      offRowCount += run.lines.length;
    });
    var offH = offRowCount ? 14 + offRowCount * 10.5 : 0;

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
        pdf.setFontSize(10);
        pdf.setTextColor(0, 40, 85);
        pdf.text(run.label, margin, offY);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(INK[0], INK[1], INK[2]);
        run.lines.forEach(function (line, i) {
          pdf.text(line, margin + offLabelW, offY + i * 10.5);
        });
        offY += run.lines.length * 10.5;
      });
    }

    /* ---- important notes ---- */
    if (noteLines.length) {
      var noteTop = gridEnd + 10 + offH;
      pdf.setFillColor(252, 250, 247);
      pdf.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
      pdf.setLineWidth(0.5);
      pdf.rect(margin, noteTop, pageW - margin * 2, noteH - 8, 'FD');
      pdf.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]);
      pdf.rect(margin, noteTop, 3, noteH - 8, 'F');

      pdf.setFont('times', 'bold');
      pdf.setFontSize(10.5);
      pdf.setTextColor(0, 40, 85);
      pdf.text('Important notes', margin + 9, noteTop + 12);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      noteLines.forEach(function (line, i) {
        pdf.text(line, margin + 9, noteTop + 23.5 + i * 10.5);
      });
    }

    /* ---- footer: QR, what it is for, legend ---- */
    var footY = gridBottom + 12 + noteH + offH;
    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    pdf.setLineWidth(0.6);
    pdf.line(margin, footY - 8, pageW - margin, footY - 8);

    drawQr(pdf, s.qrUrl, margin + 3, footY, 58);

    // The link itself is left off the page: it is long and carries an id
    // nobody would type, so the code is what gets used.
    // Narrower beside the QR on a portrait page, to leave the legend its room.
    var qrTextW = pageW > pageH ? 170 : 140;
    var qrY = footY + 10;
    pdf.setTextColor(INK[0], INK[1], INK[2]);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.splitTextToSize(s.qrHeading || '', qrTextW).forEach(function (line) {
      pdf.text(line, margin + 72, qrY);
      qrY += 12;
    });
    pdf.setFont('helvetica', 'normal');
    pdf.splitTextToSize(s.qrCaption || '', qrTextW).slice(0, 4).forEach(function (line) {
      pdf.text(line, margin + 72, qrY);
      qrY += 12;
    });

    var legendX = margin + 90 + qrTextW;
    var legendY = footY + 6;
    var legendW = pageW - margin - legendX;
    if (byClass) drawClassLegend(pdf, state, legendX, legendY, legendW);
    else drawTutorLegend(pdf, state, labels, legendX, legendY, legendW);
  }

  function download(state) {
    var built = build(state);
    built.pdf.save(built.filename);
    return built;
  }

  TS.pdf = { build: build, download: download, available: available };
})(typeof window !== 'undefined' ? window : globalThis);
