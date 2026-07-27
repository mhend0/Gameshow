// The Wheel of Fortune session planner, as a mountable panel.
// Shared by the game's settings screen and the standalone /wheel-sessions.html URL.

import { WheelSessionRepo, PuzzleRepo, makeRound, ROUND_KINDS, getRoundKind } from "../../core/wheel.js";
import { el, toast, modal, confirmDialog, promptDialog, timeAgo } from "../ui.js";

/**
 * @param {HTMLElement} root
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountWheelSessions(root) {
  ensureStyles();

  const newBtn = el("button", { class: "btn primary", text: "＋ New Session" });
  const blurb = el("div", { class: "ws-blurb", text: "A running order of puzzles, one per round. Sessions reference the library, so one puzzle can play in many nights." });
  const content = el("div");

  root.innerHTML = "";
  root.append(
    el("div", { class: "ws-head" }, [blurb, el("span", { class: "ws-spacer" }), newBtn]),
    content,
  );

  const launch = (session) => { location.href = `wheel.html?screen=control&session=${session.id}`; };

  function sessionCard(session) {
    const rounds = WheelSessionRepo.resolveRounds(session.id);
    const missing = (session.rounds || []).length - rounds.length;

    const list = rounds.length
      ? el("div", { class: "sc-rounds" }, rounds.map((r, i) => {
          const kind = getRoundKind(r.kind);
          return el("div", { class: "sc-round" }, [
            el("span", { class: "idx", text: String(i + 1) }),
            kind.key === "standard" ? null : el("span", { class: "kind", text: kind.glyph, title: kind.name }),
            el("span", { class: "nm", text: r.puzzle.answer }),
            r.value ? el("span", { class: "val", text: `$${Number(r.value).toLocaleString()}` }) : null,
            el("span", { class: "ct", text: r.puzzle.category || "—" }),
          ].filter(Boolean));
        }))
      : el("div", { class: "sc-empty", text: "No puzzles yet — add some to play." });

    return el("div", { class: "session-card card" }, [
      el("div", { class: "sc-head" }, [
        el("div", { class: "sc-glyph", text: "🎡" }),
        el("div", { style: { flex: 1 } }, [
          el("div", { class: "sc-title", text: session.name }),
          el("div", { class: "sc-meta", text:
            `${rounds.length} round${rounds.length === 1 ? "" : "s"}${missing > 0 ? ` · ${missing} missing` : ""} · ${timeAgo(session.updatedAt)}` }),
        ]),
        el("button", { class: "icon-btn", html: "⋯", title: "More", onClick: (e) => menu(session, e.currentTarget) }),
      ]),
      list,
      el("div", { class: "sc-actions" }, [
        el("button", { class: "btn sm", text: "Edit rounds", onClick: () => editSession(session) }),
        el("span", { class: "ws-spacer" }),
        el("button", { class: "btn sm primary", text: "▶ Launch", disabled: rounds.length ? null : "", onClick: () => launch(session) }),
      ]),
    ]);
  }

  function menu(session, anchor) {
    const items = [
      { label: "Rename", fn: async () => { const n = await promptDialog({ title: "Rename session", label: "Session name", value: session.name }); if (n) WheelSessionRepo.rename(session.id, n); } },
      { label: "Duplicate", fn: () => { WheelSessionRepo.duplicate(session.id); toast("Session duplicated"); } },
      { label: "Delete", danger: true, fn: async () => {
        const ok = await confirmDialog({ title: "Delete session?", message: `“${session.name}” will be removed. The puzzles it references are not deleted.`, confirmText: "Delete", danger: true });
        if (ok) { WheelSessionRepo.remove(session.id); toast("Session deleted"); }
      } },
    ];
    const list = el("div", { class: "ws-popmenu card" }, items.map((it) =>
      el("button", { class: `ws-popmenu-item ${it.danger ? "danger" : ""}`, text: it.label, onClick: () => { closePop(); it.fn(); } })));
    openPop(list, anchor);
  }
  let popEl;
  function openPop(node, anchor) {
    closePop();
    popEl = node;
    document.body.appendChild(node);
    const r = anchor.getBoundingClientRect();
    Object.assign(node.style, { position: "fixed", top: `${r.bottom + 6}px`, left: `${Math.min(r.left, innerWidth - 190)}px`, zIndex: "150" });
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
  }
  function onDoc(e) { if (popEl && !popEl.contains(e.target)) closePop(); }
  function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener("mousedown", onDoc); } }

  /* ---- session editor: choose puzzles, set the order and the round types ---- */
  function editSession(session) {
    let chosen = (session.rounds || []).map((r) => ({ ...r }));
    let filter = "";

    const left = el("div", { class: "pick-list" });
    const right = el("div", { class: "pick-list" });
    const search = el("input", { class: "input pick-search", placeholder: "Search the library…" });
    search.addEventListener("input", () => { filter = search.value.toLowerCase(); render(); });

    const render = () => {
      const lib = PuzzleRepo.list();
      const byId = new Map(lib.map((p) => [p.id, p]));
      left.innerHTML = ""; right.innerHTML = "";

      if (!chosen.length) left.appendChild(el("div", { class: "sc-empty", text: "No rounds yet. Add puzzles from the right →" }));
      chosen.forEach((r, i) => {
        const p = byId.get(r.puzzleId);
        const kind = getRoundKind(r.kind);

        // Kind and value live per round, so one puzzle can be a $1,000 toss-up in
        // one night and a standard round in another.
        const kindSel = el("select", { class: "input tiny-sel", title: "Round type" },
          ROUND_KINDS.map((k) => el("option", { value: k.key, text: `${k.glyph} ${k.name}` })));
        kindSel.value = kind.key;
        kindSel.addEventListener("change", () => {
          const next = getRoundKind(kindSel.value);
          chosen[i] = { ...chosen[i], kind: next.key, value: next.defaultValue };
          render();
        });

        const valInput = el("input", {
          class: "input tiny-sel", type: "number", step: "100", min: "0",
          value: String(r.value != null ? r.value : kind.defaultValue), title: "Award for this round",
        });
        valInput.addEventListener("input", () => {
          chosen[i] = { ...chosen[i], value: Math.max(0, parseInt(valInput.value, 10) || 0) };
        });

        left.appendChild(el("div", { class: "pick-row col" }, [
          el("div", { class: "pick-main" }, [
            el("span", { class: "pick-idx", text: String(i + 1) }),
            el("span", { class: "nm", text: p ? p.answer : "(puzzle deleted)" }),
            el("div", { class: "reorder" }, [
              el("button", { html: "▲", title: "Up", disabled: i === 0 ? "" : null, onClick: () => { [chosen[i - 1], chosen[i]] = [chosen[i], chosen[i - 1]]; render(); } }),
              el("button", { html: "▼", title: "Down", disabled: i === chosen.length - 1 ? "" : null, onClick: () => { [chosen[i + 1], chosen[i]] = [chosen[i], chosen[i + 1]]; render(); } }),
            ]),
            el("button", { class: "icon-btn", html: "✕", title: "Remove", onClick: () => { chosen.splice(i, 1); render(); } }),
          ]),
          el("div", { class: "pick-opts" }, [
            kindSel,
            kind.key === "standard"
              ? el("span", { class: "ct", text: "value comes off the wheel" })
              : valInput,
          ]),
        ]));
      });

      const used = new Set(chosen.map((r) => r.puzzleId));
      const available = lib.filter((p) => !used.has(p.id))
        .filter((p) => !filter || p.answer.toLowerCase().includes(filter) || (p.category || "").toLowerCase().includes(filter));
      if (!available.length) right.appendChild(el("div", { class: "sc-empty", text: filter ? "Nothing matches." : "Every puzzle is already in this session." }));
      available.forEach((p) => {
        right.appendChild(el("div", { class: "pick-row" }, [
          el("span", { class: "nm", text: p.answer }),
          el("span", { class: "ct", text: p.category || "—" }),
          el("button", { class: "icon-btn", html: "＋", title: "Add", onClick: () => { chosen.push(makeRound({ puzzleId: p.id })); render(); } }),
        ]));
      });
    };

    const body = el("div", { class: "picker" }, [
      el("div", {}, [el("h4", { text: "Running order" }), left]),
      el("div", {}, [el("h4", { text: "Puzzle library" }), search, right]),
    ]);
    render();

    const save = el("button", { class: "btn primary", text: "Save session" });
    const m = modal({ title: `Edit · ${session.name}`, wide: true, body, actions: [
      el("button", { class: "btn ghost", text: "Cancel", onClick: () => m.close() }),
      save,
    ]});
    save.addEventListener("click", () => { WheelSessionRepo.setRounds(session.id, chosen); m.close(); toast("Session saved"); });
  }

  async function newSession() {
    const name = await promptDialog({ title: "New wheel session", label: "Session name", value: "Wheel Night", confirmText: "Create" });
    if (!name) return;
    const s = WheelSessionRepo.create({ name });
    editSession(s);
  }

  function render() {
    const list = WheelSessionRepo.list().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    content.innerHTML = "";
    if (!list.length) {
      content.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big", text: "🎡" }),
        el("div", { html: "<strong>No wheel sessions yet</strong>" }),
        el("p", { text: "A session is a running order of puzzles — one per round." }),
        el("button", { class: "btn primary", text: "＋ New Session", style: { marginTop: "12px" }, onClick: newSession }),
      ]));
      return;
    }
    const grid = el("div", { class: "session-list" });
    list.forEach((s, i) => {
      const c = sessionCard(s);
      c.classList.add("fade");
      c.style.animationDelay = `${Math.min(i * 0.04, 0.3)}s`;
      grid.appendChild(c);
    });
    content.appendChild(grid);
  }

  newBtn.addEventListener("click", newSession);
  const offSessions = WheelSessionRepo.subscribe(render);
  const offPuzzles = PuzzleRepo.subscribe(render);
  render();

  return {
    refresh: render,
    destroy() { closePop(); offSessions && offSessions(); offPuzzles && offPuzzles(); root.innerHTML = ""; },
  };
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { id: "ws-styles", html: `
  .ws-head { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
  .ws-blurb { color:var(--text-2); font-size:13.5px; max-width:620px; }
  .ws-spacer { flex:1; }

  .session-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:18px; padding-bottom:40px; }
  .session-card { display:flex; flex-direction:column; padding:20px; gap:14px; }
  .session-card .sc-head { display:flex; align-items:flex-start; gap:12px; }
  .sc-glyph { width:46px;height:46px;border-radius:13px;display:grid;place-items:center;font-size:22px;flex:none;
    background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:var(--shadow-2),inset 0 1px 0 rgba(255,255,255,.25); }
  .sc-title { font-size:18px; font-weight:700; }
  .sc-meta { color:var(--text-2); font-size:12.5px; font-weight:600; margin-top:2px; }
  .sc-rounds { display:flex; flex-direction:column; gap:6px; }
  .sc-round { display:flex; align-items:center; gap:10px; padding:8px 11px; background:var(--bg-1);
    border:1px solid var(--line-soft); border-radius:10px; font-size:13.5px; }
  .sc-round .idx { width:20px;height:20px;border-radius:6px;background:var(--bg-3);display:grid;place-items:center;
    font-size:11px;font-weight:700;color:var(--text-1);flex:none; }
  .sc-round .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sc-round .ct { color:var(--text-2); font-size:11.5px; white-space:nowrap; }
  .sc-round .kind { flex:none; font-size:13px; }
  .sc-round .val { color:var(--gold); font-weight:700; font-size:12px; white-space:nowrap; }
  .sc-empty { color:var(--text-2); font-size:13px; padding:8px 0; }
  .sc-actions { display:flex; gap:8px; margin-top:auto; align-items:center; }

  /* round picker */
  .picker { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .picker h4 { font-size:12.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-2); margin-bottom:10px; }
  .pick-list { display:flex; flex-direction:column; gap:7px; max-height:48vh; overflow:auto; padding-right:4px; }
  .pick-row { display:flex; align-items:center; gap:9px; padding:9px 11px; border:1px solid var(--line-soft);
    border-radius:10px; background:var(--bg-1); }
  .pick-row .nm { flex:1; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pick-row .ct { color:var(--text-2); font-size:11.5px; white-space:nowrap; }
  .pick-row .reorder { display:flex; flex-direction:column; gap:1px; }
  .pick-row .reorder button, .icon-btn { width:24px;height:20px;border:1px solid var(--line);background:var(--bg-3);
    color:var(--text-1);border-radius:6px;cursor:pointer;font-size:11px;line-height:1;display:grid;place-items:center; }
  .icon-btn { width:26px;height:26px; }
  .icon-btn:hover { color:var(--text-0); }
  .pick-search { margin-bottom:9px; }
  .pick-row.col { flex-direction:column; align-items:stretch; gap:8px; }
  .pick-main { display:flex; align-items:center; gap:9px; }
  .pick-main .nm { flex:1; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pick-idx { width:20px;height:20px;border-radius:6px;background:var(--bg-3);display:grid;place-items:center;
    font-size:11px;font-weight:700;flex:none; }
  .pick-opts { display:flex; align-items:center; gap:8px; }
  .tiny-sel { width:auto; flex:1; padding:5px 9px; font-size:12.5px; border-radius:9px; }
  .pick-opts input.tiny-sel { max-width:110px; flex:none; }
  @media (max-width:680px){ .picker{grid-template-columns:1fr} }

  .ws-popmenu { min-width:180px; padding:6px; display:flex; flex-direction:column; gap:2px; box-shadow:var(--shadow-3); }
  .ws-popmenu-item { text-align:left; background:none; border:none; color:var(--text-0); font:inherit; font-weight:600;
    font-size:14px; padding:9px 11px; border-radius:9px; cursor:pointer; }
  .ws-popmenu-item:hover { background:var(--bg-3); }
  .ws-popmenu-item.danger { color:var(--bad); }
  ` }));
}
