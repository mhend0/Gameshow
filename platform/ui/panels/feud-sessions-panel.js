// The Family Feud session planner, as a mountable panel.
// Shared by the game's settings screen and the standalone /feud-sessions.html URL.
//
// A session is a night: the surveys that play as rounds, what each round is
// worth (single, double, triple), and the five surveys on the Fast Money card.
// Sessions *reference* the library, so one survey can play in many nights.

import {
  FeudSessionRepo, SurveyRepo, makeFeudRound, defaultMultiplier,
  surveyIssues, surveyIsPlayable, surveyTotal, FEUD_RULES,
} from "../../core/feud.js";
import { el, toast, modal, confirmDialog, promptDialog, timeAgo } from "../ui.js";
import { ensureFeudSeeded } from "../../core/feud-seed.js";

const MULTIPLIERS = [
  { value: 1, label: "Single" },
  { value: 2, label: "Double" },
  { value: 3, label: "Triple" },
];
const multLabel = (m) => (MULTIPLIERS.find((x) => x.value === m) || MULTIPLIERS[0]).label;

/**
 * @param {HTMLElement} root
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountFeudSessions(root) {
  ensureStyles();

  const newBtn = el("button", { class: "btn primary", text: "＋ New Session" });
  const blurb = el("div", { class: "fs-blurb", text: "A running order of surveys — one per round, each worth single, double or triple — plus the Fast Money card." });
  const content = el("div");

  root.innerHTML = "";
  root.append(
    el("div", { class: "fs-head" }, [blurb, el("span", { class: "fs-spacer" }), newBtn]),
    content,
  );

  const launch = (session) => { location.href = `feud.html?screen=control&session=${session.id}`; };

  /* ----------------------------------------------------------------- cards */

  function sessionCard(session) {
    const rounds = FeudSessionRepo.resolveRounds(session.id);
    const fast = FeudSessionRepo.resolveFastMoney(session.id);
    const missing = (session.rounds || []).length - rounds.length;
    const notReady = rounds.filter((r) => !surveyIsPlayable(r.survey)).length;

    const list = rounds.length
      ? el("div", { class: "fs-rounds" }, rounds.map((r, i) =>
          el("div", { class: "fs-round" }, [
            el("span", { class: "idx", text: String(i + 1) }),
            el("span", { class: "nm", text: r.survey.question }),
            r.multiplier > 1 ? el("span", { class: `mult m${r.multiplier}`, text: `×${r.multiplier}` }) : null,
            el("span", { class: "ct", text: `${r.survey.answers.length} answers` }),
          ].filter(Boolean))))
      : el("div", { class: "fs-empty", text: "No rounds yet — add surveys to play." });

    return el("div", { class: "fs-card card" }, [
      el("div", { class: "fs-card-head" }, [
        el("div", { class: "fs-glyph", text: "👪" }),
        el("div", { style: { flex: 1 } }, [
          el("div", { class: "fs-title", text: session.name }),
          el("div", { class: "fs-meta", text:
            `${rounds.length} round${rounds.length === 1 ? "" : "s"}`
            + (fast.length ? ` · ⚡ ${fast.length}/${FEUD_RULES.fastMoney.questions}` : " · no Fast Money")
            + (missing > 0 ? ` · ${missing} missing` : "")
            + (notReady > 0 ? ` · ${notReady} incomplete` : "")
            + ` · ${timeAgo(session.updatedAt)}` }),
        ]),
        el("button", { class: "fs-icon-btn", html: "⋯", title: "More", onClick: (e) => menu(session, e.currentTarget) }),
      ]),
      list,
      el("div", { class: "fs-actions" }, [
        el("button", { class: "btn sm", text: "Edit rounds", onClick: () => editSession(session) }),
        el("span", { class: "fs-spacer" }),
        el("button", { class: "btn sm primary", text: "▶ Launch", disabled: rounds.length ? null : "", onClick: () => launch(session) }),
      ]),
    ]);
  }

  function menu(session, anchor) {
    const items = [
      { label: "Rename", fn: async () => {
        const n = await promptDialog({ title: "Rename session", label: "Session name", value: session.name });
        if (n) FeudSessionRepo.rename(session.id, n);
      } },
      { label: "Duplicate", fn: () => { FeudSessionRepo.duplicate(session.id); toast("Session duplicated"); } },
      { label: "Delete", danger: true, fn: async () => {
        const ok = await confirmDialog({
          title: "Delete session?",
          message: `“${session.name}” will be removed. The surveys it references are not deleted.`,
          confirmText: "Delete", danger: true,
        });
        if (ok) { FeudSessionRepo.remove(session.id); toast("Session deleted"); }
      } },
    ];
    const list = el("div", { class: "fs-popmenu card" }, items.map((it) =>
      el("button", { class: `fs-popmenu-item ${it.danger ? "danger" : ""}`, text: it.label, onClick: () => { closePop(); it.fn(); } })));
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

  /* ---- session editor: the running order, the card, and the library ------ */

  function editSession(session) {
    let chosen = (session.rounds || []).map((r) => ({ ...r }));
    let fastIds = [...(session.fastMoneyIds || [])];
    let filter = "";

    const roundsBox = el("div", { class: "fs-pick-list" });
    const fastBox = el("div", { class: "fs-pick-list short" });
    const libBox = el("div", { class: "fs-pick-list tall" });
    const fastHead = el("h4", {});
    const search = el("input", { class: "input fs-pick-search", placeholder: "Search the library…" });
    search.addEventListener("input", () => { filter = search.value.toLowerCase(); render(); });

    function render() {
      const lib = SurveyRepo.list();
      const byId = new Map(lib.map((s) => [s.id, s]));
      roundsBox.innerHTML = ""; fastBox.innerHTML = ""; libBox.innerHTML = "";

      /* ---- the running order ---- */
      if (!chosen.length) roundsBox.appendChild(el("div", { class: "fs-empty", text: "No rounds yet. Add surveys from the library →" }));
      chosen.forEach((r, i) => {
        const s = byId.get(r.surveyId);
        // The multiplier lives per round, so one survey can be a single round
        // one night and a triple the next.
        const multSel = el("select", { class: "input fs-tiny-sel", title: "What this round is worth" },
          MULTIPLIERS.map((m) => el("option", { value: String(m.value), text: `${m.label} ×${m.value}` })));
        multSel.value = String(r.multiplier || 1);
        multSel.addEventListener("change", () => { chosen[i] = { ...chosen[i], multiplier: Number(multSel.value) || 1 }; });

        const issues = s ? surveyIssues(s) : ["This survey was deleted."];
        roundsBox.appendChild(el("div", { class: "fs-pick-row col" }, [
          el("div", { class: "fs-pick-main" }, [
            el("span", { class: "fs-pick-idx", text: String(i + 1) }),
            el("span", { class: "nm", text: s ? s.question : "(survey deleted)" }),
            el("div", { class: "fs-reorder" }, [
              el("button", { html: "▲", title: "Up", disabled: i === 0 ? "" : null, onClick: () => { [chosen[i - 1], chosen[i]] = [chosen[i], chosen[i - 1]]; render(); } }),
              el("button", { html: "▼", title: "Down", disabled: i === chosen.length - 1 ? "" : null, onClick: () => { [chosen[i + 1], chosen[i]] = [chosen[i], chosen[i + 1]]; render(); } }),
            ]),
            el("button", { class: "fs-icon-btn", html: "✕", title: "Remove", onClick: () => { chosen.splice(i, 1); render(); } }),
          ]),
          el("div", { class: "fs-pick-opts" }, [
            multSel,
            issues.length
              ? el("span", { class: "ct warn", text: `⚠ ${issues[0]}` })
              : el("span", { class: "ct", text: `${s.answers.length} answers · ${surveyTotal(s)} pts` }),
          ]),
        ]));
      });

      /* ---- the Fast Money card ---- */
      const target = FEUD_RULES.fastMoney.questions;
      fastHead.textContent = `⚡ Fast Money — ${fastIds.length}/${target}`;
      fastHead.className = fastIds.length === target ? "ok" : "";
      if (!fastIds.length) fastBox.appendChild(el("div", { class: "fs-empty", text: `Pick ${target} short surveys for the Fast Money card.` }));
      fastIds.forEach((id, i) => {
        const s = byId.get(id);
        fastBox.appendChild(el("div", { class: "fs-pick-row" }, [
          el("span", { class: "fs-pick-idx", text: String(i + 1) }),
          el("span", { class: "nm", text: s ? s.question : "(survey deleted)" }),
          el("div", { class: "fs-reorder" }, [
            el("button", { html: "▲", title: "Up", disabled: i === 0 ? "" : null, onClick: () => { [fastIds[i - 1], fastIds[i]] = [fastIds[i], fastIds[i - 1]]; render(); } }),
            el("button", { html: "▼", title: "Down", disabled: i === fastIds.length - 1 ? "" : null, onClick: () => { [fastIds[i + 1], fastIds[i]] = [fastIds[i], fastIds[i + 1]]; render(); } }),
          ]),
          el("button", { class: "fs-icon-btn", html: "✕", title: "Remove", onClick: () => { fastIds.splice(i, 1); render(); } }),
        ]));
      });

      /* ---- the library ---- */
      const usedRounds = new Set(chosen.map((r) => r.surveyId));
      const usedFast = new Set(fastIds);
      const available = lib
        .filter((s) => !filter
          || s.question.toLowerCase().includes(filter)
          || (s.category || "").toLowerCase().includes(filter)
          || s.answers.some((a) => a.text.toLowerCase().includes(filter)));
      if (!available.length) libBox.appendChild(el("div", { class: "fs-empty", text: filter ? "Nothing matches." : "The survey library is empty." }));
      available.forEach((s) => {
        const broken = !surveyIsPlayable(s);
        libBox.appendChild(el("div", { class: `fs-pick-row ${broken ? "broken" : ""}` }, [
          el("span", { class: "nm", text: s.question }),
          el("span", { class: "ct", text: s.category || "—" }),
          el("button", {
            class: "fs-icon-btn", html: "＋", title: usedRounds.has(s.id) ? "Already a round — add it again" : "Add as a round",
            onClick: () => { chosen.push(makeFeudRound({ surveyId: s.id, multiplier: defaultMultiplier(chosen.length) })); render(); },
          }),
          el("button", {
            class: `fs-icon-btn ${usedFast.has(s.id) ? "on" : ""}`, html: "⚡", title: "Put on the Fast Money card",
            disabled: usedFast.has(s.id) ? "" : null,
            onClick: () => { fastIds.push(s.id); render(); },
          }),
        ]));
      });
    }

    const body = el("div", { class: "fs-picker" }, [
      el("div", { class: "fs-pick-col" }, [
        el("h4", { text: "Running order" }), roundsBox,
        fastHead, fastBox,
      ]),
      el("div", { class: "fs-pick-col" }, [el("h4", { text: "Survey library" }), search, libBox]),
    ]);
    render();

    const save = el("button", { class: "btn primary", text: "Save session" });
    const m = modal({
      title: `Edit · ${session.name}`, wide: true, body,
      actions: [el("button", { class: "btn ghost", text: "Cancel", onClick: () => m.close() }), save],
    });
    save.addEventListener("click", () => {
      const next = FeudSessionRepo.get(session.id);
      if (next) FeudSessionRepo.save({ ...next, rounds: chosen, fastMoneyIds: fastIds });
      m.close();
      toast("Session saved");
    });
  }

  async function newSession() {
    const name = await promptDialog({ title: "New Feud session", label: "Session name", value: "Feud Night", confirmText: "Create" });
    if (!name) return;
    const s = FeudSessionRepo.create({ name });
    editSession(s);
  }

  function render() {
    const list = FeudSessionRepo.list().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    content.innerHTML = "";
    if (!list.length) {
      content.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big", text: "👪" }),
        el("div", { html: "<strong>No Feud sessions yet</strong>" }),
        el("p", { text: "A session is a running order of surveys — one per round — plus the Fast Money card." }),
        el("button", { class: "btn primary", text: "＋ New Session", style: { marginTop: "12px" }, onClick: newSession }),
      ]));
      return;
    }
    const grid = el("div", { class: "fs-list" });
    list.forEach((s, i) => {
      const c = sessionCard(s);
      c.classList.add("fade");
      c.style.animationDelay = `${Math.min(i * 0.04, 0.3)}s`;
      grid.appendChild(c);
    });
    content.appendChild(grid);
  }

  newBtn.addEventListener("click", newSession);
  const offSessions = FeudSessionRepo.subscribe(render);
  const offSurveys = SurveyRepo.subscribe(render);
  ensureFeudSeeded();   // synchronous — first-run surveys are ready before this returns
  render();

  return {
    refresh: render,
    destroy() { closePop(); offSessions && offSessions(); offSurveys && offSurveys(); root.innerHTML = ""; },
  };
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { id: "fs-styles", html: `
  .fs-head { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
  .fs-blurb { color:var(--text-2); font-size:13.5px; max-width:640px; }
  .fs-spacer { flex:1; }

  .fs-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:18px; padding-bottom:40px; }
  .fs-card { display:flex; flex-direction:column; padding:20px; gap:14px; }
  .fs-card-head { display:flex; align-items:flex-start; gap:12px; }
  .fs-glyph { width:46px;height:46px;border-radius:13px;display:grid;place-items:center;font-size:22px;flex:none;
    background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:var(--shadow-2),inset 0 1px 0 rgba(255,255,255,.25); }
  .fs-title { font-size:18px; font-weight:700; }
  .fs-meta { color:var(--text-2); font-size:12.5px; font-weight:600; margin-top:2px; }
  .fs-rounds { display:flex; flex-direction:column; gap:6px; }
  .fs-round { display:flex; align-items:center; gap:10px; padding:8px 11px; background:var(--bg-1);
    border:1px solid var(--line-soft); border-radius:10px; font-size:13.5px; }
  .fs-round .idx { width:20px;height:20px;border-radius:6px;background:var(--bg-3);display:grid;place-items:center;
    font-size:11px;font-weight:700;color:var(--text-1);flex:none; }
  .fs-round .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fs-round .ct { color:var(--text-2); font-size:11.5px; white-space:nowrap; }
  .fs-round .mult { font-weight:800; font-size:11.5px; padding:2px 7px; border-radius:999px; flex:none;
    color:#1a1206; background:linear-gradient(135deg,#ffcf5c,#ff9f3d); }
  .fs-round .mult.m3 { background:linear-gradient(135deg,#ff8a3d,#f0453b); color:#fff; }
  .fs-empty { color:var(--text-2); font-size:13px; padding:8px 0; }
  .fs-actions { display:flex; gap:8px; margin-top:auto; align-items:center; }

  /* round picker */
  .fs-picker { display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; }
  .fs-pick-col { min-width:0; }
  .fs-picker h4 { font-size:12.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-2);
    margin:0 0 10px; }
  .fs-picker h4.ok { color:var(--good); }
  .fs-pick-col h4 + .fs-pick-list { margin-bottom:16px; }
  .fs-pick-list { display:flex; flex-direction:column; gap:7px; max-height:34vh; overflow:auto; padding-right:4px; }
  .fs-pick-list.short { max-height:22vh; }
  .fs-pick-list.tall { max-height:56vh; }
  .fs-pick-row { display:flex; align-items:center; gap:9px; padding:9px 11px; border:1px solid var(--line-soft);
    border-radius:10px; background:var(--bg-1); }
  .fs-pick-row.broken { opacity:.55; }
  .fs-pick-row .nm { flex:1; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fs-pick-row .ct { color:var(--text-2); font-size:11.5px; white-space:nowrap; }
  .fs-pick-row .ct.warn { color:var(--warn); }
  .fs-reorder { display:flex; flex-direction:column; gap:1px; }
  .fs-reorder button, .fs-icon-btn { width:24px;height:20px;border:1px solid var(--line);background:var(--bg-3);
    color:var(--text-1);border-radius:6px;cursor:pointer;font-size:11px;line-height:1;display:grid;place-items:center;
    font-family:inherit; }
  .fs-icon-btn { width:26px;height:26px;flex:none; }
  .fs-icon-btn:hover { color:var(--text-0); }
  .fs-icon-btn.on { color:var(--gold); border-color:color-mix(in srgb,var(--gold) 40%,var(--line)); }
  .fs-icon-btn[disabled], .fs-reorder button[disabled] { opacity:.35; pointer-events:none; }
  .fs-pick-search { margin-bottom:9px; }
  .fs-pick-row.col { flex-direction:column; align-items:stretch; gap:8px; }
  .fs-pick-main { display:flex; align-items:center; gap:9px; }
  .fs-pick-main .nm { flex:1; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fs-pick-idx { width:20px;height:20px;border-radius:6px;background:var(--bg-3);display:grid;place-items:center;
    font-size:11px;font-weight:700;flex:none; }
  .fs-pick-opts { display:flex; align-items:center; gap:8px; }
  .fs-tiny-sel { width:auto; flex:none; max-width:140px; padding:5px 9px; font-size:12.5px; border-radius:9px; }
  @media (max-width:680px){ .fs-picker{grid-template-columns:1fr} }

  .fs-popmenu { min-width:180px; padding:6px; display:flex; flex-direction:column; gap:2px; box-shadow:var(--shadow-3); }
  .fs-popmenu-item { text-align:left; background:none; border:none; color:var(--text-0); font:inherit; font-weight:600;
    font-size:14px; padding:9px 11px; border-radius:9px; cursor:pointer; }
  .fs-popmenu-item:hover { background:var(--bg-3); }
  .fs-popmenu-item.danger { color:var(--bad); }
  ` }));
}
