// POST /api/wager  { code, playerId, amount }  → { ok, amount } | { closed }
// A player places (or updates) their wager while the round is open. The amount is
// clamped to [0, cap]; the cap is set by the host when the round opens.
import { getRedis, k, api, up, touch } from "../lib/store.js";

export default api(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const redis = getRedis();

  const b = req.body || {};
  const code = up(b.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });
  if (String(meta.wagerOpen) !== "1") return res.json({ closed: true });

  const round = Number(meta.wagerRound) || 0;
  if (!round) return res.json({ closed: true });

  const cur = await redis.hget(k(code, "wager", round), b.playerId);
  const entry = (cur && typeof cur === "object") ? cur : { score: null, cap: null, bet: null };

  let amount = Math.max(0, Math.floor(Number(b.amount) || 0));
  if (entry.cap != null) amount = Math.min(amount, Number(entry.cap));
  entry.bet = amount;

  await redis.hset(k(code, "wager", round), { [b.playerId]: entry });
  touch(code);
  res.json({ ok: true, amount });
});
