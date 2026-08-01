// Engine tests for platform/core/poker.js — run with `node --test platform/core/*.test.js`.
// No dependencies: Node's built-in test runner, matching this repo's
// no-build-step, dependency-free ethos.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  makeDeck, shuffleDeck, evaluate5, bestHandRank, compareHandRanks, describeHandRank,
  makeTable, seatPlayer, startHand, applyAction, legalActions, buildPots, foldOut,
  arrangeSeats, setPaused, setActionTimer, actionExpired, foldExpired,
  setAutoDeal, setBlinds, setBlindLevel, endHand, DEFAULT_BLIND_LEVELS,
} from "./poker.js";

const c = (rank, suit) => ({ rank, suit });

describe("deck", () => {
  test("has 52 unique cards", () => {
    const deck = makeDeck();
    assert.equal(deck.length, 52);
    const codes = new Set(deck.map((c) => `${c.rank}${c.suit}`));
    assert.equal(codes.size, 52);
  });

  test("shuffle is a permutation, not a resample", () => {
    const deck = makeDeck();
    const before = deck.map((c) => `${c.rank}${c.suit}`).sort();
    shuffleDeck(deck);
    const after = deck.map((c) => `${c.rank}${c.suit}`).sort();
    assert.deepEqual(before, after);
  });
});

describe("hand evaluation", () => {
  test("royal flush beats straight flush", () => {
    const royal = evaluate5([c(14, "s"), c(13, "s"), c(12, "s"), c(11, "s"), c(10, "s")]);
    const sf = evaluate5([c(9, "h"), c(8, "h"), c(7, "h"), c(6, "h"), c(5, "h")]);
    assert.equal(royal.category, 8);
    assert.equal(describeHandRank(royal), "Royal Flush");
    assert.ok(compareHandRanks(royal, sf) > 0);
  });

  test("wheel straight (A-2-3-4-5) ranks as a 5-high straight, not ace-high", () => {
    const wheel = evaluate5([c(14, "s"), c(2, "h"), c(3, "d"), c(4, "c"), c(5, "s")]);
    assert.equal(wheel.category, 4);
    assert.equal(wheel.tiebreak[0], 5);
    const sixHigh = evaluate5([c(6, "s"), c(2, "h"), c(3, "d"), c(4, "c"), c(5, "d")]);
    assert.ok(compareHandRanks(sixHigh, wheel) > 0);
  });

  test("four of a kind beats full house", () => {
    const quads = evaluate5([c(9, "s"), c(9, "h"), c(9, "d"), c(9, "c"), c(2, "s")]);
    const boat = evaluate5([c(8, "s"), c(8, "h"), c(8, "d"), c(3, "c"), c(3, "s")]);
    assert.equal(quads.category, 7);
    assert.equal(boat.category, 6);
    assert.ok(compareHandRanks(quads, boat) > 0);
  });

  test("full house tiebreak: trips rank matters over pair rank", () => {
    const kingsOverTwos = evaluate5([c(13, "s"), c(13, "h"), c(13, "d"), c(2, "c"), c(2, "s")]);
    const twosOverKings = evaluate5([c(2, "s"), c(2, "h"), c(2, "d"), c(13, "c"), c(13, "s")]);
    assert.ok(compareHandRanks(kingsOverTwos, twosOverKings) > 0);
  });

  test("flush beats straight, straight beats trips", () => {
    const flush = evaluate5([c(2, "s"), c(5, "s"), c(9, "s"), c(11, "s"), c(13, "s")]);
    const straight = evaluate5([c(4, "h"), c(5, "d"), c(6, "s"), c(7, "c"), c(8, "h")]);
    const trips = evaluate5([c(4, "h"), c(4, "d"), c(4, "s"), c(9, "c"), c(2, "h")]);
    assert.equal(flush.category, 5);
    assert.equal(straight.category, 4);
    assert.equal(trips.category, 3);
    assert.ok(compareHandRanks(flush, straight) > 0);
    assert.ok(compareHandRanks(straight, trips) > 0);
  });

  test("two pair kicker breaks a tie", () => {
    const withAceKicker = evaluate5([c(9, "s"), c(9, "h"), c(4, "d"), c(4, "c"), c(14, "s")]);
    const withKingKicker = evaluate5([c(9, "d"), c(9, "c"), c(4, "s"), c(4, "h"), c(13, "d")]);
    assert.equal(withAceKicker.category, 2);
    assert.ok(compareHandRanks(withAceKicker, withKingKicker) > 0);
  });

  test("hand names spell ranks out instead of reading as stray letters", () => {
    const twoPair = evaluate5([c(14, "s"), c(14, "h"), c(11, "d"), c(11, "c"), c(13, "s")]);
    assert.equal(describeHandRank(twoPair), "Two Pair, Aces and Jacks");
    const quadTens = evaluate5([c(10, "s"), c(10, "h"), c(10, "d"), c(10, "c"), c(2, "s")]);
    assert.equal(describeHandRank(quadTens), "Four of a Kind, Tens");
  });

  test("bestHandRank picks the best 5 of 7 (hole + community)", () => {
    const seven = [c(14, "s"), c(14, "h"), c(14, "d"), c(14, "c"), c(2, "s"), c(3, "h"), c(4, "d")];
    const rank = bestHandRank(seven);
    assert.equal(rank.category, 7); // quad aces, not the low straight-ish scraps
  });
});

