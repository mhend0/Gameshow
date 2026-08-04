// Opponents to practise against.
//
// Six players who are each wrong in a different, recognisable way. That is the
// point of them: an Academy hand against a single "correct" bot teaches you one
// thing, whereas learning that the maniac's raise means nothing and the rock's
// means everything is most of what playing well actually consists of.
//
// Every decision comes from four inputs, weighted differently per personality:
//
//   * how good the hand is — real equity against the number of players still
//     in, from poker-odds.js, not a hand-strength lookup table;
//   * what it costs — the pot odds actually being laid;
//   * where they're sitting — acting last is worth a lot, and only the better
//     players here know that;
//   * and a coin flip, so a personality is a tendency rather than a lookup.
//
// The randomness is injectable and defaults to Math.random, so every test in
// poker-ai.test.js pins a sequence and gets the same decision every run.
//
// Nothing here trusts itself: `decideAction` finishes by forcing whatever it
// came up with through the engine's own `legalActions`, so a personality can
// never produce something `applyAction` would throw on. A bug in a bot's
// judgement should cost it chips, not crash the table.

import { legalActions } from "./poker.js";
import { equityVsRandom, potOdds } from "./poker-odds.js";

/**
 * Samples per decision. Low on purpose: this runs between a person clicking
 * and the table moving, and the third decimal place of an opponent's equity
 * estimate is not what makes them fun to play against. ±1.5% or so.
 */
const DECISION_TRIALS = 600;

/**
 * @typedef {Object} Personality
 * @property {string} key
 * @property {string} name      What the seat is called at the table.
 * @property {string} tell      One line describing how they play, for the UI.
 * @property {number} tightness Equity a hand needs before they'll put money in.
 * @property {number} aggression Chance of raising rather than calling when ahead.
 * @property {number} bluff     Chance of betting a hand that has nothing.
 * @property {number} slack     Extra equity they'll forgive when calling. Above
 *                              zero is a calling station; below zero folds too much.
 * @property {number[]} sizing  Bet size as a fraction of the pot, [min, max].
 * @property {number} position  How much they let position loosen them, 0–1.
 */

/** @type {Personality[]} */
export const AI_PERSONALITIES = [
  {
    key: "rock",
    name: "The Rock",
    tell: "Folds and folds and folds. When she finally bets, believe her.",
    tightness: 0.62, aggression: 0.45, bluff: 0.02, slack: -0.04,
    sizing: [0.5, 0.75], position: 0.15,
  },
  {
    key: "station",
    name: "The Calling Station",
    tell: "Will call you down with anything. Bluffing him is setting money on fire.",
    tightness: 0.34, aggression: 0.08, bluff: 0.02, slack: 0.16,
    sizing: [0.3, 0.5], position: 0.05,
  },
  {
    key: "looseGoose",
    name: "The Optimist",
    tell: "Plays far too many hands and hopes. Sometimes it works, which is the problem.",
    tightness: 0.30, aggression: 0.30, bluff: 0.12, slack: 0.10,
    sizing: [0.4, 0.7], position: 0.10,
  },
  {
    key: "hammer",
    name: "The Hammer",
    tell: "Bets and raises relentlessly. Strong hands, weak hands, you won't know.",
    tightness: 0.45, aggression: 0.80, bluff: 0.30, slack: 0.02,
    sizing: [0.65, 1.0], position: 0.30,
  },
  {
    key: "maniac",
    name: "The Maniac",
    tell: "Raises with anything at all. Wait for a hand and let him pay you.",
    tightness: 0.22, aggression: 0.92, bluff: 0.55, slack: 0.08,
    sizing: [0.85, 1.5], position: 0.10,
  },
  {
    key: "pro",
    name: "The Professional",
    tell: "Plays position, respects the price, and won't pay you off. Beating her is the exam.",
    tightness: 0.50, aggression: 0.62, bluff: 0.22, slack: 0.0,
    sizing: [0.5, 0.85], position: 0.55,
  },
];

const BY_KEY = new Map(AI_PERSONALITIES.map((p) => [p.key, p]));

/** A personality by key, falling back to the balanced one. */
export function getPersonality(key) {
  return BY_KEY.get(key) || BY_KEY.get("pro");
}

/* ================================================================ context */

/** Seats still capable of taking the pot away from us. */
function liveOpponents(game, seatId) {
  return game.seats.filter((s) => s.id && s.id !== seatId && (s.status === "active" || s.status === "allin")).length;
}

/**
 * How late this seat acts, 0 (first) to 1 (last, on the button).
 *
 * Position is measured around the seats still in the hand rather than around
 * the whole table — with five players folded, the button is not where the
 * advantage sits any more.
 */
export function positionFactor(game, seatId) {
  const live = game.seats.filter((s) => s.id && s.status === "active");
  if (live.length < 2) return 1;
  const order = [];
  for (let i = 1; i <= game.seats.length; i++) {
    const seat = game.seats[(game.dealerIndex + i) % game.seats.length];
    if (seat.id && seat.status === "active") order.push(seat.id);
  }
  const at = order.indexOf(seatId);
  if (at < 0) return 0.5;
  return order.length === 1 ? 1 : at / (order.length - 1);
}

/* =============================================================== decision */

/**
 * @typedef {Object} AiDecision
 * @property {"fold"|"check"|"call"|"bet"|"raise"} type
 * @property {number} [to]
 * @property {string} reason  Why, in a sentence — the Academy shows this after
 *                            the hand so a bot's play can be argued with.
 * @property {number} equity  What it thought it was worth, 0–1.
 */

