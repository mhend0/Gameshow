// The Wheel of Fortune puzzle library, as a mountable panel.
//
// Lives here rather than inside a page so the game's settings screen and the
// standalone /puzzles.html URL are the same code. Mount it into any container:
//
//   const panel = mountPuzzles(document.getElementById("host"));
//   panel.destroy();

import { PuzzleRepo, layoutPuzzle, normaliseAnswer, lettersIn } from "../../core/wheel.js";
import { createPuzzleBoard, renderPuzzleBoard } from "../puzzle-board.js";
import { el, toast, modal, confirmDialog, timeAgo } from "../ui.js";
import { ensureWheelSeeded } from "../../core/wheel-seed.js";

/**
 * @param {HTMLElement} root
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountPuzzles(root) {
  ensureStyles();
  const state = { query: "", category: "", favouritesOnly: false, sort: "updated" };

  const count = el("div", { class: "pp-count" });
  const search = el("input", { placeholder: "Search answers, categories & tags…", autocomplete: "off" });
  const favBtn = el("button", { class: "chip", text: "★ Favourites" });
  const sortSel = el("select", { class: "input" }, [
    el("option", { value: "updated", text: "Recently updated" }),
    el("option", { value: "created", text: "Newest" }),
    el("option", { value: "category", text: "Category" }),
    el("option", { value: "answer", text: "Answer (A–Z)" }),
    el("option", { value: "length", text: "Longest" }),
  ]);
  const catbar = el("div", { class: "pp-catbar" });
  const content = el("div");

  const newBtn = el("button", { class: "btn primary", text: "＋ New Puzzle" });
  const bulkBtn = el("button", { class: "btn", text: "⚡ Bulk add" });

  root.innerHTML = "";
  root.append(
    el("div", { class: "pp-head" }, [count, el("span", { class: "pp-spacer" }), bulkBtn, newBtn]),
    el("div", { class: "pp-toolbar" }, [
      el("div", { class: "search pp-search" }, [el("span", { text: "🔎" }), search]),
      favBtn,
      el("span", { class: "pp-spacer" }),
      el("label", { class: "field-label", style: { color: "var(--text-2)" }, text: "Sort" }),
      sortSel,
    ]),
    catbar,
    content,
  );

  /* ---------------------------------------------------------------- cards */
  function puzzleCard(puzzle) {
    const layout = layoutPuzzle(puzzle.answer);
    const fav = el("button", {
      class: `fav ${puzzle.meta?.favourite ? "on" : ""}`, html: puzzle.meta?.favourite ? "★" : "☆", title: "Favourite",
      onClick: (e) => { e.stopPropagation(); PuzzleRepo.toggleFavourite(puzzle.id); },
    });

    const card = el("div", { class: "puz-card card" }, [
      el("div", { class: "pc-preview" }, [renderPuzzleBoard(puzzle, { compact: true })]),
      el("div", { class: "pc-body" }, [
        el("div", { class: "pc-answer", text: puzzle.answer || "(empty)" }),
        el("div", { class: "pc-meta" }, [
          el("span", { class: "pc-cat", text: puzzle.category || "No category" }),
          el("span", { text: "·" }),
          el("span", { text: `${layout.ok ? layout.letterCount : lettersIn(puzzle.answer).size} letters` }),
          el("span", { text: "·" }),
          el("span", { text: timeAgo(puzzle.updatedAt) }),
        ]),
        layout.ok ? null : el("div", { class: "pc-warn", text: `⚠ ${layout.error}` }),
        (puzzle.meta?.tags || []).length
          ? el("div", { class: "pc-tags" }, puzzle.meta.tags.map((t) => el("span", { class: "pc-tag", text: t })))
          : null,
        el("div", { class: "pc-actions" }, [
          fav,
          el("span", { class: "pp-spacer" }),
          el("button", { class: "btn sm ghost", html: "⧉", title: "Duplicate", onClick: (e) => { e.stopPropagation(); PuzzleRepo.duplicate(puzzle.id); toast("Puzzle duplicated"); } }),
          el("button", { class: "btn sm ghost", html: "🗑", title: "Delete", onClick: (e) => { e.stopPropagation(); removePuzzle(puzzle); } }),
          el("button", { class: "btn sm primary", text: "Edit", onClick: (e) => { e.stopPropagation(); editPuzzle(puzzle); } }),
        ]),
      ].filter(Boolean)),
    ]);
    card.addEventListener("click", () => editPuzzle(puzzle));
    return card;
  }

  async function removePuzzle(puzzle) {
    const ok = await confirmDialog({
      title: "Delete puzzle?",
      message: `“${puzzle.answer}” will be removed, and dropped from any session that played it.`,
      confirmText: "Delete", danger: true,
    });
    if (ok) { PuzzleRepo.remove(puzzle.id); toast("Puzzle deleted"); }
  }

  /* --------------------------------------------------------------- editor */
  /**
   * The host types an answer and a category — nothing else. The board beside the
   * fields is the real renderer running the real layout engine, so what they
   * watch while typing is exactly what the TV will show.
   *
   * `puzzle` is null for a new one: nothing is written to the library until Save,
   * so cancelling out never leaves an empty puzzle behind.
   */
  function editPuzzle(puzzle) {
    const existing = puzzle || null;
    const board = createPuzzleBoard({ revealed: true });
    const status = el("div", { class: "ed-status" });
    const counts = el("div", { class: "ed-counts" });

    const answerInput = el("textarea", { class: "input answer", value: existing?.answer || "", placeholder: "THE ANSWER ON THE BOARD", rows: 3, spellcheck: "false" });
    const catInput = el("input", { class: "input", value: existing?.category || "", placeholder: "e.g. Phrase, Thing, Before & After", list: "ppCatList" });
    const catList = el("datalist", { id: "ppCatList" }, PuzzleRepo.allCategories().map((c) => el("option", { value: c })));
    const tagsInput = el("input", { class: "input", value: (existing?.meta?.tags || []).join(", "), placeholder: "comma-separated" });
    const notesInput = el("textarea", { class: "input", value: existing?.meta?.notes || "", placeholder: "Host notes (never shown on the TV)", rows: 2 });

    const refresh = () => {
      const answer = answerInput.value;
      const layout = board.setPuzzle({ answer, category: catInput.value });
      if (!answer.trim()) {
        status.className = "ed-status";
        status.textContent = "Type an answer to build the board.";
      } else if (layout.ok) {
        status.className = "ed-status ok";
        status.textContent = `✓ Fits on ${layout.lines.length} line${layout.lines.length === 1 ? "" : "s"}`;
      } else {
        status.className = "ed-status bad";
        status.textContent = `⚠ ${layout.error}`;
      }
      const uniq = lettersIn(answer);
      counts.innerHTML = layout.ok
        ? `<span><b>${layout.letterCount}</b> tiles</span>
           <span><b>${uniq.size}</b> different letters</span>
           <span><b>${normaliseAnswer(answer).split(" ").length}</b> words</span>`
        : "";
      save.disabled = !layout.ok;
    };

    answerInput.addEventListener("input", refresh);
    catInput.addEventListener("input", refresh);

    const body = el("div", { class: "ed-grid" }, [
      el("div", { class: "ed-col" }, [
        el("div", { class: "ed-preview" }, [board.el]),
        status,
        counts,
      ]),
      el("div", { class: "ed-fields" }, [
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Answer" }), answerInput]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Category" }), catInput, catList]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Tags" }), tagsInput]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Notes" }), notesInput]),
      ]),
      el("p", { class: "ed-hint", text: "Lines are wrapped, balanced and centred for you — there's no tile placement to do." }),
    ]);

    const save = el("button", { class: "btn primary", text: existing ? "Save puzzle" : "Add puzzle" });
    const m = modal({
      title: existing ? "Edit puzzle" : "New puzzle",
      wide: true, body,
      actions: [el("button", { class: "btn ghost", text: "Cancel", onClick: () => m.close() }), save],
      onClose: () => board.destroy(),
    });

    save.addEventListener("click", () => {
      const patch = {
        answer: answerInput.value,
        category: catInput.value,
        meta: {
          ...(existing?.meta || {}),
          tags: tagsInput.value.split(",").map((s) => s.trim()).filter(Boolean),
          notes: notesInput.value,
        },
      };
      if (existing) PuzzleRepo.update(existing.id, patch);
      else PuzzleRepo.create(patch);
      m.close();
      toast(existing ? "Puzzle saved" : "Puzzle added");
    });
    answerInput.addEventListener("keydown", (e) => {
      // ⌘/Ctrl+Enter saves — a night of puzzle entry shouldn't need the mouse.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !save.disabled) { e.preventDefault(); save.click(); }
    });

    refresh();
    setTimeout(() => { answerInput.focus(); answerInput.setSelectionRange(answerInput.value.length, answerInput.value.length); }, 40);
  }

  const newPuzzle = () => editPuzzle(null);

  /* ------------------------------------------------------------ bulk add */
  /** Prepping a night means typing a lot of puzzles; one box beats twenty modals. */
  function bulkAdd() {
    const area = el("textarea", {
      class: "input bulk-area",
      placeholder: "One puzzle per line:\n\nPHRASE | A PENNY SAVED IS A PENNY EARNED\nTHING | THE KITCHEN SINK\n\n…or leave the category off and set it below for all of them.",
    });
    const catInput = el("input", { class: "input", placeholder: "Category for lines without one" });
    const report = el("div", { class: "ed-status" });

    const parse = () => area.value.split("\n").map((raw) => {
      const line = raw.trim();
      if (!line) return null;
      const bar = line.indexOf("|");
      const category = bar >= 0 ? line.slice(0, bar).trim() : catInput.value.trim();
      const answer = bar >= 0 ? line.slice(bar + 1).trim() : line;
      if (!answer) return null;
      return { answer, category, layout: layoutPuzzle(answer) };
    }).filter(Boolean);

    const preview = () => {
      const rows = parse();
      const bad = rows.filter((r) => !r.layout.ok);
      report.className = `ed-status ${bad.length ? "bad" : rows.length ? "ok" : ""}`;
      report.textContent = !rows.length
        ? "Nothing to add yet."
        : bad.length
          ? `${rows.length - bad.length} ready · ${bad.length} won't fit the board and will be skipped`
          : `✓ ${rows.length} puzzle${rows.length === 1 ? "" : "s"} ready`;
      add.disabled = !rows.some((r) => r.layout.ok);
    };
    area.addEventListener("input", preview);
    catInput.addEventListener("input", preview);

    const add = el("button", { class: "btn primary", text: "Add puzzles" });
    const m = modal({
      title: "⚡ Bulk add puzzles", wide: true,
      body: el("div", { class: "ed-fields" }, [
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Puzzles" }), area]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Default category" }), catInput]),
        report,
      ]),
      actions: [el("button", { class: "btn ghost", text: "Cancel", onClick: () => m.close() }), add],
    });
    add.addEventListener("click", () => {
      const rows = parse().filter((r) => r.layout.ok);
      rows.forEach((r) => PuzzleRepo.create({ answer: r.answer, category: r.category }));
      m.close();
      toast(`Added ${rows.length} puzzle${rows.length === 1 ? "" : "s"}`);
    });
    preview();
    setTimeout(() => area.focus(), 40);
  }

  /* -------------------------------------------------------------- filters */
  function renderCategories() {
    const cats = PuzzleRepo.allCategories();
    catbar.innerHTML = "";
    if (!cats.length) { catbar.style.display = "none"; return; }
    catbar.style.display = "flex";
    catbar.appendChild(el("span", { class: "chip" + (state.category === "" ? " active" : ""), text: "All categories", onClick: () => { state.category = ""; render(); } }));
    for (const c of cats) {
      catbar.appendChild(el("span", {
        class: "chip" + (state.category === c ? " active" : ""), text: c,
        onClick: () => { state.category = state.category === c ? "" : c; render(); },
      }));
    }
  }

  function render() {
    renderCategories();
    favBtn.classList.toggle("active", state.favouritesOnly);
    const all = PuzzleRepo.list();
    const list = PuzzleRepo.query(state);
    count.textContent = `${all.length} puzzle${all.length === 1 ? "" : "s"} · ${PuzzleRepo.allCategories().length} categories`;

    content.innerHTML = "";
    if (!all.length) {
      content.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big", text: "🎡" }),
        el("div", { html: "<strong>No puzzles yet</strong>" }),
        el("p", { text: "Type an answer and a category — the board lays itself out." }),
        el("div", { style: { display: "flex", gap: "10px", justifyContent: "center", marginTop: "12px" } }, [
          el("button", { class: "btn primary", text: "＋ New Puzzle", onClick: newPuzzle }),
          el("button", { class: "btn", text: "⚡ Bulk add", onClick: bulkAdd }),
        ]),
      ]));
      return;
    }
    if (!list.length) {
      content.appendChild(el("div", { class: "empty" }, [el("div", { class: "big", text: "🔍" }), el("p", { text: "No puzzles match your filters." })]));
      return;
    }
    const grid = el("div", { class: "puz-grid" });
    list.forEach((p, i) => {
      const c = puzzleCard(p);
      c.classList.add("fade");
      c.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
      grid.appendChild(c);
    });
    content.appendChild(grid);
  }

  newBtn.addEventListener("click", newPuzzle);
  bulkBtn.addEventListener("click", bulkAdd);
  search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
  sortSel.addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  favBtn.addEventListener("click", () => { state.favouritesOnly = !state.favouritesOnly; render(); });

  const unsubscribe = PuzzleRepo.subscribe(render);
  ensureWheelSeeded();   // synchronous — first-run puzzles are ready before this returns
  render();

  return {
    refresh: render,
    destroy() { unsubscribe && unsubscribe(); root.innerHTML = ""; },
  };
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { id: "pp-styles", html: `
  .pp-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
  .pp-count { color:var(--text-2); font-size:13.5px; font-weight:600; }
  .pp-spacer { flex:1; }
  .pp-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
  .pp-toolbar select.input { width:auto; padding-right:34px; cursor:pointer; }
  .pp-search { flex:1; max-width:420px; }
  .pp-catbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:20px; }

  .puz-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:18px; padding-bottom:40px; }
  .puz-card { position:relative; display:flex; flex-direction:column; padding:0; overflow:hidden; cursor:pointer;
    transition:transform .2s var(--ease), box-shadow .2s var(--ease), border-color .2s var(--ease); }
  .puz-card:hover { transform:translateY(-4px); box-shadow:var(--shadow-3); border-color:var(--line); }
  .pc-preview { padding:14px 14px 12px; border-bottom:1px solid var(--line-soft);
    background:radial-gradient(120% 120% at 0 0, color-mix(in srgb,var(--accent) 14%,transparent), transparent 62%), var(--bg-0); }
  .pc-body { padding:14px 16px 16px; display:flex; flex-direction:column; gap:9px; flex:1; }
  .pc-answer { font-size:15px; font-weight:700; letter-spacing:-.01em; line-height:1.3; }
  .pc-meta { display:flex; align-items:center; gap:8px; color:var(--text-2); font-size:12.5px; font-weight:600; flex-wrap:wrap; }
  .pc-cat { color:color-mix(in srgb,var(--accent) 70%,var(--text-0)); }
  .pc-warn { color:var(--warn); font-size:12.5px; font-weight:600; }
  .pc-tags { display:flex; gap:6px; flex-wrap:wrap; }
  .pc-tag { font-size:11px; font-weight:700; color:var(--text-1); background:var(--bg-3); border:1px solid var(--line-soft); padding:2px 8px; border-radius:999px; }
  .pc-actions { display:flex; align-items:center; gap:6px; margin-top:auto; padding-top:4px; }
  .fav { cursor:pointer; font-size:18px; line-height:1; background:none; border:none; padding:2px; filter:grayscale(1) opacity(.5); transition:all .2s var(--ease); }
  .fav.on { filter:none; }
  .fav:hover { transform:scale(1.15); }

  /* editor — board on one side, the fields that drive it on the other */
  .ed-grid { display:grid; gap:18px; align-items:start; }
  .ed-preview { background:var(--bg-0); border:1px solid var(--line-soft); border-radius:var(--r-md);
    padding:14px; width:100%; max-width:480px; margin:0 auto; }
  .ed-col { display:flex; flex-direction:column; gap:10px; min-width:0; }
  .ed-fields { display:flex; flex-direction:column; gap:14px; min-width:0; }
  .ed-hint { grid-column:1 / -1; color:var(--text-2); font-size:12.5px; text-align:center; }
  textarea.answer { font-size:17px; font-weight:700; text-transform:uppercase; letter-spacing:.02em; resize:vertical; min-height:64px; }
  .ed-status { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; min-height:20px; justify-content:center; }
  .ed-status.ok { color:var(--good); }
  .ed-status.bad { color:var(--bad); }
  .ed-counts { display:flex; gap:14px; flex-wrap:wrap; justify-content:center; color:var(--text-2); font-size:12.5px; font-weight:600; }
  .ed-counts b { color:var(--text-0); }
  @media (min-width:720px){ .ed-grid { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } }

  .bulk-area { min-height:190px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13.5px; }
  ` }));
}