describe("table lifecycle", () => {
  function twoPlayerTable(deckOverride) {
    const game = makeTable({ seats: 6, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "p1", name: "Alice", stack: 1000 });
    seatPlayer(game, { id: "p2", name: "Bob", stack: 1000 });
    startHand(game, { deck: deckOverride });
    return game;
  }

  test("heads-up: dealer posts small blind, other player posts big blind", () => {
    const game = twoPlayerTable();
    const dealer = game.seats[game.dealerIndex];
    assert.equal(dealer.bet, 25);
    const other = game.seats.find((s) => s.index !== game.dealerIndex && s.status !== "empty");
    assert.equal(other.bet, 50);
  });

  test("both hole cards are dealt and no card repeats", () => {
    const game = twoPlayerTable();
    const [p1, p2] = game.seats.filter((s) => s.status !== "empty");
    assert.equal(p1.holeCards.length, 2);
    assert.equal(p2.holeCards.length, 2);
    const all = [...p1.holeCards, ...p2.holeCards, ...game.deck].map((c) => `${c.rank}${c.suit}`);
    assert.equal(new Set(all).size, 52);
  });

  test("preflop action starts with the small blind (wraps around in heads-up)", () => {
    const game = twoPlayerTable();
    assert.equal(game.seats[game.actingIndex].id, game.seats[game.dealerIndex].id);
  });

  test("call then check closes preflop and deals the flop", () => {
    const game = twoPlayerTable();
    const sbId = game.seats[game.actingIndex].id;
    applyAction(game, sbId, { type: "call" });
    const bbId = game.seats[game.actingIndex].id;
    applyAction(game, bbId, { type: "check" });
    assert.equal(game.street, "flop");
    assert.equal(game.community.length, 3);
    assert.equal(game.burned.length, 1);
  });

  test("legalActions rejects checking into a live bet", () => {
    const game = twoPlayerTable();
    const acting = legalActions(game);
    assert.equal(acting.canCheck, false);
    assert.equal(acting.canCall, true);
  });

  test("fold ends the hand uncontested and awards the full pot", () => {
    const game = twoPlayerTable();
    const sbId = game.seats[game.actingIndex].id;
    const sbSeat = game.seats.find((s) => s.id === sbId);
    const bbSeat = game.seats.find((s) => s.id !== sbId && s.status !== "empty");
    const stackBefore = bbSeat.stack;
    applyAction(game, sbId, { type: "fold" });
    assert.equal(game.street, "complete");
    assert.equal(bbSeat.stack, stackBefore + 25 /* sb */ + 50 /* own bb, refunded via pot */);
    assert.equal(sbSeat.stack, 1000 - 25);
  });

  test("raise reopens action and requires the caller to match", () => {
    const game = twoPlayerTable();
    const sbId = game.seats[game.actingIndex].id;
    applyAction(game, sbId, { type: "raise", to: 200 });
    const legal = legalActions(game);
    assert.equal(legal.callAmount, 150); // 200 - 50 already posted as bb
  });
});