/**
 * What this personality does with the hand it's holding.
 *
 * @param {Object} game     A full engine game (not a redacted public view —
 *                          a bot has to be able to see its own cards).
 * @param {string} seatId
 * @param {Personality|string} personality
 * @param {{random?:()=>number, trials?:number}} [opts]
 * @returns {AiDecision|null}  Null when this seat isn't the one to act.
 */
export function decideAction(game, seatId, personality, opts = {}) {
  const who = typeof personality === "string" ? getPersonality(personality) : personality;
  const { random = Math.random, trials = DECISION_TRIALS } = opts;

  const legal = legalActions(game);
  const seat = game.seats[game.actingIndex];
  if (!legal || !seat || seat.id !== seatId) return null;

  const opponents = Math.max(1, liveOpponents(game, seatId));
  const { equity } = equityVsRandom(seat.holeCards, game.community, {
    opponents,
    trials,
    // Seeded off the hand and street so one bot's view of one spot is stable
    // across the several times a UI may ask for it, without every bot at the
    // table sampling the identical boards.
    seed: hashSeed(game.handNumber, game.street, seat.index),
  });

  // Position loosens a hand, but only for the players who understand that.
  const late = positionFactor(game, seatId);
  const positional = (late - 0.5) * who.position * 0.18;
  const strength = equity + positional;

  const pot = game.seats.reduce((total, s) => total + s.totalBet, 0);
  const price = potOdds(legal.callAmount, pot);

  const decide = () => {
    /* ---- nothing to call: check, or take a stab ------------------------- */
    if (legal.canCheck) {
      const strong = strength >= who.tightness;
      const bluffing = !strong && random() < who.bluff;
      if (legal.canBet && (strong ? random() < who.aggression : bluffing)) {
        return {
          type: "bet",
          to: sizeBet(game, legal, who, pot, random),
          reason: strong
            ? `Bets a hand worth ${asPct(strength)} with nobody to beat yet.`
            : "Nothing at all, so takes a stab at it.",
        };
      }
      return { type: "check", reason: strong ? "Slow-plays it." : "Checks and hopes to see another card cheaply." };
    }

    /* ---- facing a bet ---------------------------------------------------- */
    // The pot lays a price; the personality decides how honestly to read it.
    // `slack` is where a calling station and a nit actually differ: the maths
    // is the same for both, and only one of them believes it.
    const needed = price.breakEven - who.slack;
    const canBeat = strength >= needed;

    if (canBeat && legal.canRaise && strength >= who.tightness && random() < who.aggression) {
      return {
        type: "raise",
        to: sizeBet(game, legal, who, pot, random),
        reason: `Raises: ${asPct(strength)} against a price of ${asPct(price.breakEven)}.`,
      };
    }
    if (canBeat && legal.canCall) {
      return {
        type: "call",
        reason: `Calls ${legal.callAmount}: needs ${asPct(price.breakEven)}, reckons on ${asPct(strength)}.`,
      };
    }
    // A bluff-raise with a hand that can't call is the one aggressive line
    // that isn't just "I have it" — and it's what makes the maniac readable
    // once you've seen it a few times.
    if (legal.canRaise && random() < who.bluff * 0.5) {
      return { type: "raise", to: sizeBet(game, legal, who, pot, random), reason: "Raises with nothing." };
    }
    return {
      type: "fold",
      reason: `Folds: ${asPct(strength)} isn't worth ${asPct(price.breakEven)}.`,
    };
  };

  return { ...legalise(decide(), legal), equity };
}

/** 0.42 → "42%". */
const asPct = (n) => `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;

/**
 * A bet or raise sized as a share of the pot, clamped to what's legal.
 *
 * Sizing is where the personalities are most visible from across the table —
 * the maniac's pot-and-a-half and the station's timid third of a pot both
 * announce themselves before anybody sees a card.
 */
function sizeBet(game, legal, who, pot, random) {
  const [min, max] = who.sizing;
  const fraction = min + random() * Math.max(0, max - min);
  const wanted = Math.round((legal.canBet ? 0 : game.currentBet) + Math.max(pot, game.bigBlind) * fraction);
  return Math.max(legal.minTo, Math.min(legal.maxTo, wanted));
}

/**
 * Force a decision into something the engine will actually accept.
 *
 * The last line of defence, and deliberately paranoid: every branch above
 * checks the relevant `can*` flag already, so nothing should need correcting
 * here. But a bot is not worth crashing a table over, and "the maniac checked
 * instead of raising" is a failure nobody will ever notice.
 */
function legalise(decision, legal) {
  const fallback = legal.canCheck
    ? { type: "check", reason: "Checks." }
    : { type: "fold", reason: "Folds." };
  if (!decision) return fallback;

  switch (decision.type) {
    case "check": return legal.canCheck ? decision : fallback;
    case "fold":  return legal.canFold ? decision : fallback;
    case "call":  return legal.canCall ? decision : fallback;
    case "bet":
    case "raise": {
      const allowed = decision.type === "bet" ? legal.canBet : legal.canRaise;
      if (!allowed) return legal.canCall ? { ...decision, type: "call", to: undefined } : fallback;
      const to = Math.max(legal.minTo, Math.min(legal.maxTo, Math.round(decision.to)));
      return { ...decision, to };
    }
    default: return fallback;
  }
}

/**
 * A small stable seed from the parts of a spot that identify it.
 * Not a hash anybody should rely on for anything but variety.
 */
function hashSeed(handNumber, street, seatIndex) {
  const streetIndex = ["waiting", "preflop", "flop", "turn", "river", "complete"].indexOf(street) + 1;
  let s = ((handNumber & 0xffff) << 8) ^ (streetIndex << 4) ^ (seatIndex & 0xf);
  s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
  s = Math.imul(s ^ (s >>> 12), 0x297a2d39);
  return (s ^ (s >>> 15)) >>> 0 || 1;
}
