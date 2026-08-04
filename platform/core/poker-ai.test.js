// Tests for the practice opponents.
//
// Two things matter here, and they pull in opposite directions.
//
// The first is safety: a bot must never hand the engine something it will
// throw on. That's tested by brute force — six bots play hundreds of complete
// hands against each other through the real `applyAction`, and any illegal
// action ends the run immediately.
//
// The second is that the personalities are actually *different*. A bot that is
// safe but plays like every other bot is worthless for teaching, so the
// tendencies are measured rather than assumed: the same spot is put to each
// personality many times over and the distribution of what they do is compared.
// These assert orderings ("the rock folds more than the station") rather than
// exact rates, because the rates are a design decision that should be free to
// be tuned without a test breaking.
//
// Run with `node --test platform/core/*.test.js`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AI_PERSONALITIES, getPersonality, decideAction, positionFactor,
} from "./poker-ai.js";
import { seededRandom } from "./poker-odds.js";
import {
  makeTable, seatPlayer, startHand, applyAction, legalActions, makeDeck,
} from "./poker.js";

/**
 * Fewer samples than the bots use in earnest, because these run in loops.
 *
 * Two settings, because the two halves of this file want different things.
 * Measuring a personality needs the equity estimate to be roughly right, or
 * every bot's threshold tips at once and the comparison measures sampling
 * noise instead of character. The safety fuzz doesn't care what the bots
 * think a hand is worth — only that whatever they decide is legal — so it
 * runs at a sample size that would be far too coarse to play at.
 */
const FAST = { trials: 400 };
const ROUGH = { trials: 60 };

const h = (...codes) => codes.map((code) => {
  const ranks = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  const r = code.slice(0, -1);
  return { rank: ranks[r] || Number(r), suit: code.slice(-1) };
});

/* ------------------------------------------------------------- fixtures */

/** A table of `n` players, each with a full stack, mid-hand. */
function table(n = 3, stack = 5000) {
  const game = makeTable();
  for (let i = 0; i < n; i++) seatPlayer(game, { id: `p${i}`, name: `P${i}`, stack });
  return game;
}

/**
 * A specific spot to put to a personality: known hole cards, a known board,
 * and a known amount to call. Built on a real dealt hand so every field the
 * engine cares about is consistent, then overridden.
 */
function spot({ hole, board = [], toCall = 0, pot = 300, players = 3 }) {
  const game = table(players);
  startHand(game, { deck: makeDeck() });
  game.community = board;
  game.street = board.length === 0 ? "preflop" : board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river";

  const seat = game.seats[game.actingIndex];
  seat.holeCards = hole;
  // Put the requested price in front of them, and the requested pot behind it.
  game.currentBet = toCall;
  game.minRaise = game.bigBlind;
  seat.bet = 0;
  for (const s of game.seats) {
    if (s.id && s.id !== seat.id) { s.bet = toCall; s.totalBet = Math.round(pot / Math.max(1, players - 1)); }
  }
  seat.totalBet = 0;
  return { game, seatId: seat.id };
}

/** What a personality does in one spot, over `n` independent random streams. */
function tally(personalityKey, makeSpot, n = 80) {
  const counts = { fold: 0, check: 0, call: 0, bet: 0, raise: 0 };
  for (let i = 0; i < n; i++) {
    const { game, seatId } = makeSpot();
    const random = seededRandom(1000 + i * 7919);
    const decision = decideAction(game, seatId, personalityKey, { ...FAST, random });
    counts[decision.type]++;
  }
  return counts;
}

/* ---------------------------------------------------------------- roster */

