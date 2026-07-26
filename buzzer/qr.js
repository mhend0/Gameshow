/* qr.js — self-contained QR encoder (byte mode, EC level M, versions 1–10).
   No network and no dependencies: the join code has to reach the TV even when
   the venue's wifi blocks CDNs. Exposes window.QR = { matrix, canvas, svg }.

   Copy of platform/ui/qr.js — buzzer/ is its own Vercel deploy root, so it
   can't reach files outside this folder. Keep the two in sync. */
(function (global) {
  "use strict";

  /* ---------- GF(256), primitive polynomial 0x11d ---------- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* ---------- per-version tables, EC level M ----------
     ecPerBlock, then [blockCount, dataCodewordsPerBlock] groups. */
  const EC_M = {
    1:  [10, [[1, 16]]],
    2:  [16, [[1, 28]]],
    3:  [26, [[1, 44]]],
    4:  [18, [[2, 32]]],
    5:  [24, [[2, 43]]],
    6:  [16, [[4, 27]]],
    7:  [18, [[4, 31]]],
    8:  [22, [[2, 38], [2, 39]]],
    9:  [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]],
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const dataCodewords = (v) => EC_M[v][1].reduce((s, g) => s + g[0] * g[1], 0);

  /* ---------- Reed–Solomon ---------- */
  function genPoly(n) {
    let p = [1];
    for (let i = 0; i < n; i++) {
      const np = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) { np[j] ^= p[j]; np[j + 1] ^= mul(p[j], EXP[i]); }
      p = np;
    }
    return p;
  }
  function ecBytes(data, n) {
    const g = genPoly(n), res = data.concat(new Array(n).fill(0));
    for (let i = 0; i < data.length; i++) {
      const c = res[i];
      if (!c) continue;
      for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c);
    }
    return res.slice(data.length);
  }

  /* ---------- BCH check bits ---------- */
  function formatBits(mask) {              // EC level M = 0b00
    const d = mask;                        // (levelBits << 3) | mask, levelBits = 0
    let v = d << 10;
    for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0x537 << (i - 10);
    return ((d << 10) | v) ^ 0x5412;
  }
  function versionBits(ver) {
    let v = ver << 12;
    for (let i = 17; i >= 12; i--) if ((v >> i) & 1) v ^= 0x1f25 << (i - 12);
    return (ver << 12) | v;
  }

  /* ---------- data encoding ---------- */
  function encodeData(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 0;
    for (let v = 1; v <= 10; v++) {
      const cc = v < 10 ? 8 : 16;
      if (4 + cc + bytes.length * 8 <= dataCodewords(v) * 8) { ver = v; break; }
    }
    if (!ver) throw new Error("QR: text too long (max ~213 bytes)");

    const total = dataCodewords(ver), cap = total * 8, bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(4, 4);                                   // byte mode
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);   // terminator
    while (bits.length % 8) bits.push(0);

    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      cw.push(v);
    }
    const PAD = [0xec, 0x11];
    while (cw.length < total) cw.push(PAD[(cw.length - bits.length / 8) % 2]);

    // split into blocks, then interleave data and EC codewords
    const ecLen = EC_M[ver][0], blocks = [];
    let off = 0;
    EC_M[ver][1].forEach(g => {
      for (let i = 0; i < g[0]; i++) {
        const d = cw.slice(off, off + g[1]); off += g[1];
        blocks.push({ d, e: ecBytes(d, ecLen) });
      }
    });
    const out = [], maxD = Math.max.apply(null, blocks.map(b => b.d.length));
    for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach(b => out.push(b.e[i]));
    return { ver, out };
  }

  /* ---------- matrix ---------- */
  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => ((r >> 1) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];

  function buildMatrix(text) {
    const { ver, out } = encodeData(text);
    const size = ver * 4 + 17;
    const m = [], fn = [];
    for (let i = 0; i < size; i++) { m.push(new Array(size).fill(0)); fn.push(new Array(size).fill(false)); }
    const set = (r, c, v) => { m[r][c] = v ? 1 : 0; fn[r][c] = true; };

    // finder patterns + separators
    [[0, 0], [size - 7, 0], [0, size - 7]].forEach(p => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = p[0] + r, cc = p[1] + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(rr, cc, on);
      }
    });
    // timing patterns
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    // alignment patterns
    const ap = ALIGN[ver];
    ap.forEach(r => ap.forEach(c => {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) return;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }));
    // dark module + reserved format areas
    set(size - 8, 8, true);
    for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
    for (let i = 0; i < 8; i++) { if (!fn[8][size - 1 - i]) set(8, size - 1 - i, false); if (!fn[size - 1 - i][8]) set(size - 1 - i, 8, false); }
    // version info (v7+)
    if (ver >= 7) {
      const vb = versionBits(ver);
      for (let i = 0; i < 18; i++) {
        const bit = (vb >> i) & 1, a = Math.floor(i / 3), b = size - 11 + (i % 3);
        set(a, b, bit); set(b, a, bit);
      }
    }

    // data, zigzagging up/down from the bottom-right
    let bitIdx = 0, row = size - 1, inc = -1;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (fn[row][cc]) continue;
          let dark = 0;
          if (bitIdx < out.length * 8) dark = (out[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
          m[row][cc] = dark;
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }

    // pick the mask with the lowest penalty
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const t = m.map(r => r.slice());
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
        if (!fn[r][c] && MASKS[mask](r, c)) t[r][c] ^= 1;
      const fb = formatBits(mask);
      for (let i = 0; i < 15; i++) {
        const bit = (fb >> i) & 1;
        if (i < 6) t[i][8] = bit; else if (i < 8) t[i + 1][8] = bit; else t[size - 15 + i][8] = bit;
        if (i < 8) t[8][size - 1 - i] = bit; else if (i < 9) t[8][15 - i] = bit; else t[8][14 - i] = bit;
      }
      const s = penalty(t, size);
      if (s < bestScore) { bestScore = s; best = t; }
    }
    return best;
  }

  function penalty(m, size) {
    let score = 0;
    // rule 1 — runs of 5+ same-colour modules in a row or column
    for (let i = 0; i < size; i++) {
      for (const line of [m[i], m.map(r => r[i])]) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          if (line[j] === line[j - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
          else run = 1;
        }
      }
    }
    // rule 2 — 2x2 blocks of one colour
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    // rule 3 — finder-like 1:1:3:1:1 patterns
    const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const hit = (line, at, pat) => pat.every((v, k) => line[at + k] === v);
    for (let i = 0; i < size; i++) {
      const rowLine = m[i], colLine = m.map(r => r[i]);
      for (let j = 0; j + 11 <= size; j++) {
        if (hit(rowLine, j, P1) || hit(rowLine, j, P2)) score += 40;
        if (hit(colLine, j, P1) || hit(colLine, j, P2)) score += 40;
      }
    }
    // rule 4 — deviation from a 50/50 light/dark balance
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return score;
  }

  /* ---------- renderers ---------- */
  function canvas(text, px, opts) {
    const o = opts || {}, quiet = o.margin == null ? 4 : o.margin;
    const m = buildMatrix(text), n = m.length, total = n + quiet * 2;
    const scale = Math.max(1, Math.floor((px || 300) / total));
    const cv = o.canvas || document.createElement("canvas");
    cv.width = cv.height = total * scale;
    const g = cv.getContext("2d");
    g.fillStyle = o.light || "#fff";
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = o.dark || "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (m[r][c]) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    return cv;
  }
  function svg(text, px, opts) {
    const o = opts || {}, quiet = o.margin == null ? 4 : o.margin;
    const m = buildMatrix(text), n = m.length, total = n + quiet * 2;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (m[r][c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px || 300}" height="${px || 300}" shape-rendering="crispEdges">`
      + `<rect width="${total}" height="${total}" fill="${o.light || "#fff"}"/><path d="${d}" fill="${o.dark || "#000"}"/></svg>`;
  }

  global.QR = { matrix: buildMatrix, canvas, svg };
})(window);
