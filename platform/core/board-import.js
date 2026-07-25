// Importer: JeopardyLabs HTML export  →  structured Board model.
//
// The legacy boards (board1.html / board2.html) are opaque JeopardyLabs exports.
// This parses their DOM into our data model so the content survives into the
// platform's editor / library / sessions. Images are resolved to absolute URLs
// and captured as *external* media refs; a later "localise assets" pass can pull
// them into the portable asset store.

import { makeBoard, makeCategory, makeClue, makeRichContent, makeMediaRef } from "./models.js";

const DEFAULT_BASE = "https://jeopardylabs.com";

/**
 * Convert HTML text into a Board.
 * @param {string} html
 * @param {{name?:string, base?:string}} [opts]
 * @returns {import("./models.js").Board}
 */
export function parseJeopardyLabsHtml(html, opts = {}) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base =
    opts.base ||
    doc.querySelector("base")?.getAttribute("href") ||
    DEFAULT_BASE;

  // Category names, left-to-right. (JeopardyLabs uses `.grid-row-cats`.)
  const catCells = [...doc.querySelectorAll(".grid-row-cats .cat-cell, .grid-row-categories .cat-cell")];
  const categoryNames = catCells.map((el) => cleanText(el.textContent) || "Category");

  // Build one category per column, collecting clues by column index.
  const categories = categoryNames.map((name) => makeCategory({ name, clues: [] }));
  if (!categories.length) return makeBoard({ name: opts.name || "Imported Board" });

  const cells = [...doc.querySelectorAll(".grid-row-questions .grid-cell")];
  for (const cell of cells) {
    const col = Number(cell.getAttribute("data-col"));
    if (Number.isNaN(col) || !categories[col]) continue;
    const row = Number(cell.getAttribute("data-row"));       // 1-based (row 0 = categories)
    const rowIndex = Number.isNaN(row) ? categories[col].clues.length : row - 1;

    const valueEl = cell.querySelector(".cell-inner[data-category], .cell-inner");
    const value = parseInt((valueEl && valueEl.textContent) || "0", 10) || 0;

    // JeopardyLabs: `.front.answer` is the shown clue, `.back.question` the answer.
    const front = cell.querySelector(".front.answer") || cell.querySelector(".answer");
    const back = cell.querySelector(".back.question") || cell.querySelector(".question");

    const prompt = richFromNode(front, base);
    const response = richFromNode(back, base);
    const dailyDouble = /daily.?double/i.test(cell.className) ||
      /daily.?double/i.test((front && front.textContent) || "");

    const clue = makeClue({ value, prompt, response, dailyDouble });
    clue._row = rowIndex;                                     // transient, stripped below
    categories[col].clues.push(clue);
  }

  // Empty source cells (unauthored clues) come through with value 0. Infer their
  // value from the row's ladder — the dominant non-zero value at that row index
  // across all categories — so every tile shows a sensible point value.
  const rowValue = inferRowValues(categories);
  for (const cat of categories) {
    for (const clue of cat.clues) {
      if (!clue.value && clue._row != null && rowValue[clue._row]) clue.value = rowValue[clue._row];
    }
    cat.clues.sort((a, b) => (a._row ?? a.value) - (b._row ?? b.value));
    for (const clue of cat.clues) delete clue._row;
  }

  return makeBoard({ name: opts.name || "Imported Board", categories });
}

/** Most common non-zero value at each row index, with a laddered fallback. */
function inferRowValues(categories) {
  const byRow = {};
  for (const cat of categories) {
    for (const clue of cat.clues) {
      if (clue.value && clue._row != null) {
        (byRow[clue._row] = byRow[clue._row] || {})[clue.value] =
          (byRow[clue._row][clue.value] || 0) + 1;
      }
    }
  }
  const rowValue = {};
  for (const [row, counts] of Object.entries(byRow)) {
    rowValue[row] = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
  }
  // Fill any row with no data at all using the step implied by neighbours.
  const rows = categories.reduce((m, c) => Math.max(m, c.clues.length), 0);
  const known = Object.keys(rowValue).map(Number).sort((a, b) => a - b);
  const step = known.length >= 2 ? (rowValue[known[1]] - rowValue[known[0]]) || 100 : 100;
  const base = known.length ? rowValue[known[0]] - known[0] * step : 100;
  for (let r = 0; r < rows; r++) if (!rowValue[r]) rowValue[r] = base + r * step || (r + 1) * 100;
  return rowValue;
}

/** Extract text + media from a front/back node into RichContent. */
function richFromNode(node, base) {
  if (!node) return makeRichContent();
  const media = [];

  node.querySelectorAll("img").forEach((img) => {
    const src = absolutise(img.getAttribute("src"), base);
    if (src) media.push(makeMediaRef({ kind: "image", src, alt: img.getAttribute("alt") || "" }));
  });
  node.querySelectorAll("audio source, audio").forEach((a) => {
    const src = absolutise(a.getAttribute("src"), base);
    if (src) media.push(makeMediaRef({ kind: "audio", src }));
  });
  node.querySelectorAll("video source, video").forEach((v) => {
    const src = absolutise(v.getAttribute("src"), base);
    if (src) media.push(makeMediaRef({ kind: "video", src }));
  });

  // Text: preserve line breaks that <br> / block elements imply, drop media nodes.
  const clone = node.cloneNode(true);
  clone.querySelectorAll("img, audio, video, source").forEach((n) => n.remove());
  clone.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  clone.querySelectorAll("p, div").forEach((n) => n.append("\n"));
  const text = cleanText(clone.textContent);

  return makeRichContent(text, media);
}

function absolutise(src, base) {
  if (!src) return "";
  if (/^(https?:|data:)/i.test(src)) return src;
  try {
    return new URL(src, base.endsWith("/") ? base : base + "/").href;
  } catch {
    return src;
  }
}

function cleanText(s) {
  return String(s || "")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Fetch a legacy board file and parse it. Convenience for seeding.
 * @param {string} url
 * @param {string} name
 */
export async function importBoardFromUrl(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const html = await res.text();
  return parseJeopardyLabsHtml(html, { name });
}
