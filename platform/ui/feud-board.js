// The Family Feud answer board — one renderer, used everywhere.
//
// The library preview, the survey editor, the host's control screen and the TV
// all build the board through this component, so a survey looks identical
// wherever it appears and there is a single place to evolve the look.
//
// Reveal is driven by *state*, not by events: you hand it the set of answer ids
// that are face-up and it works out which slots still need to turn. That makes
// it idempotent — a dropped message, a reloaded window or a late-joining TV all
// self-correct the next time the set is applied, which is the same contract the
// rest of the platform relies on.
//
// Sizing is done in container-query units throughout, so the same board is a
// 300px card in the library and a wall-filling board on the TV with no second
// set of styles and no JavaScript measuring anything.

import { el } from "./ui.js";
import { rankAnswers } from "../core/feud.js";

/** ms for one slot's flip. */
const FLIP_MS = 520;
/** ms between consecutive slots turning when several land at once. */
const STAGGER = 110;

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.revealed]     Start with every answer showing (previews).
 * @param {boolean} [opts.compact]      Tighter chrome for small previews.
 * @param {boolean} [opts.showQuestion] Render the question plaque above the board.
 * @param {boolean} [opts.showTotal]    Render the running total plaque.
 * @param {boolean} [opts.numbersOnly]  Hidden slots show only their rank (the TV);
 *                                      the host's board shows the answer greyed out.
 * @param {(info:{answer:Object, index:number})=>void} [opts.onReveal]  Per slot as it turns.
 */
