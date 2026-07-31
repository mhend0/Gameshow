/* =====================================================================
   Family Feud console
   ?screen=control (your laptop)  |  ?screen=display (the TV)

   The two windows sync through localStorage + BroadcastChannel — the same
   contract the Jeopardy and Wheel consoles use: control owns the game, the TV
   mirrors it. Both screens render from the same state with the same
   components, so "what the TV shows" is a pure function of that state and can
   never drift out of sync.

   Unlike the wheel this lives in its own module rather than inline in the page,
   because the Feud has three quite different screens in it (the board, the
   face-off and Fast Money) and one file per screen would be unreadable.
   ===================================================================== */
import {
  SurveyRepo, FeudSessionRepo, FEUD_RULES, loadFeudSettings, saveFeudSettings,
  rankAnswers, scoreGuess, matchAnswer, sameAnswer, MATCH_THRESHOLD, defaultMultiplier,
} from "../core/feud.js";
import { ensureFeudSeeded } from "../core/feud-seed.js";
import { createFeudBoard } from "./feud-board.js";
import { sfx } from "./sfx.js";
import { escapeHtml } from "./ui.js";
import { newId } from "../core/ids.js";
import { ready } from "../core/store.js";
await ready;

const params = new URLSearchParams(location.search);
const SCREEN = params.get("screen") === "display" ? "display" : "control";
document.body.dataset.screen = SCREEN;
const isControl = SCREEN === "control";

const STORE_KEY = "feud_console_v1";
const bc = new BroadcastChannel("feud_sync");
const WIN_ID = Math.random().toString(36).slice(2);

sfx.setScope(SCREEN === "display" ? "feud-tv" : "feud-control", SCREEN !== "display");

const $ = (id) => document.getElementById(id);
const fmtScore = (n) => Math.round(n).toLocaleString();

/* ==================================================================== state */

function makeTeam(name) {
  return { id: newId("team"), name, total: 0, players: [], upIndex: 0 };
}

function defaultState() {
  return {
    launchKey: "", sessionName: "",
    /** Rounds with their survey snapshotted in, so the TV never reads the library. */
    rounds: [], roundIndex: 0,
    fastMoneyCard: [],                 // surveys for Fast Money, snapshotted

    teams: [makeTeam("Family A"), makeTeam("Family B")],

    phase: "idle",
    // idle | face-off-ready | face-off-buzz | face-off-answer | face-off-second
    // | face-off-decide | play | steal | round-over | fast-money | game-over
    control: null,                     // team index holding the board
    revealed: [],                      // answer ids face-up
    strikes: 0,
    faceOff: null,                     // see startFaceOff()
    steal: null,                       // {team, guess, won}
    pending: [],                       // phone answers waiting on the host
    lastGuess: null,                   // {id, text, ok, team} — what the TV flashes
    award: null,                       // {id, team, amount} — drives the count-up
    banner: null,                      // {id, kind, text, sub}
    fm: null,                          // Fast Money, see startFastMoney()
    podium: false,

    settings: loadFeudSettings(),
    roomCode: "", hostToken: "", qrOverlay: false,
    // TV opens on a title screen until the host hits Begin Game.
    started: false,
  };
}

let state = loadState();

// Declared up here because the launch reconciliation below calls
// resetRoundState() before the game sections further down have run.
let faceOffTimer = null;
let fmTimer = null;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.teams) && s.teams.length === 2) {
      // A session saved before the title screen existed is already under way —
      // don't ambush it with one on its next load.
      if (typeof s.started === "undefined") s.started = true;
      const merged = Object.assign(defaultState(), s);
      merged.settings = { ...loadFeudSettings(), ...(s.settings || {}) };
      return merged;
    }
  } catch { /* corrupt or absent */ }
  return defaultState();
}

function pushState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* quota */ }
  bc.postMessage({ type: "state", state });
  render();
}

/* --------------------------------------------------- the running order ----
   Control resolves the running order from the launch URL and publishes it in
   shared state; the TV always plays control's list, however its own window was
   opened. */
function snapshotSurvey(survey) {
  return {
    surveyId: survey.id,
    question: survey.question,
    answers: rankAnswers(survey.answers).map((a) => ({ id: a.id, text: a.text, points: a.points, alts: a.alts || [] })),
  };
}

function resolveRounds() {
  const rows = [];
  const sid = params.get("session");
  const surveyId = params.get("survey");
  let card = [];

  if (surveyId) {
    const s = SurveyRepo.get(surveyId);
    if (s) rows.push({ id: newId("fround"), multiplier: 1, ...snapshotSurvey(s) });
  } else if (sid) {
    for (const r of FeudSessionRepo.resolveRounds(sid)) {
      rows.push({ id: r.id, multiplier: r.multiplier || 1, ...snapshotSurvey(r.survey) });
    }
    card = FeudSessionRepo.resolveFastMoney(sid).map(snapshotSurvey);
  }

  if (!rows.length) {
    // No session picked (or it's empty): fall back to the newest session, then
    // to whatever is in the library, so the console always has something to run.
    const newest = FeudSessionRepo.list().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    if (newest) {
      for (const r of FeudSessionRepo.resolveRounds(newest.id)) {
        rows.push({ id: r.id, multiplier: r.multiplier || 1, ...snapshotSurvey(r.survey) });
      }
      card = FeudSessionRepo.resolveFastMoney(newest.id).map(snapshotSurvey);
    }
    if (!rows.length) {
      SurveyRepo.query({ sort: "updated" }).slice(0, 4).forEach((s, i) => {
        rows.push({ id: newId("fround"), multiplier: defaultMultiplier(i), ...snapshotSurvey(s) });
      });
    }
  }
  return { rows, card };
}

if (isControl) {
  ensureFeudSeeded();
  const sid = params.get("session"), surveyId = params.get("survey");
  const launchKey = surveyId ? `survey:${surveyId}` : sid ? `session:${sid}` : "latest";
  const { rows, card } = resolveRounds();
  // A new launch starts at round 1. Family names are kept but scores reset,
  // since a new show is a new game.
  if (state.launchKey !== launchKey) {
    state.launchKey = launchKey;
    state.roundIndex = 0;
    state.teams.forEach((t) => { t.total = 0; t.upIndex = 0; });
    state.podium = false;
    state.fm = null;
    state.started = false;   // a new session gets its own title screen
    resetRoundState();
  }
  state.rounds = rows;
  state.fastMoneyCard = card;
  if (sid) {
    const s = FeudSessionRepo.get(sid);
    state.sessionName = s ? s.name : "";
  }
  if (state.roundIndex >= state.rounds.length) state.roundIndex = Math.max(0, state.rounds.length - 1);
}

/* ------------------------------------------------------------- accessors */
const round = () => state.rounds[state.roundIndex] || null;
const roundNumber = () => state.roundIndex + 1;
const multiplier = () => (round() ? round().multiplier || 1 : 1);
const answers = () => (round() ? round().answers : []);
const team = (i) => state.teams[i] || null;
const otherTeam = (i) => (i === 0 ? 1 : i === 1 ? 0 : null);
const revealedSet = () => new Set(state.revealed);

/** Points on the board right now, before the multiplier. */
function boardPoints() {
  const set = revealedSet();
  return answers().reduce((t, a) => t + (set.has(a.id) ? a.points : 0), 0);
}
const pot = () => boardPoints() * multiplier();
const allRevealed = () => answers().length > 0 && state.revealed.length >= answers().length;

/** The player whose turn it is on a team — the show goes down the line. */
function playerUp(teamIndex) {
  const t = team(teamIndex);
  if (!t || !t.players.length) return null;
  return t.players[t.upIndex % t.players.length] || null;
}
function advancePlayer(teamIndex) {
  const t = team(teamIndex);
  if (t && t.players.length) t.upIndex = (t.upIndex + 1) % t.players.length;
}

/* ---------------------------------------------------------- messaging */
bc.onmessage = (e) => {
  const m = e.data;
  if (m.type === "state") {
    if (isControl) return;                         // control is the source of truth
    state = Object.assign(defaultState(), m.state);
    render();
  } else if (m.type === "ping" && isControl) {
    pushState();                                   // a TV just opened — catch it up
  } else if (m.type === "hello" && isControl && m.id !== WIN_ID) {
    bc.postMessage({ type: "hello-ack", id: WIN_ID });
    warnDuplicate();
  } else if (m.type === "hello-ack" && isControl && m.id !== WIN_ID) {
    warnDuplicate();
  }
};
function warnDuplicate() {
  const w = $("dupWarn");
  if (w && !w.dataset.dismissed) w.style.display = "flex";
}

/* =================================================================== render */

const board = createFeudBoard({
  numbersOnly: SCREEN === "display",
  showQuestion: true,
  showTotal: SCREEN === "display",
  onReveal: ({ answer }) => sfx.reveal(answer.points),
});
$("boardHolder").appendChild(board.el);

// Clicking a slot on the host's board is the fastest reveal there is.
if (isControl) {
  board.grid.addEventListener("click", (e) => {
    const slot = e.target.closest(".fb-slot");
    if (!slot || !canReveal()) return;
    revealAnswer(Number(slot.dataset.index), { source: "click" });
  });
}

let lastRoundKey = null;
let lastStrikes = 0;
// The little boxes on the scorecard lag the board's own strike count while an
// X is mid-flight, so they only light up the instant its animation lands —
// never before.
let scorecardStrikes = 0;
let scorecardOwner = null;
let strikeFlightSeq = 0;
// A strike still waiting out its hold on the board, not yet collected by its
// own flight timer — {timer, owner, indices}. Needed because a fast second
// miss throws a fresh X up before the first one's timer fires, and that fresh
// X wipes the board (flashStrike clears it first): the first strike's timer
// would then find nothing there to fly.
let pendingFlight = null;
let shownBannerId = null;
let shownAwardId = null;
let shownGuessId = null;

let lastSpeed = null;

/**
 * Draw everything from state.
 *
 * The steps are isolated from each other on purpose. This runs on every state
 * change during a live show, and a single bad step — a survey with a shape
 * nothing else expects, a stray typo — must not be able to take the host's
 * controls down with it. One panel goes blank and gets logged; the rest of the
 * console keeps working, and the next state change tries again.
 */
function render() {
  // The TV gets the host's animation-speed setting through shared state.
  if (lastSpeed !== state.settings.animationSpeed) {
    lastSpeed = state.settings.animationSpeed;
    applyAnimationSpeed();
  }
  const steps = [
    renderBoard, renderTvHead, renderTeams, renderSaid, renderFaceOff,
    renderBanner, renderAward, renderFastMoney, renderPodium, renderQrOverlay, renderTitleScreen,
  ];
  if (isControl) steps.push(renderControl, renderPhonePanel);
  for (const step of steps) {
    try { step(); } catch (e) { console.error(`Feud console: ${step.name} failed`, e); }
  }
}

