// POST /api/host  { code, hostToken, action, ...args }   (host-only controls)
// actions: arm | reopen | lock | score | rename | kick
import { getRedis, k, api, up, touch } from "../lib/store.js";

export default api(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const redis = getRedis();

  const b = req.body || {};
  const code = up(b.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });
  if (meta.host !== b.hostToken) return res.status(403).json({ error: "Bad host token" });

  const round = Number(meta.round) || 1;

  switch (b.action) {
    case "arm": {
      const nr = round + 1;
      await redis.del(k(code, "buzzed", nr), k(code, "order", nr));
      await redis.hset(k(code, "meta"), { round: nr, open: 1 });
      await touch(code);
      return res.json({ ok: true, round: nr, open: true });
    }
    case "reopen":
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

    // ---- wager rounds (Daily Double / final-style) ----
    case "wagerOpen": {
      const nr = (Number(meta.wagerRound) || 0) + 1;
      await redis.del(k(code, "wager", nr));
      const entries = {};
      for (const p of (Array.isArray(b.players) ? b.players : [])) {
        if (p && p.pid) entries[p.pid] = { score: Number(p.score) || 0, cap: (p.cap == null ? null : Number(p.cap)), bet: null };
      }
      if (Object.keys(entries).length) await redis.hset(k(code, "wager", nr), entries);
      await redis.hset(k(code, "meta"), { wagerRound: nr, wagerActive: 1, wagerOpen: 1 });
      await touch(code);
      return res.json({ ok: true, round: nr });
    }
    case "wagerLock":
      await redis.hset(k(code, "meta"), { wagerOpen: 0 });
      return res.json({ ok: true });
    case "wagerReopen":
      await redis.hset(k(code, "meta"), { wagerOpen: 1 });
      return res.json({ ok: true });
    case "wagerEnd":
      await redis.hset(k(code, "meta"), { wagerActive: 0, wagerOpen: 0 });
      return res.json({ ok: true });

    default:
      return res.status(400).json({ error: "Unknown action" });
  }
});
