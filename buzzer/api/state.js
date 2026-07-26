// GET /api/state?code=CODE  → { open, round, mode, buzzes:[{pid,name,text,order,t}], players:[{pid,name,score}] }
import { getRedis, k, api, up } from "../lib/store.js";

export default api(async (req, res) => {
  const redis = getRedis();
  const code = up(req.query.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });

  const round = meta.round;
  const wagerRound = Number(meta.wagerRound) || 0;
  const wagerActive = String(meta.wagerActive) === "1";

  const [order, playersMap, wagerMap] = await Promise.all([
    redis.lrange(k(code, "order", round), 0, -1),
    redis.hgetall(k(code, "players")),
    (wagerActive && wagerRound) ? redis.hgetall(k(code, "wager", wagerRound)) : Promise.resolve(null),
  ]);

  const players = Object.entries(playersMap || {})
    .map(([pid, v]) => ({ pid, name: v.name, score: v.score || 0 }))
    .sort((a, b) => b.score - a.score);

  // wager: null when no round in progress. bets = { pid: { score, cap, bet } }.
  const wager = wagerActive
    ? { active: true, open: String(meta.wagerOpen) === "1", round: wagerRound, bets: wagerMap || {} }
    : null;

  res.json({
    open: String(meta.open) === "1",
    round: Number(round),
    // Older rooms have no mode set — they're Quick Buzz rooms.
    mode: meta.mode === "answer" ? "answer" : "buzz",
    buzzes: (order || []).map((o, i) => ({ pid: o.pid, name: o.name, text: o.text || null, t: o.t, order: i + 1 })),
    players,
    wager,
  });
});