function renderBoard() {
  const r = round();
  const key = r ? `${r.id}:${r.answers.length}` : "none";
  if (key !== lastRoundKey) {
    lastRoundKey = key;
    board.setSurvey(r || { question: "", answers: [] }, { revealed: false });
    lastStrikes = 0;
    scorecardStrikes = 0;
    scorecardOwner = null;
    strikeFlightSeq++;
    if (pendingFlight) { clearTimeout(pendingFlight.timer); pendingFlight = null; }
  }
  board.setMultiplier(multiplier());
  board.applyRevealed(state.revealed, { animate: true });

  // Strikes: only *new* ones get the animation, so a re-render never re-throws
  // the X's at the room. The X lands big on the board, holds for a beat, then
  // flies off to the scorecard — see scheduleStrikeFlight.
  if (state.strikes > lastStrikes) {
    const owner = strikesOwnerIndex();
    if (state.strikes >= state.settings.strikes) {
      board.flashTripleStrike();
      scheduleStrikeFlight(owner, [0, 1, 2]);
    } else {
      board.flashStrike();
      scheduleStrikeFlight(owner, [state.strikes - 1]);
    }
    sfx.strike(state.strikes);
  } else if (state.strikes !== lastStrikes) {
    // The host undoing a strike (or a round reset): sync instantly, no flight.
    board.setStrikes(state.strikes);
    strikeFlightSeq++;
    if (pendingFlight) { clearTimeout(pendingFlight.timer); pendingFlight = null; }
    scorecardOwner = strikesOwnerIndex();
    scorecardStrikes = state.strikes;
  }
  lastStrikes = state.strikes;

  if (state.steal && state.steal.won && state.steal.answerId) board.markSteal(state.steal.answerId);

  const onFm = state.phase === "fast-money";
  $("boardLayer").classList.toggle("hide", onFm);
  $("fmLayer").classList.toggle("hide", !onFm);
  if (isControl) $("boardHolder").classList.toggle("locked", !canReveal());
}

function renderTvHead() {
  if (SCREEN !== "display") return;
  const total = state.rounds.length;
  $("tvRound").textContent = state.phase === "fast-money"
    ? "Fast Money"
    : `Round ${roundNumber()}${total ? ` of ${total}` : ""}`;
  const mult = $("tvMult");
  mult.style.display = multiplier() > 1 && state.phase !== "fast-money" ? "inline-block" : "none";
  mult.textContent = `×${multiplier()}`;
  $("tvTurn").innerHTML = turnLine();
}

/** The one line that says whose game it is right now. */
function turnLine() {
  const c = state.control;
  switch (state.phase) {
    case "idle": return "";
    case "face-off-ready":
    case "face-off-buzz": return "Buzzers ready…";
    case "face-off-answer":
    case "face-off-second":
      return state.faceOff && state.faceOff.answering != null
        ? `<b>${escapeHtml(team(state.faceOff.answering)?.name || "")}</b> to answer`
        : "";
    case "play": return c != null ? `<b>${escapeHtml(team(c).name)}</b> has the board` : "";
    case "steal": return state.steal ? `<b>${escapeHtml(team(state.steal.team).name)}</b> can steal` : "";
    case "round-over": return "";
    default: return "";
  }
}

/**
 * Which family the board's current strikes belong to — during a steal that's
 * whoever was holding the board, not whoever is highlighted to answer.
 */
function strikesOwnerIndex() {
  const active = state.phase === "steal" ? (state.steal ? state.steal.team : null)
    : (state.phase === "face-off-answer" || state.phase === "face-off-second")
      ? (state.faceOff ? state.faceOff.answering : null)
      : state.control;
  return state.phase === "steal" ? state.control : active;
}

function renderTeams() {
  const box = $("teams");
  const active = state.phase === "steal" ? (state.steal ? state.steal.team : null)
    : (state.phase === "face-off-answer" || state.phase === "face-off-second")
      ? (state.faceOff ? state.faceOff.answering : null)
      : state.control;
  const strikesOwner = strikesOwnerIndex();
  // How many boxes are actually lit right now — lags state.strikes while an
  // X is still flying toward them, so the box never beats its animation in.
  const lit = scorecardOwner === strikesOwner ? scorecardStrikes : 0;

  if (box.children.length !== state.teams.length) box.innerHTML = "";
  state.teams.forEach((t, i) => {
    let card = box.children[i];
    if (!card) {
      card = document.createElement("div");
      card.className = "team";
      box.appendChild(card);
    }
    const up = playerUp(i);
    const showStrikes = strikesOwner === i && (state.phase === "play" || state.phase === "steal");
    card.innerHTML = `
      <span class="nm">${escapeHtml(t.name)}</span>
      ${up ? `<span class="up">${escapeHtml(up.name)}</span>` : ""}
      <span class="xs">${[0, 1, 2].map((n) =>
        `<i class="${showStrikes && n < lit ? "on" : ""}">✗</i>`).join("")}</span>
      <span class="sc">${fmtScore(t.total)}</span>
      <span class="gain" data-gain></span>`;
    card.classList.toggle("active", active === i);
  });
}

/** The i-th little strike box on a team's scorecard, or null if it's not there yet. */
function teamStrikeBox(owner, index) {
  const card = $("teams")?.children[owner];
  return card ? card.querySelectorAll(".xs i")[index] || null : null;
}

/**
 * A beat after a strike lands big on the board, detach its X (or all three,
 * for the round-losing strike) and ease each one down onto its matching box
 * on the scorecard. `indices` are the 0-based box positions the detached
 * nodes represent, in DOM order.
 */
function scheduleStrikeFlight(owner, indices) {
  // A previous strike's X may still be sitting on the board waiting for its
  // own timer to collect it. flashStrike()/flashTripleStrike() just wiped
  // the board to put up this new one, so that timer would find nothing
  // there when it fires — settle the earlier strike's box right now instead
  // of losing it silently.
  if (pendingFlight) {
    clearTimeout(pendingFlight.timer);
    settleFlightNow(pendingFlight.owner, pendingFlight.indices);
  }

  const speed = Number(state.settings.animationSpeed) || 1;
  const seq = strikeFlightSeq;
  const timer = setTimeout(() => {
    pendingFlight = null;
    if (seq !== strikeFlightSeq) return;           // a reset happened mid-hold
    const nodes = board.takeStrikeNodes();
    nodes.forEach((node, i) => {
      const boxEl = teamStrikeBox(owner, indices[i]);
      flyStrikeNode(node, boxEl, () => {
        if (seq !== strikeFlightSeq) return;        // a reset happened mid-flight
        if (scorecardOwner !== owner) { scorecardOwner = owner; scorecardStrikes = 0; }
        scorecardStrikes = Math.max(scorecardStrikes, indices[i] + 1);
        renderTeams();
      });
    });
  }, Math.round(1700 / speed));
  pendingFlight = { timer, owner, indices };
}

/** Light a strike's scorecard box(es) directly, skipping the flight — used
 * when a faster follow-up strike beat this one to the punch. */
function settleFlightNow(owner, indices) {
  if (scorecardOwner !== owner) { scorecardOwner = owner; scorecardStrikes = 0; }
  scorecardStrikes = Math.max(scorecardStrikes, Math.max(...indices) + 1);
  renderTeams();
}

/**
 * Ease one detached strike X from wherever it's pinned to a scorecard box,
 * shrinking and fading as it goes. A touch of acceleration (not a linear
 * glide) makes the landing feel thrown rather than dragged. `onLand` fires
 * exactly when the motion finishes, so the box it's aimed at can light up
 * the instant the X is gone — never a beat before.
 */
function flyStrikeNode(node, boxEl, onLand) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!boxEl || reduced) { node.remove(); onLand(); return; }

  const from = node.getBoundingClientRect();
  const to = boxEl.getBoundingClientRect();
  const speed = Number(state.settings.animationSpeed) || 1;
  const ms = Math.round(640 / speed);
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
  const scale = Math.max(0.12, (to.width || 15) / (from.width || 1));

  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    node.remove();
    onLand();
  };

  // Two rAFs: the first lets the browser commit the node's "at rest" pinned
  // position, the second then changes the transform so the transition has
  // something to animate from rather than jumping straight to the end.
  requestAnimationFrame(() => {
    node.style.transition =
      `transform ${ms}ms cubic-bezier(.5,.02,.78,.32), ` +
      `opacity ${ms}ms cubic-bezier(.5,.02,.78,.32) ${Math.round(ms * 0.55)}ms`;
    requestAnimationFrame(() => {
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      node.style.opacity = "0";
    });
  });
  node.addEventListener("transitionend", (e) => { if (e.propertyName === "transform") land(); });
  setTimeout(land, ms + 150);                       // safety net
}

/**
 * What was just said, under the board, for a beat.
 *
 * The board itself only ever shows answers that are *on* it, so without this a
 * wrong guess is three X's and no explanation — the room never sees what the
 * family actually said. It's the cheapest way to make a miss land.
 */
function renderSaid() {
  const node = $("saidChip");
  if (!node) return;
  const g = state.lastGuess;
  if (!g || g.id === shownGuessId) return;
  shownGuessId = g.id;
  if (!g.text) { node.classList.remove("show"); return; }

  node.className = "said show";
  node.innerHTML = `<span class="mark">✗</span><span>${escapeHtml(g.text)}</span>`;
  clearTimeout(renderSaid.t);
  renderSaid.t = setTimeout(() => node.classList.remove("show"), 2400);
}

/* ------------------------------------------------------------- overlays */

/**
 * The face-off card is the room's screen, not the host's: it fills the TV, and
 * on the control window it would cover the very buttons the host needs while
 * it's up. Control gets the same information in its side panel instead.
 */
function renderFaceOff() {
  const o = $("faceOff");
  const fo = state.faceOff;
  const show = SCREEN === "display" && !!fo
    && (state.phase === "face-off-ready" || state.phase === "face-off-buzz"
      || (state.phase === "face-off-answer" && fo.justBuzzed));
  o.classList.toggle("show", show);
  if (!show) return;

  const big = $("foBig");
  const who = $("foWho");
  const sub = $("foSub");

  if (state.phase === "face-off-ready") {
    const left = Math.max(0, Math.ceil((fo.armAt - Date.now()) / 1000));
    $("foKicker").textContent = "Face-off";
    if (big.textContent !== String(left)) {
      big.textContent = String(left);
      big.classList.remove("count"); void big.offsetWidth; big.classList.add("count");
      sfx.faceOffReady(state.settings.faceOffCountdown - left);
    }
    who.style.display = "none";
    sub.textContent = "Hands on the buzzers";
  } else if (state.phase === "face-off-buzz") {
    $("foKicker").textContent = "Face-off";
    big.textContent = "BUZZ!";
    big.classList.remove("count");
    who.style.display = "flex";
    who.innerHTML = state.teams.map((t, i) => {
      const p = playerUp(i);
      return `<span class="badge">${escapeHtml(p ? p.name : t.name)}</span>`;
    }).join("<span style='color:var(--text-2);font-weight:800'>vs</span>");
    sub.textContent = "First in gets the question";
  } else {
    $("foKicker").textContent = "First in";
    big.textContent = fo.buzzedName || team(fo.answering)?.name || "";
    big.classList.remove("count"); void big.offsetWidth; big.classList.add("count");
    who.style.display = "none";
    sub.textContent = `${team(fo.answering)?.name || ""} — what's your answer?`;
  }
}

function renderBanner() {
  const b = state.banner;
  const node = $("banner");
  if (!b) { node.classList.remove("show"); shownBannerId = null; return; }
  if (b.id === shownBannerId) return;
  shownBannerId = b.id;
  node.className = `show ${b.kind || ""}`;
  $("bannerText").textContent = b.text || "";
  $("bannerSub").textContent = b.sub || "";
  if (b.kind === "good") sfx.applause(2.2);
  if (b.ms !== 0) {
    clearTimeout(renderBanner.t);
    renderBanner.t = setTimeout(() => {
      node.classList.remove("show");
      if (isControl && state.banner && state.banner.id === b.id) { state.banner = null; pushState(); }
    }, b.ms || 2400);
  }
}

/** The money going up, once, on both screens. */
function renderAward() {
  const a = state.award;
  if (!a || a.id === shownAwardId) return;
  shownAwardId = a.id;
  const card = $("teams").children[a.team];
  if (card) {
    const gain = card.querySelector("[data-gain]");
    if (gain) {
      gain.textContent = `+${fmtScore(a.amount)}`;
      gain.classList.remove("go"); void gain.offsetWidth; gain.classList.add("go");
    }
    card.classList.remove("won"); void card.offsetWidth; card.classList.add("won");
  }
  if (a.amount > 0) { sfx.bank(a.amount); dropConfetti(1400); }
}

