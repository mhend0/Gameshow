// POST /api/poker   host:   { code, hostToken, action:"start"|"end"|"kick"|"addChips"|"removeChips", seatId?, amount? }
//                   player: { code, playerId, action:"sit"|"stand"|"fold"|"check"|"call"|"bet"|"raise", name?, buyIn?, to? }
// GET  /api/poker?code=CODE&playerId=PID  → { seats, community, pot, street, dealerIndex, actingIndex, results, you }
//
// Unlike the Feud/Wheel channels (host pushes a snapshot, players queue
// submissions the host later judges), poker has no step that needs a human's
// judgment — every action is either legal or it isn't. So this endpoint *is*
// the referee: it holds the one PokerGame object in Redis and is the only
// thing that ever calls into lib/poker.js's applyAction. Phones and the host
// console are both just views over whatever this returns — "never trust the
// client" means the client never gets to decide what happened, only ask.
//
// GET is redacted per viewer: nobody's hole cards go out except the viewer's
// own, and everyone's stay hidden until a real showdown (not a fold-out).
import { getRedis, k, api, up, touch, TTL } from "../lib/store.js";
import {
  makeTable, seatPlayer, removePlayer, adjustStack,
  startHand, applyAction, legalActions, foldOut, buildPots, arrangeSeats,
  setPaused, setActionTimer, setAutoDeal, setBlinds, setBlindLevel, endHand,
  foldExpired, actionExpired,
} from "../lib/poker.js";

const gKey = (code) => k(code, "poker");

async function loadGame(redis, code) {
  const raw = await redis.get(gKey(code));
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}
async function saveGame(redis, code, game) {
  await redis.set(gKey(code), JSON.stringify(game), { ex: TTL });
  await touch(code);
}

/** Whether the hand ended with cards actually shown (a real showdown), vs. everyone folding but one. */
function isRealShowdown(game) {
  return game.street === "complete" && game.results.some((r) => r.winners.some((w) => w.rank));
}

/** Strip everything a given viewer (or the public TV feed, when viewerId is null) shouldn't see. */
function publicView(game, viewerId) {
  const showdown = isRealShowdown(game);
  const seats = game.seats.map((s) => {
    const reveal = s.id && (s.id === viewerId || (showdown && s.status !== "folded" && s.holeCards.length));
    return {
      index: s.index, id: s.id, name: s.name, stack: s.stack,
      bet: s.bet, totalBet: s.totalBet, status: s.status,
      holeCards: reveal ? s.holeCards : s.holeCards.map(() => null),
    };
  });
  const acting = game.actingIndex >= 0 ? game.seats[game.actingIndex] : null;
  const you = viewerId ? game.seats.find((s) => s.id === viewerId) : null;

  return {
    id: game.id,
    seats,
    dealerIndex: game.dealerIndex,
    handNumber: game.handNumber,
    smallBlind: game.smallBlind,
    bigBlind: game.bigBlind,
    community: game.community,
    street: game.street,
    currentBet: game.currentBet,
    pot: game.seats.reduce((t, s) => t + s.totalBet, 0),
    // The engine only fixes the pot layers at showdown, but a TV wants to show
    // "main / side" the moment a short stack is all in — so derive them live
    // from what's committed, and use the engine's own once it has them.
    pots: (game.pots && game.pots.length) ? game.pots : buildPots(game.seats),
    actingIndex: game.actingIndex,
    actingId: acting ? acting.id : null,
    results: game.results,

    /* ---- host controls, so every surface shows the same thing ---- */
    paused: !!game.paused,
    handVoided: !!game.handVoided,
    autoDeal: !!game.autoDeal,
    blindLevel: game.blindLevel || 0,
    timerSeconds: game.timerSeconds || 0,
    // Seconds left on the clock, rather than a timestamp — clients' clocks
    // disagree with the server's, and a countdown drawn from a raw epoch would
    // be wrong by however far they're skewed.
    secondsLeft: game.timerSeconds && game.actingSince && !game.paused && game.actingIndex >= 0
      ? Math.max(0, Math.ceil((game.actingSince + game.timerSeconds * 1000 - Date.now()) / 1000))
      : null,
    expired: actionExpired(game),
    you: you
      ? {
          seatIndex: you.index,
          holeCards: you.holeCards,
          stack: you.stack,
          bet: you.bet,
          status: you.status,
          isActing: acting ? acting.id === viewerId : false,
          legal: acting && acting.id === viewerId ? legalActions(game) : null,
        }
      : null,
  };
}

