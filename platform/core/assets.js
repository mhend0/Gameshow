// Asset system — keeps media portable.
//
// The platform never points at external file paths that could break when the
// project moves. Imported media is copied into the asset store as a data URL and
// referenced by asset id. Legacy boards may still carry external `src` URLs; those
// can be "localised" (fetched into the store) on demand.

import { AssetRepo } from "./repos.js";
import { makeAsset, makeMediaRef } from "./models.js";

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

export const AssetService = {
  /**
   * Import a File into the portable asset store.
   * @param {File} file
   * @returns {Promise<import("./models.js").MediaRef>}
   */
  async importFile(file) {
    const data = await fileToDataUrl(file);
    const kind = kindFromMime(file.type);
    const asset = makeAsset({ kind, name: file.name || "asset", mime: file.type, data, size: file.size || 0 });
    AssetRepo.put(asset);
    return makeMediaRef({ kind, assetId: asset.id, alt: file.name || "" });
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
