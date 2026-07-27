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
};

export default sfx;
