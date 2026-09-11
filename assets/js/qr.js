(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});

  function encode(text) {
    if (typeof root.qrcode !== 'function') return null;
    try {
      // Type 0 lets the library pick the smallest version that fits; level M
      // survives the toner loss and folding a printed handout picks up.
      var qr = root.qrcode(0, 'M');
      qr.addData(String(text));
      qr.make();
      return qr;
    } catch (e) {
      if (root.console) root.console.warn('QR code could not be generated:', e && e.message);
      return null;
    }
  }

  function modules(text) {
    var qr = encode(text);
    if (!qr) return null;
    var count = qr.getModuleCount();
    var grid = [];
    for (var r = 0; r < count; r++) {
      var row = [];
      for (var c = 0; c < count; c++) row.push(qr.isDark(r, c));
      grid.push(row);
    }
    return grid;
  }

  /*
   * One path per dark module row-run rather than a rect per module: the SVG
   * stays small, prints as vector, and scales to any size without blurring.
   */
  function toSvg(text, options) {
    var opts = options || {};
    var grid = modules(text);
    if (!grid) return '';

    var count = grid.length;
    var quiet = opts.quiet === undefined ? 2 : opts.quiet;
    var size = count + quiet * 2;
    var dark = opts.color || '#000000';
    var light = opts.background || '#FFFFFF';
    var path = [];

    for (var r = 0; r < count; r++) {
      var runStart = -1;
      for (var c = 0; c <= count; c++) {
        var on = c < count && grid[r][c];
        if (on && runStart === -1) runStart = c;
        else if (!on && runStart !== -1) {
          path.push('M' + (runStart + quiet) + ' ' + (r + quiet) + 'h' + (c - runStart) + 'v1h-' + (c - runStart) + 'z');
          runStart = -1;
        }
      }
    }

    var label = opts.label || ('QR code linking to ' + text);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" ' +
      'role="img" aria-label="' + escapeAttr(label) + '" class="qr-svg" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="' + light + '"/>' +
      '<path d="' + path.join('') + '" fill="' + dark + '"/>' +
      '</svg>';
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  TS.qr = { encode: encode, modules: modules, toSvg: toSvg };
})(typeof window !== 'undefined' ? window : globalThis);
