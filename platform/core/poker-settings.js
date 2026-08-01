// Host-configurable poker preferences.
//
// Same shape as the Feud's settings (see feud.js): one persisted object, read
// through a loader that fills in anything the host has never touched, so a
// setting added later can't break a saved blob written before it existed.

import { Value } from "./store.js";
import { DEFAULT_CARD_THEME, DEFAULT_TABLE_THEME, getCardTheme, getTableTheme } from "./poker-themes.js";

/**
 * @typedef {Object} PokerSettings
 * @property {string} cardTheme   Key into CARD_THEMES.
 * @property {string} tableTheme  Key into TABLE_THEMES.
 * @property {boolean} chipLabels Print denominations on chip faces.
 * @property {boolean} dealerSpeech  Whether the dealer talks.
 */
/** @type {PokerSettings} */
export const POKER_DEFAULTS = {
  cardTheme: DEFAULT_CARD_THEME,
  tableTheme: DEFAULT_TABLE_THEME,
  chipLabels: false,
  dealerSpeech: true,
};

export const pokerSettings = new Value("pokerSettings", null);

/** The saved settings, with anything missing or unrecognised filled in. */
export function loadPokerSettings() {
  const saved = pokerSettings.get();
  const merged = { ...POKER_DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
  // A theme key can go stale if a theme is ever renamed or removed; resolve it
  // through the registry so the table never asks for one that isn't there.
  merged.cardTheme = getCardTheme(merged.cardTheme).key;
  merged.tableTheme = getTableTheme(merged.tableTheme).key;
  merged.chipLabels = !!merged.chipLabels;
  merged.dealerSpeech = merged.dealerSpeech !== false;
  return merged;
}

export function savePokerSettings(patch) {
  const next = { ...loadPokerSettings(), ...(patch || {}) };
  pokerSettings.set(next);
  return next;
}
