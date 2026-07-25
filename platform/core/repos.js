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

/** Re-id every nested entity so a duplicated board shares nothing with its source. */
function reidBoard(board) {
  board.id = newId("board");
  for (const cat of board.categories || []) {
    cat.id = newId("cat");
    for (const clue of cat.clues || []) clue.id = newId("clue");
  }
  return board;
}

/* ------------------------------------------------------------------ boards */

function normaliseBoard(b) {
  // Forward-compatible defaults so older records keep working.
  b.meta = b.meta || { tags: [], favourite: false, notes: "" };
  b.meta.tags = b.meta.tags || [];
  b.categories = b.categories || [];
  b.schemaVersion = b.schemaVersion || SCHEMA_VERSION;
  return b;
}

export const boards = new Collection("boards", normaliseBoard);
export const sessions = new Collection("sessions");
export const assets = new Collection("assets");
export const settings = new Value("settings", {});

export const BoardRepo = {
  list: () => boards.all(),
  get: (id) => boards.get(id),

  create(partial = {}) {
    const b = makeBoard(partial);
    return boards.put(b);
  },

  save(board) {
    board.updatedAt = nowIso();
    return boards.put(board);
  },

  rename(id, name) {
    return boards.patch(id, { name, updatedAt: nowIso() });
  },

  duplicate(id) {
    const src = boards.get(id);
    if (!src) return null;
    const copy = reidBoard(clone(src));
    copy.name = `${src.name} (copy)`;
    copy.createdAt = copy.updatedAt = nowIso();
    return boards.put(copy);
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

  toggleFavourite(id) {
    const b = boards.get(id);
    if (!b) return null;
    return boards.patch(id, { meta: { ...b.meta, favourite: !b.meta.favourite }, updatedAt: nowIso() });
  },

  setTags(id, tags) {
    const b = boards.get(id);
    if (!b) return null;
    return boards.patch(id, { meta: { ...b.meta, tags }, updatedAt: nowIso() });
  },

  clueCount: boardClueCount,

  /** Every tag used across all boards, de-duplicated and sorted. */
  allTags() {
    const set = new Set();
    for (const b of boards.all()) for (const t of b.meta?.tags || []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  /**
   * Search + sort helper used by the library.
   * @param {{query?:string, tag?:string, favouritesOnly?:boolean, sort?:string}} opts
   */
  query({ query = "", tag = "", favouritesOnly = false, sort = "updated" } = {}) {
    let list = boards.all();
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((b) => {
        if (b.name.toLowerCase().includes(q)) return true;
        return (b.categories || []).some((c) => c.name.toLowerCase().includes(q));
      });
    }
    if (tag) list = list.filter((b) => (b.meta?.tags || []).includes(tag));
    if (favouritesOnly) list = list.filter((b) => b.meta?.favourite);

    const cmp = {
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
      created: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => boardClueCount(b) - boardClueCount(a),
    }[sort] || ((a, b) => 0);
    return list.sort(cmp);
  },

  subscribe: (fn) => boards.subscribe(fn),
};

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

  /** Resolve a session's board references into full board records (skips missing). */
  resolveBoards(id) {
    const s = sessions.get(id);
    if (!s) return [];
    return s.boardIds.map((bid) => boards.get(bid)).filter(Boolean);
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
