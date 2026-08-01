// Tests for the chip model — run with `node --test platform/core/*.test.js`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CHIP_DENOMS, chipBreakdown, chipColumns, formatChips } from "./poker-chips.js";

const total = (parts) => parts.reduce((t, p) => t + p.denom.value * p.count, 0);

describe("denominations", () => {
  test("are listed highest first", () => {
    const values = CHIP_DENOMS.map((d) => d.value);
    assert.deepEqual(values, [...values].sort((a, b) => b - a));
  });

  test("each divides evenly into the next one up — which is what makes greedy optimal", () => {
    for (let i = 0; i < CHIP_DENOMS.length - 1; i++) {
      const bigger = CHIP_DENOMS[i].value;
      const smaller = CHIP_DENOMS[i + 1].value;
      assert.equal(bigger % smaller, 0, `${bigger} is not a multiple of ${smaller}`);
    }
  });

  test("every denomination has a distinct value, name and colour", () => {
    for (const key of ["value", "name", "face"]) {
      const seen = new Set(CHIP_DENOMS.map((d) => d[key]));
      assert.equal(seen.size, CHIP_DENOMS.length, `duplicate ${key}`);
    }
  });
});

describe("chipBreakdown", () => {
  test("adds back up to exactly the amount", () => {
    for (const amount of [1, 4, 25, 50, 75, 137, 600, 1200, 4800, 20000, 98765]) {
      assert.equal(total(chipBreakdown(amount)), amount, `broke ${amount} wrong`);
    }
  });

  test("uses the largest chips first", () => {
    const parts = chipBreakdown(1200);
    assert.deepEqual(parts.map((p) => [p.denom.value, p.count]), [[1000, 1], [100, 2]]);
  });

  test("never uses more of a denomination than the next one up would absorb", () => {
    // e.g. never five 100s where a 500 would do.
    for (let amount = 1; amount <= 3000; amount += 7) {
      const parts = chipBreakdown(amount);
      for (let i = 1; i < parts.length; i++) {
        const bigger = CHIP_DENOMS[CHIP_DENOMS.indexOf(parts[i].denom) - 1];
        assert.ok(parts[i].denom.value * parts[i].count < bigger.value,
          `${amount}: ${parts[i].count}×${parts[i].denom.value} should have been coloured up`);
      }
    }
  });

  test("nothing to show for nothing", () => {
    assert.deepEqual(chipBreakdown(0), []);
    assert.deepEqual(chipBreakdown(-50), []);
    assert.deepEqual(chipBreakdown(NaN), []);
    assert.deepEqual(chipBreakdown(undefined), []);
  });

  test("fractions round down rather than inventing a chip", () => {
    assert.equal(total(chipBreakdown(25.9)), 25);
  });
});

describe("chipColumns", () => {
  test("splits a tall pile into several stacks nobody could knock over", () => {
    // 20,000 is four 5k stacks of… no: 4×5000, one column of 4.
    const cols = chipColumns(20000);
    assert.ok(cols.every((c) => c.count <= 5));
  });

  test("a big round number becomes multiple full stacks", () => {
    const cols = chipColumns(50000, { maxPerColumn: 5, maxColumns: 5 });
    // 10 × 5000 → two stacks of five.
    assert.deepEqual(cols.map((c) => [c.denom.value, c.count]), [[5000, 5], [5000, 5]]);
  });

  test("one stack per denomination when the counts are small", () => {
    assert.deepEqual(
      chipColumns(4800).map((c) => [c.denom.value, c.count]),
      [[1000, 4], [500, 1], [100, 3]],
    );
  });

  test("never draws more stacks than it was allowed", () => {
    for (const amount of [137, 4800, 98765, 1234567]) {
      assert.ok(chipColumns(amount, { maxColumns: 4 }).length <= 4, `too many stacks for ${amount}`);
    }
  });

  test("small change is what gets dropped, not the big chips", () => {
    // 5555 = 5000 + 500 + 25×2 + 5 → capped at two stacks keeps the valuable end.
    const cols = chipColumns(5555, { maxColumns: 2 });
    assert.deepEqual(cols.map((c) => c.denom.value), [5000, 500]);
  });

  test("bigger amounts never draw fewer chips than smaller ones", () => {
    // The pile has to read as "more" from across a room.
    const chipsFor = (n) => chipColumns(n).reduce((t, c) => t + c.count, 0);
    assert.ok(chipsFor(25) <= chipsFor(500));
    assert.ok(chipsFor(500) <= chipsFor(20000));
  });

  test("nothing to draw for nothing", () => {
    assert.deepEqual(chipColumns(0), []);
  });
});

describe("formatChips", () => {
  test("groups thousands", () => {
    assert.equal(formatChips(12500), "12,500");
    assert.equal(formatChips(0), "0");
    assert.equal(formatChips(999), "999");
  });

  test("copes with junk rather than printing NaN on a TV", () => {
    assert.equal(formatChips(undefined), "0");
    assert.equal(formatChips(null), "0");
    assert.equal(formatChips("1500"), "1,500");
  });
});
