// The two poker engines must not drift apart.
//
// `platform/core/poker.js` and `buzzer/lib/poker.js` are the same rules twice.
// They have to be: `buzzer/` deploys as its own Vercel project with the folder
// as the deploy root, so it cannot import across the repo boundary, and pushing
// the rules through the phone relay instead would mean trusting the client.
// Both copies say "keep this in sync by hand", which is exactly the kind of
// instruction that holds right up until the evening it doesn't.
//
// Comparing the files as text is no good — the mirror deliberately drops the
// JSDoc, inlines `newId`, and declares a couple of functions in a different
// order. So this compares what actually matters instead:
//
//   1. the two modules export the same names, with the same arities and the
//      same constants — which catches a function added to one and not the
//      other the moment it appears; and
//   2. they *behave* identically — every hand evaluation over a large
//      deterministic sample, and a scripted multi-way hand compared state by
//      state after every single action.
//
// A divergence here means a phone and the TV can disagree about what just
// happened at a real table, so these failures are never cosmetic.
//
// Run with `node --test platform/core/*.test.js`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as core from "./poker.js";
import * as mirror from "../../buzzer/lib/poker.js";

/* ------------------------------------------------------------------- rng */

/**
 * A seeded PRNG, so "a large random sample" is the same large sample on every
 * machine and every run. A drift check that fails one time in fifty is a
 * check people learn to re-run rather than read.
 */
function rng(seed = 0x5eed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x100000000;
  };
}

/** `n` distinct cards drawn from a fresh deck. */
function draw(deck, n, rand) {
  const pool = [...deck];
  const out = [];
  for (let i = 0; i < n; i++) out.push(...pool.splice(Math.floor(rand() * pool.length), 1));
  return out;
}

/* --------------------------------------------------------------- shape */

describe("poker engine mirror — shape", () => {
  test("both copies export exactly the same names", () => {
    const names = (m) => Object.keys(m).sort();
    assert.deepEqual(names(mirror), names(core));
  });

  test("every exported function takes the same arguments in both", () => {
    for (const name of Object.keys(core)) {
      if (typeof core[name] !== "function") continue;
      assert.equal(typeof mirror[name], "function", `${name} is not a function in the mirror`);
      assert.equal(mirror[name].length, core[name].length, `${name} has a different arity`);
    }
  });

  test("the rules, blind ladder and hand categories are identical", () => {
    for (const name of Object.keys(core)) {
      if (typeof core[name] === "function") continue;
      assert.deepEqual(mirror[name], core[name], `${name} differs between the two copies`);
    }
  });
});

/* --------------------------------------------------------- evaluation */

describe("poker engine mirror — hand evaluation", () => {
  test("4000 random seven-card hands rank identically in both", () => {
    const rand = rng(0xc0ffee);
    const deck = core.makeDeck();
    for (let i = 0; i < 4000; i++) {
      const cards = draw(deck, 7, rand);
      const a = core.bestHandRank(cards);
      const b = mirror.bestHandRank(cards);
      const where = cards.map(core.cardCode).join(" ");
      assert.equal(b.category, a.category, `category differs on ${where}`);
      assert.deepEqual(b.tiebreak, a.tiebreak, `tiebreak differs on ${where}`);
      assert.equal(mirror.describeHandRank(b), core.describeHandRank(a), `name differs on ${where}`);
    }
  });

  test("1500 random head-to-head match-ups are decided the same way", () => {
    // Comparison is its own logic, and a hand that ranks the same could still
    // be compared differently — so this tests the comparator, not the ranker.
    const rand = rng(0xbadbeef);
    const deck = core.makeDeck();
    for (let i = 0; i < 1500; i++) {
      const board = draw(deck, 5, rand);
      const left = draw(deck.filter((c) => !board.includes(c)), 2, rand);
      const right = draw(deck.filter((c) => !board.includes(c) && !left.includes(c)), 2, rand);
      const sign = (n) => Math.sign(n);
      assert.equal(
        sign(mirror.compareHandRanks(mirror.bestHandRank([...left, ...board]), mirror.bestHandRank([...right, ...board]))),
        sign(core.compareHandRanks(core.bestHandRank([...left, ...board]), core.bestHandRank([...right, ...board]))),
        `winner differs on ${[...left, "|", ...right, "|", ...board].map((c) => (typeof c === "string" ? c : core.cardCode(c))).join(" ")}`,
      );
    }
  });
});

/* ----------------------------------------------------------- game play */

/** A table with three seated players, built the same way from either module. */
function table(engine) {
  const game = engine.makeTable();
  engine.seatPlayer(game, { id: "a", name: "Ada", stack: 5000 });
  engine.seatPlayer(game, { id: "b", name: "Bo", stack: 3000 });
  engine.seatPlayer(game, { id: "c", name: "Cy", stack: 1200 });
  return game;
}

