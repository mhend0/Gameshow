// The Family Feud survey library, as a mountable panel.
//
// Lives here rather than inside a page so the game's settings screen and the
// standalone /surveys.html URL are the same code. Mount it into any container:
//
//   const panel = mountSurveys(document.getElementById("host"));
//   panel.destroy();
//
// The editor's promise is that the host types a question, some answers and
// (optionally) the points — and the board builds itself. The preview beside the
// fields is the real board component running the real ranking, so what they
// watch while typing is exactly what the TV will show.

import {
  SurveyRepo, suggestPoints, surveyTotal, surveyIssues, surveyIsPlayable, rankAnswers, FEUD_RULES,
} from "../../core/feud.js";
import { renderFeudBoard } from "../feud-board.js";
import { el, toast, modal, confirmDialog, timeAgo } from "../ui.js";
import { ensureFeudSeeded } from "../../core/feud-seed.js";

const DIFFICULTY = ["", "Easy", "Fairly easy", "Medium", "Tricky", "Hard"];

/**
 * @param {HTMLElement} root
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountSurveys(root) {
  ensureStyles();
  const state = { query: "", category: "", difficulty: 0, favouritesOnly: false, sort: "updated" };

  const count = el("div", { class: "sp-count" });
  const search = el("input", { placeholder: "Search questions, answers, categories & tags…", autocomplete: "off" });
  const favBtn = el("button", { class: "chip", text: "★ Favourites" });
  const diffSel = el("select", { class: "input" }, [
    el("option", { value: "0", text: "Any difficulty" }),
    ...DIFFICULTY.slice(1).map((d, i) => el("option", { value: String(i + 1), text: d })),
  ]);
  const sortSel = el("select", { class: "input" }, [
    el("option", { value: "updated", text: "Recently updated" }),
    el("option", { value: "created", text: "Newest" }),
    el("option", { value: "category", text: "Category" }),
    el("option", { value: "question", text: "Question (A–Z)" }),
    el("option", { value: "answers", text: "Most answers" }),
    el("option", { value: "difficulty", text: "Easiest first" }),
  ]);
  const catbar = el("div", { class: "sp-catbar" });
  const content = el("div");

  const newBtn = el("button", { class: "btn primary", text: "＋ New Survey" });
  const bulkBtn = el("button", { class: "btn", text: "⚡ Bulk add" });

  root.innerHTML = "";
  root.append(
    el("div", { class: "sp-head" }, [count, el("span", { class: "sp-spacer" }), bulkBtn, newBtn]),
    el("div", { class: "sp-toolbar" }, [
      el("div", { class: "search sp-search" }, [el("span", { text: "🔎" }), search]),
      favBtn,
      el("span", { class: "sp-spacer" }),
      diffSel,
      el("label", { class: "field-label", style: { color: "var(--text-2)" }, text: "Sort" }),
      sortSel,
    ]),
    catbar,
    content,
  );

  /* ---------------------------------------------------------------- cards */

  function surveyCard(survey) {
    const issues = surveyIssues(survey);
    const total = surveyTotal(survey);
    const fav = el("button", {
      class: `fav ${survey.meta?.favourite ? "on" : ""}`, html: survey.meta?.favourite ? "★" : "☆", title: "Favourite",
      onClick: (e) => { e.stopPropagation(); SurveyRepo.toggleFavourite(survey.id); },
    });

    const card = el("div", { class: "sv-card card" }, [
      el("div", { class: "sc-preview" }, [
        renderFeudBoard(survey, { compact: true, showQuestion: false, showTotal: false }),
      ]),
      el("div", { class: "sc-body" }, [
        el("div", { class: "sc-question", text: survey.question || "(no question yet)" }),
        el("div", { class: "sc-meta" }, [
          el("span", { class: "sc-cat", text: survey.category || "No category" }),
          el("span", { text: "·" }),
          el("span", { text: `${survey.answers.length} answer${survey.answers.length === 1 ? "" : "s"}` }),
          el("span", { text: "·" }),
          el("span", { class: total === 100 ? "" : "sc-off", text: `${total} pts` }),
          survey.meta?.difficulty ? el("span", { text: "·" }) : null,
          survey.meta?.difficulty ? el("span", { text: DIFFICULTY[survey.meta.difficulty] }) : null,
          el("span", { text: "·" }),
          el("span", { text: timeAgo(survey.updatedAt) }),
        ].filter(Boolean)),
        issues.length ? el("div", { class: "sc-warn", text: `⚠ ${issues[0]}` }) : null,
        (survey.meta?.tags || []).length
          ? el("div", { class: "sc-tags" }, survey.meta.tags.map((t) => el("span", { class: "sc-tag", text: t })))
          : null,
        el("div", { class: "sc-actions" }, [
          fav,
          el("span", { class: "sp-spacer" }),
          el("button", { class: "btn sm ghost", html: "⧉", title: "Duplicate", onClick: (e) => { e.stopPropagation(); SurveyRepo.duplicate(survey.id); toast("Survey duplicated"); } }),
          el("button", { class: "btn sm ghost", html: "🗑", title: "Delete", onClick: (e) => { e.stopPropagation(); removeSurvey(survey); } }),
          el("button", { class: "btn sm primary", text: "Edit", onClick: (e) => { e.stopPropagation(); editSurvey(survey); } }),
        ]),
      ].filter(Boolean)),
    ]);
    card.addEventListener("click", () => editSurvey(survey));
    return card;
  }

  async function removeSurvey(survey) {
    const ok = await confirmDialog({
      title: "Delete survey?",
      message: `“${survey.question}” will be removed, and dropped from any session that played it.`,
      confirmText: "Delete", danger: true,
    });
    if (ok) { SurveyRepo.remove(survey.id); toast("Survey deleted"); }
  }

  /* --------------------------------------------------------------- editor */

  /**
   * `survey` is null for a new one: nothing is written to the library until
   * Save, so cancelling out never leaves an empty survey behind.
   */
  function editSurvey(survey) {
    const existing = survey || null;
    // Rows are the editing model; the survey record is only built on save. Each
    // keeps the answer's id so editing an existing board doesn't re-id every
    // answer and break the running order's reveal state mid-show.
    let rows = (existing?.answers || []).map((a) => ({ id: a.id, text: a.text, points: a.points, alts: (a.alts || []).join(", ") }));
    if (!rows.length) rows = [blankRow(), blankRow(), blankRow(), blankRow()];

    const preview = el("div", { class: "ed-preview" });
    const status = el("div", { class: "ed-status" });
    const counts = el("div", { class: "ed-counts" });
    const rowsBox = el("div", { class: "ans-rows" });

    const qInput = el("textarea", { class: "input question", value: existing?.question || "", rows: 2, placeholder: "Name something people…" });
    const catInput = el("input", { class: "input", value: existing?.category || "", placeholder: "e.g. Everyday life, Work, Funny", list: "spCatList" });
    const catList = el("datalist", { id: "spCatList" }, SurveyRepo.allCategories().map((c) => el("option", { value: c })));
    const diffInput = el("select", { class: "input" }, DIFFICULTY.map((d, i) =>
      el("option", { value: String(i), text: i ? d : "Not set", ...(String(existing?.meta?.difficulty || 0) === String(i) ? { selected: "selected" } : {}) })));
    const tagsInput = el("input", { class: "input", value: (existing?.meta?.tags || []).join(", "), placeholder: "comma-separated" });
    const notesInput = el("textarea", { class: "input", value: existing?.meta?.notes || "", placeholder: "Host notes (never shown on the TV)", rows: 2 });

    const draft = () => ({
      question: qInput.value,
      category: catInput.value,
      answers: rows
        .filter((r) => r.text.trim())
        .map((r) => ({
          id: r.id,
          text: r.text.trim(),
          points: Math.max(0, Math.round(Number(r.points) || 0)),
          alts: r.alts.split(",").map((s) => s.trim()).filter(Boolean),
        })),
    });

    /** Redraw the board and the validation line, but never the rows. */
    function refreshPreview() {
      const d = draft();
      preview.innerHTML = "";
      preview.appendChild(renderFeudBoard(d, { showTotal: false }));

      const issues = surveyIssues(d);
      const total = surveyTotal(d);
      if (!d.answers.length) {
        status.className = "ed-status";
        status.textContent = "Add some answers to build the board.";
      } else if (issues.length) {
        status.className = "ed-status bad";
        status.textContent = `⚠ ${issues[0]}`;
      } else {
        status.className = "ed-status ok";
        status.textContent = total === 100 ? "✓ Ready to play" : `✓ Ready to play · ${total} points on the board`;
      }
      counts.innerHTML = d.answers.length
        ? `<span><b>${d.answers.length}</b> answers</span>
           <span><b>${total}</b> points</span>
           <span><b>${d.answers[0]?.points || 0}</b> top answer</span>`
        : "";
      save.disabled = issues.length > 0;
    }

    /** Redraw the answer rows. Called only when a row is added/removed/sorted. */
    function drawRows() {
      rowsBox.innerHTML = "";
      rows.forEach((row, i) => {
        const text = el("input", { class: "input", value: row.text, placeholder: `Answer ${i + 1}` });
        const points = el("input", { class: "input pts", value: row.points ? String(row.points) : "", placeholder: "—", inputmode: "numeric" });
        const alts = el("input", { class: "input alts", value: row.alts, placeholder: "also accept: …" });

        text.addEventListener("input", () => { row.text = text.value; refreshPreview(); });
        points.addEventListener("input", () => { row.points = points.value; refreshPreview(); });
        alts.addEventListener("input", () => { row.alts = alts.value; refreshPreview(); });
        // Enter at the end of the list adds the next row, so a whole board can
        // be typed without touching the mouse.
        text.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          if (i === rows.length - 1 && rows.length < FEUD_RULES.maxAnswers) addRow();
          else focusRow(i + 1);
        });

        rowsBox.appendChild(el("div", { class: "ans-row" }, [
          el("span", { class: "ans-n", text: String(i + 1) }),
          text, points, alts,
          el("button", {
            class: "btn sm ghost ans-del", html: "✕", title: "Remove this answer",
            onClick: () => { rows.splice(i, 1); if (!rows.length) rows.push(blankRow()); drawRows(); refreshPreview(); },
          }),
        ]));
      });
      addBtn.disabled = rows.length >= FEUD_RULES.maxAnswers;
    }

    function focusRow(i) {
      const input = rowsBox.children[i]?.querySelector("input");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
    function addRow() {
      rows.push(blankRow());
      drawRows();
      refreshPreview();
      focusRow(rows.length - 1);
    }

    const addBtn = el("button", { class: "btn sm", text: "＋ Add answer", onClick: addRow });
    const autoBtn = el("button", {
      class: "btn sm", text: "✨ Work out the points",
      title: "Fill in a believable survey ladder for the answers you've typed",
      onClick: () => {
        const filled = rows.filter((r) => r.text.trim());
        if (!filled.length) { toast("Type some answers first"); return; }
        const ladder = suggestPoints(filled.length);
        filled.forEach((r, i) => { r.points = ladder[i]; });
        drawRows();
        refreshPreview();
        toast("Points filled in — edit any of them");
      },
    });
    const sortBtn = el("button", {
      class: "btn sm ghost", text: "↓ Sort by points",
      title: "Put the rows in board order",
      onClick: () => {
        rows = rankAnswers(rows.map((r) => ({ ...r, points: Number(r.points) || 0 })))
          .map((r) => ({ ...r, points: r.points || "" }));
        drawRows();
        refreshPreview();
      },
    });

    const body = el("div", { class: "ed-grid" }, [
      el("div", { class: "ed-col" }, [preview, status, counts]),
      el("div", { class: "ed-fields" }, [
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Survey question" }), qInput]),
        el("div", { class: "ans-head" }, [
          el("span", { class: "field-label", text: "Answers & points" }),
          el("span", { class: "sp-spacer" }),
          autoBtn, sortBtn,
        ]),
        rowsBox,
        el("div", { style: { display: "flex", gap: "8px" } }, [addBtn]),
        el("p", { class: "ed-hint", style: { textAlign: "left", margin: "0" },
          text: "Leave the points blank and the app builds the ladder. “Also accept” is a comma-separated list of other wordings that should count as the same answer." }),
        el("div", { class: "ed-two" }, [
          el("label", { class: "field" }, [el("span", { class: "field-label", text: "Category" }), catInput, catList]),
          el("label", { class: "field" }, [el("span", { class: "field-label", text: "Difficulty" }), diffInput]),
        ]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Tags" }), tagsInput]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Notes" }), notesInput]),
      ]),
    ]);

    const save = el("button", { class: "btn primary", text: existing ? "Save survey" : "Add survey" });
    const m = modal({
      title: existing ? "Edit survey" : "New survey",
      wide: true, body,
      actions: [el("button", { class: "btn ghost", text: "Cancel", onClick: () => m.close() }), save],
    });

    save.addEventListener("click", () => {
      const d = draft();
      const difficulty = Number(diffInput.value) || 0;
      const meta = {
        ...(existing?.meta || {}),
        tags: tagsInput.value.split(",").map((s) => s.trim()).filter(Boolean),
        notes: notesInput.value,
      };
      if (difficulty) meta.difficulty = difficulty; else delete meta.difficulty;

      if (existing) SurveyRepo.update(existing.id, { ...d, meta });
      else SurveyRepo.create({ ...d, meta });
      m.close();
      toast(existing ? "Survey saved" : "Survey added");
    });
    qInput.addEventListener("input", refreshPreview);
    catInput.addEventListener("input", refreshPreview);
    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !save.disabled) { e.preventDefault(); save.click(); }
    });

    drawRows();
    refreshPreview();
    setTimeout(() => qInput.focus(), 40);
  }

  const blankRow = () => ({ id: null, text: "", points: "", alts: "" });
  const newSurvey = () => editSurvey(null);

  /* ------------------------------------------------------------ bulk add */

  /**
   * Prepping a night means typing a lot of surveys; one box beats twenty
   * modals. A question on its own line, its answers indented or bulleted
   * under it, a blank line between surveys — which is how people already
   * write them down.
   */
  function bulkAdd() {
    const area = el("textarea", {
      class: "input bulk-area",
      placeholder: `Name something people do when they wake up
Check their phone | 34
Hit snooze | 22
Stretch | 14

Name a reason to be late for work
Traffic
Overslept
Car trouble

(Points are optional — leave them off and the app builds the ladder.)`,
    });
    const catInput = el("input", { class: "input", placeholder: "Category for all of these" });
    const report = el("div", { class: "ed-status" });

    /** Blank lines separate surveys; the first line of a block is the question. */
    function parse() {
      const blocks = area.value.split(/\n\s*\n/);
      const out = [];
      for (const block of blocks) {
        const lines = block.split("\n").map((l) => l.replace(/^\s*[-*•\d.)\s]+/, "").trim()).filter(Boolean);
        if (lines.length < 2) continue;
        const [question, ...answerLines] = lines;
        const answers = answerLines.map((line) => {
          const bar = line.lastIndexOf("|");
          const hasPoints = bar >= 0 && /^\s*\d+\s*$/.test(line.slice(bar + 1));
          return {
            text: (hasPoints ? line.slice(0, bar) : line).trim(),
            points: hasPoints ? parseInt(line.slice(bar + 1), 10) : 0,
            alts: [],
          };
        }).filter((a) => a.text);
        if (!answers.length) continue;
        if (answers.every((a) => !a.points)) {
          const ladder = suggestPoints(answers.length);
          answers.forEach((a, i) => { a.points = ladder[i]; });
        }
        out.push({ question, answers, issues: surveyIssues({ question, answers }) });
      }
      return out;
    }

    const preview = () => {
      const rows = parse();
      const bad = rows.filter((r) => r.issues.length);
      report.className = `ed-status ${bad.length ? "bad" : rows.length ? "ok" : ""}`;
      report.textContent = !rows.length
        ? "Nothing to add yet — a question, then its answers, then a blank line."
        : bad.length
          ? `${rows.length - bad.length} ready · ${bad.length} incomplete and will be skipped`
          : `✓ ${rows.length} survey${rows.length === 1 ? "" : "s"} ready`;
      add.disabled = !rows.some((r) => !r.issues.length);
    };
    area.addEventListener("input", preview);

    const add = el("button", { class: "btn primary", text: "Add surveys" });
    const m = modal({
      title: "⚡ Bulk add surveys", wide: true,
      body: el("div", { class: "ed-fields" }, [
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Surveys" }), area]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Category" }), catInput]),
        report,
      ]),
      actions: [el("button", { class: "btn ghost", text: "Cancel", onClick: () => m.close() }), add],
    });
    add.addEventListener("click", () => {
      const rows = parse().filter((r) => !r.issues.length);
      rows.forEach((r) => SurveyRepo.create({ question: r.question, answers: r.answers, category: catInput.value.trim() }));
      m.close();
      toast(`Added ${rows.length} survey${rows.length === 1 ? "" : "s"}`);
    });
    preview();
    setTimeout(() => area.focus(), 40);
  }

  /* -------------------------------------------------------------- filters */

  function renderCategories() {
    const cats = SurveyRepo.allCategories();
    catbar.innerHTML = "";
    if (!cats.length) { catbar.style.display = "none"; return; }
    catbar.style.display = "flex";
    catbar.appendChild(el("span", {
      class: "chip" + (state.category === "" ? " active" : ""), text: "All categories",
      onClick: () => { state.category = ""; render(); },
    }));
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
    const all = SurveyRepo.list();
    const list = SurveyRepo.query(state);
    const playable = all.filter(surveyIsPlayable).length;
    count.textContent = `${all.length} survey${all.length === 1 ? "" : "s"} · ${playable} ready to play`;

    content.innerHTML = "";
    if (!all.length) {
      content.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big", text: "👪" }),
        el("div", { html: "<strong>No surveys yet</strong>" }),
        el("p", { text: "Type a question and its answers — the board builds itself." }),
        el("div", { style: { display: "flex", gap: "10px", justifyContent: "center", marginTop: "12px" } }, [
          el("button", { class: "btn primary", text: "＋ New Survey", onClick: newSurvey }),
          el("button", { class: "btn", text: "⚡ Bulk add", onClick: bulkAdd }),
        ]),
      ]));
      return;
    }
    if (!list.length) {
      content.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big", text: "🔍" }),
        el("p", { text: "No surveys match your filters." }),
      ]));
      return;
    }
    const grid = el("div", { class: "sv-grid" });
    list.forEach((s, i) => {
      const c = surveyCard(s);
      c.classList.add("fade");
      c.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
      grid.appendChild(c);
    });
    content.appendChild(grid);
  }

  newBtn.addEventListener("click", newSurvey);
  bulkBtn.addEventListener("click", bulkAdd);
  search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
  sortSel.addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  diffSel.addEventListener("change", (e) => { state.difficulty = Number(e.target.value) || 0; render(); });
  favBtn.addEventListener("click", () => { state.favouritesOnly = !state.favouritesOnly; render(); });

  const unsubscribe = SurveyRepo.subscribe(render);
  ensureFeudSeeded();   // synchronous — first-run surveys are ready before this returns
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
  document.head.appendChild(el("style", { id: "sp-styles", html: `
  .sp-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
  .sp-count { color:var(--text-2); font-size:13.5px; font-weight:600; }
  .sp-spacer { flex:1; }
  .sp-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
  .sp-toolbar select.input { width:auto; padding-right:34px; cursor:pointer; }
  .sp-search { flex:1; max-width:420px; }
  .sp-catbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:20px; }

  .sv-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:18px; padding-bottom:40px; }
  .sv-card { position:relative; display:flex; flex-direction:column; padding:0; overflow:hidden; cursor:pointer;
    transition:transform .2s var(--ease), box-shadow .2s var(--ease), border-color .2s var(--ease); }
  .sv-card:hover { transform:translateY(-4px); box-shadow:var(--shadow-3); border-color:var(--line); }
  .sc-preview { padding:14px 14px 12px; border-bottom:1px solid var(--line-soft);
    background:radial-gradient(120% 120% at 0 0, color-mix(in srgb,var(--accent) 14%,transparent), transparent 62%), var(--bg-0); }
  .sc-body { padding:14px 16px 16px; display:flex; flex-direction:column; gap:9px; flex:1; }
  .sc-question { font-size:15px; font-weight:700; letter-spacing:-.01em; line-height:1.3; }
  .sc-meta { display:flex; align-items:center; gap:8px; color:var(--text-2); font-size:12.5px; font-weight:600; flex-wrap:wrap; }
  .sc-cat { color:color-mix(in srgb,var(--accent) 78%,var(--text-0)); }
  .sc-off { color:var(--warn); }
  .sc-warn { color:var(--warn); font-size:12.5px; font-weight:600; }
  .sc-tags { display:flex; gap:6px; flex-wrap:wrap; }
  .sc-tag { font-size:11px; font-weight:700; color:var(--text-1); background:var(--bg-3); border:1px solid var(--line-soft); padding:2px 8px; border-radius:999px; }
  .sc-actions { display:flex; align-items:center; gap:6px; margin-top:auto; padding-top:4px; }
  .fav { cursor:pointer; font-size:18px; line-height:1; background:none; border:none; padding:2px; filter:grayscale(1) opacity(.5); transition:all .2s var(--ease); }
  .fav.on { filter:none; }
  .fav:hover { transform:scale(1.15); }

  /* editor — the board on one side, the fields that drive it on the other */
  .ed-grid { display:grid; gap:18px; align-items:start; }
  .ed-preview { background:var(--bg-0); border:1px solid var(--line-soft); border-radius:var(--r-md);
    padding:14px; width:100%; max-width:480px; margin:0 auto; }
  .ed-col { display:flex; flex-direction:column; gap:10px; min-width:0; position:sticky; top:0; }
  .ed-fields { display:flex; flex-direction:column; gap:14px; min-width:0; }
  .ed-two { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .ed-hint { color:var(--text-2); font-size:12.5px; text-align:center; }
  .ed-status { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; min-height:20px; justify-content:center; }
  .ed-status.ok { color:var(--good); }
  .ed-status.bad { color:var(--bad); }
  .ed-counts { display:flex; gap:14px; flex-wrap:wrap; justify-content:center; color:var(--text-2); font-size:12.5px; font-weight:600; }
  .ed-counts b { color:var(--text-0); }
  textarea.question { font-size:16px; font-weight:600; resize:vertical; min-height:52px; }
  @media (min-width:860px){ .ed-grid { grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr); } }

  .ans-head { display:flex; align-items:center; gap:8px; }
  .ans-rows { display:flex; flex-direction:column; gap:7px; }
  .ans-row { display:grid; grid-template-columns:20px minmax(0,1fr) 62px minmax(0,.8fr) 32px; gap:7px; align-items:center; }
  .ans-n { color:var(--text-2); font-size:12px; font-weight:800; text-align:center; }
  .ans-row .input { padding:8px 11px; font-size:14px; }
  .ans-row .pts { text-align:center; font-weight:800; font-variant-numeric:tabular-nums; }
  .ans-row .alts { font-size:12.5px; color:var(--text-1); }
  .ans-del { width:30px; height:30px; padding:0; justify-content:center; opacity:.55; }
  .ans-del:hover { opacity:1; color:var(--bad); }
  @media (max-width:640px){
    .ans-row { grid-template-columns:20px minmax(0,1fr) 58px 30px; }
    .ans-row .alts { grid-column:2 / -1; }
    .ed-two { grid-template-columns:1fr; }
  }

  .bulk-area { min-height:230px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13.5px; }
  ` }));
}
