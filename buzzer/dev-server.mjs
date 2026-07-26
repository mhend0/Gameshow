// Local test server — NO Upstash needed. Mirrors the Vercel /api routes with an
// in-memory store so you can try the whole buzzer on your laptop before deploying.
//   node dev-server.mjs   →   http://localhost:3000
// (Production on Vercel uses /api/*.js + Upstash instead; this file is dev-only.)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = 3000;
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
    rooms.set(code, { host, open: false, round: 1, players: {}, buzzed: {}, order: {}, created: Date.now(),
      wagerActive: false, wagerOpen: false, wagerRound: 0, wager: {} });
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
    const rnd = room.round;
    room.buzzed[rnd] = room.buzzed[rnd] || new Set();
    room.order[rnd] = room.order[rnd] || [];
    if (room.buzzed[rnd].has(b.playerId)) return json(res, 200, { already: true });
    room.buzzed[rnd].add(b.playerId);
    room.order[rnd].push({ pid: b.playerId, name: room.players[b.playerId].name, t: Date.now() });
    const n = room.order[rnd].length;
    if (n === 1) room.open = false;              // first buzz locks
    return json(res, 200, { ok: true, order: n });
  }

  if (url.pathname === "/api/state") {
    const room = rooms.get(up(url.searchParams.get("code")));
    if (!room) return json(res, 404, { error: "Room not found" });
    const order = room.order[room.round] || [];
    const players = Object.entries(room.players).map(([pid, v]) => ({ pid, name: v.name, score: v.score })).sort((a, b) => b.score - a.score);
    const wager = room.wagerActive
      ? { active: true, open: room.wagerOpen, round: room.wagerRound, bets: room.wager[room.wagerRound] || {} }
      : null;
    return json(res, 200, { open: room.open, round: room.round, buzzes: order.map((o, i) => ({ pid: o.pid, name: o.name, t: o.t, order: i + 1 })), players, wager });
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

  if (url.pathname === "/api/host") {
    const room = rooms.get(up(b.code));
    if (!room) return json(res, 404, { error: "Room not found" });
    if (room.host !== b.hostToken) return json(res, 403, { error: "Bad host token" });
    switch (b.action) {
      case "arm": room.round += 1; room.buzzed[room.round] = new Set(); room.order[room.round] = []; room.open = true; return json(res, 200, { ok: true, round: room.round, open: true });
      case "reopen": room.open = true; return json(res, 200, { ok: true, open: true });
      case "lock": room.open = false; return json(res, 200, { ok: true, open: false });
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
