// A game channel: the host pushes a snapshot, players push what they picked.
//
// Both the wheel and the Feud need the same pipe in opposite directions:
//
//   • the host pushes a small snapshot of the game (whose turn it is, what the
//     board looks like) so every phone can show the right screen without
//     knowing the rules;
//   • players push what they did, and the host drains that queue and applies it
//     exactly as if they'd said it out loud and the host had clicked.
//
// The console stays the referee — the server only decides *who is allowed to
// speak*, which it can do from the snapshot. What counts as allowed differs per
// game, so each one passes its own `validate`; everything else is shared.

import { getRedis, k, api, up, touch, TTL } from "./store.js";

/**
 * @param {Object} opts
 * @param {string} opts.stateKey  Redis suffix for the snapshot (e.g. "wheel").
 * @param {string} opts.subsKey   Redis suffix for the submission queue.
 * @param {(ctx:{state:Object, playerId:string, body:Object}) =>
 *          {reject?:Object, error?:string, status?:number, entry?:Object}} opts.validate
 *        Decides whether a submission is allowed, and what to queue for it.
 *        Return `{reject}` for a clean "no" the phone can render, `{error}` for
 *        a bad request, or `{entry}` with the fields to add to the queued item.
 */
export function makeChannel({ stateKey, subsKey, validate }) {
  const sKey = (code) => k(code, stateKey);
  const qKey = (code) => k(code, subsKey);

  return api(async (req, res) => {
    const redis = getRedis();

    if (req.method === "GET") {
      const code = up(req.query.code);
      const [raw, subs] = await Promise.all([
        redis.get(sKey(code)),
        redis.lrange(qKey(code), 0, -1),
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
        await redis.set(sKey(code), JSON.stringify(b.state || {}), { ex: TTL });
        await touch(code);
        return res.json({ ok: true });
      }
      if (b.action === "drain") {
        // Read and clear in one shot so a submission can't be applied twice.
        const subs = await redis.lrange(qKey(code), 0, -1);
        await redis.del(qKey(code));
        return res.json({ ok: true, subs: (subs || []).map((s) => (typeof s === "string" ? JSON.parse(s) : s)) });
      }
      if (b.action === "end") {
        await redis.del(sKey(code), qKey(code));
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: "Unknown host action" });
    }

    /* -------------------------------------------------------- player side */
    const player = await redis.hget(k(code, "players"), b.playerId);
    if (!player) return res.status(403).json({ error: "Not joined" });

    const raw = await redis.get(sKey(code));
    if (!raw) return res.status(409).json({ error: "The game isn't running" });
    const state = typeof raw === "string" ? JSON.parse(raw) : raw;

    const verdict = validate({ state, playerId: b.playerId, body: b }) || {};
    if (verdict.reject) return res.json(verdict.reject);
    if (verdict.error) return res.status(verdict.status || 400).json({ error: verdict.error });

    const entry = {
      pid: b.playerId, name: player.name, action: String(b.action || ""),
      seq: state.seq, t: Date.now(), ...(verdict.entry || {}),
    };
    await redis.rpush(qKey(code), JSON.stringify(entry));
    await redis.expire(qKey(code), TTL);
    await touch(code);
    res.json({ ok: true, action: entry.action });
  });
}