export default api(async (req, res) => {
  const redis = getRedis();

  if (req.method === "GET") {
    const code = up(req.query.code);
    const viewerId = req.query.playerId ? String(req.query.playerId) : null;
    const game = await loadGame(redis, code);
    if (!game) return res.json({ game: null });
    return res.json({ game: publicView(game, viewerId) });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = req.body || {};
  const code = up(b.code);
  const meta = await redis.hgetall(k(code, "meta"));
  if (!meta || !meta.host) return res.status(404).json({ error: "Room not found" });

  /* ---------------------------------------------------------- host side */
  if (b.hostToken) {
    if (meta.host !== b.hostToken) return res.status(403).json({ error: "Bad host token" });

    if (b.action === "create") {
      let game = await loadGame(redis, code);
      if (!game) {
        game = makeTable(b.table || {});
        await saveGame(redis, code, game);
      }
      return res.json({ game: publicView(game, null) });
    }

    let game = await loadGame(redis, code);
    if (!game) return res.status(409).json({ error: "The poker table hasn't been created yet" });

    try {
      switch (b.action) {
        case "start":
          startHand(game);
          break;
        case "end":
          await redis.del(gKey(code));
          return res.json({ ok: true });
        case "arrange":
          // The clockwise order people are physically sitting in, so the ring
          // on the TV matches the room (see arrangeSeats in lib/poker.js).
          arrangeSeats(game, Array.isArray(b.order) ? b.order.map(String) : []);
          break;
        case "pause":   setPaused(game, true); break;
        case "resume":  setPaused(game, false); break;
        case "endHand": endHand(game); break;
        case "timer":   setActionTimer(game, b.seconds); break;
        case "autoDeal": setAutoDeal(game, !!b.on); break;
        case "blinds":
          if (b.level != null) setBlindLevel(game, b.level);
          else setBlinds(game, b.smallBlind, b.bigBlind);
          break;
        case "timeout":
          // The console watches the countdown, but it doesn't get to decide
          // the outcome: the engine re-checks the elapsed time itself and does
          // nothing if the clock hasn't genuinely run out.
          if (!foldExpired(game)) return res.json({ ok: true, expired: false, game: publicView(game, null) });
          break;
        case "kick":
          removePlayer(game, String(b.seatId));
          break;
        case "addChips":
          adjustStack(game, String(b.seatId), Math.abs(Number(b.amount) || 0));
          break;
        case "removeChips":
          adjustStack(game, String(b.seatId), -Math.abs(Number(b.amount) || 0));
          break;
        default:
          return res.status(400).json({ error: "Unknown host action" });
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    await saveGame(redis, code, game);
    return res.json({ ok: true, game: publicView(game, null) });
  }

  /* -------------------------------------------------------- player side */
  const player = await redis.hget(k(code, "players"), b.playerId);
  if (!player) return res.status(403).json({ error: "Not joined" });

  let game = await loadGame(redis, code);
  if (!game) return res.status(409).json({ error: "The poker table isn't open yet" });
  const playerId = String(b.playerId);

  try {
    switch (b.action) {
      case "sit": {
        const buyIn = Number(b.buyIn);
        const idx = seatPlayer(game, {
          id: playerId,
          name: player.name,
          ...(Number.isFinite(buyIn) && buyIn > 0 ? { stack: Math.round(buyIn) } : {}),
        });
        if (idx < 0) { return res.json({ full: true }); }
        break;
      }
      case "stand": {
        const seat = game.seats.find((s) => s.id === playerId);
        if (seat && seat.status === "active") foldOut(game, playerId);
        else if (seat) removePlayer(game, playerId);
        break;
      }
      case "fold": case "check": case "call": case "bet": case "raise":
        applyAction(game, playerId, { type: b.action, to: Number(b.to) });
        break;
      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.json({ error: e.message });
  }

  await saveGame(redis, code, game);
  res.json({ ok: true, game: publicView(game, playerId) });
});
