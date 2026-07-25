// POST /api/create  → { code, hostToken }
import { getRedis, k, TTL, randCode, randId, api } from "../lib/store.js";

export default api(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const redis = getRedis();

  let code, tries = 0;
  do { code = randCode(4); tries++; } while ((await redis.exists(k(code, "meta"))) && tries < 8);

  const host = randId(24);
  await redis.hset(k(code, "meta"), { host, open: 0, round: 1, created: Date.now() });
  await redis.expire(k(code, "meta"), TTL);
  res.json({ code, hostToken: host });
});
