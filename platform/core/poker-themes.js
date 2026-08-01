// Card and table themes.
//
// A theme is nothing but a bag of CSS custom properties. Every colour the
// table draws with is already a variable (see poker-table.js), so a theme
// never needs a selector of its own and adding one is a matter of appending
// an entry to one of the arrays below — that's the whole extension story.
//
// The required variable names are declared as contracts (`CARD_VARS`,
// `TABLE_VARS`) and asserted in the tests, so a new theme that forgets one
// fails loudly at test time instead of rendering a black-on-black card at a
// game night.
//
// Deliberately data-only and DOM-free: the same definitions drive the live
// table, the swatches in the settings panel, and the tests.

/**
 * @typedef {Object} Theme
 * @property {string} key   Stable id, stored in settings.
 * @property {string} name  What a human picks in the settings screen.
 * @property {Record<string,string>} vars  CSS custom properties to apply.
 */

/** Every variable a card theme must define. */
export const CARD_VARS = [
  "--card-face",    // face background (any CSS background value)
  "--card-ink",     // black-suit pips and ranks
  "--card-red",     // red-suit pips and ranks
  "--card-edge",    // hairline around the face
  "--card-back",    // the back design
  "--card-ring",    // inner border on the back
  "--card-radius",  // corner rounding of a hole card; board cards scale up
];

/** Every variable a table theme must define. */
export const TABLE_VARS = [
  "--felt",        // main felt colour
  "--felt-2",      // felt colour at the rim, for the lit-from-above gradient
  "--rail",        // padded rail
  "--rail-2",      // outer edge of the rail
  "--gold",        // pot totals, the button, winner highlights
  "--ink",         // player names
  "--chip-glow",   // ambience picked up by chips (never their denomination colour)
  "--stage-1",     // page backdrop behind the table, near
  "--stage-2",     // page backdrop, far
];

/* ============================================================= card themes */

/** @type {Theme[]} */
export const CARD_THEMES = [
  {
    key: "classic", name: "Classic Bicycle",
    vars: {
      "--card-face": "linear-gradient(170deg,#ffffff,#e9edf5)",
      "--card-ink": "#14161c",
      "--card-red": "#e0313f",
      "--card-edge": "rgba(0,0,0,.14)",
      "--card-back": "repeating-linear-gradient(45deg,#1c4fd6 0 .5cqw,#163fae .5cqw 1cqw)",
      "--card-ring": "rgba(255,255,255,.5)",
      "--card-radius": ".45cqw",
    },
  },
  {
    key: "modern", name: "Modern Casino",
    vars: {
      "--card-face": "linear-gradient(180deg,#ffffff,#f4f6fa)",
      "--card-ink": "#0b0d12",
      "--card-red": "#f5333f",
      "--card-edge": "rgba(0,0,0,.1)",
      "--card-back": "linear-gradient(135deg,#111827 0%,#1f2937 50%,#111827 100%)",
      "--card-ring": "rgba(245,51,63,.75)",
      "--card-radius": ".3cqw",
    },
  },
  {
    key: "gold", name: "Gold Luxury",
    vars: {
      "--card-face": "linear-gradient(170deg,#fffaf0,#f2e6cd)",
      "--card-ink": "#2a2109",
      "--card-red": "#b3122b",
      "--card-edge": "rgba(168,121,26,.5)",
      "--card-back": "repeating-linear-gradient(135deg,#1a1408 0 .45cqw,#2a2109 .45cqw .9cqw)",
      "--card-ring": "#ffcf5c",
      "--card-radius": ".5cqw",
    },
  },
  {
    key: "western", name: "Western",
    vars: {
      "--card-face": "linear-gradient(170deg,#fbf1dc,#eddbb8)",
      "--card-ink": "#3b2a17",
      "--card-red": "#b0442a",
      "--card-edge": "rgba(90,64,36,.4)",
      "--card-back": "repeating-linear-gradient(90deg,#7a4a24 0 .4cqw,#5e3818 .4cqw .8cqw)",
      "--card-ring": "#e8c98d",
      "--card-radius": ".4cqw",
    },
  },
  {
    key: "minimal", name: "Minimal",
    vars: {
      "--card-face": "#ffffff",
      "--card-ink": "#1a1a1a",
      "--card-red": "#d92d20",
      "--card-edge": "rgba(0,0,0,.18)",
      "--card-back": "#d5dae3",
      "--card-ring": "rgba(0,0,0,.15)",
      "--card-radius": ".22cqw",
    },
  },
  {
    key: "neon", name: "Neon",
    vars: {
      "--card-face": "linear-gradient(170deg,#12142a,#0a0b18)",
      "--card-ink": "#5eead4",
      "--card-red": "#ff4fa3",
      "--card-edge": "rgba(94,234,212,.45)",
      "--card-back": "repeating-linear-gradient(45deg,#2a1150 0 .5cqw,#3b1a6b .5cqw 1cqw)",
      "--card-ring": "#ff4fa3",
      "--card-radius": ".45cqw",
    },
  },
  {
    key: "dark", name: "Dark Mode",
    vars: {
      "--card-face": "linear-gradient(170deg,#2b2f3a,#1b1e26)",
      "--card-ink": "#eef1f7",
      "--card-red": "#ff8087",
      "--card-edge": "rgba(255,255,255,.16)",
      "--card-back": "repeating-linear-gradient(45deg,#0e1016 0 .5cqw,#181c25 .5cqw 1cqw)",
      "--card-ring": "rgba(255,255,255,.3)",
      "--card-radius": ".45cqw",
    },
  },
  {
    key: "vintage", name: "Vintage",
    vars: {
      "--card-face": "linear-gradient(170deg,#f0e4c8,#dcc9a2)",
      "--card-ink": "#42382a",
      "--card-red": "#a33b2a",
      "--card-edge": "rgba(66,56,42,.35)",
      "--card-back": "repeating-linear-gradient(60deg,#6d5539 0 .5cqw,#54402a .5cqw 1cqw)",
      "--card-ring": "rgba(240,228,200,.55)",
      "--card-radius": ".5cqw",
    },
  },
];

