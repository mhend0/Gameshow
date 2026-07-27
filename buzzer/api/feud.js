// POST /api/feud   host:   { code, hostToken, action:"push"|"drain"|"end", state? }
//                  player: { code, playerId, action:"buzz"|"answer"|"pass", text? }
// GET  /api/feud?code=CODE  → { state, subs }
//
// Family Feud's phone channel, on the shared pipe (see lib/channel.js). Only
// the Feud's own rule about who may speak lives here:
//
//   • a face-off buzz is open to the two players at the front of each family's
//     line, and the first one to reach the server wins — the console never sees
//     the second, because it drains the queue in order;
//   • an answer belongs to whoever the snapshot says is up, and nobody else.
//
// Note that an answer reaching the queue is not an answer landing on the board:
// the console holds every one of them for the host to accept or reject. The
// server's job is only to stop a phone answering out of turn.
import { makeChannel } from "../lib/channel.js";

export default makeChannel({
  stateKey: "feud",
  subsKey: "fsubs",

  validate({ state, playerId, body }) {
    const action = String(body.action || "");

    if (action === "buzz") {
      if (!state.buzzOpen) return { reject: { closed: true } };
      // When the snapshot names the two players facing off, only they may buzz.
      const allowed = state.buzzPids || [];
      if (allowed.length && !allowed.includes(playerId)) return { reject: { notYourTurn: true } };
      return {};
    }

    if (action === "answer") {
      if (!state.activePid) return { reject: { closed: true } };
      if (state.activePid !== playerId) return { reject: { notYourTurn: true } };
      const text = String(body.text || "").trim().slice(0, 120);
      if (!text) return { error: "Type an answer first" };
      // One at a time: the host has to clear the last one before another lands.
      if ((state.pending || []).includes(playerId)) return { reject: { already: true } };
      return { entry: { text } };
    }

    if (action === "pass") {
      if (state.activePid !== playerId) return { reject: { notYourTurn: true } };
      return {};
    }

    return { error: "Unknown action" };
  },
});
