// What just happened at the table — the dealer's cue sheet.
//
// The TV polls for whole snapshots rather than receiving a stream of events
// (see buzzer/api/poker.js), so nothing ever tells the dealer "a player just
// shoved". This module recovers that: hand two consecutive public snapshots to
// `pokerEvents` and it returns what changed, named in terms the dealer cares
// about, most dramatic first.
//
// Pure and DOM-free so it can be unit-tested. Two readings of the same diff
// live here: `pokerEvents` ranks it down to the one thing worth *saying*, and
// `pokerSoundCues` at the bottom keeps all of it, because a table makes several
// noises at once. Neither needs the dealer to exist.

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

/* ============================================================ sound cues */

/**
 * The same two snapshots, heard rather than narrated.
 *
 * `pokerEvents` above answers "what is the one thing worth *saying*", so it
 * ranks and returns a single headline's worth. Sound wants the opposite: a
 * table makes a noise for every small thing, all at once and none of them
 * exclusive — a raise is chips *and* a gasp, and the player who checked before
 * it still knocked on the felt. So this returns everything that happened, in
 * the order it happened, with the amounts a cue needs to scale itself.
 *
 * Pure and DOM-free, like everything else here: the speaker lives in
 * platform/ui/poker-sound.js.
 *
 * @typedef {Object} PokerCue
 * @property {string} type    What to play.
 * @property {string} [seatId]  Who caused it, where that's meaningful.
 * @property {number} [amount]  Chips involved, for cues that scale with money.
 * @property {number} [count]   Cards involved, for cues that repeat per card.
 * @property {boolean} [raise]  A chips cue that was a bet/raise, not a call.
 * @property {boolean} [big]    Worth the loud version.
 */

/** A pot worth this many big blinds gets the crowd going. */
const APPLAUSE_POT_BB = 25;

/** Seats that are still in the hand, keyed by id, for quick diffing. */
function seatsById(snapshot) {
  const map = new Map();
  for (const s of (snapshot && snapshot.seats) || []) if (s.id) map.set(s.id, s);
  return map;
}

/**
 * Every noise the table should make between two public snapshots.
 *
 * @param {Object|null} prev  The previous snapshot, or null on the first poll.
 * @param {Object|null} next  The current snapshot.
 * @returns {PokerCue[]}
 */
export function pokerSoundCues(prev, next) {
  if (!next) return [];
  /** @type {PokerCue[]} */
  const cues = [];
  const newHand = !prev || prev.handNumber !== next.handNumber;
  const bb = next.bigBlind || 1;

  // ---- a hand began: shuffle, then cards in the air ------------------------
  // Only from a snapshot we can compare against. On the very first poll we may
  // be joining a hand that is already halfway through, and dealing sounds for
  // cards that went out minutes ago would be a lie.
  if (prev && newHand && next.street === "preflop") {
    const live = (next.seats || []).filter((s) => s.id && (s.status === "active" || s.status === "allin"));
    cues.push({ type: "shuffle" });
    if (live.length) cues.push({ type: "deal", count: live.length * 2 });
  }

  // ---- per-player action --------------------------------------------------
  // Only within one hand: across a hand boundary every seat's numbers reset,
  // and the differences mean nothing.
  if (prev && !newHand) {
    const before = seatsById(prev);
    // `bet` is wiped at the end of every street, so it can't be differenced
    // across one. `totalBet` only ever climbs within a hand, which makes it the
    // honest measure of "what did this player just put in".
    for (const seat of next.seats || []) {
      const was = seat.id && before.get(seat.id);
      if (!was) continue;
      const put = (seat.totalBet || 0) - (was.totalBet || 0);

      if (was.status === "active" && seat.status === "folded") {
        cues.push({ type: "fold", seatId: seat.id });
        continue;
      }

      if (put > 0) {
        // A call matches what was already out there; a raise moves the price.
        const raise = (next.currentBet || 0) > (prev.currentBet || 0);
        cues.push({ type: "chips", seatId: seat.id, amount: put, raise });
      } else if (
        was.status === "active" && seat.status === "active"
        // Nothing to call, and the action moved on without them paying: a check.
        && (was.bet || 0) >= (prev.currentBet || 0)
        && prev.actingId === seat.id && next.actingId !== seat.id
      ) {
        cues.push({ type: "check", seatId: seat.id });
      }

      if (was.status !== "allin" && seat.status === "allin") {
        cues.push({ type: "allIn", seatId: seat.id, amount: seat.totalBet || put });
      }
    }
  }

  // ---- the board ----------------------------------------------------------
  // Polling can skip a street when everyone is all in, so walk from where we
  // were to where we are and burn a cue for each one actually dealt.
  const from = !prev || newHand ? 0 : Math.max(0, STREETS.indexOf(prev.street));
  const to = STREETS.indexOf(next.street);
  for (let s = from + 1; s <= to; s++) {
    cues.push({ type: "board", street: STREETS[s], count: s === 1 ? 3 : 1 });
  }

  // ---- the hand ended -----------------------------------------------------
  const becameComplete = next.street === "complete"
    && (!prev || newHand || prev.street !== "complete");
  if (becameComplete && !next.handVoided) {
    const results = next.results || [];
    const pot = results.reduce((t, r) => t + (r.amount || 0), 0) || next.pot || 0;
    const showdown = !isUncontested(results);

    if (showdown) cues.push({ type: "showdown" });
    cues.push({ type: "potPush", amount: pot });
    cues.push({ type: "win", amount: pot, big: showdown && pot >= bb * APPLAUSE_POT_BB });
    if (showdown && pot >= bb * APPLAUSE_POT_BB) cues.push({ type: "applause", amount: pot });

    // Anyone left with nothing. Only worth asking once the hand is over: a
    // stack of zero mid-hand means all-in, which is a different sound and a
    // very different feeling. `totalBet` is what separates someone who just
    // lost everything from someone who busted an earlier hand and has been
    // sitting there broke ever since — the latter was never dealt in.
    for (const seat of next.seats || []) {
      if (seat.id && !seat.stack && (seat.totalBet || 0) > 0) {
        cues.push({ type: "bust", seatId: seat.id });
      }
    }
  }

  return cues;
}
