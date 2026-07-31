// The Jeopardy session planner, as a mountable panel.
// Shared by the game's settings screen and the standalone /sessions.html URL.
//
// A session owns the boards it plays: each board is assembled here from the
// category library — which categories, in what order, and where the single
// Daily Double sits — rather than picked from a pre-built board library.

import { SessionRepo, BoardRepo, CategoryRepo } from "../../core/repos.js";
import { ensureSeeded } from "../../core/seed.js";
import { el, toast, modal, confirmDialog, promptDialog, timeAgo } from "../ui.js";
import { boardClueCount } from "../../core/models.js";

/**
 * @param {HTMLElement} root
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountSessions(root) {
  ensureStyles();

  const newBtn = el("button", { class: "btn primary", text: "＋ New Session" });
  const blurb = el("div", { class: "jsp-blurb", text: "Plan a night — each session assembles its own boards from your category library, with its own Daily Double placement." });
  const content = el("div");

  root.innerHTML = "";
  root.append(
    el("div", { class: "jsp-head" }, [blurb, el("span", { class: "jsp-spacer" }), newBtn]),
    content,
  );

  function field(label, control) {
    return el("div", { class: "insp-field" }, [el("label", { text: label }), control]);
  }

  function sessionCard(session) {
    const boards = session.boardIds.map((id) => BoardRepo.get(id)).filter(Boolean);
    const totalClues = boards.reduce((n, b) => n + boardClueCount(b), 0);

    const boardsBox = boards.length
      ? el("div", { class: "sc-boards" }, boards.map((b, i) =>
          el("div", { class: "sc-board-row" }, [
            el("span", { class: "idx", text: String(i + 1) }),
            el("span", { class: "nm", text: b.name }),
            el("span", { class: "ct", text: `${b.categories.length} cat${b.categories.length === 1 ? "" : "s"}${b.dailyDoubles?.length ? " · ⭐" : ""}` }),
          ])))
      : el("div", { class: "sc-empty-boards", text: "No boards yet — add one and assemble it from your categories." });

    return el("div", { class: "session-card card" }, [
      el("div", { class: "sc-head" }, [
        el("div", { class: "sc-glyph", text: "🎯" }),
        el("div", { style: { flex: 1 } }, [
          el("div", { class: "sc-title", text: session.name }),
          el("div", { class: "sc-meta", text: `${boards.length} board${boards.length === 1 ? "" : "s"} · ${totalClues} clues · ${timeAgo(session.updatedAt)}` }),
        ]),
        el("button", { class: "icon-btn", html: "⋯", title: "More", onClick: (e) => menu(session, e.currentTarget) }),
      ]),
      boardsBox,
      el("div", { class: "sc-actions" }, [
        el("button", { class: "btn sm", text: "Edit", onClick: () => editSession(session) }),
        el("span", { class: "jsp-spacer" }),
        el("button", { class: "btn sm primary", text: "▶ Launch", disabled: boards.length ? null : "", onClick: () => launch(session) }),
      ]),
    ]);
  }

  function launch(session) {
    location.href = `index.html?screen=control&session=${session.id}`;
  }

  function menu(session, anchor) {
    const items = [
      { label: "Rename", fn: async () => { const n = await promptDialog({ title: "Rename session", label: "Session name", value: session.name }); if (n) SessionRepo.rename(session.id, n); } },
      {
        label: "Delete", danger: true, fn: async () => {
          if (await confirmDialog({ title: "Delete session?", message: `“${session.name}” and the boards it assembled will be removed. Your categories are not affected.`, confirmText: "Delete", danger: true })) {
            session.boardIds.forEach((id) => BoardRepo.remove(id));
            SessionRepo.remove(session.id);
            toast("Session deleted");
          }
        },
      },
    ];
    const list = el("div", { class: "jsp-popmenu card" }, items.map((it) =>
      el("button", { class: `jsp-popmenu-item ${it.danger ? "danger" : ""}`, text: it.label, onClick: () => { closePop(); it.fn(); } })));
    openPop(list, anchor);
  }
  let popEl;
  function openPop(node, anchor) {
    closePop(); popEl = node; document.body.appendChild(node); const r = anchor.getBoundingClientRect();
    Object.assign(node.style, { position: "fixed", top: `${r.bottom + 6}px`, left: `${Math.min(r.left, innerWidth - 190)}px`, zIndex: "150" });
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
  }
  function onDoc(e) { if (popEl && !popEl.contains(e.target)) closePop(); }
  function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener("mousedown", onDoc); } }

  /* ---- session editor: which boards, in what order ---- */
  function editSession(session) {
    const list = el("div", { class: "pick-list" });

    const refresh = () => {
      list.innerHTML = "";
      const boardIds = session.boardIds;
      if (!boardIds.length) list.appendChild(el("div", { class: "sc-empty-boards", text: "No boards yet." }));
      boardIds.forEach((id, i) => {
        const b = BoardRepo.get(id);
        if (!b) return;
        list.appendChild(el("div", { class: "pick-row" }, [
          el("span", { class: "idx", text: String(i + 1) }),
          el("span", { class: "nm", text: b.name }),
          el("span", { class: "ct", text: `${b.categories.length} cat${b.categories.length === 1 ? "" : "s"}${b.dailyDoubles?.length ? " · ⭐ DD" : ""}` }),
          el("div", { class: "reorder" }, [
            el("button", { html: "▲", title: "Up", disabled: i === 0 ? "" : null, onClick: () => { const ids = [...session.boardIds]; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; SessionRepo.setBoards(session.id, ids); session.boardIds = ids; refresh(); } }),
            el("button", { html: "▼", title: "Down", disabled: i === boardIds.length - 1 ? "" : null, onClick: () => { const ids = [...session.boardIds]; [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; SessionRepo.setBoards(session.id, ids); session.boardIds = ids; refresh(); } }),
          ]),
          el("button", { class: "btn sm", text: "Assemble", onClick: () => assembleBoard(id, refresh) }),
          el("button", {
            class: "icon-btn", html: "✕", title: "Remove board", onClick: async () => {
              if (await confirmDialog({ title: "Remove this board?", message: `“${b.name}” will be removed from the session and deleted (boards belong to the session that assembled them — your categories are unaffected).`, confirmText: "Remove", danger: true })) {
                const ids = session.boardIds.filter((x) => x !== id);
                SessionRepo.setBoards(session.id, ids);
                session.boardIds = ids;
                BoardRepo.remove(id);
                refresh();
              }
            },
          }),
        ]));
      });
    };

    const addBtn = el("button", {
      class: "btn sm primary", text: "＋ Add board", onClick: () => {
        const nb = BoardRepo.create({ name: `Board ${session.boardIds.length + 1}` });
        const ids = [...session.boardIds, nb.id];
        SessionRepo.setBoards(session.id, ids);
        session.boardIds = ids;
        refresh();
        assembleBoard(nb.id, refresh);
      },
    });

    refresh();
    const body = el("div", {}, [list, el("div", { style: { marginTop: "12px" } }, [addBtn])]);
    const m = modal({ title: `Edit · ${session.name}`, wide: true, body, actions: [
      el("button", { class: "btn primary", text: "Done", onClick: () => { m.close(); render(); } }),
    ] });
  }

  /* ---- board assembly: pick categories (order matters) + place the Daily Double ---- */
  function assembleBoard(boardId, onSaved) {
    const raw = BoardRepo.getRaw(boardId);
    if (!raw) return;
    let chosen = [...raw.categoryIds];
    let dd = raw.dailyDoubles && raw.dailyDoubles[0] ? { ...raw.dailyDoubles[0] } : null;

    const nameInput = el("input", { class: "input", value: raw.name });
    const left = el("div", { class: "pick-list" });
    const right = el("div", { class: "pick-list" });
    const ddGrid = el("div", { class: "dd-grid" });

    function renderPickers() {
      const allCats = CategoryRepo.list();
      const chosenCats = chosen.map((id) => allCats.find((c) => c.id === id)).filter(Boolean);
      const available = allCats.filter((c) => !chosen.includes(c.id));

      left.innerHTML = ""; right.innerHTML = "";
      if (!chosenCats.length) left.appendChild(el("div", { class: "sc-empty-boards", text: "No categories chosen yet. Add from the right →" }));
      chosenCats.forEach((c, i) => {
        left.appendChild(el("div", { class: "pick-row" }, [
          el("span", { class: "idx", text: String(i + 1) }),
          el("span", { class: "nm", text: c.name }),
          el("span", { class: "ct", text: `${c.clues.length} clues` }),
          el("div", { class: "reorder" }, [
            el("button", { html: "▲", title: "Up", disabled: i === 0 ? "" : null, onClick: () => { [chosen[i - 1], chosen[i]] = [chosen[i], chosen[i - 1]]; if (dd) dd = remapCol(dd, i - 1, i); renderAll(); } }),
            el("button", { html: "▼", title: "Down", disabled: i === chosenCats.length - 1 ? "" : null, onClick: () => { [chosen[i + 1], chosen[i]] = [chosen[i], chosen[i + 1]]; if (dd) dd = remapCol(dd, i + 1, i); renderAll(); } }),
          ]),
          el("button", { class: "icon-btn", html: "✕", title: "Remove", onClick: () => { chosen = chosen.filter((x) => x !== c.id); if (dd && dd.col === i) dd = null; renderAll(); } }),
        ]));
      });
      if (!available.length) right.appendChild(el("div", { class: "sc-empty-boards", text: allCats.length ? "All categories added." : "No categories in your library yet — add some first." }));
      available.forEach((c) => {
        right.appendChild(el("div", { class: "pick-row" }, [
          el("span", { class: "nm", text: c.name }),
          el("span", { class: "ct", text: `${c.clues.length} clues` }),
          el("button", { class: "icon-btn", html: "＋", title: "Add", onClick: () => { chosen.push(c.id); renderAll(); } }),
        ]));
      });
    }

    // Swapping two chosen categories' order should carry the Daily Double with
    // whichever category it was on, not silently jump to the new occupant.
    function remapCol(spot, from, to) {
      if (spot.col === from) return { ...spot, col: to };
      if (spot.col === to) return { ...spot, col: from };
      return spot;
    }

    function renderDdGrid() {
      ddGrid.innerHTML = "";
      const cats = chosen.map((id) => CategoryRepo.get(id)).filter(Boolean);
      if (!cats.length) { ddGrid.appendChild(el("div", { class: "sc-empty-boards", text: "Add categories to place the Daily Double." })); return; }
      const rows = Math.max(...cats.map((c) => c.clues.length), 1);
      ddGrid.style.gridTemplateColumns = `repeat(${cats.length}, 1fr)`;
      for (let r = 0; r < rows; r++) {
        cats.forEach((c, col) => {
          const clue = c.clues[r];
          const isDD = !!dd && dd.col === col && dd.row === r;
          const cell = el("button", {
            class: `dd-cell ${isDD ? "on" : ""} ${!clue ? "empty" : ""}`,
            text: clue ? String(clue.value) : "",
            disabled: clue ? null : "",
            title: clue ? "Click to set as the Daily Double" : "",
          });
          cell.addEventListener("click", () => { dd = isDD ? null : { col, row: r }; renderDdGrid(); });
          ddGrid.appendChild(cell);
        });
      }
    }

    function renderAll() { renderPickers(); renderDdGrid(); }
    renderAll();

    const body = el("div", {}, [
      field("Board name", nameInput),
      el("div", { class: "picker", style: { marginTop: "14px" } }, [
        el("div", {}, [el("h4", { text: "On this board (in order)" }), left]),
        el("div", {}, [el("h4", { text: "Available categories" }), right]),
      ]),
      el("h4", { style: { marginTop: "18px" }, text: "Daily Double — click a clue to place it" }),
      ddGrid,
    ]);

    const save = el("button", { class: "btn primary", text: "Save board" });
    const m = modal({ title: `Assemble · ${raw.name}`, wide: true, body, actions: [
      el("button", { class: "btn ghost", text: "Cancel", onClick: () => m.close() }),
      save,
    ] });
    save.addEventListener("click", () => {
      BoardRepo.rename(boardId, nameInput.value.trim() || raw.name);
      BoardRepo.setCategories(boardId, chosen);
      BoardRepo.setDailyDoubles(boardId, dd ? [dd] : []);
      m.close();
      toast("Board saved");
      onSaved && onSaved();
    });
  }

  async function newSession() {
    const name = await promptDialog({ title: "New session", label: "Session name", value: "Untitled Session", confirmText: "Create" });
    if (!name) return;
    const s = SessionRepo.create({ name });
    editSession(s);
  }

  function render() {
    const list = SessionRepo.list().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    content.innerHTML = "";
    if (!list.length) {
      content.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big", text: "🎯" }),
        el("div", { html: "<strong>No sessions yet</strong>" }),
        el("p", { text: "A session is a running order of boards, assembled from your categories — perfect for a whole night of trivia." }),
        el("button", { class: "btn primary", text: "＋ New Session", style: { marginTop: "12px" }, onClick: newSession }),
      ]));
      return;
    }
    const grid = el("div", { class: "session-list" });
    list.forEach((s, i) => { const c = sessionCard(s); c.classList.add("fade"); c.style.animationDelay = `${Math.min(i * 0.04, 0.3)}s`; grid.appendChild(c); });
    content.appendChild(grid);
  }

  newBtn.addEventListener("click", newSession);
  const offSessions = SessionRepo.subscribe(render);
  const offBoards = BoardRepo.subscribe(render);
  ensureSeeded().then(render);
  render();

  return {
    refresh: render,
    destroy() { closePop(); offSessions && offSessions(); offBoards && offBoards(); root.innerHTML = ""; },
  };
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { id: "jsp-styles", html: `
  .jsp-head { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
  .jsp-blurb { color:var(--text-2); font-size:13.5px; max-width:620px; }
  .jsp-spacer { flex:1; }

  .session-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:18px; padding-bottom:40px; }
  .session-card { display:flex; flex-direction:column; padding:20px; gap:14px; }
  .session-card .sc-head { display:flex; align-items:flex-start; gap:12px; }
  .sc-glyph { width:46px;height:46px;border-radius:13px;display:grid;place-items:center;font-size:22px;flex:none;
    background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:var(--shadow-2),inset 0 1px 0 rgba(255,255,255,.25); }
  .sc-title { font-size:18px; font-weight:700; }
  .sc-meta { color:var(--text-2); font-size:12.5px; font-weight:600; margin-top:2px; }
  .sc-boards { display:flex; flex-direction:column; gap:6px; }
  .sc-board-row { display:flex; align-items:center; gap:10px; padding:8px 11px; background:var(--bg-1); border:1px solid var(--line-soft); border-radius:10px; font-size:13.5px; }
  .sc-board-row .idx { width:20px;height:20px;border-radius:6px;background:var(--bg-3);display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--text-1);flex:none; }
  .sc-board-row .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sc-board-row .ct { color:var(--text-2); font-size:12px; }
  .sc-empty-boards { color:var(--text-2); font-size:13px; padding:8px 0; }
  .sc-actions { display:flex; gap:8px; margin-top:auto; align-items:center; }

  .insp-field { display:flex; flex-direction:column; gap:8px; }
  .insp-field > label { font-size:12.5px; font-weight:700; color:var(--text-1); letter-spacing:.01em; text-transform:uppercase; }

  .picker { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .picker h4 { font-size:12.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-2); margin-bottom:10px; }
  .pick-list { display:flex; flex-direction:column; gap:7px; max-height:38vh; overflow:auto; padding-right:4px; }
  .pick-row { display:flex; align-items:center; gap:9px; padding:9px 11px; border:1px solid var(--line-soft); border-radius:10px; background:var(--bg-1); }
  .pick-row .idx { width:20px;height:20px;border-radius:6px;background:var(--bg-3);display:grid;place-items:center;font-size:11px;font-weight:700;flex:none; }
  .pick-row .nm { flex:1; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pick-row .ct { color:var(--text-2); font-size:11.5px; white-space:nowrap; }
  .pick-row .reorder { display:flex; flex-direction:column; gap:1px; }
  .pick-row .reorder button, .icon-btn { width:24px;height:20px;border:1px solid var(--line);background:var(--bg-3);color:var(--text-1);border-radius:6px;cursor:pointer;font-size:11px;line-height:1;display:grid;place-items:center; }
  .icon-btn { width:26px;height:26px; }
  .icon-btn:hover { color:var(--text-0);border-color:var(--line); }
  @media (max-width:640px){ .picker{grid-template-columns:1fr} }

  .dd-grid { display:grid; gap:6px; margin-top:10px; }
  .dd-cell { padding:10px 4px; border-radius:8px; border:1px solid var(--line-soft); background:var(--bg-2); color:var(--text-1);
    font-weight:700; font-size:13px; cursor:pointer; transition:all .15s var(--ease); }
  .dd-cell:hover:not(:disabled) { border-color:var(--accent); }
  .dd-cell.on { background:linear-gradient(135deg,var(--gold),color-mix(in srgb,var(--gold) 60%,#000)); color:#1a1300; border-color:transparent; }
  .dd-cell.empty { background:transparent; border-style:dashed; cursor:default; opacity:.4; }

  .jsp-popmenu { min-width:180px; padding:6px; display:flex; flex-direction:column; gap:2px; box-shadow:var(--shadow-3); }
  .jsp-popmenu-item { text-align:left; background:none; border:none; color:var(--text-0); font:inherit; font-weight:600;
    font-size:14px; padding:9px 11px; border-radius:9px; cursor:pointer; }
  .jsp-popmenu-item:hover { background:var(--bg-3); }
  .jsp-popmenu-item.danger { color:var(--bad); }
  ` }));
}
