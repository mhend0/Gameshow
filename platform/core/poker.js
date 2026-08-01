// Texas Hold'em — domain core.
//
// Everything game-specific about poker lives here: cards, the deck, hand
// evaluation, blinds, the betting-round state machine, side pots and
// showdown. Deliberately UI-free and server-authoritative — the buzzer
// channel (`buzzer/api/poker.js`, a later phase) is the only thing allowed
// to call `applyAction`, so a phone can never do more than ask; this file
// decides what's legal and what happens next.
//
// A `PokerGame` is one flat, JSON-serialisable object (see the typedef
// below) so it can be pushed whole through the same Redis-channel pattern
// Family Feud and the Wheel already use — no client ever reconstructs game
// state from partial deltas.

import { newId } from "./ids.js";

/* ===================================================================== rng */

// Fisher-Yates with crypto-backed randomness where available, so the shuffle
// isn't predictable from Math.random()'s seed the way a casino's would need
// to not be. Falls back to Math.random() in environments without crypto
// (matches the fallback pattern in ids.js).
function randomInt(n) {
  if (globalThis.crypto && typeof crypto.getRandomValues === "function") {
    // Rejection sampling avoids modulo bias.
    const max = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= max);
    return x % n;
  }
  return Math.floor(Math.random() * n);
}

/* =================================================================== cards */

/**
 * @typedef {Object} Card
 * @property {number} rank  2–14 (11=J, 12=Q, 13=K, 14=A).
 * @property {string} suit  "s"|"h"|"d"|"c".
 */

