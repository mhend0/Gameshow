// The poker table, heard.
//
// `pokerSoundCues` (platform/core/poker-events.js) says *what* happened between
// two snapshots; this says what that sounds like and, more importantly, *when*.
// Timing is the whole job: a real table is a sequence, not a chord. Cards leave
// the dealer's hands one at a time, the pot is pushed after the cards are shown,
// the cheer comes after the pot. Firing everything a poll returned at once
// would sound like a dropped tray.
//
// So each cue type carries a fixed offset within the batch, and everything is
// handed to the audio clock rather than to setTimeout — a browser throttles
// timers on a backgrounded tab, and a TV in a corner of a room is very often
// the backgrounded tab.

import { sfx } from "./sfx.js";
import { pokerSoundCues } from "../core/poker-events.js";
import { chipColumns } from "../core/poker-chips.js";

/**
 * Where each cue sits, in seconds, relative to the poll that produced it.
 *
 * The end-of-hand run is the reason this exists: showdown chime, then the pot
 * sliding across, then the win, then the room — in that order, with enough air
 * between them to hear each one.
 */
const OFFSET = {
  shuffle: 0,
  board: 0,
  check: 0,
  fold: 0,
  chips: 0,
  allIn: 0.22,      // after the chips it was made of have landed
  showdown: 0,
  potPush: 0.55,
  win: 0.95,
  applause: 1.3,
  bust: 1.75,
};

/** Board cards are turned one after another, not flipped as a block. */
const PER_BOARD_CARD_S = 0.14;
/** Two players acting inside one poll shouldn't land on the same instant. */
const PER_ACTION_STAGGER_S = 0.09;
/** Cues caused by a specific player, which get that stagger. */
const SEAT_CUES = new Set(["check", "fold", "chips", "allIn"]);

/**
 * @param {Object} [opts]
 * @param {string} [opts.scope]       Mute is remembered per surface (see sfx.setScope).
 * @param {boolean} [opts.startMuted] Default for a surface that's never been set.
 * @param {number} [opts.dealLeadMs]  Must match the table's own deal `startDelay`.
 * @param {number} [opts.perCardMs]   …and its per-card spacing.
 * @param {boolean} [opts.roomTone]   Run the crowd murmur between the action.
 */
export function createPokerSound({
  scope = "poker-tv",
  startMuted = false,
  dealLeadMs = 620,
  perCardMs = 125,
  roomTone = true,
} = {}) {
  sfx.setScope(scope, startMuted);
  let ambient = false;

  /**
   * How many chips this amount is actually *made of* — so a 2,000 bet in two
   * chips doesn't rattle like a fistful of ones. Deliberately `chipColumns`
   * rather than `chipBreakdown`: it's the pile the table draws, and what you
   * hear should be what you see.
   */
  const chipCount = (amount) =>
    chipColumns(amount).reduce((total, column) => total + column.count, 0) || 2;

  function play(cue, at) {
    switch (cue.type) {
      case "shuffle":
        sfx.shuffle({ t: at });
        break;
      case "deal":
        // One swish per card, on the same clock the cards fly on.
        for (let i = 0; i < cue.count; i++) {
          sfx.cardDeal({ t: at + dealLeadMs / 1000 + (i * perCardMs) / 1000 });
        }
        break;
      case "board":
        for (let i = 0; i < cue.count; i++) sfx.cardFlip({ t: at + i * PER_BOARD_CARD_S });
        break;
      case "check":
        sfx.tableTap({ t: at });
        break;
      case "fold":
        sfx.muck({ t: at });
        break;
      case "chips":
        sfx.chips({ t: at, count: chipCount(cue.amount) });
        break;
      case "allIn":
        sfx.allIn({ t: at });
        break;
      case "showdown":
        sfx.showdown({ t: at });
        break;
      case "potPush":
        sfx.potPush({ t: at });
        break;
      case "win":
        sfx.pokerWin({ t: at, big: !!cue.big });
        break;
      case "applause":
        // sfx.applause has no `t` — it's a crowd, and a tenth of a second of
        // drift in a two-second swell is not something anybody can hear.
        setTimeout(() => sfx.applause(2.6), Math.round(at * 1000));
        break;
      case "bust":
        sfx.bustOut({ t: at });
        break;
      default:
        break;
    }
  }

  function setRoomTone(on) {
    if (!roomTone || ambient === on) return;
    ambient = sfx.roomTone(on);
  }

  return {
    get muted() { return sfx.muted; },

    /** Must be called from a real user gesture before anything will be audible. */
    unlock() { return sfx.unlock(); },

    /**
     * Play whatever changed between two snapshots.
     * @param {Object|null} prev
     * @param {Object|null} next
     */
    react(prev, next) {
      // The murmur follows whether there's a table at all, not whether it's
      // muted — mute is the master gain's business, and a room that has to be
      // re-established on unmute would start with an audible swell.
      setRoomTone(!!next);
      if (sfx.muted) return;

      let seatActions = 0;
      for (const cue of pokerSoundCues(prev, next)) {
        const stagger = SEAT_CUES.has(cue.type) ? seatActions++ * PER_ACTION_STAGGER_S : 0;
        play(cue, (OFFSET[cue.type] || 0) + stagger);
      }
    },

    setMuted(next) { return sfx.setMuted(next); },
    toggleMute() { return sfx.toggleMute(); },

    destroy() {
      setRoomTone(false);
    },
  };
}

export default createPokerSound;
