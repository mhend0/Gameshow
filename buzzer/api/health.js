// GET /api/health  → reports whether the store is reachable. Never exposes secret values.
import { cors, resolveCreds } from "../lib/store.js";

export default async function handler(req, res) {
  cors(res);
  // Which store-ish env keys exist (names only)?
  const keys = Object.keys(process.env).filter(k => /KV_|UPSTASH|REDIS/.test(k));
  const { url, token } = resolveCreds();
  let ping = null, error = null;
  try {
    const { getRedis } = await import("../lib/store.js");
    ping = await getRedis().ping();
  } catch (e) {
    error = String((e && e.message) || e);
  }
  res.json({ ok: ping === "PONG", ping, error, resolved: { url: !!url, token: !!token }, keysFound: keys });
}
