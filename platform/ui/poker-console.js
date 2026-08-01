// The Texas Hold'em host console.
//
// The laptop screen the host actually drives the game from. Everything here
// needs the room's host token, and every button is a request the *server*
// validates — the console is a remote control, not a source of truth. If it
// disagrees with the server, the server wins on the next poll.
//
// Two of the controls run on their own once switched on, and both are written
// so the console can only ever *ask*:
//
//   • the action clock — the console watches the countdown because it's the
//     screen with a clock on it, but it asks the server to time somebody out
//     and the server re-checks the elapsed time before folding anybody;
//   • auto-deal — the console starts the next hand after a pause, because
//     serverless functions have nobody to run a timer for them.

import { el, toast } from "./ui.js";
import { formatChips } from "../core/poker-chips.js";
import { DEFAULT_BLIND_LEVELS } from "../core/poker.js";

const STORE_KEY = "gsp_poker_host";
/** How long the table sits on a finished hand before auto-deal moves on. */
const AUTO_DEAL_DELAY_MS = 6000;

const loadRoom = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; }
};
const saveRoom = (room) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(room)); } catch { /* private mode */ }
};

/**
 * @param {HTMLElement} root
 * @param {{base:string, tvUrl:(code:string)=>string, joinUrl:(code:string)=>string}} opts
 * @returns {{destroy:()=>void}}
 */