// The TV keeps the podium up for the room; the host can put theirs away and
// carry on (start a new game, fix a score) without the state changing.
let podiumDismissed = false;

function renderPodium() {
  const p = $("podium");
  if (!state.podium) { podiumDismissed = false; renderPodium.done = false; }
  p.classList.toggle("show", !!state.podium && !podiumDismissed);
  if (!state.podium) return;
  const sorted = [...state.teams].sort((a, b) => b.total - a.total);
  const draw = sorted.length > 1 && sorted[0].total === sorted[1].total;
  $("podiumWinner").textContent = draw ? "It's a tie!" : sorted[0].name;
  $("podiumScore").textContent = draw ? `${fmtScore(sorted[0].total)} each` : fmtScore(sorted[0].total);
  $("podiumRest").innerHTML = draw ? "" : sorted.slice(1).map((t) =>
    `<span>${escapeHtml(t.name)} · ${fmtScore(t.total)}</span>`).join("");
  if (!renderPodium.done) { renderPodium.done = true; sfx.applause(3.2); dropConfetti(4200); }
}

function dropConfetti(ms = 2600) {
  const box = $("confetti");
  const colours = ["#ffcf5c", "#ff8a3d", "#34d399", "#60a5fa", "#f472b6", "#ffffff"];
  box.style.display = "block";
  box.innerHTML = "";
  const n = SCREEN === "display" ? 130 : 50;
  for (let i = 0; i < n; i++) {
    const c = document.createElement("i");
    c.className = "cf";
    c.style.left = `${Math.random() * 100}%`;
    c.style.top = `${-12 - Math.random() * 30}vh`;
    c.style.background = colours[i % colours.length];
    c.style.animationDuration = `${1.9 + Math.random() * 2.1}s`;
    c.style.animationDelay = `${Math.random() * 0.7}s`;
    box.appendChild(c);
  }
  clearTimeout(dropConfetti.t);
  dropConfetti.t = setTimeout(() => { box.style.display = "none"; box.innerHTML = ""; }, ms + 2600);
}

/* ==================================================================== game */

function banner(kind, text, sub, ms) {
  state.banner = { id: newId("b"), kind, text, sub, ms };
}

/** Clear everything that belongs to one round, keeping scores and families. */
function resetRoundState() {
  state.phase = "idle";
  state.control = null;
  state.revealed = [];
  state.strikes = 0;
  state.faceOff = null;
  state.steal = null;
  state.pending = [];
  state.lastGuess = null;
  state.award = null;
  state.banner = null;
  clearTimers();
}

function clearTimers() {
  clearInterval(faceOffTimer); faceOffTimer = null;
  clearInterval(fmTimer); fmTimer = null;
}

/** Whether clicking the board (or accepting a guess) means anything right now. */
function canReveal() {
  return ["face-off-answer", "face-off-second", "play", "steal"].includes(state.phase);
}

/* ------------------------------------------------------------- face-off */

/**
 * Start a face-off. The two players at the front of each family's line get the
 * buzzers; if a family has no phones in the room the host buzzes for them.
 */
function startFaceOff() {
  if (!round()) return;
  state.revealed = [];
  state.strikes = 0;
  state.control = null;
  state.steal = null;
  state.faceOff = {
    stage: "ready",
    armAt: Date.now() + Math.max(0, state.settings.faceOffCountdown) * 1000,
    buzzedPid: null, buzzedName: "", answering: null, justBuzzed: false,
    lockedOut: [], first: null, second: null,
  };
  state.phase = state.settings.faceOffCountdown > 0 ? "face-off-ready" : "face-off-buzz";
  if (state.phase === "face-off-buzz") state.faceOff.armAt = Date.now();
  pushState();
  runFaceOffClock();
}

function runFaceOffClock() {
  if (!isControl) return;
  clearInterval(faceOffTimer);
  faceOffTimer = setInterval(() => {
    if (state.phase !== "face-off-ready") { clearInterval(faceOffTimer); return; }
    if (Date.now() >= state.faceOff.armAt) {
      state.phase = "face-off-buzz";
      clearInterval(faceOffTimer);
      sfx.buzzIn();
      pushState();
    } else {
      render();                       // tick the countdown without a broadcast
    }
  }, 120);
}

/**
 * Somebody got in first. `by` is either a team index (the host buzzed for a
 * family that isn't on phones) or a player id from the room.
 */
function faceOffBuzz(by, name) {
  if (state.phase !== "face-off-buzz" || !state.faceOff) return;
  let teamIndex = typeof by === "number" ? by : teamOfPid(by);
  if (teamIndex == null) return;
  const fo = state.faceOff;
  fo.buzzedPid = typeof by === "string" ? by : null;
  fo.buzzedName = name || (playerUp(teamIndex)?.name) || team(teamIndex).name;
  fo.answering = teamIndex;
  fo.justBuzzed = true;
  fo.lockedOut = [];                  // the other side is locked out by `answering`
  state.phase = "face-off-answer";
  sfx.buzzIn();
  pushState();
  // The "who buzzed" card holds for a beat, then gets out of the way of the board.
  setTimeout(() => {
    if (isControl && state.faceOff && state.faceOff.justBuzzed) {
      state.faceOff.justBuzzed = false;
      pushState();
    }
  }, 1500);
}

/** Which family a phone belongs to. */
function teamOfPid(pid) {
  for (let i = 0; i < state.teams.length; i++) {
    if (state.teams[i].players.some((p) => p.pid === pid)) return i;
  }
  return null;
}

/**
 * The face-off answer landed (or didn't).
 *
 * The show's rule: the first buzzer answers; if it's the #1 answer their family
 * takes the board straight away. Otherwise the other player gets one go, and
 * whoever gave the higher-ranked answer wins control.
 */
function judgeFaceOff(rank) {
  const fo = state.faceOff;
  if (!fo) return;
  const slot = state.phase === "face-off-answer" ? "first" : "second";
  fo[slot] = { team: fo.answering, rank };            // rank is null for a miss

  if (slot === "first") {
    if (rank === 0) {                                  // the top answer — done
      giveControl(fo.answering, "top");
      return;
    }
    const other = otherTeam(fo.answering);
    fo.answering = other;
    fo.justBuzzed = false;
    state.phase = "face-off-second";
    banner("", `${team(other).name}, your turn`, rank == null
      ? "Nothing on the board — anything up there wins the face-off"
      : "Beat that answer to take the board", 1900);
    pushState();
    return;
  }

  // Both have answered: the better rank takes it. A miss is worse than anything.
  const a = fo.first, b = fo.second;
  const score = (x) => (x && x.rank != null ? x.rank : 99);
  const winner = score(b) < score(a) ? b.team : score(a) < score(b) ? a.team : null;
  if (winner == null) {
    // Neither found anything: the show plays it again with the next two players.
    state.teams.forEach((_, i) => advancePlayer(i));
    banner("bad", "Nothing on the board", "Next two players — face off again", 2400);
    state.faceOff = null;
    state.phase = "idle";
    pushState();
    return;
  }
  giveControl(winner, "beat");
}

/** Hand the board to a family and start the round proper. */
function giveControl(teamIndex, why) {
  state.control = teamIndex;
  state.faceOff = null;
  state.strikes = 0;
  state.phase = "play";
  const name = team(teamIndex).name;
  const sub = why === "top" ? "Top answer — the board is yours"
    : why === "skip" ? "Straight to the board"
      : "Highest answer takes the board";
  banner("good", `${name} play`, sub, 2000);
  pushState();
  focusGuess();
}

/* ------------------------------------------------------- reveals & strikes */

/**
 * Turn an answer over. Everything that reveals — a click, the guess box, a
 * phone submission — comes through here, so the rules live in one place.
 */
function revealAnswer(which, { source = "host" } = {}) {
  const list = answers();
  const answer = typeof which === "number" ? list[which] : list.find((a) => a.id === which);
  if (!answer || state.revealed.includes(answer.id)) return false;

  state.revealed = [...state.revealed, answer.id];
  state.lastGuess = null;                 // the board is showing it; nothing to add

  if (state.phase === "steal") {
    // One guess: getting it right takes the whole pot.
    state.steal = { ...state.steal, won: true, answerId: answer.id };
    finishRound(state.steal.team, "steal");
    return true;
  }
  if (state.phase === "face-off-answer" || state.phase === "face-off-second") {
    judgeFaceOff(list.indexOf(answer));
    return true;
  }
  // Main round: the family keeps going until the board is clear or they strike out.
  if (allRevealed()) {
    finishRound(state.control, "cleared");
  } else {
    advancePlayer(state.control);
    pushState();
    focusGuess();
  }
  return true;
}

/** Which family is on the hook for the current answer. */
function currentTeam() {
  if (state.phase === "steal" && state.steal) return state.steal.team;
  if ((state.phase === "face-off-answer" || state.phase === "face-off-second") && state.faceOff) return state.faceOff.answering;
  return state.control;
}

/** A miss. In the main round that's a strike; elsewhere it just moves things on. */
function addStrike(saidText) {
  if (state.phase === "steal") {
    state.steal = { ...state.steal, won: false };
    state.lastGuess = { id: newId("g"), text: saidText || "", team: state.steal.team };
    sfx.strike(1);
    finishRound(state.control, "held");
    return;
  }
  if (state.phase === "face-off-answer" || state.phase === "face-off-second") {
    state.lastGuess = { id: newId("g"), text: saidText || "", team: state.faceOff.answering };
    sfx.strike(1);
    judgeFaceOff(null);
    return;
  }
  if (state.phase !== "play") return;

  state.strikes = Math.min(state.settings.strikes, state.strikes + 1);
  state.lastGuess = { id: newId("g"), text: saidText || "", team: state.control };

  if (state.strikes >= state.settings.strikes) {
    startSteal();
  } else {
    advancePlayer(state.control);
    pushState();
    focusGuess();
  }
}

/** Three strikes: the other family gets one guess for the lot. */
function startSteal() {
  const thief = otherTeam(state.control);
  state.phase = "steal";
  state.steal = { team: thief, won: null, answerId: null };
  banner("bad", "Three strikes", `${team(thief).name} — one guess to steal it all`, 2600);
  pushState();
  focusGuess();
}

/* --------------------------------------------------------- ending a round */

/**
 * Award the pot and turn the rest of the board over.
 * @param {number} winner  Team index taking the money.
 * @param {"cleared"|"steal"|"held"} why
 */
function finishRound(winner, why) {
  const amount = pot();
  state.phase = "round-over";
  if (winner != null && amount > 0) {
    team(winner).total += amount;
    state.award = { id: newId("aw"), team: winner, amount };
  }
  const name = winner != null ? team(winner).name : "";
  if (why === "cleared") banner("good", "Board cleared!", `${name} take ${fmtScore(amount)}`, 3000);
  else if (why === "steal") banner("good", "Stolen!", `${name} take ${fmtScore(amount)}`, 3000);
  else banner("", "No steal", `${name} keep ${fmtScore(amount)}`, 3000);

  if (state.settings.revealRestOnLoss) {
    // Let the win land first, then take the X's down and sweep the rest of the
    // board over — leaving them up would cover the answers the room came for.
    setTimeout(() => {
      if (!isControl || state.phase !== "round-over") return;
      state.strikes = 0;
      state.revealed = answers().map((a) => a.id);
      pushState();
    }, 900);
  } else {
    state.strikes = 0;
  }
  pushState();

  if (state.settings.autoAdvance) {
    setTimeout(() => { if (isControl && state.phase === "round-over") nextRound(); }, 5200);
  }
}

/** Move to the next round — or into Fast Money when the rounds run out. */
function nextRound() {
  const last = state.roundIndex >= state.rounds.length - 1;
  if (!last) {
    state.roundIndex++;
    resetRoundState();
    pushState();
    return;
  }
  // Fast Money plays once. Pressing "next round" after it has been scored goes
  // to the podium rather than starting it over.
  if (state.settings.fastMoneyEnabled && state.fastMoneyCard.length && !state.fm) {
    startFastMoney();
    return;
  }
  state.podium = true;
  state.phase = "game-over";
  pushState();
}

