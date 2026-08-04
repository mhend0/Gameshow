// Tests for the Academy's arithmetic.
//
// The equity tests are checked against the published figures for the classic
// match-ups rather than against whatever this code happens to produce — a
// trainer that is self-consistently wrong is the failure mode worth guarding
// against, and "AA against KK is about 82%" is a number the world already
// agrees on. Tolerances are wide enough for sampling error and narrow enough
// that a real mistake can't hide inside them.
//
// Run with `node --test platform/core/*.test.js`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  equity, equityVsRandom, remainingDeck, improvingCards, classifyDraws,
  potOdds, outsToEquity, callIsProfitable, startingHandCode, handLabel, seededRandom,
} from "./poker-odds.js";

const c = (rank, suit) => ({ rank, suit });
/** "Ah" → {rank:14, suit:"h"}, so a test reads like a hand history. */
const h = (...codes) => codes.map((code) => {
  const ranks = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  const r = code.slice(0, -1);
  return c(ranks[r] || Number(r), code.slice(-1));
});

/** Percentage points, for readable assertions. */
const pct = (n) => n * 100;
const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${what}: got ${actual.toFixed(2)}%, expected ${expected}% ±${tolerance}`);

describe("seeded rng", () => {
  test("the same seed gives the same sequence", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 50; i++) assert.equal(a(), b());
  });

  test("different seeds diverge, and everything stays in range", () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    let same = 0;
    for (let i = 0; i < 200; i++) {
      const x = a();
      const y = b();
      if (x === y) same++;
      assert.ok(x >= 0 && x < 1, `${x} out of range`);
    }
    assert.ok(same < 5, "two different seeds produced the same stream");
  });
});

describe("remaining deck", () => {
  test("known cards are removed, whatever order they arrive in", () => {
    assert.equal(remainingDeck([]).length, 52);
    assert.equal(remainingDeck(h("As", "Kd")).length, 50);
    assert.equal(remainingDeck(h("As", "Kd", "2c", "7h", "Th")).length, 47);
  });

  test("nulls and holes in the board are ignored", () => {
    assert.equal(remainingDeck([...h("As"), null, undefined]).length, 51);
  });
});

describe("equity — the match-ups everyone knows", () => {
  test("aces against kings is about 82%", () => {
    const r = equity([h("As", "Ah"), h("Ks", "Kh")], []);
    assert.equal(r.exact, false, "preflop should be sampled, not enumerated");
    near(pct(r.hands[0].equity), 82.4, 1.5, "AA");
    near(pct(r.hands[1].equity), 17.6, 1.5, "KK");
  });

  test("ace-king offsuit is the underdog to queens, but not by much", () => {
    const r = equity([h("Ah", "Kd"), h("Qs", "Qc")], []);
    near(pct(r.hands[0].equity), 43.2, 1.5, "AKo");
    near(pct(r.hands[1].equity), 56.8, 1.5, "QQ");
  });

  test("suited connectors do better against a big pair than they look", () => {
    // 7-8 suited is roughly a 2:1 dog to aces — much closer than 7-2.
    const r = equity([h("7h", "8h"), h("As", "Ac")], []);
    near(pct(r.hands[0].equity), 22.9, 2, "78s vs AA");
  });

  test("the two hands' equities always add up to the whole pot", () => {
    const r = equity([h("Jd", "Ts"), h("9c", "9h")], []);
    near(pct(r.hands[0].equity + r.hands[1].equity), 100, 0.001, "total");
  });
});

describe("equity — enumeration", () => {
  test("once the board is out there is nothing left to guess", () => {
    const r = equity([h("As", "Ks"), h("Qd", "Qc")], h("Ah", "7s", "2d", "9c", "4h"));
    assert.equal(r.exact, true);
    assert.equal(r.boards, 1);
    assert.equal(r.hands[0].equity, 1);  // aces beat queens
    assert.equal(r.hands[1].equity, 0);
  });

  test("a flop is enumerated exactly — all 990 boards", () => {
    const r = equity([h("As", "Ks"), h("Qd", "Qc")], h("Ah", "7s", "2d"));
    assert.equal(r.exact, true);
    assert.equal(r.boards, 990);
  });

  test("a turn is enumerated exactly — all 44 cards", () => {
    const r = equity([h("As", "Ks"), h("Qd", "Qc")], h("Ah", "7s", "2d", "9c"));
    assert.equal(r.exact, true);
    assert.equal(r.boards, 44);
  });

  test("a split pot is counted as half each, not as a win for nobody", () => {
    // Both play the board: a royal flush in spades that neither hand improves.
    const r = equity([h("2c", "3d"), h("4h", "5s")], h("As", "Ks", "Qs", "Js", "Ts"));
    assert.equal(r.hands[0].equity, 0.5);
    assert.equal(r.hands[1].equity, 0.5);
    assert.equal(r.hands[0].win, 0);
    assert.equal(r.hands[0].tie, 1);
  });

  test("a drawing hand's exact equity matches the textbook flush-draw number", () => {
    // Nut flush draw against top pair, two cards to come. The flush alone is
    // ~35%; the ace overcard lifts it to a shade under a coin flip.
    const r = equity([h("Ah", "3h"), h("Kd", "Qc")], h("Kh", "9h", "2s"));
    assert.equal(r.exact, true);
    near(pct(r.hands[0].equity), 45.5, 2.5, "nut flush draw vs top pair");
  });

  test("three-way equity also adds up to one pot", () => {
    const r = equity([h("As", "Ad"), h("Ks", "Kd"), h("Qs", "Qd")], []);
    near(pct(r.hands.reduce((t, x) => t + x.equity, 0)), 100, 0.001, "total");
    assert.ok(r.hands[0].equity > r.hands[1].equity);
    assert.ok(r.hands[1].equity > r.hands[2].equity);
  });

  test("the same question always gets the same answer", () => {
    const ask = () => equity([h("Ah", "Kd"), h("Qs", "Qc")], []).hands[0].equity;
    assert.equal(ask(), ask());
  });

  test("fewer than two hands is a mistake, not an empty result", () => {
    assert.throws(() => equity([h("As", "Ks")], []), /at least two/);
  });
});

describe("equity against unknown hands", () => {
  test("aces beat one random hand about 85% of the time", () => {
    const r = equityVsRandom(h("As", "Ah"), [], { opponents: 1 });
    near(pct(r.equity), 85.3, 2, "AA vs random");
  });

  test("more opponents means less equity, every time", () => {
    // Only the ordering is under test, so a smaller sample is plenty.
    const vs = (opponents) => equityVsRandom(h("As", "Ah"), [], { opponents, trials: 3000 }).equity;
    const one = vs(1);
    const three = vs(3);
    const eight = vs(8);
    assert.ok(one > three && three > eight, `${one} > ${three} > ${eight}`);
    // Aces are still favourite against three, and no longer against eight.
    assert.ok(three > 0.5 && eight < 0.5);
  });

  test("the worst hand in poker is still not hopeless heads-up", () => {
    const r = equityVsRandom(h("7h", "2c"), [], { opponents: 1 });
    near(pct(r.equity), 34.6, 2.5, "72o vs random");
  });
});

describe("outs and draws", () => {
  test("four to a flush is nine outs", () => {
    const { draws } = classifyDraws(h("Ah", "5h"), h("Kh", "9h", "2s"));
    const flush = draws.find((d) => d.type === "flush");
    assert.ok(flush, "no flush draw found");
    assert.equal(flush.outs, 9);
  });

  test("an open-ended straight draw is eight outs and knows its own name", () => {
    const { draws } = classifyDraws(h("9h", "8h"), h("7s", "6d", "2c"));
    const straight = draws.find((d) => ["openEnded", "gutshot", "doubleGutshot"].includes(d.type));
    assert.equal(straight.type, "openEnded");
    assert.equal(straight.outs, 8);
  });

  test("a gutshot is four outs", () => {
    const { draws } = classifyDraws(h("9c", "8d"), h("7h", "5s", "2c"));
    const straight = draws.find((d) => d.type === "gutshot");
    assert.ok(straight, "no gutshot found");
    assert.equal(straight.outs, 4);
  });

  test("a double gutshot is eight outs but isn't open-ended", () => {
    // 5-J in hand, 7-8-9 on the board: a six or a ten both fill it, and
    // neither of them sits at the end of a run.
    const { draws } = classifyDraws(h("5c", "Jd"), h("7h", "8s", "9c"));
    const straight = draws.find((d) => ["openEnded", "gutshot", "doubleGutshot"].includes(d.type));
    assert.equal(straight.type, "doubleGutshot");
    assert.equal(straight.outs, 8);
  });

  test("overcards count only while the hand has nothing", () => {
    const nothing = classifyDraws(h("Ad", "Qc"), h("9h", "7s", "2c"));
    const over = nothing.draws.find((d) => d.type === "overcards");
    assert.ok(over, "two overcards not spotted");
    assert.equal(over.outs, 6);          // three aces, three queens

    // Same overcards, but now there's a pair — nobody calls that a draw.
    const paired = classifyDraws(h("Ad", "Qc"), h("Qh", "7s", "2c"));
    assert.equal(paired.draws.find((d) => d.type === "overcards"), undefined);
  });

  test("a backdoor flush is reported but never counted as an out", () => {
    const { draws } = classifyDraws(h("Ah", "5h"), h("Kh", "9c", "2s"));
    const backdoor = draws.find((d) => d.type === "backdoorFlush");
    assert.ok(backdoor, "backdoor flush not spotted");
    assert.equal(backdoor.outs, 0);
  });

  test("a made straight isn't also reported as drawing to one", () => {
    const { draws, made } = classifyDraws(h("9h", "8h"), h("7s", "6d", "5c"));
    assert.equal(made, "Straight");
    assert.equal(draws.find((d) => d.type === "openEnded"), undefined);
  });

  test("improving cards is the wider question, and includes the kicker", () => {
    // A flush draw is nine cards; the hand improves on far more than that,
    // which is exactly why the two functions are separate.
    const improving = improvingCards(h("Ah", "5h"), h("Kh", "9h", "2s"));
    const flushDraw = classifyDraws(h("Ah", "5h"), h("Kh", "9h", "2s"))
      .draws.find((d) => d.type === "flush");
    assert.ok(improving.length > flushDraw.outs, `${improving.length} should exceed ${flushDraw.outs}`);
    assert.ok(improving.some((i) => i.makes === "Flush"));
    assert.ok(improving.some((i) => i.makes === "Pair"));
  });

  test("outs are always real cards nobody can see", () => {
    const hole = h("Ah", "5h");
    const board = h("Kh", "9h", "2s");
    const seen = new Set([...hole, ...board].map((x) => `${x.rank}${x.suit}`));
    for (const draw of classifyDraws(hole, board).draws) {
      for (const card of draw.cards) {
        assert.ok(!seen.has(`${card.rank}${card.suit}`), `${card.rank}${card.suit} is already on the table`);
      }
    }
  });
});

describe("outs to equity", () => {
  test("nine outs with two cards to come is the famous 35%", () => {
    const r = outsToEquity(9, 2);
    near(pct(r.exact), 34.97, 0.01, "flush draw by the river");
  });

  test("nine outs with one card to come is about 20%", () => {
    near(pct(outsToEquity(9, 1).exact), 19.57, 0.01, "flush draw on the river alone");
  });

  test("across the draws people actually hold, the shortcut is within six points", () => {
    // 1–15 outs covers everything from a single card to a monster combo draw,
    // which is the whole range the rule was ever meant for.
    for (let outs = 1; outs <= 15; outs++) {
      const r = outsToEquity(outs, 2);
      assert.ok(Math.abs(r.error) < 0.06,
        `${outs} outs: the shortcut is off by ${pct(r.error).toFixed(1)} points`);
    }
  });

  test("the shortcut flatters big draws, undersells small ones, and falls apart past that", () => {
    // The interesting half of the lesson. The rule of 4 is less accurate than
    // people assume as a draw grows, and it errs in the direction that costs
    // money — by fifteen outs it is overstating by nearly six points, and it
    // degrades without limit after that (doubling can't pass 100%, but the
    // shortcut happily does).
    assert.ok(outsToEquity(4, 2).error < 0, "four outs should be understated");
    assert.ok(outsToEquity(15, 2).error > 0.05, "fifteen outs should be flattered by 5+ points");
    assert.ok(outsToEquity(21, 2).error > 0.13, "the rule should be visibly broken by 21 outs");

    // With one card to come the shortcut behaves far better, and errs the
    // other way: the rule of 2 *always* understates, so a draw it says is
    // worth calling really is. That makes it the safe one to lean on facing
    // a bet on the turn, which is exactly when it gets used.
    for (let outs = 1; outs <= 15; outs++) {
      const r = outsToEquity(outs, 1);
      assert.ok(r.error < 0, `${outs} outs, one card: the rule of 2 should never overstate`);
      assert.ok(Math.abs(r.error) < 0.03,
        `${outs} outs, one card: off by ${pct(r.error).toFixed(1)} points`);
    }
  });

  test("no outs is no chance, and every card being an out is a certainty", () => {
    assert.equal(outsToEquity(0, 2).exact, 0);
    assert.equal(outsToEquity(47, 2).exact, 1);
  });
});

describe("pot odds", () => {
  test("a pot-sized bet needs a third of the pot in equity", () => {
    const r = potOdds(100, 200);
    near(pct(r.breakEven), 33.33, 0.01, "break-even");
    assert.equal(r.ratioLabel, "2.0 : 1");
  });

  test("a half-pot bet is a better price than a pot-sized one", () => {
    assert.ok(potOdds(50, 150).breakEven < potOdds(100, 200).breakEven);
  });

  test("checking is free, and free is not a price", () => {
    const r = potOdds(0, 500);
    assert.equal(r.breakEven, 0);
    assert.equal(r.ratioLabel, "free");
  });

  test("a call is profitable exactly when equity beats the price", () => {
    // A flush draw with one card to come is ~19.6%, so it needs better than
    // 4:1 — and famously does *not* have the price at 3:1, which is the
    // mistake the pot-odds lesson exists to correct.
    const draw = outsToEquity(9, 1).exact;
    assert.equal(callIsProfitable(draw, 100, 300).profitable, false);  // 3:1, needs 25%
    assert.equal(callIsProfitable(draw, 100, 500).profitable, true);   // 5:1, needs 16.7%
  });

  test("expected value is reported in chips, not just as a verdict", () => {
    // 50% equity, calling 100 into 300: half of 400 is 200, less the 100 called.
    const r = callIsProfitable(0.5, 100, 300);
    assert.equal(r.ev, 100);
  });
});

describe("hand labels", () => {
  test("starting hands get their usual shorthand", () => {
    assert.equal(startingHandCode(h("As", "Ks")), "AKs");
    assert.equal(startingHandCode(h("Ah", "Kd")), "AKo");
    assert.equal(startingHandCode(h("Qh", "Qd")), "QQ");
    assert.equal(startingHandCode(h("Th", "9h")), "T9s");
  });

  test("the bigger card is named first however it's passed in", () => {
    assert.equal(startingHandCode(h("Kd", "Ah")), "AKo");
    assert.equal(startingHandCode(h("2c", "7d")), "72o");
  });

  test("a hand reads back the way it was dealt", () => {
    assert.equal(handLabel(h("As", "Kd")), "As Kd");
    assert.equal(handLabel([]), "");
  });
});