export function createFeudBoard(opts = {}) {
  const {
    revealed: startRevealed = false,
    compact = false,
    showQuestion = true,
    showTotal = true,
    numbersOnly = true,
    onReveal = null,
  } = opts;
  ensureStyles();

  const questionText = el("span", { class: "fb-q-text" });
  const question = el("div", { class: "fb-question" }, [questionText]);
  const grid = el("div", { class: "fb-grid" });
  const totalNum = el("span", { class: "fb-total-num", text: "0" });
  const totalMult = el("span", { class: "fb-total-mult" });
  const total = el("div", { class: "fb-total" }, [totalNum, totalMult]);
  const strikes = el("div", { class: "fb-strikes" });

  const frame = el("div", { class: `fb ${compact ? "compact" : ""} ${numbersOnly ? "" : "host"}` }, [
    showQuestion ? question : null,
    el("div", { class: "fb-frame" }, [grid, strikes]),
    showTotal ? total : null,
  ].filter(Boolean));

  /** @type {Object[]} answers in board order */
  let answers = [];
  /** slot elements, index-aligned with `answers` */
  let slotEls = [];
  /** ids currently face-up */
  let shown = new Set();
  let timers = [];
  let multiplier = 1;

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };

  /* ----------------------------------------------------------- building */

  /** Rebuild the board for a survey. Everything starts hidden unless `revealed`. */
  function setSurvey(survey, { revealed = startRevealed } = {}) {
    clearTimers();
    answers = rankAnswers(survey?.answers || []);
    setQuestion(survey?.question || "");
    grid.innerHTML = "";
    slotEls = [];
    shown = new Set();
    setStrikes(0);
    frame.classList.remove("cleared");

    // Eight answers read as two columns of four, the way the set is built; a
    // short board stays in one column so it doesn't look half-empty.
    grid.dataset.cols = answers.length > 5 ? "2" : "1";
    grid.style.setProperty("--fb-rows", String(Math.ceil(answers.length / (answers.length > 5 ? 2 : 1))));

    answers.forEach((answer, i) => {
      const slot = el("div", {
        class: "fb-slot",
        dataset: { id: answer.id, index: String(i) },
      }, [
        el("div", { class: "fb-flip" }, [
          el("div", { class: "fb-face fb-front" }, [
            el("span", { class: "fb-rank", text: String(i + 1) }),
            el("span", { class: "fb-ghost", text: answer.text }),
          ]),
          el("div", { class: "fb-face fb-back" }, [
            el("span", { class: "fb-answer", text: answer.text }),
            el("span", { class: "fb-points", text: String(answer.points) }),
          ]),
        ]),
      ]);
      grid.appendChild(slot);
      slotEls.push(slot);
    });

    if (revealed) revealAll({ animate: false, celebrate: false });
    else renderTotal();
    return answers;
  }

  function setQuestion(text) {
    const t = String(text || "").trim();
    questionText.textContent = t || "—";
    question.classList.toggle("empty", !t);
  }

  /* ------------------------------------------------------------ reveals */

  function turnSlot(slot, delay, { celebrate = true } = {}) {
    const go = () => {
      slot.classList.add("open");
      if (!celebrate) return;
      slot.classList.add("just");
      later(() => slot.classList.remove("just"), FLIP_MS + 320);
    };
    if (delay) later(go, delay); else go();
  }

  /**
   * Bring the board in line with what has been revealed.
   * @param {Set<string>|string[]} ids   Answer ids that are face-up.
   * @param {{animate?:boolean}} [o]
   * @returns {number} how many slots turned (0 when already in sync).
   */
  function applyRevealed(ids, { animate = true } = {}) {
    const want = new Set([...(ids || [])]);
    let turned = 0;

    answers.forEach((answer, i) => {
      const slot = slotEls[i];
      if (!slot) return;
      const isOpen = shown.has(answer.id);
      if (want.has(answer.id) && !isOpen) {
        shown.add(answer.id);
        turnSlot(slot, animate ? turned * STAGGER : 0, { celebrate: animate });
        if (onReveal) {
          const at = turned * STAGGER;
          if (animate && at) later(() => onReveal({ answer, index: i }), at);
          else onReveal({ answer, index: i });
        }
        turned++;
      } else if (!want.has(answer.id) && isOpen) {
        // The host undoing a reveal, or a round reset.
        shown.delete(answer.id);
        slot.classList.remove("open", "just", "steal");
      }
    });

    renderTotal();
    if (want.size && want.size === answers.length) frame.classList.add("cleared");
    else frame.classList.remove("cleared");
    return turned;
  }

  /** Turn one answer over by index or id. */
  function reveal(which, o = {}) {
    const answer = typeof which === "number" ? answers[which] : answers.find((a) => a.id === which);
    if (!answer) return 0;
    return applyRevealed([...shown, answer.id], o);
  }

  /** Show the whole board — the end of a round. */
  function revealAll({ animate = true, celebrate = animate } = {}) {
    const before = shown.size;
    // The last sweep turns slowly and in order, so it reads as one motion
    // rather than everything snapping over at once.
    const pending = answers.filter((a) => !shown.has(a.id));
    if (!pending.length) return 0;
    pending.forEach((a, i) => {
      shown.add(a.id);
      const slot = slotEls[answers.indexOf(a)];
      if (slot) turnSlot(slot, animate ? i * (STAGGER + 60) : 0, { celebrate });
    });
    renderTotal();
    if (celebrate) frame.classList.add("cleared");
    return shown.size - before;
  }

  /** Mark a revealed answer as the one that won the steal. */
  function markSteal(id) {
    const slot = slotEls[answers.findIndex((a) => a.id === id)];
    if (slot) slot.classList.add("steal");
  }

  /* ------------------------------------------------------------ strikes */

  /** Persistent strike count shown as X's over the board. */
  function setStrikes(n) {
    const count = Math.max(0, Math.min(3, Math.round(Number(n) || 0)));
    strikes.innerHTML = "";
    strikes.classList.toggle("show", count > 0);
    for (let i = 0; i < count; i++) strikes.appendChild(el("span", { class: "fb-x", text: "✗" }));
  }

  /**
   * A miss: throw the X's up big, shake the board, then settle back to the
   * persistent count. `n` is the strike number this miss just made.
   */
  function flashStrike(n) {
    setStrikes(n);
    strikes.classList.add("flash");
    frame.classList.remove("nudge");
    void frame.offsetWidth;                     // restart the animation
    frame.classList.add("nudge");
    later(() => strikes.classList.remove("flash"), 1100);
  }

  /** Three X's, full screen, for the strike that loses the board. */
  function flashTripleStrike() {
    flashStrike(3);
    strikes.classList.add("triple");
    later(() => strikes.classList.remove("triple"), 1600);
  }

  /* -------------------------------------------------------------- total */

  function setMultiplier(m) {
    multiplier = Math.max(1, Math.round(Number(m) || 1));
    renderTotal();
  }

  /** Points on the board right now, before the multiplier. */
  function points() {
    return answers.reduce((t, a) => t + (shown.has(a.id) ? Number(a.points) || 0 : 0), 0);
  }

  function renderTotal() {
    const raw = points();
    totalNum.textContent = String(raw * multiplier);
    totalMult.textContent = multiplier > 1 ? `×${multiplier}` : "";
    total.classList.toggle("lit", raw > 0);
  }

  function destroy() { clearTimers(); frame.remove(); }

  return {
    el: frame, grid,
    setSurvey, setQuestion, applyRevealed, reveal, revealAll, markSteal,
    setStrikes, flashStrike, flashTripleStrike, setMultiplier, destroy,
    get answers() { return answers; },
    get shown() { return new Set(shown); },
    get points() { return points(); },
    get pot() { return points() * multiplier; },
    /** The slot element for an index — the console attaches its own clicks. */
    slot: (i) => slotEls[i] || null,
  };
}

