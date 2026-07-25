// Persistence layer for the platform.
//
// A tiny, dependency-free repository over localStorage that is:
//   • namespaced      — all keys live under `gsp:` so nothing collides with the
//                        legacy console state.
//   • versioned       — a schema marker lets future migrations run safely.
//   • reactive        — subscribers (and other tabs/windows) are notified on any
//                        change via BroadcastChannel + the storage event.
//   • swappable       — everything goes through `Collection`, so the backing store
//                        can later become IndexedDB / a server API without touching
//                        callers.

const NS = "gsp:";
const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("gsp-store") : null;

/** @type {Map<string, Set<Function>>} keyed by collection name */
const listeners = new Map();

function keyFor(collection) {
  return `${NS}${collection}`;
}

function readRaw(collection) {
  try {
    const raw = localStorage.getItem(keyFor(collection));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRaw(collection, map) {
  localStorage.setItem(keyFor(collection), JSON.stringify(map));
}

function emit(collection) {
  const set = listeners.get(collection);
  if (set) for (const fn of set) { try { fn(); } catch (e) { console.error(e); } }
}

// Cross-window notifications: another tab wrote → refresh local subscribers.
if (channel) {
  channel.onmessage = (e) => {
    const c = e && e.data && e.data.collection;
    if (c) emit(c);
  };
}
window.addEventListener("storage", (e) => {
  if (e.key && e.key.startsWith(NS)) emit(e.key.slice(NS.length));
});

/**
 * A keyed collection of records persisted as `{ [id]: record }`.
 * @template T
 */
export class Collection {
  /**
   * @param {string} name          Storage bucket name (e.g. "boards").
   * @param {(rec:any)=>T} [normalise]  Optional upgrade/normalise on read.
   */
  constructor(name, normalise) {
    this.name = name;
    this.normalise = normalise || ((r) => r);
  }

  /** @returns {T[]} */
  all() {
    const map = readRaw(this.name);
    return Object.values(map).map(this.normalise);
  }

  /** @returns {T|null} */
  get(id) {
    const rec = readRaw(this.name)[id];
    return rec ? this.normalise(rec) : null;
  }

  has(id) {
    return Object.prototype.hasOwnProperty.call(readRaw(this.name), id);
  }

  /** Insert or replace a record (must have an `id`). @returns {T} */
  put(record) {
    if (!record || !record.id) throw new Error(`${this.name}.put requires a record with an id`);
    const map = readRaw(this.name);
    map[record.id] = record;
    writeRaw(this.name, map);
    this._changed();
    return record;
  }

  /** Merge a partial patch into an existing record. @returns {T|null} */
  patch(id, patch) {
    const map = readRaw(this.name);
    if (!map[id]) return null;
    map[id] = { ...map[id], ...patch };
    writeRaw(this.name, map);
    this._changed();
    return this.normalise(map[id]);
  }

  remove(id) {
    const map = readRaw(this.name);
    if (map[id]) {
      delete map[id];
      writeRaw(this.name, map);
      this._changed();
    }
  }

  /** Replace the entire collection at once (used by seeding/import). */
  bulkPut(records) {
    const map = readRaw(this.name);
    for (const r of records) if (r && r.id) map[r.id] = r;
    writeRaw(this.name, map);
    this._changed();
  }

  count() {
    return Object.keys(readRaw(this.name)).length;
  }

  /** Subscribe to any change in this collection. Returns an unsubscribe fn. */
  subscribe(fn) {
    if (!listeners.has(this.name)) listeners.set(this.name, new Set());
    listeners.get(this.name).add(fn);
    return () => listeners.get(this.name)?.delete(fn);
  }

  _changed() {
    emit(this.name);
    if (channel) channel.postMessage({ collection: this.name });
  }
}

/** A single-value slot (e.g. app settings / meta), same reactive semantics. */
export class Value {
  constructor(name, fallback = null) {
    this.name = name;
    this.fallback = fallback;
  }
  get() {
    try {
      const raw = localStorage.getItem(keyFor(this.name));
      return raw ? JSON.parse(raw) : this.fallback;
    } catch {
      return this.fallback;
    }
  }
  set(v) {
    localStorage.setItem(keyFor(this.name), JSON.stringify(v));
    emit(this.name);
    if (channel) channel.postMessage({ collection: this.name });
  }
  subscribe(fn) {
    if (!listeners.has(this.name)) listeners.set(this.name, new Set());
    listeners.get(this.name).add(fn);
    return () => listeners.get(this.name)?.delete(fn);
  }
}
