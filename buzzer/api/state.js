// GET /api/state?code=CODE  → { open, round, buzzes:[{pid,name,order,t}], players:[{pid,name,score}] }
import { getRedis, k, api, up } from "../lib/store.js";

export default api(async (req, res) => {
  const redis = getRedis();
  const code = up(req.query.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });

  const round = meta.round;
  const [order, playersMap] = await Promise.all([
    redis.lrange(k(code, "order", round), 0, -1),
    redis.hgetall(k(code, "players")),
  ]);

  const players = Object.entries(playersMap || {})
    .map(([pid, v]) => ({ pid, name: v.name, score: v.score || 0 }))
    .sort((a, b) => b.score - a.score);

  res.json({
    open: String(meta.open) === "1",
    round: Number(round),
    buzzes: (order || []).map((o, i) => ({ pid: o.pid, name: o.name, t: o.t, order: i + 1 })),
    players,
  });
});