describe("the roster", () => {
  test("all six personalities from the plan are present and distinct", () => {
    assert.equal(AI_PERSONALITIES.length, 6);
    assert.equal(new Set(AI_PERSONALITIES.map((p) => p.key)).size, 6);
    assert.equal(new Set(AI_PERSONALITIES.map((p) => p.name)).size, 6);
  });

  test("every one of them can describe itself to a player", () => {
    for (const p of AI_PERSONALITIES) {
      assert.ok(p.name.length > 0, `${p.key} has no name`);
      assert.ok(p.tell.length > 10, `${p.key} has no tell worth reading`);
      assert.ok(p.sizing[0] <= p.sizing[1], `${p.key} has backwards sizing`);
    }
  });

  test("an unknown personality falls back rather than exploding", () => {
    assert.equal(getPersonality("nope").key, "pro");
    assert.equal(getPersonality(undefined).key, "pro");
  });
});

/* ---------------------------------------------------------------- safety */

describe("bots never produce an illegal action", () => {
  test("six personalities play out complete hands without the engine refusing anything", () => {
    const keys = AI_PERSONALITIES.map((p) => p.key);
    const game = makeTable();
    keys.forEach((key, i) => seatPlayer(game, { id: key, name: key, stack: 20000 }));

    const random = seededRandom(0xa11ce);
    let handsPlayed = 0;
    let decisions = 0;

    for (let hand = 0; hand < 150; hand++) {
      const withChips = game.seats.filter((s) => s.id && s.stack > 0);
      if (withChips.length < 2) break;
      startHand(game);
      handsPlayed++;

      let guard = 0;
      while (game.street !== "complete" && guard++ < 200) {
        const seat = game.seats[game.actingIndex];
        if (!seat) break;
        const decision = decideAction(game, seat.id, seat.id, { ...ROUGH, random });
        assert.ok(decision, "a bot on the clock declined to decide");

        // The real engine, with no leniency: an illegal action throws here.
        applyAction(game, seat.id, { type: decision.type, to: decision.to });
        decisions++;
      }
      assert.equal(game.street, "complete", `hand ${hand} never finished`);
    }

    assert.ok(handsPlayed > 20, `only ${handsPlayed} hands were played`);
    assert.ok(decisions > 200, `only ${decisions} decisions were taken`);

    // Chips are conserved: nobody printed or destroyed any.
    const total = game.seats.reduce((t, s) => t + s.stack, 0);
    assert.equal(total, 6 * 20000, "chips went missing");
  });

  test("a raise is always within the legal band", () => {
    for (const p of AI_PERSONALITIES) {
      for (let i = 0; i < 40; i++) {
        const { game, seatId } = spot({ hole: h("As", "Ks"), board: h("Ah", "7d", "2c"), toCall: 200, pot: 600 });
        const legal = legalActions(game);
        const d = decideAction(game, seatId, p.key, { ...FAST, random: seededRandom(i + 1) });
        if (d.type === "bet" || d.type === "raise") {
          assert.ok(d.to >= legal.minTo, `${p.key} raised to ${d.to}, below the minimum ${legal.minTo}`);
          assert.ok(d.to <= legal.maxTo, `${p.key} raised to ${d.to}, above their stack ${legal.maxTo}`);
        }
      }
    }
  });

  test("a bot asked about someone else's turn says nothing", () => {
    const { game } = spot({ hole: h("As", "Ks") });
    const notActing = game.seats.find((s) => s.id && s.id !== game.seats[game.actingIndex].id);
    assert.equal(decideAction(game, notActing.id, "pro", FAST), null);
  });

  test("every decision explains itself", () => {
    for (const p of AI_PERSONALITIES) {
      const { game, seatId } = spot({ hole: h("Qh", "Jd"), board: h("9s", "4c", "2h"), toCall: 150 });
      const d = decideAction(game, seatId, p.key, FAST);
      assert.ok(d.reason && d.reason.length > 5, `${p.key} gave no reason`);
      assert.ok(d.equity >= 0 && d.equity <= 1, `${p.key} reported a nonsense equity`);
    }
  });
});

/* ----------------------------------------------------------- personality */

