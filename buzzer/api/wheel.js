// POST /api/wheel   host: { code, hostToken, action:"push"|"drain"|"end", state? }
//                   player: { code, playerId, action:"letter"|"vowel"|"spin"|"solve"|"buzz", ... }
// GET  /api/wheel?code=CODE  → { state, subs }
//
// The wheel's phone channel. The pipe itself is shared with the other games
// (see lib/channel.js); what lives here is only the wheel's own rule about who
// may speak: a toss-up is open to the room, everything else belongs to the
// player whose turn it is, and a letter has to be one the round still allows.
import { makeChannel } from "../lib/channel.js";

export default makeChannel({
  stateKey: "wheel",
  subsKey: "wsubs",

  validate({ state, playerId, body }) {
    const action = String(body.action || "");

    // A toss-up is open to the room, so the snapshot carries no active player
    // and any phone may buzz — except one that's already been locked out.
    if (action === "buzz") {
      if ((state.lockedOut || []).includes(playerId)) return { reject: { lockedOut: true } };
    } else if (state.activePid && state.activePid !== playerId) {
      // Everything else is the active player's alone.
      return { reject: { notYourTurn: true } };
    }

    if (action === "letter") {
      const letter = String(body.letter || "").toUpperCase().slice(0, 1);
      if (!/^[A-Z]$/.test(letter)) return { error: "Pick a letter" };
      if ((state.called || []).includes(letter)) return { reject: { already: true } };
      const vowel = "AEIOU".includes(letter);
      if (vowel && !state.vowelsAllowed) return { reject: { notAllowed: "vowel" } };
      if (!vowel && !state.consonantsAllowed) return { reject: { notAllowed: "consonant" } };
      return { entry: { letter } };
    }

    if (action === "solve") {
      const text = String(body.text || "").trim().slice(0, 120);
      if (!text) return { error: "Type your answer" };
      return { entry: { text } };
    }

    if (!["spin", "vowel", "buzz"].includes(action)) return { error: "Unknown action" };
    return {};
  },
});