/* ============================================================ table themes */

/** @type {Theme[]} */
export const TABLE_THEMES = [
  {
    key: "casino-green", name: "Casino Green",
    vars: {
      "--felt": "#0b6b3f", "--felt-2": "#053f24",
      "--rail": "#3a2116", "--rail-2": "#1c0f0a",
      "--gold": "#ffcf5c", "--ink": "#f4f6fb",
      "--chip-glow": "rgba(0,0,0,0)",
      "--stage-1": "#0d3a24", "--stage-2": "#04070c",
    },
  },
  {
    key: "oak-timber", name: "Oak Timber",
    vars: {
      "--felt": "#2f6b4f", "--felt-2": "#17392a",
      "--rail": "#8a5a2b", "--rail-2": "#4a2f14",
      "--gold": "#ffd98a", "--ink": "#fbf6ec",
      "--chip-glow": "rgba(0,0,0,0)",
      "--stage-1": "#2a1d10", "--stage-2": "#0a0705",
    },
  },
  {
    key: "western-saloon", name: "Western Saloon",
    vars: {
      "--felt": "#7d5230", "--felt-2": "#43291580",
      "--rail": "#5e3818", "--rail-2": "#2b190a",
      "--gold": "#f0c46a", "--ink": "#fdf3e2",
      "--chip-glow": "rgba(0,0,0,0)",
      "--stage-1": "#3a2412", "--stage-2": "#0c0703",
    },
  },
  {
    key: "neon-vegas", name: "Neon Vegas",
    vars: {
      "--felt": "#123a6b", "--felt-2": "#0a1330",
      "--rail": "#2a1150", "--rail-2": "#120726",
      "--gold": "#5eead4", "--ink": "#eaf6ff",
      "--chip-glow": "rgba(94,234,212,.45)",
      "--stage-1": "#2a1150", "--stage-2": "#05060f",
    },
  },
  {
    key: "black-luxury", name: "Black Luxury",
    vars: {
      "--felt": "#23262f", "--felt-2": "#0d0f14",
      "--rail": "#15171d", "--rail-2": "#000000",
      "--gold": "#ffcf5c", "--ink": "#f7f8fb",
      "--chip-glow": "rgba(255,207,92,.28)",
      "--stage-1": "#1a1c22", "--stage-2": "#000000",
    },
  },
  {
    key: "red-velvet", name: "Red Velvet",
    vars: {
      "--felt": "#8c1d2c", "--felt-2": "#4a0c16",
      "--rail": "#2b1a0f", "--rail-2": "#120a05",
      "--gold": "#ffd98a", "--ink": "#fff3f4",
      "--chip-glow": "rgba(0,0,0,0)",
      "--stage-1": "#3d0d16", "--stage-2": "#0a0305",
    },
  },
];

/* =================================================================== lookup */

export const DEFAULT_CARD_THEME = "classic";
export const DEFAULT_TABLE_THEME = "casino-green";

const byKey = (list, key, fallback) =>
  list.find((t) => t.key === key) || list.find((t) => t.key === fallback);

/** A card theme by key, falling back to the default rather than to nothing. */
export const getCardTheme = (key) => byKey(CARD_THEMES, key, DEFAULT_CARD_THEME);
/** A table theme by key, falling back to the default rather than to nothing. */
export const getTableTheme = (key) => byKey(TABLE_THEMES, key, DEFAULT_TABLE_THEME);