/**
 * The comparable part of a game state.
 *
 * Two fields are deliberately not compared, and both for the same reason:
 * they're readings of the outside world rather than statements of the rules.
 * `id` is a fresh uuid per table. `actingSince` is a `Date.now()` taken
 * independently by each engine, so when the two calls straddle a millisecond
 * boundary the states differ by one — a false failure that says nothing about
 * drift and would teach everybody to re-run this suite rather than read it.
 *
 * The meaningful half of `actingSince` is kept: whether the action clock is
 * running at all, which *is* a rule and would be real drift if it differed.
 */
const shape = (game) => JSON.stringify({
  ...game,
  id: null,
  actingSince: game.actingSince ? "running" : "stopped",
});

describe("poker engine mirror — play", () => {
  test("a scripted three-way hand produces an identical state after every action", () => {
    // A fixed deck makes this deterministic; the script drives a hand through
    // a call, a raise, a fold, a check-through and a short all-in, so the
    // betting machine, the street transitions and the side pots are all
    // exercised in one comparison.
    const rand = rng(0x1234);
    const deck = draw(core.makeDeck(), 52, rand);

    const a = table(core);
    const b = table(mirror);
    core.startHand(a, { deck });
    mirror.startHand(b, { deck });
    assert.equal(shape(b), shape(a), "states diverged at the deal");

    const script = [
      ["c", { type: "call" }],
      ["a", { type: "raise", to: 300 }],
      ["b", { type: "call" }],
      ["c", { type: "raise", to: 1200 }],   // the short stack, all in
      ["a", { type: "call" }],
      ["b", { type: "fold" }],
      ["a", { type: "check" }],
    ];

    for (const [seatId, action] of script) {
      // Whatever the first engine does — apply it, refuse it, or throw — the
      // second has to do the same thing. An action that becomes illegal in one
      // copy and not the other is exactly the drift worth catching.
      let errA = null;
      let errB = null;
      try { core.applyAction(a, seatId, action); } catch (e) { errA = e.message; }
      try { mirror.applyAction(b, seatId, action); } catch (e) { errB = e.message; }
      const step = `${seatId} ${action.type}${action.to ? ` to ${action.to}` : ""}`;
      assert.equal(errB, errA, `different error on ${step}`);
      assert.equal(shape(b), shape(a), `states diverged after ${step}`);
    }

    // And the hand actually got somewhere, so this isn't passing on two
    // engines that both refused everything.
    assert.equal(a.street, "complete", "the scripted hand never finished");
    assert.ok(a.results.length > 0, "the scripted hand paid nobody");
  });

  test("legal actions agree at every decision point of a hand", () => {
    const rand = rng(0x99);
    const deck = draw(core.makeDeck(), 52, rand);
    const a = table(core);
    const b = table(mirror);
    core.startHand(a, { deck });
    mirror.startHand(b, { deck });

    // Everybody calls until the hand runs out, checking the offered actions
    // each time — that walks all four streets without any branching.
    let guard = 0;
    while (a.street !== "complete" && guard++ < 40) {
      assert.deepEqual(mirror.legalActions(b), core.legalActions(a), "legal actions diverged");
      const seat = a.seats[a.actingIndex];
      if (!seat) break;
      const act = core.legalActions(a).canCheck ? { type: "check" } : { type: "call" };
      core.applyAction(a, seat.id, act);
      mirror.applyAction(b, seat.id, act);
      assert.equal(shape(b), shape(a), "states diverged mid-street");
    }
    assert.equal(a.street, "complete");
  });

  test("side pots are built identically from the same committed chips", () => {
    const seats = [
      { id: "a", totalBet: 1200, status: "allin" },
      { id: "b", totalBet: 3000, status: "active" },
      { id: "c", totalBet: 3000, status: "active" },
      { id: "d", totalBet: 400, status: "folded" },
    ];
    assert.deepEqual(mirror.buildPots(seats), core.buildPots(seats));
  });

  test("host controls move both engines the same way", () => {
    const a = table(core);
    const b = table(mirror);
    for (const step of [
      (e, g) => e.setBlindLevel(g, 3),
      (e, g) => e.setActionTimer(g, 30),
      (e, g) => e.setAutoDeal(g, true),
      (e, g) => e.setPaused(g, true),
      (e, g) => e.adjustStack(g, "c", 2500),
      (e, g) => e.arrangeSeats(g, ["c", "a", "b"]),
      (e, g) => e.removePlayer(g, "b"),
    ]) {
      step(core, a);
      step(mirror, b);
      assert.equal(shape(b), shape(a), `states diverged on ${step}`);
    }
  });
});