describe("the personalities actually play differently", () => {
  /*
   * The spot that separates everybody: jack-nine on a king-high board, heads
   * up, facing a pot-sized bet. It is worth about 39% and the price demands
   * 50%, which lands it squarely between the thresholds — a fold on the maths,
   * a call if you're the sort who can't let go. Anything much stronger or
   * weaker is a unanimous decision and measures nothing.
   */
  const marginal = () => spot({ hole: h("Jh", "9d"), board: h("Kc", "7s", "2h"), toCall: 400, pot: 400, players: 2 });

  test("the rock folds far more than the calling station", () => {
    const rock = tally("rock", marginal);
    const station = tally("station", marginal);
    assert.ok(rock.fold > station.fold,
      `rock folded ${rock.fold}, station folded ${station.fold}`);
    assert.ok(station.call > rock.call,
      `station called ${station.call}, rock called ${rock.call}`);
  });

  test("the maniac raises far more than anybody else", () => {
    const raises = Object.fromEntries(
      AI_PERSONALITIES.map((p) => [p.key, tally(p.key, marginal).raise]),
    );
    const others = Object.entries(raises).filter(([k]) => k !== "maniac").map(([, v]) => v);
    assert.ok(raises.maniac > Math.max(...others),
      `maniac raised ${raises.maniac}, the busiest of the rest managed ${Math.max(...others)}`);
  });

  test("the calling station almost never raises", () => {
    const station = tally("station", marginal);
    assert.ok(station.raise < station.call / 4,
      `station raised ${station.raise} against ${station.call} calls`);
  });

  test("with the option to check, the aggressive players bet and the passive ones don't", () => {
    const free = () => spot({ hole: h("Jh", "9d"), board: h("Kc", "7s", "2h"), toCall: 0, pot: 400, players: 2 });
    const maniac = tally("maniac", free);
    const station = tally("station", free);
    assert.ok(maniac.bet > station.bet,
      `maniac bet ${maniac.bet}, station bet ${station.bet}`);
    assert.ok(station.check > maniac.check,
      `station checked ${station.check}, maniac checked ${maniac.check}`);
  });

  test("everybody gets aces in, and nobody folds them", () => {
    // The floor under all of this: however loose or tight a personality is,
    // it should not be capable of folding the best hand preflop.
    for (const p of AI_PERSONALITIES) {
      const aces = () => spot({ hole: h("As", "Ah"), board: [], toCall: 100, pot: 300 });
      const counts = tally(p.key, aces, 40);
      assert.equal(counts.fold, 0, `${p.key} folded aces ${counts.fold} times`);
    }
  });

  test("nobody calls off their stack with the worst hand on a scary board", () => {
    // 7-2 on a board that has it drawing to nothing, facing a big bet.
    const hopeless = () => spot({ hole: h("7h", "2c"), board: h("Ac", "Kc", "Qd"), toCall: 900, pot: 600 });
    for (const p of AI_PERSONALITIES) {
      const counts = tally(p.key, hopeless, 60);
      assert.ok(counts.fold > counts.call,
        `${p.key} called ${counts.call} times with seven-deuce, folding only ${counts.fold}`);
    }
  });
});

/* -------------------------------------------------------------- position */

describe("position", () => {
  test("acting last scores higher than acting first", () => {
    const game = table(4);
    startHand(game, { deck: makeDeck() });
    const order = [];
    for (let i = 1; i <= game.seats.length; i++) {
      const seat = game.seats[(game.dealerIndex + i) % game.seats.length];
      if (seat.id && seat.status === "active") order.push(seat.id);
    }
    const first = positionFactor(game, order[0]);
    const last = positionFactor(game, order[order.length - 1]);
    assert.equal(first, 0);
    assert.equal(last, 1);
    assert.ok(last > first);
  });

  test("a seat that isn't in the hand gets a neutral score rather than an error", () => {
    const game = table(3);
    startHand(game, { deck: makeDeck() });
    assert.equal(positionFactor(game, "nobody"), 0.5);
  });

  test("position only loosens the players who understand it", () => {
    // The professional cares about position; the calling station has never
    // noticed it exists. Their personality parameters say so, and this pins
    // that down so a future tweak can't quietly flatten the difference.
    assert.ok(getPersonality("pro").position > getPersonality("station").position * 5);
  });
});