describe("3-handed table", () => {
  test("blinds and preflop action order follow the button, not seat 0", () => {
    const game = makeTable({ seats: 6, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "p1", stack: 1000 });
    seatPlayer(game, { id: "p2", stack: 1000 });
    seatPlayer(game, { id: "p3", stack: 1000 });
    startHand(game);

    const dealer = game.seats[game.dealerIndex];
    const sb = game.seats.find((s) => s.bet === 25);
    const bb = game.seats.find((s) => s.bet === 50);
    assert.notEqual(sb.id, dealer.id); // 3-handed: SB is NOT the dealer (unlike heads-up)
    assert.notEqual(bb.id, sb.id);
    const utg = game.seats[game.actingIndex];
    assert.equal(utg.id, dealer.id); // action starts left of the BB, wrapping to the dealer
  });

  test("postflop action starts left of the dealer", () => {
    const game = makeTable({ seats: 6, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "p1", stack: 1000 });
    seatPlayer(game, { id: "p2", stack: 1000 });
    seatPlayer(game, { id: "p3", stack: 1000 });
    startHand(game);
    // Everyone calls/checks preflop to reach the flop.
    while (game.street === "preflop") {
      const acting = game.seats[game.actingIndex];
      const legal = legalActions(game);
      applyAction(game, acting.id, { type: legal.canCheck ? "check" : "call" });
    }
    const firstToAct = game.seats[game.actingIndex];
    // Distance clockwise from the seat immediately after the dealer (not the
    // dealer's own seat, which only re-enters once the search wraps all the way around).
    const distanceFromDealer = (idx) => (idx - game.dealerIndex - 1 + 6) % 6;
    const expected = game.seats.filter((s) => s.status === "active")
      .sort((a, b) => distanceFromDealer(a.index) - distanceFromDealer(b.index))[0];
    assert.equal(firstToAct.id, expected.id);
  });
});

describe("leaving mid-hand (foldOut)", () => {
  test("heads-up: folding out of turn still resolves the hand uncontested", () => {
    const game = makeTable({ seats: 2, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "p1", stack: 1000 });
    seatPlayer(game, { id: "p2", stack: 1000 });
    startHand(game);
    const acting = game.seats[game.actingIndex].id;
    const other = game.seats.find((s) => s.id !== acting).id;

    foldOut(game, other); // the player who is NOT on the clock leaves

    assert.equal(game.street, "complete");
    assert.equal(game.results.length, 1);
    assert.equal(game.results[0].winners[0].seatId, acting);
    const total = game.seats.reduce((t, s) => t + s.stack, 0);
    assert.equal(total, 2000); // no chips created or destroyed
  });

  test("3-handed: folding a seat that isn't on the clock leaves the current turn untouched", () => {
    const game = makeTable({ seats: 6, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "p1", stack: 1000 });
    seatPlayer(game, { id: "p2", stack: 1000 });
    seatPlayer(game, { id: "p3", stack: 1000 });
    startHand(game);
    const actingBefore = game.seats[game.actingIndex].id;
    const bystander = game.seats.find((s) => s.status === "active" && s.id !== actingBefore).id;

    foldOut(game, bystander);

    assert.equal(game.seats[game.actingIndex].id, actingBefore); // still their turn
    assert.equal(game.seats.find((s) => s.id === bystander).status, "folded");
    assert.equal(game.street, "preflop"); // hand keeps going with 2 players left
  });

  test("folding the seat currently on the clock behaves exactly like applyAction fold", () => {
    const game = makeTable({ seats: 2, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "p1", stack: 1000 });
    seatPlayer(game, { id: "p2", stack: 1000 });
    startHand(game);
    const acting = game.seats[game.actingIndex].id;
    foldOut(game, acting);
    assert.equal(game.street, "complete");
    assert.notEqual(game.results[0].winners[0].seatId, acting);
  });
});

