// POST /api/create  → { code, hostToken }   (host creates a new room)
import { redis, k, TTL, randCode, randId, cors } from "../lib/store.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let code, tries = 0;
  do { code = randCode(4); tries++; } while ((await redis.exists(k(code, "meta"))) && tries < 8);

  const host = randId(24);
  await redis.hset(k(code, "meta"), { host, open: 0, round: 1, created: Date.now() });
  await redis.expire(k(code, "meta"), TTL);
  res.json({ code, hostToken: host });
}
