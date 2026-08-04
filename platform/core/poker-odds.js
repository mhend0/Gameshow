// Odds, outs and equity — the arithmetic the Academy teaches.
//
// Everything here is built on `bestHandRank` from poker.js rather than on a
// second, faster hand evaluator. That's a deliberate trade: a bespoke evaluator
// would run several times quicker, but a trainer that disagreed with the table
// about which hand wins would be worse than no trainer at all. Hand strength
// has exactly one definition in this codebase.
//
// Two ways of answering "how often does this win":
//
//   * enumeration — deal every possible remaining board and count. Exact, and
//     the honest answer whenever it's affordable (a flop with two cards to
//     come is 990 boards; a turn is 44).
//   * Monte Carlo — sample boards at random. Preflop there are 1.7 million
//     boards per match-up, which is not something to do while somebody waits,
//     so this samples instead and says so in the result.
//
// The sampler is seeded. A trainer that quotes 82% one moment and 79% the next
// for the same question looks broken even though both are right, so identical
// questions get identical answers, and a lesson can quote a number it computed
// earlier without it drifting underneath.

import { bestHandRank, compareHandRanks, makeDeck, cardCode, rankLabel } from "./poker.js";

/** Enumerate rather than sample while the board count is no bigger than this. */
const EXACT_BOARD_LIMIT = 30000;
/** Samples when enumeration is off the table. ±0.5% or so at 95% confidence. */
const DEFAULT_TRIALS = 12000;

/* ===================================================================== rng */

/**
 * xorshift32. Seeded and pure — see the note above about identical questions
 * needing identical answers. Deliberately not the crypto-backed shuffle the
 * engine uses: this one has to be reproducible, that one must not be.
 */
export function seededRandom(seed = 0x5eed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x100000000;
  };
}

/* ================================================================== cards */

const key = (card) => `${card.rank}${card.suit}`;

/**
 * The cards nobody has seen yet.
 * @param {Card[]} known  Hole cards and board, in any order.
 * @returns {Card[]}
 */
export function remainingDeck(known) {
  const seen = new Set((known || []).filter(Boolean).map(key));
  return makeDeck().filter((c) => !seen.has(key(c)));
}

/** n-choose-k, as a float — only ever used on deck-sized numbers. */
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1);
  return Math.round(out);
}

/**
 * Every way of picking `k` cards from `pool`, as arrays. Only called when the
 * caller has already decided the count is small enough to enumerate.
 */
function eachCombination(pool, k, visit) {
  const combo = new Array(k);
  (function go(start, depth) {
    if (depth === k) { visit(combo); return; }
    for (let i = start; i <= pool.length - (k - depth); i++) {
      combo[depth] = pool[i];
      go(i + 1, depth + 1);
    }
  })(0, 0);
}

/* ================================================================= equity */

/**
 * @typedef {Object} EquityResult
 * @property {number} equity  Share of the pot won on average, 0–1 (ties split).
 * @property {number} win     Fraction of boards won outright.
 * @property {number} tie     Fraction of boards split.
 */

/**
 * How often each hand wins, given whatever board is already out.
 *
 * Hands are known hole cards — this does not model a range, only specific
 * cards, which is what every lesson in the Academy is phrased in terms of. Use
 * `equityVsRandom` for "against anything".
 *
 * @param {Card[][]} hands  Two or more players' hole cards.
 * @param {Card[]} [community]  The board so far (0, 3, 4 or 5 cards).
 * @param {{trials?:number, seed?:number, exact?:boolean}} [opts]
 * @returns {{hands: EquityResult[], boards: number, exact: boolean}}
 */