function restartRound() {
  resetRoundState();
  pushState();
}

/* ============================================================ FAST MONEY ====
   Two players from the winning family, five questions each, one clock per
   turn. The second player is offstage for the first turn, so the console keeps
   their answers out of the way until it's their go — and flags a repeat of a
   previous answer the moment the host types it, which is exactly when the host
   needs to ask for a different one. */

const fmQuestions = () => state.fastMoneyCard.slice(0, FEUD_RULES.fastMoney.questions);
const fmSeconds = (player) => Number(state.settings.fastMoneySeconds[player] ?? FEUD_RULES.fastMoney.seconds[player]) || 20;
const fmTarget = () => Number(state.settings.fastMoneyTarget) || FEUD_RULES.fastMoney.target;

function fmBlankEntries() {
  return fmQuestions().map(() => ({ text: "", points: 0, revealed: false, dupe: false, passed: false }));
}

function startFastMoney() {
  const card = fmQuestions();
  if (!card.length) { toast("No Fast Money surveys in this session"); return; }
  // The family in front plays for the big money.
  const teamIndex = state.teams[0].total >= state.teams[1].total ? 0 : 1;
  const roster = team(teamIndex).players;
  state.fm = {
    stage: "intro",
    teamIndex,
    contestants: [roster[0]?.name || "Player 1", roster[1]?.name || "Player 2"],
    contestantPids: [roster[0]?.pid || null, roster[1]?.pid || null],
    player: 0,
    order: card.map((_, i) => i),
    at: 0,
    entries: [fmBlankEntries(), fmBlankEntries()],
    deadline: null, secondsLeft: fmSeconds(0), running: false,
    revealPlayer: 0, revealAt: 0,
    won: null,
  };
  state.phase = "fast-money";
  state.podium = false;
  banner("", "Fast Money", `${team(teamIndex).name} play for ${fmTarget()} points`, 2600);
  pushState();
}

/** The question the contestant is on right now. */
const fmCurrentIndex = () => {
  const fm = state.fm;
  if (!fm || fm.at >= fm.order.length) return null;
  return fm.order[fm.at];
};

function fmStartTurn() {
  const fm = state.fm;
  if (!fm) return;
  fm.stage = "play";
  fm.at = 0;
  fm.order = fmQuestions().map((_, i) => i);
  fm.running = true;
  fm.deadline = Date.now() + fmSeconds(fm.player) * 1000;
  fm.secondsLeft = fmSeconds(fm.player);
  pushState();
  runFmClock();
  focusGuess();
}

function runFmClock() {
  if (!isControl) return;
  clearInterval(fmTimer);
  let lastWhole = null;
  fmTimer = setInterval(() => {
    const fm = state.fm;
    if (!fm || !fm.running) { clearInterval(fmTimer); return; }
    const left = Math.max(0, (fm.deadline - Date.now()) / 1000);
    const whole = Math.ceil(left);
    if (whole !== lastWhole) {
      lastWhole = whole;
      fm.secondsLeft = whole;
      if (whole > 0 && whole <= 5) sfx.clockTick(whole);
      pushState();
    }
    if (left <= 0) { clearInterval(fmTimer); fmTimeUp(); }
  }, 100);
}

function fmTimeUp() {
  const fm = state.fm;
  if (!fm || !fm.running) return;
  fm.running = false;
  fm.deadline = null;
  fm.secondsLeft = 0;
  sfx.buzzer();
  fmEndTurn();
}

/** Record an answer for the question in front of the contestant. */
function fmSubmit(text) {
  const fm = state.fm;
  if (!fm || fm.stage !== "play") return false;
  const qi = fmCurrentIndex();
  if (qi == null) return false;
  const survey = fmQuestions()[qi];
  const clean = String(text || "").trim();

  const hit = clean ? matchAnswer(clean, survey) : null;
  const entry = {
    text: clean,
    points: hit ? hit.answer.points : 0,
    revealed: false,
    passed: false,
    dupe: false,
  };
  // A repeat of the first player's answer has to be replaced — flag it now, so
  // the host can ask for another one while the clock is still running.
  if (fm.player === 1 && clean && FEUD_RULES.fastMoney.flagDuplicates) {
    const first = fm.entries[0][qi];
    if (first && first.text && sameAnswer(clean, first.text)) { entry.dupe = true; entry.points = 0; }
  }
  fm.entries[fm.player][qi] = entry;
  fm.at++;
  if (fm.at >= fm.order.length) { fm.running = false; fm.deadline = null; fmEndTurn(); return true; }
  pushState();
  focusGuess();
  return true;
}

/** Skip this one and come back to it if the clock allows. */
function fmPass() {
  const fm = state.fm;
  if (!fm || fm.stage !== "play") return;
  const qi = fmCurrentIndex();
  if (qi == null) return;
  fm.entries[fm.player][qi] = { text: "", points: 0, revealed: false, passed: true, dupe: false };
  // Move it to the back of the queue rather than dropping it. `at` doesn't
  // change — the rotation is what brings the next question forward.
  fm.order = [...fm.order.slice(0, fm.at), ...fm.order.slice(fm.at + 1), qi];
  // Skip anything already answered, so a pass always lands somewhere new (the
  // host can work out of order, which leaves answered questions in the queue).
  const answered = (i) => {
    const e = fm.entries[fm.player][fm.order[i]];
    return !!(e && e.text);
  };
  while (fm.at < fm.order.length && answered(fm.at)) fm.at++;
  if (fm.at >= fm.order.length) { fm.running = false; fmEndTurn(); return; }
  pushState();
  focusGuess();
}

/** Jump straight to a question (the host correcting the order by hand). */
function fmGoTo(qi) {
  const fm = state.fm;
  if (!fm || fm.stage !== "play") return;
  const at = fm.order.indexOf(qi);
  if (at >= 0) { fm.at = at; pushState(); focusGuess(); }
}

function fmEndTurn() {
  const fm = state.fm;
  if (!fm) return;
  clearInterval(fmTimer);
  fm.running = false;
  fm.deadline = null;
  fm.stage = "reveal";
  fm.revealPlayer = fm.player;
  fm.revealAt = 0;
  pushState();
}

/** Turn the next score over. */
function fmRevealNext() {
  const fm = state.fm;
  if (!fm || fm.stage !== "reveal") return;
  const row = fm.entries[fm.revealPlayer];
  const i = fm.revealAt;
  if (i >= row.length) { fmAfterReveal(); return; }
  row[i] = { ...row[i], revealed: true };
  fm.revealAt++;
  if (row[i].points > 0) sfx.fastMoneyDing(); else sfx.fastMoneyBuzz();
  pushState();
}

function fmRevealAll() {
  const fm = state.fm;
  if (!fm || fm.stage !== "reveal") return;
  fm.entries[fm.revealPlayer] = fm.entries[fm.revealPlayer].map((e) => ({ ...e, revealed: true }));
  fm.revealAt = fm.entries[fm.revealPlayer].length;
  sfx.fastMoneyDing();
  pushState();
}

/** After a reveal: either bring in the second player, or score the whole thing. */
function fmAfterReveal() {
  const fm = state.fm;
  if (fm.player === 0) {
    fm.player = 1;
    fm.stage = "intro";
    fm.secondsLeft = fmSeconds(1);
    banner("", fm.contestants[1] || "Player 2", `${fmSeconds(1)} seconds — same five questions`, 2400);
    pushState();
    return;
  }
  fmFinish();
}

function fmTotal() {
  const fm = state.fm;
  if (!fm) return 0;
  return fm.entries.reduce((t, row) =>
    t + row.reduce((s, e) => s + (e.revealed ? e.points : 0), 0), 0);
}

function fmFinish() {
  const fm = state.fm;
  const total = fmTotal();
  const won = total >= fmTarget();
  fm.stage = "done";
  fm.won = won;
  if (won) {
    team(fm.teamIndex).total += total;
    state.award = { id: newId("aw"), team: fm.teamIndex, amount: total };
    banner("good", "They did it!", `${total} points — ${team(fm.teamIndex).name} win`, 4000);
  } else {
    banner("bad", `${total} points`, `${fmTarget() - total} short`, 3600);
  }
  pushState();
  setTimeout(() => {
    if (!isControl || !state.fm || state.fm.stage !== "done") return;
    state.podium = true;
    state.phase = "game-over";
    pushState();
  }, 5200);
}

/* ------------------------------------------------------- fast money render */

function renderFastMoney() {
  const fm = state.fm;
  const holder = $("fmHolder");
  if (!fm || state.phase !== "fast-money") { holder.innerHTML = ""; renderFastMoney.sig = null; return; }

  const card = fmQuestions();
  const showing = fm.stage === "reveal" ? fm.revealPlayer : fm.player;
  const clockLeft = fm.running && fm.deadline ? Math.max(0, Math.ceil((fm.deadline - Date.now()) / 1000)) : fm.secondsLeft;
  const currentQ = fm.stage === "play" ? fmCurrentIndex() : null;

  // Only redraw when something actually changed — the clock ticks every frame
  // and rebuilding five rows each time would fight the landing animation.
  const sig = JSON.stringify([fm.stage, fm.player, showing, currentQ, clockLeft,
    fm.entries.map((r) => r.map((e) => [e.text, e.points, e.revealed, e.dupe, e.passed]))]);
  if (sig === renderFastMoney.sig) return;
  renderFastMoney.sig = sig;

  const cell = (content, cls = "") => `<div class="fm-cell ${cls}">${content}</div>`;
  const entryCell = (entry, hidden, isCurrent) => {
    if (!entry || (!entry.text && !entry.passed)) {
      return cell(isCurrent ? `<span class="txt" style="opacity:.5">…</span>` : "", "blank");
    }
    if (hidden) return cell(`<span class="txt">${escapeHtml(entry.text)}</span>`, "");
    return cell(
      `<span class="txt">${escapeHtml(entry.text || "—")}</span>` +
      (entry.revealed ? `<span class="pts">${entry.dupe ? "✗" : entry.points}</span>` : ""),
      `${entry.revealed ? "landing" : ""} ${entry.dupe && entry.revealed ? "dupe" : ""}`,
    );
  };

  const rows = card.map((q, i) => {
    const isCurrent = fm.stage === "play" && currentQ === i;
    const e0 = fm.entries[0][i];
    const e1 = fm.entries[1][i];
    // The second player's answers stay off the board until their turn.
    const hide1 = fm.player === 0 && fm.stage !== "done";
    return `<div class="fm-row">
      ${cell(`<span class="txt">${escapeHtml(q.question)}</span>`, `q ${isCurrent ? "landing" : ""}`)}
      ${entryCell(e0, false, isCurrent && fm.player === 0)}
      ${hide1 ? cell("", "blank") : entryCell(e1, false, isCurrent && fm.player === 1)}
    </div>`;
  }).join("");

  const total = fmTotal();
  const won = total >= fmTarget();

  holder.innerHTML = `
    <div class="fm-head">
      <span class="fm-title">⚡ Fast Money</span>
      <span class="fm-who">
        <span class="${showing === 0 ? "on" : ""}">${escapeHtml(fm.contestants[0] || "Player 1")}</span>
        <span class="${showing === 1 ? "on" : ""}">${escapeHtml(fm.contestants[1] || "Player 2")}</span>
      </span>
      <span class="spacer"></span>
      <span class="fm-clock ${clockLeft <= 3 ? "urgent" : clockLeft <= 8 ? "warn" : ""}">${clockLeft}</span>
    </div>
    <div class="fm-grid">${rows}</div>
    <div class="fm-foot">
      <span class="fm-target">Target ${fmTarget()}</span>
      <span class="fm-total ${won ? "win" : ""}"><span class="n">${total}</span><span class="l">points</span></span>
    </div>
    ${fm.stage === "intro" ? `<div class="fm-away">${escapeHtml(fm.contestants[fm.player] || "")} — ${fmSeconds(fm.player)} seconds. Ready?</div>` : ""}`;
}