/**
 * One-shot static board, for cards and previews where nothing changes.
 * @returns {HTMLElement}
 */
export function renderFeudBoard(survey, opts = {}) {
  const board = createFeudBoard({ showQuestion: false, ...opts, revealed: opts.revealed !== false });
  board.setSurvey(survey);
  return board.el;
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  const css = `
  .fb{ container-type:inline-size; width:100%; display:flex; flex-direction:column;
    align-items:center; gap:1.8cqw; --fb-rows:4; }

  /* ---- question plaque ------------------------------------------------ */
  .fb-question{
    width:100%; text-align:center; padding:1.6cqw 3cqw; border-radius:1.4cqw;
    background:linear-gradient(180deg,#1a4fa8,#0b2d6b);
    box-shadow:0 0 0 .3cqw #ffd166, 0 1.4cqw 2.6cqw -1cqw rgba(0,0,0,.7),
      inset 0 .2cqw .6cqw rgba(255,255,255,.14);
  }
  .fb-q-text{ font-weight:800; font-size:3.2cqw; line-height:1.25; color:#fff;
    letter-spacing:.005em; text-shadow:0 .2cqw .4cqw rgba(0,0,0,.4); }
  .fb-question.empty .fb-q-text{ color:rgba(255,255,255,.45); }

  /* ---- board ---------------------------------------------------------- */
  .fb-frame{
    position:relative; width:100%; padding:1.5cqw; border-radius:1.6cqw;
    background:linear-gradient(180deg,#123a7a,#0a1f4a 55%,#061431);
    box-shadow:0 0 0 .35cqw #ffd166, 0 0 0 .8cqw #0a1f4a,
      0 2cqw 4cqw -1.4cqw rgba(0,0,0,.8), inset 0 .2cqw .6cqw rgba(255,255,255,.1);
  }
  .fb-grid{ display:grid; gap:.9cqw; grid-template-columns:1fr; }
  .fb-grid[data-cols="2"]{ grid-template-columns:1fr 1fr;
    grid-template-rows:repeat(var(--fb-rows),1fr); grid-auto-flow:column; }

  /* ---- a slot is a card that flips ------------------------------------ */
  .fb-slot{ position:relative; height:7.2cqw; perspective:60cqw; }
  .fb-grid[data-cols="2"] .fb-slot{ height:6.4cqw; }
  /* --fb-flip lets the console's animation-speed setting drive the board
     without this component knowing the setting exists. */
  .fb-flip{ position:absolute; inset:0; transform-style:preserve-3d;
    transition:transform var(--fb-flip,${FLIP_MS}ms) cubic-bezier(.3,.75,.3,1); }
  .fb-slot.open .fb-flip{ transform:rotateX(180deg); }
  .fb-face{ position:absolute; inset:0; backface-visibility:hidden; border-radius:1cqw;
    display:flex; align-items:center; overflow:hidden; }

  /* hidden: the rank, centred, on the deep board blue */
  .fb-front{
    justify-content:center;
    background:linear-gradient(180deg,#1d4f9e,#12336c 60%,#0d2755);
    box-shadow:inset 0 0 0 .15cqw rgba(255,255,255,.14), inset 0 .5cqw 1cqw rgba(255,255,255,.07);
  }
  .fb-rank{ font-weight:900; font-size:3.6cqw; color:#ffd166; line-height:1;
    text-shadow:0 .25cqw .5cqw rgba(0,0,0,.5); }
  /* the host's board shows what's behind each slot; the TV's never does */
  .fb-ghost{ display:none; }
  .fb.host .fb-front{ justify-content:flex-start; gap:1.4cqw; padding:0 1.6cqw; }
  .fb.host .fb-rank{ font-size:2.6cqw; flex:none; }
  .fb.host .fb-ghost{ display:block; font-weight:700; font-size:2.4cqw; color:rgba(255,255,255,.42);
    text-transform:uppercase; letter-spacing:.02em; white-space:nowrap; overflow:hidden;
    text-overflow:ellipsis; }

  /* revealed: the answer and its points */
  .fb-back{
    transform:rotateX(180deg); justify-content:space-between; gap:1.2cqw; padding:0 1.6cqw;
    background:linear-gradient(180deg,#2f6fd0,#17417f 60%,#102f5f);
    box-shadow:inset 0 0 0 .15cqw rgba(255,255,255,.2), inset 0 .5cqw 1cqw rgba(255,255,255,.1);
  }
  .fb-answer{ font-weight:800; font-size:2.7cqw; color:#fff; text-transform:uppercase;
    letter-spacing:.01em; line-height:1.15; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; text-shadow:0 .2cqw .3cqw rgba(0,0,0,.35); }
  .fb-points{ flex:none; min-width:6cqw; text-align:center; padding:.5cqw 1.1cqw;
    border-radius:.7cqw; font-weight:900; font-size:2.9cqw; color:#0b1f42;
    background:linear-gradient(180deg,#ffe9a8,#ffcf5c);
    box-shadow:inset 0 -.2cqw .4cqw rgba(0,0,0,.2), 0 .2cqw .5cqw rgba(0,0,0,.35); }
  .fb-grid[data-cols="2"] .fb-answer{ font-size:2.3cqw; }
  .fb-grid[data-cols="2"] .fb-points{ font-size:2.5cqw; min-width:5.4cqw; }

  /* the flash as a slot lands */
  .fb-slot.just .fb-back{ animation:fbLand ${FLIP_MS + 320}ms var(--ease,ease-out); }
  @keyframes fbLand{
    0%,42%{ filter:brightness(1); }
    56%{ filter:brightness(1.5) saturate(1.2); box-shadow:inset 0 0 0 .3cqw #ffd166, 0 0 3cqw rgba(255,209,102,.9); }
    100%{ filter:brightness(1); }
  }
  /* the answer that stole the board keeps a gold edge */
  .fb-slot.steal .fb-back{ box-shadow:inset 0 0 0 .3cqw #ffd166, 0 0 2cqw rgba(255,209,102,.55); }

  /* ---- strikes -------------------------------------------------------- */
  .fb-strikes{ position:absolute; inset:0; display:none; align-items:center; justify-content:center;
    gap:2cqw; pointer-events:none; z-index:3; }
  .fb-strikes.show{ display:flex; }
  .fb-x{
    font-weight:900; font-size:9cqw; line-height:1; color:#fff;
    width:12cqw; height:12cqw; display:grid; place-items:center; border-radius:1.4cqw;
    background:linear-gradient(180deg,#f04438,#b42318);
    box-shadow:0 0 0 .5cqw #fff, 0 1.4cqw 3cqw rgba(0,0,0,.6);
    opacity:.96;
  }
  .fb-strikes.flash .fb-x:last-child{ animation:fbStrike 1s var(--ease,ease-out); }
  .fb-strikes.triple .fb-x{ animation:fbStrike 1s var(--ease,ease-out) both; }
  .fb-strikes.triple .fb-x:nth-child(2){ animation-delay:.12s; }
  .fb-strikes.triple .fb-x:nth-child(3){ animation-delay:.24s; }
  @keyframes fbStrike{
    0%{ transform:scale(2.6); opacity:0; }
    22%{ transform:scale(1.12); opacity:1; }
    36%{ transform:scale(.97); }
    100%{ transform:scale(1); opacity:.96; }
  }
  .fb.nudge .fb-frame{ animation:fbNudge .44s var(--ease,ease-out); }
  @keyframes fbNudge{ 0%,100%{transform:none} 20%{transform:translateX(-1cqw)} 55%{transform:translateX(.8cqw)} }

  /* ---- running total -------------------------------------------------- */
  .fb-total{
    display:flex; align-items:baseline; gap:1cqw; min-width:22%;
    padding:.8cqw 3cqw; border-radius:1cqw; justify-content:center;
    background:linear-gradient(180deg,#1a1c26,#0a0c14);
    box-shadow:0 0 0 .25cqw #ffd166, 0 1cqw 2cqw -.6cqw rgba(0,0,0,.7);
    transition:box-shadow .3s var(--ease,ease-out);
  }
  .fb-total-num{ font-weight:900; font-size:4cqw; line-height:1.1; color:#ffd166;
    font-variant-numeric:tabular-nums; }
  .fb-total-mult{ font-weight:800; font-size:2.2cqw; color:#ff8a3d; letter-spacing:.04em; }
  .fb-total.lit{ box-shadow:0 0 0 .25cqw #ffd166, 0 0 3cqw rgba(255,209,102,.4),
    0 1cqw 2cqw -.6cqw rgba(0,0,0,.7); }

  /* ---- board cleared -------------------------------------------------- */
  .fb.cleared .fb-frame{ box-shadow:0 0 0 .35cqw #ffe9a8, 0 0 0 .8cqw #0a1f4a,
    0 0 6cqw rgba(255,209,102,.5), 0 2cqw 4cqw -1.4cqw rgba(0,0,0,.8); }

  /* ---- compact (library cards) --------------------------------------- */
  .fb.compact{ gap:1.2cqw; }
  .fb.compact .fb-frame{ padding:1.1cqw; box-shadow:0 0 0 .3cqw #ffd166, 0 0 0 .55cqw #0a1f4a; }
  .fb.compact .fb-slot{ height:6cqw; }
  .fb.compact .fb-grid[data-cols="2"] .fb-slot{ height:5.6cqw; }
  .fb.compact .fb-question{ padding:1.2cqw 2cqw; }
  .fb.compact .fb-q-text{ font-size:2.8cqw; }

  @media (prefers-reduced-motion: reduce){
    .fb-flip{ transition-duration:.001ms; }
    .fb-slot.just .fb-back{ animation:none; }
    .fb-strikes.flash .fb-x:last-child,
    .fb-strikes.triple .fb-x{ animation:none; }
    .fb.nudge .fb-frame{ animation:none; }
  }
  `;
  document.head.appendChild(el("style", { id: "fb-styles", html: css }));
}
