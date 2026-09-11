(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;
  var doc = root.document;
  var esc = function (s) { return TS.tutors.esc(s); };

  /*
   * Lane grids per day. The screen view can position blocks freely, but a
   * table needs a fixed number of columns per day and a rowspan per block,
   * which is exactly what makes the exported PDF tagged and navigable.
   */
  function laneGrid(assignments, day) {
    var dayBlocks = assignments.filter(function (a) { return a.day === day; });
    var placement = TS.calendar.layoutDay(dayBlocks);
    var lanes = 1;
    dayBlocks.forEach(function (b) {
      var p = placement[b.id];
      if (p) lanes = Math.max(lanes, p.lane + 1);
    });

    var grid = [];
    for (var l = 0; l < lanes; l++) {
      var row = new Array(U.SLOTS_PER_DAY);
      for (var s = 0; s < U.SLOTS_PER_DAY; s++) row[s] = null;
      grid.push(row);
    }
    dayBlocks.forEach(function (b) {
      var lane = placement[b.id] ? placement[b.id].lane : 0;
      for (var s = b.startSlot; s < b.endSlot; s++) grid[lane][s] = b;
    });

    return { lanes: lanes, grid: grid };
  }

  /* Days butt up against each other, so the last lane of each one carries the
   * divider and odd days carry a wash. Without both, a reader cannot tell
   * where Tuesday stops and Wednesday starts. */
  function cellClass(base, day, lane, lanes) {
    var cls = base;
    if (lane === lanes - 1) cls += ' pv-dayend';
    if (day % 2 === 1) cls += ' pv-day-alt';
    return cls;
  }

  function blockCell(a, labels, dark, cls) {
    var tutor = TS.store.getTutor(a.tutorId);
    var colors = U.blockColors(tutor.colorIndex, dark);
    var mask = U.subjectMask(tutor.subjects);
    var shorts = U.maskToShort(mask);
    var full = (tutor.firstName + ' ' + tutor.lastName).trim();

    return '<td class="' + cls + '" rowspan="' + (a.endSlot - a.startSlot) + '"' +
      ' style="background:' + colors.bg + ';border-left:4px solid ' + colors.bar + ';color:' + colors.ink + '"' +
      (U.usesHatch(tutor.colorIndex) ? ' data-hatch="1"' : '') + '>' +
      '<span class="pv-block__name">' + esc(labels[tutor.id]) + '</span>' +
      '<span class="pv-block__time">' + esc(U.formatRange(a.startSlot, a.endSlot)) + '</span>' +
      '<span class="pv-block__subjects">' + (shorts.join(' · ') || '—') + '</span>' +
      '<span class="visually-hidden">' + esc(full) + '</span>' +
      '</td>';
  }

  function buildTable(state, labels) {
    var dark = false; // print is always light
    var days = [];
    for (var d = 0; d < U.DAYS; d++) days.push(laneGrid(state.assignments, d));

    var html = '<table class="pv-table"><caption class="visually-hidden">' +
      'Weekly tutoring schedule, Monday through Friday, 7:00 AM to 8:30 PM</caption><thead><tr>' +
      '<th scope="col" class="pv-time-head pv-dayend">Time</th>';
    for (var i = 0; i < U.DAYS; i++) {
      html += '<th scope="' + (days[i].lanes > 1 ? 'colgroup' : 'col') + '"' +
        ' class="pv-dayend"' +
        (days[i].lanes > 1 ? ' colspan="' + days[i].lanes + '"' : '') + '>' +
        U.DAY_NAMES[i] + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var s = 0; s < U.SLOTS_PER_DAY; s++) {
      var onHour = U.slotStartMinutes(s) % 60 === 0;
      html += '<tr' + (onHour ? ' class="pv-hour"' : '') + '>' +
        '<th scope="row" class="pv-time">' +
        (onHour ? esc(U.formatMinutes(U.slotStartMinutes(s))) : '') + '</th>';

      for (var dd = 0; dd < U.DAYS; dd++) {
        for (var l = 0; l < days[dd].lanes; l++) {
          var a = days[dd].grid[l][s];
          if (!a) {
            html += '<td class="' + cellClass('pv-empty', dd, l, days[dd].lanes) + '"></td>';
            continue;
          }
          if (a.startSlot === s) {
            html += blockCell(a, labels, dark, cellClass('pv-block', dd, l, days[dd].lanes));
          }
          // slots after the first are absorbed by the rowspan above
        }
      }
      html += '</tr>';
    }

    return html + '</tbody></table>';
  }

  function buildListing(state, labels) {
    var html = '<section class="pv-listing"><h2>Schedule listing</h2>';
    var any = false;

    for (var d = 0; d < U.DAYS; d++) {
      var dayBlocks = state.assignments
        .filter(function (a) { return a.day === d; })
        .sort(function (a, b) { return a.startSlot - b.startSlot; });
      if (!dayBlocks.length) continue;
      any = true;

      html += '<h3>' + U.DAY_NAMES[d] + '</h3><ul>';
      dayBlocks.forEach(function (a) {
        var tutor = TS.store.getTutor(a.tutorId);
        var mask = U.subjectMask(tutor.subjects);
        html += '<li>' + esc(labels[tutor.id]) + ', ' +
          esc(U.formatRange(a.startSlot, a.endSlot)) + ' — ' +
          esc(U.maskToLabels(mask).join(', ') || 'no subjects assigned') + '</li>';
      });
      html += '</ul>';
    }

    if (!any) html += '<p>No shifts are scheduled yet.</p>';
    return html + '</section>';
  }

  function buildLegend(state, labels) {
    if (!state.tutors.length) return '';
    var items = state.tutors.map(function (t) {
      var colors = U.blockColors(t.colorIndex, false);
      var shorts = U.maskToShort(U.subjectMask(t.subjects));
      return '<li><span class="pv-swatch" style="background:' + colors.bg +
        ';border-left:5px solid ' + colors.bar + '"></span>' +
        esc(labels[t.id]) + ' <span class="pv-legend__subjects">' +
        esc(shorts.join(' · ') || '—') + '</span></li>';
    }).join('');
    return '<section class="pv-legend"><h2>Tutors</h2><ul>' + items + '</ul></section>';
  }

  function render(container, state) {
    var labels = U.displayNames(state.tutors);
    var s = state.settings;
    var qrSvg = TS.qr.toSvg(s.qrUrl, { label: 'QR code linking to ' + s.qrUrl });

    var subtitle = [s.term, s.effective].filter(Boolean).join(' · ');

    container.innerHTML =
      '<header class="pv-head">' +
        '<div class="pv-head__main">' +
          '<p class="pv-college">Chattanooga State Community College</p>' +
          '<h1>' + esc(s.title) + '</h1>' +
          (subtitle ? '<p class="pv-subtitle">' + esc(subtitle) + '</p>' : '') +
          '<p class="pv-where">' + esc(s.location) + '</p>' +
        '</div>' +
        '<div class="pv-head__contact">' +
          '<p><strong>' + esc(s.contactName) + '</strong><br>' + esc(s.contactEmail) + '</p>' +
        '</div>' +
      '</header>' +
      buildTable(state, labels) +
      '<div class="pv-foot">' +
        '<div class="pv-qr">' + qrSvg + '</div>' +
        '<div class="pv-qr__text">' +
          '<p><strong>Need help outside these hours?</strong></p>' +
          '<p>' + esc(s.qrCaption) + '</p>' +
          '<p class="pv-qr__url">' + esc(s.qrUrl) + '</p>' +
        '</div>' +
        buildLegend(state, labels) +
      '</div>' +
      buildListing(state, labels);
  }

  TS.printview = { render: render, laneGrid: laneGrid, buildListing: buildListing };
})(typeof window !== 'undefined' ? window : globalThis);
