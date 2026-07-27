// POST /api/wheel   host: { code, hostToken, action:"push"|"drain", state? }
//                   player: { code, playerId, action:"letter"|"vowel"|"spin"|"solve", ... }
// GET  /api/wheel?code=CODE  → { state, subs }
//
// The wheel's phone channel. It carries two things in opposite directions:
//
//   • the host pushes a small snapshot of the game (whose turn it is, which
//     letters are gone, what the board looks like) so every phone can show the
//     right screen without knowing the rules;
//   • players push what they picked, and the host drains that queue and applies
//     it exactly as if they'd said it out loud and the host had clicked.
//
// The console stays the referee — the server only decides *who is allowed to
// speak*, which it can do from the snapshot: submissions from anyone but the
// active player are rejected, so a fast thumb on another phone can't take a turn
// that isn't theirs.
import { getRedis, k, api, up, touch, TTL } from "../lib/store.js";

/** Room is a wheel room once the host pushes a snapshot; phones poll for it. */
const stateKey = (code) => k(code, "wheel");
const subsKey = (code) => k(code, "wsubs");

export default api(async (req, res) => {
  const redis = getRedis();

  if (req.method === "GET") {
    const code = up(req.query.code);
    const [raw, subs] = await Promise.all([
      redis.get(stateKey(code)),
      redis.lrange(subsKey(code), 0, -1),
    ]);
    if (!raw) return res.json({ state: null, subs: [] });
    return res.json({
      state: typeof raw === "string" ? JSON.parse(raw) : raw,
      subs: (subs || []).map((s) => (typeof s === "string" ? JSON.parse(s) : s)),
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = req.body || {};
  const code = up(b.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });

  /* ---------------------------------------------------------- host side */
  if (b.hostToken) {
    if (meta.host !== b.hostToken) return res.status(403).json({ error: "Bad host token" });

    if (b.action === "push") {
      await redis.set(stateKey(code), JSON.stringify(b.state || {}), { ex: TTL });
      await touch(code);
      return res.json({ ok: true });
    }
    if (b.action === "drain") {
      // Read and clear in one shot so a submission can't be applied twice.
      const subs = await redis.lrange(subsKey(code), 0, -1);
      await redis.del(subsKey(code));
      return res.json({ ok: true, subs: (subs || []).map((s) => (typeof s === "string" ? JSON.parse(s) : s)) });
    }
    if (b.action === "end") {
      await redis.del(stateKey(code), subsKey(code));
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown host action" });
  }

  /* -------------------------------------------------------- player side */
  const player = await redis.hget(k(code, "players"), b.playerId);
  if (!player) return res.status(403).json({ error: "Not joined" });

  const raw = await redis.get(stateKey(code));
  if (!raw) return res.status(409).json({ error: "The wheel isn't running" });
  const state = typeof raw === "string" ? JSON.parse(raw) : raw;

  const action = String(b.action || "");

  // A toss-up is open to the room, so the snapshot carries no active player and
  // any phone may buzz — except one that's already been locked out.
  if (action === "buzz") {
    if ((state.lockedOut || []).includes(b.playerId)) return res.json({ lockedOut: true });
  } else if (state.activePid && state.activePid !== b.playerId) {
    // Everything else is the active player's alone.
    return res.json({ notYourTurn: true });
  }

  const entry = { pid: b.playerId, name: player.name, action, seq: state.seq, t: Date.now() };

  if (action === "letter") {
    const letter = String(b.letter || "").toUpperCase().slice(0, 1);
    if (!/^[A-Z]$/.test(letter)) return res.status(400).json({ error: "Pick a letter" });
    if ((state.called || []).includes(letter)) return res.json({ already: true });
    const vowel = "AEIOU".includes(letter);
    if (vowel && !state.vowelsAllowed) return res.json({ notAllowed: "vowel" });
    if (!vowel && !state.consonantsAllowed) return res.json({ notAllowed: "consonant" });
    entry.letter = letter;
  } else if (action === "solve") {
    const text = String(b.text || "").trim().slice(0, 120);
    if (!text) return res.status(400).json({ error: "Type your answer" });
    entry.text = text;
  } else if (!["spin", "vowel", "buzz"].includes(action)) {
    return res.status(400).json({ error: "Unknown action" });
  }

  await redis.rpush(subsKey(code), JSON.stringify(entry));
  await redis.expire(subsKey(code), TTL);
  await touch(code);
  res.json({ ok: true, action });
});
