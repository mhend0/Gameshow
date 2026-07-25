// POST /api/join  { code, name, playerId? }  → { playerId, name }
import { redis, k, randId, cors, up, touch } from "../lib/store.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = req.body || {};
  const code = up(b.code);
  if (!code || !(await redis.exists(k(code, "meta")))) {
    return res.status(404).json({ error: "Room not found" });
  }
  const pid = (b.playerId && String(b.playerId)) || randId(16);
  const name = String(b.name || "").slice(0, 24).trim() || "Player";

  // Keep score if this player is rejoining after a refresh.
  const existing = await redis.hget(k(code, "players"), pid);
  const score = existing && typeof existing.score === "number" ? existing.score : 0;

  await redis.hset(k(code, "players"), { [pid]: { name, score } });
  await touch(code);
  res.json({ playerId: pid, name });
}
