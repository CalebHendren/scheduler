(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;

  /*
   * Download PDF: the same two pages per 7 weeks as Print / Save as PDF
   * (printview.js), drawn with jsPDF, in the same order:
   *
   *   1. THE HALL VERSION -- the week read by class, posted in the halls for
   *      students: the QR code to book an appointment, then the Library
   *      Boneyard Tutoring and Open Lab blocks along its foot.
   *   2. THE ADMIN VERSION -- the week read by tutor, for the people who run
   *      the center: in the QR code's place the Floating Embedded Tutors, by
   *      name, then the same Library Boneyard Tutoring and Open Lab blocks.
   *
   * Neither has a legend: every block in the grid already carries its tutor's
   * name or its class's code. A change here is wanted in printview.js too.
   */
  var HALL_BLOCKS = ['library', 'lab'];
  var ADMIN_BLOCKS = ['embedded', 'library', 'lab'];

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

  /* ---- the blocks along the foot ----
   * Library tutoring and the open lab on both versions, the floating embedded
   * tutors first on the admin version, all in the hall version's style -- a
   * navy heading with the room on its right, the classes a walk-in block is
   * for, and a row per entry. The embedded tutors are read by person, so
   * their rows lead with the name (U.footerBlocks).
   */
  var BLOCK_SHARE = { embedded: 1.35, library: 1, lab: 1 };
  var BLOCK_HEAD = 15, BLOCK_ONLY = 12, BLOCK_ROW = 11;

  function footBlocks(state, labels, kinds) {
    return U.footerBlocks(state.assignments, labels, state.tutors, kinds).map(function (b) {
      return {
        title: b.title, room: b.room, only: b.only,
        rows: b.rows.map(function (r) {
          return b.byName
            ? [r.name, r.days, r.time, r.room]
            : [r.days, r.time, r.name + (r.room ? ' (' + r.room + ')' : '')];
        }),
        bold: b.byName ? [0] : [0, 2], muted: b.byName ? [3] : [],
        share: BLOCK_SHARE[b.kind] || 1
      };
    });
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

  function blockHeight(block) {
    return BLOCK_HEAD + (block.only ? BLOCK_ONLY : 0) + 5 + block.rows.length * BLOCK_ROW;
  }

  function drawBottomBlock(pdf, block, x, y, w, h, pt) {
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.setLineWidth(1);
    pdf.rect(x, y, w, h, 'FD');
    pdf.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.rect(x, y, w, BLOCK_HEAD, 'F');

    var roomW = 0;
    if (block.room) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(255, 216, 194);
      roomW = pdf.getTextWidth(block.room) + 10;
      pdf.text(block.room, x + w - 6, y + 10.5, { align: 'right' });
    }
    pdf.setFont('times', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text(truncate(pdf, block.title, w - 12 - roomW), x + 6, y + 11);

    var rowY = y + BLOCK_HEAD;
    if (block.only) {
      pdf.setFillColor(255, 241, 232);
      pdf.rect(x + 0.5, rowY, w - 1, BLOCK_ONLY, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(138, 46, 0);
      pdf.text(truncate(pdf, block.only, w - 12), x + 6, rowY + 8.5);
      rowY += BLOCK_ONLY;
    }

    // Each column as wide as its widest cell; the last one gets what is left.
    pdf.setFontSize(pt);
    var cols = block.rows[0].length;
    var widths = [];
    for (var c = 0; c < cols - 1; c++) {
      pdf.setFont('helvetica', block.bold.indexOf(c) !== -1 ? 'bold' : 'normal');
      widths.push(Math.max.apply(null, block.rows.map(function (r) { return pdf.getTextWidth(r[c]); })) + 7);
    }
    block.rows.forEach(function (row, i) {
      var cx = x + 6;
      var cy = rowY + 4 + (i + 1) * BLOCK_ROW - 2.5;
      row.forEach(function (cell, c) {
        var muted = block.muted.indexOf(c) !== -1;
        pdf.setFont('helvetica', block.bold.indexOf(c) !== -1 ? 'bold' : 'normal');
        pdf.setTextColor.apply(pdf, muted ? MUTED : INK);
        var room = c < cols - 1 ? widths[c] : x + w - 6 - cx;
        pdf.text(truncate(pdf, cell, Math.max(8, room - (c < cols - 1 ? 7 : 0))), cx, cy);
        cx += room;
      });
    });
  }

  /* The important notes box: a tinted panel with the orange bar down its left
   * edge, a heading, and the lines under it. Drawn in the header's empty
   * middle when the notes fit there, or under the grid when they do not. */
  function drawNotesBox(pdf, x, y, w, h, lines, pt, lead) {
    pdf.setFillColor(252, 250, 247);
    pdf.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.setLineWidth(0.5);
    pdf.rect(x, y, w, h, 'FD');
    pdf.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    pdf.rect(x, y, 3, h, 'F');

    pdf.setFont('times', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(0, 40, 85);
    pdf.text('Important notes', x + 9, y + 12);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(pt);
    pdf.setTextColor(INK[0], INK[1], INK[2]);
    lines.forEach(function (line, i) {
      pdf.text(line, x + 9, y + 23.5 + i * lead);
    });
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
   * The page around them is nearly the same either way: header, notes, the
   * blocks along the foot. Only the grid's blocks tell the two calendars
   * apart, so only those are written twice.
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

    /* For each 7 weeks printed -- both by default -- the hall version (the
     * week by class), then the admin version (the week by tutor): the hall
     * version is the one printed most, so it comes first. Printed double
     * sided, those are the two faces of one sheet. With the listing turned
     * on, it follows each calendar instead, so each sheet then carries a
     * calendar on one face and the listing on the other.
     */
    var listing = !!s.includeListing;
    var first = true;
    var page = function () { if (!first) pdf.addPage(); first = false; };
    TS.store.printViews().forEach(function (view) {
      page();
      drawCalendarPage(pdf, view, labels, pageW, pageH, margin, true);
      if (listing) {
        page();
        drawListing(pdf, view, labels, pageW, pageH, margin);
      }
      page();
      drawCalendarPage(pdf, view, labels, pageW, pageH, margin, false);
      if (listing) {
        page();
        drawListing(pdf, view, labels, pageW, pageH, margin);
      }
    });

    return { pdf: pdf, filename: TS.store.printName() + '.pdf' };
  }

  /* A whole handout page: the header, the week, the notes and the blocks
   * along the foot. `byClass` is the hall version -- the week by class, with
   * the QR code leading its foot; otherwise it is the admin version -- the
   * week by tutor, with the floating embedded tutors where the QR code was.
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

    var leftW = pdf.getTextWidth(s.location || '');
    pdf.setFont('times', 'bold');
    pdf.setFontSize(18);
    leftW = Math.max(leftW, pdf.getTextWidth(s.title || ''));

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9.5);
    var contactW = Math.max(pdf.getTextWidth(s.contactName || ''), pdf.getTextWidth(s.contactEmail || ''));
    if (s.contactName) pdf.text(s.contactName, pageW - margin, margin + 14, { align: 'right' });
    if (s.contactEmail) {
      pdf.text(s.contactEmail, pageW - margin, (s.contactName ? margin + 26 : margin + 14),
        { align: 'right' });
    }

    /* On a landscape sheet the notes go in the header's empty middle, between
     * the title and the contact, when they fit in a few lines there: the first
     * thing read, and the space under the grid is left to tutoring held
     * elsewhere. Otherwise -- a long notice, or a portrait sheet's narrow
     * header -- they keep their box under the grid. */
    var headNotes = null;
    if (s.notes && pageW > pageH) {
      var hx = margin + leftW + 20;
      var hw = pageW - margin - contactW - 20 - hx;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      var hl = hw >= 200 ? pdf.splitTextToSize(s.notes, hw - 14) : [];
      if (hl.length && hl.length <= 4) {
        var hh = 18 + hl.length * 9.5;
        headNotes = { x: hx, y: Math.max(margin, whereY + 2 - hh), w: hw, h: hh, lines: hl };
        drawNotesBox(pdf, hx, headNotes.y, hw, hh, hl, 8.5, 9.5);
      }
    }

    var ruleY = Math.max(whereY + 7, headNotes ? headNotes.y + headNotes.h + 5 : 0);
    pdf.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    pdf.setLineWidth(2);
    pdf.line(margin, ruleY, pageW - margin, ruleY);

    /* ---- grid geometry ---- */
    // The grid is the tutoring center; embedded classes and open labs are
    // listed in their own band under it.
    var drawn = U.mainShifts(state.assignments);
    var win = U.scheduleWindow(drawn);
    var slotCount = win.end - win.start;

    var gridTop = ruleY + 11;
    // The notes band is measured before the grid is laid out, so a long note
    // shortens the grid rather than running off the page. The band of shifts
    // held elsewhere is measured the same way, for the same reason.
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    var noteLines = s.notes && !headNotes
      ? pdf.splitTextToSize(s.notes, pageW - margin * 2 - 12)
      : [];
    // The box is this less the 8 points kept clear above the footer rule, and
    // still clears the last line's descenders.
    var noteH = noteLines.length ? 25 + noteLines.length * 10.5 : 0;

    // The blocks along the foot are measured before the grid is laid out too;
    // on the hall version the QR code stands at their left, as tall as they
    // are or taller.
    var hall = byClass;
    var QR = 72;
    var blocks = footBlocks(state, labels, hall ? HALL_BLOCKS : ADMIN_BLOCKS);
    var blocksH = blocks.reduce(function (most, b) { return Math.max(most, blockHeight(b)); }, 0);
    var footRowH = Math.max(blocksH, hall ? QR + 4 : 0);

    var footH = 12 + noteH + footRowH;
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
     * The one place the two calendars differ inside the grid.
     */
    if (byClass) drawClassBlocks(pdf, state, labels, geom);
    else drawTutorBlocks(pdf, state, labels, geom);

    /* ---- day dividers ---- */
    var gridEnd = bodyTop + slotCount * rowH;
    drawDayDividers(pdf, geom);

    /* ---- important notes, when the header had no room for them ---- */
    if (noteLines.length) {
      drawNotesBox(pdf, margin, gridEnd + 10, pageW - margin * 2, noteH - 8, noteLines, 9, 10.5);
    }

    /* ---- the foot: QR code (hall) or embedded tutors (admin), then library
     * tutoring and the open lab ---- */
    var footY = gridEnd + 12 + noteH;
    var bx = margin;
    if (hall) {
      // The link itself is left off the page: it is long and carries an id
      // nobody would type, so the code is what gets used.
      drawQr(pdf, s.qrUrl, margin + 3, footY + 2, QR);
      var qrTextW = pageW > pageH ? 135 : 100;
      var qrX = margin + QR + 14;
      var qrY = footY + 20;
      pdf.setTextColor(0, 40, 85);
      pdf.setFont('times', 'bold');
      pdf.setFontSize(pageW > pageH ? 12.5 : 11);
      pdf.splitTextToSize(s.qrHeading || '', qrTextW).forEach(function (line) {
        pdf.text(line, qrX, qrY);
        qrY += 13;
      });
      pdf.setTextColor(INK[0], INK[1], INK[2]);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(pageW > pageH ? 10 : 9);
      qrY += 2;
      pdf.splitTextToSize(s.qrCaption || '', qrTextW).slice(0, 4).forEach(function (line) {
        pdf.text(line, qrX, qrY);
        qrY += 11.5;
      });
      bx = qrX + qrTextW + 12;
    }
    if (blocks.length) {
      var gap = 10;
      var shares = blocks.reduce(function (sum, b) { return sum + b.share; }, 0);
      var unit = (pageW - margin - bx - gap * (blocks.length - 1)) / shares;
      blocks.forEach(function (b) {
        var bw = unit * b.share;
        drawBottomBlock(pdf, b, bx, footY, bw, blocksH, pageW > pageH ? 8.5 : 7.5);
        bx += bw + gap;
      });
    }
  }

  function download(state) {
    var built = build(state);
    built.pdf.save(built.filename);
    return built;
  }

  TS.pdf = { build: build, download: download, available: available };
})(typeof window !== 'undefined' ? window : globalThis);
