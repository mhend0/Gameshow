// Shared Redis client + helpers for all API routes.
// State store: Upstash Redis (REST) — provisioned via the Vercel Marketplace.
import { Redis } from "@upstash/redis";

let _redis;
export function getRedis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Store not connected: missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. " +
      "In Vercel → your project → Storage, connect an Upstash Redis database, then redeploy."
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

export const TTL = 60 * 60 * 24;              // rooms auto-expire after 24h
export const k = (code, ...p) => `r:${code}:${p.join(":")}`;

const CODE_ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randCode(n = 4) {
  let s = "";
  for (let i = 0; i < n; i++) s += CODE_ALPH[Math.floor(Math.random() * CODE_ALPH.length)];
  return s;
}
export function randId(n = 20) {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}
export const up = (x) => String(x || "").toUpperCase().trim();

// Wrap a handler: CORS + OPTIONS + turn thrown errors into a clean JSON 500
// (instead of Vercel's opaque FUNCTION_INVOCATION_FAILED).
export function api(fn) {
  return async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    try { await fn(req, res); }
    catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
  };
}

export async function touch(code) {
  const redis = getRedis();
  await Promise.all([
    redis.expire(k(code, "meta"), TTL),
    redis.expire(k(code, "players"), TTL),
  ]);
}
