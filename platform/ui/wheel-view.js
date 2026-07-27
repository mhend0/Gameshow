// The wheel — canvas-drawn, physically-flavoured, and deterministic.
//
// `spin()` takes the landing wedge and the shape of the throw as arguments
// rather than rolling them itself. That matters because the wheel is drawn in
// two windows at once (the host's console and the TV): the console decides the
// result, broadcasts those numbers, and both windows run the identical animation
// — same spin, same ticks, same landing, no drift.
//
// Angles are degrees, clockwise, with 0° at the pointer (12 o'clock).

import { el } from "./ui.js";

const TAU = Math.PI * 2;
const rad = (deg) => (deg * Math.PI) / 180;

/**
 * @param {Object} opts
 * @param {import("../core/wheel.js").Wedge[]} opts.wedges
 * @param {()=>void} [opts.onTick]      A peg passed the pointer.
 * @param {(r:{index:number,wedge:Object})=>void} [opts.onSettle]
 * @param {boolean} [opts.showFlapper]
 */
export function createWheel({ wedges = [], onTick, onSettle, showFlapper = true } = {}) {
  ensureStyles();

  const canvas = el("canvas", { class: "wv-canvas" });
  const root = el("div", { class: "wv" }, [canvas]);
  const ctx = canvas.getContext("2d");

  let list = wedges.slice();
  let rot = 0;                 // current wheel rotation, degrees clockwise
  /**
   * The rotation label orientation is judged against — normally `rot`, but held
   * at the *landing* rotation for the length of a spin. See drawWedgeLabel.
   */
  let flipRef = 0;
  let spinning = false;
  let landed = null;           // index resting at the pointer, once settled
  let flapper = 0;             // 0…1 flick, decays after each peg
  let glow = 0;                // 0…1 halo on the landed wedge
  let raf = null;
  let size = 0;                // css px (square)

  /* ---------- sizing ---------- */
  const ro = new ResizeObserver(() => resize());
  ro.observe(root);
  function resize() {
    const box = root.getBoundingClientRect();
    // Fit the square to whichever side is tighter, so the wheel never spills out
    // of its column. A container with no height yet falls back to its width.
    const s = Math.max(80, Math.min(box.width || box.height, box.height || box.width));
    if (Math.abs(s - size) < 0.5) return;
    size = s;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(s * dpr);
    canvas.height = Math.round(s * dpr);
    canvas.style.width = canvas.style.height = `${s}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* ---------- drawing ---------- */
  function draw() {
    if (!size) return;
    const n = list.length || 1;
    const step = 360 / n;
    const cx = size / 2, cy = size / 2;
    const R = size / 2 - size * 0.012;      // outer rim
    const rimW = size * 0.045;
    const rOut = R - rimW;                  // wedge outer edge
    const rIn = rOut * 0.34;                // hub edge

    ctx.clearRect(0, 0, size, size);

    // rim
    const rimGrad = ctx.createLinearGradient(0, 0, size, size);
    rimGrad.addColorStop(0, "#f6dfa0");
    rimGrad.addColorStop(0.35, "#c9a24a");
    rimGrad.addColorStop(0.6, "#8a6a25");
    rimGrad.addColorStop(1, "#e6c882");
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.arc(cx, cy, rOut, 0, TAU, true);
    ctx.fillStyle = rimGrad;
    ctx.fill();

    // Wedges — canvas angles run from 3 o'clock, so shift by -90°.
    // Fills first, labels second: painting a label inside the loop lets the next
    // wedge's fill clip whatever hung over the edge of the last one.
    for (let i = 0; i < n; i++) {
      const w = list[i];
      const mid = i * step + rot;
      const a0 = rad(mid - step / 2 - 90);
      const a1 = rad(mid + step / 2 - 90);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rOut, a0, a1);
      ctx.closePath();

      const g = ctx.createRadialGradient(cx, cy, rIn * 0.8, cx, cy, rOut);
      g.addColorStop(0, shade(w.color, -0.16));
      g.addColorStop(0.72, w.color);
      g.addColorStop(1, shade(w.color, -0.28));
      ctx.fillStyle = g;
      ctx.fill();

      if (landed === i && glow > 0.01) {
        ctx.save();
        ctx.globalAlpha = glow * 0.55;
        ctx.fillStyle = "#fff6cf";
        ctx.fill();
        ctx.restore();
      }

      ctx.lineWidth = Math.max(1, size * 0.0035);
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.stroke();
    }
    // The +step/2 puts the changeover on a wedge boundary rather than on a wedge
    // centre. Without it the landing jitter could drop the winning wedge either
    // side of the line, so the label the room reads would face a different way
    // from one spin to the next.
    for (let i = 0; i < n; i++) {
      const flip = mod360(i * step + flipRef + step / 2) > 180;
      drawWedgeLabel(list[i], i * step + rot, rIn, rOut, step, flip);
    }

    // hub
    const hub = ctx.createRadialGradient(cx - rIn * 0.3, cy - rIn * 0.4, rIn * 0.1, cx, cy, rIn);
    hub.addColorStop(0, "#3a4460");
    hub.addColorStop(0.7, "#151a29");
    hub.addColorStop(1, "#0a0d16");
    ctx.beginPath();
    ctx.arc(cx, cy, rIn, 0, TAU);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, size * 0.008);
    ctx.strokeStyle = "#c9a24a";
    ctx.stroke();

    // pegs sit on the boundaries, so they ride the rim as it turns
    for (let i = 0; i < n; i++) {
      const a = rad(i * step + step / 2 + rot - 90);
      const px = cx + Math.cos(a) * (rOut + rimW * 0.45);
      const py = cy + Math.sin(a) * (rOut + rimW * 0.45);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.2, size * 0.0075), 0, TAU);
      ctx.fillStyle = "#fdf3d5";
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, size * 0.002);
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.stroke();
    }

    if (showFlapper) drawFlapper(cx, cy, R, rimW);
  }

  /**
   * Labels run *along* the radius, like the real wheel: a 15° wedge is far too
   * narrow to print across, but it's deep enough to print down. The size is then
   * bounded twice — by the depth of the wedge (how long the word can be) and by
   * its width at that radius (how tall the letters can be) — so "BANKRUPT" and
   * "900" both sit inside their own wedge without touching a neighbour.
   *
   * `flip` turns a label the right way up on the half of the wheel where radial
   * text would otherwise read upside down. The caller decides it against
   * `flipRef` rather than the live rotation, because judging it live puts the
   * changeover at 0° — which is exactly where the pointer is, so every label
   * visibly turned over at the moment it arrived at the selector.
   */
  function drawWedgeLabel(w, mid, rIn, rOut, step, flip) {
    const cx = size / 2, cy = size / 2;
    const span = rOut - rIn;
    const rText = rIn + span * 0.52;
    const maxLen = span * 0.86;                                 // room down the wedge
    const chord = 2 * rText * Math.sin(rad(step) / 2);          // room across it
    const FAMILY = `"Helvetica Neue",Helvetica,Arial,sans-serif`;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad(mid));            // wedge now points up
    ctx.translate(0, -rText);
    ctx.rotate(-Math.PI / 2);        // and the text runs up it
    // The real wheel lies flat, so every label faces its reader. Ours is
    // vertical, where "always outward" would leave one half upside down.
    if (flip) ctx.rotate(Math.PI);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = w.ink;

    let font = Math.min(size * 0.055, chord * 0.74);
    ctx.font = `800 ${font}px ${FAMILY}`;
    const width = ctx.measureText(w.label).width;
    if (width > maxLen) {
      font *= maxLen / width;
      ctx.font = `800 ${font}px ${FAMILY}`;
    }
    ctx.fillText(w.label, 0, 0);
    ctx.restore();
  }

  function drawFlapper(cx, cy, R, rimW) {
    const lean = flapper * 15;               // flicked aside by the peg it just cleared
    ctx.save();
    ctx.translate(cx, cy - R - rimW * 0.15);
    ctx.rotate(rad(lean));
    const h = size * 0.085, w = size * 0.028;
    const g = ctx.createLinearGradient(-w, 0, w, h);
    g.addColorStop(0, "#fff");
    g.addColorStop(0.5, "#d9dee9");
    g.addColorStop(1, "#8e97a8");
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = size * 0.02;
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.003);
    ctx.strokeStyle = "#5c6373";
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- spin ---------- */
  /**
   * Throw the wheel. Every input that shapes the animation is explicit, so the
   * same call in another window produces the same spin frame-for-frame.
   * @param {Object} o
   * @param {number} o.index      Wedge to land on.
   * @param {number} [o.turns]    Whole revolutions before the landing.
   * @param {number} [o.duration] ms.
   * @param {number} [o.jitter]   −1…1 — where in the wedge it rests, so it
   *                              doesn't always stop dead centre.
   * @returns {Promise<{index:number, wedge:Object}>}
   */
  function spin({ index = 0, turns = 4, duration = 4600, jitter = 0 } = {}) {
    const n = list.length || 1;
    const step = 360 / n;
    const target = ((index % n) + n) % n;

    // Rest angle that puts `target` under the pointer, plus a little offset
    // inside the wedge. Kept well clear of the boundary so the landing is never
    // ambiguous, even after the settle wobble below.
    const offset = Math.max(-1, Math.min(1, jitter)) * (step * 0.2);
    const finalRot = rot + turns * 360 + mod360(-target * step - offset - rot);

    const from = rot;
    const sweep = finalRot - from;
    // The flapper's last peg should clear late, so the wheel creeps the final
    // couple of degrees — that pause is where the suspense lives.
    const overshoot = step * 0.17;

    spinning = true;
    landed = null;
    glow = 0;
    // Orient every label for where it will come to rest, and leave it there for
    // the whole spin. Nothing turns over mid-flight, least of all at the pointer.
    flipRef = finalRot;
    let pegsPassed = pegCount(from, step);

    return new Promise((resolve) => {
      const t0 = performance.now();
      const settleMs = 420;

      const frame = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        let done = false;
        if (t < 1) {
          rot = from + sweep * easeSpin(t) + overshoot * overshootCurve(t);
        } else {
          // Settle: a damped swing back onto the wedge, as the flapper gives up
          // its last peg. Starts exactly where the spin ended, so there's no jump.
          const s = Math.min(1, (now - t0 - duration) / settleMs);
          rot = finalRot + overshoot * Math.cos(s * Math.PI * 1.5) * (1 - s);
          done = s >= 1;
          if (done) rot = finalRot;
        }

        const pegs = pegCount(rot, step);
        if (pegs > pegsPassed) { pegsPassed = pegs; flapper = 1; onTick && onTick(); }
        flapper *= 0.82;

        draw();

        if (!done) { raf = requestAnimationFrame(frame); return; }
        spinning = false;
        landed = target;
        raf = requestAnimationFrame(glowIn);
        const wedge = list[target];
        onSettle && onSettle({ index: target, wedge });
        resolve({ index: target, wedge });
      };
      raf = requestAnimationFrame(frame);
    });
  }

  /** After landing, ease the halo up so the result reads without a hard cut. */
  function glowIn() {
    glow = Math.min(1, glow + 0.06);
    flapper *= 0.8;
    draw();
    if (glow < 1) raf = requestAnimationFrame(glowIn);
  }

  /** Park the wheel on a wedge with no animation (used when a window joins late). */
  function setResting(index) {
    const n = list.length || 1;
    const step = 360 / n;
    if (index == null) { landed = null; glow = 0; }
    else {
      const target = ((index % n) + n) % n;
      rot = mod360(-target * step);
      landed = target;
      glow = 1;
    }
    flipRef = rot;
    draw();
  }

  function setWedges(next) {
    list = (next || []).slice();
    landed = null;
    draw();
  }

  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
    root.remove();
  }

  resize();
  return {
    el: root, canvas, spin, setWedges, setResting, draw,
    get spinning() { return spinning; },
    get wedges() { return list.slice(); },
    destroy,
  };
}

/* ---------------------------------------------------------------- helpers */

const mod360 = (d) => ((d % 360) + 360) % 360;

/** Pegs that have passed the pointer by rotation `r` (monotone in `r`). */
const pegCount = (r, step) => Math.floor((r + step / 2) / step);

/**
 * Deceleration curve — two forces blended.
 *
 * A plain quintic ease-out looks right for half a second and then dies: it has
 * covered 99.97% of the distance by 80% of the way through, so the wheel sits
 * frozen for the last second and a half and there is nothing to anticipate.
 * A plain quadratic (constant friction) keeps running but has no throw to it.
 *
 * Blending a hard initial kick with a gentler friction term gives both: the
 * wheel leaves the hand at ~5× its average speed, and still ticks over eight
 * wedges in the final two seconds, each one slower than the last.
 */
function easeSpin(t) {
  const kick = 1 - Math.pow(1 - t, 8);      // the throw
  const drift = 1 - Math.pow(1 - t, 1.8);   // friction letting it run on
  return kick * 0.55 + drift * 0.45;
}

/** A late nudge past the resting angle, so the final peg clicks over at the end. */
function overshootCurve(t) {
  if (t < 0.82) return 0;
  const u = (t - 0.82) / 0.18;
  return Math.sin(u * Math.PI * 0.5);
}

/** Lighten (+) or darken (−) a hex colour. */
function shade(hex, amt) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const f = (h) => {
    const v = parseInt(h, 16);
    const out = amt >= 0 ? v + (255 - v) * amt : v * (1 + amt);
    return Math.max(0, Math.min(255, Math.round(out))).toString(16).padStart(2, "0");
  };
  return `#${f(m[1])}${f(m[2])}${f(m[3])}`;
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", {
    id: "wv-styles",
    html: `
    .wv{ position:relative; width:100%; height:100%; min-height:0; display:grid; place-items:center; }
    .wv-canvas{ display:block; max-width:100%; max-height:100%; }
    `,
  }));
}