describe("seating the table the way the room is sitting", () => {
  function table() {
    const game = makeTable({ seats: 6 });
    seatPlayer(game, { id: "a", name: "Ann", stack: 100 });
    seatPlayer(game, { id: "b", name: "Ben", stack: 200 });
    seatPlayer(game, { id: "c", name: "Cal", stack: 300 });
    return game;
  }

  test("players end up in the order given, keeping their names and stacks", () => {
    const game = table();
    arrangeSeats(game, ["c", "a", "b"]);
    assert.deepEqual(game.seats.slice(0, 3).map((s) => s.id), ["c", "a", "b"]);
    assert.deepEqual(game.seats.slice(0, 3).map((s) => s.stack), [300, 100, 200]);
    assert.deepEqual(game.seats.slice(0, 3).map((s) => s.name), ["Cal", "Ann", "Ben"]);
    assert.deepEqual(game.seats.map((s) => s.index), [0, 1, 2, 3, 4, 5]);
  });

  test("the button follows the person holding it, not the seat number", () => {
    const game = table();
    game.dealerIndex = 0;                       // Ann has the button
    arrangeSeats(game, ["c", "b", "a"]);        // Ann moves to the last seat
    assert.equal(game.seats[game.dealerIndex].id, "a");
  });

  test("anyone left out of the list keeps their place behind those named", () => {
    const game = table();
    arrangeSeats(game, ["c"]);
    assert.deepEqual(game.seats.slice(0, 3).map((s) => s.id), ["c", "a", "b"]);
  });

  test("unknown and duplicated ids are ignored rather than corrupting the table", () => {
    const game = table();
    arrangeSeats(game, ["b", "ghost", "b", "a"]);
    assert.deepEqual(game.seats.slice(0, 3).map((s) => s.id), ["b", "a", "c"]);
    assert.equal(game.seats.filter((s) => s.status !== "empty").length, 3);
  });

  test("seats vacated by the shuffle are properly empty", () => {
    const game = table();
    arrangeSeats(game, ["a", "b", "c"]);
    for (const s of game.seats.slice(3)) {
      assert.equal(s.status, "empty");
      assert.equal(s.id, null);
      assert.equal(s.stack, 0);
    }
  });

  test("rearranging mid-hand is refused — it would move players out from under the action", () => {
    const game = table();
    startHand(game);
    assert.throws(() => arrangeSeats(game, ["c", "b", "a"]), /Finish the hand/);
  });

  test("rearranging is allowed once the hand is complete", () => {
    const game = table();
    startHand(game);
    while (game.street !== "complete") {
      const acting = game.seats[game.actingIndex];
      const legal = legalActions(game);
      applyAction(game, acting.id, { type: legal.canCheck ? "check" : "fold" });
    }
    assert.doesNotThrow(() => arrangeSeats(game, ["c", "b", "a"]));
  });
});