export function mountPokerConsole(root, { base, tvUrl, joinUrl }) {
  ensureStyles();

  let room = loadRoom();
  let game = null;
  let poll = null;
  /** Guards so the two automatic behaviours fire once, not once per poll. */
  let timeoutSentFor = "";
  let autoDealAt = 0;

  const post = (body) =>
    fetch(`${base}/api/poker`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const host = (action, extra = {}) =>
    post({ code: room.code, hostToken: room.hostToken, action, ...extra })
      .then((r) => { if (r && r.error) toast(r.error); return r; });

  /* =================================================================== DOM */

  const statusPill = el("span", { class: "pc-status", text: "Connecting…" });
  const codeEl = el("div", { class: "pc-code" });
  const joinLinkEl = el("div", { class: "pc-link" });
  const qrBox = el("div", { class: "pc-qr" });
  const tvLink = el("a", { class: "btn sm", target: "_blank", rel: "noopener", text: "🖥 Open TV" });

  const dealBtn = el("button", { class: "btn primary big", text: "🂠 Deal hand" });
  const pauseBtn = el("button", { class: "btn big", text: "⏸ Pause" });
  const endHandBtn = el("button", { class: "btn danger big", text: "✋ End hand" });

  const summary = el("div", { class: "pc-summary" });
  const clock = el("div", { class: "pc-clock" });
  const seatList = el("div", { class: "pc-seats" });
  const blindRow = el("div", { class: "pc-chiprow" });
  const timerRow = el("div", { class: "pc-chiprow" });
  const autoDealBtn = el("button", { class: "chip", text: "Auto-deal" });
  const seatingCard = el("div", { class: "card pc-card" });

  const setupPane = el("div", { class: "pc-setup" });

  root.innerHTML = "";
  root.append(setupPane);

  /* ================================================================ setup */

  function renderSetup() {
    setupPane.innerHTML = "";
    if (!room) {
      setupPane.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big", text: "🂡" }),
        el("div", { html: "<strong>No table yet</strong>" }),
        el("p", { text: "Create a room, then share the code so people can sit down." }),
        el("button", {
          class: "btn primary big", style: { marginTop: "12px" }, text: "Create a table",
          onClick: async () => {
            const r = await fetch(`${base}/api/create`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
            }).then((x) => x.json()).catch(() => null);
            if (!r || !r.code) { toast("Couldn't reach the buzzer service"); return; }
            room = { code: r.code, hostToken: r.hostToken };
            saveRoom(room);
            await host("create");
            boot();
          },
        }),
      ]));
      return;
    }
    setupPane.replaceWith(layout());
  }

  function layout() {
    const grid = el("div", { class: "pc-grid" }, [
      el("div", { class: "pc-main" }, [
        el("div", { class: "card pc-card" }, [
          el("div", { class: "pc-actions" }, [dealBtn, pauseBtn, endHandBtn]),
          summary,
          clock,
        ]),
        el("div", { class: "card pc-card" }, [
          el("h3", { text: "Players" }),
          seatList,
        ]),
      ]),
      el("div", { class: "pc-side" }, [
        el("div", { class: "card pc-card" }, [
          el("h3", { text: "Players join here" }),
          codeEl, joinLinkEl, qrBox,
          el("div", { class: "pc-row" }, [
            el("button", {
              class: "btn sm", text: "Copy link",
              onClick: (e) => {
                navigator.clipboard.writeText(joinUrl(room.code));
                e.target.textContent = "Copied!";
                setTimeout(() => { e.target.textContent = "Copy link"; }, 1200);
              },
            }),
            tvLink,
          ]),
        ]),
        el("div", { class: "card pc-card" }, [
          el("h3", { text: "Blinds" }),
          blindRow,
          el("h3", { style: { marginTop: "14px" }, text: "Action clock" }),
          timerRow,
          el("h3", { style: { marginTop: "14px" }, text: "Dealing" }),
          el("div", { class: "pc-chiprow" }, [autoDealBtn]),
        ]),
        seatingCard,
      ]),
    ]);
    return grid;
  }

  /* ============================================================== actions */

  dealBtn.addEventListener("click", () => host("start"));
  pauseBtn.addEventListener("click", () => host(game && game.paused ? "resume" : "pause"));
  endHandBtn.addEventListener("click", async () => {
    if (!confirm("End this hand and give everyone their chips back?")) return;
    await host("endHand");
  });
  autoDealBtn.addEventListener("click", () => host("autoDeal", { on: !(game && game.autoDeal) }));

  /* =============================================================== render */

  function render() {
    if (!game) return;

    // --- headline buttons -------------------------------------------------
    const between = game.street === "waiting" || game.street === "complete";
    const seated = game.seats.filter((s) => s.status !== "empty");
    const withChips = seated.filter((s) => s.stack > 0);
    dealBtn.disabled = !between || withChips.length < 2;
    dealBtn.textContent = game.handNumber ? "🂠 Deal next hand" : "🂠 Deal first hand";
    pauseBtn.textContent = game.paused ? "▶ Resume" : "⏸ Pause";
    pauseBtn.classList.toggle("primary", !!game.paused);
    endHandBtn.disabled = between;

    // --- what's happening -------------------------------------------------
    const acting = game.seats.find((s) => s.id === game.actingId);
    summary.innerHTML = "";
    summary.append(
      stat("Hand", game.handNumber ? `#${game.handNumber}` : "—"),
      stat("Street", game.paused ? "Paused" : labelStreet(game)),
      stat("Pot", `🪙 ${formatChips(game.pot)}`),
      stat("On the clock", acting ? acting.name : "—"),
    );

    // --- countdown --------------------------------------------------------
    if (game.timerSeconds && game.secondsLeft != null && acting) {
      const frac = Math.max(0, Math.min(1, game.secondsLeft / game.timerSeconds));
      clock.className = `pc-clock show ${game.secondsLeft <= 5 ? "urgent" : ""}`;
      clock.innerHTML = "";
      clock.append(
        el("div", { class: "pc-clock-bar" }, [el("i", { style: { width: `${frac * 100}%` } })]),
        el("div", { class: "pc-clock-text", text: `${acting.name} — ${game.secondsLeft}s` }),
      );
    } else {
      clock.className = "pc-clock";
      clock.innerHTML = "";
    }

    renderSeats(seated);
    renderBlinds();
    renderTimer();
    autoDealBtn.classList.toggle("active", !!game.autoDeal);
    autoDealBtn.textContent = game.autoDeal ? "Auto-deal · on" : "Auto-deal · off";
    renderSeating(seated, between);
  }

  const stat = (label, value) => el("div", { class: "pc-stat" }, [
    el("small", { text: label }), el("strong", { text: value }),
  ]);

  function labelStreet(g) {
    if (g.handVoided && g.street === "complete") return "Hand cancelled";
    return { waiting: "Waiting", preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River", complete: "Complete" }[g.street] || g.street;
  }

  function renderSeats(seated) {
    seatList.innerHTML = "";
    if (!seated.length) {
      seatList.appendChild(el("p", { class: "pc-hint", text: "Nobody has sat down yet." }));
      return;
    }
    for (const seat of seated) {
      const isActing = seat.id === game.actingId;
      seatList.appendChild(el("div", { class: `pc-seat ${isActing ? "acting" : ""} ${seat.status === "folded" ? "out" : ""}` }, [
        el("span", { class: "pc-seat-name", text: seat.name }),
        el("span", { class: "pc-seat-tag", text: seat.status.toUpperCase() }),
        el("span", { class: "pc-seat-stack", text: `🪙 ${formatChips(seat.stack)}` }),
        el("button", { class: "pc-mini minus", text: "−", title: "Take 100 chips",
          onClick: () => host("removeChips", { seatId: seat.id, amount: 100 }) }),
        el("button", { class: "pc-mini plus", text: "+", title: "Give 100 chips",
          onClick: () => host("addChips", { seatId: seat.id, amount: 100 }) }),
        el("button", { class: "pc-mini kick", text: "✕", title: "Remove from the table",
          onClick: () => { if (confirm(`Remove ${seat.name} from the table?`)) host("kick", { seatId: seat.id }); } }),
      ]));
    }
  }

  function renderBlinds() {
    blindRow.innerHTML = "";
    const between = game.street === "waiting" || game.street === "complete";
    DEFAULT_BLIND_LEVELS.forEach((rung, i) => {
      blindRow.appendChild(el("button", {
        class: `chip ${game.blindLevel === i ? "active" : ""}`,
        disabled: !between,
        text: `${formatChips(rung.smallBlind)}/${formatChips(rung.bigBlind)}`,
        onClick: () => host("blinds", { level: i }),
      }));
    });
    if (!between) blindRow.appendChild(el("span", { class: "pc-hint", text: "Changes apply between hands." }));
  }

  function renderTimer() {
    timerRow.innerHTML = "";
    for (const seconds of [0, 20, 30, 45, 60]) {
      timerRow.appendChild(el("button", {
        class: `chip ${game.timerSeconds === seconds ? "active" : ""}`,
        text: seconds ? `${seconds}s` : "Off",
        onClick: () => host("timer", { seconds }),
      }));
    }
  }

  /* ------------------------------------------------------ seating order */
  let chosen = [];
  let seatSig = "";

  function renderSeating(seated, between) {
    if (seated.length < 2) { seatingCard.style.display = "none"; return; }
    seatingCard.style.display = "";

    const ids = new Set(seated.map((s) => s.id));
    chosen = chosen.filter((id) => ids.has(id));
    const sig = [seated.map((s) => s.id + s.name).join(","), chosen.join(","), between].join("|");
    if (sig === seatSig) return;              // don't wipe a half-finished order on every poll
    seatSig = sig;

    const nameOf = (id) => (seated.find((s) => s.id === id) || {}).name || "?";
    const left = seated.filter((s) => !chosen.includes(s.id));

    seatingCard.innerHTML = "";
    seatingCard.append(
      el("h3", { text: "Seating order" }),
      el("p", { class: "pc-hint", html: "Tap people in the order they're really sitting — start with whoever is immediately to the <b>left of the TV</b>, then go <b>clockwise</b>. The ring on screen and the dealer button will follow the room." }),
      el("div", { class: "pc-chosen" }, chosen.map((id, i) =>
        el("span", {}, [el("i", { text: String(i + 1) }), document.createTextNode(nameOf(id))]))),
      el("div", { class: "pc-chiprow" }, left.map((s) =>
        el("button", { class: "chip", text: s.name, onClick: () => { chosen.push(s.id); seatSig = ""; render(); } }))),
      el("div", { class: "pc-row" }, [
        el("button", { class: "btn sm", text: "↩ Undo", onClick: () => { chosen.pop(); seatSig = ""; render(); } }),
        el("button", {
          class: "btn sm primary", text: "Apply", disabled: !between || chosen.length < 2,
          onClick: async () => {
            const r = await host("arrange", { order: chosen });
            if (r && !r.error) { chosen = []; seatSig = ""; toast("Seats now match the room"); }
          },
        }),
      ]),
      between ? null : el("p", { class: "pc-hint", text: "The table can't move mid-hand." }),
    );
  }

  /* ================================================== automatic behaviours */

  /**
   * The two things that happen without the host pressing anything. Both are
   * requests: the server decides whether they're allowed.
   */
  function runAutomation() {
    // Action clock. Ask once per player per expiry, not once per poll.
    if (game.expired && game.actingId) {
      const key = `${game.handNumber}:${game.actingId}:${game.street}`;
      if (timeoutSentFor !== key) {
        timeoutSentFor = key;
        host("timeout");
      }
    }

    // Auto-deal. Serverless has nobody to run a timer, so the console waits
    // out the delay and then asks for the next hand.
    const settled = game.street === "complete";
    const ready = game.seats.filter((s) => s.status !== "empty" && s.stack > 0).length >= 2;
    if (game.autoDeal && settled && ready && !game.paused) {
      if (!autoDealAt) autoDealAt = Date.now() + AUTO_DEAL_DELAY_MS;
      else if (Date.now() >= autoDealAt) { autoDealAt = 0; host("start"); }
    } else {
      autoDealAt = 0;
    }
  }

  /* ================================================================= poll */

  async function tick() {
    try {
      const r = await fetch(`${base}/api/poker?code=${room.code}`).then((x) => x.json());
      statusPill.textContent = "● Live";
      statusPill.className = "pc-status live";
      if (!r || !r.game) {
        game = null;
        summary.innerHTML = "";
        summary.appendChild(el("p", { class: "pc-hint", text: "This room has no poker table. Create one to start." }));
        return;
      }
      game = r.game;
      render();
      runAutomation();
    } catch {
      statusPill.textContent = "Reconnecting…";
      statusPill.className = "pc-status down";
    }
  }

  function boot() {
    if (!room) { renderSetup(); return; }
    root.innerHTML = "";
    root.append(el("div", { class: "pc-head" }, [
      el("span", { class: "pc-title", text: "🂡 Host console" }), statusPill,
    ]), layout());

    codeEl.textContent = room.code;
    joinLinkEl.textContent = joinUrl(room.code).replace(/^https?:\/\//, "");
    tvLink.href = tvUrl(room.code);
    qrBox.innerHTML = "";
    try { qrBox.appendChild(window.QR.canvas(joinUrl(room.code), 168, { margin: 2 })); }
    catch { qrBox.remove(); }

    // Make sure the room actually has a table (an old room may predate it).
    host("create").catch(() => {});
    if (poll) clearInterval(poll);
    tick();
    poll = setInterval(tick, 700);
  }

  boot();

  return {
    destroy() { if (poll) clearInterval(poll); root.innerHTML = ""; },
  };
}

/* =================================================================== styles */

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { text: `
  .pc-head { display:flex; align-items:center; gap:14px; padding:12px 20px;
    border-bottom:1px solid var(--line-soft); background:color-mix(in srgb,var(--bg-0) 75%,transparent); }
  .pc-title { font-weight:900; letter-spacing:.05em; }
  .pc-status { font-size:12.5px; font-weight:700; color:var(--text-2); margin-left:auto; }
  .pc-status.live { color:var(--good); }
  .pc-status.down { color:var(--bad); }

  .pc-grid { display:grid; gap:16px; padding:18px 20px; align-items:start;
    grid-template-columns:minmax(0,1fr); }
  @media (min-width:1000px){ .pc-grid { grid-template-columns:minmax(0,1fr) 340px; } }
  .pc-main, .pc-side { display:flex; flex-direction:column; gap:16px; min-width:0; }
  .pc-card { padding:16px; }
  .pc-card h3 { font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--text-2); margin:0 0 10px; }

  .pc-actions { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
  .btn.big { font-size:15px; padding:13px 18px; }

  .pc-summary { display:flex; gap:22px; flex-wrap:wrap; }
  .pc-stat { display:flex; flex-direction:column; gap:2px; }
  .pc-stat small { font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--text-2); font-weight:800; }
  .pc-stat strong { font-size:17px; }

  .pc-clock { max-height:0; overflow:hidden; transition:max-height var(--dur); }
  .pc-clock.show { max-height:70px; margin-top:14px; }
  .pc-clock-bar { height:8px; border-radius:999px; background:var(--bg-3); overflow:hidden; }
  .pc-clock-bar i { display:block; height:100%; background:var(--good); transition:width .4s linear; }
  .pc-clock.urgent .pc-clock-bar i { background:var(--bad); }
  .pc-clock-text { font-size:12.5px; font-weight:700; color:var(--text-1); margin-top:6px; }

  .pc-seats { display:flex; flex-direction:column; gap:8px; }
  .pc-seat { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:var(--r-sm);
    background:var(--bg-2); border:1px solid var(--line-soft); }
  .pc-seat.acting { border-color:var(--gold); box-shadow:0 0 0 1px var(--gold) inset; }
  .pc-seat.out { opacity:.5; }
  .pc-seat-name { font-weight:800; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pc-seat-tag { font-size:10px; font-weight:800; letter-spacing:.1em; color:var(--text-2); }
  .pc-seat-stack { font-weight:800; color:var(--gold); font-variant-numeric:tabular-nums; }
  .pc-mini { width:30px; height:28px; border-radius:7px; border:1px solid var(--line); cursor:pointer;
    font-weight:800; color:#fff; background:var(--bg-3); }
  .pc-mini.plus { background:color-mix(in srgb,var(--good) 30%,var(--bg-3)); }
  .pc-mini.minus { background:color-mix(in srgb,var(--bad) 28%,var(--bg-3)); }
  .pc-mini.kick { font-size:11px; }

  .pc-chiprow { display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
  .pc-row { display:flex; gap:8px; margin-top:10px; }
  .pc-hint { font-size:12px; color:var(--text-2); line-height:1.5; margin:8px 0 0; }

  .pc-code { font-size:32px; font-weight:900; letter-spacing:.16em; text-align:center; color:var(--gold); }
  .pc-link { font-size:12px; color:var(--text-2); text-align:center; word-break:break-all; margin-top:2px; }
  .pc-qr { display:flex; justify-content:center; background:#fff; border-radius:10px; padding:8px; margin-top:10px; }
  .pc-qr canvas { display:block; }

  .pc-chosen { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  .pc-chosen span { background:color-mix(in srgb,var(--accent) 60%,transparent); border-radius:8px;
    padding:5px 9px; font-size:12.5px; font-weight:800; display:inline-flex; gap:6px; }
  .pc-chosen i { opacity:.6; font-style:normal; }
  .pc-chosen:empty::before { content:"Nobody placed yet."; color:var(--text-2); font-size:12px; }
  ` }));
}
