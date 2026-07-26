// POST /api/buzz  { code, playerId, text? }  → { ok, order } | { already } | { closed }
//
// The referee for both modes. One atomic Lua script decides the order — the first
// entry to reach the server wins, and (because Redis runs it atomically) ties are
// impossible.
//
// Quick Buzz sends no text: the entry is just "I'm in". Quick Answer sends the
// typed answer along with it — ranking submissions by speed is the same problem,
// so it's the same script, the same round, and the same one-per-player guard.
//
// The room stays OPEN after the first entry so everyone else can queue up behind
// them: the host needs the running order to pivot to #2 when #1 gets it wrong.
// One entry per player (the SADD), and the host can still lock manually. In Quick
// Answer mode the script also closes the room once every joined player is in —
// there's nobody left to wait for.
import { getRedis, k, api, up, touch } from "../lib/store.js";

const LUA = `
if redis.call('HGET', KEYS[1], 'open') ~= '1' then return -2 end
if redis.call('SADD', KEYS[2], ARGV[1]) == 0 then return -1 end
local n = redis.call('RPUSH', KEYS[3], ARGV[2])
if ARGV[3] == '1' and n >= redis.call('HLEN', KEYS[4]) then
  redis.call('HSET', KEYS[1], 'open', '0')
end
return n
`;

export default api(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const redis = getRedis();

  const b = req.body || {};
  const code = up(b.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });

  const player = await redis.hget(k(code, "players"), b.playerId);
  if (!player) return res.status(403).json({ error: "Not joined" });

  // In Quick Answer mode the entry *is* the answer, so an empty one means nothing —
  // reject it rather than burning the player's one shot on a blank.
  const answerMode = meta.mode === "answer";
  const text = String(b.text || "").trim().slice(0, 80);
  if (answerMode && !text) return res.status(400).json({ error: "Type an answer first" });

  const round = meta.round;
  const entry = { pid: b.playerId, name: player.name, t: Date.now() };
  if (text) entry.text = text;

  const r = await redis.eval(
    LUA,
    [k(code, "meta"), k(code, "buzzed", round), k(code, "order", round), k(code, "players")],
    [String(b.playerId), JSON.stringify(entry), answerMode ? "1" : "0"]
  );
  touch(code);

  if (r === -2) return res.json({ closed: true });
  if (r === -1) return res.json({ already: true });
  res.json({ ok: true, order: r });
});
