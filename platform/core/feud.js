// Family Feud — domain core.
//
// Everything game-specific about the Feud lives here: the survey model, the
// point ladder the host doesn't have to type, the *answer matcher* (the room
// says things the board doesn't say word-for-word, and the host shouldn't have
// to hunt for the row), the rule constants, and the repositories that persist
// it all through the platform store.
//
// Deliberately UI-free, so the library page, the board component and the live
// console all derive the same board from the same survey — and so the matcher
// can be reasoned about without a DOM.

import { Collection, Value } from "./store.js";
import { newId } from "./ids.js";
import { SCHEMA_VERSION } from "./models.js";

const nowIso = () => new Date().toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));

/* =================================================================== rules */

export const FEUD_RULES = {
  /** Strikes before the board passes to the other family. */
  strikes: 3,
  /** A survey answer board is at most this tall — the set only has eight slots. */
  maxAnswers: 8,
  /** What a fresh survey's points add up to when the app works them out. */
  surveyTotal: 100,
  /** Fast Money. */
  fastMoney: {
    questions: 5,
    /** Combined score the pair needs to win the big prize. */
    target: 200,
    /** Seconds for the first player, then the second (the show gives more). */
    seconds: [20, 25],
    /** A repeat of the first player's answer has to be replaced. */
    flagDuplicates: true,
  },
};

/** The default multiplier ladder: single, single, double, triple. */
export const DEFAULT_MULTIPLIERS = [1, 1, 2, 3];

/** The multiplier a round plays at when the session doesn't say. */
export function defaultMultiplier(roundIndex) {
  return DEFAULT_MULTIPLIERS[Math.min(roundIndex, DEFAULT_MULTIPLIERS.length - 1)];
}

/**
 * Host-configurable rule variations. Persisted whole so the console, the
 * settings sheet and the phones all read one object.
 * @typedef {Object} FeudSettings
 * @property {"verbal"|"phone"} playMode        Who enters answers in a main round.
 * @property {"verbal"|"phone"} fastMoneyMode   Host-controlled or phone-assisted.
 * @property {boolean} faceOffBuzzers   Face-offs use the phones as buzzers.
 * @property {number} faceOffCountdown  Seconds of "get ready" before buzzers arm.
 * @property {number} strikes
 * @property {boolean} passOrPlay       Offer the face-off winner the choice.
 * @property {boolean} stealOneGuess    Steal is a single guess (the show's rule).
 * @property {boolean} revealRestOnLoss Turn the remaining answers at round end.
 * @property {boolean} fastMoneyEnabled
 * @property {number} fastMoneyTarget
 * @property {number[]} fastMoneySeconds
 * @property {boolean} sounds
 * @property {number} animationSpeed    1 = normal, 1.6 = snappier, 0.7 = slower.
 * @property {boolean} autoAdvance      Move to the next round once it's awarded.
 */
/** @type {FeudSettings} */
export const FEUD_DEFAULTS = {
  playMode: "verbal",
  fastMoneyMode: "verbal",
  faceOffBuzzers: true,
  faceOffCountdown: 3,
  strikes: FEUD_RULES.strikes,
  passOrPlay: false,
  stealOneGuess: true,
  revealRestOnLoss: true,
  fastMoneyEnabled: true,
  fastMoneyTarget: FEUD_RULES.fastMoney.target,
  fastMoneySeconds: [...FEUD_RULES.fastMoney.seconds],
  sounds: true,
  animationSpeed: 1,
  autoAdvance: false,
};

export const feudSettings = new Value("feudSettings", null);

