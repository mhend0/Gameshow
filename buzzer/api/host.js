// POST /api/host  { code, hostToken, action, ...args }   (host-only controls)
// actions: arm | reopen | lock | score | rename | kick
import { redis, k, cors, up, touch } from "../lib/store.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = req.body || {};
  const code = up(b.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });
  if (meta.host !== b.hostToken) return res.status(403).json({ error: "Bad host token" });

  const round = Number(meta.round) || 1;

  switch (b.action) {
    case "arm": {                                  // new question: fresh + open for buzzing
      const nr = round + 1;
      await redis.del(k(code, "buzzed", nr), k(code, "order", nr));
      await redis.hset(k(code, "meta"), { round: nr, open: 1 });
      await touch(code);
      return res.json({ ok: true, round: nr, open: true });
    }
    case "reopen":                                 // same question, let remaining players buzz
      await redis.hset(k(code, "meta"), { open: 1 });
      return res.json({ ok: true, open: true });
    case "lock":
      await redis.hset(k(code, "meta"), { open: 0 });
      return res.json({ ok: true, open: false });
    case "score": {
      const p = await redis.hget(k(code, "players"), b.pid);
      if (p) { p.score = (p.score || 0) + Number(b.delta || 0); await redis.hset(k(code, "players"), { [b.pid]: p }); }
      return res.json({ ok: true });
    }
    case "rename": {
      const p = await redis.hget(k(code, "players"), b.pid);
      if (p) { p.name = String(b.name || "").slice(0, 24) || p.name; await redis.hset(k(code, "players"), { [b.pid]: p }); }
      return res.json({ ok: true });
    }
    case "kick":
      await redis.hdel(k(code, "players"), b.pid);
      return res.json({ ok: true });
    default:
      return res.status(400).json({ error: "Unknown action" });
  }
}