/* ================================================================= control */

/** What the host should do next, in one line. */
function nextUpCopy() {
  const c = state.control;
  switch (state.phase) {
    case "idle":
      return { who: `Round ${roundNumber()}${multiplier() > 1 ? ` · ×${multiplier()}` : ""}`,
        what: "Start the face-off", hint: "Both families' first players get the buzzers." };
    case "face-off-ready": {
      const left = Math.max(0, Math.ceil((state.faceOff.armAt - Date.now()) / 1000));
      return { who: "Face-off", what: `Buzzers arm in ${left}…`, hint: "The countdown is on the TV." };
    }
    case "face-off-buzz":
      return { who: "Face-off", what: "Waiting for a buzz", hint: "Or press A / B to buzz for a family." };
    case "face-off-answer":
      return { who: `${team(state.faceOff.answering).name} buzzed in`, what: "Is it on the board?",
        hint: "Top answer wins the board outright." };
    case "face-off-second":
      return { who: `${team(state.faceOff.answering).name}'s turn`, what: "Is it on the board?",
        hint: "The higher answer takes the board." };
    case "play":
      return { who: `${team(c).name} · ${fmtScore(pot())} on the board`, what: "Next answer",
        hint: `${state.settings.strikes - state.strikes} strike${state.settings.strikes - state.strikes === 1 ? "" : "s"} left.` };
    case "steal":
      return { who: `${team(state.steal.team).name} to steal`, what: "One guess for the lot",
        hint: `${fmtScore(pot())} is on the line.` };
    case "round-over":
      return { who: `Round ${roundNumber()} over`, what: "Next round →", hint: "Scores carry over." };
    case "fast-money": {
      const fm = state.fm;
      if (!fm) return { who: "Fast Money", what: "—", hint: "" };
      if (fm.stage === "intro") return { who: "Fast Money", what: `${fm.contestants[fm.player]} is up`, hint: "Start the clock when they're ready." };
      if (fm.stage === "play") {
        const qi = fmCurrentIndex();
        return { who: `${fm.contestants[fm.player]} · ${fm.secondsLeft}s`,
          what: qi == null ? "Time" : fmQuestions()[qi].question, hint: "Type what they said, then Enter. ⇥ to pass." };
      }
      if (fm.stage === "reveal") return { who: `${fm.contestants[fm.revealPlayer]}'s answers`, what: "Reveal the scores", hint: "One at a time — space bar." };
      return { who: "Fast Money", what: fm.won ? "They won it" : "Not this time", hint: "" };
    }
    case "game-over":
      return { who: "That's the show", what: "Final scores are up", hint: "" };
    default:
      return { who: "", what: "", hint: "" };
  }
}

function renderControl() {
  const beginBtn = $("beginGameBtn");
  if (beginBtn) beginBtn.style.display = state.started ? "none" : "";
  const copy = nextUpCopy();
  $("nextUpWho").textContent = copy.who;
  $("nextUpWhat").textContent = copy.what;
  $("nextUpHint").textContent = copy.hint;

  const total = state.rounds.length;
  $("roundTag").innerHTML = state.phase === "fast-money"
    ? "⚡ Fast Money"
    : `Round ${roundNumber()}${total ? ` / ${total}` : ""}${multiplier() > 1 ? ` · <b>×${multiplier()}</b>` : ""}`;

  renderPending();
  renderGuessPanel();
  renderActions();
  renderStrikes();
  renderFmControls();
}

/* ---- the guess box ---------------------------------------------------- */

let guessPick = 0;

function renderGuessPanel() {
  const onFm = state.phase === "fast-money";
  const live = canReveal() || (onFm && state.fm && state.fm.stage === "play");
  $("guessPanel").style.display = live ? "" : "none";
  $("guessMode").textContent = state.settings.playMode === "phone" && !onFm ? "phones can answer too" : "";
  if (!live) { $("suggest").innerHTML = ""; return; }

  const input = $("guessInput");
  input.placeholder = onFm ? "Type their answer, then Enter" : "Type what they said, then Enter";
  renderSuggestions();
}

/** The ranked shortlist under the box — the host's safety net when it's close. */
function renderSuggestions() {
  const box = $("suggest");
  const hint = $("guessHint");
  const text = $("guessInput").value.trim();
  const onFm = state.phase === "fast-money";

  const survey = onFm
    ? (state.fm && fmCurrentIndex() != null ? fmQuestions()[fmCurrentIndex()] : null)
    : round();
  if (!survey) { box.innerHTML = ""; hint.textContent = ""; return; }

  if (!text) {
    box.innerHTML = "";
    hint.textContent = onFm
      ? "Enter records it · Tab passes"
      : "Enter reveals the best match · Enter on no match is a strike · click the board to reveal directly";
    return;
  }

  const taken = onFm ? [] : state.revealed;
  const ranked = scoreGuess(text, survey).filter((r) => !taken.includes(r.answer.id)).slice(0, 3);
  guessPick = Math.min(guessPick, Math.max(0, ranked.length - 1));

  box.innerHTML = ranked.map((r, i) => {
    const strong = r.score >= MATCH_THRESHOLD;
    return `<button class="sg ${i === guessPick ? "pick" : ""} ${strong ? "strong" : "weak"}" data-i="${r.index}">
      <span class="n">${survey.answers.indexOf(r.answer) + 1}</span>
      <span class="t">${escapeHtml(r.answer.text)}</span>
      <span class="p">${r.answer.points}</span>
      <span class="sc">${strong ? "match" : `${Math.round(r.score * 100)}%`}</span>
    </button>`;
  }).join("");

  [...box.children].forEach((btn) => {
    btn.addEventListener("click", () => acceptGuess(Number(btn.dataset.i)));
  });

  const best = ranked[0];
  hint.textContent = best && best.score >= MATCH_THRESHOLD
    ? "Enter reveals the highlighted answer"
    : onFm ? "Enter records it as said (no match found)"
      : "Nothing close — Enter records a strike";
}

/** Take the guess: reveal the picked answer, or strike out. */
function submitGuess() {
  const text = $("guessInput").value.trim();
  const onFm = state.phase === "fast-money";

  if (onFm) { fmSubmit(text); $("guessInput").value = ""; renderSuggestions(); return; }
  if (!canReveal()) return;

  const survey = round();
  if (!survey) return;
  const ranked = scoreGuess(text, survey).filter((r) => !state.revealed.includes(r.answer.id));
  const chosen = ranked[guessPick];

  if (text && chosen && chosen.score >= MATCH_THRESHOLD) {
    acceptGuess(chosen.index);
    return;
  }
  // Nothing close enough: that's a miss.
  $("guessInput").value = "";
  guessPick = 0;
  addStrike(text);
}

function acceptGuess(index) {
  $("guessInput").value = "";
  guessPick = 0;
  revealAnswer(index, { source: "guess" });
  renderSuggestions();
}

function focusGuess() {
  if (!isControl) return;
  setTimeout(() => {
    const i = $("guessInput");
    if (i && $("guessPanel").style.display !== "none") i.focus();
  }, 30);
}

/* ---- phase actions ---------------------------------------------------- */

function renderActions() {
  const acts = $("actionActs");
  const head = $("actionHead");
  const hint = $("actionHint");
  acts.innerHTML = "";
  hint.textContent = "";
  const add = (label, cls, fn, kbd) => {
    const b = document.createElement("button");
    b.className = `btn big ${cls}`;
    b.innerHTML = `${label}${kbd ? `<span class="kbd">${kbd}</span>` : ""}`;
    b.addEventListener("click", fn);
    acts.appendChild(b);
    return b;
  };

  switch (state.phase) {
    case "idle":
      head.textContent = "Face-off";
      add("👐 Start the face-off", "go wide ready", startFaceOff, "space");
      add("▶ Skip to play", "wide", () => giveControl(0, "skip"));
      hint.textContent = "Skip hands the board straight to the first family — handy for a quick game.";
      break;

    case "face-off-ready":
      head.textContent = "Face-off";
      add("⏭ Arm them now", "go wide", () => { state.phase = "face-off-buzz"; pushState(); });
      break;

    case "face-off-buzz":
      head.textContent = "Who buzzed?";
      state.teams.forEach((t, i) => {
        const p = playerUp(i);
        add(`${i === 0 ? "🅐" : "🅑"} ${escapeHtml(p ? p.name : t.name)}`, "", () => faceOffBuzz(i), i === 0 ? "A" : "B");
      });
      hint.textContent = "Phones in the room buzz themselves — these are for families playing without one.";
      break;

    case "face-off-answer":
    case "face-off-second":
      head.textContent = "Face-off answer";
      add("✗ Not on the board", "bad wide", () => addStrike($("guessInput").value.trim()), "X");
      hint.textContent = "Or click the answer on the board / use the box above.";
      break;

    case "play":
      head.textContent = "The board";
      add("✗ Strike", "bad wide", () => addStrike($("guessInput").value.trim()), "X");
      add("⏭ Next player", "", () => { advancePlayer(state.control); pushState(); });
      add("🏁 End round", "", () => finishRound(state.control, "cleared"));
      break;

    case "steal":
      head.textContent = "The steal";
      add("✗ Wrong — no steal", "bad wide", () => addStrike($("guessInput").value.trim()), "X");
      hint.textContent = "One guess only. Right takes the lot; wrong and the other family keeps it.";
      break;

    case "round-over":
      head.textContent = "Round over";
      add("Next round →", "go wide ready", nextRound, "space");
      add("👀 Reveal the rest", "wide", () => { state.revealed = answers().map((a) => a.id); pushState(); });
      break;

    case "fast-money":
      head.textContent = "Fast Money";
      hint.textContent = "Controls are in the Fast Money panel below.";
      break;

    case "game-over":
      head.textContent = "Show over";
      add("↺ New game", "wide", () => {
        state.teams.forEach((t) => { t.total = 0; t.upIndex = 0; });
        state.roundIndex = 0; state.fm = null; state.podium = false;
        renderPodium.done = false;
        resetRoundState(); pushState();
      });
      break;

    default:
      head.textContent = "Round";
  }
}

function renderStrikes() {
  const row = $("strikeRow");
  const n = state.settings.strikes;
  // These buttons write state.strikes directly, bypassing addStrike()'s phase
  // checks — so they have to gate themselves. Only meaningful once a family
  // actually has the board, same as the scorecard's own strike display.
  $("strikePanel").style.display = state.phase === "play" || state.phase === "steal" ? "" : "none";
  $("potLabel").textContent = `${fmtScore(pot())} on the board`;
  if (row.children.length !== n + 1) {
    row.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const b = document.createElement("button");
      b.className = "stk";
      b.textContent = "✗";
      b.title = `Set strikes to ${i + 1}`;
      b.addEventListener("click", () => {
        // Clicking the last lit strike clears it — the fastest possible undo.
        state.strikes = state.strikes === i + 1 ? i : i + 1;
        if (state.strikes >= state.settings.strikes && state.phase === "play") startSteal();
        else pushState();
      });
      row.appendChild(b);
    }
    const clear = document.createElement("button");
    clear.className = "btn sm ghost";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => { state.strikes = 0; pushState(); });
    row.appendChild(clear);
  }
  [...row.children].forEach((b, i) => {
    if (i < n) b.classList.toggle("on", i < state.strikes);
  });
}