export function equity(hands, community = [], opts = {}) {
  const { trials = DEFAULT_TRIALS, seed = 0x5eed } = opts;
  const board = community.filter(Boolean);
  const players = hands.map((h) => h.filter(Boolean));
  if (players.length < 2) throw new Error("Equity needs at least two hands.");

  const deck = remainingDeck([...board, ...players.flat()]);
  const toCome = 5 - board.length;
  const boardCount = choose(deck.length, toCome);
  const exact = opts.exact != null ? opts.exact : boardCount <= EXACT_BOARD_LIMIT;

  const wins = new Array(players.length).fill(0);
  const ties = new Array(players.length).fill(0);
  const share = new Array(players.length).fill(0);
  let boards = 0;

  /** Score one completed board and bank the result. */
  const settle = (extra) => {
    boards++;
    const full = extra.length ? [...board, ...extra] : board;
    let best = null;
    let winners = [];
    for (let i = 0; i < players.length; i++) {
      const rank = bestHandRank([...players[i], ...full]);
      const cmp = best === null ? 1 : compareHandRanks(rank, best);
      if (cmp > 0) { best = rank; winners = [i]; }
      else if (cmp === 0) winners.push(i);
    }
    if (winners.length === 1) {
      wins[winners[0]]++;
      share[winners[0]] += 1;
    } else {
      for (const i of winners) { ties[i]++; share[i] += 1 / winners.length; }
    }
  };

  if (toCome === 0) {
    settle([]);
  } else if (exact) {
    eachCombination(deck, toCome, (combo) => settle(combo));
  } else {
    const rand = seededRandom(seed);
    const pool = [...deck];
    for (let t = 0; t < trials; t++) {
      // Partial Fisher-Yates: shuffle only the cards actually needed, then put
      // the pool back exactly as it was so every trial draws from the same set.
      for (let i = 0; i < toCome; i++) {
        const j = i + Math.floor(rand() * (pool.length - i));
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      settle(pool.slice(0, toCome));
    }
  }

  return {
    boards,
    exact,
    hands: players.map((_, i) => ({
      equity: share[i] / boards,
      win: wins[i] / boards,
      tie: ties[i] / boards,
    })),
  };
}

/**
 * Equity for one hand against `opponents` unknown hands.
 *
 * Always sampled: the opponents' cards are part of what's being dealt, so
 * there is nothing small enough to enumerate even on the river.
 *
 * @param {Card[]} hole
 * @param {Card[]} [community]
 * @param {{opponents?:number, trials?:number, seed?:number}} [opts]
 * @returns {EquityResult & {boards:number, exact:boolean}}
 */
export function equityVsRandom(hole, community = [], opts = {}) {
  const { opponents = 1, trials = DEFAULT_TRIALS, seed = 0x5eed } = opts;
  const board = community.filter(Boolean);

  // Seeded and pure means the same question provably has the same answer, so
  // asking it twice can be free. Worth caching because both callers ask
  // repeatedly for the same spot: a bot re-reads its equity as a hand is
  // re-rendered, and the Academy shows the same number in several places.
  const memoKey = `${handLabel(hole)}|${handLabel(board)}|${opponents}|${trials}|${seed}`;
  const hit = MEMO.get(memoKey);
  if (hit) return hit;
  const deck = remainingDeck([...board, ...hole]);
  const rand = seededRandom(seed);
  const pool = [...deck];
  const need = (5 - board.length) + opponents * 2;

  let win = 0;
  let tie = 0;
  let share = 0;

  for (let t = 0; t < trials; t++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rand() * (pool.length - i));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const drawn = pool.slice(0, need);
    const full = [...board, ...drawn.slice(0, 5 - board.length)];
    const mine = bestHandRank([...hole, ...full]);

    let beaten = false;
    let split = 1;
    for (let o = 0; o < opponents; o++) {
      const at = (5 - board.length) + o * 2;
      const theirs = bestHandRank([drawn[at], drawn[at + 1], ...full]);
      const cmp = compareHandRanks(mine, theirs);
      if (cmp < 0) { beaten = true; break; }
      if (cmp === 0) split++;
    }
    if (beaten) continue;
    if (split === 1) { win++; share += 1; } else { tie++; share += 1 / split; }
  }

  const result = { equity: share / trials, win: win / trials, tie: tie / trials, boards: trials, exact: false };
  remember(memoKey, result);
  return result;
}

/**
 * A small bounded cache for `equityVsRandom`.
 *
 * Bounded because an Academy session asks about a great many spots over an
 * evening and none of them are worth holding onto forever; oldest-out is
 * plenty, since the repeats that matter are always clustered in time.
 */
const MEMO = new Map();
const MEMO_LIMIT = 400;

function remember(key, value) {
  if (MEMO.size >= MEMO_LIMIT) MEMO.delete(MEMO.keys().next().value);
  MEMO.set(key, value);
}

/** Drop everything cached. Tests use it to measure honestly; nothing else needs it. */
export function clearEquityCache() {
  MEMO.clear();
}

/* =================================================================== outs */

/**
 * @typedef {Object} Improvement
 * @property {Card} card      The card that would come.
 * @property {number} from    Hand category before it.
 * @property {number} to      Hand category after it.
 * @property {string} makes   What it makes, e.g. "Flush".
 */

