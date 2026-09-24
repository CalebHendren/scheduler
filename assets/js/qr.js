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

  /*
   * The dark modules as horizontal runs, [row, col, length], rather than one
   * square each: both the SVG and the PDF draw a run as a single shape, so the
   * code stays small, prints as vector, and scales without blurring.
   */
  function runs(text) {
    var qr = encode(text);
    if (!qr) return null;
    var count = qr.getModuleCount();
    var out = [];
    for (var r = 0; r < count; r++) {
      var runStart = -1;
      for (var c = 0; c <= count; c++) {
        var on = c < count && qr.isDark(r, c);
        if (on && runStart === -1) runStart = c;
        else if (!on && runStart !== -1) {
          out.push([r, runStart, c - runStart]);
          runStart = -1;
        }
      }
    }
    return { count: count, runs: out };
  }

  function toSvg(text, options) {
    var opts = options || {};
    var code = runs(text);
    if (!code) return '';

    var quiet = opts.quiet === undefined ? 2 : opts.quiet;
    var size = code.count + quiet * 2;
    var dark = opts.color || '#000000';
    var light = opts.background || '#FFFFFF';
    var path = code.runs.map(function (run) {
      return 'M' + (run[1] + quiet) + ' ' + (run[0] + quiet) + 'h' + run[2] + 'v1h-' + run[2] + 'z';
    }).join('');

    var label = opts.label || ('QR code linking to ' + text);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" ' +
      'role="img" aria-label="' + escapeAttr(label) + '" class="qr-svg" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="' + light + '"/>' +
      '<path d="' + path + '" fill="' + dark + '"/>' +
      '</svg>';
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  TS.qr = { runs: runs, toSvg: toSvg };
})(typeof window !== 'undefined' ? window : globalThis);
