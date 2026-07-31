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
 * @property {boolean} dailyDouble
 * @property {number} [difficulty]  Optional 1–5.
 * @property {string} [notes]       Optional host notes.
 *
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {Clue[]} clues       Ordered by ascending value.
 * @property {string} [notes]
 *
 * @typedef {Object} BoardMeta
 * @property {string[]} tags
 * @property {boolean} favourite
 * @property {number} [difficulty]  Optional 1–5 overall.
 * @property {string} notes
 *
 * @typedef {Object} Board
 * @property {string} id
 * @property {string} gameKey     Which game this board belongs to (e.g. "jeopardy").
 * @property {string} name
 * @property {Category[]} categories
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
export function makeClue({ value = 100, prompt, response, dailyDouble = false, difficulty, notes } = {}) {
  return {
    id: newId("clue"),
    value,
    prompt: prompt || makeRichContent(),
    response: response || makeRichContent(),
    dailyDouble: !!dailyDouble,
    ...(difficulty != null ? { difficulty } : {}),
    ...(notes ? { notes } : {}),
  };
}

/** @returns {Category} */
export function makeCategory({ name = "New Category", clues, notes } = {}) {
  return {
    id: newId("cat"),
    name,
    clues: clues || [],
    ...(notes ? { notes } : {}),
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

/** @returns {Board} */
export function makeBoard({ name = "Untitled Board", gameKey = "jeopardy", categories, meta } = {}) {
  const ts = nowIso();
  return {
    id: newId("board"),
    gameKey,
    name,
    categories: categories || [],
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

/**
 * Standard build of an empty Jeopardy board: N categories × M values.
 * Values follow the classic 100…500 ladder scaled to the requested rows.
 * @returns {Board}
 */
export function makeEmptyJeopardyBoard({ name = "Untitled Board", categories = 5, rows = 5, baseValue = 100 } = {}) {
  const cats = Array.from({ length: categories }, (_, c) => {
    const clues = Array.from({ length: rows }, (_, r) => makeClue({ value: baseValue * (r + 1) }));
    return makeCategory({ name: `Category ${c + 1}`, clues });
  });
  return makeBoard({ name, categories: cats });
}

/** Total number of clues on a board (used for progress + validation). */
export function boardClueCount(board) {
  return (board.categories || []).reduce((n, c) => n + (c.clues ? c.clues.length : 0), 0);
}

/** Whether a rich-content block has anything renderable. */
export function richIsEmpty(rc) {
  return !rc || ((!rc.text || !rc.text.trim()) && (!rc.media || rc.media.length === 0));
}