/**
 * Every unseen card that would improve this hand, and what each one makes.
 *
 * "Improve" means a strictly better five-card hand — which includes pairing a
 * kicker, not just completing a draw. `classifyDraws` below is the narrower,
 * more familiar reading, and is what a player usually means by "my outs".
 *
 * @param {Card[]} hole
 * @param {Card[]} community
 * @returns {Improvement[]}
 */
export function improvingCards(hole, community) {
  const board = (community || []).filter(Boolean);
  const current = bestHandRank([...hole, ...board]);
  const out = [];
  for (const card of remainingDeck([...hole, ...board])) {
    const next = bestHandRank([...hole, ...board, card]);
    if (compareHandRanks(next, current) > 0) {
      out.push({ card, from: current.category, to: next.category, makes: describeCategory(next.category) });
    }
  }
  return out;
}

/** "Flush", "Two Pair" … from a category index. */
function describeCategory(category) {
  return [
    "High Card", "Pair", "Two Pair", "Three of a Kind", "Straight",
    "Flush", "Full House", "Four of a Kind", "Straight Flush",
  ][category] || "Better hand";
}

/**
 * @typedef {Object} Draw
 * @property {string} type   "flush"|"openEnded"|"gutshot"|"doubleGutshot"|"overcards"|"trips"|"twoPair"|"pair"|"backdoorFlush"
 * @property {string} label  How a person would say it.
 * @property {number} outs   Cards that complete it.
 * @property {Card[]} cards  Which cards those are.
 */

/**
 * The draws a hand is actually on, named the way a player would name them.
 *
 * This is not the same question as `improvingCards`: with a flush draw and two
 * overcards, pairing an ace technically improves the hand, but nobody calls a
 * flush draw "fifteen outs" without saying so out loud. So draws are reported
 * separately, each with its own count, and it's left to the lesson to decide
 * which of them to add together.
 *
 * @param {Card[]} hole
 * @param {Card[]} community
 * @returns {{draws: Draw[], made: string, category: number}}
 */
export function classifyDraws(hole, community) {
  const board = (community || []).filter(Boolean);
  const known = [...hole, ...board];
  const current = bestHandRank(known);
  const deck = remainingDeck(known);
  /** @type {Draw[]} */
  const draws = [];

  // What each unseen card would turn this into, bucketed by resulting hand.
  const makes = new Map();
  for (const card of deck) {
    const next = bestHandRank([...known, card]);
    if (compareHandRanks(next, current) <= 0) continue;
    if (!makes.has(next.category)) makes.set(next.category, []);
    makes.get(next.category).push(card);
  }

  const bucket = (category) => makes.get(category) || [];

  const flush = bucket(5).concat(bucket(8));
  if (flush.length && current.category < 5) {
    draws.push({ type: "flush", label: "Flush draw", outs: flush.length, cards: flush });
  }

  const straight = bucket(4);
  if (straight.length && current.category < 4) {
    // Open-ended and double-gutshot both come to eight outs; what separates
    // them is how many *ranks* fill the hand, not how many cards.
    const ranks = new Set(straight.map((c) => c.rank));
    const type = ranks.size >= 2 ? (isConsecutiveEnds(ranks) ? "openEnded" : "doubleGutshot") : "gutshot";
    const label = { openEnded: "Open-ended straight draw", doubleGutshot: "Double gutshot", gutshot: "Gutshot" }[type];
    draws.push({ type, label, outs: straight.length, cards: straight });
  }

  for (const [category, type, label] of [[7, "quads", "Draw to quads"], [6, "fullHouse", "Full-house draw"], [3, "trips", "Draw to trips"], [2, "twoPair", "Two-pair draw"]]) {
    const cards = bucket(category);
    if (cards.length && current.category < category) draws.push({ type, label, outs: cards.length, cards });
  }

  // Overcards only count as a draw while the hand has nothing — with a pair
  // already made, "an ace might come" is not what anyone means by outs.
  if (current.category === 0) {
    const boardHigh = Math.max(0, ...board.map((c) => c.rank));
    const over = hole.filter((c) => c.rank > boardHigh);
    if (over.length && board.length) {
      const cards = bucket(1).filter((c) => over.some((h) => h.rank === c.rank));
      if (cards.length) {
        draws.push({
          type: "overcards",
          label: over.length > 1 ? "Two overcards" : "Overcard",
          outs: cards.length,
          cards,
        });
      }
    }
  }

  // Three to a flush on the flop only: it needs both remaining cards, so it's
  // worth a mention and never worth counting as an out.
  if (board.length === 3 && !flush.length) {
    const bySuit = new Map();
    for (const c of known) bySuit.set(c.suit, (bySuit.get(c.suit) || 0) + 1);
    const suit = [...bySuit.entries()].find(([, n]) => n === 3);
    if (suit) draws.push({ type: "backdoorFlush", label: "Backdoor flush draw", outs: 0, cards: [] });
  }

  return { draws, made: describeCategory(current.category), category: current.category };
}

