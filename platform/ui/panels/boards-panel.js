// The Jeopardy board library, as a mountable panel.
//
// Lives here rather than inside a page so the game's settings screen and the
// standalone /boards.html URL are the same code. Mount it into any container:
//
//   const panel = mountBoards(document.getElementById("host"));
//   panel.destroy();

import { BoardRepo } from "../../core/repos.js";
import { ensureSeeded } from "../../core/seed.js";
import { renderBoardGrid } from "../board-view.js";
import { el, toast, modal, confirmDialog, promptDialog, timeAgo } from "../ui.js";
import { boardClueCount } from "../../core/models.js";
import * as boardCsv from "../../core/board-csv.js";
import { csvToolbar } from "../csv-import.js";

/**
 * @param {HTMLElement} root
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountBoards(root) {
  ensureStyles();
  const state = { query: "", tag: "", favouritesOnly: false, sort: "updated" };

  const sub = el("div", { class: "bp-sub" });
  const search = el("input", { placeholder: "Search boards & categories…", autocomplete: "off" });
  const favBtn = el("button", { class: "chip", text: "★ Favourites" });
  const sortSel = el("select", { class: "input" }, [
    el("option", { value: "updated", text: "Recently updated" }),
    el("option", { value: "created", text: "Newest" }),
    el("option", { value: "name", text: "Name (A–Z)" }),
    el("option", { value: "size", text: "Most clues" }),
  ]);
  const tagbar = el("div", { class: "bp-tagbar" });
  const content = el("div");
  const newBtn = el("button", { class: "btn primary", text: "＋ New Board" });
  const csv = csvToolbar({ mapper: boardCsv, getRecords: () => BoardRepo.list(), onChanged: render });

  root.innerHTML = "";
  root.append(
    el("div", { class: "bp-head" }, [sub, el("span", { class: "bp-spacer" }), csv.templateBtn, csv.exportBtn, csv.importBtn, csv.fileInput, newBtn]),
    el("div", { class: "bp-toolbar" }, [
      el("div", { class: "search bp-search" }, [el("span", { text: "🔎" }), search]),
      favBtn,
      el("span", { class: "bp-spacer" }),
      el("label", { class: "field-label", style: { color: "var(--text-2)" }, text: "Sort" }),
      sortSel,
    ]),
    tagbar,
    content,
  );

  /* ---- mini preview (cheap, non-interactive) ---- */
  function miniBoard(board) {
    const cats = board.categories || [];
    const cols = Math.min(cats.length, 6) || 1;
    const rows = Math.min(cats.reduce((m, c) => Math.max(m, c.clues.length), 0), 5) || 1;
    const wrap = el("div", { class: "mini-board", style: { gridTemplateColumns: `repeat(${cols},1fr)` } });
    for (let c = 0; c < cols; c++) wrap.appendChild(el("div", { class: "mini-cell" }));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) wrap.appendChild(el("div", { class: "mini-cell q" }));
    return wrap;
  }

  function boardCard(board) {
    const accent = "#3b6fff";
    const nCats = (board.categories || []).length;
    const nClues = boardClueCount(board);

    const fav = el("button", {
      class: `fav ${board.meta?.favourite ? "on" : ""}`, html: board.meta?.favourite ? "★" : "☆", title: "Favourite",
      onClick: (e) => { e.stopPropagation(); BoardRepo.toggleFavourite(board.id); },
    });

    const card = el("div", { class: "board-card card", style: { "--accent": accent } }, [
      el("div", { class: "bc-preview" }, [el("div", { class: "mini" }, [miniBoard(board)])]),
      el("div", { class: "bc-body" }, [
        el("div", { class: "bc-title" }, [el("span", { text: board.name })]),
        el("div", { class: "bc-meta" }, [
          el("span", { text: `${nCats} categories` }),
          el("span", { text: "·" }),
          el("span", { text: `${nClues} clues` }),
          el("span", { text: "·" }),
          el("span", { text: timeAgo(board.updatedAt) }),
        ]),
        (board.meta?.tags || []).length ? el("div", { class: "bc-tags" }, board.meta.tags.map((t) => el("span", { class: "bc-tag", text: t }))) : null,
        el("div", { class: "bc-actions" }, [
          fav,
          el("span", { class: "bp-spacer" }),
          el("button", { class: "btn sm ghost", text: "Preview", onClick: (e) => { e.stopPropagation(); preview(board); } }),
          el("button", { class: "btn sm ghost", html: "⋯", title: "More", onClick: (e) => { e.stopPropagation(); menu(board, e.currentTarget); } }),
          el("button", { class: "btn sm primary", text: "Edit", onClick: (e) => { e.stopPropagation(); location.href = `editor.html?id=${board.id}`; } }),
        ]),
      ].filter(Boolean)),
    ]);
    card.addEventListener("click", () => location.href = `editor.html?id=${board.id}`);
    return card;
  }

  /* ---- overflow menu ---- */
  function menu(board, anchor) {
    const items = [
      { label: "Rename", fn: async () => { const n = await promptDialog({ title: "Rename board", label: "Board name", value: board.name }); if (n) BoardRepo.rename(board.id, n); } },
      { label: "Duplicate", fn: () => { const c = BoardRepo.duplicate(board.id); if (c) toast("Board duplicated"); } },
      { label: "Edit tags", fn: async () => { const cur = (board.meta?.tags || []).join(", "); const n = await promptDialog({ title: "Edit tags", label: "Comma-separated tags", value: cur, placeholder: "e.g. bible, movies" }); if (n !== null) BoardRepo.setTags(board.id, n.split(",").map((s) => s.trim()).filter(Boolean)); } },
      { label: "Delete", danger: true, fn: async () => { if (await confirmDialog({ title: "Delete board?", message: `“${board.name}” will be permanently removed.`, confirmText: "Delete", danger: true })) { BoardRepo.remove(board.id); toast("Board deleted"); } } },
    ];
    const list = el("div", { class: "bp-popmenu card" }, items.map((it) =>
      el("button", { class: `bp-popmenu-item ${it.danger ? "danger" : ""}`, text: it.label, onClick: () => { closePop(); it.fn(); } })));
    openPop(list, anchor);
  }
  let popEl;
  function openPop(node, anchor) {
    closePop();
    popEl = node; document.body.appendChild(node);
    const r = anchor.getBoundingClientRect();
    node.style.position = "fixed";
    node.style.top = `${r.bottom + 6}px`;
    node.style.left = `${Math.min(r.left, innerWidth - 190)}px`;
    node.style.zIndex = "150";
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
  }
  function onDoc(e) { if (popEl && !popEl.contains(e.target)) closePop(); }
  function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener("mousedown", onDoc); } }

  /* ---- preview modal ---- */
  function preview(board) {
    const grid = renderBoardGrid(board, { showDailyDouble: true });
    const closeBtn = el("button", { class: "btn ghost", text: "Close" });
    const m = modal({ title: board.name, body: el("div", {}, [grid]), wide: true, actions: [
      closeBtn,
      el("button", { class: "btn primary", text: "Edit board", onClick: () => location.href = `editor.html?id=${board.id}` }),
    ]});
    closeBtn.addEventListener("click", () => m.close());
  }

  /* ---- filters ---- */
  function renderTags() {
    const tags = BoardRepo.allTags();
    tagbar.innerHTML = "";
    if (!tags.length) { tagbar.style.display = "none"; return; }
    tagbar.style.display = "flex";
    tagbar.appendChild(el("span", { class: "chip" + (state.tag === "" ? " active" : ""), text: "All", onClick: () => { state.tag = ""; render(); } }));
    for (const t of tags) tagbar.appendChild(el("span", { class: "chip" + (state.tag === t ? " active" : ""), text: t, onClick: () => { state.tag = state.tag === t ? "" : t; render(); } }));
  }

  function render() {
    renderTags();
    favBtn.classList.toggle("active", state.favouritesOnly);
    const list = BoardRepo.query(state);
    const all = BoardRepo.list();
    sub.textContent = `${all.length} board${all.length === 1 ? "" : "s"} in your library`;

    content.innerHTML = "";
    if (!all.length) {
      content.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big", text: "🎛️" }),
        el("div", { html: "<strong>No boards yet</strong>" }),
        el("p", { text: "Create your first board to get started." }),
        el("button", { class: "btn primary", text: "＋ New Board", style: { marginTop: "12px" }, onClick: newBoard }),
      ]));
      return;
    }
    if (!list.length) {
      content.appendChild(el("div", { class: "empty" }, [el("div", { class: "big", text: "🔍" }), el("p", { text: "No boards match your filters." })]));
      return;
    }
    const grid = el("div", { class: "board-grid" });
    list.forEach((b, i) => { const c = boardCard(b); c.classList.add("fade"); c.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`; grid.appendChild(c); });
    content.appendChild(grid);
  }

  async function newBoard() {
    const name = await promptDialog({ title: "New board", label: "Board name", value: "Untitled Board", confirmText: "Create" });
    if (!name) return;
    const b = BoardRepo.create({ name });
    location.href = `editor.html?id=${b.id}`;
  }

  newBtn.addEventListener("click", newBoard);
  search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
  sortSel.addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  favBtn.addEventListener("click", () => { state.favouritesOnly = !state.favouritesOnly; render(); });

  const unsubscribe = BoardRepo.subscribe(render);
  ensureSeeded().then(render);
  render();

  return {
    refresh: render,
    destroy() { closePop(); unsubscribe && unsubscribe(); root.innerHTML = ""; },
  };
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { id: "bp-styles", html: `
  .bp-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
  .bp-sub { color:var(--text-2); font-size:13.5px; font-weight:600; }
  .bp-spacer { flex:1; }
  .bp-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
  .bp-toolbar select.input { width:auto; padding-right:34px; cursor:pointer; }
  .bp-search { flex:1; max-width:420px; }
  .bp-tagbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:20px; }

  .board-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:18px; padding-bottom:40px; }
  .board-card { position:relative; display:flex; flex-direction:column; padding:0; overflow:hidden; cursor:pointer;
    transition:transform .2s var(--ease), box-shadow .2s var(--ease), border-color .2s var(--ease); }
  .board-card:hover { transform:translateY(-4px); box-shadow:var(--shadow-3); border-color:var(--line); }
  .bc-preview { height:132px; padding:12px; background:radial-gradient(120% 120% at 0 0, color-mix(in srgb,var(--accent) 16%,transparent), transparent 60%), var(--bg-0);
    border-bottom:1px solid var(--line-soft); overflow:hidden; display:flex; align-items:center; }
  .bc-preview .mini { transform:scale(1); width:100%; }
  .bc-body { padding:15px 16px 16px; display:flex; flex-direction:column; gap:9px; flex:1; }
  .bc-title { font-size:17px; font-weight:700; letter-spacing:-.01em; display:flex; align-items:center; gap:8px; }
  .bc-meta { display:flex; align-items:center; gap:10px; color:var(--text-2); font-size:12.5px; font-weight:600; }
  .bc-tags { display:flex; gap:6px; flex-wrap:wrap; }
  .bc-tag { font-size:11px; font-weight:700; color:var(--text-1); background:var(--bg-3); border:1px solid var(--line-soft); padding:2px 8px; border-radius:999px; }
  .bc-actions { display:flex; align-items:center; gap:6px; margin-top:auto; padding-top:4px; }
  .fav { cursor:pointer; font-size:18px; line-height:1; background:none; border:none; padding:2px; filter:grayscale(1) opacity(.5); transition:all .2s var(--ease); }
  .fav.on { filter:none; }
  .fav:hover { transform:scale(1.15); }
  .mini-board { display:grid; gap:3px; }
  .mini-board .mrow { display:grid; gap:3px; }
  .mini-cell { height:11px; border-radius:3px; background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 50%,#000)); opacity:.9; }
  .mini-cell.q { background:var(--bg-3); opacity:.7; }

  .bp-popmenu { min-width:180px; padding:6px; display:flex; flex-direction:column; gap:2px; box-shadow:var(--shadow-3); }
  .bp-popmenu-item { text-align:left; background:none; border:none; color:var(--text-0); font:inherit; font-weight:600;
    font-size:14px; padding:9px 11px; border-radius:9px; cursor:pointer; }
  .bp-popmenu-item:hover { background:var(--bg-3); }
  .bp-popmenu-item.danger { color:var(--bad); }
  ` }));
}
