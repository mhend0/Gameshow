// Wheel of Fortune — domain core.
//
// Everything game-specific about the wheel lives here: the puzzle model, the
// board *layout engine* (the host only ever types an answer and a category — the
// app works out how it sits on the board), the wheel's wedges, the rule
// constants, and the repositories that persist it all through the platform store.
//
// Deliberately UI-free so the library page, the editor preview and the live
// console all derive the same board from the same answer, and so the layout can
// be unit-reasoned about without a DOM.

import { Collection } from "./store.js";
import { newId } from "./ids.js";
import { SCHEMA_VERSION } from "./models.js";

const nowIso = () => new Date().toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ==================================================================== board */

/** The board is 4 rows of 14 columns. */
export const BOARD_ROWS = 4;
export const BOARD_COLS = 14;

/**
 * Usable span per row. The top and bottom rows lose their outer column on each
 * side (on the real set those corners are where the round/bonus displays sit),
 * so they hold 12 characters against the middle rows' 14.
 * @type {{start:number, cap:number}[]}
 */
export const ROW_SPANS = [
  { start: 1, cap: 12 },
  { start: 0, cap: 14 },
  { start: 0, cap: 14 },
  { start: 1, cap: 12 },
];

/**
 * Which rows a k-line puzzle may occupy, with a small aesthetic bias so ties
 * break towards the arrangement the show would use (vertically centred, and a
 * single line sitting on the second row rather than the third).
 */
const ROW_SETS = [
  { rows: [1], bias: 0 },
  { rows: [2], bias: 0.4 },
  { rows: [1, 2], bias: 0 },
  { rows: [0, 1], bias: 0.6 },
  { rows: [2, 3], bias: 0.6 },
  { rows: [0, 1, 2], bias: 0 },
  { rows: [1, 2, 3], bias: 0.3 },
  { rows: [0, 1, 2, 3], bias: 0 },
];

// Balance is scored between the lines themselves (squared deviation from their
// mean length) rather than against each row's capacity — the top and bottom rows
// are two characters narrower, so slack-against-capacity would quietly drag
// puzzles into them just because there was less room to leave empty.
// The per-line charge on top buys fewer, fuller lines: a phrase that reads
// naturally across three rows beats a perfectly balanced four.
const LINE_PENALTY = 14;

export const VOWELS = "AEIOU";
export const CONSONANTS = "BCDFGHJKLMNPQRSTVWXYZ";
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const isVowel = (ch) => VOWELS.includes(ch);
export const isLetter = (ch) => ALPHABET.includes(ch);

/**
 * Canonical form of an answer as it appears on the board: upper case, single
 * spaces, straight quotes. Everything downstream (layout, letter counting,
 * solve checking) works on this so the board and the rules never disagree.
 */
export function normaliseAnswer(s) {
  return String(s == null ? "" : s)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Break `words` into exactly `caps.length` lines as evenly as possible, never
 * splitting a word. Returns null when no arrangement fits the capacities.
 *
 * For a fixed line count the lines' total length is fixed too (only the spaces
 * at the breaks disappear), so minimising the squared deviation from their mean
 * is the same as minimising the sum of squared lengths — which is additive per
 * line, and therefore something the DP can accumulate directly.
 *
 * @param {string[]} words
 * @param {number[]} caps  Character capacity of each line.
 * @returns {{sumSq:number, total:number, lines:string[]}|null}
 */
function breakLines(words, caps) {
  const n = words.length, k = caps.length;
  const memo = new Map();

  function go(i, line) {
    if (line === k) return i === n ? { sumSq: 0, cuts: [] } : null;
    const key = `${i}:${line}`;
    if (memo.has(key)) return memo.get(key);

    let best = null, len = 0;
    for (let j = i; j < n; j++) {
      len += words[j].length + (j > i ? 1 : 0);       // +1 for the space before it
      if (len > caps[line]) break;                    // and only gets longer
      if (n - j - 1 < k - line - 1) break;            // too few words left for the rest
      const rest = go(j + 1, line + 1);
      if (rest) {
        const sumSq = len * len + rest.sumSq;
        if (!best || sumSq < best.sumSq) best = { sumSq, cuts: [j + 1, ...rest.cuts] };
      }
    }
    memo.set(key, best);
    return best;
  }

  const r = go(0, 0);
  if (!r) return null;
  const lines = [];
  let from = 0;
  for (const cut of r.cuts) { lines.push(words.slice(from, cut).join(" ")); from = cut; }
  return { sumSq: r.sumSq, total: lines.reduce((t, l) => t + l.length, 0), lines };
}