/** The saved settings, with any key the host has never touched filled in. */
export function loadFeudSettings() {
  const saved = feudSettings.get();
  const merged = { ...FEUD_DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
  if (!Array.isArray(merged.fastMoneySeconds) || merged.fastMoneySeconds.length < 2) {
    merged.fastMoneySeconds = [...FEUD_RULES.fastMoney.seconds];
  }
  return merged;
}
export function saveFeudSettings(patch) {
  const next = { ...loadFeudSettings(), ...(patch || {}) };
  feudSettings.set(next);
  return next;
}

/* ================================================================= surveys */

/**
 * @typedef {Object} SurveyAnswer
 * @property {string} id
 * @property {string} text     What's printed on the board.
 * @property {number} points   What the survey said.
 * @property {string[]} alts   Other wordings that should count as this answer.
 *
 * @typedef {Object} Survey
 * @property {string} id
 * @property {string} gameKey        Always "feud".
 * @property {string} question       "Name something you…"
 * @property {SurveyAnswer[]} answers  Ranked, highest points first.
 * @property {string} category
 * @property {{tags:string[], favourite:boolean, notes:string, difficulty?:number}} meta
 * @property {number} schemaVersion
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @returns {SurveyAnswer} */
export function makeSurveyAnswer({ text = "", points = 0, alts = [] } = {}) {
  return {
    id: newId("ans"),
    text: String(text || "").trim(),
    points: Math.max(0, Math.round(Number(points) || 0)),
    alts: (Array.isArray(alts) ? alts : []).map((a) => String(a || "").trim()).filter(Boolean),
  };
}

/** @returns {Survey} */
export function makeSurvey({ question = "", answers, category = "", meta } = {}) {
  const ts = nowIso();
  return {
    id: newId("survey"),
    gameKey: "feud",
    question: String(question || "").trim(),
    answers: (answers || []).map((a) => (a && a.id ? a : makeSurveyAnswer(a))),
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
 * A believable survey ladder for `count` answers totalling `total`.
 *
 * Real surveys have a dominant top answer and a long tail, so the weights decay
 * geometrically rather than sitting evenly. The remainder from rounding goes to
 * the largest fractions (largest-remainder), and a final pass keeps the ladder
 * non-increasing — a board where #4 outscores #3 looks broken even when the
 * arithmetic is right.
 *
 * @param {number} count
 * @param {number} [total]
 * @returns {number[]}
 */
export function suggestPoints(count, total = FEUD_RULES.surveyTotal) {
  const n = Math.max(0, Math.floor(count));
  if (!n) return [];
  if (n === 1) return [total];

  const weights = Array.from({ length: n }, (_, i) => Math.pow(0.66, i) + 0.1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w / sum) * total);

  const points = exact.map((v) => Math.floor(v));
  let left = total - points.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) points[order[k % n].i]++;

  for (let i = 1; i < n; i++) {
    if (points[i] > points[i - 1]) {
      const move = points[i] - points[i - 1];
      points[i] -= move;
      points[i - 1] += move;
    }
  }
  // Nobody's answer is worth nothing.
  for (let i = n - 1; i >= 0; i--) {
    if (points[i] > 0) continue;
    const donor = points.findIndex((p) => p > 1);
    if (donor < 0) break;
    points[donor]--;
    points[i] = 1;
  }
  return points;
}

/** Answers in board order: highest points first, ties keep their typed order. */
export function rankAnswers(answers) {
  return [...(answers || [])]
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (y.a.points - x.a.points) || (x.i - y.i))
    .map(({ a }) => a);
}

/** What the whole board is worth before any multiplier. */
export function surveyTotal(survey) {
  return (survey?.answers || []).reduce((t, a) => t + (Number(a.points) || 0), 0);
}

/** Everything wrong with a survey, in the order a host would want to fix it. */
export function surveyIssues(survey) {
  const issues = [];
  const answers = survey?.answers || [];
  if (!String(survey?.question || "").trim()) issues.push("No question yet.");
  if (answers.length < 2) issues.push("A board needs at least two answers.");
  if (answers.length > FEUD_RULES.maxAnswers) {
    issues.push(`The board only holds ${FEUD_RULES.maxAnswers} answers — this has ${answers.length}.`);
  }
  if (answers.some((a) => !a.text.trim())) issues.push("One of the answers is blank.");
  if (answers.length && answers.every((a) => !a.points)) issues.push("No points yet — the app can work them out for you.");

  const seen = new Set();
  for (const a of answers) {
    const key = normaliseGuess(a.text);
    if (!key) continue;
    if (seen.has(key)) { issues.push(`“${a.text}” is on the board twice.`); break; }
    seen.add(key);
  }
  return issues;
}

export const surveyIsPlayable = (survey) => surveyIssues(survey).length === 0;

/* ================================================================ matching */

// Words that carry no meaning in a one-or-two-word survey answer. Kept short on
// purpose: strip too much and "a lot" matches "lot of money".
const FILLER = new Set([
  "a", "an", "the", "your", "my", "his", "her", "their", "our", "its",
  "some", "any", "of", "to", "in", "on", "at", "for", "with", "and", "or",
  "is", "are", "was", "were", "be", "being", "been", "that", "this", "it",
]);

