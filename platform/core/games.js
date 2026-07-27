// Registry of game types the platform can host.
//
// This is the single source of truth for the Home Screen cards and for routing.
// Adding a future game (Family Feud, Wheel of Fortune, …) means adding an entry
// here plus its consoles/editor — no other file needs to know the full list.

/**
 * @typedef {Object} GameDef
 * @property {string} key         Stable slug used in data + routing.
 * @property {string} name
 * @property {string} tagline
 * @property {string} description
 * @property {string} accent      CSS color (drives card + console theming).
 * @property {string} accent2     Secondary color for gradients.
 * @property {string} glyph       Emoji/short glyph for the card.
 * @property {"available"|"coming-soon"} status
 * @property {string} [console]   URL of the game's control console (when available).
 * @property {{href:string,label:string}} [library]  Where this game's content is edited.
 * @property {string} [sessionsPage]  Where this game's running orders are planned.
 */

/** @type {GameDef[]} */
export const GAMES = [
  {
    key: "jeopardy",
    name: "Jeopardy",
    tagline: "Categories, clues & buzzers",
    description:
      "The classic answer-and-question board. Build boards, run daily doubles, track team scores and drive live buzzers.",
    accent: "#3b6fff",
    accent2: "#7a5cff",
    glyph: "🟦",
    status: "available",
    console: "index.html?screen=control",
  },
  {
    key: "family-feud",
    name: "Family Feud",
    tagline: "Survey says…",
    description: "Two teams, top survey answers and the fast-money round. Coming soon to the platform.",
    accent: "#ff8a3d",
    accent2: "#ffc24d",
    glyph: "👪",
    status: "coming-soon",
  },
  {
    key: "wheel",
    name: "Wheel of Fortune",
    tagline: "Spin, guess, solve",
    description:
      "Type an answer and a category — the board lays itself out. Spin for cash, call letters, buy vowels and solve, with the wheel and the puzzle on the big screen.",
    accent: "#18c29c",
    accent2: "#3ad6b3",
    glyph: "🎡",
    status: "available",
    console: "wheel.html?screen=control",
    /** Where this game's content lives, for the home screen's links. */
    library: { href: "puzzles.html", label: "Puzzles" },
    sessionsPage: "wheel-sessions.html",
  },
  {
    key: "the-chase",
    name: "The Chase",
    tagline: "Beat the chaser",
    description: "Rapid-fire cash builder and the head-to-head chase. On the roadmap.",
    accent: "#e0457b",
    accent2: "#ff6fa5",
    glyph: "🏃",
    status: "coming-soon",
  },
];

export function getGame(key) {
  return GAMES.find((g) => g.key === key) || null;
}