/**
 * @typedef {Object} PuzzleCell
 * @property {string} ch     The character on this tile.
 * @property {number} row
 * @property {number} col
 * @property {boolean} letter  True for A–Z (hidden until called); punctuation
 *                             and digits are always shown, as on the show.
 *
 * @typedef {Object} PuzzleLayout
 * @property {boolean} ok
 * @property {string} [error]     Why it doesn't fit (shown in the editor).
 * @property {string} text        The normalised answer.
 * @property {string[]} lines
 * @property {number[]} rows      Which board rows the lines occupy.
 * @property {PuzzleCell[]} cells
 * @property {(PuzzleCell|null)[][]} grid   BOARD_ROWS × BOARD_COLS.
 * @property {number} letterCount Number of hidden (A–Z) tiles.
 */

/**
 * Lay an answer out on the board: wrap it across up to four lines without ever
 * splitting a word, balance the lines, and centre each one in its row.
 * @param {string} answer
 * @returns {PuzzleLayout}
 */
export function layoutPuzzle(answer) {
  const text = normaliseAnswer(answer);
  const empty = () => Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
  const fail = (error) => ({ ok: false, error, text, lines: [], rows: [], cells: [], grid: empty(), letterCount: 0 });

  if (!text) return fail("Type the answer to see the board.");

  const words = text.split(" ");
  const widest = Math.max(...ROW_SPANS.map((r) => r.cap));
  const tooLong = words.find((w) => w.length > widest);
  if (tooLong) {
    return fail(`“${tooLong}” is ${tooLong.length} characters — a line only holds ${widest}.`);
  }

  let best = null;
  for (const cand of ROW_SETS) {
    if (cand.rows.length > words.length) continue;      // every line needs a word
    const k = cand.rows.length;
    const fit = breakLines(words, cand.rows.map((r) => ROW_SPANS[r].cap));
    if (!fit) continue;
    // sumSq − total²/k is the lines' total squared deviation from their mean:
    // comparable across different line counts, unlike sumSq on its own.
    const cost = fit.sumSq - (fit.total * fit.total) / k + cand.bias + LINE_PENALTY * k;
    if (!best || cost < best.cost) best = { cost, rows: cand.rows, lines: fit.lines };
  }
  if (!best) {
    const total = text.length;
    return fail(`That's ${total} characters — too long for the board (4 lines, ${widest} wide).`);
  }

  const grid = empty();
  const cells = [];
  best.rows.forEach((rowIdx, i) => {
    const span = ROW_SPANS[rowIdx];
    const line = best.lines[i];
    const off = span.start + Math.floor((span.cap - line.length) / 2);
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === " ") continue;                          // word gaps stay dark
      const cell = { ch, row: rowIdx, col: off + c, letter: isLetter(ch) };
      grid[rowIdx][off + c] = cell;
      cells.push(cell);
    }
  });

  return {
    ok: true, text, lines: best.lines, rows: best.rows, cells, grid,
    letterCount: cells.filter((c) => c.letter).length,
  };
}

/** How many times a letter appears in an answer (0 when it doesn't). */
export function countLetter(answer, letter) {
  const L = String(letter || "").toUpperCase();
  if (!isLetter(L)) return 0;
  let n = 0;
  for (const ch of normaliseAnswer(answer)) if (ch === L) n++;
  return n;
}

/** The distinct A–Z letters an answer contains. */
export function lettersIn(answer) {
  const set = new Set();
  for (const ch of normaliseAnswer(answer)) if (isLetter(ch)) set.add(ch);
  return set;
}

/** True once every hidden letter has been called. */
export function isFullyRevealed(answer, called) {
  const need = lettersIn(answer);
  for (const L of need) if (!called.has(L)) return false;
  return true;
}

/**
 * Solve checking, forgiving about everything the room can't hear: case, spacing,
 * punctuation and accents. "DONT STOP BELIEVIN" solves "DON'T STOP BELIEVIN'".
 */
