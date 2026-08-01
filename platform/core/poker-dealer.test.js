// Tests for the dealer's script: the no-repeat line picker and the snapshot
// diff that decides when he opens his mouth.
// Run with `node --test platform/core/*.test.js`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SAYINGS, createSayingPicker } from "./poker-sayings.js";
import { pokerEvents, headlineEvent } from "./poker-events.js";

const c = (rank, suit) => ({ rank, suit });

/** A minimal public snapshot, shaped like buzzer/api/poker.js's publicView. */
function snap(over = {}) {
  return {
    handNumber: 1, street: "preflop", currentBet: 50, bigBlind: 50, pot: 75,
    community: [], seats: [], results: [], ...over,
  };
}
const seat = (id, over = {}) => ({ id, name: id, status: "active", bet: 0, totalBet: 0, holeCards: [], ...over });

describe("saying library", () => {
  test("every category has lines, and none are duplicated within a category", () => {
    for (const [category, lines] of Object.entries(SAYINGS)) {
      assert.ok(lines.length > 0, `${category} is empty`);
      assert.equal(new Set(lines).size, lines.length, `${category} repeats a line`);
    }
  });
});

describe("saying picker", () => {
  test("uses every line before repeating any", () => {
    const picker = createSayingPicker({ t: ["a", "b", "c"] });
    const first = [picker.pick("t"), picker.pick("t"), picker.pick("t")];
    assert.deepEqual([...first].sort(), ["a", "b", "c"]);
  });

  test("a refilled bag never immediately repeats the last line", () => {
    // Run it enough times that a naive shuffle would collide by chance.
    for (let i = 0; i < 200; i++) {
      const picker = createSayingPicker({ t: ["a", "b", "c"] });
      const drawn = [];
      for (let n = 0; n < 6; n++) drawn.push(picker.pick("t"));
      for (let n = 1; n < drawn.length; n++) {
        assert.notEqual(drawn[n], drawn[n - 1], `repeated ${drawn[n]} back to back`);
      }
    }
  });

  test("a single-line category just repeats it rather than failing", () => {
    const picker = createSayingPicker({ t: ["only"] });
    assert.equal(picker.pick("t"), "only");
    assert.equal(picker.pick("t"), "only");
  });

  test("an unknown or empty category says nothing", () => {
    const picker = createSayingPicker({ t: [], u: ["x"] });
    assert.equal(picker.pick("t"), null);
    assert.equal(picker.pick("nope"), null);
  });

  test("reset forgets history", () => {
    const picker = createSayingPicker({ t: ["a", "b"] });
    picker.pick("t"); picker.pick("t");
    picker.reset();
    const after = [picker.pick("t"), picker.pick("t")];
    assert.deepEqual([...after].sort(), ["a", "b"]);
  });

  test("the real library works through the picker", () => {
    const picker = createSayingPicker();
    for (const category of Object.keys(SAYINGS)) {
      assert.ok(SAYINGS[category].includes(picker.pick(category)));
    }
  });
});

