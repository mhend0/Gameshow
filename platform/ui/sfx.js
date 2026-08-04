// Stage sound effects, synthesised with WebAudio.
//
// Nothing is loaded from disk: every sound is generated from oscillators and a
// noise buffer. That keeps the app portable (no media files to ship, nothing
// added to the asset store's quota) and means a cue never arrives late because a
// file was still downloading — which matters when the tick has to line up with
// the wheel and the ding with a tile turning.
//
// Browsers won't start audio until the user has interacted, so the console calls
// `unlock()` on the host's first click; every cue before that is a silent no-op.

// The mute setting is scoped, because the console runs in two windows at once and
// they want different answers: the TV is the room's speakers, the host's laptop
// is usually silent. Same origin, same storage — so the key has to differ.
let storeKey = "gsp_sfx_muted";

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = readMuted();

/** The poker room tone's nodes while it's running, or null. See `roomTone`. */
let room = null;
let roomBuf = null;
/** Quiet enough to disappear the moment anything else happens. */
const ROOM_LEVEL = 0.03;

function readMuted() {
  try { return localStorage.getItem(storeKey) === "1"; } catch { return false; }
}

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.85;
  master.connect(ctx.destination);
  return ctx;
}

/** White noise, one second, reused by every noise-based cue. */
function noise() {
  const c = ensureCtx();
  if (!c) return null;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

/** A shaped oscillator note. Returns when it will have finished. */
function tone({ freq = 440, to = null, type = "sine", t = 0, dur = 0.3, gain = 0.3, attack = 0.006, curve = "exp" } = {}) {
  const c = ensureCtx();
  if (!c) return 0;
  const at = c.currentTime + t;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to != null) {
    if (curve === "exp") osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
    else osc.frequency.linearRampToValueAtTime(to, at + dur);
  }
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  return dur;
}

/** A band-passed noise burst — clicks, crashes, applause. */
function hiss({ t = 0, dur = 0.2, freq = 1800, q = 1, gain = 0.3, sweepTo = null, attack = 0.005 } = {}) {
  const c = ensureCtx();
  if (!c) return 0;
  const src = noise();
  if (!src) return 0;
  const at = c.currentTime + t;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(freq, at);
  bp.Q.value = q;
  if (sweepTo != null) bp.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(at);
  src.stop(at + dur + 0.02);
  return dur;
}

/* -------------------------------------------------------------------- cues */

