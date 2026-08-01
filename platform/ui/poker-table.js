// The Texas Hold'em table — one renderer, used everywhere.
//
// The TV display drives this component, and the host console (a later phase)
// will reuse the same one, so the table looks identical wherever it appears and
// there is a single place to evolve the look.
//
// Rendering is driven by *state*, not by events: you hand it the public game
// snapshot the server returns and it works out what changed. That makes it
// idempotent — a dropped poll, a reloaded window or a TV that joins halfway
// through a hand all self-correct on the next `setState`, which is the same
// contract the rest of the platform relies on (see feud-board.js).
//
// This component only ever receives the *public* view of a game (see the
// redaction in buzzer/api/poker.js): hole cards arrive as nulls until a real
// showdown, so there is no path by which the TV could leak a player's hand
// even if this code wanted to.
//
// Sizing is done in container-query units throughout, so the same table is a
// small preview in a console panel and a wall-filling board on the TV with no
// second set of styles and no JavaScript measuring anything.

import { el } from "./ui.js";
import { CHIP_DENOMS, chipBreakdown, chipColumns, formatChips } from "../core/poker-chips.js";
import { getCardTheme, getTableTheme } from "../core/poker-themes.js";

// Re-exported so callers can reach the chip model through the table component
// they already import, without needing to know where the arithmetic lives.
export { CHIP_DENOMS, chipBreakdown, chipColumns, formatChips };

/* ==================================================================== cards */

