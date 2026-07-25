// Reusable Jeopardy board grid renderer.
//
// Draws a board from the data model as a categories header row + value tiles.
// Used by the library preview, the editor, and (later) the live console — so the
// board looks identical everywhere and there is a single place to evolve its look.

import { el } from "./ui.js";

/**
 * @param {import("../core/models.js").Board} board
 * @param {Object} [opts]
 * @param {(clue, ctx)=>void} [opts.onClueClick]  ctx = {category, clue, catIndex, row}
 * @param {Set<string>} [opts.usedClueIds]        Clue ids to render as spent/greyed.
 * @param {boolean} [opts.showDailyDouble]        Reveal DD markers (host/editor only).
 * @param {boolean} [opts.interactive]            Hover/pointer affordances.
 * @returns {HTMLElement}
 */
export function renderBoardGrid(board, opts = {}) {
  const { onClueClick, usedClueIds, showDailyDouble = false, interactive = false } = opts;
  ensureStyles();

  const cats = board.categories || [];
  const rows = cats.reduce((m, c) => Math.max(m, c.clues.length), 0);

  const grid = el("div", { class: `gsp-board ${interactive ? "interactive" : ""}` });
  grid.style.setProperty("--cols", String(cats.length || 1));

  // Header row.
  for (const cat of cats) {
    grid.appendChild(el("div", { class: "gsp-cat" }, [el("span", { text: cat.name || "—" })]));
  }
  if (!cats.length) grid.appendChild(el("div", { class: "gsp-cat", text: "Empty board" }));

  // Value tiles, row by row.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cats.length; c++) {
      const clue = cats[c].clues[r];
      if (!clue) { grid.appendChild(el("div", { class: "gsp-tile empty" })); continue; }
      const used = usedClueIds && usedClueIds.has(clue.id);
      const tile = el("div", {
        class: `gsp-tile ${used ? "used" : ""} ${clue.dailyDouble && showDailyDouble ? "dd" : ""}`,
        dataset: { clueId: clue.id },
      }, [
        el("span", { class: "gsp-val", text: String(clue.value) }),
        clue.dailyDouble && showDailyDouble ? el("span", { class: "gsp-dd-badge", text: "DD" }) : null,
      ].filter(Boolean));
      if (onClueClick) tile.addEventListener("click", () => onClueClick(clue, { category: cats[c], catIndex: c, row: r }));
      grid.appendChild(tile);
    }
  }
  return grid;
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  const css = `
  .gsp-board{display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:8px;width:100%}
  .gsp-cat{background:linear-gradient(180deg,var(--accent,#3b6fff),color-mix(in srgb,var(--accent,#3b6fff) 60%,#000));
    color:#fff;font-weight:800;text-transform:uppercase;letter-spacing:.02em;
    display:grid;place-items:center;text-align:center;padding:12px 8px;border-radius:10px;
    font-size:clamp(11px,1.1vw,15px);line-height:1.15;min-height:52px;box-shadow:var(--shadow-1)}
  .gsp-tile{position:relative;display:grid;place-items:center;min-height:52px;border-radius:10px;
    background:linear-gradient(180deg,var(--bg-3),var(--bg-2));border:1px solid var(--line-soft);
    color:var(--gold);font-weight:800;font-size:clamp(15px,1.7vw,26px);transition:all .16s var(--ease)}
  .gsp-tile.empty{background:transparent;border:1px dashed var(--line-soft)}
  .gsp-board.interactive .gsp-tile:not(.empty){cursor:pointer}
  .gsp-board.interactive .gsp-tile:not(.empty):hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent,#3b6fff) 60%,var(--line));color:#fff;box-shadow:var(--shadow-2)}
  .gsp-tile.used{color:var(--text-2);opacity:.35}
  .gsp-tile.dd{outline:2px solid var(--gold);outline-offset:-2px}
  .gsp-dd-badge{position:absolute;top:4px;right:6px;font-size:9px;color:var(--gold);letter-spacing:.05em}
  .gsp-val{pointer-events:none}
  `;
  document.head.appendChild(el("style", { html: css }));
}
