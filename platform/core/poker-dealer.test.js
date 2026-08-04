// Tests for the dealer's script: the no-repeat line picker and the snapshot
// diff that decides when he opens his mouth.
// Run with `node --test platform/core/*.test.js`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SAYINGS, createSayingPicker } from "./poker-sayings.js";
import { pokerEvents, headlineEvent, pokerSoundCues } from "./poker-events.js";

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

describe("poker sound cues", () => {
  /** The cue types present, for assertions that don't care about the payload. */
  const types = (cues) => cues.map((q) => q.type);
  const of = (cues, type) => cues.find((q) => q.type === type);

  test("nothing happening makes no noise", () => {
    assert.deepEqual(pokerSoundCues(snap(), snap()), []);
  });

  test("a new hand shuffles, then pitches two cards per live player", () => {
    const before = snap({ handNumber: 1, street: "complete" });
    const after = snap({
      handNumber: 2, street: "preflop",
      seats: [seat("a"), seat("b"), seat("c")],
    });
    const cues = pokerSoundCues(before, after);
    assert.deepEqual(types(cues), ["shuffle", "deal"]);
    assert.equal(of(cues, "deal").count, 6);
  });

  test("joining a hand already in progress doesn't deal cards that went out long ago", () => {
    // The first poll has nothing to compare against — staying silent is the
    // only honest option.
    assert.deepEqual(pokerSoundCues(null, snap({ seats: [seat("a"), seat("b")] })), []);
  });

  test("empty seats aren't dealt to", () => {
    const after = snap({
      handNumber: 2, street: "preflop",
      seats: [seat("a"), seat("b"), { id: null, status: "empty", bet: 0, totalBet: 0 }],
    });
    assert.equal(of(pokerSoundCues(snap({ handNumber: 1 }), after), "deal").count, 4);
  });

  test("a call and a raise sound different, and carry what was put in", () => {
    const before = snap({ currentBet: 50, seats: [seat("a", { bet: 50, totalBet: 50 }), seat("b")] });

    const called = snap({ currentBet: 50, seats: [seat("a", { bet: 50, totalBet: 50 }), seat("b", { bet: 50, totalBet: 50 })] });
    const call = of(pokerSoundCues(before, called), "chips");
    assert.equal(call.amount, 50);
    assert.equal(call.raise, false);
    assert.equal(call.seatId, "b");

    const raised = snap({ currentBet: 200, seats: [seat("a", { bet: 50, totalBet: 50 }), seat("b", { bet: 200, totalBet: 200 })] });
    const raise = of(pokerSoundCues(before, raised), "chips");
    assert.equal(raise.amount, 200);
    assert.equal(raise.raise, true);
  });

  test("chips put in across a street change are counted, not lost to the reset", () => {
    // `bet` is wiped between streets; only `totalBet` survives, which is why
    // the diff is taken on that.
    const before = snap({ street: "flop", currentBet: 100, seats: [seat("a", { bet: 100, totalBet: 150 })] });
    const after = snap({ street: "turn", currentBet: 0, seats: [seat("a", { bet: 0, totalBet: 250 })] });
    assert.equal(of(pokerSoundCues(before, after), "chips").amount, 100);
  });

  test("a check is heard when the action passes someone who owed nothing", () => {
    const before = snap({
      street: "flop", currentBet: 0, actingId: "a",
      seats: [seat("a"), seat("b")],
    });
    const after = snap({
      street: "flop", currentBet: 0, actingId: "b",
      seats: [seat("a"), seat("b")],
    });
    assert.deepEqual(types(pokerSoundCues(before, after)), ["check"]);
  });

  test("folding to a bet is a fold, not a check", () => {
    const before = snap({ street: "flop", currentBet: 200, actingId: "a", seats: [seat("a"), seat("b", { bet: 200, totalBet: 200 })] });
    const after = snap({ street: "flop", currentBet: 200, actingId: "b", seats: [seat("a", { status: "folded" }), seat("b", { bet: 200, totalBet: 200 })] });
    assert.deepEqual(types(pokerSoundCues(before, after)), ["fold"]);
  });

  test("someone still owing chips who stops acting hasn't checked", () => {
    // Guards against calling a timeout-fold or a stale poll a check.
    const before = snap({ street: "flop", currentBet: 200, actingId: "a", seats: [seat("a")] });
    const after = snap({ street: "flop", currentBet: 200, actingId: null, seats: [seat("a")] });
    assert.deepEqual(pokerSoundCues(before, after), []);
  });

  test("a shove is chips and a sting", () => {
    const before = snap({ currentBet: 50, seats: [seat("a", { bet: 50, totalBet: 50 })] });
    const after = snap({ currentBet: 900, seats: [seat("a", { status: "allin", bet: 900, totalBet: 900 })] });
    const cues = pokerSoundCues(before, after);
    assert.deepEqual(types(cues), ["chips", "allIn"]);
    assert.equal(of(cues, "allIn").amount, 900);
  });

  test("a player already all in doesn't sting again on every poll", () => {
    const s = snap({ seats: [seat("a", { status: "allin", totalBet: 900 })] });
    assert.deepEqual(pokerSoundCues(s, snap({ seats: [seat("a", { status: "allin", totalBet: 900 })] })), []);
  });

  test("board cards land three then one then one", () => {
    assert.equal(of(pokerSoundCues(snap(), snap({ street: "flop" })), "board").count, 3);
    assert.equal(of(pokerSoundCues(snap({ street: "flop" }), snap({ street: "turn" })), "board").count, 1);
  });

  test("streets skipped between polls each get their cards, not just the last", () => {
    // Everyone all in: the whole board can arrive between two polls, and it
    // should sound like five cards, not one.
    const cues = pokerSoundCues(snap(), snap({ street: "river" }));
    const board = cues.filter((q) => q.type === "board");
    assert.deepEqual(board.map((q) => q.street), ["flop", "turn", "river"]);
    assert.equal(board.reduce((t, q) => t + q.count, 0), 5);
  });

  test("a hand won without a showdown pushes the pot but doesn't get a cheer", () => {
    const done = snap({
      street: "complete", pot: 300,
      results: [{ amount: 300, winners: [{ seatId: "a", rank: null, handName: "Uncontested", share: 300 }] }],
    });
    const cues = types(pokerSoundCues(snap({ street: "river" }), done));
    assert.deepEqual(cues, ["potPush", "win"]);
  });

  test("a big showdown pot brings the room in", () => {
    const done = snap({
      street: "complete", bigBlind: 50, pot: 4000,
      results: [{ amount: 4000, winners: [{ seatId: "a", rank: { category: 4, tiebreak: [10] }, handName: "Straight", share: 4000 }] }],
    });
    const cues = types(pokerSoundCues(snap({ street: "river" }), done));
    assert.deepEqual(cues, ["showdown", "potPush", "win", "applause"]);
  });

  test("a small showdown pot is shown down quietly", () => {
    const done = snap({
      street: "complete", bigBlind: 50, pot: 300,
      results: [{ amount: 300, winners: [{ seatId: "a", rank: { category: 1, tiebreak: [7] }, handName: "Pair of Sevens", share: 300 }] }],
    });
    const cues = types(pokerSoundCues(snap({ street: "river" }), done));
    assert.ok(cues.includes("showdown"));
    assert.ok(!cues.includes("applause"));
  });

  test("the end of a hand is played once, not on every poll after it", () => {
    const done = snap({
      street: "complete", pot: 300,
      results: [{ amount: 300, winners: [{ seatId: "a", rank: null, handName: "Uncontested", share: 300 }] }],
    });
    assert.ok(pokerSoundCues(snap({ street: "river" }), done).length > 0);
    assert.deepEqual(pokerSoundCues(done, done), []);
  });

  test("a hand the host cancelled pays out nothing and says nothing", () => {
    const voided = snap({ street: "complete", handVoided: true, pot: 300, results: [] });
    assert.deepEqual(pokerSoundCues(snap({ street: "river" }), voided), []);
  });

  test("being all in mid-hand isn't a bust — it's only a bust once you've lost", () => {
    const mid = snap({ street: "river", seats: [seat("a", { stack: 500 })] });
    const shoved = snap({ street: "river", seats: [seat("a", { stack: 0, status: "allin", totalBet: 500 })] });
    assert.ok(!types(pokerSoundCues(mid, shoved)).includes("bust"));

    const lost = snap({
      street: "complete", pot: 1000,
      seats: [seat("a", { stack: 0, status: "allin", totalBet: 500 })],
      results: [{ amount: 1000, winners: [{ seatId: "b", rank: null, handName: "Uncontested", share: 1000 }] }],
    });
    assert.ok(types(pokerSoundCues(shoved, lost)).includes("bust"));
  });

  test("a player who won the pot from an all-in isn't busted", () => {
    const shoved = snap({ street: "river", seats: [seat("a", { stack: 0, status: "allin", totalBet: 500 })] });
    const won = snap({
      street: "complete", pot: 1000,
      seats: [seat("a", { stack: 1000, status: "allin", totalBet: 500 })],
      results: [{ amount: 1000, winners: [{ seatId: "a", rank: null, handName: "Uncontested", share: 1000 }] }],
    });
    assert.ok(!types(pokerSoundCues(shoved, won)).includes("bust"));
  });

  test("someone sitting out broke from an earlier hand isn't busted again every hand", () => {
    const broke = seat("a", { stack: 0, status: "empty", totalBet: 0 });
    const done = snap({
      street: "complete", pot: 300, seats: [broke, seat("b", { stack: 600, totalBet: 300 })],
      results: [{ amount: 300, winners: [{ seatId: "b", rank: null, handName: "Uncontested", share: 300 }] }],
    });
    assert.ok(!types(pokerSoundCues(snap({ street: "river" }), done)).includes("bust"));
  });
});