/** Do these completing ranks sit at both ends of a run (open-ended) or not? */
function isConsecutiveEnds(ranks) {
  const sorted = [...ranks].sort((a, b) => a - b);
  // Open-ended: the two filling ranks are four apart, one below the run and
  // one above it (5-6-7-8 is filled by a 4 and a 9).
  return sorted.length === 2 && sorted[1] - sorted[0] === 5;
}

/* ============================================================== pot odds */

/**
 * The price the pot is laying, and the equity needed to make a call break even.
 *
 * @param {number} toCall  What it costs to continue.
 * @param {number} pot     What's already out there, before the call.
 * @returns {{toCall:number, pot:number, breakEven:number, ratio:number, ratioLabel:string}}
 */
export function potOdds(toCall, pot) {
  const call = Math.max(0, Number(toCall) || 0);
  const before = Math.max(0, Number(pot) || 0);
  if (call === 0) return { toCall: 0, pot: before, breakEven: 0, ratio: Infinity, ratioLabel: "free" };
  const breakEven = call / (before + call);
  const ratio = before / call;
  return {
    toCall: call,
    pot: before,
    breakEven,
    ratio,
    // "3.5 : 1" is how a price gets said out loud; the percentage is what it
    // has to be compared against, so both are returned rather than one.
    ratioLabel: `${ratio.toFixed(ratio >= 10 ? 0 : 1)} : 1`,
  };
}

/**
 * The exact chance of hitting at least one out, and the shortcut people
 * actually use at the table, so a lesson can show one against the other.
 *
 * @param {number} outs
 * @param {number} cardsToCome  1 (turn to river) or 2 (flop to river).
 * @param {number} [unseen]  Cards you can't see. 47 on the flop, 46 on the turn.
 * @returns {{exact:number, ruleOfThumb:number, error:number}}
 */
export function outsToEquity(outs, cardsToCome, unseen = cardsToCome === 2 ? 47 : 46) {
  const n = Math.max(0, Math.min(unseen, Math.round(outs)));
  // P(at least one) is easier as 1 − P(none), which is just the misses
  // divided by the whole deck, once per card to come.
  let miss = 1;
  for (let i = 0; i < cardsToCome; i++) miss *= (unseen - n - i) / (unseen - i);
  const exact = 1 - miss;
  // The "rule of 2 and 4": double your outs per card to come.
  const ruleOfThumb = Math.min(1, (n * 2 * cardsToCome) / 100);
  return { exact, ruleOfThumb, error: ruleOfThumb - exact };
}

/**
 * Should this call be made on the numbers alone?
 * @param {number} equityFraction  0–1, from `equity` / `outsToEquity`.
 * @param {number} toCall
 * @param {number} pot
 */
export function callIsProfitable(equityFraction, toCall, pot) {
  const { breakEven } = potOdds(toCall, pot);
  return {
    breakEven,
    equity: equityFraction,
    profitable: equityFraction > breakEven,
    // What the call is worth per chip, which is the number that actually
    // matters and the one people skip straight past.
    ev: equityFraction * (pot + toCall) - toCall,
  };
}

/* ================================================================ labels */

/** "A♠ K♦" — for anything that has to show a hand back to a person. */
export function handLabel(cards) {
  return (cards || []).filter(Boolean).map(cardCode).join(" ");
}

/**
 * The shorthand a starting hand is discussed in: "AKs", "QQ", "T9o".
 * @param {Card[]} hole
 */
export function startingHandCode(hole) {
  if (!hole || hole.length < 2) return "";
  const [a, b] = [...hole].sort((x, y) => y.rank - x.rank);
  const pair = `${rankLabel(a.rank)}${rankLabel(b.rank)}`;
  if (a.rank === b.rank) return pair;
  return `${pair}${a.suit === b.suit ? "s" : "o"}`;
}
