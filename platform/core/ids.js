// Stable, collision-resistant identifiers for platform entities.
// Every persistent entity (board, category, clue, session, asset) carries an id
// generated here so it can be referenced, tagged and reused across the platform.

/**
 * Generate a globally-unique id, optionally namespaced by a short prefix
 * (e.g. `board`, `clue`) which keeps ids human-scannable in storage & logs.
 * @param {string} [prefix]
 * @returns {string}
 */
export function newId(prefix = "") {
  const uuid =
    (globalThis.crypto && typeof crypto.randomUUID === "function")
      ? crypto.randomUUID()
      : fallbackUuid();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/** Short, URL/DOM-safe id for cases where a full UUID is overkill (8 chars). */
export function shortId(prefix = "") {
  const s = newId().replace(/-/g, "").slice(0, 8);
  return prefix ? `${prefix}_${s}` : s;
}

function fallbackUuid() {
  // RFC4122-ish fallback for the rare browser without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
