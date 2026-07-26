// Asset system — keeps media portable.
//
// The platform never points at external file paths that could break when the
// project moves. Imported media is copied into the asset store as a data URL and
// referenced by asset id. Legacy boards may still carry external `src` URLs; those
// can be "localised" (fetched into the store) on demand.

import { AssetRepo } from "./repos.js";
import { makeAsset, makeMediaRef } from "./models.js";
import { storageUsage } from "./store.js";

const KIND_BY_PREFIX = { image: "image", audio: "audio", video: "video" };

/** Infer a media kind from a File/mime string. */
export function kindFromMime(mime = "") {
  const p = String(mime).split("/")[0];
  return KIND_BY_PREFIX[p] || "image";
}

/** Read a File into a data URL. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------------------------
   Image budget. Assets live in localStorage as data URLs, and the browser caps
   that at a few MB per site. A phone photo is 3–8 MB and base64 adds ~33% on
   top, so a handful of straight-from-the-camera pictures fills the whole store
   and every later save fails. Photos are therefore resized and re-encoded on
   import — 1400px is still sharper than any TV will show a clue at.
--------------------------------------------------------------------------- */
const MAX_EDGE = 1400;
const JPEG_Q = 0.82;
const WEBP_Q = 0.85;

/** Bytes a data URL actually occupies once base64 is decoded. */
export function dataUrlBytes(d) {
  const s = String(d || ""), i = s.indexOf(",");
  if (i < 0) return s.length;
  return Math.floor((s.length - i - 1) * 3 / 4);
}

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
 * @returns {Promise<{data:string,mime:string,size:number,width:number,height:number}|null>}
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
  const data = await blobToDataUrl(blob);
  return { data, mime: outMime, size: blob.size, width: w, height: h };
}

export const AssetService = {
  /**
   * Import a File into the portable asset store.
   * @param {File} file
   * @returns {Promise<import("./models.js").MediaRef>}
   */
  async importFile(file) {
    const kind = kindFromMime(file.type);
    let data = null, mime = file.type, size = file.size || 0;
    if (kind === "image") {
      const small = await compressImage(file, file.type, file.size || 0);
      if (small) { data = small.data; mime = small.mime; size = small.size; }
    }
    if (!data) data = await fileToDataUrl(file);
    const asset = makeAsset({ kind, name: file.name || "asset", mime, data, size });
    AssetRepo.put(asset);                                // throws StorageFullError when full
    return makeMediaRef({ kind, assetId: asset.id, alt: file.name || "" });
  },

  /**
   * Shrink every image already in the store — the way back from a full store
   * without deleting anyone's clues.
   * @returns {Promise<{count:number, before:number, after:number}>}
   */
  async recompressAll() {
    const before = storageUsage();
    let count = 0;
    for (const a of AssetRepo.list()) {
      if (!a || a.kind !== "image") continue;
      const d = String(a.data || "");
      if (!d.startsWith("data:")) continue;
      const mime = d.slice(5, d.indexOf(";") > 0 ? d.indexOf(";") : d.indexOf(",")) || a.mime || "";
      const wasBytes = dataUrlBytes(d);
      let small = null;
      try { small = await compressImage(d, mime, wasBytes); } catch { small = null; }
      if (small && dataUrlBytes(small.data) < wasBytes) {
        AssetRepo.put({ ...a, data: small.data, mime: small.mime, size: small.size });
        count++;
      }
    }
    return { count, before, after: storageUsage() };
  },

  /**
   * Resolve a MediaRef to a renderable URL.
   * @param {import("./models.js").MediaRef} ref
   * @returns {{kind:string, url:string, alt:string}|null}
   */
  resolve(ref) {
    if (!ref) return null;
    if (ref.assetId) {
      const a = AssetRepo.get(ref.assetId);
      if (a) return { kind: a.kind, url: a.data, alt: ref.alt || a.name || "" };
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
      const data = await blobToDataUrl(blob);
      const kind = kindFromMime(blob.type || "");
      const name = ref.src.split("/").pop() || "asset";
      const asset = makeAsset({ kind, name, mime: blob.type, data, size: blob.size });
      AssetRepo.put(asset);
      return makeMediaRef({ kind, assetId: asset.id, alt: ref.alt || "" });
    } catch {
      return ref; // stays external; still works while online
    }
  },
};

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Render a RichContent block into a container element (text + resolved media).
 * Shared by editor previews, the library and the live board.
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
    const r = AssetService.resolve(ref);
    if (!r) continue;
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
  }
  return wrap;
}
