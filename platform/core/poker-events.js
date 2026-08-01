// What just happened at the table — the dealer's cue sheet.
//
// The TV polls for whole snapshots rather than receiving a stream of events
// (see buzzer/api/poker.js), so nothing ever tells the dealer "a player just
// shoved". This module recovers that: hand two consecutive public snapshots to
// `pokerEvents` and it returns what changed, named in terms the dealer cares
// about, most dramatic first.
//
// Pure and DOM-free so it can be unit-tested, and so the same cue sheet can
// later drive sound effects (phase 10) without the dealer being involved at all.

import { bestHandRank, compareHandRanks } from "./poker.js";

/**
 * @typedef {"royalFlush"|"badBeat"|"chopPot"|"showdown"|"fold"|"allIn"
 *          |"bigBet"|"river"|"turn"|"flop"|"handStart"} PokerEvent
 */

const STREETS = ["preflop", "flop", "turn", "river"];

/** A raise has to be at least this much of the pot before it's worth a comment. */
const BIG_BET_POT_FRACTION = 0.6;
/** …and at least this many big blinds, so early streets don't trigger on scraps. */
const BIG_BET_MIN_BB = 4;
/** A losing hand this strong (full house or better) is a bad beat, not a loss. */
const BAD_BEAT_CATEGORY = 6;

/** Events in the order the dealer should prefer them — first one wins the mic. */
const PRIORITY = [
  "royalFlush", "badBeat", "chopPot", "showdown", "fold",
  "allIn", "bigBet", "river", "turn", "flop", "handStart",
];

/** Was this hand won without anyone showing a card? */
function isUncontested(results) {
  return results.some((r) => (r.winners || []).some((w) => w.handName === "Uncontested"));
}

/** The best hand held by someone who *didn't* win — how a bad beat is spotted. */
function bestLosingRank(game, winnerIds) {
  let best = null;
  for (const seat of game.seats || []) {
    if (!seat.id || winnerIds.has(seat.id)) continue;
    if (seat.status === "folded" || seat.status === "empty") continue;
    const hole = (seat.holeCards || []).filter(Boolean);
    // Only showdowns reveal hole cards; anything still face-down can't be judged.
    if (hole.length < 2) continue;
    const rank = bestHandRank([...hole, ...(game.community || [])]);
    if (!best || compareHandRanks(rank, best) > 0) best = rank;
  }
  return best;
}

/**
 * What changed between two public snapshots.
 *
 * @param {Object|null} prev  The previous snapshot, or null on the first poll.
 * @param {Object|null} next  The current snapshot.
 * @returns {PokerEvent[]} Most dramatic first; empty when nothing notable moved.
 */
export function pokerEvents(prev, next) {
  if (!next) return [];
  const events = new Set();
  const newHand = !prev || prev.handNumber !== next.handNumber;

  // ---- a hand began -------------------------------------------------------
  if (newHand && next.handNumber > 0 && next.street !== "waiting") {
    events.add("handStart");
  }

  // ---- a street was dealt -------------------------------------------------
  // Polling can skip a street entirely (turn and river both land between two
  // polls when players are all in), so announce the furthest one reached.
  const from = !prev || newHand ? 0 : Math.max(0, STREETS.indexOf(prev.street));
  const to = STREETS.indexOf(next.street);
  if (to > from) events.add(STREETS[to]);

  // ---- somebody committed everything -------------------------------------
  if (!newHand && prev) {
    const wasAllIn = new Set((prev.seats || []).filter((s) => s.status === "allin").map((s) => s.id));
    const nowAllIn = (next.seats || []).filter((s) => s.status === "allin" && s.id && !wasAllIn.has(s.id));
    if (nowAllIn.length) events.add("allIn");

    // ---- somebody made a big raise ---------------------------------------
    // Only a genuine raise counts: matching a bet already on the felt is a
    // call, however many chips it happens to cost.
    if (next.currentBet > prev.currentBet) {
      const raise = next.currentBet - prev.currentBet;
      const bar = Math.max((prev.pot || 0) * BIG_BET_POT_FRACTION, (next.bigBlind || 0) * BIG_BET_MIN_BB);
      if (raise >= bar && !nowAllIn.length) events.add("bigBet");
    }
  }

  // ---- the hand ended -----------------------------------------------------
  const becameComplete = next.street === "complete"
    && (!prev || newHand || prev.street !== "complete");
  if (becameComplete) {
    const results = next.results || [];
    const winnerIds = new Set(results.flatMap((r) => (r.winners || []).map((w) => w.seatId)));
    const winnerRanks = results.flatMap((r) => (r.winners || []).map((w) => w.rank)).filter(Boolean);

    if (isUncontested(results)) {
      events.add("fold");
    } else {
      events.add("showdown");
      if (winnerRanks.some((r) => r.category === 8 && r.tiebreak[0] === 14)) events.add("royalFlush");
      if (results.some((r) => (r.winners || []).length > 1)) events.add("chopPot");

      const loser = bestLosingRank(next, winnerIds);
      if (loser && loser.category >= BAD_BEAT_CATEGORY) events.add("badBeat");
    }
  }

  return PRIORITY.filter((e) => events.has(e));
}

/** The single line the dealer should speak for a set of events, or null. */
export function headlineEvent(events) {
  return events && events.length ? events[0] : null;
}