// Verbs that turn up in front of half the answers ever written. They aren't
// noise — "drink coffee" and "have a coffee" are the same answer *because* the
// verb is interchangeable — so they stay in the phrase but don't get to decide
// what it's about. Without this, "drink tea" would match "drink coffee".
const WEAK_VERBS = new Set([
  "go", "get", "got", "have", "has", "had", "take", "make", "made", "do", "does", "did",
  "say", "said", "see", "look", "watch", "check", "use", "put", "buy", "call", "give",
  "keep", "hit", "eat", "drink", "wear", "play", "hold", "bring", "find", "lose", "want",
  "need", "try", "turn", "open", "close", "start", "stop", "leave", "come", "think",
  "feel", "pick", "throw", "read", "write", "clean", "wash", "grab", "scroll", "hear",
  "talk", "tell", "ask", "let", "set", "run", "walk", "sit", "stand", "stay", "know",
]);

/**
 * Canonical form of anything anybody says: lower case, no accents, no
 * punctuation, single spaces. Both sides of every comparison go through it.
 */
export function normaliseGuess(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Crude but reliable singulariser — enough that "keys" finds "key". */
function singular(w) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && (w.endsWith("ches") || w.endsWith("shes") || w.endsWith("sses") || w.endsWith("xes"))) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

/** Meaningful, singularised words. Falls back to the filler when that's all there is. */
function keywords(s) {
  const all = normaliseGuess(s).split(" ").filter(Boolean).map(singular);
  const kept = all.filter((w) => !FILLER.has(w));
  return kept.length ? kept : all;
}

/** Levenshtein distance, iterative with a single row. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0–1 character-level closeness. */
function closeness(a, b) {
  const len = Math.max(a.length, b.length);
  if (!len) return 0;
  return 1 - levenshtein(a, b) / len;
}

/** Two words are "the same word" if they're equal or a typo apart. */
function wordMatches(x, y) {
  if (x === y) return true;
  if (x.length < 4 || y.length < 4) return false;
  if (x.startsWith(y) || y.startsWith(x)) return Math.abs(x.length - y.length) <= 3;
  return levenshtein(x, y) <= (Math.min(x.length, y.length) >= 7 ? 2 : 1);
}

/**
 * The word a phrase is *about*: the longest word that's actually carrying
 * meaning, ignoring the interchangeable verbs. So "drink coffee" and "scroll
 * on their phone" are about coffee and phones, not drinking and scrolling.
 *
 * It's a heuristic, but it's the one that separates "have a coffee" (the same
 * answer, said differently) from "drink tea" (a different answer, said the
 * same way). An answer that is *only* a verb ("stretch", "overslept") falls
 * back to its own words rather than having no subject at all.
 */
function headWord(words) {
  const content = words.filter((w) => !WEAK_VERBS.has(w));
  let head = "";
  for (const w of (content.length ? content : words)) if (w.length >= head.length) head = w;
  return head;                                   // ties go to the last, as English does
}

/**
 * How well `guess` matches one phrase, 0–1.
 *
 * Best of four signals: the same phrase spelled the same way; the shorter
 * phrase's words all appearing in the longer one (so "pizza" hits "cold pizza",
 * a little discounted); the two phrases sharing what they're *about* while
 * differing in the words around it; and raw character closeness for the
 * near-misses in between.
 */
function phraseScore(guess, phrase) {
  const g = normaliseGuess(guess);
  const p = normaliseGuess(phrase);
  if (!g || !p) return 0;
  if (g === p) return 1;

  const gk = keywords(g);
  const pk = keywords(p);
  if (!gk.length || !pk.length) return 0;
  if (gk.join(" ") === pk.join(" ")) return 0.98;

  const [short, long] = gk.length <= pk.length ? [gk, pk] : [pk, gk];
  // Coverage is weighted by word length, so landing "coffee" counts for much
  // more than landing "have" — the long words are the ones carrying the answer.
  const mass = (ws) => ws.reduce((t, w) => t + w.length, 0);
  let matched = 0;
  const taken = new Set();
  for (const w of short) {
    const at = long.findIndex((x, i) => !taken.has(i) && wordMatches(w, x));
    if (at >= 0) { taken.add(at); matched += w.length; }
  }
  const coverage = matched / mass(short);

  // Every word of the shorter phrase landed: strong, but discounted when the
  // other phrase is much longer, since "cheese" is not "macaroni and cheese".
  const containment = coverage === 1 ? 0.95 - 0.12 * (long.length - short.length) : coverage * 0.72;
  // Same subject, different wording around it.
  const sameSubject = wordMatches(headWord(gk), headWord(pk)) ? 0.62 + 0.33 * coverage : 0;

  return Math.max(containment, sameSubject, closeness(g, p));
}

