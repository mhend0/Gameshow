// Chips — denominations, and how an amount becomes a pile of them.
//
// Pure and DOM-free so the arithmetic can be tested on its own, and so every
// surface that draws chips (the TV table, the host console, a future phone
// view) breaks the same number into the same chips rather than each inventing
// its own. The colours live here too: they're data about a denomination, not
// styling of a particular screen, and phase 8's table themes will override
// them by denomination rather than by CSS selector.
//
// A note on colour and accessibility: the colour of a chip is never the only
// thing carrying its value. Every stack is drawn beside its exact total, and
// `chipColumns` groups by denomination so the *shape* of a pile (how many
// stacks, how tall) also encodes the amount. The optional value labels on the
// TV are a third channel on top of those two.

/**
 * @typedef {Object} ChipDenom
 * @property {number} value
 * @property {string} name  Short label printed on the chip ("1k", "25").
 * @property {string} face  Fill colour.
 * @property {string} edge  Rim / edge-spot colour.
 */

/**
 * Standard casino denominations, highest first. Greedy breakdown is optimal
 * for this set because every denomination divides evenly into the next one up.
 * @type {ChipDenom[]}
 */
export const CHIP_DENOMS = [
  { value: 5000, name: "5k",  face: "#f97316", edge: "#7c2d12" },
  { value: 1000, name: "1k",  face: "#ffcf5c", edge: "#a8791a" },
  { value: 500,  name: "500", face: "#7a5cff", edge: "#43309e" },
  { value: 100,  name: "100", face: "#23262f", edge: "#000000" },
  { value: 25,   name: "25",  face: "#34d399", edge: "#18795a" },
  { value: 5,    name: "5",   face: "#f04438", edge: "#8c1d18" },
  { value: 1,    name: "1",   face: "#f4f6fb", edge: "#9aa3b8" },
];

/**
 * The exact chips making up an amount, biggest denomination first.
 *
 * Exact, with no display cap — callers that need to *draw* a manageable pile
 * should use `chipColumns`, which is where the visual limits live. Keeping
 * this one exact means it can be trusted for arithmetic and tested as such.
 *
 * @param {number} amount
 * @returns {{denom: ChipDenom, count: number}[]}
 */
export function chipBreakdown(amount) {
  let left = Math.floor(Number(amount));
  if (!Number.isFinite(left) || left <= 0) return [];
  const out = [];
  for (const denom of CHIP_DENOMS) {
    if (left < denom.value) continue;
    const count = Math.floor(left / denom.value);
    left -= count * denom.value;
    out.push({ denom, count });
  }
  return out;
}

/**
 * The same amount arranged the way it would sit on a felt: a row of separate
 * stacks, each one denomination, none of them absurdly tall.
 *
 * A dealer never builds one tower of two hundred chips — they build several
 * short stacks, and that's also what makes a big bet *read* as big from across
 * a room. Any change left over past `maxColumns` is dropped from the tail,
 * which is the small stuff a dealer would colour up first; the printed total
 * beside the pile is what stays exact.
 *
 * @param {number} amount
 * @param {{maxPerColumn?:number, maxColumns?:number}} [opts]
 * @returns {{denom: ChipDenom, count: number}[]} One entry per drawn stack.
 */
export function chipColumns(amount, { maxPerColumn = 5, maxColumns = 5 } = {}) {
  const columns = [];
  for (const { denom, count } of chipBreakdown(amount)) {
    let left = count;
    while (left > 0 && columns.length < maxColumns) {
      const take = Math.min(left, maxPerColumn);
      columns.push({ denom, count: take });
      left -= take;
    }
    if (columns.length >= maxColumns) break;
  }
  return columns;
}

/** 12500 → "12,500". One place, so every surface counts chips the same way. */
export function formatChips(n) {
  return Number(Math.round(Number(n) || 0)).toLocaleString("en-US");
}
