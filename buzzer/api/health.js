// GET /api/health  → reports whether the store env vars are present and Redis is reachable.
// Never exposes secret values — only booleans + a ping result.
import { cors } from "../lib/store.js";

export default async function handler(req, res) {
  cors(res);
  const env = {
    UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    REDIS_URL: !!process.env.REDIS_URL,
    KV_URL: !!process.env.KV_URL,
  };
  let ping = null, error = null;
  try {
    const { getRedis } = await import("../lib/store.js");
    ping = await getRedis().ping();
  } catch (e) {
    error = String((e && e.message) || e);
  }
  res.json({ ok: ping === "PONG", ping, error, env });
}
