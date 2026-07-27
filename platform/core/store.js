// Persistence layer for the platform.
//
// A tiny, dependency-free repository over IndexedDB that is:
//   • namespaced      — all keys live under `gsp:` so nothing collides with the
//                        legacy console state.
//   • synchronous     — every collection is hydrated into an in-memory Map once
//                        at boot (see `ready`, below). Collection/Value reads
//                        and writes never touch IndexedDB directly — they read
//                        the memory copy and write through to IndexedDB in the
//                        background, off the interaction path. That's what
//                        keeps `get`/`all`/`put`/`patch`/`remove`/`subscribe`
//                        callable synchronously during render, exactly as
//                        before this file backed onto localStorage.
//   • reactive        — subscribers (and other tabs/windows) are notified on any
//                        change via BroadcastChannel + the storage event.
//   • migrated once   — on first boot, any existing `gsp:` localStorage data is
//                        copied into IndexedDB and consumed. The localStorage
//                        copy itself is left in place (untouched) as a fallback.
//
// Every page must `await ready` (exported below) before making its first
// Collection/Value call — that's the one place this app waits on IndexedDB.

const NS = "gsp:"; // localStorage namespace used pre-migration (read-only now)

const DB_NAME = "gsp";
const DB_VERSION = 2;
const RECORDS_STORE = "records"; // one row per record: { _key, collection, id, value }
const VALUES_STORE = "values";   // one row per Value: { name, value }
const LEGACY_STORE = "legacy";   // staged localStorage blobs awaiting one-time consumption
const ASSET_BLOBS_STORE = "assetBlobs"; // one row per asset's raw bytes: { id, blob } — see assets.js
const MIGRATION_FLAG = "__gsp_migratedV1__";

const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("gsp-store") : null;

/** @type {Map<string, Set<Function>>} keyed by collection/value name */
const listeners = new Map();

function emit(name) {
  const set = listeners.get(name);
  if (set) for (const fn of set) { try { fn(); } catch (e) { console.error(e); } }
}

// Cross-window notifications: another tab wrote → refresh local subscribers.
if (channel) {
  channel.onmessage = (e) => {
    const c = e && e.data && e.data.collection;
    if (c) emit(c);
  };
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith(NS)) emit(e.key.slice(NS.length));
  });
}

/** Thrown when a write to IndexedDB fails, so callers can offer to reclaim space. */
export class StorageFullError extends Error {
  constructor(collection) {
    super(`Storage is full — "${collection}" could not be saved.`);
    this.name = "StorageFullError";
    this.collection = collection;
  }
}

// A quota overflow surfaces under several names/codes depending on the browser.
export function isQuotaError(e) {
  return !!e && (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 || e.code === 1014
  );
}

function reportPersistError(name, e) {
  console.error(`Failed to persist "${name}" to IndexedDB`, isQuotaError(e) ? new StorageFullError(name) : e);
}

/* ----------------------------------------------------------------- IndexedDB */

