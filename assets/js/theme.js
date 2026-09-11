(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});

  var current = 'system';
  var listeners = [];
  var media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;

  function isDark() {
    if (current === 'dark') return true;
    if (current === 'light') return false;
    return !!(media && media.matches);
  }

  function apply(mode) {
    current = mode === 'dark' || mode === 'light' ? mode : 'system';
    var el = root.document.documentElement;
    if (current === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', current);
    notify();
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) listeners[i](isDark(), current);
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners.splice(listeners.indexOf(fn), 1); };
  }

  function init(mode) {
    apply(mode);
    if (media) {
      var handler = function () { if (current === 'system') notify(); };
      if (media.addEventListener) media.addEventListener('change', handler);
      else if (media.addListener) media.addListener(handler);
    }

    /*
     * Printing always uses the light palette: a dark ground burns toner and
     * flattens the contrast the PDF is supposed to guarantee. The attribute is
     * forced for the duration of the print and restored afterwards.
     */
    var restore = null;
    var beforePrint = function () {
      restore = root.document.documentElement.getAttribute('data-theme');
      root.document.documentElement.setAttribute('data-theme', 'light');
    };
    var afterPrint = function () {
      if (restore === null) root.document.documentElement.removeAttribute('data-theme');
      else root.document.documentElement.setAttribute('data-theme', restore);
      restore = null;
    };

    if (root.addEventListener) {
      root.addEventListener('beforeprint', beforePrint);
      root.addEventListener('afterprint', afterPrint);
    }
    if (root.matchMedia) {
      var printMedia = root.matchMedia('print');
      var printHandler = function (e) { if (e.matches) beforePrint(); else afterPrint(); };
      if (printMedia.addEventListener) printMedia.addEventListener('change', printHandler);
      else if (printMedia.addListener) printMedia.addListener(printHandler);
    }
  }

  TS.theme = {
    init: init,
    apply: apply,
    onChange: onChange,
    isDark: isDark,
    get mode() { return current; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
