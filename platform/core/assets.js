// Asset system — keeps media portable.
//
// The platform never points at external file paths that could break when the
// project moves. Imported media is copied into the asset store and referenced by
// asset id. Legacy boards may still carry external `src` URLs; those can be
// "localised" (fetched into the store) on demand.
//
// Bytes live as real Blobs in their own IndexedDB object store (see
// `ASSET_BLOBS_STORE` in store.js), separate from the small metadata record
// (kind/name/mime/size) that goes through the normal `assets` Collection. That
// metadata is what's cached in memory at boot; the bytes are only ever fetched
// on demand, when something actually needs to render that asset.

import { AssetRepo } from "./repos.js";
import { makeAsset, makeMediaRef } from "./models.js";
import { getDb, StorageFullError, isQuotaError } from "./store.js";

const KIND_BY_PREFIX = { image: "image", audio: "audio", video: "video" };

/** Infer a media kind from a File/mime string. */
export function kindFromMime(mime = "") {
  const p = String(mime).split("/")[0];
  return KIND_BY_PREFIX[p] || "image";
}

/* --------------------------------------------------------- asset blob store */

const ASSET_BLOBS_STORE = "assetBlobs";

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

async function getBlob(id) {
  const db = await getDb();
  const row = await reqAsPromise(db.transaction(ASSET_BLOBS_STORE, "readonly").objectStore(ASSET_BLOBS_STORE).get(id));
  return row ? row.blob : null;
}

async function putBlob(id, blob) {
  try {
    const db = await getDb();
    const tx = db.transaction(ASSET_BLOBS_STORE, "readwrite");
    tx.objectStore(ASSET_BLOBS_STORE).put({ id, blob });
    await txDone(tx);
  } catch (e) {
    throw isQuotaError(e) ? new StorageFullError("assets") : e;
  }
}

async function deleteBlob(id) {
  const db = await getDb();
  const tx = db.transaction(ASSET_BLOBS_STORE, "readwrite");
  tx.objectStore(ASSET_BLOBS_STORE).delete(id);
  await txDone(tx);
}

// One-time upgrade path: asset metadata records written before this file stored
// bytes as Blobs still carry their bytes as a base64 `data:` URL on the record
// itself. Convert those to a real Blob the first time they're resolved, then
// drop `data` from the metadata so this only ever runs once per asset.
async function resolveBlob(meta) {
  const blob = await getBlob(meta.id);
  if (blob) return blob;
  if (typeof meta.data === "string" && meta.data.startsWith("data:")) {
    try {
      const converted = await (await fetch(meta.data)).blob();
      await putBlob(meta.id, converted);
      const { data, ...rest } = meta;
      AssetRepo.put(rest);
      return converted;
    } catch {
      return null;
    }
  }
  return null;
}

/** Bytes currently used by stored assets (their metadata's own `size` field). */
export function assetStorageUsage() {
  let bytes = 0;
  for (const a of AssetRepo.list()) bytes += a.size || 0;
  return bytes;
}

/* ---------------------------------------------------------------------------
   Image budget. A phone photo is 3–8 MB, so photos are resized and re-encoded
   on import — 1400px is still sharper than any TV will show a clue at.
--------------------------------------------------------------------------- */
const MAX_EDGE = 1400;
const JPEG_Q = 0.82;
const WEBP_Q = 0.85;

let _webp = null;
function webpSupported() {
  if (_webp === null) {
    try {
      const c = document.createElement("canvas"); c.width = c.height = 1;
      _webp = c.toDataURL("image/webp").startsWith("data:image/webp");
    } catch { _webp = false; }
  }
  return _webp;
}