function renderFmControls() {
  const fm = state.fm;
  const panel = $("fmPanel");
  panel.style.display = state.phase === "fast-money" && fm ? "" : "none";
  if (!fm || state.phase !== "fast-money") return;

  $("fmStatus").textContent = fm.stage === "play" ? `${fm.secondsLeft}s left`
    : fm.stage === "reveal" ? `${fm.revealAt}/${fm.entries[fm.revealPlayer].length} revealed`
      : fm.stage === "done" ? `${fmTotal()} points` : "ready";

  const box = $("fmControls");
  box.innerHTML = "";
  const acts = document.createElement("div");
  acts.className = "acts";
  box.appendChild(acts);
  const add = (label, cls, fn, kbd) => {
    const b = document.createElement("button");
    b.className = `btn big ${cls}`;
    b.innerHTML = `${label}${kbd ? `<span class="kbd">${kbd}</span>` : ""}`;
    b.addEventListener("click", fn);
    acts.appendChild(b);
  };

  if (fm.stage === "intro") {
    add(`▶ Start ${escapeHtml(fm.contestants[fm.player] || "")} · ${fmSeconds(fm.player)}s`, "go wide ready", fmStartTurn, "space");
  } else if (fm.stage === "play") {
    add(fm.running ? "⏸ Pause clock" : "▶ Resume clock", "wide", () => {
      if (fm.running) { fm.running = false; fm.deadline = null; clearInterval(fmTimer); pushState(); }
      else { fm.running = true; fm.deadline = Date.now() + fm.secondsLeft * 1000; pushState(); runFmClock(); }
    });
    add("⇥ Pass", "", fmPass, "tab");
    add("⏱ End turn", "", fmEndTurn);
    // Jump straight to any question, for when the host works out of order.
    const jump = document.createElement("div");
    jump.className = "acts";
    jump.style.marginTop = "8px";
    fmQuestions().forEach((q, i) => {
      const b = document.createElement("button");
      b.className = `btn sm ${fmCurrentIndex() === i ? "go" : ""}`;
      b.textContent = String(i + 1);
      b.title = q.question;
      b.addEventListener("click", () => fmGoTo(i));
      jump.appendChild(b);
    });
    box.appendChild(jump);
  } else if (fm.stage === "reveal") {
    add("👀 Reveal next", "go wide ready", fmRevealNext, "space");
    add("⏩ Reveal all", "", fmRevealAll);
    add(fm.revealPlayer === 0 ? "Bring in player 2 →" : "Score it →", "", fmAfterReveal);
    // Fixing a score by hand, because the matcher can't hear the room.
    const fix = document.createElement("div");
    fix.className = "roster";
    fix.style.marginTop = "8px";
    fm.entries[fm.revealPlayer].forEach((e, i) => {
      const r = document.createElement("div");
      r.className = "r";
      r.innerHTML = `<span class="nm">${escapeHtml(e.text || "—")}</span>`;
      const input = document.createElement("input");
      input.className = "input";
      input.style.cssText = "width:58px;padding:4px 6px;text-align:center;font-weight:800";
      input.value = String(e.points);
      input.addEventListener("change", () => {
        fm.entries[fm.revealPlayer][i] = { ...e, points: Math.max(0, parseInt(input.value, 10) || 0), dupe: false };
        pushState();
      });
      r.appendChild(input);
      fix.appendChild(r);
    });
    box.appendChild(fix);
  } else {
    add("🏆 Final scores", "go wide", () => { state.podium = true; state.phase = "game-over"; pushState(); });
  }
}

/* -------------------------------------------------------------- misc UI */

let tvWin = null;
function openTv() {
  const q = new URLSearchParams(location.search);
  q.set("screen", "display");
  // A single shared window name across every game's console, so opening the TV
  // for a different game reuses/replaces whatever is already fullscreen there
  // instead of piling up a new tab per game.
  tvWin = window.open(`feud.html?${q}`, "gameShowTV");
  if (tvWin) { tvWin.focus(); setTimeout(pushState, 400); }
  else toast("Allow pop-ups for this page, then retry");
}

/** TV: resume full screen after this window gets reused for another game. */
function initFsResume() {
  const el = document.getElementById("fsResume");
  if (!el) return;
  const check = () => el.classList.toggle("show", !document.fullscreenElement);
  el.addEventListener("click", () => { document.documentElement.requestFullscreen().catch(() => {}); });
  document.addEventListener("fullscreenchange", check);
  check();
}

let toastT = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 2600);
}

function showOverlay(node) {
  const card = $("overlayCard");
  card.innerHTML = "";
  card.appendChild(node);
  $("overlay").classList.add("show");
}
function hideOverlay() { $("overlay").classList.remove("show"); }

/* ================================================== setup & rule variations */

const h = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d; };

/** A labelled settings row whose control writes straight through to settings. */
function settingRow(label, hint, control) {
  const row = document.createElement("div");
  row.className = "set-row";
  row.appendChild(h(`<div class="lbl">${label}${hint ? `<small>${hint}</small>` : ""}</div>`).firstChild);
  row.appendChild(control);
  return row;
}

function segControl(options, value, onPick) {
  const seg = document.createElement("div");
  seg.className = "seg";
  options.forEach((o) => {
    const b = document.createElement("button");
    b.textContent = o.label;
    b.className = o.value === value ? "on" : "";
    b.addEventListener("click", () => onPick(o.value));
    seg.appendChild(b);
  });
  return seg;
}

function numberControl(value, { min = 0, max = 999, step = 1 }, onChange) {
  const i = document.createElement("input");
  i.type = "number";
  i.className = "input";
  Object.assign(i, { value: String(value), min, max, step });
  i.addEventListener("change", () => onChange(Math.max(min, Math.min(max, Number(i.value) || 0))));
  return i;
}

function setSetting(patch) {
  state.settings = saveFeudSettings(patch);
  pushState();
}

function showSetup() {
  const wrap = document.createElement("div");
  wrap.appendChild(h(`<h3>⚙ Setup</h3>`).firstChild);

  /* ---- families ---- */
  wrap.appendChild(h(`<div class="sec">Families</div>`).firstChild);
  state.teams.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("input");
    name.className = "input grow";
    name.value = t.name;
    name.addEventListener("input", () => { t.name = name.value; pushState(); });
    const score = document.createElement("input");
    score.className = "input";
    score.type = "number";
    score.style.width = "110px";
    score.value = String(t.total);
    score.addEventListener("input", () => { t.total = parseInt(score.value, 10) || 0; pushState(); });
    row.append(name, score);
    wrap.appendChild(row);

    if (t.players.length) {
      const roster = document.createElement("div");
      roster.className = "roster";
      roster.style.margin = "4px 0 12px";
      t.players.forEach((p, pi) => {
        const r = h(`<div class="r ${t.upIndex % t.players.length === pi ? "up" : ""}">
          <span class="dot"></span><span class="nm">${escapeHtml(p.name)}</span></div>`).firstChild;
        const up = document.createElement("button");
        up.className = "btn sm ghost";
        up.textContent = "▲ Up next";
        up.addEventListener("click", () => { t.upIndex = pi; pushState(); showSetup(); });
        const swap = document.createElement("button");
        swap.className = "btn sm ghost";
        swap.textContent = "⇄";
        swap.title = "Move to the other family";
        swap.addEventListener("click", () => {
          t.players.splice(pi, 1);
          state.teams[otherTeam(i)].players.push(p);
          pushState(); showSetup();
        });
        r.append(up, swap);
        roster.appendChild(r);
      });
      wrap.appendChild(roster);
    }
  });

  /* ---- the running order ---- */
  wrap.appendChild(h(`<div class="sec">Jump to a round</div>`).firstChild);
  const jump = document.createElement("div");
  jump.className = "row";
  jump.style.flexWrap = "wrap";
  state.rounds.forEach((r, i) => {
    const b = document.createElement("button");
    b.className = `btn sm ${i === state.roundIndex ? "go" : ""}`;
    b.textContent = `${i + 1}${(r.multiplier || 1) > 1 ? `·×${r.multiplier}` : ""}`;
    b.title = r.question;
    b.addEventListener("click", () => {
      state.roundIndex = i;
      resetRoundState();
      pushState();
      hideOverlay();
    });
    jump.appendChild(b);
  });
  if (state.fastMoneyCard.length) {
    const b = document.createElement("button");
    b.className = "btn sm";
    b.textContent = "⚡ Fast Money";
    b.addEventListener("click", () => { startFastMoney(); hideOverlay(); });
    jump.appendChild(b);
  }
  wrap.appendChild(jump);

  /* ---- rule variations ---- */
  const s = state.settings;
  wrap.appendChild(h(`<div class="sec">How this game plays</div>`).firstChild);

  wrap.appendChild(settingRow("Main rounds", "Who puts the answer in", segControl(
    [{ value: "verbal", label: "🗣 Verbal" }, { value: "phone", label: "📱 Phone" }],
    s.playMode, (v) => { setSetting({ playMode: v }); showSetup(); })));

  wrap.appendChild(settingRow("Face-off buzzers", "Phones in the room buzz in", segControl(
    [{ value: true, label: "On" }, { value: false, label: "Off" }],
    !!s.faceOffBuzzers, (v) => { setSetting({ faceOffBuzzers: v }); showSetup(); })));

  wrap.appendChild(settingRow("Face-off countdown", "Seconds before the buzzers arm",
    numberControl(s.faceOffCountdown, { min: 0, max: 10 }, (v) => setSetting({ faceOffCountdown: v }))));

  wrap.appendChild(settingRow("Strikes", "Misses before the board is up for a steal",
    numberControl(s.strikes, { min: 1, max: 3 }, (v) => setSetting({ strikes: v }))));

  wrap.appendChild(settingRow("Reveal the rest", "Turn the unfound answers over at the end of a round", segControl(
    [{ value: true, label: "On" }, { value: false, label: "Off" }],
    !!s.revealRestOnLoss, (v) => { setSetting({ revealRestOnLoss: v }); showSetup(); })));

  wrap.appendChild(settingRow("Auto-advance", "Move to the next round on its own", segControl(
    [{ value: true, label: "On" }, { value: false, label: "Off" }],
    !!s.autoAdvance, (v) => { setSetting({ autoAdvance: v }); showSetup(); })));

  wrap.appendChild(h(`<div class="sec">Fast Money</div>`).firstChild);
  wrap.appendChild(settingRow("Play Fast Money", `${state.fastMoneyCard.length} question${state.fastMoneyCard.length === 1 ? "" : "s"} on the card`, segControl(
    [{ value: true, label: "On" }, { value: false, label: "Off" }],
    !!s.fastMoneyEnabled, (v) => { setSetting({ fastMoneyEnabled: v }); showSetup(); })));
  wrap.appendChild(settingRow("Answers", "Typed by the host, or sent from the phone", segControl(
    [{ value: "verbal", label: "🗣 Host" }, { value: "phone", label: "📱 Phone" }],
    s.fastMoneyMode, (v) => { setSetting({ fastMoneyMode: v }); showSetup(); })));
  wrap.appendChild(settingRow("Target", "Points the pair need to win",
    numberControl(s.fastMoneyTarget, { min: 50, max: 500, step: 10 }, (v) => setSetting({ fastMoneyTarget: v }))));
  wrap.appendChild(settingRow("First player's clock", "Seconds",
    numberControl(s.fastMoneySeconds[0], { min: 5, max: 120 }, (v) => setSetting({ fastMoneySeconds: [v, s.fastMoneySeconds[1]] }))));
  wrap.appendChild(settingRow("Second player's clock", "Seconds",
    numberControl(s.fastMoneySeconds[1], { min: 5, max: 120 }, (v) => setSetting({ fastMoneySeconds: [s.fastMoneySeconds[0], v] }))));

  wrap.appendChild(h(`<div class="sec">Presentation</div>`).firstChild);
  wrap.appendChild(settingRow("Animation speed", "How quickly the board moves", segControl(
    [{ value: 0.75, label: "Relaxed" }, { value: 1, label: "Normal" }, { value: 1.5, label: "Snappy" }],
    s.animationSpeed, (v) => { setSetting({ animationSpeed: v }); applyAnimationSpeed(); showSetup(); })));

  /* ---- destructive ---- */
  const foot = document.createElement("div");
  foot.className = "foot";
  const reset = document.createElement("button");
  reset.className = "btn danger";
  reset.textContent = "Reset scores";
  reset.addEventListener("click", () => {
    if (!confirm("Reset both families to zero?")) return;
    state.teams.forEach((t) => { t.total = 0; });
    pushState(); showSetup();
  });
  const full = document.createElement("button");
  full.className = "btn danger";
  full.textContent = "Full reset";
  full.addEventListener("click", () => {
    if (!confirm("Start the whole show again? Scores, rounds and Fast Money are cleared.")) return;
    state.teams.forEach((t) => { t.total = 0; t.upIndex = 0; });
    state.roundIndex = 0; state.fm = null; state.podium = false;
    state.started = false;   // back to the title screen too
    renderPodium.done = false;
    resetRoundState(); pushState(); hideOverlay();
  });
  const done = document.createElement("button");
  done.className = "btn primary";
  done.textContent = "Done";
  done.addEventListener("click", hideOverlay);
  foot.append(reset, full, done);
  wrap.appendChild(foot);

  showOverlay(wrap);
}

