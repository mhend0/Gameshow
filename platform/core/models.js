// Domain models for the Game Show platform.
//
// These are plain-data factories (no behaviour) plus JSDoc typedefs that give us
// strong editor typing without a build step. Everything persisted flows through
// these factories so shape, defaults and schema version stay consistent.
//
// Terminology note (Jeopardy): a clue's `prompt` is what the audience sees first
// (Jeopardy phrases it as an "answer"); `response` is the revealed correct answer
// (Jeopardy phrases it as a "question"). We use neutral names so other game types
// can reuse the same shapes.

import { newId } from "./ids.js";

export const SCHEMA_VERSION = 1;

/**
 * @typedef {"image"|"audio"|"video"} MediaKind
 * @typedef {"text"|"image"|"audio"|"video"} ClueMediaType
 *
 * @typedef {Object} MediaRef
 * @property {MediaKind} kind
 * @property {string} [assetId]  Reference into the asset store (portable).
 * @property {string} [src]      External URL fallback (non-portable; used pre-import).
 * @property {string} [alt]
 *
 * @typedef {Object} RichContent
 * @property {string} text        Plain/multiline text (may be empty).
 * @property {MediaRef[]} media   Attached media, rendered after the text.
 *
 * @typedef {Object} Clue
 * @property {string} id
 * @property {number} value       Point value.
 * @property {RichContent} prompt   Shown to the room first.
 * @property {RichContent} response Revealed correct response.
 * @property {number} [difficulty]  Optional 1–5.
 * @property {string} [notes]       Optional host notes.
 *
 * A category is a standalone library entry — the same category can be reused
 * across many generated boards, so Daily Double placement is NOT part of it
 * (see Board.dailyDoubles below).
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} gameKey
 * @property {string} name
 * @property {Clue[]} clues       Ordered by ascending value.
 * @property {CategoryMeta} meta
 * @property {number} schemaVersion
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} CategoryMeta
 * @property {string[]} tags
 * @property {boolean} favourite
 * @property {string} notes
 *
 * @typedef {Object} BoardMeta
 * @property {string[]} tags
 * @property {boolean} favourite
 * @property {number} [difficulty]  Optional 1–5 overall.
 * @property {string} notes
 *
 * @typedef {Object} DailyDoubleSpot
 * @property {number} col   Category column index on the board.
 * @property {number} row   Value row index within that category.
 *
 * A board is a generated shell, not a library entry: it references categories
 * by id (so the same category can appear on many boards) and carries its own
 * Daily Double placement. `BoardRepo.get`/`resolve` hydrate it into the full
 * `{...board, categories:[...]}` shape the legacy console and board-view.js
 * expect, with each Daily Double's `clue.dailyDouble` set at hydration time.
 * @typedef {Object} Board
 * @property {string} id
 * @property {string} gameKey     Which game this board belongs to (e.g. "jeopardy").
 * @property {string} name
 * @property {string[]} categoryIds   Ordered references into the category store.
 * @property {DailyDoubleSpot[]} dailyDoubles
 * @property {BoardMeta} meta
 * @property {number} schemaVersion
 * @property {string} createdAt   ISO string.
 * @property {string} updatedAt   ISO string.
 *
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} gameKey
 * @property {string} name
 * @property {string[]} boardIds  Ordered references into the board store.
 * @property {{notes:string, tags:string[]}} meta
 * @property {number} schemaVersion
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} Asset
 * @property {string} id
 * @property {MediaKind} kind
 * @property {string} name
 * @property {string} mime
 * @property {number} size        Bytes.
 * @property {string} createdAt
 *
 * The raw bytes are not part of this record — they live in IndexedDB's asset
 * blob store, keyed by `id` (see `platform/core/assets.js`). Keeping them out
 * keeps this record (and therefore the in-memory Collection cache) small.
 */

const nowIso = () => new Date().toISOString();

/** @returns {RichContent} */
export function makeRichContent(text = "", media = []) {
  return { text: String(text || ""), media: Array.isArray(media) ? media : [] };
}

/** @returns {MediaRef} */
export function makeMediaRef({ kind = "image", assetId, src, alt = "" } = {}) {
  const ref = { kind, alt };
  if (assetId) ref.assetId = assetId;
  if (src) ref.src = src;
  return ref;
}

/** @returns {Clue} */
export function makeClue({ value = 100, prompt, response, difficulty, notes } = {}) {
  return {
    id: newId("clue"),
    value,
    prompt: prompt || makeRichContent(),
    response: response || makeRichContent(),
    ...(difficulty != null ? { difficulty } : {}),
    ...(notes ? { notes } : {}),
  };
}

/** @returns {CategoryMeta} */
export function makeCategoryMeta(partial = {}) {
  return {
    tags: partial.tags || [],
    favourite: !!partial.favourite,
    notes: partial.notes || "",
  };
}

/** @returns {Category} */
export function makeCategory({ name = "New Category", gameKey = "jeopardy", clues, meta } = {}) {
  const ts = nowIso();
  return {
    id: newId("cat"),
    gameKey,
    name,
    clues: clues || [],
    meta: makeCategoryMeta(meta),
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** @returns {BoardMeta} */
export function makeBoardMeta(partial = {}) {
  return {
    tags: partial.tags || [],
    favourite: !!partial.favourite,
    ...(partial.difficulty != null ? { difficulty: partial.difficulty } : {}),
    notes: partial.notes || "",
  };
}

/** @returns {DailyDoubleSpot} */
export function makeDailyDoubleSpot({ col = 0, row = 0 } = {}) {
  return { col: Math.max(0, Math.round(col)), row: Math.max(0, Math.round(row)) };
}

/** @returns {Board} */
export function makeBoard({ name = "Untitled Board", gameKey = "jeopardy", categoryIds, dailyDoubles, meta } = {}) {
  const ts = nowIso();
  return {
    id: newId("board"),
    gameKey,
    name,
    categoryIds: categoryIds || [],
    dailyDoubles: dailyDoubles || [],
    meta: makeBoardMeta(meta),
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** @returns {Session} */
export function makeSession({ name = "New Session", gameKey = "jeopardy", boardIds, meta } = {}) {
  const ts = nowIso();
  return {
    id: newId("session"),
    gameKey,
    name,
    boardIds: boardIds || [],
    meta: { notes: (meta && meta.notes) || "", tags: (meta && meta.tags) || [] },
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** @returns {Asset} */
export function makeAsset({ kind = "image", name = "asset", mime = "", size = 0 } = {}) {
  return {
    id: newId("asset"),
    kind,
    name,
    mime,
    size,
    createdAt: nowIso(),
  };
}

/** Standard ladder of clues for a fresh category: N values, 100…500 scaled. */
export function makeClueLadder({ rows = 5, baseValue = 100 } = {}) {
  return Array.from({ length: rows }, (_, r) => makeClue({ value: baseValue * (r + 1) }));
}

/** Total number of clues on a *hydrated* board (one whose categories have been
 *  resolved via BoardRepo.get/resolve — see the Board typedef above). */
export function boardClueCount(board) {
  return (board.categories || []).reduce((n, c) => n + (c.clues ? c.clues.length : 0), 0);
}

/** Whether a rich-content block has anything renderable. */
export function richIsEmpty(rc) {
  return !rc || ((!rc.text || !rc.text.trim()) && (!rc.media || rc.media.length === 0));
}