/** The best score for a guess against an answer, counting its alternatives. */
export function answerScore(guess, answer) {
  const phrases = [answer.text, ...(answer.alts || [])];
  return phrases.reduce((best, p) => Math.max(best, phraseScore(guess, p)), 0);
}

/** Anything at or above this is treated as the same answer. */
export const MATCH_THRESHOLD = 0.74;

/**
 * Score a guess against every answer on the board, best first.
 * The console uses the full list to offer "did they mean…" when it isn't sure.
 * @returns {{answer:SurveyAnswer, index:number, score:number}[]}
 */
export function scoreGuess(guess, survey) {
  const answers = survey?.answers || [];
  return answers
    .map((answer, index) => ({ answer, index, score: answerScore(guess, answer) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * The answer a guess is, or null when nothing is close enough.
 * @param {string} guess
 * @param {Survey} survey
 * @param {{threshold?:number, exclude?:string[]}} [opts]  `exclude` skips ids
 *        already revealed, so a repeat guess reads as a miss rather than a hit.
 */
export function matchAnswer(guess, survey, { threshold = MATCH_THRESHOLD, exclude = [] } = {}) {
  if (!String(guess || "").trim()) return null;
  const skip = new Set(exclude);
  const best = scoreGuess(guess, survey).find((r) => !skip.has(r.answer.id));
  return best && best.score >= threshold ? best : null;
}

/**
 * Whether two Fast Money answers are "the same answer" — the show makes the
 * second player change a duplicate, so this is deliberately generous.
 */
export function sameAnswer(a, b) {
  return phraseScore(a, b) >= 0.9;
}

/* ================================================================ sessions */

/**
 * @typedef {Object} FeudRound
 * @property {string} id
 * @property {string} surveyId
 * @property {number} multiplier   1 / 2 / 3.
 *
 * @typedef {Object} FeudSession
 * @property {string} id
 * @property {string} gameKey        Always "feud".
 * @property {string} name
 * @property {FeudRound[]} rounds    Ordered running order.
 * @property {string[]} fastMoneyIds Surveys for the Fast Money card.
 * @property {{notes:string, tags:string[]}} meta
 * @property {number} schemaVersion
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @returns {FeudRound} */
export function makeFeudRound({ surveyId = "", multiplier = 1 } = {}) {
  return { id: newId("fround"), surveyId, multiplier: Math.max(1, Math.round(Number(multiplier) || 1)) };
}

/** @returns {FeudSession} */
export function makeFeudSession({ name = "New Feud Session", rounds, fastMoneyIds, meta } = {}) {
  const ts = nowIso();
  return {
    id: newId("fsession"),
    gameKey: "feud",
    name,
    rounds: rounds || [],
    fastMoneyIds: fastMoneyIds || [],
    meta: { notes: (meta && meta.notes) || "", tags: (meta && meta.tags) || [] },
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
  };
}

/* ============================================================ repositories */

function normaliseSurvey(s) {
  s.gameKey = s.gameKey || "feud";
  s.question = s.question || "";
  s.category = s.category || "";
  s.answers = (s.answers || []).map((a) => ({
    id: a.id || newId("ans"),
    text: String(a.text || ""),
    points: Math.max(0, Math.round(Number(a.points) || 0)),
    alts: Array.isArray(a.alts) ? a.alts : [],
  }));
  s.meta = s.meta || { tags: [], favourite: false, notes: "" };
  s.meta.tags = s.meta.tags || [];
  s.schemaVersion = s.schemaVersion || SCHEMA_VERSION;
  return s;
}

function normaliseFeudSession(s) {
  s.gameKey = s.gameKey || "feud";
  s.rounds = (s.rounds || []).map((r) => ({ ...r, multiplier: Math.max(1, Number(r.multiplier) || 1) }));
  s.fastMoneyIds = s.fastMoneyIds || [];
  s.meta = s.meta || { notes: "", tags: [] };
  return s;
}

export const surveys = new Collection("surveys", normaliseSurvey);
export const feudSessions = new Collection("feudSessions", normaliseFeudSession);

export const SurveyRepo = {
  list: () => surveys.all(),
  get: (id) => surveys.get(id),

  create(partial = {}) {
    return surveys.put(makeSurvey(partial));
  },

  /** Save an edited survey, keeping the board ranked and the points sane. */
  save(survey) {
    const next = { ...survey };
    next.question = String(next.question || "").trim();
    next.category = String(next.category || "").trim();
    next.answers = rankAnswers((next.answers || []).filter((a) => String(a.text || "").trim()));
    next.updatedAt = nowIso();
    return surveys.put(next);
  },

  update(id, patch) {
    const s = surveys.get(id);
    if (!s) return null;
    return this.save({ ...s, ...patch });
  },

  duplicate(id) {
    const src = surveys.get(id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = newId("survey");
    copy.answers = copy.answers.map((a) => ({ ...a, id: newId("ans") }));
    copy.createdAt = copy.updatedAt = nowIso();
    return surveys.put(copy);
  },

  remove(id) {
    surveys.remove(id);
    // Referential cleanup: drop the survey from any session that played it.
    for (const s of feudSessions.all()) {
      const rounds = (s.rounds || []).filter((r) => r.surveyId !== id);
      const fm = (s.fastMoneyIds || []).filter((x) => x !== id);
      if (rounds.length !== (s.rounds || []).length || fm.length !== (s.fastMoneyIds || []).length) {
        feudSessions.patch(s.id, { rounds, fastMoneyIds: fm, updatedAt: nowIso() });
      }
    }
  },

  toggleFavourite(id) {
    const s = surveys.get(id);
    if (!s) return null;
    return surveys.patch(id, { meta: { ...s.meta, favourite: !s.meta.favourite }, updatedAt: nowIso() });
  },

  allCategories() {
    const set = new Set();
    for (const s of surveys.all()) if (s.category) set.add(s.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  allTags() {
    const set = new Set();
    for (const s of surveys.all()) for (const t of s.meta?.tags || []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  /** Search + sort helper used by the library. */
  query({ query = "", category = "", difficulty = 0, favouritesOnly = false, sort = "updated" } = {}) {
    let list = surveys.all();
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((s) =>
        s.question.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.answers || []).some((a) => a.text.toLowerCase().includes(q)) ||
        (s.meta?.tags || []).some((t) => t.toLowerCase().includes(q)));
    }
    if (category) list = list.filter((s) => s.category === category);
    if (difficulty) list = list.filter((s) => (s.meta?.difficulty || 0) === difficulty);
    if (favouritesOnly) list = list.filter((s) => s.meta?.favourite);

    const cmp = {
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
      created: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      question: (a, b) => a.question.localeCompare(b.question),
      category: (a, b) => (a.category || "~").localeCompare(b.category || "~") || a.question.localeCompare(b.question),
      answers: (a, b) => (b.answers?.length || 0) - (a.answers?.length || 0),
      difficulty: (a, b) => (a.meta?.difficulty || 9) - (b.meta?.difficulty || 9),
    }[sort] || (() => 0);
    return list.sort(cmp);
  },

  subscribe: (fn) => surveys.subscribe(fn),
};

export const FeudSessionRepo = {
  list: () => feudSessions.all(),
  get: (id) => feudSessions.get(id),

  create(partial = {}) {
    return feudSessions.put(makeFeudSession(partial));
  },

  save(session) {
    session.updatedAt = nowIso();
    return feudSessions.put(session);
  },

  rename(id, name) {
    return feudSessions.patch(id, { name, updatedAt: nowIso() });
  },

  setRounds(id, rounds) {
    return feudSessions.patch(id, { rounds, updatedAt: nowIso() });
  },

  setFastMoney(id, fastMoneyIds) {
    return feudSessions.patch(id, { fastMoneyIds, updatedAt: nowIso() });
  },

  duplicate(id) {
    const src = feudSessions.get(id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = newId("fsession");
    copy.name = `${src.name} (copy)`;
    copy.rounds = (copy.rounds || []).map((r) => ({ ...r, id: newId("fround") }));
    copy.createdAt = copy.updatedAt = nowIso();
    return feudSessions.put(copy);
  },

  remove: (id) => feudSessions.remove(id),

  /** Resolve a session into playable rounds, skipping any missing survey. */
  resolveRounds(id) {
    const s = feudSessions.get(id);
    if (!s) return [];
    return (s.rounds || [])
      .map((r) => ({ ...r, survey: surveys.get(r.surveyId) }))
      .filter((r) => r.survey);
  },

  /** The Fast Money card, in order, skipping any missing survey. */
  resolveFastMoney(id) {
    const s = feudSessions.get(id);
    if (!s) return [];
    return (s.fastMoneyIds || []).map((sid) => surveys.get(sid)).filter(Boolean);
  },

  subscribe: (fn) => feudSessions.subscribe(fn),
};