/** Everything the host might need to put right by hand, mid-show. */
function showOverrides() {
  const wrap = document.createElement("div");
  wrap.appendChild(h(`<h3>⚙ Overrides</h3>`).firstChild);
  wrap.appendChild(h(`<p class="tiny" style="margin:-8px 0 4px">Nothing here follows the rules — it's for putting the game back where it should be.</p>`).firstChild);

  wrap.appendChild(h(`<div class="sec">Score</div>`).firstChild);
  const amt = document.createElement("input");
  amt.className = "input";
  amt.type = "number";
  amt.value = "10";
  amt.style.width = "100px";
  const scoreRow = document.createElement("div");
  scoreRow.className = "row";
  scoreRow.appendChild(amt);
  state.teams.forEach((t, i) => {
    const plus = document.createElement("button");
    plus.className = "btn sm good";
    plus.textContent = `+ ${t.name}`;
    plus.addEventListener("click", () => { t.total += Math.abs(parseInt(amt.value, 10) || 0); pushState(); });
    const minus = document.createElement("button");
    minus.className = "btn sm danger";
    minus.textContent = `− ${t.name}`;
    minus.addEventListener("click", () => { t.total -= Math.abs(parseInt(amt.value, 10) || 0); pushState(); });
    scoreRow.append(plus, minus);
  });
  wrap.appendChild(scoreRow);

  wrap.appendChild(h(`<div class="sec">The board</div>`).firstChild);
  const boardRow = document.createElement("div");
  boardRow.className = "row";
  boardRow.style.flexWrap = "wrap";
  const btn = (label, fn, cls = "sm") => {
    const b = document.createElement("button");
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.addEventListener("click", fn);
    boardRow.appendChild(b);
  };
  btn("Reveal all", () => { state.revealed = answers().map((a) => a.id); pushState(); });
  btn("Hide all", () => { state.revealed = []; pushState(); });
  btn("Undo last reveal", () => { state.revealed = state.revealed.slice(0, -1); pushState(); });
  btn("Clear strikes", () => { state.strikes = 0; pushState(); });
  wrap.appendChild(boardRow);

  wrap.appendChild(h(`<div class="sec">Who has the board</div>`).firstChild);
  const ctlRow = document.createElement("div");
  ctlRow.className = "row";
  state.teams.forEach((t, i) => {
    const b = document.createElement("button");
    b.className = `btn sm ${state.control === i ? "go" : ""}`;
    b.textContent = t.name;
    b.addEventListener("click", () => { state.control = i; state.phase = "play"; pushState(); showOverrides(); });
    ctlRow.appendChild(b);
  });
  const stealBtn = document.createElement("button");
  stealBtn.className = "btn sm";
  stealBtn.textContent = "Go to the steal";
  stealBtn.addEventListener("click", () => { if (state.control != null) { startSteal(); hideOverlay(); } });
  ctlRow.appendChild(stealBtn);
  wrap.appendChild(ctlRow);

  wrap.appendChild(h(`<div class="sec">Award the board</div>`).firstChild);
  const awardRow = document.createElement("div");
  awardRow.className = "row";
  state.teams.forEach((t, i) => {
    const b = document.createElement("button");
    b.className = "btn sm good";
    b.textContent = `${fmtScore(pot())} → ${t.name}`;
    b.addEventListener("click", () => { finishRound(i, "cleared"); hideOverlay(); });
    awardRow.appendChild(b);
  });
  wrap.appendChild(awardRow);

  const foot = document.createElement("div");
  foot.className = "foot";
  const done = document.createElement("button");
  done.className = "btn primary";
  done.textContent = "Done";
  done.addEventListener("click", hideOverlay);
  foot.appendChild(done);
  wrap.appendChild(foot);

  showOverlay(wrap);
}

/** The host's animation-speed preference, pushed out as CSS timings. */
function applyAnimationSpeed() {
  const speed = Number(state.settings.animationSpeed) || 1;
  const root = document.documentElement.style;
  root.setProperty("--dur", `${(0.22 / speed).toFixed(3)}s`);
  root.setProperty("--fb-flip", `${Math.round(520 / speed)}ms`);
}

/* ========================================================= PHONES ====
   Two ways to play. Verbal is the default and needs no phones at all: the room
   answers out loud and the host types it (or clicks the board). Phone answers
   hand the family whose turn it is a box to type into — and because the host
   still has to accept a submission before it lands, a phone can never reveal
   an answer on its own.

   The console stays the referee either way: a phone submits an intent, the
   console applies it through exactly the same functions the buttons call, so
   there is only ever one implementation of the rules. */

const BUZZER_BASE = (() => {
  try { return localStorage.getItem("gsp_buzzer_base") || "https://gameshow-mu.vercel.app"; }
  catch { return "https://gameshow-mu.vercel.app"; }
})();
const joinURL = () => `${BUZZER_BASE}/feud?code=${state.roomCode}`;

let phoneTimer = null;
let phoneSeq = 0, lastPushSig = "";
let phonePlayers = [];

const phoneApi = (body) => fetch(`${BUZZER_BASE}/api/feud`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: state.roomCode, hostToken: state.hostToken, ...body }),
}).then((x) => x.json());

async function createRoom() {
  const btn = $("createRoomBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
  let r = null;
  try {
    r = await fetch(`${BUZZER_BASE}/api/create`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }).then((x) => x.json());
  } catch { /* offline */ }
  if (btn) { btn.disabled = false; btn.textContent = "Create a room"; }
  if (!r || !r.code) { toast("Couldn't reach the phone service — check the internet"); return; }
  state.roomCode = r.code;
  state.hostToken = r.hostToken;
  pushState();
  startPhoneSync();
  toast(`Room ${r.code} is open`);
}

function disconnectRoom() {
  if (state.roomCode && state.hostToken) phoneApi({ action: "end" }).catch(() => {});
  state.roomCode = ""; state.hostToken = "";
  clearTimeout(phoneTimer); phoneTimer = null;
  phonePlayers = [];
  state.teams.forEach((t) => { t.players = []; });
  pushState();
}

/** Everything a phone needs to draw the right screen — and nothing more. */
function phoneSnapshot() {
  const fm = state.fm;
  const revealedIds = new Set(state.revealed);
  const r = round();

  const sig = JSON.stringify([state.phase, state.control, state.revealed.length, state.strikes,
    state.roundIndex, fm && [fm.stage, fm.player, fm.at], state.pending?.length]);
  if (sig !== lastPushSig) { lastPushSig = sig; phoneSeq++; }

  // Who is allowed to type an answer right now.
  let activePid = null;
  if (state.settings.playMode === "phone" && canReveal()) {
    const t = currentTeam();
    if (t != null) activePid = playerUp(t)?.pid || null;
  }
  if (state.phase === "fast-money" && state.settings.fastMoneyMode === "phone"
      && fm && fm.stage === "play" && fm.running) {
    activePid = fm.contestantPids[fm.player] || null;
  }

  const fmQ = fm && fm.stage === "play" && fmCurrentIndex() != null ? fmQuestions()[fmCurrentIndex()] : null;

  return {
    seq: phoneSeq,
    phase: state.phase,
    // A face-off is open to the two players at the front of the line.
    buzzOpen: state.phase === "face-off-buzz" && !!state.settings.faceOffBuzzers,
    buzzPids: state.teams.map((_, i) => playerUp(i)?.pid).filter(Boolean),
    activePid,
    activeName: activePid ? (phonePlayers.find((p) => p.pid === activePid)?.name || "") : "",
    question: state.phase === "fast-money" ? (fmQ ? fmQ.question : "") : (r ? r.question : ""),
    answersCount: r ? r.answers.length : 0,
    found: r ? r.answers.filter((a) => revealedIds.has(a.id)).map((a) => ({ text: a.text, points: a.points })) : [],
    strikes: state.strikes,
    maxStrikes: state.settings.strikes,
    teams: state.teams.map((t) => ({ name: t.name, total: t.total, pids: t.players.map((p) => p.pid) })),
    control: state.control,
    pending: (state.pending || []).map((p) => p.pid),
    fm: fm && state.phase === "fast-money"
      ? { stage: fm.stage, player: fm.player, secondsLeft: fm.secondsLeft, running: !!fm.running,
          contestantPids: fm.contestantPids, target: fmTarget() }
      : null,
  };
}

/** Poll: publish the snapshot, take whatever the phones sent, act on it. */
function startPhoneSync() {
  if (!isControl) return;
  clearTimeout(phoneTimer);
  if (!state.roomCode || !state.hostToken) return;

  const tick = async () => {
    if (!state.roomCode) return;
    try {
      await phoneApi({ action: "push", state: phoneSnapshot() });
      const [drained, roomState] = await Promise.all([
        phoneApi({ action: "drain" }),
        fetch(`${BUZZER_BASE}/api/state?code=${state.roomCode}`).then((x) => x.json()).catch(() => null),
      ]);
      if (roomState && Array.isArray(roomState.players)) {
        phonePlayers = roomState.players;
        syncPhonePlayers(roomState.players);
      }
      if (drained && Array.isArray(drained.subs) && drained.subs.length) {
        for (const sub of drained.subs) applySubmission(sub);
      }
      renderPhonePanel();
    } catch { /* transient: the loop keeps going */ }
    clearTimeout(phoneTimer);
    // Faster while a buzz could land, slower when nothing is waiting on a phone.
    const hot = state.phase === "face-off-buzz"
      || (state.settings.playMode === "phone" && canReveal())
      || (state.phase === "fast-money" && state.fm && state.fm.running);
    phoneTimer = setTimeout(tick, hot ? 700 : 2200);
  };
  tick();
}

/** Players who join on their phones become family members, matched by name. */
function syncPhonePlayers(list) {
  if (!list.length) return;
  let changed = false;
  const known = new Map();
  state.teams.forEach((t, ti) => t.players.forEach((p) => known.set(p.pid, { p, ti })));

  for (const ph of list) {
    const hit = known.get(ph.pid);
    if (hit) {
      if (hit.p.name !== ph.name) { hit.p.name = ph.name; changed = true; }
      continue;
    }
    // New phone: it joins whichever family is shorter, so the two sides fill evenly.
    const ti = state.teams[0].players.length <= state.teams[1].players.length ? 0 : 1;
    state.teams[ti].players.push({ id: newId("pl"), name: ph.name, pid: ph.pid });
    changed = true;
  }
  // Somebody was kicked from the room.
  const live = new Set(list.map((p) => p.pid));
  state.teams.forEach((t) => {
    const before = t.players.length;
    t.players = t.players.filter((p) => live.has(p.pid));
    if (t.players.length !== before) {
      changed = true;
      if (t.upIndex >= t.players.length) t.upIndex = 0;
    }
  });
  if (changed) pushState();
}

