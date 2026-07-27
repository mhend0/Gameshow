// The Wheel of Fortune puzzle board — one renderer, used everywhere.
//
// The library preview, the editor and the live TV all build the board through
// this component, so a puzzle looks identical wherever it appears and there is a
// single place to evolve the look.
//
// Reveal is driven by *state*, not by events: you hand it the set of letters
// that have been called and it works out which tiles still need to turn. That
// makes it idempotent — a dropped message, a reloaded window or a late-joining
// TV all self-correct the next time the set is applied, which is the same
// contract the Jeopardy console relies on.

import { el } from "./ui.js";
import { BOARD_ROWS, BOARD_COLS, ROW_SPANS, layoutPuzzle, isLetter } from "../core/wheel.js";

/** ms between consecutive tiles of the same letter turning — the show's cadence. */
const STAGGER = 150;
/** ms for one tile's flip. */
const FLIP_MS = 420;

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.revealed]   Start with every letter showing (previews).
 * @param {boolean} [opts.compact]    Tighter chrome for small previews.
 * @param {boolean} [opts.showCategory]  Render the category plaque (default true).
 * @param {(info:{letter:string,count:number})=>void} [opts.onRevealTile]  Fired per tile as it turns.
 */
export function createPuzzleBoard(opts = {}) {
  const { revealed: startRevealed = false, compact = false, showCategory = true } = opts;
  ensureStyles();

  const grid = el("div", { class: "wpb-grid" });
  const category = el("div", { class: "wpb-cat" }, [el("span", { class: "wpb-cat-text" })]);
  const frame = el("div", { class: `wpb ${compact ? "compact" : ""}` }, [
    el("div", { class: "wpb-frame" }, [grid]),
    showCategory ? category : null,
  ].filter(Boolean));

  /** @type {import("../core/wheel.js").PuzzleLayout|null} */
  let layout = null;
  /** cell elements keyed "row,col" */
  let cellEls = new Map();
  /** letters currently face-up on the board */
  let shown = new Set();
  /** individually uncovered tiles, as "row,col" (toss-ups) */
  let shownCells = new Set();
  let timers = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /** Rebuild the grid for a puzzle. Everything starts hidden unless `revealed`. */
  function setPuzzle(puzzle, { revealed = startRevealed } = {}) {
    clearTimers();
    layout = layoutPuzzle(puzzle && puzzle.answer);
    setCategory((puzzle && puzzle.category) || "");
    grid.innerHTML = "";
    cellEls = new Map();
    shown = new Set();
    shownCells = new Set();

    frame.classList.toggle("invalid", !layout.ok);
    frame.classList.remove("solved", "nudge");

    for (let r = 0; r < BOARD_ROWS; r++) {
      const span = ROW_SPANS[r];
      for (let c = 0; c < BOARD_COLS; c++) {
        const usable = c >= span.start && c < span.start + span.cap;
        const cell = layout.ok ? layout.grid[r][c] : null;
        if (!cell) {
          grid.appendChild(el("div", { class: `wpb-cell ${usable ? "gap" : "void"}` }));
          continue;
        }
        // A tile is a two-faced trilon: a blank front, the character behind it.
        const node = el("div", {
          class: `wpb-cell tile ${cell.letter ? "letter" : "punct"}`,
          dataset: { ch: cell.ch, row: String(r), col: String(c) },
        }, [
          el("div", { class: "wpb-flip" }, [
            el("div", { class: "wpb-face front" }),
            el("div", { class: "wpb-face back" }, [el("span", { text: cell.ch })]),
          ]),
        ]);
        // Punctuation and digits are never hidden — the show prints them up front.
        if (!cell.letter) node.classList.add("open");
        grid.appendChild(node);
        cellEls.set(`${r},${c}`, node);
      }
    }
    if (revealed) revealAll({ animate: false });
    return layout;
  }

  function setCategory(text) {
    const t = String(text || "").trim();
    category.querySelector(".wpb-cat-text").textContent = t || "—";
    category.classList.toggle("empty", !t);
  }

  /** Tiles holding `letter`, in reading order. */
  function tilesFor(letter) {
    if (!layout || !layout.ok) return [];
    return layout.cells
      .filter((c) => c.ch === letter)
      .map((c) => cellEls.get(`${c.row},${c.col}`))
      .filter(Boolean);
  }

  function turnTile(node, delay) {
    if (!delay) { node.classList.add("open", "just"); timers.push(setTimeout(() => node.classList.remove("just"), FLIP_MS + 260)); return; }
    timers.push(setTimeout(() => {
      node.classList.add("open", "just");
      timers.push(setTimeout(() => node.classList.remove("just"), FLIP_MS + 260));
    }, delay));
  }

  /**
   * Bring the board in line with what has been uncovered.
   *
   * Two independent sources, because the show has two: calling a letter turns
   * every tile of that letter at once, while a toss-up uncovers scattered
   * individual tiles. A tile is face-up if *either* says so, and this stays a
   * pure function of those sets — so a dropped message or a reloaded window
   * self-corrects the next time it runs.
   *
   * @param {Set<string>|string[]} called   Letters called.
   * @param {{animate?:boolean, cells?:Set<string>|string[]}} [o]
   *        `cells` holds "row,col" keys for individually uncovered tiles.
   * @returns {number} how many tiles turned (0 when already in sync).
   */
  function applyCalled(called, { animate = true, cells } = {}) {
    const want = new Set([...called].map((L) => String(L).toUpperCase()).filter(isLetter));
    const wantCells = new Set(cells ? [...cells] : []);
    let turned = 0;

    // Newly called letters turn over together, staggered like the show.
    for (const L of want) {
      if (shown.has(L)) continue;
      shown.add(L);
      tilesFor(L).forEach((node, i) => { turnTile(node, animate ? i * STAGGER : 0); turned++; });
    }
    // Anything no longer called (a reset, or the host undoing a call) goes back,
    // unless it was also uncovered as an individual tile.
    for (const L of [...shown]) {
      if (want.has(L)) continue;
      shown.delete(L);
      tilesFor(L).forEach((node) => {
        if (!wantCells.has(`${node.dataset.row},${node.dataset.col}`)) node.classList.remove("open", "just");
      });
    }
    // Individual tiles.
    for (const key of wantCells) {
      const node = cellEls.get(key);
      if (!node || shownCells.has(key)) continue;
      shownCells.add(key);
      if (!node.classList.contains("open")) { turnTile(node, 0); turned++; }
    }
    for (const key of [...shownCells]) {
      if (wantCells.has(key)) continue;
      shownCells.delete(key);
      const node = cellEls.get(key);
      const L = node && node.dataset.ch;
      if (node && !want.has(L)) node.classList.remove("open", "just");
    }
    return turned;
  }

  /**
   * Show the whole answer — the solve.
   * `celebrate` lights the board's gold halo; previews that start fully revealed
   * shouldn't wear it, or every card on the library page looks like a win.
   */
  function revealAll({ animate = true, celebrate = animate } = {}) {
    if (!layout || !layout.ok) return 0;
    if (celebrate) frame.classList.add("solved");
    const all = new Set(layout.cells.filter((c) => c.letter).map((c) => c.ch));
    const pending = [...all].filter((L) => !shown.has(L));
    if (!pending.length) return 0;
    // Solving turns the remaining tiles left-to-right across the whole board,
    // not letter-by-letter — it should read as one sweep.
    const nodes = layout.cells
      .filter((c) => c.letter && pending.includes(c.ch))
      .map((c) => cellEls.get(`${c.row},${c.col}`))
      .filter(Boolean);
    pending.forEach((L) => shown.add(L));
    nodes.forEach((node, i) => turnTile(node, animate ? i * 70 : 0));
    if (celebrate) frame.classList.add("solved");
    return nodes.length;
  }

  /** A wrong call: the board shrugs. */
  function nudge() {
    frame.classList.remove("nudge");
    void frame.offsetWidth;                 // restart the animation
    frame.classList.add("nudge");
  }

  /** Highlight the tiles a letter would fill (host-side hinting). */
  function hint(letter) {
    grid.querySelectorAll(".wpb-cell.hint").forEach((n) => n.classList.remove("hint"));
    if (!letter) return;
    tilesFor(String(letter).toUpperCase()).forEach((n) => { if (!n.classList.contains("open")) n.classList.add("hint"); });
  }

  function destroy() { clearTimers(); frame.remove(); }

  return {
    el: frame, grid,
    setPuzzle, setCategory, applyCalled, revealAll, nudge, hint, destroy,
    get layout() { return layout; },
    get shown() { return new Set(shown); },
  };
}