export function answerMatches(guess, answer) {
  const strip = (s) => normaliseAnswer(s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // drop accents
    .replace(/[^A-Z0-9]/g, "");
  const g = strip(guess);
  return !!g && g === strip(answer);
}

/* =================================================================== wheel */

/**
 * @typedef {"cash"|"bankrupt"|"lose"|"free"} WedgeType
 *
 * @typedef {Object} Wedge
 * @property {WedgeType} type
 * @property {number} value    Cash value (0 for non-cash wedges).
 * @property {string} label    What's printed on the wedge.
 * @property {string} color    Wedge fill.
 * @property {string} ink      Text colour on that fill.
 */

const cash = (value, color, ink = "#12131a") => ({ type: "cash", value, label: String(value), color, ink });
const BANKRUPT = { type: "bankrupt", value: 0, label: "BANKRUPT", color: "#0b0b10", ink: "#ffffff" };
const LOSE_TURN = { type: "lose", value: 0, label: "LOSE A TURN", color: "#eceff5", ink: "#12131a" };
const FREE_PLAY = { type: "free", value: 0, label: "FREE PLAY", color: "#22c55e", ink: "#08150c" };

// Show-inspired, not a copy: 24 wedges, two Bankrupts sat opposite each other,
// one Lose a Turn, one Free Play, and a headline wedge at the top.
const W1 = [
  cash(2500, "#ffcf4d"), cash(500, "#f3f4f6"), cash(900, "#ff5f8f"), cash(700, "#22d3ee"),
  BANKRUPT, cash(600, "#a3e635"), cash(800, "#ff8a3d"), cash(550, "#3b82f6"),
  cash(500, "#f3f4f6"), cash(650, "#d64bd0"), cash(500, "#14b8a6"), LOSE_TURN,
  cash(700, "#fde047"), cash(800, "#8b5cf6"), cash(500, "#f3f4f6"), cash(650, "#34d399"),
  cash(500, "#22d3ee"), cash(900, "#ff8a3d"), BANKRUPT, cash(600, "#ff5f8f"),
  cash(700, "#3b82f6"), cash(600, "#a3e635"), cash(550, "#d64bd0"), FREE_PLAY,
];

// Later rounds keep the same shape with a bigger headline wedge and slightly
// richer cash, so the stakes climb the way they do on air.
const W2 = W1.map((w) =>
  w.type !== "cash" ? w : cash(w.value === 2500 ? 3500 : w.value + 100, w.color, w.ink));
const W3 = W1.map((w) =>
  w.type !== "cash" ? w : cash(w.value === 2500 ? 5000 : w.value + 200, w.color, w.ink));

/** @type {Record<string, {name:string, wedges:Wedge[]}>} */
export const WHEEL_LAYOUTS = {
  r1: { name: "Round 1", wedges: W1 },
  r2: { name: "Rounds 2–3", wedges: W2 },
  r3: { name: "Round 4+", wedges: W3 },
};

/** The wheel a given round number plays on. */
export function wheelKeyForRound(n) {
  return n <= 1 ? "r1" : n <= 3 ? "r2" : "r3";
}
export function wedgesForRound(n) {
  return WHEEL_LAYOUTS[wheelKeyForRound(n)].wedges;
}

/** Pick a landing wedge. Kept here so the console and the wheel view agree. */
export function pickWedgeIndex(wedges) {
  return Math.floor(Math.random() * wedges.length);
}

/* =================================================================== rules */

export const WHEEL_RULES = {
  vowelCost: 250,
  /** What a consonant pays on a Free Play, where the wedge itself carries no value. */
  freePlayValue: 500,
  /** Solving with an empty round pays at least this, as the show guarantees. */
  minSolveAward: 1000,
  /** The letters the bonus round hands out before the player picks their own. */
  bonusGiven: ["R", "S", "T", "L", "N", "E"],
  /** Extra letters the bonus-round player chooses (3 consonants + 1 vowel). */
  bonusPickConsonants: 3,
  bonusPickVowels: 1,
  /** Seconds on the clock once the bonus board is revealed. */
  bonusSeconds: 10,
  /** How long each tile takes to appear in a toss-up. */
  tossupTileMs: 1300,
};

/**
 * @typedef {Object} RoundKind
 * @property {string} key
 * @property {string} name
 * @property {string} glyph
 * @property {string} hint
 * @property {number} defaultValue  0 when the round's value comes off the wheel.
 */
/** @type {RoundKind[]} */
export const ROUND_KINDS = [
  { key: "standard", name: "Standard round", glyph: "🎡", hint: "Spin, call letters, buy vowels, solve.", defaultValue: 0 },
  { key: "toss-up", name: "Toss-up", glyph: "⚡", hint: "Letters appear on their own — first to buzz in and solve takes it.", defaultValue: 1000 },
  { key: "bonus", name: "Bonus round", glyph: "🏆", hint: "One player, R S T L N E, four picks and ten seconds.", defaultValue: 5000 },
];
export const getRoundKind = (key) => ROUND_KINDS.find((k) => k.key === key) || ROUND_KINDS[0];

/**
 * The order a toss-up uncovers the board in — individual *tiles*, scattered, the
 * way the show does it rather than a letter at a time.
 *
 * Returned as "row,col" keys so it can live in shared state: control shuffles
 * once and both windows uncover the same tiles in the same order.
 * @param {string} answer
 * @returns {string[]}
 */
export function tossupCellOrder(answer) {
  const layout = layoutPuzzle(answer);
  if (!layout.ok) return [];
  const keys = layout.cells.filter((c) => c.letter).map((c) => `${c.row},${c.col}`);
  for (let i = keys.length - 1; i > 0; i--) {           // Fisher–Yates
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}

/* ============================================================ puzzle model */

/**
 * @typedef {Object} Puzzle
 * @property {string} id
 * @property {string} gameKey      Always "wheel".
 * @property {string} answer       What's on the board.
 * @property {string} category     Shown under the board.
 * @property {{tags:string[], favourite:boolean, notes:string, difficulty?:number}} meta
 * @property {number} schemaVersion
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @returns {Puzzle} */
export function makePuzzle({ answer = "", category = "", meta } = {}) {
  const ts = nowIso();
  return {
    id: newId("puzzle"),
    gameKey: "wheel",
    answer: normaliseAnswer(answer),
    category: String(category || "").trim(),
    meta: {
      tags: (meta && meta.tags) || [],
      favourite: !!(meta && meta.favourite),
      notes: (meta && meta.notes) || "",
      ...(meta && meta.difficulty != null ? { difficulty: meta.difficulty } : {}),
    },
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * @typedef {Object} WheelRound
 * @property {string} id
 * @property {string} puzzleId
 * @property {string} kind        One of ROUND_KINDS.
 * @property {number} value       Toss-up award / bonus prize. 0 for standard
 *                                rounds, where the wheel sets the stakes.
 *
 * @typedef {Object} WheelSession
 * @property {string} id
 * @property {string} gameKey     Always "wheel".
 * @property {string} name
 * @property {WheelRound[]} rounds  Ordered running order.
 * @property {{notes:string, tags:string[]}} meta
 * @property {number} schemaVersion
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @returns {WheelRound} */
export function makeRound({ puzzleId = "", kind = "standard", value } = {}) {
  const def = getRoundKind(kind);
  return {
    id: newId("round"),
    puzzleId,
    kind: def.key,
    value: value != null ? Number(value) : def.defaultValue,
  };
}

/** @returns {WheelSession} */
export function makeWheelSession({ name = "New Wheel Session", rounds, meta } = {}) {
  const ts = nowIso();
  return {
    id: newId("wsession"),
    gameKey: "wheel",
    name,
    rounds: rounds || [],
    meta: { notes: (meta && meta.notes) || "", tags: (meta && meta.tags) || [] },
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
  };
}

/* ============================================================ repositories */

function normalisePuzzle(p) {
  p.meta = p.meta || { tags: [], favourite: false, notes: "" };
  p.meta.tags = p.meta.tags || [];
  p.answer = p.answer || "";
  p.category = p.category || "";
  p.gameKey = p.gameKey || "wheel";
  p.schemaVersion = p.schemaVersion || SCHEMA_VERSION;
  return p;
}
function normaliseWheelSession(s) {
  s.rounds = s.rounds || [];
  s.meta = s.meta || { notes: "", tags: [] };
  s.gameKey = s.gameKey || "wheel";
  return s;
}

export const puzzles = new Collection("puzzles", normalisePuzzle);
export const wheelSessions = new Collection("wheelSessions", normaliseWheelSession);

export const PuzzleRepo = {
  list: () => puzzles.all(),
  get: (id) => puzzles.get(id),

  create(partial = {}) {
    return puzzles.put(makePuzzle(partial));
  },

  /** Save an edited puzzle, keeping the answer canonical. */
  save(puzzle) {
    puzzle.answer = normaliseAnswer(puzzle.answer);
    puzzle.category = String(puzzle.category || "").trim();
    puzzle.updatedAt = nowIso();
    return puzzles.put(puzzle);
  },

  update(id, patch) {
    const p = puzzles.get(id);
    if (!p) return null;
    return this.save({ ...p, ...patch });
  },

  duplicate(id) {
    const src = puzzles.get(id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = newId("puzzle");
    copy.createdAt = copy.updatedAt = nowIso();
    return puzzles.put(copy);
  },

  remove(id) {
    puzzles.remove(id);
    // Referential cleanup: drop the puzzle from any session that played it.
    for (const s of wheelSessions.all()) {
      if ((s.rounds || []).some((r) => r.puzzleId === id)) {
        wheelSessions.patch(s.id, {
          rounds: s.rounds.filter((r) => r.puzzleId !== id),
          updatedAt: nowIso(),
        });
      }
    }
  },

  toggleFavourite(id) {
    const p = puzzles.get(id);
    if (!p) return null;
    return puzzles.patch(id, { meta: { ...p.meta, favourite: !p.meta.favourite }, updatedAt: nowIso() });
  },

  /** Every category in use, de-duplicated and sorted — drives the filter bar. */
  allCategories() {
    const set = new Set();
    for (const p of puzzles.all()) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  allTags() {
    const set = new Set();
    for (const p of puzzles.all()) for (const t of p.meta?.tags || []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  /** Search + sort helper used by the library. */
  query({ query = "", category = "", favouritesOnly = false, sort = "updated" } = {}) {
    let list = puzzles.all();
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        p.answer.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.meta?.tags || []).some((t) => t.toLowerCase().includes(q)));
    }
    if (category) list = list.filter((p) => p.category === category);
    if (favouritesOnly) list = list.filter((p) => p.meta?.favourite);

    const cmp = {
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
      created: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      answer: (a, b) => a.answer.localeCompare(b.answer),
      category: (a, b) => (a.category || "~").localeCompare(b.category || "~") || a.answer.localeCompare(b.answer),
      length: (a, b) => b.answer.length - a.answer.length,
    }[sort] || (() => 0);
    return list.sort(cmp);
  },

  subscribe: (fn) => puzzles.subscribe(fn),
};

export const WheelSessionRepo = {
  list: () => wheelSessions.all(),
  get: (id) => wheelSessions.get(id),

  create(partial = {}) {
    return wheelSessions.put(makeWheelSession(partial));
  },

  save(session) {
    session.updatedAt = nowIso();
    return wheelSessions.put(session);
  },

  rename(id, name) {
    return wheelSessions.patch(id, { name, updatedAt: nowIso() });
  },

  setRounds(id, rounds) {
    return wheelSessions.patch(id, { rounds, updatedAt: nowIso() });
  },

  duplicate(id) {
    const src = wheelSessions.get(id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = newId("wsession");
    copy.name = `${src.name} (copy)`;
    copy.rounds = (copy.rounds || []).map((r) => ({ ...r, id: newId("round") }));
    copy.createdAt = copy.updatedAt = nowIso();
    return wheelSessions.put(copy);
  },

  remove: (id) => wheelSessions.remove(id),

  /** Resolve a session into playable rounds, skipping any missing puzzle. */
  resolveRounds(id) {
    const s = wheelSessions.get(id);
    if (!s) return [];
    return (s.rounds || [])
      .map((r) => ({ ...r, puzzle: puzzles.get(r.puzzleId) }))
      .filter((r) => r.puzzle);
  },

  subscribe: (fn) => wheelSessions.subscribe(fn),
};
