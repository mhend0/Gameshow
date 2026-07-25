// Shared Redis client + helpers for all API routes.
// State store: Upstash Redis (REST) — provisioned via the Vercel Marketplace.
import { Redis } from "@upstash/redis";

// Find an env var by suffix, so any Vercel storage prefix works
// (e.g. Buzzer_KV_REST_API_URL, KV_REST_API_URL, UPSTASH_REDIS_REST_URL …).
function envBySuffix(re, exclude) {
  for (const [key, val] of Object.entries(process.env)) {
    if (val && re.test(key) && !(exclude && exclude.test(key))) return val;
  }
  return undefined;
}
export function resolveCreds() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL ||
    envBySuffix(/KV_REST_API_URL$/) || envBySuffix(/UPSTASH_REDIS_REST_URL$/);
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN ||
    envBySuffix(/KV_REST_API_TOKEN$/, /READ_ONLY/) ||
    envBySuffix(/UPSTASH_REDIS_REST_TOKEN$/, /READ_ONLY/);
  return { url, token };
}

let _redis;
export function getRedis() {
  if (_redis) return _redis;
  const { url, token } = resolveCreds();
  if (!url || !token) {
    throw new Error(
      "Store not connected: no *KV_REST_API_URL / *KV_REST_API_TOKEN found in env. " +
      "In Vercel → Storage, connect a Redis database to this project, then redeploy."
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