describe("poker events", () => {
  test("a brand new hand announces itself", () => {
    assert.deepEqual(pokerEvents(null, snap()), ["handStart"]);
  });

  test("nothing notable produces no events", () => {
    const a = snap();
    assert.deepEqual(pokerEvents(a, snap()), []);
  });

  test("each street is announced as it lands", () => {
    assert.deepEqual(pokerEvents(snap(), snap({ street: "flop" })), ["flop"]);
    assert.deepEqual(pokerEvents(snap({ street: "flop" }), snap({ street: "turn" })), ["turn"]);
    assert.deepEqual(pokerEvents(snap({ street: "turn" }), snap({ street: "river" })), ["river"]);
  });

  test("streets skipped between polls announce the furthest one reached", () => {
    // Everyone all in: flop, turn and river can all land before the next poll.
    assert.deepEqual(pokerEvents(snap(), snap({ street: "river" })), ["river"]);
  });

  test("a new all-in is called out", () => {
    const before = snap({ seats: [seat("a"), seat("b")] });
    const after = snap({ seats: [seat("a", { status: "allin" }), seat("b")] });
    assert.ok(pokerEvents(before, after).includes("allIn"));
  });

  test("a player already all in doesn't trigger it again", () => {
    const s = snap({ seats: [seat("a", { status: "allin" }), seat("b")] });
    assert.ok(!pokerEvents(s, snap({ seats: [seat("a", { status: "allin" }), seat("b")] })).includes("allIn"));
  });

  test("a big raise is called out, a big call is not", () => {
    const before = snap({ currentBet: 50, pot: 200 });
    const raise = snap({ currentBet: 400, pot: 550 });
    assert.ok(pokerEvents(before, raise).includes("bigBet"));

    // Same pot growth, but currentBet didn't move: that's someone calling.
    const call = snap({ currentBet: 50, pot: 550 });
    assert.ok(!pokerEvents(before, call).includes("bigBet"));
  });

  test("a small raise isn't worth a comment", () => {
    const before = snap({ currentBet: 50, pot: 400 });
    const nudge = snap({ currentBet: 100, pot: 450 });
    assert.ok(!pokerEvents(before, nudge).includes("bigBet"));
  });

  test("an all-in doesn't also fire as a big bet — one line, not two", () => {
    const before = snap({ currentBet: 50, pot: 200, seats: [seat("a"), seat("b")] });
    const shove = snap({
      currentBet: 900, pot: 1100,
      seats: [seat("a", { status: "allin" }), seat("b")],
    });
    const events = pokerEvents(before, shove);
    assert.ok(events.includes("allIn"));
    assert.ok(!events.includes("bigBet"));
  });

  test("everyone folding reads as a fold, not a showdown", () => {
    const done = snap({
      street: "complete",
      results: [{ amount: 300, winners: [{ seatId: "a", rank: null, handName: "Uncontested", share: 300 }] }],
    });
    const events = pokerEvents(snap({ street: "river" }), done);
    assert.ok(events.includes("fold"));
    assert.ok(!events.includes("showdown"));
  });

  test("a showdown is announced once, not on every poll after it", () => {
    const done = snap({
      street: "complete",
      seats: [seat("a", { holeCards: [c(14, "s"), c(13, "s")] })],
      community: [c(2, "h"), c(7, "d"), c(9, "c"), c(4, "s"), c(6, "h")],
      results: [{ amount: 300, winners: [{ seatId: "a", rank: { category: 0, tiebreak: [14, 13, 9, 7, 6] }, handName: "High Card, A", share: 300 }] }],
    });
    assert.ok(pokerEvents(snap({ street: "river" }), done).includes("showdown"));
    assert.deepEqual(pokerEvents(done, done), []);   // already announced
  });

  test("a royal flush outranks the plain showdown line", () => {
    const done = snap({
      street: "complete",
      seats: [seat("a", { holeCards: [c(14, "s"), c(13, "s")] })],
      community: [c(12, "s"), c(11, "s"), c(10, "s"), c(4, "d"), c(6, "h")],
      results: [{ amount: 300, winners: [{ seatId: "a", rank: { category: 8, tiebreak: [14, 0, 0, 0, 0] }, handName: "Royal Flush", share: 300 }] }],
    });
    assert.equal(headlineEvent(pokerEvents(snap({ street: "river" }), done)), "royalFlush");
  });

  test("a split pot is called out", () => {
    const done = snap({
      street: "complete",
      seats: [seat("a", { holeCards: [c(14, "s"), c(13, "h")] }), seat("b", { holeCards: [c(14, "d"), c(13, "c")] })],
      community: [c(2, "h"), c(7, "d"), c(9, "c"), c(4, "s"), c(6, "h")],
      results: [{
        amount: 300,
        winners: [
          { seatId: "a", rank: { category: 0, tiebreak: [14, 13, 9, 7, 6] }, handName: "High Card, A", share: 150 },
          { seatId: "b", rank: { category: 0, tiebreak: [14, 13, 9, 7, 6] }, handName: "High Card, A", share: 150 },
        ],
      }],
    });
    assert.ok(pokerEvents(snap({ street: "river" }), done).includes("chopPot"));
  });

  test("losing with a full house is a bad beat, losing with nothing is not", () => {
    const community = [c(9, "c"), c(9, "d"), c(4, "s"), c(4, "h"), c(2, "c")];
    // Loser holds 9-4 for nines full; winner holds quad… let's give them 9s.
    const beat = snap({
      street: "complete", community,
      seats: [
        seat("win", { holeCards: [c(9, "s"), c(9, "h")] }),   // quad nines
        seat("lose", { holeCards: [c(4, "d"), c(4, "c")] }),  // fours full of nines
      ],
      results: [{ amount: 900, winners: [{ seatId: "win", rank: { category: 7, tiebreak: [9, 4, 0, 0, 0] }, handName: "Four of a Kind, Nines", share: 900 }] }],
    });
    assert.ok(pokerEvents(snap({ street: "river" }), beat).includes("badBeat"));

    const ordinary = snap({
      street: "complete",
      community: [c(2, "h"), c(7, "d"), c(9, "c"), c(4, "s"), c(6, "h")],
      seats: [
        seat("win", { holeCards: [c(14, "s"), c(13, "h")] }),
        seat("lose", { holeCards: [c(3, "d"), c(5, "c")] }),
      ],
      results: [{ amount: 300, winners: [{ seatId: "win", rank: { category: 0, tiebreak: [14, 13, 9, 7, 6] }, handName: "High Card, A", share: 300 }] }],
    });
    assert.ok(!pokerEvents(snap({ street: "river" }), ordinary).includes("badBeat"));
  });

  test("a folded player's strong hand can't cause a bad beat (they never showed)", () => {
    const done = snap({
      street: "complete",
      community: [c(9, "c"), c(9, "d"), c(4, "s"), c(4, "h"), c(2, "c")],
      seats: [
        seat("win", { holeCards: [c(14, "s"), c(13, "h")] }),
        seat("folder", { status: "folded", holeCards: [c(9, "s"), c(9, "h")] }),
      ],
      results: [{ amount: 300, winners: [{ seatId: "win", rank: { category: 2, tiebreak: [9, 4, 14, 0, 0] }, handName: "Two Pair", share: 300 }] }],
    });
    assert.ok(!pokerEvents(snap({ street: "river" }), done).includes("badBeat"));
  });

  test("headlineEvent picks the most dramatic thing that happened", () => {
    assert.equal(headlineEvent(["showdown", "flop"]), "showdown");
    assert.equal(headlineEvent([]), null);
  });
});
