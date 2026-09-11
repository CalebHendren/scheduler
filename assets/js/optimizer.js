(function (root) {
  'use strict';
  var TS = (root.TS = root.TS || {});
  var U = TS.util;

  var W_COVER1 = 100;   // any coverage dominates everything else
  var W_COVER2 = 45;    // second tutor in a slot
  var W_COVERN = 15;    // third and beyond, when the cap is raised
  var W_SUBJECT = 12;   // per distinct subject reachable in a slot
  var W_DUP = 6;        // per duplicated subject between concurrent tutors
  var W_SLOT = 2;       // per scheduled half hour
  var W_BLOCK = 8;      // per block, to discourage fragmentation
  var W_EQUITY = 2.0;   // per hour^2 away from an even split

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildContext(state) {
    var s = state.settings;
    var tutors = state.tutors.map(function (t, i) {
      var perDay = typeof t.maxHoursPerDay === 'number' ? t.maxHoursPerDay : s.maxHoursPerDay;
      return {
        index: i,
        id: t.id,
        mask: U.subjectMask(t.subjects),
        avail: t.availability,
        maxSlots: Math.round((t.maxHoursPerWeek || 0) * 2),
        minSlots: Math.round((t.minHoursPerWeek || 0) * 2),
        maxDaySlots: Math.round((perDay || 24) * 2),
        availSlots: t.availability.reduce(function (n, v) { return n + (v ? 1 : 0); }, 0)
      };
    });

    return {
      tutors: tutors,
      byId: tutors.reduce(function (m, t) { m[t.id] = t; return m; }, {}),
      minShift: Math.max(1, s.minShiftSlots || 1),
      maxConcurrent: Math.max(1, s.maxConcurrent || 2),
      maxRun: Math.max(1, Math.round((s.breakAfterHours || 6) * 2) - 1),
      breakSlots: Math.max(1, s.breakSlots || 1),
      budgetSlots: s.weeklyBudgetEnabled ? Math.round((s.weeklyBudgetHours || 0) * 2) : Infinity,
      equity: !!s.evenDistribution
    };
  }

  /* ---- solution state ------------------------------------------------- */

  function createSolution(ctx) {
    var sol = {
      ctx: ctx,
      blocks: [],
      slotTutors: [],
      tutorSlots: [],
      tutorDaySlots: [],
      tutorDayMap: [],
      assignedSlots: 0,
      coreScore: 0
    };
    var i;
    for (i = 0; i < U.TOTAL_SLOTS; i++) sol.slotTutors.push([]);
    for (i = 0; i < ctx.tutors.length; i++) {
      sol.tutorSlots.push(0);
      sol.tutorDaySlots.push([0, 0, 0, 0, 0]);
      var days = [];
      for (var d = 0; d < U.DAYS; d++) {
        var row = new Array(U.SLOTS_PER_DAY);
        for (var s = 0; s < U.SLOTS_PER_DAY; s++) row[s] = 0;
        days.push(row);
      }
      sol.tutorDayMap.push(days);
    }
    return sol;
  }

  function slotScore(ctx, occupants) {
    var n = occupants.length;
    if (n === 0) return 0;
    var score = W_COVER1;
    if (n >= 2) score += W_COVER2 + (n - 2) * W_COVERN;

    var union = 0, dup = 0, i, j;
    var counts = [0, 0, 0, 0];
    for (i = 0; i < n; i++) {
      var mask = ctx.tutors[occupants[i]].mask;
      union |= mask;
      for (j = 0; j < U.SUBJECTS.length; j++) {
        if (mask & U.SUBJECTS[j].bit) counts[j]++;
      }
    }
    score += U.popcount(union) * W_SUBJECT;
    for (j = 0; j < 4; j++) {
      if (counts[j] > 1) dup += counts[j] - 1;
    }
    return score - dup * W_DUP;
  }

  function equityPenalty(sol) {
    var ctx = sol.ctx;
    if (!ctx.equity) return 0;
    var active = ctx.tutors.filter(function (t) { return t.availSlots > 0 && t.maxSlots > 0; });
    if (!active.length) return 0;

    // A binding budget is the target to divide up; without one, whatever the
    // schedule currently spends is what gets shared out.
    var poolSlots = isFinite(ctx.budgetSlots) ? Math.min(ctx.budgetSlots, sol.assignedSlots) : sol.assignedSlots;
    var fairHours = (poolSlots / active.length) / 2;
    var penalty = 0;
    for (var i = 0; i < active.length; i++) {
      var hours = sol.tutorSlots[active[i].index] / 2;
      var d = hours - fairHours;
      penalty += d * d;
    }
    return penalty * W_EQUITY;
  }

  function totalScore(sol) { return sol.coreScore - equityPenalty(sol); }

  /* ---- feasibility ----------------------------------------------------- */

  function maxRunWith(row, start, end, add) {
    var best = 0, run = 0;
    for (var s = 0; s < U.SLOTS_PER_DAY; s++) {
      var on = row[s] > 0;
      if (add && s >= start && s < end) on = true;
      if (!add && s >= start && s < end) on = false;
      if (on) { run++; if (run > best) best = run; } else { run = 0; }
    }
    return best;
  }

  function canAdd(sol, tutorIndex, day, start, end) {
    var ctx = sol.ctx;
    var t = ctx.tutors[tutorIndex];
    var len = end - start;
    if (len < ctx.minShift) return false;
    if (start < 0 || end > U.SLOTS_PER_DAY) return false;
    if (sol.tutorSlots[tutorIndex] + len > t.maxSlots) return false;
    if (sol.tutorDaySlots[tutorIndex][day] + len > t.maxDaySlots) return false;
    if (sol.assignedSlots + len > ctx.budgetSlots) return false;

    var row = sol.tutorDayMap[tutorIndex][day];
    for (var s = start; s < end; s++) {
      if (!t.avail[U.idx(day, s)]) return false;
      if (row[s]) return false;
      if (sol.slotTutors[U.idx(day, s)].length >= ctx.maxConcurrent) return false;
    }
    if (maxRunWith(row, start, end, true) > ctx.maxRun) return false;
    return true;
  }

  /* ---- mutation, with exact incremental scoring ------------------------ */

  function applyAdd(sol, block) {
    var ctx = sol.ctx;
    var len = block.end - block.start;
    var row = sol.tutorDayMap[block.tutorIndex][block.day];
    for (var s = block.start; s < block.end; s++) {
      var i = U.idx(block.day, s);
      sol.coreScore -= slotScore(ctx, sol.slotTutors[i]);
      sol.slotTutors[i].push(block.tutorIndex);
      sol.coreScore += slotScore(ctx, sol.slotTutors[i]);
      row[s] = 1;
    }
    sol.tutorSlots[block.tutorIndex] += len;
    sol.tutorDaySlots[block.tutorIndex][block.day] += len;
    sol.assignedSlots += len;
    sol.coreScore += len * W_SLOT - W_BLOCK;
    sol.blocks.push(block);
    return block;
  }

  function applyRemove(sol, block) {
    var ctx = sol.ctx;
    var len = block.end - block.start;
    var row = sol.tutorDayMap[block.tutorIndex][block.day];
    for (var s = block.start; s < block.end; s++) {
      var i = U.idx(block.day, s);
      sol.coreScore -= slotScore(ctx, sol.slotTutors[i]);
      var at = sol.slotTutors[i].indexOf(block.tutorIndex);
      if (at !== -1) sol.slotTutors[i].splice(at, 1);
      sol.coreScore += slotScore(ctx, sol.slotTutors[i]);
      row[s] = 0;
    }
    sol.tutorSlots[block.tutorIndex] -= len;
    sol.tutorDaySlots[block.tutorIndex][block.day] -= len;
    sol.assignedSlots -= len;
    sol.coreScore -= len * W_SLOT - W_BLOCK;
    var bi = sol.blocks.indexOf(block);
    if (bi !== -1) sol.blocks.splice(bi, 1);
    return block;
  }

  // Gain of adding a block, without touching the solution.
  function gainOfAdd(sol, tutorIndex, day, start, end) {
    var ctx = sol.ctx;
    var gain = 0;
    for (var s = start; s < end; s++) {
      var i = U.idx(day, s);
      var before = slotScore(ctx, sol.slotTutors[i]);
      sol.slotTutors[i].push(tutorIndex);
      var after = slotScore(ctx, sol.slotTutors[i]);
      sol.slotTutors[i].pop();
      gain += after - before;
    }
    return gain + (end - start) * W_SLOT - W_BLOCK;
  }

  function makeBlock(tutorIndex, day, start, end, locked, id) {
    return {
      id: id || null,
      tutorIndex: tutorIndex,
      day: day,
      start: start,
      end: end,
      locked: !!locked
    };
  }

  /* A tutor who works 5:00-6:00 and again 6:00-7:30 is working one shift, not
   * two, so the solver's fragments are stitched back together on the way out.
   * No constraint shifts: the break rule already measures the occupied run
   * rather than the block, and a longer block only clears the minimum more
   * comfortably. Locked blocks keep the boundaries the user drew.
   */
  function mergeAdjacent(blocks) {
    var sorted = blocks.slice().sort(function (a, b) {
      return a.tutorIndex - b.tutorIndex || a.day - b.day || a.start - b.start;
    });
    var merged = [];
    sorted.forEach(function (b) {
      var prev = merged[merged.length - 1];
      if (prev && !prev.locked && !b.locked &&
          prev.tutorIndex === b.tutorIndex && prev.day === b.day && prev.end === b.start) {
        prev.end = b.end;
        return;
      }
      merged.push(makeBlock(b.tutorIndex, b.day, b.start, b.end, b.locked, b.id));
    });
    return merged;
  }

  function cloneSolution(sol) {
    var copy = createSolution(sol.ctx);
    sol.blocks.forEach(function (b) {
      applyAdd(copy, makeBlock(b.tutorIndex, b.day, b.start, b.end, b.locked, b.id));
    });
    return copy;
  }

  /* ---- phase 1: greedy construction ------------------------------------ */

  // onlyIndex, when given, restricts the fill to a single tutor; everything
  // already in the solution is left where it is either way.
  function greedy(sol, onlyIndex) {
    var ctx = sol.ctx;
    var improved = true;
    var guard = 0;

    while (improved && guard++ < 500) {
      improved = false;
      var best = null, bestRate = 0;

      for (var ti = 0; ti < ctx.tutors.length; ti++) {
        if (typeof onlyIndex === 'number' && ti !== onlyIndex) continue;
        for (var d = 0; d < U.DAYS; d++) {
          for (var start = 0; start < U.SLOTS_PER_DAY; start++) {
            if (!ctx.tutors[ti].avail[U.idx(d, start)]) continue;
            var maxLen = Math.min(ctx.maxRun, U.SLOTS_PER_DAY - start);
            for (var len = ctx.minShift; len <= maxLen; len++) {
              var end = start + len;
              if (!canAdd(sol, ti, d, start, end)) continue;
              var gain = gainOfAdd(sol, ti, d, start, end);
              if (gain <= 0) continue;
              var rate = gain / len;
              if (rate > bestRate) {
                bestRate = rate;
                best = makeBlock(ti, d, start, end);
              }
            }
          }
        }
      }

      if (best) {
        applyAdd(sol, best);
        improved = true;
      }
    }
    return sol;
  }

  /* ---- phase 2: simulated annealing ------------------------------------ */

  function randomWindow(rand, ctx, tutorIndex, day) {
    var t = ctx.tutors[tutorIndex];
    var starts = [];
    for (var s = 0; s < U.SLOTS_PER_DAY; s++) {
      if (t.avail[U.idx(day, s)]) starts.push(s);
    }
    if (!starts.length) return null;
    var start = starts[Math.floor(rand() * starts.length)];
    var maxLen = Math.min(ctx.maxRun, U.SLOTS_PER_DAY - start);
    if (maxLen < ctx.minShift) return null;
    var len = ctx.minShift + Math.floor(rand() * (maxLen - ctx.minShift + 1));
    return { start: start, end: start + len };
  }

  function unlockedBlocks(sol) {
    return sol.blocks.filter(function (b) { return !b.locked; });
  }

  function isRedundant(sol, block) {
    for (var s = block.start; s < block.end; s++) {
      if (sol.slotTutors[U.idx(block.day, s)].length < 2) return false;
    }
    return true;
  }

  /*
   * Targeted repair of an uncovered slot, evicting a block when the budget or
   * an hour cap is already spent.
   *
   * Single add/remove moves cannot fix a hole once the budget is exhausted:
   * freeing the hours first makes the schedule strictly worse, so annealing
   * rejects the intermediate step and the hole survives to the end. Proposing
   * the eviction and the fill as one atomic move is what lets coverage win.
   */
  function proposeRepair(sol, rand) {
    var ctx = sol.ctx;
    var empties = [];
    for (var i = 0; i < U.TOTAL_SLOTS; i++) {
      if (sol.slotTutors[i].length === 0) empties.push(i);
    }
    if (!empties.length) return null;

    var pick = empties[Math.floor(rand() * empties.length)];
    var day = Math.floor(pick / U.SLOTS_PER_DAY);
    var slot = pick % U.SLOTS_PER_DAY;

    var candidates = [];
    for (var k = 0; k < ctx.tutors.length; k++) {
      if (ctx.tutors[k].avail[pick]) candidates.push(ctx.tutors[k]);
    }
    if (!candidates.length) return null;
    var t = candidates[Math.floor(rand() * candidates.length)];

    // Grow the shift outward from the hole until it reaches the minimum length.
    var start = slot, end = slot + 1;
    while (end - start < ctx.minShift) {
      var canRight = end < U.SLOTS_PER_DAY && t.avail[U.idx(day, end)];
      var canLeft = start > 0 && t.avail[U.idx(day, start - 1)];
      if (canRight && (!canLeft || rand() < 0.5)) end++;
      else if (canLeft) start--;
      else break;
    }
    if (end - start < ctx.minShift) return null;

    var addition = makeBlock(t.index, day, start, end);
    if (canAdd(sol, t.index, day, start, end)) {
      return { removals: [], additions: [addition] };
    }

    var pool = unlockedBlocks(sol);
    if (!pool.length) return null;

    var ownCapBlocks = sol.tutorSlots[t.index] + (end - start) > t.maxSlots;
    var preferred = pool.filter(function (b) {
      return ownCapBlocks ? b.tutorIndex === t.index : isRedundant(sol, b);
    });
    var source = preferred.length ? preferred : pool;
    return { removals: [source[Math.floor(rand() * source.length)]], additions: [addition] };
  }

  function proposeMove(sol, rand) {
    var ctx = sol.ctx;
    if (!ctx.tutors.length) return null;

    if (rand() < 0.25) {
      var repair = proposeRepair(sol, rand);
      if (repair) return repair;
    }

    var pool = unlockedBlocks(sol);
    var kind = rand();
    var removals = [];
    var additions = [];
    var b, w, ti, d;

    if (kind < 0.28 || !pool.length) {
      ti = Math.floor(rand() * ctx.tutors.length);
      d = Math.floor(rand() * U.DAYS);
      w = randomWindow(rand, ctx, ti, d);
      if (!w) return null;
      additions.push(makeBlock(ti, d, w.start, w.end));
    } else if (kind < 0.40) {
      removals.push(pool[Math.floor(rand() * pool.length)]);
    } else if (kind < 0.58) {
      b = pool[Math.floor(rand() * pool.length)];
      var shift = rand() < 0.5 ? -1 : 1;
      removals.push(b);
      additions.push(makeBlock(b.tutorIndex, b.day, b.start + shift, b.end + shift));
    } else if (kind < 0.74) {
      b = pool[Math.floor(rand() * pool.length)];
      var grow = rand() < 0.5 ? 1 : -1;
      var edge = rand() < 0.5;
      removals.push(b);
      additions.push(makeBlock(
        b.tutorIndex, b.day,
        edge ? b.start - grow : b.start,
        edge ? b.end : b.end + grow
      ));
    } else if (kind < 0.86) {
      b = pool[Math.floor(rand() * pool.length)];
      ti = Math.floor(rand() * ctx.tutors.length);
      if (ti === b.tutorIndex) return null;
      removals.push(b);
      additions.push(makeBlock(ti, b.day, b.start, b.end));
    } else if (kind < 0.94) {
      b = pool[Math.floor(rand() * pool.length)];
      d = Math.floor(rand() * U.DAYS);
      if (d === b.day) return null;
      removals.push(b);
      additions.push(makeBlock(b.tutorIndex, d, b.start, b.end));
    } else {
      // Split a long block around a break -- the move that satisfies the
      // six-hour rule without simply deleting hours.
      b = pool[Math.floor(rand() * pool.length)];
      var len = b.end - b.start;
      if (len < ctx.minShift * 2 + ctx.breakSlots) return null;
      var cut = b.start + ctx.minShift + Math.floor(rand() * (len - ctx.minShift * 2 - ctx.breakSlots + 1));
      removals.push(b);
      additions.push(makeBlock(b.tutorIndex, b.day, b.start, cut));
      additions.push(makeBlock(b.tutorIndex, b.day, cut + ctx.breakSlots, b.end));
    }

    return { removals: removals, additions: additions };
  }

  function tryMove(sol, move) {
    var before = totalScore(sol);
    var undone = [];
    var added = [];
    var i;

    for (i = 0; i < move.removals.length; i++) {
      applyRemove(sol, move.removals[i]);
      undone.push(move.removals[i]);
    }

    var ok = true;
    for (i = 0; i < move.additions.length; i++) {
      var a = move.additions[i];
      if (!canAdd(sol, a.tutorIndex, a.day, a.start, a.end)) { ok = false; break; }
      applyAdd(sol, a);
      added.push(a);
    }

    if (!ok) {
      for (i = added.length - 1; i >= 0; i--) applyRemove(sol, added[i]);
      for (i = undone.length - 1; i >= 0; i--) applyAdd(sol, undone[i]);
      return null;
    }

    return { delta: totalScore(sol) - before, added: added, undone: undone };
  }

  function rollback(sol, result) {
    for (var i = result.added.length - 1; i >= 0; i--) applyRemove(sol, result.added[i]);
    for (var j = result.undone.length - 1; j >= 0; j--) applyAdd(sol, result.undone[j]);
  }

  /* ---- solver ---------------------------------------------------------- */

  function createSolver(state, opts) {
    opts = opts || {};
    var ctx = buildContext(state);
    var rand = mulberry32(opts.seed || 20260910);
    var iterations = opts.iterations || 120000;
    var sol = createSolution(ctx);

    // Locked blocks are laid down first and never removed, so a manual
    // placement survives re-optimization exactly as the user left it.
    state.assignments.forEach(function (a) {
      if (!a.locked) return;
      var t = ctx.byId[a.tutorId];
      if (!t) return;
      applyAdd(sol, makeBlock(t.index, a.day, a.startSlot, a.endSlot, true, a.id));
    });

    var phase = 'greedy';
    var done = false;
    var iter = 0;
    var best = null;
    var bestScore = -Infinity;
    var T0 = 60, T1 = 0.5;

    function snapshot() {
      best = sol.blocks.map(function (b) {
        return makeBlock(b.tutorIndex, b.day, b.start, b.end, b.locked, b.id);
      });
      bestScore = totalScore(sol);
    }

    function step(budgetIterations) {
      if (done) return true;

      if (phase === 'greedy') {
        greedy(sol);
        snapshot();
        phase = 'anneal';
        return false;
      }

      var n = Math.min(budgetIterations || 4000, iterations - iter);
      for (var k = 0; k < n; k++, iter++) {
        var temp = T0 * Math.pow(T1 / T0, iter / iterations);
        var move = proposeMove(sol, rand);
        if (!move) continue;
        var res = tryMove(sol, move);
        if (!res) continue;

        var accept = res.delta >= 0 || rand() < Math.exp(res.delta / temp);
        if (!accept) {
          rollback(sol, res);
          continue;
        }
        if (totalScore(sol) > bestScore) snapshot();
      }

      if (iter >= iterations) {
        done = true;
        return true;
      }
      return false;
    }

    return {
      ctx: ctx,
      step: step,
      get progress() { return phase === 'greedy' ? 0 : Math.min(1, iter / iterations); },
      get done() { return done; },
      get bestScore() { return bestScore; },
      result: function () {
        return mergeAdjacent(best || []).map(function (b) {
          return {
            id: b.id || U.uid('shift'),
            tutorId: ctx.tutors[b.tutorIndex].id,
            day: b.day,
            startSlot: b.start,
            endSlot: b.end,
            locked: !!b.locked,
            overCapacity: false
          };
        });
      }
    };
  }

  // Synchronous convenience wrapper, used by the Node test suite.
  function optimize(state, opts) {
    var solver = createSolver(state, opts);
    var guard = 0;
    while (!solver.step(8000) && guard++ < 100000) { /* keep stepping */ }
    return solver.result();
  }

  /* ---- fitting a single tutor ------------------------------------------
   * Mid-semester hires are the normal case for this, and re-running the whole
   * optimizer would reshuffle shifts people have already been told they are
   * working. So everyone else's blocks are treated as immovable and only the
   * named tutor's hours are placed, into whichever open times the schedule
   * values most.
   */
  function fitTutor(state, tutorId, opts) {
    opts = opts || {};
    var ctx = buildContext(state);
    var t = ctx.byId[tutorId];
    var unchanged = { assignments: state.assignments.slice(), added: [], addedSlots: 0, replaced: 0 };
    if (!t) return unchanged;

    // Existing shifts for this tutor are rebuilt from scratch unless they are
    // locked, which is what makes the button safe to press twice.
    var kept = [];
    var replaced = 0;
    state.assignments.forEach(function (a) {
      if (a.tutorId !== tutorId || a.locked) kept.push(a);
      else replaced++;
    });

    var sol = solutionFromAssignments(ctx, kept);
    var existing = sol.blocks.length;
    greedy(sol, t.index);

    var fresh = mergeAdjacent(sol.blocks.slice(existing)).map(function (b) {
      return {
        id: U.uid('shift'),
        tutorId: tutorId,
        day: b.day,
        startSlot: b.start,
        endSlot: b.end,
        locked: false,
        overCapacity: false
      };
    });

    var addedSlots = fresh.reduce(function (n, a) { return n + (a.endSlot - a.startSlot); }, 0);
    return {
      assignments: kept.concat(fresh),
      added: fresh,
      addedSlots: addedSlots,
      replaced: replaced
    };
  }

  /* ---- reporting ------------------------------------------------------- */

  function solutionFromAssignments(ctx, assignments) {
    var sol = createSolution(ctx);
    assignments.forEach(function (a) {
      var t = ctx.byId[a.tutorId];
      if (!t) return;
      applyAdd(sol, makeBlock(t.index, a.day, a.startSlot, a.endSlot, a.locked, a.id));
    });
    return sol;
  }

  function stats(state, assignments) {
    var ctx = buildContext(state);
    var sol = solutionFromAssignments(ctx, assignments);
    var covered = 0, doubled = 0, subjectSum = 0;
    for (var i = 0; i < U.TOTAL_SLOTS; i++) {
      var n = sol.slotTutors[i].length;
      if (n >= 1) covered++;
      if (n >= 2) doubled++;
      var union = 0;
      for (var j = 0; j < n; j++) union |= ctx.tutors[sol.slotTutors[i][j]].mask;
      subjectSum += U.popcount(union);
    }
    var perTutor = ctx.tutors.map(function (t) {
      return { id: t.id, hours: sol.tutorSlots[t.index] / 2 };
    });
    return {
      totalHours: sol.assignedSlots / 2,
      coveredSlots: covered,
      totalSlots: U.TOTAL_SLOTS,
      doubledHours: doubled / 2,
      avgSubjects: covered ? subjectSum / covered : 0,
      score: totalScore(sol),
      perTutor: perTutor,
      overCapacitySlots: sol.slotTutors.reduce(function (n, list) {
        return n + (list.length > ctx.maxConcurrent ? 1 : 0);
      }, 0)
    };
  }

  /*
   * Every hard constraint, checked from the outside. The optimizer's move
   * generator should make these unreachable; the suite asserts it did.
   */
  function validate(state, assignments) {
    var ctx = buildContext(state);
    var sol = solutionFromAssignments(ctx, assignments);
    var problems = [];
    var i, d, s;

    assignments.forEach(function (a) {
      var t = ctx.byId[a.tutorId];
      if (!t) { problems.push('unknown tutor ' + a.tutorId); return; }
      if (a.endSlot - a.startSlot < ctx.minShift) {
        problems.push(t.id + ' has a block shorter than the minimum shift');
      }
      for (var s2 = a.startSlot; s2 < a.endSlot; s2++) {
        if (!t.avail[U.idx(a.day, s2)]) {
          problems.push(t.id + ' is scheduled outside their availability on day ' + a.day);
          break;
        }
      }
    });

    for (i = 0; i < U.TOTAL_SLOTS; i++) {
      if (sol.slotTutors[i].length > ctx.maxConcurrent) {
        var manual = assignments.some(function (a) {
          return a.overCapacity && U.idx(a.day, a.startSlot) <= i && U.idx(a.day, a.endSlot) > i;
        });
        if (!manual) problems.push('slot ' + i + ' exceeds the concurrency cap');
      }
    }

    ctx.tutors.forEach(function (t) {
      if (sol.tutorSlots[t.index] > t.maxSlots) {
        problems.push(t.id + ' exceeds their weekly hour cap');
      }
      for (var day = 0; day < U.DAYS; day++) {
        if (sol.tutorDaySlots[t.index][day] > t.maxDaySlots) {
          problems.push(t.id + ' exceeds their daily hour cap on day ' + day);
        }
        var run = 0;
        var row = sol.tutorDayMap[t.index][day];
        for (var slot = 0; slot < U.SLOTS_PER_DAY; slot++) {
          if (row[slot]) {
            run++;
            if (run > ctx.maxRun) {
              problems.push(t.id + ' works past the break threshold on day ' + day);
              break;
            }
          } else { run = 0; }
        }
      }
    });

    if (isFinite(ctx.budgetSlots) && sol.assignedSlots > ctx.budgetSlots) {
      problems.push('total scheduled hours exceed the weekly budget');
    }

    return problems;
  }

  /*
   * Why a slot went unfilled. The three reasons are genuinely different
   * problems for the coordinator: nobody available needs hiring, hour-capped
   * needs a cap raised, budget-limited needs money.
   */
  function analyzeGaps(state, assignments) {
    var ctx = buildContext(state);
    var sol = solutionFromAssignments(ctx, assignments);
    var gaps = [];
    var budgetSpent = isFinite(ctx.budgetSlots) && sol.assignedSlots >= ctx.budgetSlots;

    for (var d = 0; d < U.DAYS; d++) {
      var run = null;
      for (var s = 0; s <= U.SLOTS_PER_DAY; s++) {
        var empty = s < U.SLOTS_PER_DAY && sol.slotTutors[U.idx(d, s)].length === 0;
        if (empty && !run) {
          run = { day: d, start: s, end: s + 1, reason: reasonFor(ctx, sol, d, s, budgetSpent) };
        } else if (empty) {
          run.end = s + 1;
          var r = reasonFor(ctx, sol, d, s, budgetSpent);
          if (r !== run.reason) run.reason = 'mixed';
        } else if (run) {
          gaps.push(run);
          run = null;
        }
      }
      if (run) gaps.push(run);
    }
    return gaps;
  }

  // Could this tutor hold a legal minimum-length shift covering this slot?
  function couldFit(ctx, t, day, slot) {
    var lo = slot, hi = slot;
    while (hi - lo + 1 < ctx.minShift) {
      var grewRight = hi + 1 < U.SLOTS_PER_DAY && t.avail[U.idx(day, hi + 1)];
      var grewLeft = lo - 1 >= 0 && t.avail[U.idx(day, lo - 1)];
      if (grewRight) hi++;
      else if (grewLeft) lo--;
      else return false;
    }
    return true;
  }

  function reasonFor(ctx, sol, day, slot, budgetSpent) {
    var i = U.idx(day, slot);
    var anyAvailable = false, anyWithHours = false, anyPlaceable = false;

    for (var k = 0; k < ctx.tutors.length; k++) {
      var t = ctx.tutors[k];
      if (!t.avail[i]) continue;
      anyAvailable = true;
      if (sol.tutorSlots[t.index] + ctx.minShift > t.maxSlots) continue;
      anyWithHours = true;
      if (couldFit(ctx, t, day, slot)) anyPlaceable = true;
    }

    if (!anyAvailable) return 'unavailable';
    if (budgetSpent) return 'budget';
    if (!anyWithHours) return 'capped';
    // Somebody can legally work here, so the hole is simply unscheduled --
    // saying "break rules" here would send the coordinator chasing a
    // constraint that is not actually binding.
    if (anyPlaceable) return 'unscheduled';
    return 'rest';
  }

  var GAP_REASONS = {
    unavailable: 'No tutor is available',
    capped: 'Every available tutor is at their weekly cap',
    budget: 'The weekly hour budget is spent',
    unscheduled: 'A tutor could cover this — try Auto-optimize',
    rest: 'Break and shift-length rules block a placement',
    mixed: 'Several reasons across this stretch'
  };

  TS.optimizer = {
    WEIGHTS: {
      cover1: W_COVER1, cover2: W_COVER2, coverN: W_COVERN,
      subject: W_SUBJECT, dup: W_DUP, slot: W_SLOT, block: W_BLOCK, equity: W_EQUITY
    },
    GAP_REASONS: GAP_REASONS,
    buildContext: buildContext,
    createSolver: createSolver,
    optimize: optimize,
    fitTutor: fitTutor,
    validate: validate,
    stats: stats,
    analyzeGaps: analyzeGaps,
    slotScore: slotScore,
    mergeAdjacent: mergeAdjacent,
    mulberry32: mulberry32
  };
})(typeof window !== 'undefined' ? window : globalThis);