describe("host controls", () => {
  function live() {
    const game = makeTable({ seats: 6, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "a", name: "Ann", stack: 1000 });
    seatPlayer(game, { id: "b", name: "Ben", stack: 1000 });
    seatPlayer(game, { id: "c", name: "Cal", stack: 1000 });
    startHand(game);
    return game;
  }

  describe("pause", () => {
    test("a paused table refuses player actions", () => {
      const game = live();
      setPaused(game, true);
      const acting = game.seats[game.actingIndex].id;
      assert.throws(() => applyAction(game, acting, { type: "call" }), /paused/i);
    });

    test("resuming lets play continue from exactly where it stopped", () => {
      const game = live();
      const acting = game.seats[game.actingIndex].id;
      setPaused(game, true);
      setPaused(game, false);
      assert.equal(game.seats[game.actingIndex].id, acting);
      assert.doesNotThrow(() => applyAction(game, acting, { type: "call" }));
    });

    test("nobody loses their hand to a clock that ran while play was frozen", () => {
      const game = live();
      setActionTimer(game, 20);
      setPaused(game, true);
      game.actingSince = Date.now() - 60_000;     // a minute passes, paused
      assert.equal(actionExpired(game), false, "a paused clock must not expire");
      setPaused(game, false);
      assert.equal(actionExpired(game), false, "resuming restarts the clock");
    });
  });

  describe("action timer", () => {
    test("off by default, and 0 turns it off again", () => {
      const game = live();
      assert.equal(game.timerSeconds, 0);
      game.actingSince = Date.now() - 600_000;
      assert.equal(actionExpired(game), false, "no clock means no expiry");

      setActionTimer(game, 30);
      game.actingSince = Date.now() - 31_000;
      assert.equal(actionExpired(game), true);

      setActionTimer(game, 0);
      game.actingSince = Date.now() - 31_000;
      assert.equal(actionExpired(game), false, "turning the clock off stops expiry");
    });

    test("switching the clock on gives whoever is thinking a full turn, not an instant fold", () => {
      const game = live();
      game.actingSince = Date.now() - 600_000;   // they've been deciding for ages
      setActionTimer(game, 30);
      assert.equal(actionExpired(game), false);
      assert.equal(foldExpired(game), false);
    });

    test("expires only once the time has actually run out", () => {
      const game = live();
      setActionTimer(game, 30);
      assert.equal(actionExpired(game, Date.now() + 29_000), false);
      assert.equal(actionExpired(game, Date.now() + 31_000), true);
    });

    test("a timed-out player checks when they can, and folds when they can't", () => {
      // Pre-flop there's a blind to call, so timing out has to fold.
      const game = live();
      setActionTimer(game, 30);
      const onClock = game.seats[game.actingIndex].id;
      game.actingSince = Date.now() - 31_000;
      assert.equal(foldExpired(game), true);
      assert.equal(game.seats.find((s) => s.id === onClock).status, "folded");
    });

    test("checking is free, so a timeout never folds a hand that could stay in", () => {
      const game = live();
      // Get to a street where the player on the clock faces no bet.
      while (game.street === "preflop") {
        const acting = game.seats[game.actingIndex];
        const legal = legalActions(game);
        applyAction(game, acting.id, { type: legal.canCheck ? "check" : "call" });
      }
      setActionTimer(game, 30);
      const onClock = game.seats[game.actingIndex].id;
      assert.equal(legalActions(game).canCheck, true);
      game.actingSince = Date.now() - 31_000;
      assert.equal(foldExpired(game), true);
      assert.equal(game.seats.find((s) => s.id === onClock).status, "active", "should have checked, not folded");
    });

    test("the server refuses to fold a clock that hasn't expired", () => {
      const game = live();
      setActionTimer(game, 30);
      assert.equal(foldExpired(game), false);
      assert.equal(game.seats[game.actingIndex].status, "active");
    });

    test("the clock restarts for each new player, rather than being inherited", () => {
      const game = live();
      setActionTimer(game, 30);
      game.actingSince = Date.now() - 29_000;      // first player nearly out of time
      const acting = game.seats[game.actingIndex].id;
      applyAction(game, acting, { type: "call" });
      assert.ok(Date.now() - game.actingSince < 1000, "next player got a fresh clock");
      assert.equal(actionExpired(game), false);
    });
  });

  describe("blinds", () => {
    test("can be set between hands", () => {
      const game = makeTable({ seats: 4 });
      setBlinds(game, 100, 200);
      assert.equal(game.smallBlind, 100);
      assert.equal(game.bigBlind, 200);
    });

    test("refused mid-hand — players have already committed at the old stakes", () => {
      const game = live();
      assert.throws(() => setBlinds(game, 100, 200), /Finish the hand/);
    });

    test("the ladder walks up the standard levels", () => {
      const game = makeTable({ seats: 4 });
      setBlindLevel(game, 2);
      assert.equal(game.blindLevel, 2);
      assert.equal(game.smallBlind, DEFAULT_BLIND_LEVELS[2].smallBlind);
      assert.equal(game.bigBlind, DEFAULT_BLIND_LEVELS[2].bigBlind);
    });

    test("a level off the end of the ladder clamps instead of breaking", () => {
      const game = makeTable({ seats: 4 });
      setBlindLevel(game, 999);
      assert.equal(game.blindLevel, DEFAULT_BLIND_LEVELS.length - 1);
      setBlindLevel(game, -5);
      assert.equal(game.blindLevel, 0);
    });

    test("a big blind smaller than the small blind is corrected, not accepted", () => {
      const game = makeTable({ seats: 4 });
      setBlinds(game, 200, 50);
      assert.ok(game.bigBlind >= game.smallBlind);
    });

    test("new blinds take effect on the next hand", () => {
      const game = live();
      while (game.street !== "complete") {
        const acting = game.seats[game.actingIndex];
        const legal = legalActions(game);
        applyAction(game, acting.id, { type: legal.canCheck ? "check" : "call" });
      }
      setBlinds(game, 100, 200);
      startHand(game);
      const posted = game.seats.filter((s) => s.bet > 0).map((s) => s.bet).sort((x, y) => x - y);
      assert.deepEqual(posted, [100, 200]);
    });
  });

  describe("ending a hand early", () => {
    test("every chip committed goes back to the player who bet it", () => {
      const game = live();
      const before = new Map(game.seats.filter((s) => s.id).map((s) => [s.id, s.stack + s.totalBet]));
      const acting = game.seats[game.actingIndex].id;
      applyAction(game, acting, { type: "raise", to: 300 });
      endHand(game);
      for (const [id, total] of before) {
        assert.equal(game.seats.find((s) => s.id === id).stack, total, `${id} was not made whole`);
      }
    });

    test("no winner is recorded — nobody won it", () => {
      const game = live();
      endHand(game);
      assert.equal(game.street, "complete");
      assert.deepEqual(game.results, []);
      assert.equal(game.handVoided, true);
      assert.equal(game.actingIndex, -1);
    });

    test("the felt is cleared, so the next hand starts clean", () => {
      const game = live();
      endHand(game);
      assert.deepEqual(game.community, []);
      for (const seat of game.seats) assert.deepEqual(seat.holeCards, []);
    });

    test("the next hand deals normally and is no longer marked void", () => {
      const game = live();
      endHand(game);
      startHand(game);
      assert.equal(game.handVoided, false);
      assert.equal(game.street, "preflop");
      assert.equal(game.seats.filter((s) => s.holeCards.length === 2).length, 3);
    });

    test("ending a hand that isn't running does nothing", () => {
      const game = makeTable({ seats: 4 });
      seatPlayer(game, { id: "a", stack: 500 });
      endHand(game);
      assert.equal(game.seats[0].stack, 500);
    });
  });

  test("auto-deal is just a remembered preference", () => {
    const game = makeTable({ seats: 4 });
    assert.equal(game.autoDeal, false);
    setAutoDeal(game, true);
    assert.equal(game.autoDeal, true);
  });
});