async function decodeImage(src) {
  if (typeof src !== "string" && typeof createImageBitmap === "function") {
    try { return await createImageBitmap(src); } catch { /* fall through */ }
  }
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    if (typeof src !== "string") setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const canvasToBlob = (canvas, mime, q) => new Promise(res => canvas.toBlob(res, mime, q));

/**
 * Resize/re-encode an image so it fits the storage budget.
 * @param {string|Blob} src
 * @returns {Promise<{blob:Blob,mime:string,size:number,width:number,height:number}|null>}
 *          null when the original should be kept untouched.
 */
export async function compressImage(src, mime = "", originalBytes = 0) {
  if (/gif/i.test(mime)) return null;                    // never flatten an animation
  const keepsAlpha = /png|webp/i.test(mime);
  const outMime = keepsAlpha ? (webpSupported() ? "image/webp" : null) : "image/jpeg";
  if (!outMime) return null;                             // can't re-encode without losing alpha

  let bmp;
  try { bmp = await decodeImage(src); } catch { return null; }
  const w0 = bmp.width, h0 = bmp.height;
  if (!w0 || !h0) return null;

  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();

  const blob = await canvasToBlob(canvas, outMime, outMime === "image/webp" ? WEBP_Q : JPEG_Q);
  if (!blob) return null;
  // Already lean enough — leave it alone rather than re-compressing every pass.
  if (scale === 1 && originalBytes && blob.size >= originalBytes * 0.9) return null;
  return { blob, mime: outMime, size: blob.size, width: w, height: h };
}

/** Object URLs are created lazily, per asset, and cached so repeated renders of
 *  the same clue don't keep minting (and leaking) new ones. */
const urlCache = new Map(); // assetId -> objectURL

function forgetUrl(id) {
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
}

export const AssetService = {
  /**
   * Import a File into the portable asset store.
   * @param {File} file
   * @returns {Promise<import("./models.js").MediaRef>}
   */
  async importFile(file) {
    const kind = kindFromMime(file.type);
    let blob = file, mime = file.type, size = file.size || 0;
    if (kind === "image") {
      const small = await compressImage(file, file.type, file.size || 0);
      if (small) { blob = small.blob; mime = small.mime; size = small.size; }
    }
    const asset = makeAsset({ kind, name: file.name || "asset", mime, size });
    await putBlob(asset.id, blob);        // throws StorageFullError when full
    AssetRepo.put(asset);
    return makeMediaRef({ kind, assetId: asset.id, alt: file.name || "" });
  },

  /**
   * Shrink every image already in the store — the way back from a full store
   * without deleting anyone's clues.
   * @returns {Promise<{count:number, before:number, after:number}>}
   */
  async recompressAll() {
    const before = assetStorageUsage();
    let count = 0;
    for (const meta of AssetRepo.list()) {
      if (!meta || meta.kind !== "image") continue;
      const blob = await resolveBlob(meta);
      if (!blob) continue;
      let small = null;
      try { small = await compressImage(blob, meta.mime, blob.size); } catch { small = null; }
      if (small && small.size < blob.size) {
        await putBlob(meta.id, small.blob);
        forgetUrl(meta.id);
        AssetRepo.put({ ...meta, mime: small.mime, size: small.size });
        count++;
      }
    }
    return { count, before, after: assetStorageUsage() };
  },

  /**
   * Resolve a MediaRef to a renderable URL. Bytes are fetched from IndexedDB
   * on demand (and cached as an object URL) — nothing about a MediaRef is
   * resolvable synchronously any more, so every caller awaits this.
   * @param {import("./models.js").MediaRef} ref
   * @returns {Promise<{kind:string, url:string, alt:string}|null>}
   */
  async resolve(ref) {
    if (!ref) return null;
    if (ref.assetId) {
      const meta = AssetRepo.get(ref.assetId);
      if (!meta) return null;
      let url = urlCache.get(ref.assetId);
      if (!url) {
        const blob = await resolveBlob(meta);
        if (!blob) return null;
        url = URL.createObjectURL(blob);
        urlCache.set(ref.assetId, url);
      }
      return { kind: meta.kind, url, alt: ref.alt || meta.name || "" };
    }
    if (ref.src) return { kind: ref.kind || "image", url: ref.src, alt: ref.alt || "" };
    return null;
  },

  /**
   * Best-effort: pull an external `src` into the asset store for portability.
   * Returns a new asset-backed ref, or the original ref if the fetch is blocked
   * (e.g. cross-origin without CORS). Never throws.
   * @param {import("./models.js").MediaRef} ref
   */
  async localise(ref) {
    if (!ref || !ref.src || ref.assetId) return ref;
    try {
      const res = await fetch(ref.src, { mode: "cors" });
      if (!res.ok) return ref;
      const blob = await res.blob();
      const kind = kindFromMime(blob.type || "");
      const name = ref.src.split("/").pop() || "asset";
      const asset = makeAsset({ kind, name, mime: blob.type, size: blob.size });
      await putBlob(asset.id, blob);
      AssetRepo.put(asset);
      return makeMediaRef({ kind, assetId: asset.id, alt: ref.alt || "" });
    } catch {
      return ref; // stays external; still works while online
    }
  },

  /** Drop an asset's bytes and metadata together (not currently wired into any UI). */
  async remove(id) {
    forgetUrl(id);
    await deleteBlob(id);
    AssetRepo.remove(id);
  },
};

/**
 * Render a RichContent block into a container element (text + resolved media).
 * Media resolves asynchronously and is appended as each ref comes back, so the
 * element itself is returned — and can be inserted into the page — immediately.
 * @param {import("./models.js").RichContent} rc
 * @param {{maxMediaHeight?:string, textClass?:string}} [opts]
 * @returns {HTMLElement}
 */
export function renderRichContent(rc, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "gsp-rich";
  if (rc && rc.text && rc.text.trim()) {
    const t = document.createElement("div");
    t.className = "gsp-rich-text " + (opts.textClass || "");
    t.textContent = rc.text;
    wrap.appendChild(t);
  }
  for (const ref of (rc && rc.media) || []) {
    AssetService.resolve(ref).then((r) => {
      if (!r) return;
      let node;
      if (r.kind === "image") {
        node = document.createElement("img");
        node.src = r.url; node.alt = r.alt || "";
      } else if (r.kind === "audio") {
        node = document.createElement("audio");
        node.src = r.url; node.controls = true;
      } else if (r.kind === "video") {
        node = document.createElement("video");
        node.src = r.url; node.controls = true;
      }
      if (node) {
        node.className = "gsp-rich-media";
        if (opts.maxMediaHeight && node.style) node.style.maxHeight = opts.maxMediaHeight;
        wrap.appendChild(node);
      }
    });
  }
  return wrap;
}