/**
 * One-shot static board, for cards and previews where nothing changes.
 * @returns {HTMLElement}
 */
export function renderPuzzleBoard(puzzle, opts = {}) {
  const board = createPuzzleBoard({ ...opts, revealed: opts.revealed !== false });
  board.setPuzzle(puzzle);
  return board.el;
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  const css = `
  .wpb{ container-type:inline-size; width:100%; display:flex; flex-direction:column; align-items:center; gap:2.2cqw; }
  .wpb-frame{
    width:100%; padding:1.5cqw; border-radius:1.6cqw;
    background:linear-gradient(180deg,#12352a,#07231b 60%,#05170f);
    box-shadow:0 0 0 .35cqw #c9a24a, 0 0 0 .8cqw #12352a, 0 2cqw 4cqw -1.4cqw rgba(0,0,0,.8),
      inset 0 .2cqw .6cqw rgba(255,255,255,.08);
  }
  .wpb-grid{ display:grid; grid-template-columns:repeat(${BOARD_COLS},1fr); gap:.42cqw; }

  .wpb-cell{ position:relative; aspect-ratio:3/4; border-radius:.35cqw; }
  /* positions the board doesn't use: the corner blocks and the gaps between words */
  .wpb-cell.void{ background:transparent; }
  .wpb-cell.gap{ background:linear-gradient(180deg,#164a3a,#0d3225); box-shadow:inset 0 0 0 .1cqw rgba(255,255,255,.05); }

  /* a tile is a trilon: blank white front, character on the back */
  .wpb-cell.tile{ perspective:40cqw; }
  .wpb-flip{ position:absolute; inset:0; transform-style:preserve-3d;
    transition:transform ${FLIP_MS}ms cubic-bezier(.3,.7,.3,1); }
  .wpb-cell.open .wpb-flip{ transform:rotateY(180deg); }
  .wpb-face{ position:absolute; inset:0; backface-visibility:hidden; border-radius:.35cqw;
    display:grid; place-items:center; overflow:hidden; }
  .wpb-face.front{ background:linear-gradient(180deg,#fdfdfb,#e6e7e2); box-shadow:inset 0 0 0 .1cqw rgba(0,0,0,.16); }
  .wpb-face.back{ transform:rotateY(180deg); background:linear-gradient(180deg,#fdfdfb,#eceded);
    box-shadow:inset 0 0 0 .1cqw rgba(0,0,0,.16); }
  .wpb-face.back span{
    font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; font-weight:700;
    font-size:5.1cqw; line-height:1; color:#0d1117; letter-spacing:0;
  }
  /* punctuation is printed from the start, so it never reads as a hidden letter */
  .wpb-cell.punct .wpb-face.back span{ font-weight:600; }

  /* the flash as a tile lands, plus a soft glow that fades out */
  .wpb-cell.just .wpb-face.back{ animation:wpbLand ${FLIP_MS + 260}ms var(--ease,ease-out); }
  @keyframes wpbLand{
    0%,45%{ filter:brightness(1); box-shadow:inset 0 0 0 .1cqw rgba(0,0,0,.16); }
    58%{ filter:brightness(1.35); box-shadow:inset 0 0 0 .2cqw #ffd76a, 0 0 2.4cqw rgba(255,215,106,.85); }
    100%{ filter:brightness(1); box-shadow:inset 0 0 0 .1cqw rgba(0,0,0,.16); }
  }
  .wpb-cell.hint .wpb-face.front{ background:linear-gradient(180deg,#fff6cf,#ffe89a);
    box-shadow:inset 0 0 0 .2cqw #ffcf5c; }

  /* category plaque under the board */
  .wpb-cat{
    min-width:38%; max-width:92%; padding:.9cqw 3cqw; border-radius:1cqw; text-align:center;
    background:linear-gradient(180deg,#1c4f9c,#0d2f6b); box-shadow:0 0 0 .25cqw #c9a24a, 0 1cqw 2cqw -.6cqw rgba(0,0,0,.7);
  }
  .wpb-cat-text{ font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:#fff;
    font-size:2.5cqw; line-height:1.25; }
  .wpb-cat.empty .wpb-cat-text{ color:rgba(255,255,255,.45); }

  .wpb.compact .wpb-frame{ padding:1cqw; box-shadow:0 0 0 .3cqw #c9a24a, 0 0 0 .6cqw #12352a; }
  .wpb.compact .wpb-cat{ padding:.7cqw 2cqw; }

  /* an answer that can't be laid out: show the frame greyed rather than blank */
  .wpb.invalid .wpb-frame{ filter:grayscale(.6) brightness(.75); }

  .wpb.nudge .wpb-frame{ animation:wpbNudge .42s var(--ease,ease-out); }
  @keyframes wpbNudge{ 0%,100%{transform:none} 22%{transform:translateX(-.8cqw)} 62%{transform:translateX(.6cqw)} }

  .wpb.solved .wpb-frame{ box-shadow:0 0 0 .35cqw #ffd76a, 0 0 0 .8cqw #12352a,
    0 0 6cqw rgba(255,215,106,.45), 0 2cqw 4cqw -1.4cqw rgba(0,0,0,.8); }

  @media (prefers-reduced-motion: reduce){
    .wpb-flip{ transition-duration:.001ms; }
    .wpb-cell.just .wpb-face.back{ animation:none; }
    .wpb.nudge .wpb-frame{ animation:none; }
  }
  `;
  document.head.appendChild(el("style", { id: "wpb-styles", html: css }));
}