let _dbPromise = null;
function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        db.createObjectStore(RECORDS_STORE, { keyPath: "_key" }).createIndex("collection", "collection");
      }
      if (!db.objectStoreNames.contains(VALUES_STORE)) {
        db.createObjectStore(VALUES_STORE, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(LEGACY_STORE)) {
        db.createObjectStore(LEGACY_STORE, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(ASSET_BLOBS_STORE)) {
        db.createObjectStore(ASSET_BLOBS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

/** Shared IndexedDB handle, for modules (assets.js) that manage their own object
 *  store outside the Collection/Value record model. */
export function getDb() {
  return openDb();
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ------------------------------------------------------------------ caches */

/** Every Collection/Value registers itself here at construction time (synchronous,
 *  happens before `ready`'s hydration loop ever runs — see the comment on `init`). */
const registry = new Map(); // name -> { kind: "collection", normalise } | { kind: "value", fallback }

const recordCache = new Map(); // collection name -> Map(id -> record)
const valueCache = new Map();  // value name -> value

function collectionMap(name) {
  let m = recordCache.get(name);
  if (!m) { m = new Map(); recordCache.set(name, m); }
  return m;
}

/* --------------------------------------------------------------- migration */

/** One-time, whole-browser: stage every existing `gsp:` localStorage blob into
 *  IndexedDB, keyed by name, so it can be consumed lazily as each Collection/Value
 *  is hydrated (possibly across different page loads — whichever page needs a
 *  given name first consumes its stage). The localStorage keys are left alone. */
async function migrateLegacyIfNeeded(db) {
  const flag = await reqAsPromise(db.transaction(VALUES_STORE, "readonly").objectStore(VALUES_STORE).get(MIGRATION_FLAG));
  if (flag) return;

  const tx = db.transaction([LEGACY_STORE, VALUES_STORE], "readwrite");
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(NS) || key === NS + MIGRATION_FLAG) continue;
      try {
        const blob = JSON.parse(localStorage.getItem(key));
        tx.objectStore(LEGACY_STORE).put({ name: key.slice(NS.length), blob });
      } catch { /* skip unparsable */ }
    }
  }
  tx.objectStore(VALUES_STORE).put({ name: MIGRATION_FLAG, value: true });
  await txDone(tx);
}

async function hydrateCollection(db, name) {
  const map = collectionMap(name);
  const idx = db.transaction(RECORDS_STORE, "readonly").objectStore(RECORDS_STORE).index("collection");
  const rows = await reqAsPromise(idx.getAll(IDBKeyRange.only(name)));
  for (const row of rows) map.set(row.id, row.value);

  const legacy = await reqAsPromise(db.transaction(LEGACY_STORE, "readonly").objectStore(LEGACY_STORE).get(name));
  if (!legacy) return;

  const blob = legacy.blob;
  const tx = db.transaction([RECORDS_STORE, LEGACY_STORE], "readwrite");
  if (blob && typeof blob === "object") {
    const recStore = tx.objectStore(RECORDS_STORE);
    for (const record of Object.values(blob)) {
      if (!record || !record.id || map.has(record.id)) continue; // never clobber a real record
      map.set(record.id, record);
      recStore.put({ _key: `${name}:${record.id}`, collection: name, id: record.id, value: record });
    }
  }
  tx.objectStore(LEGACY_STORE).delete(name);
  await txDone(tx);
}

async function hydrateValue(db, name, fallback) {
  const row = await reqAsPromise(db.transaction(VALUES_STORE, "readonly").objectStore(VALUES_STORE).get(name));
  if (row) valueCache.set(name, row.value);

  const legacy = await reqAsPromise(db.transaction(LEGACY_STORE, "readonly").objectStore(LEGACY_STORE).get(name));
  if (legacy) {
    const tx = db.transaction([VALUES_STORE, LEGACY_STORE], "readwrite");
    if (!row) {
      valueCache.set(name, legacy.blob);
      tx.objectStore(VALUES_STORE).put({ name, value: legacy.blob });
    }
    tx.objectStore(LEGACY_STORE).delete(name);
    await txDone(tx);
  }

  if (!valueCache.has(name)) valueCache.set(name, fallback);
}

/* --------------------------------------------------------------------- boot */

async function init() {
  // Yield once before touching the registry: this lets every Collection/Value
  // constructor called synchronously during this page's module evaluation (all
  // of it — including the page's own script, up to its own first `await ready`)
  // finish registering before we read the registry below.
  await Promise.resolve();

  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); }
  catch { /* best-effort; storage still works without persistence */ }

  const db = await openDb();
  await migrateLegacyIfNeeded(db);

  await Promise.all([...registry].map(async ([name, meta]) => {
    try {
      if (meta.kind === "collection") await hydrateCollection(db, name);
      else await hydrateValue(db, name, meta.fallback);
    } catch (e) {
      console.error(`Failed to hydrate "${name}" from IndexedDB`, e);
    }
  }));

  return db;
}