const RANK_LABEL = { 10: "T", 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUIT_GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" };

const isRedSuit = (suit) => suit === "h" || suit === "d";

/**
 * One playing card. A null card renders face-down, which is what the public
 * snapshot sends for every hole card that hasn't been shown down.
 * @param {{rank:number, suit:string}|null} card
 * @param {{big?:boolean}} [opts]
 */
export function cardNode(card, { big = false } = {}) {
  // Self-sufficient: this is exported on its own (the settings panel draws
  // theme swatches with it), so it can't rely on createPokerTable having run.
  ensureStyles();
  const cls = ["pt-card", big ? "big" : "", card ? "" : "back", card && isRedSuit(card.suit) ? "red" : ""]
    .filter(Boolean).join(" ");
  if (!card) return el("div", { class: cls, "aria-hidden": "true" });
  const label = `${RANK_LABEL[card.rank] || card.rank}${SUIT_GLYPH[card.suit]}`;
  return el("div", { class: cls, role: "img", "aria-label": label }, [
    el("span", { class: "pt-card-rank", text: RANK_LABEL[card.rank] || String(card.rank) }),
    el("span", { class: "pt-card-suit", text: SUIT_GLYPH[card.suit] }),
  ]);
}

/* ==================================================================== chips */

/**
 * A pile of chips for an amount: a row of short stacks, one per denomination,
 * with the exact total printed beside it.
 *
 * The amount is carried on three independent channels, so no one of them has
 * to be perfect: the printed number (always exact), the *shape* of the pile
 * (how many stacks and how tall — see `chipColumns`), and colour. Value labels
 * on the chip faces are an optional fourth, for anyone who finds the
 * conventional casino colours hard to tell apart.
 *
 * @param {number} amount
 * @param {{label?:boolean}} [opts]
 */
export function chipStackNode(amount, { label = true } = {}) {
  ensureStyles();                 // exported standalone too — see cardNode
  const pile = el("div", { class: "pt-chips", "aria-hidden": "true" });
  for (const { denom, count } of chipColumns(amount)) {
    const column = el("div", { class: "pt-col", style: { "--n": String(count) } });
    for (let i = 0; i < count; i++) {
      column.appendChild(el("i", {
        // Only the top chip of a stack shows its face; the rest are edges.
        class: `pt-chip${i === count - 1 ? " top" : ""}`,
        style: { "--chip-face": denom.face, "--chip-edge": denom.edge, "--i": String(i) },
        dataset: { v: denom.name },
      }));
    }
    pile.appendChild(column);
  }
  return el("div", { class: "pt-chipstack" }, [
    pile,
    label ? el("span", { class: "pt-chipstack-amt", text: formatChips(amount) }) : null,
  ].filter(Boolean));
}

/* ==================================================================== seats */

/**
 * Degrees of the ring left empty at the top of the table. That's where the
 * dealer stands (see poker-dealer.js) — a real table has players around the
 * near three-quarters and the house on the far side, and reserving the arc is
 * what stops a seat being drawn underneath him.
 */
export const DEALER_GAP_DEG = 70;

/**
 * Where a seat sits on the felt, as percentages of the table box.
 *
 * Only the seats that are actually taken are laid out, spread evenly across
 * the players' arc, so a three-handed game looks like a three-handed table
 * rather than a nine-seat table with six holes in it. The arc is centred on
 * the bottom of the screen and runs clockwise — the same direction the cards
 * and the button move, which is what makes the dealing animations in a later
 * phase read correctly.
 *
 * @param {number} i  Position within the occupied seats, not the seat index.
 * @param {number} n  How many seats are occupied.
 */
export function seatPosition(i, n) {
  const count = Math.max(1, n);
  const arc = 360 - DEALER_GAP_DEG;
  // Half a step in from each end, so the gap stays centred behind the dealer
  // however many people are sitting down.
  const deg = (90 - arc / 2) + (arc / count) * (i + 0.5);
  const angle = deg * (Math.PI / 180);
  // Kept just inside the rail: a full nine-handed table has seats in the lower
  // corners, which is exactly where a TV wants to park the join code.
  return { x: 50 + 42 * Math.cos(angle), y: 50 + 37 * Math.sin(angle) };
}

/** A point on the way from a seat to the middle — where that seat's bet sits. */
function betPosition(pos, t = 0.42) {
  return { x: pos.x + (50 - pos.x) * t, y: pos.y + (50 - pos.y) * t };
}

const STREET_LABEL = {
  waiting: "Waiting", preflop: "Pre-Flop", flop: "Flop",
  turn: "Turn", river: "River", complete: "Showdown",
};

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Whether it's worth animating at all.
 *
 * A hidden document doesn't advance the animation timeline, so a flight
 * started while the tab is in the background never finishes and never fires
 * its completion callback. Anything that reveals cards *on* completion would
 * then leave them hidden indefinitely — a TV that got switched away from and
 * back would show a table where nobody has any cards. So when the page can't
 * be seen we skip straight to the finished state.
 */
const canAnimate = () =>
  !reducedMotion() && !(typeof document !== "undefined" && document.hidden);

/**
 * The order cards go out in: starting at the small blind and running clockwise,
 * the way a dealer actually pitches them. Heads-up is the exception poker
 * always makes — there the button *is* the small blind.
 * @param {Object} game  A public snapshot.
 * @returns {string[]} Seat ids, in dealing order.
 */
export function dealOrder(game) {
  const live = (game.seats || []).filter((s) => s.status === "active" || s.status === "allin");
  if (!live.length) return [];
  const dealerPos = live.findIndex((s) => s.index === game.dealerIndex);
  const start = live.length === 2
    ? Math.max(0, dealerPos)
    : (Math.max(0, dealerPos) + 1) % live.length;
  return live.map((_, k) => live[(start + k) % live.length].id);
}

/**
 * A player's forearm and hand, seen from above, drawn pointing "up" so a
 * single rotation can aim it in from whichever side its owner is sitting.
 */
function handSvg() {
  return `<svg class="pt-hand-svg" viewBox="0 0 64 130" aria-hidden="true">
    <path class="pt-sleeve-arm" d="M18 130 L18 74 Q18 62 32 62 Q46 62 46 74 L46 130 Z"/>
    <path class="pt-skin-arm"   d="M20 92 L20 60 Q20 44 32 44 Q44 44 44 60 L44 92 Z"/>
    <ellipse class="pt-skin-arm" cx="32" cy="48" rx="14" ry="13"/>
    <ellipse class="pt-skin-arm" cx="19" cy="56" rx="5.5" ry="8"/>
    <path class="pt-knuckles" d="M23 40 Q32 36 41 40" />
  </svg>`;
}

/* ================================================================ component */

/**
 * @typedef {Object} PokerTableHandle
 * @property {HTMLElement} el
 * @property {(game:Object|null)=>void} setState
 * @property {(seatId:string)=>HTMLElement|null} seatAnchor  Where a seat's cards
 *           land — the attach point for the dealing animations in a later phase.
 * @property {()=>HTMLElement} centerAnchor  Where the pot lives, for chip animations.
 * @property {()=>void} destroy
 */

/**
 * Build a poker table.
 * @param {Object} [opts]
 * @param {boolean} [opts.showBlinds]  Print the stakes under the pot.
 * @returns {PokerTableHandle}
 */
export function createPokerTable(opts = {}) {
  const { showBlinds = true, chipLabels = false, cardTheme, tableTheme } = opts;
  ensureStyles();

  const street = el("div", { class: "pt-street" });
  const community = el("div", { class: "pt-community" });
  const potAmount = el("div", { class: "pt-pot-amt" });
  const potChips = el("div", { class: "pt-pot-chips" });
  const sidePots = el("div", { class: "pt-sidepots" });
  const blinds = el("div", { class: "pt-blinds" });

  // The banner lives in the middle of the felt, not pinned to an edge: seats
  // ring the whole oval, so the centre is the only space guaranteed to be free
  // of a player's plate at any seat count.
  const banner = el("div", { class: "pt-banner" });

  const center = el("div", { class: "pt-center" }, [
    street,
    community,
    el("div", { class: "pt-pot" }, [potChips, potAmount]),
    sidePots,
    banner,
    showBlinds ? blinds : null,
  ].filter(Boolean));

  const seatLayer = el("div", { class: "pt-seats" });
  const betLayer = el("div", { class: "pt-bets" });
  // Cards in the air live above everything else on the felt.
  const flight = el("div", { class: "pt-flight" });

  const felt = el("div", { class: "pt-felt" }, [
    el("div", { class: "pt-rail" }),
    center, betLayer, seatLayer, flight,
  ]);
  const frame = el("div", { class: `pt ${chipLabels ? "pt--labels" : ""}` }, [felt]);

  /** Where cards are thrown from — the dealer's hands, set by the TV. */
  let dealerAnchor = null;
  /** Guarantees a deal finishes even if its animations never do. */
  let dealSafety = null;
  /** Seat id → the nodes making up that seat, so updates never rebuild the DOM. */
  let seatNodes = new Map();
  /** The seat roster the current DOM was built for, so we know when to rebuild. */
  let seatKey = "";
  /** Community cards already on the felt, so only new ones animate in. */
  let dealtCount = 0;
  let lastHandNumber = -1;
  /* Chip movement is driven by what *changed*, so the last frame's numbers
     have to be kept: who had how much in front of them, which street we were
     on, and whether this hand's payout has already been paid out on screen. */
  let prevBets = new Map();
  let prevStreet = null;
  let paidOutFor = -1;
  /** Seat index → its position on the felt, for working out which way is "outside". */
  let seatPos = new Map();

  // Only apply a theme that was actually asked for — otherwise the CSS
  // defaults stand, which keeps an unthemed table free of inline styles.
  if (cardTheme) applyTheme(getCardTheme(cardTheme));
  if (tableTheme) applyTheme(getTableTheme(tableTheme));

  /* ------------------------------------------------------------ building */

  function buildSeats(seats) {
    seatLayer.innerHTML = "";
    betLayer.innerHTML = "";
    seatNodes = new Map();
    seatPos = new Map();

    seats.forEach((seat, i) => {
      const pos = seatPosition(i, seats.length);
      seatPos.set(seat.id, pos);
      const cards = el("div", { class: "pt-seat-cards" });
      const name = el("span", { class: "pt-seat-name" });
      const stack = el("span", { class: "pt-seat-stack" });
      const badges = el("div", { class: "pt-seat-badges" });
      const note = el("div", { class: "pt-seat-note" });

      const node = el("div", {
        class: "pt-seat",
        dataset: { seat: seat.id },
        style: { left: `${pos.x}%`, top: `${pos.y}%` },
      }, [
        cards,
        el("div", { class: "pt-seat-plate" }, [name, stack]),
        badges,
        note,
      ]);

      const betPos = betPosition(pos);
      const bet = el("div", {
        class: "pt-bet",
        style: { left: `${betPos.x}%`, top: `${betPos.y}%` },
      });

      seatLayer.appendChild(node);
      betLayer.appendChild(bet);
      seatNodes.set(seat.id, { node, cards, name, stack, badges, note, bet });
    });
  }

  /* ------------------------------------------------------------ updating */

  function setState(game) {
    if (!game) {
      frame.classList.add("empty");
      banner.className = "pt-banner";
      return;
    }
    frame.classList.remove("empty");

    const seats = (game.seats || []).filter((s) => s.status !== "empty");
    const key = seats.map((s) => s.id).join("|");
    if (key !== seatKey) { seatKey = key; buildSeats(seats); }

    const newHand = game.handNumber !== lastHandNumber;
    // A new hand wipes the felt, so the next street's cards animate in fresh.
    if (newHand) {
      lastHandNumber = game.handNumber;
      dealtCount = 0;
      community.innerHTML = "";
      prevBets = new Map();
      prevStreet = null;
    }

    /* Work out what the chips did before the render overwrites the evidence:
       who pushed more out in front of them, and whether the street just closed
       and swept the lot into the middle. */
    const raised = [];
    let swept = [];
    if (!newHand) {
      for (const seat of seats) {
        const before = prevBets.get(seat.id) || 0;
        if ((seat.bet || 0) > before) {
          const added = seat.bet - before;
          raised.push({
            seatId: seat.id,
            amount: seat.bet,
            // A shove, or most of what somebody had, deserves a harder push.
            dramatic: seat.status === "allin" || added >= (seat.stack + added) * 0.5,
          });
        }
      }
      const streetMoved = prevStreet && prevStreet !== game.street;
      if (streetMoved) {
        swept = [...prevBets.entries()]
          .filter(([, amount]) => amount > 0)
          .map(([seatId, amount]) => ({ seatId, amount }));
      }
    }

    renderCommunity(game);
    renderPot(game);
    renderSeats(game, seats);
    renderBanner(game);

    // Now the DOM is in its new shape, the chips can move across it.
    if (swept.length) gatherBets(swept);
    for (const r of raised) animateBet(r.seatId, r.amount, r.dramatic);
    if (game.street === "complete" && (game.results || []).length && paidOutFor !== game.handNumber) {
      paidOutFor = game.handNumber;
      payOut(game);
    }

    prevBets = new Map(seats.map((s) => [s.id, s.bet || 0]));
    prevStreet = game.street;

    // The room needs to know why nothing is happening: a paused table and a
    // cancelled hand both look like a table that has simply stopped.
    const halted = game.paused || (game.handVoided && game.street === "complete");
    street.textContent = game.paused ? "Paused"
      : (game.handVoided && game.street === "complete") ? "Hand cancelled"
      : (STREET_LABEL[game.street] || game.street || "");
    street.classList.toggle("live", !halted && game.street !== "waiting" && game.street !== "complete");
    street.classList.toggle("halted", !!halted);
    if (showBlinds) {
      blinds.textContent = game.handNumber
        ? `Hand #${game.handNumber} · Blinds ${formatChips(game.smallBlind)}/${formatChips(game.bigBlind)}`
        : `Blinds ${formatChips(game.smallBlind)}/${formatChips(game.bigBlind)}`;
    }
  }

  /** Five slots always exist; the dealt ones fill in, and only new ones animate. */
  function renderCommunity(game) {
    const cards = game.community || [];
    while (community.children.length < 5) {
      community.appendChild(el("div", { class: "pt-slot" }));
    }
    for (let i = 0; i < 5; i++) {
      const slot = community.children[i];
      const card = cards[i];
      if (!card) { slot.innerHTML = ""; slot.classList.remove("filled"); continue; }
      if (slot.classList.contains("filled")) continue;      // already on the felt
      slot.classList.add("filled");

      const node = cardNode(card, { big: true });
      // Stagger the flop so three cards land one after another, not as a block.
      const step = Math.max(0, i - dealtCount);
      slot.innerHTML = "";
      slot.appendChild(node);

      if (dealerAnchor && canAnimate()) {
        // Board cards come off the same deck as everyone else's: throw a back
        // to the slot and turn the real card face-up as it arrives.
        node.style.visibility = "hidden";
        const show = () => { node.style.visibility = ""; node.classList.add("dealt"); };
        flyCard({ toEl: slot, delay: step * 150, spin: 380, big: true }).then(show);
        // …and the same safety net: a board card must never stay invisible
        // just because the tab was backgrounded mid-flight.
        setTimeout(show, step * 150 + 900);
      } else {
        node.style.animationDelay = `${step * 130}ms`;
        node.classList.add("dealt");
      }
    }
    dealtCount = cards.length;
  }

  function renderPot(game) {
    // Everything committed this hand, including the bets still sitting in front
    // of players. Broadcast poker counts the pot this way, and it's what the
    // phones and the host page already show — a headline that excluded the live
    // bets would read as "Pot: 0" with 75 visibly on the felt.
    const pot = (game.seats || []).reduce((t, s) => t + (s.totalBet || 0), 0);

    potAmount.textContent = formatChips(pot);
    potChips.innerHTML = "";
    if (pot > 0) potChips.appendChild(chipStackNode(pot, { label: false }));
    center.classList.toggle("has-pot", pot > 0);

    // Any difference in what players have put in technically splits the pot
    // into layers — the big blind alone does it before anyone has acted, and a
    // shove nobody has called yet adds a layer only the shover can win. Neither
    // is a pot in the sense a viewer means, so the breakdown only appears once
    // there are genuinely two or more layers being *contested*; otherwise the
    // single headline number is the whole truth.
    sidePots.innerHTML = "";
    const contested = (game.pots || []).filter((p) => (p.eligible || []).length > 1);
    const someoneAllIn = (game.seats || []).some((s) => s.status === "allin");
    if (contested.length > 1 && someoneAllIn) {
      contested.forEach((pot, i) => {
        sidePots.appendChild(el("div", { class: "pt-sidepot" }, [
          el("span", { class: "pt-sidepot-name", text: i === 0 ? "Main" : `Side ${i}` }),
          el("span", { class: "pt-sidepot-amt", text: formatChips(pot.amount) }),
        ]));
      });
    }
  }

  function renderSeats(game, seats) {
    // Who won what, so the winning seats can be crowned at showdown.
    const wins = new Map();
    for (const result of game.results || []) {
      for (const w of result.winners || []) {
        const prev = wins.get(w.seatId) || { share: 0, handName: w.handName };
        wins.set(w.seatId, { share: prev.share + w.share, handName: w.handName || prev.handName });
      }
    }

    const dealerId = seatIdAt(game, game.dealerIndex);
    const complete = game.street === "complete";

    for (const seat of seats) {
      const n = seatNodes.get(seat.id);
      if (!n) continue;
      const win = wins.get(seat.id);

      n.name.textContent = seat.name || "—";
      n.stack.textContent = formatChips(seat.stack);

      n.node.classList.toggle("acting", !complete && game.actingId === seat.id);
      n.node.classList.toggle("folded", seat.status === "folded");
      n.node.classList.toggle("allin", seat.status === "allin");
      n.node.classList.toggle("sitout", seat.status === "sitout");
      n.node.classList.toggle("winner", !!win);
      n.node.classList.toggle("busted", seat.stack === 0 && seat.status !== "allin");

      // Badges: the button, and the blinds while they still mean something.
      n.badges.innerHTML = "";
      if (seat.id === dealerId) n.badges.appendChild(el("i", { class: "pt-btn-d", text: "D" }));
      if (seat.status === "allin") n.badges.appendChild(el("i", { class: "pt-tag allin", text: "ALL IN" }));
      if (seat.status === "sitout") n.badges.appendChild(el("i", { class: "pt-tag out", text: "SITTING OUT" }));

      // Cards: backs while the hand runs, the real thing once it's shown down.
      renderSeatCards(n.cards, seat, complete);

      // The line under the plate: what they won, or why they're not playing.
      if (win) {
        n.note.className = "pt-seat-note win";
        n.note.textContent = win.handName ? `${win.handName} · +${formatChips(win.share)}` : `+${formatChips(win.share)}`;
      } else if (seat.status === "folded") {
        n.note.className = "pt-seat-note";
        n.note.textContent = "Folded";
      } else {
        n.note.className = "pt-seat-note";
        n.note.textContent = "";
      }

      // Their live bet, sitting between them and the pot.
      n.bet.innerHTML = "";
      n.bet.classList.toggle("show", seat.bet > 0);
      if (seat.bet > 0) n.bet.appendChild(chipStackNode(seat.bet));
    }
  }

  function renderSeatCards(host, seat, complete) {
    const inHand = seat.status === "active" || seat.status === "allin";
    const hole = seat.holeCards || [];
    const shown = hole.filter(Boolean);

    // Nothing to draw between hands, or once someone has mucked.
    if (!hole.length || seat.status === "folded" || (!inHand && !shown.length)) {
      if (host.childElementCount) host.innerHTML = "";
      host.classList.remove("shown");
      return;
    }

    const signature = shown.length
      ? shown.map((c) => `${c.rank}${c.suit}`).join(",")
      : `back:${hole.length}`;
    if (host.dataset.sig === signature) return;            // nothing changed
    host.dataset.sig = signature;

    host.innerHTML = "";
    host.classList.toggle("shown", shown.length > 0);
    hole.forEach((card, i) => {
      const node = cardNode(card);
      if (complete && card) { node.classList.add("dealt"); node.style.animationDelay = `${i * 90}ms`; }
      host.appendChild(node);
    });
  }

  function renderBanner(game) {
    const results = game.results || [];
    if (game.street !== "complete" || !results.length) {
      banner.className = "pt-banner";
      banner.innerHTML = "";
      return;
    }
    const winners = results.flatMap((r) => r.winners || []);
    const split = winners.length > 1;
    const names = winners
      .map((w) => (game.seats.find((s) => s.id === w.seatId) || {}).name || "—");
    const uniqueNames = [...new Set(names)];
    const hand = winners[0] && winners[0].handName;
    const total = winners.reduce((t, w) => t + w.share, 0);

    banner.className = "pt-banner show";
    banner.innerHTML = "";
    banner.appendChild(el("div", { class: "pt-banner-card" }, [
      el("div", { class: "pt-banner-who", text: split ? `${uniqueNames.join(" & ")} split it` : `${uniqueNames[0]} wins` }),
      hand && hand !== "Uncontested" ? el("div", { class: "pt-banner-hand", text: hand }) : null,
      el("div", { class: "pt-banner-amt", text: `🪙 ${formatChips(total)}` }),
    ].filter(Boolean)));
  }

  const seatIdAt = (game, index) => {
    const seat = (game.seats || []).find((s) => s.index === index);
    return seat ? seat.id : null;
  };

  /* ------------------------------------------------------- cards in flight */

  /**
   * Throw one card back from the dealer's hands to a target, and resolve when
   * it lands. Positions are measured at throw time rather than precomputed:
   * the table is fluid, and a card has to arrive where the seat *is*, not
   * where it was when the hand started.
   */
  function flyCard({ toEl, delay = 0, duration = 430, spin = 520, big = false }) {
    return new Promise((resolve) => {
      if (!dealerAnchor || !toEl || !canAnimate()) { resolve(); return; }
      const feltBox = felt.getBoundingClientRect();
      const from = dealerAnchor.getBoundingClientRect();
      const to = toEl.getBoundingClientRect();
      if (!feltBox.width || !to.width) { resolve(); return; }

      // Leave from his hands, which sit low in his artwork — not his head.
      const sx = from.left + from.width / 2 - feltBox.left;
      const sy = from.top + from.height * 0.78 - feltBox.top;
      const tx = to.left + to.width / 2 - feltBox.left;
      const ty = to.top + to.height / 2 - feltBox.top;

      const card = el("div", { class: `pt-fly ${big ? "big" : ""}` });
      flight.appendChild(card);

      const at = (x, y, r, s) => `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${r}deg) scale(${s})`;
      const anim = card.animate([
        // Shadow doubles as altitude: tight on the felt, soft and far while airborne.
        { offset: 0,    transform: at(sx, sy, 0, 0.5),            filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))",   opacity: 0 },
        { offset: 0.12, opacity: 1 },
        { offset: 0.55, filter: "drop-shadow(0 18px 20px rgba(0,0,0,.5))" },
        { offset: 0.86, transform: at(tx, ty, spin, 1.07),        filter: "drop-shadow(0 10px 12px rgba(0,0,0,.5))" },
        { offset: 1,    transform: at(tx, ty, spin + 3, 1),       filter: "drop-shadow(0 3px 5px rgba(0,0,0,.5))",   opacity: 1 },
      ], { duration, delay, easing: "cubic-bezier(.25,.85,.35,1)", fill: "both" });

      const done = () => { card.remove(); resolve(); };
      anim.finished.then(done, done);
    });
  }

  /**
   * Pitch two cards to every seat, one at a time round the table — the same
   * order and rhythm a live dealer uses. Each seat's own cards stay hidden
   * until its second card lands, so the early seats are looking at cards
   * while the far side is still waiting, exactly as at a real table.
   *
   * @param {string[]} seatIds  Dealing order (see `dealOrder`).
   * @param {{startDelay?:number, perCard?:number}} [opts]
   * @returns {Promise<void>}
   */
  function dealHoleCards(seatIds, { startDelay = 0, perCard = 125 } = {}) {
    const targets = (seatIds || []).map((id) => seatNodes.get(id)).filter(Boolean);
    if (!targets.length) return Promise.resolve();

    targets.forEach((n) => n.cards.classList.add("pending"));
    const reveal = (n) => n.cards.classList.remove("pending");
    if (!dealerAnchor || !canAnimate()) { targets.forEach(reveal); return Promise.resolve(); }

    const flights = [];
    let i = 0;
    for (let round = 0; round < 2; round++) {
      for (const n of targets) {
        const delay = startDelay + i * perCard;
        i++;
        const last = round === 1;
        flights.push(
          flyCard({ toEl: n.cards, delay, spin: 460 + Math.round(Math.random() * 220) })
            .then(() => { if (last) reveal(n); })
        );
      }
    }

    // Safety net. The staggered reveal above is driven by animations finishing,
    // and an animation on a backgrounded tab may not finish for a very long
    // time. Hiding a player's cards is not a failure mode worth risking for an
    // animation, so a plain timer force-settles everything either way.
    const settleAt = startDelay + i * perCard + 900;
    clearTimeout(dealSafety);
    dealSafety = setTimeout(() => {
      targets.forEach(reveal);
      flight.innerHTML = "";
    }, settleAt);

    const done = () => targets.forEach(reveal);
    return Promise.all(flights).then(done, done);
  }

  /* ----------------------------------------------------------- chip motion */

  /** Centre of an element, in felt coordinates. */
  function feltPoint(node) {
    const box = felt.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
  }

  /**
   * Slide a node from one felt point to another and resolve when it settles.
   * Chips don't spin like cards do — they slide, and land with a short bounce.
   */
  function slide(node, from, to, { delay = 0, duration = 460, bounce = 1.12 } = {}) {
    return new Promise((resolve) => {
      const at = (p, s) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${s})`;
      const anim = node.animate([
        { offset: 0,    transform: at(from, 0.72), opacity: 0 },
        { offset: 0.14, opacity: 1 },
        { offset: 0.78, transform: at(to, bounce) },
        { offset: 1,    transform: at(to, 1), opacity: 1 },
      ], { duration, delay, easing: "cubic-bezier(.22,.85,.3,1)", fill: "both" });
      const done = () => resolve();
      anim.finished.then(done, done);
    });
  }

  /**
   * A player's hand reaching in from off the table to place chips.
   *
   * The arm comes in from *their* side — the direction is worked out from
   * where they're sitting, so the chips look like they belong to the person
   * who bet them rather than arriving from nowhere.
   */
  function reachIn(seatId, betNode, amount, { dramatic = false } = {}) {
    const pos = seatPos.get(seatId);
    if (!pos) return Promise.resolve();
    const box = felt.getBoundingClientRect();
    const target = feltPoint(betNode);

    // Start well outside the rail, on the line from the middle through the seat.
    const dx = pos.x - 50, dy = pos.y - 50;
    const len = Math.hypot(dx, dy) || 1;
    const start = {
      x: target.x + (dx / len) * box.width * 0.42,
      y: target.y + (dy / len) * box.height * 0.62,
    };
    // Point the forearm back the way it came, so it reads as reaching inward.
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI - 90;

    const hand = el("div", { class: `pt-reach ${dramatic ? "big" : ""}` });
    hand.innerHTML = handSvg();
    hand.style.setProperty("--reach-rot", `${angle}deg`);
    const carried = chipStackNode(amount, { label: false });
    carried.className += " pt-reach-chips";
    hand.appendChild(carried);
    flight.appendChild(hand);

    // Stop the arm short of the spot so its *fingertips* arrive on the marker
    // rather than the whole hand parking on top of it.
    const rest = {
      x: target.x + (dx / len) * box.width * 0.055,
      y: target.y + (dy / len) * box.height * 0.075,
    };

    const at = (p) => `translate(${p.x}px, ${p.y}px) translate(-50%, -60%) rotate(var(--reach-rot))`;
    const inMs = dramatic ? 260 : 380;
    const push = hand.animate([
      { transform: at(start), opacity: 0 },
      { offset: 0.25, opacity: 1 },
      { offset: 0.8, transform: at(rest) },
      { transform: at(rest) },
    ], { duration: inMs, easing: dramatic ? "cubic-bezier(.3,1.5,.5,1)" : "cubic-bezier(.2,.8,.3,1)", fill: "both" });

    return new Promise((resolve) => {
      const retract = () => {
        // The real bet marker takes over; the hand leaves without its chips.
        carried.style.opacity = "0";
        resolve();
        const back = hand.animate([
          { transform: at(rest), opacity: 1 },
          { transform: at(start), opacity: 0 },
        ], { duration: 300, delay: 90, easing: "cubic-bezier(.4,0,.8,.4)", fill: "both" });
        const gone = () => hand.remove();
        back.finished.then(gone, gone);
      };
      push.finished.then(retract, retract);
    });
  }

  /** Chips going out in front of a player who just bet. */
  function animateBet(seatId, amount, dramatic) {
    const n = seatNodes.get(seatId);
    if (!n) return;
    if (!canAnimate()) { n.bet.classList.remove("pending"); return; }
    n.bet.classList.add("pending");
    const settle = setTimeout(() => n.bet.classList.remove("pending"), 1400);
    reachIn(seatId, n.bet, amount, { dramatic }).then(() => {
      clearTimeout(settle);
      n.bet.classList.remove("pending");
      n.bet.classList.add("landed");
      setTimeout(() => n.bet.classList.remove("landed"), 420);
    });
  }

  /**
   * The street closed: everything in front of the players is swept into the
   * middle. The bet markers have already been emptied by the render, so this
   * flies stand-in stacks from where they were to the pot.
   */
  function gatherBets(bets) {
    if (!canAnimate() || !bets.length) return;
    const to = feltPoint(potChips.childElementCount ? potChips : potAmount);
    bets.forEach(({ seatId, amount }, i) => {
      const n = seatNodes.get(seatId);
      if (!n) return;
      const from = feltPoint(n.bet);
      const stack = chipStackNode(amount, { label: false });
      stack.className += " pt-floater";
      flight.appendChild(stack);
      slide(stack, from, to, { delay: i * 55, duration: 420, bounce: 1.06 })
        .then(() => {
          stack.remove();
          potChips.classList.add("bump");
          setTimeout(() => potChips.classList.remove("bump"), 320);
        });
    });
  }

  /** The pot going home: chips slide from the middle back to each winner. */
  function payOut(game) {
    if (!canAnimate()) return;
    const from = feltPoint(potChips.childElementCount ? potChips : potAmount);
    const shares = (game.results || []).flatMap((r) => r.winners || []);
    shares.forEach((w, i) => {
      const n = seatNodes.get(w.seatId);
      if (!n) return;
      const stack = chipStackNode(w.share, { label: false });
      stack.className += " pt-floater";
      flight.appendChild(stack);
      slide(stack, from, feltPoint(n.node), { delay: 260 + i * 120, duration: 620, bounce: 1.1 })
        .then(() => stack.remove());
    });
  }

  /** Paint a theme's custom properties onto the table root. */
  function applyTheme(theme) {
    if (!theme) return;
    for (const [name, value] of Object.entries(theme.vars)) {
      frame.style.setProperty(name, value);
    }
  }

  function destroy() { frame.remove(); }

  return {
    el: frame,
    setState,
    destroy,
    dealHoleCards,
    /** Where cards are thrown from — pass the dealer's artwork. */
    setDealerAnchor: (node) => { dealerAnchor = node || null; },
    /** Print denomination values on chip faces. Pure CSS, so no re-render. */
    setChipLabels: (on) => frame.classList.toggle("pt--labels", !!on),
    /**
     * Apply a theme by key. Every themed colour is a custom property on the
     * root, so this is just a handful of setProperty calls — nothing re-renders
     * and a theme can be switched mid-hand without disturbing the game.
     */
    setCardTheme: (key) => applyTheme(getCardTheme(key)),
    setTableTheme: (key) => applyTheme(getTableTheme(key)),
    /** The resolved table theme, for a caller that also styles the page around us. */
    tableThemeVars: (key) => ({ ...getTableTheme(key).vars }),
    seatAnchor: (seatId) => {
      const n = seatNodes.get(seatId);
      return n ? n.cards : null;
    },
    betAnchor: (seatId) => {
      const n = seatNodes.get(seatId);
      return n ? n.bet : null;
    },
    centerAnchor: () => potChips,
  };
}

/* =================================================================== styles */

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  const css = `
  /* Every colour below comes from a custom property, which is the whole of the
     theming mechanism — see platform/core/poker-themes.js. These are the
     Casino Green / Classic Bicycle defaults, used when no theme is applied. */
  .pt{ container-type:inline-size; width:100%; position:relative;
    --felt:#0b6b3f; --felt-2:#053f24; --rail:#3a2116; --rail-2:#1c0f0a;
    --gold:#ffcf5c; --ink:#f4f6fb; --chip-glow:rgba(0,0,0,0);
    --card-face:linear-gradient(170deg,#ffffff,#e9edf5);
    --card-ink:#14161c; --card-red:#e0313f; --card-edge:rgba(0,0,0,.14);
    --card-back:repeating-linear-gradient(45deg,#1c4fd6 0 .5cqw,#163fae .5cqw 1cqw);
    --card-ring:rgba(255,255,255,.5); --card-radius:.45cqw; }

  /* ---- the table ------------------------------------------------------ */
  .pt-felt{
    position:relative; width:100%; aspect-ratio:16/9;
    border-radius:50%/38%;
    background:
      radial-gradient(60% 70% at 50% 40%, color-mix(in srgb, var(--felt) 92%, #fff 8%), transparent 70%),
      radial-gradient(120% 120% at 50% 50%, var(--felt), var(--felt-2));
    box-shadow:
      0 0 0 1.5cqw var(--rail),
      0 0 0 1.9cqw var(--rail-2),
      0 4cqw 8cqw -3cqw rgba(0,0,0,.85),
      inset 0 0 6cqw rgba(0,0,0,.5);
  }
  /* A soft highlight on the rail so the felt reads as a real, lit table. */
  .pt-rail{
    position:absolute; inset:0; border-radius:inherit; pointer-events:none;
    box-shadow: inset 0 .35cqw .6cqw rgba(255,255,255,.10), inset 0 -.6cqw 1.2cqw rgba(0,0,0,.35);
  }
  .pt.empty .pt-felt{ filter:saturate(.5) brightness(.75); }

  /* ---- the middle ----------------------------------------------------- */
  .pt-center{
    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    display:flex; flex-direction:column; align-items:center; gap:.9cqw;
    width:56%; text-align:center;
  }
  .pt-street{
    font-size:1.15cqw; font-weight:800; letter-spacing:.22em; text-transform:uppercase;
    color:rgba(255,255,255,.5);
  }
  .pt-street.live{ color:var(--gold); }
  .pt-street.halted{ color:#ff9683; letter-spacing:.26em; }

  .pt-community{ display:flex; gap:.7cqw; justify-content:center; }
  .pt-slot{
    width:4.4cqw; height:6.2cqw; border-radius:.6cqw;
    border:.12cqw dashed rgba(255,255,255,.16);
    background:rgba(0,0,0,.14);
  }
  .pt-slot.filled{ border-color:transparent; background:none; }

  .pt-pot{ display:flex; align-items:center; gap:.7cqw; min-height:2.2cqw; }
  .pt-pot-amt{
    font-size:2.1cqw; font-weight:900; color:var(--gold); font-variant-numeric:tabular-nums;
    text-shadow:0 .2cqw .5cqw rgba(0,0,0,.6); letter-spacing:-.01em;
  }
  .pt-center:not(.has-pot) .pt-pot-amt{ color:rgba(255,255,255,.28); }
  .pt-pot-amt::before{ content:"🪙 "; font-size:.8em; }

  .pt-sidepots{ display:flex; gap:.6cqw; flex-wrap:wrap; justify-content:center; }
  .pt-sidepot{
    display:flex; gap:.4cqw; align-items:baseline; padding:.25cqw .8cqw; border-radius:999px;
    background:rgba(0,0,0,.32); border:.08cqw solid rgba(255,255,255,.14); font-size:.95cqw;
  }
  .pt-sidepot-name{ color:rgba(255,255,255,.55); font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  .pt-sidepot-amt{ color:var(--gold); font-weight:800; font-variant-numeric:tabular-nums; }

  .pt-blinds{ font-size:.95cqw; color:rgba(255,255,255,.4); font-weight:600; }

  /* ---- cards ---------------------------------------------------------- */
  .pt-card{
    width:3.2cqw; height:4.5cqw; border-radius:var(--card-radius); flex:none;
    background:var(--card-face);
    color:var(--card-ink); display:flex; flex-direction:column; align-items:center; justify-content:center;
    font-weight:900; line-height:1; gap:.1cqw;
    box-shadow:0 .35cqw .7cqw rgba(0,0,0,.5), inset 0 0 0 .08cqw var(--card-edge);
  }
  .pt-card.big{ width:4.4cqw; height:6.2cqw; border-radius:calc(var(--card-radius) * 1.35); }
  .pt-card.red{ color:var(--card-red); }
  .pt-card-rank{ font-size:1.55cqw; }
  .pt-card-suit{ font-size:1.35cqw; }
  .pt-card.big .pt-card-rank{ font-size:2.2cqw; }
  .pt-card.big .pt-card-suit{ font-size:1.9cqw; }
  .pt-card.back{
    background:var(--card-back);
    box-shadow:0 .35cqw .7cqw rgba(0,0,0,.5), inset 0 0 0 .16cqw var(--card-ring);
  }
  @keyframes pt-deal{
    from{ opacity:0; transform:translateY(-1.6cqw) rotate(-8deg) scale(.86); }
    to{ opacity:1; transform:none; }
  }
  .pt-card.dealt{ animation:pt-deal .34s cubic-bezier(.22,.61,.36,1) both; }

  /* ---- chips ---------------------------------------------------------- */
  /* Chips are stacked vertically the way they sit on a felt: each disc a step
     above the one below, so only the topmost shows its face and the rest read
     as edges. --chip-d is the diameter, --chip-step how much of each lower
     chip's edge stays visible. */
  .pt-chipstack{
    --chip-d:1.5cqw; --chip-step:.42cqw;
    display:flex; align-items:flex-end; gap:.45cqw;
  }
  .pt-chips{ display:flex; align-items:flex-end; gap:.32cqw; }
  .pt-col{
    position:relative; flex:none;
    width:var(--chip-d);
    height:calc(var(--chip-d) + (var(--n) - 1) * var(--chip-step));
  }
  .pt-chip{
    position:absolute; left:0; bottom:calc(var(--i) * var(--chip-step));
    width:var(--chip-d); height:var(--chip-d); border-radius:50%; font-style:normal;
    background:var(--chip-face);
    border:.17cqw dashed color-mix(in srgb, var(--chip-edge) 45%, #fff 55%);
    /* --chip-glow is the table theme's ambience landing on the chips. A theme
       never changes a chip's *face* colour: that encodes its denomination, and
       is one of the channels the accessibility work depends on. */
    box-shadow:0 .12cqw .26cqw rgba(0,0,0,.55), inset 0 0 0 .1cqw var(--chip-edge),
      0 0 .8cqw var(--chip-glow);
    display:grid; place-items:center;
    font-size:0; color:transparent;      /* label hidden unless labels are on */
  }
  .pt-chipstack-amt{
    font-size:1cqw; font-weight:800; color:#fff; font-variant-numeric:tabular-nums;
    text-shadow:0 .15cqw .3cqw rgba(0,0,0,.7); align-self:center;
  }
  /* The pot is the biggest pile on the table, so its chips are too. */
  .pt-pot-chips .pt-chipstack{ --chip-d:1.9cqw; --chip-step:.52cqw; }

  /* ---- chip value labels (accessibility) ------------------------------- */
  /* Colour is never the only channel, but for anyone who finds the casino
     palette hard to separate the top chip of each stack can name itself.
     Chips grow a little so the text is actually legible from a sofa. */
  .pt--labels .pt-chipstack{ --chip-d:2cqw; --chip-step:.58cqw; }
  .pt--labels .pt-pot-chips .pt-chipstack{ --chip-d:2.4cqw; --chip-step:.66cqw; }
  .pt--labels .pt-chip.top::after{
    content:attr(data-v);
    font-size:.72cqw; font-weight:900; letter-spacing:-.03em;
    color:#fff; -webkit-text-stroke:.09cqw rgba(0,0,0,.75); paint-order:stroke fill;
  }
  .pt--labels .pt-pot-chips .pt-chip.top::after{ font-size:.9cqw; }

  /* ---- cards in flight ------------------------------------------------- */
  .pt-flight{ position:absolute; inset:0; pointer-events:none; z-index:4; }
  /* A card in the air is the same back as one on the felt, so it themes with it. */
  .pt-fly{
    position:absolute; left:0; top:0; width:3.2cqw; height:4.5cqw;
    border-radius:var(--card-radius); will-change:transform, filter;
    background:var(--card-back);
    box-shadow:inset 0 0 0 .16cqw var(--card-ring);
  }
  .pt-fly.big{ width:4.4cqw; height:6.2cqw; border-radius:calc(var(--card-radius) * 1.35); }
  /* A seat whose cards are still in the air shows nothing yet. */
  .pt-seat-cards.pending{ opacity:0; }

  /* ---- chips in motion -------------------------------------------------- */
  /* Loose stacks being swept to the pot or paid out to a winner. */
  .pt-floater{ position:absolute; left:0; top:0; will-change:transform; }

  /* A player's arm reaching in to place a bet. */
  .pt-reach{
    position:absolute; left:0; top:0; width:8.4cqw; will-change:transform;
    --skin:#e8b98d; --skin-dark:#c9945f; --cuff:#2f3646;
  }
  .pt-reach.big{ width:10cqw; }
  .pt-hand-svg{ width:100%; height:auto; display:block;
    filter:drop-shadow(0 1cqw 1.2cqw rgba(0,0,0,.55)); }
  .pt-skin-arm{ fill:var(--skin); }
  .pt-sleeve-arm{ fill:var(--cuff); }
  .pt-knuckles{ stroke:var(--skin-dark); stroke-width:2; fill:none; stroke-linecap:round; opacity:.7; }
  /* The chips ride just ahead of the fingertips, then get left behind. */
  .pt-reach-chips{
    position:absolute; left:50%; top:0; transform:translate(-50%,-60%);
    transition:opacity .18s linear;
  }

  /* A bet marker waiting for the hand that's bringing it. */
  .pt-bet.pending{ opacity:0 !important; }
  .pt-bet.landed{ animation:pt-land .42s cubic-bezier(.3,1.4,.5,1); }
  @keyframes pt-land{ 0%{ transform:translate(-50%,-50%) scale(1.22); } 100%{ transform:translate(-50%,-50%) scale(1); } }

  .pt-pot-chips.bump{ animation:pt-bump .32s cubic-bezier(.3,1.5,.5,1); }
  @keyframes pt-bump{ 0%,100%{ transform:scale(1); } 45%{ transform:scale(1.18); } }

  /* ---- seats ---------------------------------------------------------- */
  .pt-seats, .pt-bets{ position:absolute; inset:0; pointer-events:none; }
  .pt-seat{
    position:absolute; transform:translate(-50%,-50%);
    display:flex; flex-direction:column; align-items:center; gap:.35cqw;
    width:14cqw; transition:opacity .25s var(--ease,ease), filter .25s;
  }
  .pt-seat-cards{ display:flex; gap:.3cqw; height:4.5cqw; align-items:center; }
  .pt-seat-plate{
    display:flex; align-items:center; gap:.6cqw; max-width:100%;
    padding:.45cqw 1cqw; border-radius:999px;
    background:linear-gradient(180deg, rgba(10,14,22,.92), rgba(4,7,12,.92));
    border:.1cqw solid rgba(255,255,255,.14);
    box-shadow:0 .5cqw 1cqw -.3cqw rgba(0,0,0,.7);
    transition:border-color .2s, box-shadow .2s, background .2s;
  }
  .pt-seat-name{
    font-size:1.15cqw; font-weight:800; color:var(--ink); max-width:8cqw;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    min-width:0;                 /* let a long name actually reach its ellipsis */
  }
  .pt-seat-stack{
    font-size:1.1cqw; font-weight:900; color:var(--gold); font-variant-numeric:tabular-nums;
    white-space:nowrap; flex:none;  /* never break between the coin and the number */
  }
  .pt-seat-stack::before{ content:"🪙"; font-size:.8em; margin-right:.2cqw; }

  .pt-seat-badges{ display:flex; gap:.35cqw; align-items:center; height:1.5cqw; }
  .pt-btn-d{
    width:1.5cqw; height:1.5cqw; border-radius:50%; font-style:normal;
    background:linear-gradient(180deg,#ffffff,#d8dde8); color:#14161c;
    display:grid; place-items:center; font-size:.85cqw; font-weight:900;
    box-shadow:0 .2cqw .4cqw rgba(0,0,0,.6);
  }
  .pt-tag{
    font-style:normal; font-size:.7cqw; font-weight:900; letter-spacing:.1em;
    padding:.18cqw .6cqw; border-radius:999px;
  }
  .pt-tag.allin{ background:#f04438; color:#fff; }
  .pt-tag.out{ background:rgba(255,255,255,.14); color:rgba(255,255,255,.7); }

  .pt-seat-note{ font-size:.85cqw; font-weight:700; color:rgba(255,255,255,.45); height:1.1cqw; }
  .pt-seat-note.win{ color:var(--gold); }

  /* ---- seat states ---------------------------------------------------- */
  .pt-seat.folded, .pt-seat.sitout{ opacity:.4; filter:grayscale(.6); }
  .pt-seat.acting .pt-seat-plate{
    border-color:var(--gold);
    background:linear-gradient(180deg, rgba(60,45,10,.95), rgba(30,22,4,.95));
    box-shadow:0 0 0 .18cqw color-mix(in srgb, var(--gold) 55%, transparent), 0 .6cqw 1.4cqw -.3cqw rgba(0,0,0,.8);
    animation:pt-pulse 1.5s ease-in-out infinite;
  }
  @keyframes pt-pulse{
    0%,100%{ box-shadow:0 0 0 .18cqw color-mix(in srgb, var(--gold) 55%, transparent), 0 .6cqw 1.4cqw -.3cqw rgba(0,0,0,.8); }
    50%    { box-shadow:0 0 0 .42cqw color-mix(in srgb, var(--gold) 22%, transparent), 0 .6cqw 1.4cqw -.3cqw rgba(0,0,0,.8); }
  }
  .pt-seat.winner .pt-seat-plate{
    border-color:var(--gold);
    background:linear-gradient(180deg,#7a5c10,#3d2c04);
    box-shadow:0 0 1.6cqw color-mix(in srgb, var(--gold) 45%, transparent), 0 .6cqw 1.4cqw -.3cqw rgba(0,0,0,.8);
  }
  .pt-seat.winner{ opacity:1; filter:none; }

  /* ---- live bets ------------------------------------------------------ */
  .pt-bet{
    position:absolute; transform:translate(-50%,-50%) scale(.7);
    opacity:0; transition:opacity .2s var(--ease,ease), transform .2s var(--ease,ease);
  }
  .pt-bet.show{ opacity:1; transform:translate(-50%,-50%) scale(1); }

  /* ---- showdown banner ------------------------------------------------ */
  .pt-banner{
    opacity:0; transform:translateY(.6cqw); pointer-events:none;
    transition:opacity .3s var(--ease,ease), transform .3s var(--ease,ease);
  }
  .pt-banner:empty{ display:none; }
  .pt-banner.show{ opacity:1; transform:none; }
  .pt-banner-card{
    display:flex; align-items:baseline; justify-content:center; flex-wrap:wrap; gap:.5cqw 1.2cqw;
    padding:.8cqw 2cqw; border-radius:1.6cqw;
    background:linear-gradient(180deg, rgba(20,26,38,.97), rgba(8,11,18,.97));
    border:.12cqw solid var(--gold);
    box-shadow:0 1.4cqw 3cqw -1cqw rgba(0,0,0,.9), 0 0 2cqw color-mix(in srgb, var(--gold) 25%, transparent);
  }
  .pt-banner-who{ font-size:1.5cqw; font-weight:900; color:#fff; }
  .pt-banner-hand{ font-size:1.15cqw; font-weight:700; color:var(--gold); }
  .pt-banner-amt{ font-size:1.35cqw; font-weight:900; color:var(--gold); font-variant-numeric:tabular-nums; }

  @media (prefers-reduced-motion: reduce){
    .pt-card.dealt{ animation:none; }
    .pt-seat.acting .pt-seat-plate{ animation:none; }
  }
  `;
  document.head.appendChild(el("style", { text: css }));
}
