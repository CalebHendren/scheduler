(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;

  var STORAGE_KEY = 'cscc-tutor-scheduler-v1';
  var VERSION = 1;

  function defaultSettings() {
    return {
      title: 'Life Science Tutor Schedule',
      term: 'Fall 2026',
      effective: '',
      notes: 'No tutoring will be available September 7, October 5–11, or November 23–29, ' +
        'or any time the IMC and/or campus is closed. The last day of tutoring for the fall ' +
        'semester is December 10, 2026.',
      location: 'Student Success Center (IMC 270)',
      contactName: '',
      contactEmail: '',
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
      subjects: U.defaultSubjects(),
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

  /* ---- undo ----
   * Every change in the app already funnels through commit(), so history is
   * kept here rather than asking each caller to remember to record itself.
   * `mark` is the state as it stood after the last commit, which is exactly
   * the state to go back to when the next one lands.
   */
  var MAX_HISTORY = 60;
  var undoStack = [];
  var redoStack = [];
  var mark = null;   // set below, once serialize() is reachable

  function serialize() {
    return JSON.stringify({ settings: state.settings, tutors: state.tutors, assignments: state.assignments });
  }

  function restore(json) {
    state = migrate(JSON.parse(json));
    syncPalette();
    mark = serialize();
    save();
  }

  /* The palette is a ring sized to the roster, so it has to be resized before
   * anything reads a color off it. Sized to the highest index in play rather
   * than the head count, because removing a tutor leaves the others holding
   * the indices they already had, and a short ring would wrap two of them onto
   * the same hue.
   */
  function syncPalette() {
    var n = state.tutors.length;
    state.tutors.forEach(function (t) { n = Math.max(n, (t.colorIndex | 0) + 1); });
    U.setColorCount(n);
  }

  function commit(reason) {
    reason = reason || 'change';
    // One choke point for the class list: however it changed -- edited here,
    // imported, or stepped over by undo -- the masks follow the state.
    U.setSubjects(state.settings.subjects);
    syncPalette();
    if (mark !== null) {
      undoStack.push({ json: mark, reason: reason });
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
    }
    mark = serialize();
    save();
    emit(reason);
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  // Both return the reason of the change they stepped over, so the caller can
  // say what just happened, or null when there was nothing to step over.
  function undo() {
    if (!undoStack.length) return null;
    var entry = undoStack.pop();
    redoStack.push({ json: serialize(), reason: entry.reason });
    restore(entry.json);
    emit('undo');
    return entry.reason;
  }

  function redo() {
    if (!redoStack.length) return null;
    var entry = redoStack.pop();
    undoStack.push({ json: serialize(), reason: entry.reason });
    restore(entry.json);
    emit('redo');
    return entry.reason;
  }

  function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    mark = serialize();
  }

  mark = serialize();

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
      clearHistory();   // the first change of the session undoes back to this
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
    // The class list drives every subject mask in the app, so it is applied
    // before a single tutor is normalized against it.
    next.settings.subjects = U.normalizeSubjectList(next.settings.subjects);
    U.setSubjects(next.settings.subjects);
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
    /* Every class the schedule currently knows about, plus any flag left over
     * from one that was removed: keeping the stray keys is what lets an
     * accidental deletion be undone without losing who could teach what.
     */
    var subjects = {};
    Object.keys(t.subjects || {}).forEach(function (k) {
      if (t.subjects[k]) subjects[k] = true;
    });
    U.SUBJECTS.forEach(function (s) {
      subjects[s.key] = !!(t.subjects && t.subjects[s.key]);
    });

    return {
      id: t.id || U.uid('tutor'),
      firstName: String(t.firstName || '').trim(),
      lastName: String(t.lastName || '').trim(),
      colorIndex: typeof t.colorIndex === 'number' ? t.colorIndex : 0,
      subjects: subjects,
      maxHoursPerWeek: typeof t.maxHoursPerWeek === 'number' ? t.maxHoursPerWeek : 15,
      minHoursPerWeek: typeof t.minHoursPerWeek === 'number' ? t.minHoursPerWeek : 0,
      maxHoursPerDay: typeof t.maxHoursPerDay === 'number' ? t.maxHoursPerDay : null,
      availability: avail,
      notes: String(t.notes || '')
    };
  }

  function normalizeAssignment(a) {
    var kind = U.shiftKind(a.kind).key;
    return {
      id: a.id || U.uid('shift'),
      tutorId: a.tutorId,
      day: a.day | 0,
      startSlot: a.startSlot | 0,
      endSlot: a.endSlot | 0,
      kind: kind,
      // The main calendar's room is the schedule's location, named once in
      // settings; only a shift somewhere else carries a room of its own.
      room: kind === 'main' ? '' : String(a.room || '').trim(),
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

  /*
   * Re-picks tutor colors from the schedule as it now stands, so who sits next
   * to whom decides who gets which hue instead of the order the roster was
   * typed in. `onlyIds` limits it to those tutors and leaves the rest alone,
   * which is what a change to one person's shifts should do.
   *
   * Callers commit afterwards: colors ride along in the same undo step as the
   * schedule change that caused them.
   */
  function recolorTutors(onlyIds) {
    var map = U.assignColors(state.tutors, state.assignments,
      onlyIds ? { only: onlyIds } : null);
    state.tutors.forEach(function (t) {
      if (typeof map[t.id] === 'number') t.colorIndex = map[t.id];
    });
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

  /* A tutor given 9:00-11:00 and then 11:00-2:00 is working one shift, not two,
   * so touching blocks are stitched together as they are placed -- the same
   * thing the optimizer does to its own fragments on the way out. Kind and room
   * have to match, or an open lab would swallow the shift beside it, and a
   * locked block is left alone because locking is what pins a shift down.
   *
   * This can never create a stretch the rules would have refused: the break
   * rule measures the hours a tutor actually works in a row, not the block, so
   * a shift that would join two others into six unbroken hours is turned away
   * before it is ever placed.
   */
  function mergeTouching(tutorId, day) {
    var mine = state.assignments.filter(function (a) {
      return a.tutorId === tutorId && a.day === day && !a.locked;
    }).sort(function (a, b) { return a.startSlot - b.startSlot; });

    var merged = 0;
    for (var i = 0; i < mine.length - 1; i++) {
      var a = mine[i], b = mine[i + 1];
      if (a.endSlot !== b.startSlot || a.kind !== b.kind || a.room !== b.room) continue;
      a.endSlot = b.endSlot;
      a.overCapacity = a.overCapacity || b.overCapacity;
      removeAssignment(b.id);
      mine[i + 1] = a;      // carry the grown block into the next comparison
      merged++;
    }
    return merged;
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

  /* Everyone is approved for the same 15 hours a week -- that is a department
   * decision, not a personal one. What differs is availability, because these
   * tutors are students first: a couple can offer the full 15, most offer a
   * few afternoons around their own classes, and one or two can only manage a
   * single shift. Eighty hours across the roster, nobody before 9:00 AM, and
   * between them they cover 9:00 to 6:00 every day.
   */
  function sampleTutors() {
    return [
      // 15 h -- available the full week they are approved for
      { firstName: 'Anna', lastName: 'Harden', subjects: { ap1: true, ap2: true },
        availability: availability([[[MON, WED, FRI], '09:00', '14:00']]) },
      { firstName: 'Marcus', lastName: 'Bell', subjects: { bio: true },
        availability: availability([[[TUE, THU], '09:00', '14:00'], [[MON], '13:00', '18:00']]) },
      // 6-10 h -- the usual case, two or three shifts around classes
      { firstName: 'Priya', lastName: 'Raman', subjects: { ap1: true, micro: true },
        availability: availability([[[MON, WED], '14:00', '18:00'], [[FRI], '14:00', '16:00']]) },
      { firstName: 'Devon', lastName: 'Pierce', subjects: { ap1: true },
        availability: availability([[[TUE, THU], '14:00', '18:00']]) },
      { firstName: 'Sofia', lastName: 'Marín', subjects: { bio: true, micro: true },
        availability: availability([[[FRI], '09:00', '14:00'], [[WED], '15:00', '18:00']]) },
      { firstName: 'Jamal', lastName: 'Whitfield', subjects: { ap2: true },
        availability: availability([[[WED], '10:00', '14:00'], [[FRI], '14:00', '18:00']]) },
      { firstName: 'Hannah', lastName: 'Ochoa', subjects: { bio: true, ap1: true, ap2: true },
        availability: availability([[[TUE, THU], '12:00', '15:00']]) },
      // 3-4 h -- one shift is all their own timetable leaves
      { firstName: 'Eli', lastName: 'Novak', subjects: { micro: true },
        availability: availability([[[MON, WED], '10:00', '12:00']]) },
      { firstName: 'Anna', lastName: 'Henry', subjects: { ap1: true, ap2: true, micro: true },
        availability: availability([[[THU], '15:00', '18:00']]) },
      { firstName: 'Trent', lastName: 'Boyd', subjects: { bio: true, micro: true },
        availability: availability([[[TUE], '15:00', '18:00']]) }
    ];
  }

  function loadSample() {
    state = emptyState();
    sampleTutors().forEach(function (t) {
      t.maxHoursPerWeek = 15;
      addTutor(t);
    });
    recolorTutors();
    commit('sample');
  }

  TS.store = {
    STORAGE_KEY: STORAGE_KEY,
    get state() { return state; },
    defaultSettings: defaultSettings,
    emptyState: emptyState,
    availability: availability,
    sampleTutors: sampleTutors,
    recolorTutors: recolorTutors,
    on: on,
    emit: emit,
    commit: commit,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    clearHistory: clearHistory,
    save: save,
    storageAvailable: storageAvailable,
    load: load,
    migrate: migrate,
    normalizeTutor: normalizeTutor,
    normalizeAssignment: normalizeAssignment,
    addTutor: addTutor,
    getTutor: getTutor,
    removeTutor: removeTutor,
    addAssignment: addAssignment,
    getAssignment: getAssignment,
    removeAssignment: removeAssignment,
    mergeTouching: mergeTouching,
    slotsFor: slotsFor,
    totalSlots: totalSlots,
    toJson: toJson,
    fromJson: fromJson,
    replaceState: replaceState,
    reset: reset,
    loadSample: loadSample
  };
})(typeof window !== 'undefined' ? window : globalThis);
