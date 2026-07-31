// Domain repositories — the API the rest of the app talks to.
//
// UI never touches localStorage or raw records directly; it calls these verbs.
// That keeps business rules (duplication, timestamps, referential cleanup) in one
// place and lets the backing store change later without touching callers.

import { Collection, Value } from "./store.js";
import {
  makeBoard, makeSession, makeCategory, makeClue, makeRichContent,
  boardClueCount, SCHEMA_VERSION,
} from "./models.js";
import { newId } from "./ids.js";

const nowIso = () => new Date().toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));

/* --------------------------------------------------------------- categories */
// A category is the Jeopardy library's unit of content: a name plus a clue
// ladder. Boards are generated from categories at session-assembly time (see
// BoardRepo below) rather than authored directly, so the same category can be
// reused across many boards/sessions.

function normaliseCategory(c) {
  c.gameKey = c.gameKey || "jeopardy";
  c.meta = c.meta || { tags: [], favourite: false, notes: "" };
  c.meta.tags = c.meta.tags || [];
  c.clues = c.clues || [];
  c.schemaVersion = c.schemaVersion || SCHEMA_VERSION;
  return c;
}

export const categories = new Collection("categories", normaliseCategory);

export const CategoryRepo = {
  list: () => categories.all(),
  get: (id) => categories.get(id),

  create(partial = {}) {
    return categories.put(makeCategory(partial));
  },

  save(category) {
    category.updatedAt = nowIso();
    return categories.put(category);
  },

  rename(id, name) {
    return categories.patch(id, { name, updatedAt: nowIso() });
  },

  duplicate(id) {
    const src = categories.get(id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = newId("cat");
    copy.name = `${src.name} (copy)`;
    copy.clues = (copy.clues || []).map((cl) => ({ ...cl, id: newId("clue") }));
    copy.createdAt = copy.updatedAt = nowIso();
    return categories.put(copy);
  },

  remove(id) {
    categories.remove(id);
    // Referential cleanup: drop this category from any board that used it —
    // a gap in the lineup (skipped at hydration), not a crash.
    for (const b of boards.all()) {
      if (b.categoryIds && b.categoryIds.includes(id)) {
        boards.patch(b.id, { categoryIds: b.categoryIds.filter((c) => c !== id), updatedAt: nowIso() });
      }
    }
  },

  toggleFavourite(id) {
    const c = categories.get(id);
    if (!c) return null;
    return categories.patch(id, { meta: { ...c.meta, favourite: !c.meta.favourite }, updatedAt: nowIso() });
  },

  setTags(id, tags) {
    const c = categories.get(id);
    if (!c) return null;
    return categories.patch(id, { meta: { ...c.meta, tags }, updatedAt: nowIso() });
  },

  clueCount: (cat) => (cat && cat.clues ? cat.clues.length : 0),

  /** Every tag used across all categories, de-duplicated and sorted. */
  allTags() {
    const set = new Set();
    for (const c of categories.all()) for (const t of c.meta?.tags || []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  /**
   * Search + sort helper used by the library.
   * @param {{query?:string, tag?:string, favouritesOnly?:boolean, sort?:string}} opts
   */
  query({ query = "", tag = "", favouritesOnly = false, sort = "updated" } = {}) {
    let list = categories.all();
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    if (tag) list = list.filter((c) => (c.meta?.tags || []).includes(tag));
    if (favouritesOnly) list = list.filter((c) => c.meta?.favourite);

    const cmp = {
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
      created: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => (b.clues?.length || 0) - (a.clues?.length || 0),
    }[sort] || (() => 0);
    return list.sort(cmp);
  },

  subscribe: (fn) => categories.subscribe(fn),
};

/* ------------------------------------------------------------------ boards */
// A board is a generated shell, not a library entry: it references categories
// by id (so one category can appear on many boards) plus its own Daily Double
// placement. BoardRepo.get/list hydrate it into the full
// `{...board, categories:[...]}` shape the legacy console and board-view.js
// expect — that hydration is the one seam the platform/legacy-console bridge
// depends on, so it must keep producing that exact shape.

function normaliseBoard(b) {
  b.meta = b.meta || { tags: [], favourite: false, notes: "" };
  b.meta.tags = b.meta.tags || [];
  b.categoryIds = b.categoryIds || [];
  b.dailyDoubles = b.dailyDoubles || [];
  b.schemaVersion = b.schemaVersion || SCHEMA_VERSION;
  return b;
}

export const boards = new Collection("boards", normaliseBoard);
export const sessions = new Collection("sessions");
export const assets = new Collection("assets");
export const settings = new Value("settings", {});

/** Pure/read-only: resolves categoryIds + applies Daily Double positions.
 *  A board that predates the categories model (still carrying an embedded
 *  `categories` array, `categoryIds` empty) falls back to that embedded data
 *  as-is — already the exact shape board-view.js needs — so nothing breaks
 *  before `migrateEmbeddedBoardsToCategories` below has had a chance to run. */
function hydrateBoard(board) {
  if (!board) return null;
  if (board.categoryIds && board.categoryIds.length) {
    const ddSet = new Set((board.dailyDoubles || []).map((d) => `${d.col}:${d.row}`));
    const cats = board.categoryIds
      .map((cid) => categories.get(cid))
      .filter(Boolean)
      .map((cat, col) => ({
        ...cat,
        clues: (cat.clues || []).map((clue, row) => ({ ...clue, dailyDouble: ddSet.has(`${col}:${row}`) })),
      }));
    return { ...board, categories: cats };
  }
  return { ...board, categories: board.categories || [] };
}

export const BoardRepo = {
  list: () => boards.all().map(hydrateBoard),
  get: (id) => hydrateBoard(boards.get(id)),

  /** The raw, unhydrated record (categoryIds/dailyDoubles, no embedded
   *  categories) — what the session board-assembly editor reads and writes. */
  getRaw: (id) => boards.get(id),

  create(partial = {}) {
    return hydrateBoard(boards.put(makeBoard(partial)));
  },

  setCategories(id, categoryIds) {
    return hydrateBoard(boards.patch(id, { categoryIds, updatedAt: nowIso() }));
  },

  setDailyDoubles(id, dailyDoubles) {
    return hydrateBoard(boards.patch(id, { dailyDoubles, updatedAt: nowIso() }));
  },

  rename(id, name) {
    return hydrateBoard(boards.patch(id, { name, updatedAt: nowIso() }));
  },

  remove(id) {
    boards.remove(id);
    // Referential cleanup: drop this board from any session that used it.
    for (const s of sessions.all()) {
      if (s.boardIds && s.boardIds.includes(id)) {
        sessions.patch(s.id, {
          boardIds: s.boardIds.filter((b) => b !== id),
          updatedAt: nowIso(),
        });
      }
    }
  },

  clueCount: boardClueCount, // expects a hydrated board (categories embedded)

  subscribe: (fn) => boards.subscribe(fn),
};

/** One-time: split any board still carrying an embedded `categories` array
 *  (pre-categories-model data) out into standalone CategoryRepo records,
 *  rewriting the board to `categoryIds` + `dailyDoubles`. Safe to call on
 *  every boot — boards already migrated (or created fresh, which already
 *  have `categoryIds`) are skipped. Nothing is deleted; existing libraries
 *  survive the upgrade as categories. */
export function migrateEmbeddedBoardsToCategories() {
  const legacyShaped = boards.all().filter((b) => (!b.categoryIds || !b.categoryIds.length) && Array.isArray(b.categories) && b.categories.length);
  for (const b of legacyShaped) {
    const categoryIds = b.categories.map((cat) => {
      const rec = makeCategory({
        name: cat.name,
        clues: (cat.clues || []).map((cl) => makeClue({
          value: cl.value, prompt: cl.prompt, response: cl.response, difficulty: cl.difficulty, notes: cl.notes,
        })),
      });
      categories.put(rec);
      return rec.id;
    });
    const dailyDoubles = [];
    b.categories.forEach((cat, col) => (cat.clues || []).forEach((cl, row) => { if (cl.dailyDouble) dailyDoubles.push({ col, row }); }));
    const next = { ...b, categoryIds, dailyDoubles };
    delete next.categories;
    boards.put(next);
  }
}

/* ---------------------------------------------------------------- sessions */

export const SessionRepo = {
  list: () => sessions.all(),
  get: (id) => sessions.get(id),

  create(partial = {}) {
    return sessions.put(makeSession(partial));
  },

  save(session) {
    session.updatedAt = nowIso();
    return sessions.put(session);
  },

  rename(id, name) {
    return sessions.patch(id, { name, updatedAt: nowIso() });
  },

  setBoards(id, boardIds) {
    return sessions.patch(id, { boardIds, updatedAt: nowIso() });
  },

  duplicate(id) {
    const src = sessions.get(id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = newId("session");
    copy.name = `${src.name} (copy)`;
    copy.createdAt = copy.updatedAt = nowIso();
    return sessions.put(copy);
  },

  remove: (id) => sessions.remove(id),

  /** Resolve a session's board references into full, hydrated board records (skips missing). */
  resolveBoards(id) {
    const s = sessions.get(id);
    if (!s) return [];
    return s.boardIds.map((bid) => BoardRepo.get(bid)).filter(Boolean);
  },

  subscribe: (fn) => sessions.subscribe(fn),
};

/* ------------------------------------------------------------------ assets */

export const AssetRepo = {
  list: () => assets.all(),
  get: (id) => assets.get(id),
  put: (asset) => assets.put(asset),
  remove: (id) => assets.remove(id),
  subscribe: (fn) => assets.subscribe(fn),
};

// Convenience re-exports for quick construction in callers.
export { makeCategory, makeClue, makeRichContent };
