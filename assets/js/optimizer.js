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
  var W_RETURN = 70;    // per time a tutor is sent away and asked back the same day
  var W_IDLE = 6;       // per half hour they spend waiting to come back

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
      return {
        index: i,
        id: t.id,
        mask: U.subjectMask(t.subjects),
        avail: t.availability,
        maxSlots: Math.round((t.maxHoursPerWeek || 0) * 2),
        minSlots: Math.round((t.minHoursPerWeek || 0) * 2),
        availSlots: t.availability.reduce(function (n, v) { return n + (v ? 1 : 0); }, 0)
      };
    });

    return {
      tutors: tutors,
      byId: tutors.reduce(function (m, t) { m[t.id] = t; return m; }, {}),
      minShift: Math.max(1, s.minShiftSlots || 1),
      caps: U.capRules(s),
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
      tutorDayMap: [],
      centerMap: [],
      returnPenalty: [],
      assignedSlots: 0,
      coreScore: 0
    };
    var i;
    for (i = 0; i < U.TOTAL_SLOTS; i++) sol.slotTutors.push([]);
    for (i = 0; i < ctx.tutors.length; i++) {
      sol.tutorSlots.push(0);
      sol.tutorDayMap.push(emptyWeek());
      sol.centerMap.push(emptyWeek());
      sol.returnPenalty.push([0, 0, 0, 0, 0]);
    }
    return sol;
  }

  function emptyWeek() {
    var days = [];
    for (var d = 0; d < U.DAYS; d++) {
      var row = new Array(U.SLOTS_PER_DAY);
      for (var s = 0; s < U.SLOTS_PER_DAY; s++) row[s] = 0;
      days.push(row);
    }
    return days;
  }

  function slotScore(ctx, occupants) {
    var n = occupants.length;
    if (n === 0) return 0;
    var score = W_COVER1;
    if (n >= 2) score += W_COVER2 + (n - 2) * W_COVERN;

    var union = 0, dup = 0, i, j;
    var counts = [];
    for (j = 0; j < U.SUBJECTS.length; j++) counts.push(0);
    for (i = 0; i < n; i++) {
      var mask = ctx.tutors[occupants[i]].mask;
      union |= mask;
      for (j = 0; j < U.SUBJECTS.length; j++) {
        if (mask & U.SUBJECTS[j].bit) counts[j]++;
      }
    }
    score += U.popcount(union) * W_SUBJECT;
    for (j = 0; j < counts.length; j++) {
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

  /* ---- continuous shifts ----
   * A tutor should only have to leave and come back when something makes them:
   * a class of their own, which is a hole in the availability they handed in,
   * or the break the six-hour rule demands. Any other gap between two of their
   * shifts on one day is them hanging around campus unpaid, and costs a flat
   * amount for being sent away plus a little for every half hour of waiting.
   * A gap the break rule forced is charged only for what it runs past the
   * break itself.
   *
   * `addStart`/`addEnd` count a block as worked without placing it, which is
   * how a candidate is priced before it is added. Returns one entry per gap:
   * { start, end, cost }.
   */
  function gapCosts(ctx, t, day, row, addStart, addEnd) {
    var runs = [], open = -1;
    for (var s = 0; s <= U.SLOTS_PER_DAY; s++) {
      var on = s < U.SLOTS_PER_DAY && (row[s] || (s >= addStart && s < addEnd));
      if (on && open === -1) open = s;
      else if (!on && open !== -1) { runs.push([open, s]); open = -1; }
    }

    var gaps = [];
    for (var i = 1; i < runs.length; i++) {
      var from = runs[i - 1][1], to = runs[i][0];
      var inClass = false;
      for (var g = from; g < to; g++) {
        if (!t.avail[U.idx(day, g)]) { inClass = true; break; }
      }
      var gap = to - from;
      var joined = (runs[i - 1][1] - runs[i - 1][0]) + gap + (runs[i][1] - runs[i][0]);
      var cost = inClass ? 0
        : joined > ctx.maxRun ? W_IDLE * Math.max(0, gap - ctx.breakSlots)
        : W_RETURN + W_IDLE * gap;
      gaps.push({ start: from, end: to, cost: cost });
    }
    return gaps;
  }

  function returnPenaltyOf(ctx, t, day, row, addStart, addEnd) {
    return gapCosts(ctx, t, day, row, addStart, addEnd)
      .reduce(function (n, g) { return n + g.cost; }, 0);
  }

  function refreshReturnPenalty(sol, tutorIndex, day) {
    var ctx = sol.ctx;
    var next = returnPenaltyOf(ctx, ctx.tutors[tutorIndex], day,
      sol.tutorDayMap[tutorIndex][day], -1, -1);
    sol.coreScore += sol.returnPenalty[tutorIndex][day] - next;
    sol.returnPenalty[tutorIndex][day] = next;
  }

  /* ---- the center's caps ----
   * U.capRules has the rule; this is the same thing read off the solver's own
   * maps, so a candidate can be priced without building assignments.
   *
   * Whether a tutor has been at the center without a break from the half hour
   * before the evening through `slot`, optionally counting a block not yet
   * placed.
   */
  function carriesThrough(sol, tutorIndex, day, slot, addStart, addEnd) {
    var cutoff = sol.ctx.caps.cutoff;
    if (cutoff <= 0) return false;
    var row = sol.centerMap[tutorIndex][day];
    for (var s = cutoff - 1; s <= slot; s++) {
      if (!row[s] && !(s >= addStart && s < addEnd)) return false;
    }
    return true;
  }

  function limitAt(sol, day, slot) {
    var caps = sol.ctx.caps;
    if (slot < caps.cutoff) return caps.day;
    var list = sol.slotTutors[U.idx(day, slot)];
    var carrying = 0;
    for (var k = 0; k < list.length; k++) {
      if (carriesThrough(sol, list[k], day, slot, -1, -1)) carrying++;
    }
    return U.capLimit(caps, slot, carrying);
  }

  // Half hours on a day with more tutors at the center than it may hold.
  function overCapCount(sol, day) {
    var n = 0;
    for (var s = 0; s < U.SLOTS_PER_DAY; s++) {
      if (sol.slotTutors[U.idx(day, s)].length > limitAt(sol, day, s)) n++;
    }
    return n;
  }

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
    if (sol.assignedSlots + len > ctx.budgetSlots) return false;

    var row = sol.tutorDayMap[tutorIndex][day];
    for (var s = start; s < end; s++) {
      if (!t.avail[U.idx(day, s)]) return false;
      if (row[s]) return false;
    }
    for (s = start; s < end; s++) {
      var list = sol.slotTutors[U.idx(day, s)];
      if (s < ctx.caps.cutoff) {
        if (list.length >= ctx.caps.day) return false;
        continue;
      }
      var carrying = carriesThrough(sol, tutorIndex, day, s, start, end) ? 1 : 0;
      for (var k = 0; k < list.length; k++) {
        if (carriesThrough(sol, list[k], day, s, -1, -1)) carrying++;
      }
      if (list.length + 1 > U.capLimit(ctx.caps, s, carrying)) return false;
    }
    if (maxRunWith(row, start, end, true) > ctx.maxRun) return false;
    return true;
  }

  /* ---- mutation, with exact incremental scoring ------------------------ */

  /* An off-room block -- an embedded class or an open lab -- occupies the tutor
   * and spends the budget, but it staffs a room the schedule is not about. So
   * it takes no place in slotTutors and earns no coverage score: that single
   * asymmetry is what keeps the concurrency cap and the coverage report about
   * the tutoring center, while the tutor's own caps and break rule still see
   * every hour they work.
   */
  function applyAdd(sol, block) {
    var ctx = sol.ctx;
    var len = block.end - block.start;
    var row = sol.tutorDayMap[block.tutorIndex][block.day];
    for (var s = block.start; s < block.end; s++) {
      var i = U.idx(block.day, s);
      if (!block.offRoom) {
        sol.coreScore -= slotScore(ctx, sol.slotTutors[i]);
        sol.slotTutors[i].push(block.tutorIndex);
        sol.coreScore += slotScore(ctx, sol.slotTutors[i]);
        sol.centerMap[block.tutorIndex][block.day][s] = 1;
      }
      row[s] = 1;
    }
    refreshReturnPenalty(sol, block.tutorIndex, block.day);
    sol.tutorSlots[block.tutorIndex] += len;
    sol.assignedSlots += len;
    if (!block.offRoom) sol.coreScore += len * W_SLOT - W_BLOCK;
    sol.blocks.push(block);
    return block;
  }

  function applyRemove(sol, block) {
    var ctx = sol.ctx;
    var len = block.end - block.start;
    var row = sol.tutorDayMap[block.tutorIndex][block.day];
    for (var s = block.start; s < block.end; s++) {
      var i = U.idx(block.day, s);
      if (!block.offRoom) {
        sol.coreScore -= slotScore(ctx, sol.slotTutors[i]);
        var at = sol.slotTutors[i].indexOf(block.tutorIndex);
        if (at !== -1) sol.slotTutors[i].splice(at, 1);
        sol.coreScore += slotScore(ctx, sol.slotTutors[i]);
        sol.centerMap[block.tutorIndex][block.day][s] = 0;
      }
      row[s] = 0;
    }
    refreshReturnPenalty(sol, block.tutorIndex, block.day);
    sol.tutorSlots[block.tutorIndex] -= len;
    sol.assignedSlots -= len;
    if (!block.offRoom) sol.coreScore -= len * W_SLOT - W_BLOCK;
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
    var returns = returnPenaltyOf(ctx, ctx.tutors[tutorIndex], day,
      sol.tutorDayMap[tutorIndex][day], start, end);
    return gain + (end - start) * W_SLOT - W_BLOCK -
      (returns - sol.returnPenalty[tutorIndex][day]);
  }

  function makeBlock(tutorIndex, day, start, end, locked, id, offRoom) {
    return {
      id: id || null,
      tutorIndex: tutorIndex,
      day: day,
      start: start,
      end: end,
      locked: !!locked,
      offRoom: !!offRoom
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
      if (prev && !prev.locked && !b.locked && !prev.offRoom && !b.offRoom &&
          prev.tutorIndex === b.tutorIndex && prev.day === b.day && prev.end === b.start) {
        prev.end = b.end;
        return;
      }
      merged.push(makeBlock(b.tutorIndex, b.day, b.start, b.end, b.locked, b.id, b.offRoom));
    });
    return merged;
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

  /* Taking away the half hour before the evening can turn a tutor who was
   * carrying on into one arriving in it, and so put a day over the evening cap
   * without anything being added there. canAdd only sees additions, so the days
   * a move touches are counted before and after it.
   */
  function touchedDays(move) {
    var days = [];
    move.removals.concat(move.additions).forEach(function (b) {
      if (days.indexOf(b.day) === -1) days.push(b.day);
    });
    return days;
  }

  function overOn(sol, days) {
    var n = 0;
    for (var i = 0; i < days.length; i++) n += overCapCount(sol, days[i]);
    return n;
  }

  function tryMove(sol, move) {
    var before = totalScore(sol);
    var undone = [];
    var added = [];
    var i;
    var days = move.removals.length && sol.ctx.caps.cutoff < U.SLOTS_PER_DAY
      ? touchedDays(move) : null;
    var overBefore = days ? overOn(sol, days) : 0;

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
    if (ok && days && overOn(sol, days) > overBefore) ok = false;

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

    /* Locked blocks are laid down first and never removed, so a manual
     * placement survives re-optimization exactly as the user left it. An
     * embedded class or an open lab is fixed in the same way whether or not it
     * was locked -- it is tied to a real class in a real room, and not
     * something the optimizer is entitled to invent, move or take away.
     */
    var fixed = {};
    state.assignments.forEach(function (a) {
      if (!a.locked && U.inMainRoom(a)) return;
      var t = ctx.byId[a.tutorId];
      if (!t) return;
      fixed[a.id] = a;
      applyAdd(sol, makeBlock(t.index, a.day, a.startSlot, a.endSlot, true, a.id, U.offRoom(a)));
    });

    var phase = 'greedy';
    var done = false;
    var iter = 0;
    var best = null;
    var bestScore = -Infinity;
    var T0 = 60, T1 = 0.5;

    function snapshot() {
      best = sol.blocks.map(function (b) {
        return makeBlock(b.tutorIndex, b.day, b.start, b.end, b.locked, b.id, b.offRoom);
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
          // A fixed block comes back out as the user wrote it, room and lock
          // included -- the solver only ever held it in place.
          var was = b.id ? fixed[b.id] : null;
          return {
            id: b.id || U.uid('shift'),
            tutorId: ctx.tutors[b.tutorIndex].id,
            day: b.day,
            startSlot: b.start,
            endSlot: b.end,
            kind: was ? was.kind : 'main',
            room: was ? was.room : '',
            locked: was ? !!was.locked : !!b.locked,
            overCapacity: was ? !!was.overCapacity : false
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
    // locked, which is what makes the button safe to press twice. An embedded
    // class or an open lab is kept either way: it is not the optimizer's to
    // redraw, and the hours it spends are what the rest has to fit around.
    var kept = [];
    var replaced = 0;
    state.assignments.forEach(function (a) {
      if (a.tutorId !== tutorId || a.locked || U.offRoom(a)) kept.push(a);
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
        kind: 'main',
        room: '',
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
      applyAdd(sol, makeBlock(t.index, a.day, a.startSlot, a.endSlot, a.locked, a.id, U.offRoom(a)));
    });
    return sol;
  }

  /* Coverage is reported over the hours the centre is actually open -- the 9-to-5
   * core, widened to whatever anyone is available for. Counting 7:00 AM against
   * a roster where nobody works mornings would report two thirds of the week as
   * uncovered and give the coordinator nothing to act on.
   *
   * Coverage means a tutor at the centre. An embedded class or an open lab is
   * counted in totalHours, and reported separately as offRoomHours, but it
   * leaves the desk empty and the hole it leaves is reported as one.
   */
  function stats(state, assignments) {
    var ctx = buildContext(state);
    var sol = solutionFromAssignments(ctx, assignments);
    var win = U.editorWindow(state.tutors, U.mainShifts(assignments));
    var covered = 0, doubled = 0, subjectSum = 0, openSlots = 0;
    for (var d = 0; d < U.DAYS; d++) {
      for (var s = win.start; s < win.end; s++) {
        var i = U.idx(d, s);
        openSlots++;
        var n = sol.slotTutors[i].length;
        if (n >= 1) covered++;
        if (n >= 2) doubled++;
        var union = 0;
        for (var j = 0; j < n; j++) union |= ctx.tutors[sol.slotTutors[i][j]].mask;
        subjectSum += U.popcount(union);
      }
    }
    var perTutor = ctx.tutors.map(function (t) {
      return { id: t.id, hours: sol.tutorSlots[t.index] / 2 };
    });
    var offRoomSlots = U.offRoomShifts(assignments).reduce(function (n, a) {
      return n + (a.endSlot - a.startSlot);
    }, 0);
    var cap = U.capacity(state.settings, assignments);
    var overSlots = 0;
    for (var o = 0; o < U.TOTAL_SLOTS; o++) if (cap.counts[o] > cap.limits[o]) overSlots++;
    return {
      totalHours: sol.assignedSlots / 2,
      offRoomHours: offRoomSlots / 2,
      coveredSlots: covered,
      totalSlots: openSlots,
      window: win,
      doubledHours: doubled / 2,
      avgSubjects: covered ? subjectSum / covered : 0,
      score: totalScore(sol),
      perTutor: perTutor,
      overCapacitySlots: overSlots,
      returnTrips: returnTrips(state, assignments).length
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
      // Nobody is in two rooms at once: the center and an embedded class are
      // different places, so overlap has to be checked across every kind.
      assignments.forEach(function (b) {
        if (b === a || b.tutorId !== a.tutorId || b.day !== a.day) return;
        if (a.startSlot < b.endSlot && a.endSlot > b.startSlot && a.id < b.id) {
          problems.push(t.id + ' has two overlapping shifts on day ' + a.day);
        }
      });
    });

    // Checked with the util's reading of the cap rather than the solver's, so
    // the two have to agree for a schedule to pass.
    var cap = U.capacity(state.settings, assignments);
    for (i = 0; i < U.TOTAL_SLOTS; i++) {
      if (cap.counts[i] > cap.limits[i]) {
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

  /* Every time a tutor is sent away mid-day and asked back with neither a class
   * nor a required break in between -- what the continuity penalty is there to
   * prevent. Returns { tutorId, day, start, end } for each.
   */
  function returnTrips(state, assignments) {
    var ctx = buildContext(state);
    var sol = solutionFromAssignments(ctx, assignments);
    var trips = [];
    ctx.tutors.forEach(function (t) {
      for (var day = 0; day < U.DAYS; day++) {
        gapCosts(ctx, t, day, sol.tutorDayMap[t.index][day], -1, -1).forEach(function (g) {
          if (g.cost >= W_RETURN) trips.push({ tutorId: t.id, day: day, start: g.start, end: g.end });
        });
      }
    });
    return trips;
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

    var win = U.editorWindow(state.tutors, U.mainShifts(assignments));
    for (var d = 0; d < U.DAYS; d++) {
      var run = null;
      for (var s = win.start; s <= win.end; s++) {
        var empty = s < win.end && sol.slotTutors[U.idx(d, s)].length === 0;
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
    var anyAvailable = false, anyFree = false, anyWithHours = false, anyPlaceable = false;

    for (var k = 0; k < ctx.tutors.length; k++) {
      var t = ctx.tutors[k];
      if (!t.avail[i]) continue;
      anyAvailable = true;
      // Already working this half hour, which at an empty slot means they are
      // in a class or an open lab somewhere else.
      if (sol.tutorDayMap[t.index][day][slot]) continue;
      anyFree = true;
      if (sol.tutorSlots[t.index] + ctx.minShift > t.maxSlots) continue;
      anyWithHours = true;
      if (couldFit(ctx, t, day, slot)) anyPlaceable = true;
    }

    if (!anyAvailable) return 'unavailable';
    // Said before the cap, because it is the more actionable of the two: the
    // fix is to move a class, not to approve more hours.
    if (!anyFree) return 'elsewhere';
    if (!anyWithHours) return 'capped';
    // Whether a legal shift exists at all is checked before the budget: a hole
    // no shift can reach is not a money problem, and blaming the budget sends
    // the coordinator to raise a number that would change nothing.
    if (!anyPlaceable) return 'rest';
    if (budgetSpent) return 'budget';
    // Somebody can legally work here, so the hole is simply unscheduled --
    // saying "break rules" here would send the coordinator chasing a
    // constraint that is not actually binding.
    return 'unscheduled';
  }

  var GAP_REASONS = {
    unavailable: 'No tutor is available',
    elsewhere: 'Every available tutor is in a class or an open lab',
    capped: 'Every available tutor is at their weekly cap',
    budget: 'The weekly hour budget is spent',
    unscheduled: 'A tutor could cover this — try Auto-optimize',
    rest: 'Break and shift-length rules block a placement',
    mixed: 'Several reasons across this stretch'
  };

  TS.optimizer = {
    GAP_REASONS: GAP_REASONS,
    createSolver: createSolver,
    optimize: optimize,
    fitTutor: fitTutor,
    validate: validate,
    stats: stats,
    analyzeGaps: analyzeGaps,
    returnTrips: returnTrips,
    mulberry32: mulberry32
  };
})(typeof window !== 'undefined' ? window : globalThis);
