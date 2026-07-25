// POST /api/buzz  { code, playerId }  → { ok, order } | { already } | { closed }
//
// The referee. One atomic Lua script decides buzz order — first tap to reach
// the server wins, and (because Redis runs it atomically) ties are impossible.
// First buzzer also locks the room, classic "first-in gets to answer" style.
import { redis, k, cors, up, touch } from "../lib/store.js";

const LUA = `
if redis.call('HGET', KEYS[1], 'open') ~= '1' then return -2 end
if redis.call('SADD', KEYS[2], ARGV[1]) == 0 then return -1 end
local n = redis.call('RPUSH', KEYS[3], ARGV[2])
if n == 1 then redis.call('HSET', KEYS[1], 'open', '0') end
return n
`;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = req.body || {};
  const code = up(b.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });

  const player = await redis.hget(k(code, "players"), b.playerId);
  if (!player) return res.status(403).json({ error: "Not joined" });

  const round = meta.round;
  const payload = JSON.stringify({ pid: b.playerId, name: player.name, t: Date.now() });
  const r = await redis.eval(
    LUA,
    [k(code, "meta"), k(code, "buzzed", round), k(code, "order", round)],
    [String(b.playerId), payload]
  );
  touch(code);

  if (r === -2) return res.json({ closed: true });
  if (r === -1) return res.json({ already: true });
  res.json({ ok: true, order: r });
}