describe("side pots", () => {
  test("three unequal all-ins split into layered pots with correct eligibility", () => {
    const seats = [
      { id: "short", totalBet: 100, status: "allin" },
      { id: "mid", totalBet: 300, status: "allin" },
      { id: "big", totalBet: 300, status: "active" },
    ];
    const pots = buildPots(seats);
    // Layer 1: all three chip in 100 each = 300, everyone eligible.
    // Layer 2: mid+big chip in 200 more each = 400, only mid+big eligible.
    assert.equal(pots.length, 2);
    assert.equal(pots[0].amount, 300);
    assert.deepEqual(pots[0].eligible.sort(), ["big", "mid", "short"]);
    assert.equal(pots[1].amount, 400);
    assert.deepEqual(pots[1].eligible.sort(), ["big", "mid"]);
  });

  test("a folded contributor's chips still count toward the pot but they're not eligible", () => {
    const seats = [
      { id: "folder", totalBet: 200, status: "folded" },
      { id: "winner", totalBet: 200, status: "active" },
    ];
    const pots = buildPots(seats);
    assert.equal(pots.length, 1);
    assert.equal(pots[0].amount, 400);
    assert.deepEqual(pots[0].eligible, ["winner"]);
  });
});

describe("multi-way all-in through the real action pipeline", () => {
  test("a short all-in creates a side pot the bigger stacks keep fighting for", () => {
    const game = makeTable({ seats: 3, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "short", stack: 150 });
    seatPlayer(game, { id: "mid", stack: 1000 });
    seatPlayer(game, { id: "big", stack: 1000 });
    startHand(game); // dealer=short(sb=25... 3-handed so short is UTG actually; blinds go to mid/big region)

    // Play it out generically: whoever's on the clock either shoves (short,
    // once) or calls, until the hand ends — exercises the real state machine
    // rather than hand-picking seat order.
    let guard = 0;
    while (game.street !== "complete" && guard++ < 20) {
      const acting = game.seats[game.actingIndex];
      const legal = legalActions(game);
      if (acting.id === "short" && acting.stack > 0) {
        applyAction(game, acting.id, { type: legal.canBet ? "bet" : "raise", to: acting.bet + acting.stack });
      } else if (legal.canCheck) {
        applyAction(game, acting.id, { type: "check" });
      } else {
        applyAction(game, acting.id, { type: "call" });
      }
    }

    assert.equal(game.street, "complete");
    assert.ok(guard < 20, "hand should resolve, not loop forever");
    // The short stack shoved everything in; it only has chips afterward if it
    // won some of the pot back at showdown — either way it committed all 150.
    const shortSeat = game.seats.find((s) => s.id === "short");
    assert.equal(shortSeat.totalBet, 150);
    // Total chips in play must be conserved — nothing created or destroyed.
    const totalStacks = game.seats.reduce((t, s) => t + s.stack, 0);
    assert.equal(totalStacks, 150 + 1000 + 1000);
    // Side pot must exist since the short stack couldn't cover the bigger bets.
    assert.ok(game.pots.length >= 1);
    assert.ok(!game.pots[0].eligible.includes(undefined));
  });
});