/** Resolves once every registered Collection/Value has been hydrated from
 *  IndexedDB. Await this before the first Collection/Value call on any page. */
export const ready = init().catch((e) => {
  console.error("Store failed to initialise; continuing with an empty in-memory store", e);
});

/**
 * A keyed collection of records persisted as one IndexedDB row per record.
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
    if (!registry.has(name)) registry.set(name, { kind: "collection" });
  }

  /** @returns {T[]} */
  all() {
    return [...collectionMap(this.name).values()].map(this.normalise);
  }

  /** @returns {T|null} */
  get(id) {
    const rec = collectionMap(this.name).get(id);
    return rec ? this.normalise(rec) : null;
  }

  has(id) {
    return collectionMap(this.name).has(id);
  }

  /** Insert or replace a record (must have an `id`). @returns {T} */
  put(record) {
    if (!record || !record.id) throw new Error(`${this.name}.put requires a record with an id`);
    collectionMap(this.name).set(record.id, record);
    this._writeOne(record);
    this._changed();
    return record;
  }

  /** Merge a partial patch into an existing record. @returns {T|null} */
  patch(id, patch) {
    const map = collectionMap(this.name);
    const cur = map.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    map.set(id, next);
    this._writeOne(next);
    this._changed();
    return this.normalise(next);
  }

  remove(id) {
    const map = collectionMap(this.name);
    if (map.has(id)) {
      map.delete(id);
      this._deleteOne(id);
      this._changed();
    }
  }

  /** Insert or replace many records in one IndexedDB transaction (bulk import). */
  bulkPut(records) {
    const map = collectionMap(this.name);
    const valid = (records || []).filter((r) => r && r.id);
    for (const r of valid) map.set(r.id, r);
    this._writeMany(valid);
    this._changed();
  }

  count() {
    return collectionMap(this.name).size;
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

  async _writeOne(record) {
    try {
      const db = await openDb();
      const tx = db.transaction(RECORDS_STORE, "readwrite");
      tx.objectStore(RECORDS_STORE).put({ _key: `${this.name}:${record.id}`, collection: this.name, id: record.id, value: record });
      await txDone(tx);
    } catch (e) { reportPersistError(this.name, e); }
  }

  async _writeMany(records) {
    if (!records.length) return;
    try {
      const db = await openDb();
      const tx = db.transaction(RECORDS_STORE, "readwrite");
      const store = tx.objectStore(RECORDS_STORE);
      for (const r of records) store.put({ _key: `${this.name}:${r.id}`, collection: this.name, id: r.id, value: r });
      await txDone(tx);
    } catch (e) { reportPersistError(this.name, e); }
  }

  async _deleteOne(id) {
    try {
      const db = await openDb();
      const tx = db.transaction(RECORDS_STORE, "readwrite");
      tx.objectStore(RECORDS_STORE).delete(`${this.name}:${id}`);
      await txDone(tx);
    } catch (e) { reportPersistError(this.name, e); }
  }
}

/** A single-value slot (e.g. app settings / meta), same reactive semantics. */
export class Value {
  constructor(name, fallback = null) {
    this.name = name;
    this.fallback = fallback;
    if (!registry.has(name)) registry.set(name, { kind: "value", fallback });
  }
  get() {
    return valueCache.has(this.name) ? valueCache.get(this.name) : this.fallback;
  }
  set(v) {
    valueCache.set(this.name, v);
    this._write(v);
    emit(this.name);
    if (channel) channel.postMessage({ collection: this.name });
  }
  subscribe(fn) {
    if (!listeners.has(this.name)) listeners.set(this.name, new Set());
    listeners.get(this.name).add(fn);
    return () => listeners.get(this.name)?.delete(fn);
  }
  async _write(v) {
    try {
      const db = await openDb();
      const tx = db.transaction(VALUES_STORE, "readwrite");
      tx.objectStore(VALUES_STORE).put({ name: this.name, value: v });
      await txDone(tx);
    } catch (e) { reportPersistError(this.name, e); }
  }
}
