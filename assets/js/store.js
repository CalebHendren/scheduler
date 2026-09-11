(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;

  var STORAGE_KEY = 'cscc-tutor-scheduler-v1';
  var VERSION = 1;

  function defaultSettings() {
    return {
      title: 'Science Tutoring Schedule',
      term: 'Fall 2026',
      effective: '',
      notes: 'No tutoring will be available September 7, October 5–11, or November 23–29, ' +
        'or any time the IMC and/or campus is closed. The last day of tutoring for the fall ' +
        'semester is December 10, 2026.',
      location: 'Student Success Center (IMC 270)',
      contactName: 'Caleb Hendren, MS',
      contactEmail: 'caleb.hendren@chattanoogastate.edu',
      qrUrl: 'https://www.tutor.com',
      qrCaption: 'Free 24/7 online tutoring',
      minShiftSlots: 2,
      maxConcurrent: 2,
      breakAfterHours: 6,
      breakSlots: 1,
      defaultMaxHours: 15,
      maxHoursPerDay: 8,
      weeklyBudgetEnabled: false,
      weeklyBudgetHours: 80,
      evenDistribution: true,
      theme: 'system'
    };
  }

  function emptyState() {
    return { version: VERSION, settings: defaultSettings(), tutors: [], assignments: [] };
  }

  var state = emptyState();
  var listeners = [];

  function on(fn) { listeners.push(fn); return function () { listeners.splice(listeners.indexOf(fn), 1); }; }
  function emit(reason) {
    for (var i = 0; i < listeners.length; i++) listeners[i](state, reason);
  }
  function commit(reason) { save(); emit(reason || 'change'); }

  var storageWorks = null;

  /*
   * Browsers block local storage in a few situations that matter here: a
   * private window, site data turned off, and -- the common one -- opening the
   * single-file build straight from disk, where Chrome treats file:// as an
   * opaque origin. The app still works; it just cannot remember anything, so
   * the UI says so rather than losing a schedule silently.
   */
  function storageAvailable() {
    if (storageWorks !== null) return storageWorks;
    try {
      var probe = STORAGE_KEY + ':probe';
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      storageWorks = true;
    } catch (e) {
      storageWorks = false;
    }
    return storageWorks;
  }

  function save() {
    if (!storageAvailable()) return false;
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      // Most likely the quota; treat it the same as unavailable from here on
      // so the warning shows and the app keeps running.
      storageWorks = false;
      if (root.console) root.console.warn('Schedule could not be saved locally:', e && e.message);
      return false;
    }
  }

  function load() {
    var raw = null;
    try { raw = root.localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return false;
    try {
      var parsed = JSON.parse(raw);
      state = migrate(parsed);
      return true;
    } catch (e) {
      if (root.console) root.console.warn('Saved schedule was unreadable; starting fresh.');
      return false;
    }
  }

  function migrate(obj) {
    var next = emptyState();
    if (!obj || typeof obj !== 'object') return next;
    // Unknown keys are dropped and missing ones defaulted, so an older or
    // hand-edited file still loads instead of half-populating the UI.
    if (obj.settings) {
      Object.keys(next.settings).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(obj.settings, k)) next.settings[k] = obj.settings[k];
      });
    }
    next.tutors = (obj.tutors || []).map(normalizeTutor);
    var ids = {};
    next.tutors.forEach(function (t) { ids[t.id] = true; });
    next.assignments = (obj.assignments || [])
      .filter(function (a) { return a && ids[a.tutorId]; })
      .map(normalizeAssignment);
    return next;
  }

  function normalizeTutor(t) {
    var avail = new Array(U.TOTAL_SLOTS);
    for (var i = 0; i < U.TOTAL_SLOTS; i++) {
      avail[i] = t.availability && t.availability[i] ? 1 : 0;
    }
    return {
      id: t.id || U.uid('tutor'),
      firstName: String(t.firstName || '').trim(),
      lastName: String(t.lastName || '').trim(),
      colorIndex: typeof t.colorIndex === 'number' ? t.colorIndex : 0,
      subjects: {
        bio: !!(t.subjects && t.subjects.bio),
        micro: !!(t.subjects && t.subjects.micro),
        ap1: !!(t.subjects && t.subjects.ap1),
        ap2: !!(t.subjects && t.subjects.ap2)
      },
      maxHoursPerWeek: typeof t.maxHoursPerWeek === 'number' ? t.maxHoursPerWeek : 15,
      minHoursPerWeek: typeof t.minHoursPerWeek === 'number' ? t.minHoursPerWeek : 0,
      maxHoursPerDay: typeof t.maxHoursPerDay === 'number' ? t.maxHoursPerDay : null,
      availability: avail,
      notes: String(t.notes || '')
    };
  }

  function normalizeAssignment(a) {
    return {
      id: a.id || U.uid('shift'),
      tutorId: a.tutorId,
      day: a.day | 0,
      startSlot: a.startSlot | 0,
      endSlot: a.endSlot | 0,
      locked: !!a.locked,
      overCapacity: !!a.overCapacity
    };
  }

  /* ---- tutors ---- */

  function nextColorIndex() {
    var used = {};
    state.tutors.forEach(function (t) { used[t.colorIndex] = (used[t.colorIndex] || 0) + 1; });
    for (var i = 0; i < 64; i++) {
      if (!used[i]) return i;
    }
    return state.tutors.length;
  }

  function addTutor(data) {
    var t = normalizeTutor(data || {});
    if (typeof (data && data.colorIndex) !== 'number') t.colorIndex = nextColorIndex();
    if (!(data && typeof data.maxHoursPerWeek === 'number')) t.maxHoursPerWeek = state.settings.defaultMaxHours;
    state.tutors.push(t);
    return t;
  }

  function getTutor(id) {
    for (var i = 0; i < state.tutors.length; i++) {
      if (state.tutors[i].id === id) return state.tutors[i];
    }
    return null;
  }

  function removeTutor(id) {
    state.tutors = state.tutors.filter(function (t) { return t.id !== id; });
    state.assignments = state.assignments.filter(function (a) { return a.tutorId !== id; });
  }

  /* ---- assignments ---- */

  function addAssignment(a) {
    var next = normalizeAssignment(a);
    if (!next.id) next.id = U.uid('shift');
    state.assignments.push(next);
    return next;
  }

  function removeAssignment(id) {
    state.assignments = state.assignments.filter(function (a) { return a.id !== id; });
  }

  function getAssignment(id) {
    for (var i = 0; i < state.assignments.length; i++) {
      if (state.assignments[i].id === id) return state.assignments[i];
    }
    return null;
  }

  function slotsFor(tutorId) {
    var n = 0;
    state.assignments.forEach(function (a) {
      if (a.tutorId === tutorId) n += a.endSlot - a.startSlot;
    });
    return n;
  }

  function totalSlots() {
    var n = 0;
    state.assignments.forEach(function (a) { n += a.endSlot - a.startSlot; });
    return n;
  }

  /* ---- import / export ---- */

  function toJson() { return JSON.stringify(state, null, 2); }

  function fromJson(text) {
    var parsed = JSON.parse(text);
    state = migrate(parsed);
    commit('import');
  }

  function replaceState(next) {
    state = migrate(next);
    commit('replace');
  }

  function reset() {
    state = emptyState();
    commit('reset');
  }

  /* ---- sample roster ----
   * The ten-tutor fixture from the plan. It doubles as the CI test case, so it
   * deliberately contains two tutors named Anna, an AP1-heavy subject mix, and
   * enough availability that all 135 slots are coverable by someone.
   */
  function availability(windows) {
    var a = new Array(U.TOTAL_SLOTS);
    for (var i = 0; i < U.TOTAL_SLOTS; i++) a[i] = 0;
    windows.forEach(function (w) {
      var days = w[0], start = U.hhmmToSlot(w[1]), end = U.hhmmToSlot(w[2]);
      days.forEach(function (d) {
        for (var s = start; s < end; s++) a[U.idx(d, s)] = 1;
      });
    });
    return a;
  }

  var MON = 0, TUE = 1, WED = 2, THU = 3, FRI = 4;

  /* Approved hours add up to 80 across the roster: the department pays for 80,
   * so that is what the sample is willing to work. Each cap sits at or under
   * that tutor's availability, so willing hours and approved hours are the
   * same number and the roster is exactly the 80 it says it is.
   */
  function sampleTutors() {
    return [
      { firstName: 'Anna', lastName: 'Harden', subjects: { ap1: true, ap2: true },
        maxHoursPerWeek: 8,
        availability: availability([[[MON, WED, FRI], '12:00', '17:00']]) },
      { firstName: 'Marcus', lastName: 'Bell', subjects: { bio: true },
        maxHoursPerWeek: 9,
        availability: availability([[[MON, TUE, WED, THU], '08:00', '13:00']]) },
      { firstName: 'Priya', lastName: 'Raman', subjects: { ap1: true, micro: true },
        maxHoursPerWeek: 8,
        availability: availability([[[TUE, THU], '13:00', '20:30']]) },
      { firstName: 'Devon', lastName: 'Pierce', subjects: { ap1: true },
        maxHoursPerWeek: 9,
        availability: availability([[[MON, TUE, WED, THU, FRI], '15:00', '20:00']]) },
      { firstName: 'Sofia', lastName: 'Marín', subjects: { bio: true, micro: true },
        maxHoursPerWeek: 9,
        availability: availability([[[MON, WED], '07:00', '14:00'], [[FRI], '09:00', '15:00']]) },
      { firstName: 'Jamal', lastName: 'Whitfield', subjects: { ap2: true },
        maxHoursPerWeek: 6,
        availability: availability([[[WED, THU], '16:00', '20:30']]) },
      { firstName: 'Hannah', lastName: 'Ochoa', subjects: { bio: true, ap1: true, ap2: true },
        maxHoursPerWeek: 9,
        availability: availability([[[TUE, WED, THU, FRI], '10:00', '16:00']]) },
      { firstName: 'Eli', lastName: 'Novak', subjects: { micro: true },
        maxHoursPerWeek: 5,
        availability: availability([[[MON, WED], '17:00', '20:30']]) },
      { firstName: 'Anna', lastName: 'Henry', subjects: { ap1: true, ap2: true, micro: true },
        maxHoursPerWeek: 9,
        availability: availability([[[MON, TUE, WED, THU, FRI], '07:00', '12:00']]) },
      { firstName: 'Trent', lastName: 'Boyd', subjects: { bio: true, micro: true },
        maxHoursPerWeek: 8,
        availability: availability([[[TUE, THU, FRI], '14:00', '20:30']]) }
    ];
  }

  function loadSample() {
    state = emptyState();
    sampleTutors().forEach(function (t, i) {
      t.colorIndex = i;
      addTutor(t);
    });
    commit('sample');
  }

  TS.store = {
    STORAGE_KEY: STORAGE_KEY,
    get state() { return state; },
    defaultSettings: defaultSettings,
    emptyState: emptyState,
    availability: availability,
    sampleTutors: sampleTutors,
    on: on,
    emit: emit,
    commit: commit,
    save: save,
    storageAvailable: storageAvailable,
    load: load,
    migrate: migrate,
    normalizeTutor: normalizeTutor,
    addTutor: addTutor,
    getTutor: getTutor,
    removeTutor: removeTutor,
    addAssignment: addAssignment,
    getAssignment: getAssignment,
    removeAssignment: removeAssignment,
    slotsFor: slotsFor,
    totalSlots: totalSlots,
    toJson: toJson,
    fromJson: fromJson,
    replaceState: replaceState,
    reset: reset,
    loadSample: loadSample
  };
})(typeof window !== 'undefined' ? window : globalThis);