export const SUITS = ["s", "h", "d", "c"];
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_LABEL = { 10: "T", 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUIT_GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" };

export const rankLabel = (rank) => RANK_LABEL[rank] || String(rank);
export const suitGlyph = (suit) => SUIT_GLYPH[suit] || suit;

/** Short display code, e.g. "As", "Td" — matches conventional poker notation. */
export function cardCode(card) {
  return `${rankLabel(card.rank)}${card.suit}`;
}

/** A fresh, unshuffled 52-card deck. */
export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** In-place Fisher-Yates shuffle. Returns the same array for chaining. */
export function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ======================================================== hand evaluation */

/**
 * @typedef {Object} HandRank
 * @property {number} category   0=High Card … 8=Straight Flush (higher wins).
 * @property {number[]} tiebreak Ranks that break a tie within the category,
 *                                most significant first, always length 5.
 * @property {Card[]} cards      The best 5 cards making up this hand.
 */

export const HAND_CATEGORIES = [
  "High Card", "Pair", "Two Pair", "Three of a Kind", "Straight",
  "Flush", "Full House", "Four of a Kind", "Straight Flush",
];

/** All k-combinations of `arr`, as arrays. Fine at n≤7 (used for 7-choose-5 = 21). */
function combinations(arr, k) {
  const out = [];
  const combo = [];
  (function go(start) {
    if (combo.length === k) { out.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      go(i + 1);
      combo.pop();
    }
  })(0);
  return out;
}

/**
 * Evaluate exactly 5 cards.
 * @param {Card[]} cards
 * @returns {HandRank}
 */
export function evaluate5(cards) {
  const bySuit = new Map();
  const byRank = new Map();
  for (const c of cards) {
    bySuit.set(c.suit, (bySuit.get(c.suit) || 0) + 1);
    byRank.set(c.rank, (byRank.get(c.rank) || 0) + 1);
  }
  const isFlush = [...bySuit.values()].some((n) => n === 5);

  const uniqueRanksDesc = [...byRank.keys()].sort((a, b) => b - a);
  // Ace also plays low for the wheel (A-2-3-4-5) — append a virtual rank-1 ace
  // so the consecutive-run scan below can find that straight like any other.
  const straightScan = uniqueRanksDesc.includes(14)
    ? [...uniqueRanksDesc, 1]
    : uniqueRanksDesc;
  let straightHigh = 0;
  for (let i = 0; i + 4 < straightScan.length; i++) {
    if (straightScan[i] - straightScan[i + 4] === 4) { straightHigh = straightScan[i]; break; }
  }
  const isStraight = straightHigh > 0;

  if (isFlush && isStraight) {
    // Straight flush only counts if the 5 consecutive ranks are *also* all
    // the same suit — recompute the run restricted to the flush suit.
    const flushSuit = [...bySuit.entries()].find(([, n]) => n === 5)[0];
    const flushRanks = cards.filter((c) => c.suit === flushSuit).map((c) => c.rank);
    const scan = flushRanks.includes(14) ? [...new Set([...flushRanks, 1])] : [...new Set(flushRanks)];
    scan.sort((a, b) => b - a);
    let sfHigh = 0;
    for (let i = 0; i + 4 < scan.length; i++) {
      if (scan[i] - scan[i + 4] === 4) { sfHigh = scan[i]; break; }
    }
    if (sfHigh > 0) {
      return { category: 8, tiebreak: [sfHigh, 0, 0, 0, 0], cards };
    }
  }

  // Groups sorted by (count desc, rank desc) — e.g. a full house's trips
  // rank sorts before its pair rank regardless of which is numerically higher.
  const groups = [...byRank.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (groups[0].count === 4) {
    const kicker = groups.find((g) => g.count === 1).rank;
    return { category: 7, tiebreak: [groups[0].rank, kicker, 0, 0, 0], cards };
  }
  if (groups[0].count === 3 && groups[1] && groups[1].count >= 2) {
    return { category: 6, tiebreak: [groups[0].rank, groups[1].rank, 0, 0, 0], cards };
  }
  if (isFlush) {
    const ranks = [...cards].map((c) => c.rank).sort((a, b) => b - a);
    return { category: 5, tiebreak: ranks, cards };
  }
  if (isStraight) {
    return { category: 4, tiebreak: [straightHigh, 0, 0, 0, 0], cards };
  }
  if (groups[0].count === 3) {
    const kickers = groups.filter((g) => g.count === 1).map((g) => g.rank).sort((a, b) => b - a);
    return { category: 3, tiebreak: [groups[0].rank, ...kickers, 0].slice(0, 5), cards };
  }
  if (groups[0].count === 2 && groups[1] && groups[1].count === 2) {
    const [hi, lo] = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
    const kicker = groups.find((g) => g.count === 1).rank;
    return { category: 2, tiebreak: [hi, lo, kicker, 0, 0], cards };
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter((g) => g.count === 1).map((g) => g.rank).sort((a, b) => b - a);
    return { category: 1, tiebreak: [groups[0].rank, ...kickers].slice(0, 5), cards };
  }
  const ranks = [...cards].map((c) => c.rank).sort((a, b) => b - a);
  return { category: 0, tiebreak: ranks, cards };
}

/** -1 / 0 / 1, like a standard comparator — higher hand sorts last (wins). */
export function compareHandRanks(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < 5; i++) {
    const d = (a.tiebreak[i] || 0) - (b.tiebreak[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Best 5-card hand out of 5–7 cards (hole cards + community).
 * @param {Card[]} cards
 * @returns {HandRank}
 */
export function bestHandRank(cards) {
  if (cards.length <= 5) return evaluate5(cards);
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const rank = evaluate5(combo);
    if (!best || compareHandRanks(rank, best) > 0) best = rank;
  }
  return best;
}

// "As"/"Js" read as stray words, not plurals — spell ranks out in hand names.
const RANK_PLURAL = {
  2: "Twos", 3: "Threes", 4: "Fours", 5: "Fives", 6: "Sixes", 7: "Sevens",
  8: "Eights", 9: "Nines", 10: "Tens", 11: "Jacks", 12: "Queens", 13: "Kings", 14: "Aces",
};

/** Human-readable hand name, e.g. "Full House, Kings over Fours". */
export function describeHandRank(rank) {
  const L = rankLabel;
  const plural = (r) => RANK_PLURAL[r] || `${L(r)}s`;
  switch (rank.category) {
    case 8: return rank.tiebreak[0] === 14 ? "Royal Flush" : `Straight Flush, ${L(rank.tiebreak[0])} High`;
    case 7: return `Four of a Kind, ${plural(rank.tiebreak[0])}`;
    case 6: return `Full House, ${plural(rank.tiebreak[0])} over ${plural(rank.tiebreak[1])}`;
    case 5: return `Flush, ${L(rank.tiebreak[0])} High`;
    case 4: return `Straight, ${L(rank.tiebreak[0])} High`;
    case 3: return `Three of a Kind, ${plural(rank.tiebreak[0])}`;
    case 2: return `Two Pair, ${plural(rank.tiebreak[0])} and ${plural(rank.tiebreak[1])}`;
    case 1: return `Pair of ${plural(rank.tiebreak[0])}`;
    default: return `High Card, ${L(rank.tiebreak[0])}`;
  }
}

/* =================================================================== rules */

export const POKER_RULES = {
  maxSeats: 9,
  minPlayers: 2,
  startingStack: 5000,
  smallBlind: 25,
  bigBlind: 50,
  actionTimeoutSeconds: 30,
};

/**
 * @typedef {Object} BlindLevel
 * @property {number} smallBlind
 * @property {number} bigBlind
 * @property {number} ante
 * @property {number} durationMinutes  0 = doesn't auto-advance.
 */
/** @type {BlindLevel[]} */
export const DEFAULT_BLIND_LEVELS = [
  { smallBlind: 25, bigBlind: 50, ante: 0, durationMinutes: 0 },
  { smallBlind: 50, bigBlind: 100, ante: 0, durationMinutes: 0 },
  { smallBlind: 100, bigBlind: 200, ante: 25, durationMinutes: 0 },
  { smallBlind: 200, bigBlind: 400, ante: 50, durationMinutes: 0 },
];

/* ============================================================ table/seats */

/**
 * @typedef {"empty"|"sitout"|"active"|"folded"|"allin"} SeatStatus
 *
 * @typedef {Object} PokerSeat
 * @property {number} index
 * @property {string|null} id     Player id (matches the buzzer playerId), null when empty.
 * @property {string} name
 * @property {number} stack       Chips not currently committed to the pot.
 * @property {Card[]} holeCards
 * @property {number} bet         Committed on the current street.
 * @property {number} totalBet    Committed across the whole hand (drives side pots).
 * @property {SeatStatus} status
 * @property {boolean} actedThisRound
 */

/** @returns {PokerSeat} */
function makeEmptySeat(index) {
  return {
    index, id: null, name: "", stack: 0,
    holeCards: [], bet: 0, totalBet: 0,
    status: "empty", actedThisRound: false,
  };
}

/**
 * @typedef {Object} PotLayer
 * @property {number} amount
 * @property {string[]} eligible  Seat ids that can win this layer.
 *
 * @typedef {Object} ShowdownResult
 * @property {number} potIndex
 * @property {number} amount
 * @property {{seatId:string, rank:HandRank, handName:string, share:number}[]} winners
 *
 * @typedef {Object} PokerGame
 * @property {string} id
 * @property {PokerSeat[]} seats           Fixed-size, left-to-right table order.
 * @property {number} dealerIndex
 * @property {number} handNumber
 * @property {number} smallBlind
 * @property {number} bigBlind
 * @property {Card[]} deck                 Undealt cards.
 * @property {Card[]} burned
 * @property {Card[]} community
 * @property {"waiting"|"preflop"|"flop"|"turn"|"river"|"complete"} street
 * @property {number} currentBet           Amount to call on this street.
 * @property {number} minRaise             Minimum legal raise increment.
 * @property {number} actingIndex          Seat index to act, -1 when nobody can.
 * @property {number} lastAggressorIndex
 * @property {PotLayer[]} pots             Computed once the hand reaches showdown.
 * @property {ShowdownResult[]} results    Cleared at the start of each hand.
 */

/** @returns {PokerGame} */
export function makeTable({ seats = POKER_RULES.maxSeats, smallBlind = POKER_RULES.smallBlind, bigBlind = POKER_RULES.bigBlind } = {}) {
  return {
    id: newId("poker"),
    seats: Array.from({ length: seats }, (_, i) => makeEmptySeat(i)),
    dealerIndex: -1,
    handNumber: 0,
    smallBlind,
    bigBlind,
    deck: [],
    burned: [],
    community: [],
    street: "waiting",
    currentBet: 0,
    minRaise: bigBlind,
    actingIndex: -1,
    lastAggressorIndex: -1,
    pots: [],
    results: [],

    /* ---- host controls (phase 9) ---- */
    /** Play is frozen; the server refuses player actions until resumed. */
    paused: false,
    /** Seconds a player gets to act. 0 = no clock. */
    timerSeconds: 0,
    /** When the seat on the clock got it (epoch ms), 0 when nobody is acting. */
    actingSince: 0,
    /** Deal the next hand on its own once the last one is settled. */
    autoDeal: false,
    /** Which rung of the blind ladder we're on (see DEFAULT_BLIND_LEVELS). */
    blindLevel: 0,
  };
}

/**
 * Move the action, and start that player's clock with it.
 *
 * Every change of `actingIndex` goes through here. Keeping the two together
 * is what stops a timer running against the wrong person: if the pointer
 * could move without resetting the clock, the next player would inherit
 * whatever was left of the last one's.
 */
function setActing(game, index) {
  game.actingIndex = index;
  game.actingSince = index >= 0 ? Date.now() : 0;
}

/** Freeze or resume play. A paused table refuses every player action. */
export function setPaused(game, paused) {
  game.paused = !!paused;
  // Nobody should lose their hand to a clock that ran while play was frozen.
  if (!game.paused && game.actingIndex >= 0) game.actingSince = Date.now();
  return game;
}

/** Seconds each player gets to act; 0 turns the clock off. */
export function setActionTimer(game, seconds) {
  game.timerSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  if (game.timerSeconds && game.actingIndex >= 0) game.actingSince = Date.now();
  return game;
}

/** Whether the seat on the clock has run out of time. */
export function actionExpired(game, at = Date.now()) {
  if (!game.timerSeconds || game.paused || game.actingIndex < 0 || !game.actingSince) return false;
  return at - game.actingSince >= game.timerSeconds * 1000;
}

/**
 * Fold whoever is on the clock, but only if the clock really has run out.
 *
 * A client asks for this — it's the one with a countdown on screen — so the
 * server re-checks the elapsed time itself rather than taking their word for
 * it. Returns whether anything happened.
 */
export function foldExpired(game, at = Date.now()) {
  if (!actionExpired(game, at)) return false;
  const seat = game.seats[game.actingIndex];
  if (!seat || !seat.id) return false;
  // Checking is free, so never fold a hand that could have stayed in for nothing.
  const legal = legalActions(game);
  applyAction(game, seat.id, { type: legal && legal.canCheck ? "check" : "fold" });
  return true;
}

/** Deal the next hand automatically once the current one is settled. */
export function setAutoDeal(game, on) {
  game.autoDeal = !!on;
  return game;
}

/**
 * Change the stakes. Only between hands — moving the blinds mid-hand would
 * change what players had already committed to.
 */
export function setBlinds(game, smallBlind, bigBlind) {
  if (game.street !== "waiting" && game.street !== "complete") {
    throw new Error("Finish the hand before changing the blinds.");
  }
  const sb = Math.max(1, Math.round(Number(smallBlind) || 0));
  const bb = Math.max(sb, Math.round(Number(bigBlind) || 0));
  game.smallBlind = sb;
  game.bigBlind = bb;
  game.minRaise = bb;
  return game;
}

/** Step onto a rung of the standard blind ladder. */
export function setBlindLevel(game, level) {
  const i = Math.max(0, Math.min(DEFAULT_BLIND_LEVELS.length - 1, Math.round(Number(level) || 0)));
  const rung = DEFAULT_BLIND_LEVELS[i];
  setBlinds(game, rung.smallBlind, rung.bigBlind);
  game.blindLevel = i;
  return game;
}

/**
 * Abandon the hand in progress and give everyone their chips back.
 *
 * This is the "something went wrong in the room" button — a misdeal, a player
 * who walked off, a phone that died mid-hand. Refunding is the only outcome
 * that can't be unfair to somebody, so the pot is returned rather than
 * awarded, and no winner is recorded.
 */
export function endHand(game) {
  if (game.street === "waiting" || game.street === "complete") return game;
  for (const seat of game.seats) {
    if (seat.status === "empty") continue;
    seat.stack += seat.totalBet;
    seat.bet = 0;
    seat.totalBet = 0;
    seat.holeCards = [];
    if (seat.status !== "sitout") seat.status = seat.stack > 0 ? "active" : "sitout";
  }
  game.community = [];
  game.pots = [];
  game.results = [];
  game.currentBet = 0;
  game.street = "complete";
  game.handVoided = true;      // the TV shows "hand cancelled" rather than a winner
  setActing(game, -1);
  return game;
}

/** Seat a player in the first empty seat. Returns the seat index, or -1 if the table is full. */
export function seatPlayer(game, { id, name, stack = POKER_RULES.startingStack }) {
  if (game.seats.some((s) => s.id === id)) return game.seats.find((s) => s.id === id).index;
  const seat = game.seats.find((s) => s.status === "empty");
  if (!seat) return -1;
  seat.id = id;
  seat.name = name;
  seat.stack = stack;
  seat.status = "sitout"; // joins the next hand, not one already in progress
  return seat.index;
}

/** Remove a player between hands (kick / leave). No-op mid-hand from the current street's action. */
export function removePlayer(game, seatId) {
  const seat = game.seats.find((s) => s.id === seatId);
  if (!seat) return;
  Object.assign(seat, makeEmptySeat(seat.index));
}

/**
 * Rearrange the table so the seats run in the order people are actually
 * sitting in the room, clockwise.
 *
 * This deliberately moves the *players*, not just how they're drawn. The seat
 * ring is what the dealer button walks around, so if the order on screen isn't
 * the order in the room, the button appears to jump between strangers and the
 * person to your left isn't the person who acts after you. Reordering the
 * seats themselves keeps the game and the room in step.
 *
 * Only legal between hands — rearranging the ring mid-hand would move players
 * out from under the action pointer and the blinds.
 *
 * @param {PokerGame} game
 * @param {string[]} orderedIds  Player ids, clockwise. Anyone left out keeps
 *        their existing relative order behind those who are named, so a
 *        partial list is safe.
 * @returns {PokerGame}
 */
export function arrangeSeats(game, orderedIds) {
  if (game.street !== "waiting" && game.street !== "complete") {
    throw new Error("Finish the hand before rearranging the table.");
  }
  const occupied = game.seats.filter((s) => s.status !== "empty");
  const byId = new Map(occupied.map((s) => [s.id, s]));

  const ordered = [];
  for (const id of orderedIds || []) {
    const seat = byId.get(String(id));
    if (seat && !ordered.includes(seat)) ordered.push(seat);
  }
  for (const seat of occupied) if (!ordered.includes(seat)) ordered.push(seat);

  // The button belongs to a person, not to a slot — remember who has it so it
  // can follow them to wherever they end up sitting.
  const dealerSeat = game.seats[game.dealerIndex];
  const dealerId = dealerSeat ? dealerSeat.id : null;

  const moving = ordered.map((s) => ({ id: s.id, name: s.name, stack: s.stack, status: s.status }));
  game.seats = game.seats.map((_, i) => makeEmptySeat(i));
  moving.forEach((who, i) => Object.assign(game.seats[i], who, { index: i }));

  game.dealerIndex = dealerId ? game.seats.findIndex((s) => s.id === dealerId) : -1;
  return game;
}

/** Host rebuy / correction. */
export function adjustStack(game, seatId, delta) {
  const seat = game.seats.find((s) => s.id === seatId);
  if (!seat) return;
  seat.stack = Math.max(0, seat.stack + Math.round(delta));
}

/* ============================================================ ring helpers */

/** Seats currently occupying the table (playing or waiting for the next hand). */
function occupiedSeats(game) {
  return game.seats.filter((s) => s.status !== "empty");
}

/** Next seat clockwise from `from` whose status matches `pred`, or -1. */
function nextSeatIndex(game, from, pred) {
  const n = game.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (pred(game.seats[idx])) return idx;
  }
  return -1;
}

const isOccupied = (s) => s.status !== "empty";
const isActing = (s) => s.status === "active";
const isInHand = (s) => s.status === "active" || s.status === "allin";

/* ============================================================= hand start */

function postBet(game, seatIndex, amount) {
  const seat = game.seats[seatIndex];
  const chips = Math.min(amount, seat.stack);
  seat.stack -= chips;
  seat.bet += chips;
  seat.totalBet += chips;
  if (seat.stack === 0) seat.status = "allin";
}

/**
 * Deal a new hand: move the button, post blinds, shuffle and deal hole cards,
 * and set the first seat to act. Requires at least `POKER_RULES.minPlayers`
 * occupied seats with chips.
 *
 * @param {PokerGame} game
 * @param {{deck?: Card[]}} [opts]  `deck` lets tests supply a fixed, unshuffled
 *   order instead of the real shuffle — never used outside tests.
 * @returns {PokerGame}
 */
export function startHand(game, { deck } = {}) {
  const eligible = occupiedSeats(game).filter((s) => s.stack > 0);
  if (eligible.length < POKER_RULES.minPlayers) {
    throw new Error(`Need at least ${POKER_RULES.minPlayers} players with chips to start a hand.`);
  }

  for (const seat of game.seats) {
    seat.holeCards = [];
    seat.bet = 0;
    seat.totalBet = 0;
    seat.actedThisRound = false;
    if (seat.status !== "empty") seat.status = seat.stack > 0 ? "active" : "sitout";
  }

  game.dealerIndex = game.handNumber === 0
    ? occupiedSeats(game)[0].index
    : nextSeatIndex(game, game.dealerIndex, isOccupied);

  const activeCount = game.seats.filter((s) => s.status === "active").length;
  const sbIndex = activeCount === 2
    ? game.dealerIndex // heads-up: the button posts the small blind
    : nextSeatIndex(game, game.dealerIndex, isActing);
  const bbIndex = nextSeatIndex(game, sbIndex, isActing);

  game.deck = deck ? [...deck] : shuffleDeck(makeDeck());
  game.burned = [];
  game.community = [];
  game.results = [];
  game.pots = [];
  game.handVoided = false;

  // Round-robin, one card at a time, starting left of the button — how a real
  // dealer works, and it matters here because a short deck (heads-up-plus
  // side games) could otherwise run out mid-round with the naive "two cards
  // per player" order.
  let cursor = sbIndex;
  for (let round = 0; round < 2; round++) {
    let idx = cursor;
    for (let i = 0; i < activeCount; i++) {
      game.seats[idx].holeCards.push(game.deck.shift());
      idx = nextSeatIndex(game, idx, isActing);
    }
  }

  postBet(game, sbIndex, game.smallBlind);
  postBet(game, bbIndex, game.bigBlind);

  game.currentBet = game.bigBlind;
  game.minRaise = game.bigBlind;
  game.lastAggressorIndex = bbIndex;
  game.street = "preflop";
  setActing(game, nextSeatIndex(game, bbIndex, isActing));
  game.handNumber += 1;
  return game;
}

/* ================================================================ actions */

/**
 * @typedef {Object} LegalActions
 * @property {boolean} canFold
 * @property {boolean} canCheck
 * @property {boolean} canCall
 * @property {number} callAmount
 * @property {boolean} canBet
 * @property {boolean} canRaise
 * @property {number} minTo    Minimum total bet/raise-to amount.
 * @property {number} maxTo    Maximum (all-in) total bet/raise-to amount.
 */

/** What the seat currently on the clock may legally do. @returns {LegalActions|null} */
export function legalActions(game) {
  if (game.actingIndex < 0) return null;
  const seat = game.seats[game.actingIndex];
  const toCall = game.currentBet - seat.bet;
  const maxTo = seat.bet + seat.stack;
  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, seat.stack),
    canBet: game.currentBet === 0 && seat.stack > 0,
    canRaise: game.currentBet > 0 && maxTo > game.currentBet,
    minTo: game.currentBet === 0 ? game.bigBlind : Math.min(game.currentBet + game.minRaise, maxTo),
    maxTo,
  };
}

/**
 * @typedef {Object} PokerAction
 * @property {"fold"|"check"|"call"|"bet"|"raise"} type
 * @property {number} [to]  Total bet-to amount for "bet"/"raise".
 */

/**
 * Apply one player's action, then run the state machine forward as far as it
 * goes on its own (closing the betting round, dealing the next street,
 * running an uncontested or showdown pot). Throws on any illegal action —
 * the caller (the buzzer channel) is expected to reject before it ever
 * reaches here, this is the last line of defence, not the UI.
 *
 * @param {PokerGame} game
 * @param {string} seatId
 * @param {PokerAction} action
 * @returns {PokerGame}
 */
export function applyAction(game, seatId, action) {
  if (game.paused) throw new Error("The host has paused the game.");
  if (game.actingIndex < 0) throw new Error("No action is open.");
  const seat = game.seats[game.actingIndex];
  if (seat.id !== seatId) throw new Error("It's not your turn.");
  const legal = legalActions(game);

  switch (action.type) {
    case "fold": {
      seat.status = "folded";
      break;
    }
    case "check": {
      if (!legal.canCheck) throw new Error("You can't check — there's a bet to you.");
      break;
    }
    case "call": {
      if (!legal.canCall) throw new Error("There's nothing to call.");
      postBet(game, seat.index, legal.callAmount);
      break;
    }
    case "bet": {
      if (!legal.canBet) throw new Error("You can't open betting here.");
      const to = Math.max(legal.minTo, Math.min(Number(action.to) || 0, legal.maxTo));
      postBet(game, seat.index, to - seat.bet);
      game.currentBet = seat.bet;
      game.minRaise = seat.bet;
      game.lastAggressorIndex = seat.index;
      resetActedFlags(game, seat.index);
      break;
    }
    case "raise": {
      if (!legal.canRaise) throw new Error("You can't raise here.");
      const to = Math.max(legal.minTo, Math.min(Number(action.to) || 0, legal.maxTo));
      const raiseIncrement = to - game.currentBet;
      postBet(game, seat.index, to - seat.bet);
      game.currentBet = seat.bet;
      // An all-in raise smaller than a full raise doesn't reopen the action
      // to players who already acted — it's still tracked, just not as the
      // new minimum, per standard no-limit rules.
      if (raiseIncrement >= game.minRaise) game.minRaise = raiseIncrement;
      game.lastAggressorIndex = seat.index;
      resetActedFlags(game, seat.index);
      break;
    }
    default:
      throw new Error(`Unknown action "${action.type}".`);
  }

  seat.actedThisRound = true;
  advance(game);
  return game;
}

/**
 * Fold a seat that isn't necessarily on the clock — a player leaving the
 * table mid-hand. `applyAction`'s fold assumes it's closing out the seat
 * that was just waited on, so blindly reassigning `actingIndex` from here
 * would skip whoever the game was actually waiting on; the only thing an
 * out-of-turn fold can change is whether just one player is left standing.
 * @param {PokerGame} game
 * @param {string} seatId
 * @returns {PokerGame}
 */
export function foldOut(game, seatId) {
  const seat = game.seats.find((s) => s.id === seatId);
  if (!seat || seat.status !== "active") return game;
  if (game.actingIndex === seat.index) return applyAction(game, seatId, { type: "fold" });

  seat.status = "folded";
  const remaining = playersInHand(game).filter((s) => s.status !== "folded");
  if (remaining.length <= 1) awardUncontested(game);
  return game;
}

/** Clear actedThisRound on everyone except the aggressor, since a bet/raise reopens the action. */
function resetActedFlags(game, exceptIndex) {
  for (const s of game.seats) if (s.index !== exceptIndex) s.actedThisRound = false;
}

function playersInHand(game) {
  return game.seats.filter((s) => s.status === "folded" || isInHand(s));
}

function isRoundComplete(game) {
  const contenders = playersInHand(game).filter((s) => s.status !== "folded");
  if (contenders.length <= 1) return true;
  const stillToAct = contenders.filter(isActing);
  return stillToAct.every((s) => s.actedThisRound && s.bet === game.currentBet);
}

/** Move to the next seat to act, or close out the street/hand if the round is done. */
function advance(game) {
  const notFolded = playersInHand(game).filter((s) => s.status !== "folded");
  if (notFolded.length <= 1) { awardUncontested(game); return; }

  if (!isRoundComplete(game)) {
    setActing(game, nextSeatIndex(game, game.actingIndex, isActing));
    return;
  }
  closeStreet(game);
}

/** Pot goes to the last player standing — everyone else folded, no cards shown. */
function awardUncontested(game) {
  const winner = playersInHand(game).find((s) => s.status !== "folded");
  const amount = game.seats.reduce((t, s) => t + s.totalBet, 0);
  if (winner) winner.stack += amount;
  game.results = winner
    ? [{ potIndex: 0, amount, winners: [{ seatId: winner.id, rank: null, handName: "Uncontested", share: amount }] }]
    : [];
  game.street = "complete";
  setActing(game, -1);
}

const STREET_ORDER = ["preflop", "flop", "turn", "river"];

/** Reset street-scoped betting state and deal the next street, or run the showdown. */
function closeStreet(game) {
  for (const s of game.seats) { s.bet = 0; s.actedThisRound = false; }
  game.currentBet = 0;
  game.minRaise = game.bigBlind;
  game.lastAggressorIndex = -1;

  const canStillAct = game.seats.filter(isActing).length;
  const stepIndex = STREET_ORDER.indexOf(game.street);

  if (stepIndex === STREET_ORDER.length - 1) {
    runShowdown(game);
    return;
  }

  game.burned.push(game.deck.shift());
  if (game.street === "preflop") game.community.push(...game.deck.splice(0, 3));
  else game.community.push(game.deck.shift());
  game.street = STREET_ORDER[stepIndex + 1];

  // Nobody left who can still choose an action (everyone's all-in or folded):
  // deal straight through to showdown instead of dead-ending with no acting seat.
  if (canStillAct < 2) {
    if (STREET_ORDER.indexOf(game.street) === STREET_ORDER.length - 1) { runShowdown(game); return; }
    closeStreet(game);
    return;
  }

  setActing(game, nextSeatIndex(game, game.dealerIndex, isActing));
}

/* ================================================================== pots */

/**
 * Split the total contributed chips into pot layers by bet size, so a short
 * all-in stack only competes for what it (and matching callers) put in —
 * the standard side-pot construction.
 * @param {PokerSeat[]} seats
 * @returns {PotLayer[]}
 */
export function buildPots(seats) {
  const contributors = seats.filter((s) => s.totalBet > 0);
  const levels = [...new Set(contributors.map((s) => s.totalBet))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    const slice = level - prev;
    const payers = contributors.filter((s) => s.totalBet >= level);
    const amount = slice * payers.length;
    const eligible = payers.filter((s) => s.status !== "folded").map((s) => s.id);
    if (amount > 0 && eligible.length > 0) pots.push({ amount, eligible });
    prev = level;
  }
  return mergeAdjacentPots(pots);
}

/** Layers with an identical eligible set are the same pot from the players' point of view. */
function mergeAdjacentPots(pots) {
  const out = [];
  for (const pot of pots) {
    const last = out[out.length - 1];
    if (last && last.eligible.length === pot.eligible.length && last.eligible.every((id, i) => id === pot.eligible[i])) {
      last.amount += pot.amount;
    } else {
      out.push({ ...pot });
    }
  }
  return out;
}

/**
 * Split `amount` chips across `winnerSeats` as evenly as possible. Any
 * remainder (chips don't divide evenly) goes one at a time starting from the
 * seat closest to the left of the dealer — the standard odd-chip rule.
 */
function splitPot(amount, winnerSeats, dealerIndex, seatCount) {
  const order = [...winnerSeats].sort((a, b) =>
    ((a.index - dealerIndex + seatCount) % seatCount) - ((b.index - dealerIndex + seatCount) % seatCount));
  const base = Math.floor(amount / order.length);
  let remainder = amount - base * order.length;
  return order.map((s) => {
    const share = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    return { seat: s, share };
  });
}

function runShowdown(game) {
  const pots = buildPots(game.seats);
  const results = [];
  pots.forEach((pot, potIndex) => {
    const eligibleSeats = pot.eligible.map((id) => game.seats.find((s) => s.id === id));
    const ranked = eligibleSeats.map((seat) => ({
      seat, rank: bestHandRank([...seat.holeCards, ...game.community]),
    }));
    const bestRank = ranked.reduce((best, r) => (!best || compareHandRanks(r.rank, best) > 0 ? r.rank : best), null);
    const winners = ranked.filter((r) => compareHandRanks(r.rank, bestRank) === 0);
    const shares = splitPot(pot.amount, winners.map((w) => w.seat), game.dealerIndex, game.seats.length);
    for (const { seat, share } of shares) seat.stack += share;

    results.push({
      potIndex,
      amount: pot.amount,
      winners: shares.map(({ seat, share }) => {
        const rank = winners.find((w) => w.seat.id === seat.id).rank;
        return { seatId: seat.id, rank, handName: describeHandRank(rank), share };
      }),
    });
  });

  game.pots = pots;
  game.results = results;
  game.street = "complete";
  setActing(game, -1);
}
