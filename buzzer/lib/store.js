// Shared Redis client + helpers for all API routes.
// State store: Upstash Redis (REST) — provisioned via the Vercel Marketplace.
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

export const TTL = 60 * 60 * 24;              // rooms auto-expire after 24h
export const k = (code, ...p) => `r:${code}:${p.join(":")}`;

// Room codes: unambiguous chars only (no O/0, I/1/L).
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

export async function touch(code) {
  await Promise.all([
    redis.expire(k(code, "meta"), TTL),
    redis.expire(k(code, "players"), TTL),
  ]);
}
