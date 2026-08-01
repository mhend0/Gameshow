// Local test server — NO Upstash needed. Mirrors the Vercel /api routes with an
// in-memory store so you can try the whole buzzer on your laptop before deploying.
//   node dev-server.mjs   →   http://localhost:3000
// (Production on Vercel uses /api/*.js + Upstash instead; this file is dev-only.)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeTable, seatPlayer, removePlayer, adjustStack,
  startHand, applyAction, legalActions, foldOut, buildPots, arrangeSeats,
  setPaused, setActionTimer, setAutoDeal, setBlinds, setBlindLevel, endHand,
  foldExpired, actionExpired,
} from "./lib/poker.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;   // PORT=3100 node dev-server.mjs
const rooms = new Map();

const rid = (n = 16) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
const rcode = (n = 4) => Array.from({ length: n }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 30)]).join("");
const up = (x) => String(x || "").toUpperCase().trim();
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

async function serveStatic(pathname, res) {
  let p = pathname === "/" ? "/index.html" : pathname;
  if (!extname(p)) p += ".html";               // cleanUrls: /host -> /host.html
  try {
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "text/plain" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("Not found"); }
}

function readBody(req) {
  return new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } }); });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") { res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }); return res.end(); }

  if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname, res);

  const b = req.method === "POST" ? await readBody(req) : {};

  if (url.pathname === "/api/create") {
    let code; do { code = rcode(); } while (rooms.has(code));
    const host = rid(24);
    rooms.set(code, { host, open: false, round: 1, mode: "buzz", players: {}, buzzed: {}, order: {}, created: Date.now(),
      wagerActive: false, wagerOpen: false, wagerRound: 0, wager: {},
      chan: {}, poker: null });
    return json(res, 200, { code, hostToken: host });
  }

  if (url.pathname === "/api/join") {
    const room = rooms.get(up(b.code));
    if (!room) return json(res, 404, { error: "Room not found" });
    const pid = (b.playerId && String(b.playerId)) || rid();
    const name = String(b.name || "").slice(0, 24).trim() || "Player";
    const score = room.players[pid] ? room.players[pid].score : 0;
    room.players[pid] = { name, score };
    return json(res, 200, { playerId: pid, name });
  }

  if (url.pathname === "/api/buzz") {
    const room = rooms.get(up(b.code));
    if (!room) return json(res, 404, { error: "Room not found" });
    if (!room.players[b.playerId]) return json(res, 403, { error: "Not joined" });
    // atomic in Node's single thread (no awaits between check and write):
    if (!room.open) return json(res, 200, { closed: true });
    const answerMode = room.mode === "answer";
    const text = String(b.text || "").trim().slice(0, 80);
    if (answerMode && !text) return json(res, 400, { error: "Type an answer first" });
    const rnd = room.round;
    room.buzzed[rnd] = room.buzzed[rnd] || new Set();
    room.order[rnd] = room.order[rnd] || [];
    if (room.buzzed[rnd].has(b.playerId)) return json(res, 200, { already: true });
    room.buzzed[rnd].add(b.playerId);
    const entry = { pid: b.playerId, name: room.players[b.playerId].name, t: Date.now() };
    if (text) entry.text = text;
    room.order[rnd].push(entry);
    // stays open after the first buzz so the rest queue up behind them — except in
    // answer mode, where there's nobody left to wait for once everyone is in
    if (answerMode && room.order[rnd].length >= Object.keys(room.players).length) room.open = false;
    return json(res, 200, { ok: true, order: room.order[rnd].length });
  }

  if (url.pathname === "/api/state") {
    const room = rooms.get(up(url.searchParams.get("code")));
    if (!room) return json(res, 404, { error: "Room not found" });
    const order = room.order[room.round] || [];
    const players = Object.entries(room.players).map(([pid, v]) => ({ pid, name: v.name, score: v.score })).sort((a, b) => b.score - a.score);
    const wager = room.wagerActive
      ? { active: true, open: room.wagerOpen, round: room.wagerRound, bets: room.wager[room.wagerRound] || {} }
      : null;
    return json(res, 200, { open: room.open, round: room.round, mode: room.mode === "answer" ? "answer" : "buzz",
      buzzes: order.map((o, i) => ({ pid: o.pid, name: o.name, text: o.text || null, t: o.t, order: i + 1 })), players, wager });
  }

  if (url.pathname === "/api/wager") {
    const room = rooms.get(up(b.code));
    if (!room) return json(res, 404, { error: "Room not found" });
    if (!room.wagerOpen) return json(res, 200, { closed: true });
    const round = room.wagerRound;
    const bets = room.wager[round] = room.wager[round] || {};
    const entry = bets[b.playerId] || { score: null, cap: null, bet: null };
    let amount = Math.max(0, Math.floor(Number(b.amount) || 0));
    if (entry.cap != null) amount = Math.min(amount, Number(entry.cap));
    entry.bet = amount; bets[b.playerId] = entry;
    return json(res, 200, { ok: true, amount });
  }

  // ---- game channels: host pushes a snapshot, players push what they did ----
  // Mirrors lib/channel.js + api/<game>.js in production, including each game's
  // own rule about who is allowed to speak.
  const CHANNELS = {
    wheel(st, player, body) {
      const act = String(body.action || "");
      if (act === "buzz") {
        if ((st.lockedOut || []).includes(body.playerId)) return { reject: { lockedOut: true } };
      } else if (st.activePid && st.activePid !== body.playerId) {
        return { reject: { notYourTurn: true } };
      }
      if (act === "letter") {
        const letter = String(body.letter || "").toUpperCase().slice(0, 1);
        if (!/^[A-Z]$/.test(letter)) return { error: "Pick a letter" };
        if ((st.called || []).includes(letter)) return { reject: { already: true } };
        const vowel = "AEIOU".includes(letter);
        if (vowel && !st.vowelsAllowed) return { reject: { notAllowed: "vowel" } };
        if (!vowel && !st.consonantsAllowed) return { reject: { notAllowed: "consonant" } };
        return { entry: { letter } };
      }
      if (act === "solve") {
        const text = String(body.text || "").trim().slice(0, 120);
        if (!text) return { error: "Type your answer" };
        return { entry: { text } };
      }
      if (!["spin", "vowel", "buzz"].includes(act)) return { error: "Unknown action" };
      return {};
    },
    feud(st, player, body) {
      const act = String(body.action || "");
      if (act === "buzz") {
        if (!st.buzzOpen) return { reject: { closed: true } };
        const allowed = st.buzzPids || [];
        if (allowed.length && !allowed.includes(body.playerId)) return { reject: { notYourTurn: true } };
        return {};
      }
      if (act === "answer") {
        if (!st.activePid) return { reject: { closed: true } };
        if (st.activePid !== body.playerId) return { reject: { notYourTurn: true } };
        const text = String(body.text || "").trim().slice(0, 120);
        if (!text) return { error: "Type an answer first" };
        if ((st.pending || []).includes(body.playerId)) return { reject: { already: true } };
        return { entry: { text } };
      }
      if (act === "pass") {
        if (st.activePid !== body.playerId) return { reject: { notYourTurn: true } };
        return {};
      }
      return { error: "Unknown action" };
    },
  };

  const chanName = url.pathname.startsWith("/api/") ? url.pathname.slice(5) : "";
  if (CHANNELS[chanName]) {
    const validate = CHANNELS[chanName];
    const slot = (room) => (room.chan = room.chan || {});

    if (req.method === "GET") {
      const room = rooms.get(up(url.searchParams.get("code")));
      const c = room && room.chan && room.chan[chanName];
      if (!c || !c.state) return json(res, 200, { state: null, subs: [] });
      return json(res, 200, { state: c.state, subs: c.subs || [] });
    }
    const room = rooms.get(up(b.code));
    if (!room) return json(res, 404, { error: "Room not found" });
    const c = (slot(room)[chanName] = slot(room)[chanName] || { state: null, subs: [] });

    if (b.hostToken) {
      if (room.host !== b.hostToken) return json(res, 403, { error: "Bad host token" });
      if (b.action === "push") { c.state = b.state || {}; return json(res, 200, { ok: true }); }
      if (b.action === "drain") { const subs = c.subs; c.subs = []; return json(res, 200, { ok: true, subs }); }
      if (b.action === "end") { c.state = null; c.subs = []; return json(res, 200, { ok: true }); }
      return json(res, 400, { error: "Unknown host action" });
    }

    const player = room.players[b.playerId];
    if (!player) return json(res, 403, { error: "Not joined" });
    if (!c.state) return json(res, 409, { error: "The game isn't running" });

    const verdict = validate(c.state, player, b) || {};
    if (verdict.reject) return json(res, 200, verdict.reject);
    if (verdict.error) return json(res, verdict.status || 400, { error: verdict.error });

    const entry = { pid: b.playerId, name: player.name, action: String(b.action || ""),
      seq: c.state.seq, t: Date.now(), ...(verdict.entry || {}) };
    c.subs.push(entry);
    return json(res, 200, { ok: true, action: entry.action });
  }

  // ---- poker: mirrors api/poker.js, in-memory instead of Redis. ----
  if (url.pathname === "/api/poker") {
    const isRealShowdown = (game) => game.street === "complete" && game.results.some((r) => r.winners.some((w) => w.rank));
    const publicView = (game, viewerId) => {
      const showdown = isRealShowdown(game);
      const seats = game.seats.map((s) => {
        const reveal = s.id && (s.id === viewerId || (showdown && s.status !== "folded" && s.holeCards.length));
        return { index: s.index, id: s.id, name: s.name, stack: s.stack, bet: s.bet, totalBet: s.totalBet,
          status: s.status, holeCards: reveal ? s.holeCards : s.holeCards.map(() => null) };
      });
      const acting = game.actingIndex >= 0 ? game.seats[game.actingIndex] : null;
      const you = viewerId ? game.seats.find((s) => s.id === viewerId) : null;
      return {
        id: game.id, seats, dealerIndex: game.dealerIndex, handNumber: game.handNumber,
        smallBlind: game.smallBlind, bigBlind: game.bigBlind, community: game.community, street: game.street,
        currentBet: game.currentBet, pot: game.seats.reduce((t, s) => t + s.totalBet, 0),
        pots: (game.pots && game.pots.length) ? game.pots : buildPots(game.seats),
        actingIndex: game.actingIndex, actingId: acting ? acting.id : null, results: game.results,
        paused: !!game.paused, handVoided: !!game.handVoided, autoDeal: !!game.autoDeal,
        blindLevel: game.blindLevel || 0, timerSeconds: game.timerSeconds || 0,
        secondsLeft: game.timerSeconds && game.actingSince && !game.paused && game.actingIndex >= 0
          ? Math.max(0, Math.ceil((game.actingSince + game.timerSeconds * 1000 - Date.now()) / 1000))
          : null,
        expired: actionExpired(game),
        you: you ? { seatIndex: you.index, holeCards: you.holeCards, stack: you.stack, bet: you.bet, status: you.status,
          isActing: acting ? acting.id === viewerId : false,
          legal: acting && acting.id === viewerId ? legalActions(game) : null } : null,
      };
    };

    if (req.method === "GET") {
      const room = rooms.get(up(url.searchParams.get("code")));
      const viewerId = url.searchParams.get("playerId") || null;
      if (!room || !room.poker) return json(res, 200, { game: null });
      return json(res, 200, { game: publicView(room.poker, viewerId) });
    }

    const room = rooms.get(up(b.code));
    if (!room) return json(res, 404, { error: "Room not found" });

    if (b.hostToken) {
      if (room.host !== b.hostToken) return json(res, 403, { error: "Bad host token" });
      if (b.action === "create") {
        if (!room.poker) room.poker = makeTable(b.table || {});
        return json(res, 200, { game: publicView(room.poker, null) });
      }
      if (!room.poker) return json(res, 409, { error: "The poker table hasn't been created yet" });
      try {
        switch (b.action) {
          case "start": startHand(room.poker); break;
          case "end": room.poker = null; return json(res, 200, { ok: true });
          case "arrange": arrangeSeats(room.poker, Array.isArray(b.order) ? b.order.map(String) : []); break;
          case "pause": setPaused(room.poker, true); break;
          case "resume": setPaused(room.poker, false); break;
          case "endHand": endHand(room.poker); break;
          case "timer": setActionTimer(room.poker, b.seconds); break;
          case "autoDeal": setAutoDeal(room.poker, !!b.on); break;
          case "blinds":
            if (b.level != null) setBlindLevel(room.poker, b.level);
            else setBlinds(room.poker, b.smallBlind, b.bigBlind);
            break;
          case "timeout":
            if (!foldExpired(room.poker)) return json(res, 200, { ok: true, expired: false, game: publicView(room.poker, null) });
            break;
          case "kick": removePlayer(room.poker, String(b.seatId)); break;
          case "addChips": adjustStack(room.poker, String(b.seatId), Math.abs(Number(b.amount) || 0)); break;
          case "removeChips": adjustStack(room.poker, String(b.seatId), -Math.abs(Number(b.amount) || 0)); break;
          default: return json(res, 400, { error: "Unknown host action" });
        }
      } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 200, { ok: true, game: publicView(room.poker, null) });
    }

    const player = room.players[b.playerId];
    if (!player) return json(res, 403, { error: "Not joined" });
    if (!room.poker) return json(res, 409, { error: "The poker table isn't open yet" });
    const playerId = String(b.playerId);
    try {
      switch (b.action) {
        case "sit": {
          const buyIn = Number(b.buyIn);
          const idx = seatPlayer(room.poker, { id: playerId, name: player.name, ...(Number.isFinite(buyIn) && buyIn > 0 ? { stack: Math.round(buyIn) } : {}) });
          if (idx < 0) return json(res, 200, { full: true });
          break;
        }
        case "stand": {
          const seat = room.poker.seats.find((s) => s.id === playerId);
          if (seat && seat.status === "active") foldOut(room.poker, playerId);
          else if (seat) removePlayer(room.poker, playerId);
          break;
        }
        case "fold": case "check": case "call": case "bet": case "raise":
          applyAction(room.poker, playerId, { type: b.action, to: Number(b.to) });
          break;
        default: return json(res, 400, { error: "Unknown action" });
      }
    } catch (e) { return json(res, 200, { error: e.message }); }
    return json(res, 200, { ok: true, game: publicView(room.poker, playerId) });
  }

  if (url.pathname === "/api/host") {
    const room = rooms.get(up(b.code));
    if (!room) return json(res, 404, { error: "Room not found" });
    if (room.host !== b.hostToken) return json(res, 403, { error: "Bad host token" });
    switch (b.action) {
      case "arm": room.round += 1; room.buzzed[room.round] = new Set(); room.order[room.round] = []; room.open = true; return json(res, 200, { ok: true, round: room.round, open: true });
      case "reopen": room.open = true; return json(res, 200, { ok: true, open: true });
      case "lock": room.open = false; return json(res, 200, { ok: true, open: false });
      case "mode": room.mode = b.mode === "answer" ? "answer" : "buzz"; return json(res, 200, { ok: true, mode: room.mode });
      case "score": if (room.players[b.pid]) room.players[b.pid].score += Number(b.delta || 0); return json(res, 200, { ok: true });
      case "rename": if (room.players[b.pid]) room.players[b.pid].name = String(b.name || "").slice(0, 24) || room.players[b.pid].name; return json(res, 200, { ok: true });
      case "kick": delete room.players[b.pid]; return json(res, 200, { ok: true });
      case "wagerOpen": {
        const nr = (room.wagerRound || 0) + 1;
        const entries = {};
        for (const p of (Array.isArray(b.players) ? b.players : [])) {
          if (p && p.pid) entries[p.pid] = { score: Number(p.score) || 0, cap: (p.cap == null ? null : Number(p.cap)), bet: null };
        }
        room.wager[nr] = entries;
        room.wagerRound = nr; room.wagerActive = true; room.wagerOpen = true;
        return json(res, 200, { ok: true, round: nr });
      }
      case "wagerLock": room.wagerOpen = false; return json(res, 200, { ok: true });
      case "wagerReopen": room.wagerOpen = true; return json(res, 200, { ok: true });
      case "wagerEnd": room.wagerActive = false; room.wagerOpen = false; return json(res, 200, { ok: true });
      default: return json(res, 400, { error: "Unknown action" });
    }
  }

  json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`Buzzer dev server → http://localhost:${PORT}  (host at /host)`));