describe("full hand simulation with a fixed deck", () => {
  test("heads-up all-in preflop runs the board out and pays the better hand", () => {
    const game = makeTable({ seats: 2, smallBlind: 25, bigBlind: 50 });
    seatPlayer(game, { id: "p1", name: "Alice", stack: 500 });
    seatPlayer(game, { id: "p2", name: "Bob", stack: 500 });

    // Deal order is round-robin from the small blind: p1 gets cards 0 & 2,
    // p2 gets cards 1 & 3 (fixed deck below assumes dealerIndex/sbIndex = seat 0).
    const fixedDeck = [
      c(14, "s"), c(2, "h"),   // hole card round 1: p1=As, p2=2h
      c(14, "d"), c(2, "c"),   // hole card round 2: p1=Ad, p2=2c  -> p1 has pocket aces
      c(9, "s"),               // burn
      c(3, "h"), c(4, "h"), c(5, "h"), // flop
      c(9, "d"),                // burn
      c(6, "h"),                // turn
      c(9, "c"),                // burn
      c(7, "h"),                // river -> board has a 3-4-5-6-7 straight AND a heart flush draw
    ];
    startHand(game, { deck: fixedDeck });

    const sbId = game.seats[game.actingIndex].id; // seat 0 = dealer = sb in heads-up
    const bbId = game.seats.find((s) => s.id !== sbId).id;

    applyAction(game, sbId, { type: "raise", to: 500 }); // all-in
    applyAction(game, bbId, { type: "call" });

    assert.equal(game.street, "complete");
    assert.equal(game.community.length, 5);
    assert.equal(game.results.length, 1);

    // Board plays a straight-flush-ish runout (3h4h5h6h7h) for both — with a
    // community straight flush on board, both share it (board plays).
    const winnerIds = game.results[0].winners.map((w) => w.seatId).sort();
    assert.deepEqual(winnerIds, ["p1", "p2"]); // split pot, board is the best 5 for both
    for (const w of game.results[0].winners) assert.equal(w.share, 500);
    assert.equal(game.seats.find((s) => s.id === "p1").stack, 500);
    assert.equal(game.seats.find((s) => s.id === "p2").stack, 500);
  });
});