export const sfx = {
  get muted() { return muted; },

  /**
   * Name this speaker (e.g. "wheel-tv", "wheel-control") so its mute setting is
   * remembered separately from the other windows'.
   * @param {string} scope
   * @param {boolean} [fallback]  Used when this scope has no saved preference.
   */
  setScope(scope, fallback = false) {
    storeKey = `gsp_sfx_muted:${scope}`;
    let saved = null;
    try { saved = localStorage.getItem(storeKey); } catch { /* private mode */ }
    muted = saved == null ? !!fallback : saved === "1";
    if (master) master.gain.value = muted ? 0 : 0.85;
    return muted;
  },

  /** Called from a real user gesture so the browser lets us make noise at all. */
  unlock() {
    const c = ensureCtx();
    if (c && c.state === "suspended") c.resume();
    return !!c;
  },

  setMuted(next) {
    muted = !!next;
    try { localStorage.setItem(storeKey, muted ? "1" : "0"); } catch { /* private mode */ }
    if (master) master.gain.value = muted ? 0 : 0.85;
    return muted;
  },

  toggleMute() { return this.setMuted(!muted); },

  /** A peg passing the flapper. Pitch wanders slightly so a fast run isn't a tone. */
  tick() {
    if (muted) return;
    const f = 1500 + Math.random() * 700;
    hiss({ dur: 0.035, freq: f, q: 5, gain: 0.28, attack: 0.001 });
    tone({ freq: f * 0.55, type: "square", dur: 0.03, gain: 0.05, attack: 0.001 });
  },

  /** The wheel being thrown. */
  whoosh() {
    if (muted) return;
    hiss({ dur: 0.75, freq: 320, sweepTo: 2600, q: 0.8, gain: 0.16, attack: 0.09 });
  },

  /** A tile turning over. */
  ding() {
    if (muted) return;
    tone({ freq: 1244.5, type: "sine", dur: 0.34, gain: 0.16 });
    tone({ freq: 1864.7, type: "sine", dur: 0.24, gain: 0.07, t: 0.01 });
  },

  /** Called a letter that isn't there. */
  wrong() {
    if (muted) return;
    tone({ freq: 233, to: 116, type: "sawtooth", dur: 0.5, gain: 0.16, curve: "exp" });
    tone({ freq: 117, to: 58, type: "square", dur: 0.5, gain: 0.09 });
  },

  /** Bankrupt: the floor falls out. */
  bankrupt() {
    if (muted) return;
    tone({ freq: 320, to: 40, type: "sawtooth", dur: 1.1, gain: 0.2 });
    tone({ freq: 160, to: 26, type: "square", dur: 1.1, gain: 0.12 });
    hiss({ dur: 0.9, freq: 900, sweepTo: 90, q: 0.7, gain: 0.2, attack: 0.01 });
  },

  /** Lose a turn: a flat little sigh. */
  loseTurn() {
    if (muted) return;
    tone({ freq: 392, type: "triangle", dur: 0.22, gain: 0.16 });
    tone({ freq: 311, type: "triangle", dur: 0.34, gain: 0.16, t: 0.2 });
    tone({ freq: 233, type: "triangle", dur: 0.5, gain: 0.14, t: 0.44 });
  },

  /** Buying a vowel — coins off the pile. */
  buyVowel() {
    if (muted) return;
    [0, 0.07, 0.14].forEach((t, i) => {
      tone({ freq: 1600 + i * 260, type: "triangle", dur: 0.1, gain: 0.13, t });
      hiss({ t, dur: 0.06, freq: 5200, q: 3, gain: 0.1, attack: 0.001 });
    });
  },

  /** A cash wedge landing, pitched up with the value so big money sounds big. */
  cash(value = 500) {
    if (muted) return;
    const lift = Math.min(1, Math.max(0, (value - 300) / 4700));
    tone({ freq: 660 + lift * 440, type: "triangle", dur: 0.16, gain: 0.16 });
    tone({ freq: 990 + lift * 660, type: "sine", dur: 0.3, gain: 0.12, t: 0.08 });
  },

  /** Free play — a friendly rising blip. */
  freePlay() {
    if (muted) return;
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.16, gain: 0.13, t: i * 0.06 }));
  },

  /** Puzzle solved. */
  solve() {
    if (muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      tone({ freq: f, type: "triangle", dur: 0.5, gain: 0.17, t: i * 0.085 });
      tone({ freq: f * 2, type: "sine", dur: 0.36, gain: 0.06, t: i * 0.085 });
    });
    tone({ freq: 1046.5, type: "triangle", dur: 1.1, gain: 0.16, t: 0.46 });
    tone({ freq: 1567.98, type: "sine", dur: 1.1, gain: 0.09, t: 0.46 });
  },

  /** The room going up. Layered noise swells read as a crowd, not as static. */
  applause(dur = 2.8) {
    if (muted) return;
    for (let i = 0; i < 7; i++) {
      hiss({
        t: i * 0.045,
        dur: dur - i * 0.05,
        freq: 900 + i * 520,
        q: 0.5 + i * 0.2,
        gain: 0.075,
        attack: 0.12 + i * 0.03,
      });
    }
    // a couple of whistles over the top
    tone({ freq: 2100, to: 2600, type: "sine", dur: 0.5, gain: 0.05, t: 0.5 });
    tone({ freq: 2400, to: 1900, type: "sine", dur: 0.6, gain: 0.04, t: 1.15 });
  },

  /** A blip per step while a score counts up. */
  countBlip(i = 0) {
    if (muted) return;
    tone({ freq: 880 + (i % 6) * 90, type: "sine", dur: 0.06, gain: 0.06, attack: 0.002 });
  },

  /** Somebody hit their buzzer in a toss-up. */
  buzzIn() {
    if (muted) return;
    tone({ freq: 784, type: "square", dur: 0.12, gain: 0.16 });
    tone({ freq: 1175, type: "square", dur: 0.22, gain: 0.14, t: 0.1 });
  },

  /** One second falling off the bonus clock. */
  clockTick(secondsLeft = 10) {
    if (muted) return;
    // Tightens as it runs out, so the last few seconds feel like the last few.
    const urgent = secondsLeft <= 3;
    hiss({ dur: 0.05, freq: urgent ? 2600 : 1700, q: 6, gain: urgent ? 0.22 : 0.14, attack: 0.001 });
    tone({ freq: urgent ? 900 : 700, type: "square", dur: 0.05, gain: 0.07, attack: 0.001 });
  },

  /** The bonus-round clock running out. */
  buzzer() {
    if (muted) return;
    tone({ freq: 180, type: "square", dur: 0.9, gain: 0.2 });
    tone({ freq: 120, type: "sawtooth", dur: 0.9, gain: 0.14 });
  },

  /* ---------------------------------------------------------- the Feud */

  /**
   * An answer landing on the board. The Feud's is a bell, not a chime: three
   * quick strikes on the same note with the overtone ringing on underneath,
   * and it brightens with the points so the top answer sounds like the top
   * answer.
   */
  reveal(points = 20) {
    if (muted) return;
    const lift = Math.min(1, Math.max(0, points / 45));
    const f = 880 + lift * 340;
    [0, 0.085, 0.17].forEach((t, i) => {
      tone({ freq: f, type: "sine", dur: 0.3 - i * 0.05, gain: 0.17, t, attack: 0.002 });
      tone({ freq: f * 2.01, type: "sine", dur: 0.22, gain: 0.07, t, attack: 0.002 });
    });
    tone({ freq: f * 1.5, type: "sine", dur: 0.85, gain: 0.05, t: 0.17 });
  },

  /**
   * A strike. Harsh, buzzing and unpleasant on purpose — two short buzzes
   * back to back, like a game-show "wrong" horn — and it drops a tone with
   * each strike, so the third sounds like the end of the round without
   * anybody having to say so.
   */
  strike(n = 1) {
    if (muted) return;
    const base = [220, 185, 150][Math.min(2, Math.max(0, n - 1))];
    const buzzDur = n >= 3 ? 0.52 : 0.3;
    const gap = buzzDur + 0.09;
    [0, gap].forEach((t) => {
      tone({ freq: base, type: "square", dur: buzzDur, gain: 0.2, t, attack: 0.002 });
      tone({ freq: base * 1.5, type: "sawtooth", dur: buzzDur, gain: 0.11, t, attack: 0.002 });
      tone({ freq: base / 2, type: "square", dur: buzzDur, gain: 0.13, t, attack: 0.002 });
      hiss({ t, dur: buzzDur * 0.5, freq: 420, q: 1.2, gain: 0.09, attack: 0.004 });
    });
  },

  /** Buzzers arming for a face-off: two players, one note each, then go. */
  faceOffReady(step = 0) {
    if (muted) return;
    tone({ freq: 523.25 + step * 90, type: "triangle", dur: 0.16, gain: 0.15, attack: 0.003 });
  },

  /** Money going into the bank at the end of a round. */
  bank(amount = 100) {
    if (muted) return;
    const steps = Math.min(9, 3 + Math.floor(amount / 60));
    for (let i = 0; i < steps; i++) {
      tone({ freq: 700 + i * 105, type: "triangle", dur: 0.1, gain: 0.12, t: i * 0.055 });
      hiss({ t: i * 0.055, dur: 0.05, freq: 4800, q: 3, gain: 0.07, attack: 0.001 });
    }
    tone({ freq: 700 + steps * 105, type: "sine", dur: 0.6, gain: 0.1, t: steps * 0.055 });
  },

  /** A Fast Money answer being scored — one clean ping per point block. */
  fastMoneyDing() {
    if (muted) return;
    tone({ freq: 1396.9, type: "sine", dur: 0.26, gain: 0.15, attack: 0.002 });
    tone({ freq: 2093, type: "sine", dur: 0.18, gain: 0.06, t: 0.015 });
  },

  /** A Fast Money answer that scored nothing. */
  fastMoneyBuzz() {
    if (muted) return;
    tone({ freq: 196, type: "square", dur: 0.42, gain: 0.17 });
    tone({ freq: 147, type: "sawtooth", dur: 0.42, gain: 0.1 });
  },

  /* ------------------------------------------------------- Texas Hold'em */
  //
  // A poker table is the quietest game on the platform and the most textural:
  // almost everything it does is card on felt, chip on chip, knuckle on wood.
  // So these lean on filtered noise rather than notes, and only the moments
  // that are genuinely *events* — a shove, a showdown, a win — get pitched
  // material. Anything that can be heard several times in a second (cards,
  // chips) is randomised, because identical clicks in a row read as a machine.
  //
  // Every cue takes a `t` offset and schedules itself on the audio clock
  // instead of via setTimeout: a whole street's worth of sound can be queued
  // in one go and still land in time on a tab the browser has throttled.

  /** The pack riffled, bridged and squared off. */
  shuffle({ t = 0 } = {}) {
    if (muted) return;
    for (let i = 0; i < 22; i++) {
      hiss({ t: t + 0.02 + i * 0.016 + Math.random() * 0.008,
        dur: 0.014, freq: 2600 + Math.random() * 3200, q: 7, gain: 0.045, attack: 0.001 });
    }
    hiss({ t: t + 0.4, dur: 0.2, freq: 3400, sweepTo: 900, q: 1.2, gain: 0.07, attack: 0.012 });
    hiss({ t: t + 0.62, dur: 0.05, freq: 900, q: 1.5, gain: 0.08, attack: 0.002 });
    tone({ t: t + 0.62, freq: 150, type: "sine", dur: 0.06, gain: 0.06, attack: 0.002 });
  },

  /** One card pitched across the felt, and the tap as it arrives. */
  cardDeal({ t = 0 } = {}) {
    if (muted) return;
    const f = 4200 + Math.random() * 1800;
    hiss({ t, dur: 0.085, freq: f, sweepTo: f * 0.32, q: 1.1, gain: 0.055, attack: 0.005 });
    hiss({ t: t + 0.06, dur: 0.03, freq: 1500, q: 3, gain: 0.035, attack: 0.001 });
  },

  /** A board card turned face up — crisper than a pitch, with a knock under it. */
  cardFlip({ t = 0 } = {}) {
    if (muted) return;
    hiss({ t, dur: 0.05, freq: 3000, sweepTo: 1200, q: 1.6, gain: 0.075, attack: 0.002 });
    hiss({ t: t + 0.045, dur: 0.035, freq: 1100, q: 2.5, gain: 0.06, attack: 0.001 });
    tone({ t: t + 0.045, freq: 190, type: "sine", dur: 0.05, gain: 0.05, attack: 0.002 });
  },

  /** Checking: two knuckles on the table, the way it's actually done. */
  tableTap({ t = 0 } = {}) {
    if (muted) return;
    [0, 0.11].forEach((d, i) => {
      tone({ t: t + d, freq: 168 - i * 12, type: "sine", dur: 0.075, gain: 0.16, attack: 0.002 });
      tone({ t: t + d, freq: 84, type: "triangle", dur: 0.09, gain: 0.09, attack: 0.002 });
      hiss({ t: t + d, dur: 0.03, freq: 1400, q: 1.4, gain: 0.05, attack: 0.001 });
    });
  },

  /** Folding: two cards slid away face down. */
  muck({ t = 0 } = {}) {
    if (muted) return;
    hiss({ t, dur: 0.16, freq: 2400, sweepTo: 700, q: 0.9, gain: 0.05, attack: 0.022 });
    hiss({ t: t + 0.13, dur: 0.04, freq: 800, q: 2, gain: 0.035, attack: 0.002 });
  },

  /**
   * Chips onto the felt. Clay, not metal: a high click for the edge and a
   * short ring for the body, scattered rather than evenly spaced.
   * @param {{t?:number, count?:number}} [opts] `count` is roughly how many chips.
   */
  chips({ t = 0, count = 4 } = {}) {
    if (muted) return;
    const n = Math.max(2, Math.min(10, Math.round(count)));
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.028 + Math.random() * 0.022;
      const f = 900 + Math.random() * 900;
      hiss({ t: at, dur: 0.022, freq: 2800 + Math.random() * 2400, q: 6, gain: 0.06, attack: 0.001 });
      tone({ t: at, freq: f, type: "triangle", dur: 0.05, gain: 0.045, attack: 0.001 });
      tone({ t: at, freq: f * 0.5, type: "sine", dur: 0.035, gain: 0.03, attack: 0.001 });
    }
  },

  /** The whole pot raked in and pushed across — a slide with chips loose on top. */
  potPush({ t = 0 } = {}) {
    if (muted) return;
    hiss({ t, dur: 0.42, freq: 700, sweepTo: 260, q: 0.8, gain: 0.075, attack: 0.06 });
    for (let i = 0; i < 14; i++) {
      const at = t + 0.1 + Math.random() * 0.34;
      const f = 800 + Math.random() * 1000;
      hiss({ t: at, dur: 0.02, freq: 2600 + Math.random() * 2600, q: 6, gain: 0.045, attack: 0.001 });
      tone({ t: at, freq: f, type: "triangle", dur: 0.045, gain: 0.035, attack: 0.001 });
    }
  },

  /**
   * Somebody just pushed it all in. The one cue here allowed to be theatrical:
   * a drone that lifts under the table, a swell over it, and two heartbeats,
   * so the room knows to stop talking before it looks at the screen.
   */
  allIn({ t = 0 } = {}) {
    if (muted) return;
    tone({ t, freq: 110, to: 146.83, type: "sawtooth", dur: 1.5, gain: 0.09, attack: 0.25 });
    tone({ t, freq: 55, to: 73.42, type: "sine", dur: 1.6, gain: 0.11, attack: 0.3 });
    hiss({ t, dur: 1.35, freq: 1400, sweepTo: 5200, q: 0.6, gain: 0.05, attack: 0.9 });
    [0.12, 0.44].forEach((d) => tone({ t: t + d, freq: 62, type: "sine", dur: 0.16, gain: 0.16, attack: 0.006 }));
    tone({ t: t + 1.05, freq: 220, to: 110, type: "square", dur: 0.5, gain: 0.08 });
  },

  /** Cards on their backs: three notes climbing, then whatever the board says. */
  showdown({ t = 0 } = {}) {
    if (muted) return;
    [392, 466.16, 587.33].forEach((f, i) => {
      tone({ t: t + i * 0.13, freq: f, type: "triangle", dur: 0.28, gain: 0.12 });
      tone({ t: t + i * 0.13, freq: f * 2, type: "sine", dur: 0.2, gain: 0.05 });
    });
  },

  /** Taking down the pot. `big` is for the ones the room will remember. */
  pokerWin({ t = 0, big = false } = {}) {
    if (muted) return;
    const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.51] : [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      tone({ t: t + i * 0.09, freq: f, type: "triangle", dur: 0.42, gain: 0.15 });
      tone({ t: t + i * 0.09, freq: f * 2, type: "sine", dur: 0.3, gain: 0.05 });
    });
    const tail = t + notes.length * 0.09;
    tone({ t: tail, freq: notes[notes.length - 1], type: "triangle", dur: big ? 1.1 : 0.7, gain: 0.13 });
    if (big) tone({ t: tail, freq: notes[notes.length - 1] * 1.5, type: "sine", dur: 1.1, gain: 0.06 });
  },

  /** Out of chips. Everything falls. */
  bustOut({ t = 0 } = {}) {
    if (muted) return;
    tone({ t, freq: 330, to: 82, type: "triangle", dur: 1, gain: 0.13 });
    tone({ t, freq: 165, to: 41, type: "sine", dur: 1.1, gain: 0.09 });
    hiss({ t, dur: 0.7, freq: 700, sweepTo: 120, q: 0.8, gain: 0.05, attack: 0.025 });
  },

  /**
   * The room itself: a low murmur that sits under everything so the table
   * doesn't feel like it's in a vacuum between hands. Unlike every other cue
   * this one keeps playing, so it's a switch rather than a trigger.
   *
   * It breathes — a slow LFO on the gain — because steady filtered noise reads
   * as air conditioning, and a crowd never holds still.
   *
   * @param {boolean} on
   * @returns {boolean} Whether the room tone is now running.
   */
  roomTone(on = true) {
    const c = ensureCtx();
    if (!c) return false;

    if (!on) {
      if (!room) return false;
      const { src, lfo, gain } = room;
      room = null;
      // Fade before stopping: cutting a noise source dead is an audible click.
      gain.gain.cancelScheduledValues(c.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
      gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.6);
      src.stop(c.currentTime + 0.7);
      lfo.stop(c.currentTime + 0.7);
      return false;
    }

    if (room) return true;
    // Its own, longer buffer rather than the shared one-second clip: looping a
    // single second of noise puts an audible pulse on the loop point, and this
    // is the only cue that runs long enough for anyone to notice.
    if (!roomBuf) {
      roomBuf = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
      const d = roomBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource();
    src.buffer = roomBuf;
    src.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 130;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    lp.Q.value = 0.5;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.linearRampToValueAtTime(ROOM_LEVEL, c.currentTime + 1.2);
    const lfo = c.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.07;
    const swell = c.createGain();
    swell.gain.value = ROOM_LEVEL * 0.5;
    lfo.connect(swell).connect(gain.gain);
    src.connect(hp).connect(lp).connect(gain).connect(master);
    src.start();
    lfo.start();
    room = { src, lfo, gain };
    return true;
  },
};

export default sfx;
