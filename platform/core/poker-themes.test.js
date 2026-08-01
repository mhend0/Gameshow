// Tests for the theme registry — run with `node --test platform/core/*.test.js`.
//
// These are mostly contract tests. The point of the theme system is that adding
// one is trivial, and the risk that comes with "trivial" is a theme that quietly
// omits a variable and renders black ink on a black card in front of a room. So
// the suite asserts the shape every theme must have, and will fail on the new
// one rather than on the old ones.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_THEMES, TABLE_THEMES, CARD_VARS, TABLE_VARS,
  DEFAULT_CARD_THEME, DEFAULT_TABLE_THEME, getCardTheme, getTableTheme,
} from "./poker-themes.js";

/** Runs the same shape checks over either registry. */
function describeRegistry(label, themes, requiredVars, defaultKey, lookup) {
  describe(label, () => {
    test("has themes to choose from", () => {
      assert.ok(themes.length >= 2);
    });

    test("every theme defines every required variable, with a non-empty value", () => {
      for (const theme of themes) {
        for (const name of requiredVars) {
          const value = theme.vars[name];
          assert.ok(value !== undefined, `${theme.key} is missing ${name}`);
          assert.ok(String(value).trim().length > 0, `${theme.key} has an empty ${name}`);
        }
      }
    });

    test("no theme defines a variable outside the contract", () => {
      // Catches a typo like `--card-inks`, which would otherwise be a silent no-op.
      const allowed = new Set(requiredVars);
      for (const theme of themes) {
        for (const name of Object.keys(theme.vars)) {
          assert.ok(allowed.has(name), `${theme.key} defines unknown variable ${name}`);
        }
      }
    });

    test("every variable is a custom property", () => {
      for (const theme of themes) {
        for (const name of Object.keys(theme.vars)) {
          assert.ok(name.startsWith("--"), `${theme.key}: ${name} is not a custom property`);
        }
      }
    });

    test("keys and names are unique and human-facing names are set", () => {
      assert.equal(new Set(themes.map((t) => t.key)).size, themes.length, "duplicate key");
      assert.equal(new Set(themes.map((t) => t.name)).size, themes.length, "duplicate name");
      for (const theme of themes) assert.ok(theme.name && theme.name.trim(), `${theme.key} has no name`);
    });

    test("keys are storage-safe slugs", () => {
      for (const theme of themes) {
        assert.match(theme.key, /^[a-z0-9-]+$/, `${theme.key} is not a slug`);
      }
    });

    test("the default key actually exists", () => {
      assert.ok(themes.some((t) => t.key === defaultKey));
    });

    test("lookup finds a theme, and falls back to the default rather than undefined", () => {
      for (const theme of themes) assert.equal(lookup(theme.key).key, theme.key);
      assert.equal(lookup("no-such-theme").key, defaultKey);
      assert.equal(lookup(undefined).key, defaultKey);
      assert.equal(lookup("").key, defaultKey);
    });
  });
}

describeRegistry("card themes", CARD_THEMES, CARD_VARS, DEFAULT_CARD_THEME, getCardTheme);
describeRegistry("table themes", TABLE_THEMES, TABLE_VARS, DEFAULT_TABLE_THEME, getTableTheme);

describe("the themes named in the brief are all present", () => {
  test("cards", () => {
    for (const key of ["classic", "modern", "gold", "western", "minimal", "neon", "dark", "vintage"]) {
      assert.ok(CARD_THEMES.some((t) => t.key === key), `missing card theme ${key}`);
    }
  });
  test("tables", () => {
    for (const key of ["casino-green", "oak-timber", "western-saloon", "neon-vegas", "black-luxury", "red-velvet"]) {
      assert.ok(TABLE_THEMES.some((t) => t.key === key), `missing table theme ${key}`);
    }
  });
});

describe("readability", () => {
  test("a card's ink is never the same colour as its face", () => {
    // The cheapest possible guard against an unreadable card.
    for (const theme of CARD_THEMES) {
      const face = theme.vars["--card-face"];
      assert.notEqual(theme.vars["--card-ink"], face, `${theme.key}: ink matches face`);
      assert.notEqual(theme.vars["--card-red"], face, `${theme.key}: red matches face`);
    }
  });

  test("black and red suits are always different colours", () => {
    for (const theme of CARD_THEMES) {
      assert.notEqual(theme.vars["--card-ink"], theme.vars["--card-red"], `${theme.key}: suits indistinguishable`);
    }
  });
});