/**
 * A phone's submission. Buzzes are instant — that's the whole point of a buzzer.
 * Answers queue for the host, because the host is the one who decides whether
 * what a family said is what the board says.
 */
function applySubmission(sub) {
  if (sub.action === "buzz") {
    if (state.phase !== "face-off-buzz") return;
    faceOffBuzz(sub.pid, sub.name);
    return;
  }

  if (sub.action === "answer") {
    const text = String(sub.text || "").trim();
    if (!text) return;

    // Fast Money in phone mode goes straight into the entry: the host already
    // reviews every one of those at reveal time.
    if (state.phase === "fast-money") {
      const fm = state.fm;
      if (!fm || fm.stage !== "play" || sub.pid !== fm.contestantPids[fm.player]) return;
      fmSubmit(text);
      return;
    }
    if (!canReveal()) return;
    const teamIndex = teamOfPid(sub.pid);
    if (teamIndex == null || teamIndex !== currentTeam()) return;

    const hit = matchAnswer(text, round(), { exclude: state.revealed });
    state.pending = [...(state.pending || []), {
      id: newId("sub"), pid: sub.pid, name: sub.name, text,
      team: teamIndex, index: hit ? hit.index : null, score: hit ? hit.score : 0,
    }];
    sfx.buzzIn();
    pushState();
    return;
  }

  if (sub.action === "pass" && state.phase === "fast-money") fmPass();
}

/** The host's accept/reject strip — a phone answer is only ever a suggestion. */
function renderPending() {
  const box = $("pendingBox");
  const list = state.pending || [];
  if (!box) return;
  box.style.display = list.length ? "" : "none";
  if (!list.length) { box.innerHTML = ""; return; }

  box.innerHTML = list.map((p) => {
    const match = p.index != null ? answers()[p.index] : null;
    return `<div class="pend">
      <div class="pend-top"><b>${escapeHtml(p.name)}</b> said</div>
      <div class="pend-txt">${escapeHtml(p.text)}</div>
      <div class="pend-match">${match
        ? `matches <b>${escapeHtml(match.text)}</b> · ${match.points}`
        : "nothing on the board"}</div>
      <div class="pend-acts">
        <button class="btn sm good" data-act="ok" data-id="${p.id}">${match ? "✓ Reveal" : "✓ Accept as a miss"}</button>
        <button class="btn sm ghost" data-act="no" data-id="${p.id}">Reject</button>
      </div>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = (state.pending || []).find((p) => p.id === btn.dataset.id);
      state.pending = (state.pending || []).filter((p) => p.id !== btn.dataset.id);
      if (!item) { pushState(); return; }
      if (btn.dataset.act === "no") { pushState(); return; }
      if (item.index != null) revealAnswer(item.index, { source: "phone" });
      else addStrike(item.text);
    });
  });
}

function renderPhonePanel() {
  if (!isControl) return;
  const on = state.settings.playMode === "phone";
  $("modeVerbal").classList.toggle("on", !on);
  $("modePhone").classList.toggle("on", on);
  $("modeHint").textContent = on
    ? "The family whose turn it is types on their phone; you accept or reject it."
    : "The room answers out loud; you type it or click the board. No phones needed.";

  const info = $("roomInfo");
  const create = $("createRoomBtn");
  if (state.roomCode) {
    info.style.display = "block";
    create.style.display = "none";
    $("roomCode").textContent = state.roomCode;
    $("joinUrl").textContent = joinURL().replace(/^https?:\/\//, "");
    const qb = $("qrBox");
    if (qb && qb.dataset.code !== state.roomCode) {
      qb.dataset.code = state.roomCode;
      qb.innerHTML = "";
      try { qb.appendChild(window.QR.canvas(joinURL(), 140, { margin: 2 })); }
      catch { qb.innerHTML = "<span style='color:#333;font-size:11px'>link above</span>"; }
    }
    const roster = $("roster");
    roster.innerHTML = state.teams.map((t, i) =>
      `<div class="r"><span class="dot"></span><span class="nm">${escapeHtml(t.name)}</span>
        <span class="tiny">${t.players.length} phone${t.players.length === 1 ? "" : "s"}</span></div>`
      + t.players.map((p, pi) =>
        `<div class="r ${t.upIndex % Math.max(1, t.players.length) === pi ? "up" : ""}" style="margin-left:12px">
          <span class="nm">${escapeHtml(p.name)}</span></div>`).join("")).join("");
  } else {
    info.style.display = "none";
    create.style.display = "";
  }
}

/** The join QR, big — TV only. */
function renderQrOverlay() {
  const o = $("qrOverlay");
  if (!o) return;
  const btn = $("showQrBtn");
  if (btn) btn.classList.toggle("on", !!state.qrOverlay);
  const show = state.qrOverlay && state.roomCode && SCREEN === "display";
  o.classList.toggle("show", !!show);
  if (!show) return;
  $("qrCode").textContent = state.roomCode;
  $("qrUrl").textContent = joinURL().replace(/^https?:\/\//, "");
  const box = $("qrBig");
  if (box.dataset.code === state.roomCode) return;
  box.dataset.code = state.roomCode;
  box.innerHTML = "";
  try { box.appendChild(window.QR.canvas(joinURL(), SCREEN === "display" ? 320 : 220, { margin: 2 })); }
  catch { box.textContent = joinURL(); }
}

/** TV: the title screen, up until the host hits Begin Game. */
function renderTitleScreen() {
  const el = $("titleScreen");
  if (!el) return;
  const show = SCREEN === "display" && !state.started;
  el.classList.toggle("show", show);
  if (!show) return;
  const wrap = $("titleQrWrap");
  if (!state.roomCode) { wrap.style.display = "none"; return; }
  wrap.style.display = "flex";
  const box = $("titleQrBig");
  if (box.dataset.code === state.roomCode) return;
  box.dataset.code = state.roomCode;
  box.innerHTML = "";
  try { box.appendChild(window.QR.canvas(joinURL(), 180, { margin: 2 })); }
  catch { box.textContent = joinURL(); }
}

/* ================================================================= wiring */

/** The one button the space bar presses, whatever the game is doing. */
function primaryAction() {
  switch (state.phase) {
    case "idle": startFaceOff(); return;
    case "face-off-ready": state.phase = "face-off-buzz"; pushState(); return;
    case "round-over": nextRound(); return;
    case "fast-money": {
      const fm = state.fm;
      if (!fm) return;
      if (fm.stage === "intro") fmStartTurn();
      else if (fm.stage === "reveal") fmRevealNext();
      else if (fm.stage === "done") { state.podium = true; state.phase = "game-over"; pushState(); }
      return;
    }
    default:
  }
}

if (isControl) {
  const on = (id, fn) => { const n = $(id); if (n) n.addEventListener("click", fn); };
  on("homeBtn", () => {
    if (confirm("Back to the Game Show Studio home screen?\n\nYour scores and progress are saved.")) location.href = "home.html";
  });
  on("openTvBtn", openTv);
  on("beginGameBtn", () => { state.started = true; pushState(); });
  on("setupBtn", showSetup);
  on("overrideBtn", showOverrides);
  on("fsBtn", () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
  on("nextRoundBtn", nextRound);
  on("resetRoundBtn", () => { if (confirm("Restart this round? Reveals and strikes are cleared.")) restartRound(); });
  on("dupWarnClose", () => {
    const w = $("dupWarn");
    w.dataset.dismissed = "1";
    w.style.display = "none";
  });
  on("soundBtn", () => {
    sfx.unlock();
    const muted = sfx.toggleMute();
    $("soundBtn").textContent = muted ? "🔇" : "🔊";
    toast(muted ? "Sound off on this screen" : "Sound on for this screen");
  });
  on("modeVerbal", () => { setSetting({ playMode: "verbal" }); toast("🗣 The room answers out loud"); });
  on("modePhone", () => {
    setSetting({ playMode: "phone" });
    if (!state.roomCode) toast("Create a room so phones can join");
    else toast("📱 The active family answers on their phone");
    startPhoneSync();
  });
  on("createRoomBtn", createRoom);
  on("disconnectBtn", () => { if (confirm("Disconnect this room? Phones will drop out.")) disconnectRoom(); });
  on("showQrBtn", () => { state.qrOverlay = !state.qrOverlay; pushState(); });
  // The podium fills the TV, but the host still needs their console behind it.
  on("podiumClose", () => { podiumDismissed = true; render(); });
  on("copyLinkBtn", () => {
    navigator.clipboard.writeText(joinURL()).then(() => toast("Join link copied"), () => toast("Couldn't copy — the link is above"));
  });
  $("qrOverlay").addEventListener("click", () => { state.qrOverlay = false; pushState(); });
  $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) hideOverlay(); });

  const input = $("guessInput");
  input.addEventListener("input", () => { guessPick = 0; renderSuggestions(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitGuess(); return; }
    if (e.key === "Tab" && state.phase === "fast-money") { e.preventDefault(); input.value = ""; fmPass(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); guessPick++; renderSuggestions(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); guessPick = Math.max(0, guessPick - 1); renderSuggestions(); return; }
    // An empty box means the host is watching, not typing — let the space bar
    // drive the show without making them click away first.
    if (e.key === " " && !input.value) { e.preventDefault(); primaryAction(); }
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT";
    if (e.key === "Escape") { hideOverlay(); state.qrOverlay = false; pushState(); return; }
    if (typing) return;

    if (e.key === " ") { e.preventDefault(); primaryAction(); return; }
    if (e.key === "x" || e.key === "X") { e.preventDefault(); addStrike(); return; }
    if ((e.key === "a" || e.key === "A") && state.phase === "face-off-buzz") { faceOffBuzz(0); return; }
    if ((e.key === "b" || e.key === "B") && state.phase === "face-off-buzz") { faceOffBuzz(1); return; }
    if (/^[1-8]$/.test(e.key) && canReveal()) { e.preventDefault(); revealAnswer(Number(e.key) - 1, { source: "key" }); return; }
    if (e.key === "Enter") { e.preventDefault(); focusGuess(); }
  });

  // Unlock audio on the first real gesture, as browsers require.
  document.addEventListener("click", () => sfx.unlock(), { once: true });
  $("soundBtn").textContent = sfx.muted ? "🔇" : "🔊";

  // Keep the clocks running after a reload mid-round.
  if (state.phase === "face-off-ready") runFaceOffClock();
  if (state.fm && state.fm.running) runFmClock();
  if (state.roomCode && state.hostToken) startPhoneSync();
} else {
  // The TV announces itself so control can catch it up straight away.
  bc.postMessage({ type: "ping" });
  initFsResume();
}

// Only control announces itself: "hello" is how two *control* windows find each
// other, and a TV saying it would set off the duplicate warning on its own.
if (isControl) bc.postMessage({ type: "hello", id: WIN_ID });
applyAnimationSpeed();

// One-shot moments (an award, a banner, the podium applause) are keyed by id so
// they fire exactly once. A window opening mid-show inherits ids it has never
// played, so they're marked as already seen — otherwise every TV that joins
// late replays the last celebration at the room.
shownAwardId = state.award ? state.award.id : null;
shownBannerId = state.banner ? state.banner.id : null;
renderPodium.done = !!state.podium;

render();
if (isControl) pushState();

// The face-off countdown and the Fast Money clock are rendered from a deadline,
// so the TV keeps its own smooth tick rather than waiting on a broadcast.
setInterval(() => {
  if (state.phase === "face-off-ready" || (state.fm && state.fm.running)) render();
}, 150);

