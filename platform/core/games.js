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
 * @property {GamePage[]} [pages] This game's own screens. They become the tabs on
 *                                its settings page and the standalone URLs that
 *                                still point at each one, so a new game brings its
 *                                whole settings screen with it.
 *
 * @typedef {Object} GamePage
 * @property {string} key     Tab id, used in the settings URL (?tab=…).
 * @property {string} href    Standalone URL for this screen.
 * @property {string} label
 * @property {string} glyph
 * @property {string} hint    One line describing what the screen is for.
 * @property {string} panel   Module under platform/ui/panels/ that renders it,
 *                            and the named export to mount.
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
    pages: [
      { key: "boards", href: "boards.html", label: "Categories", glyph: "🎛️",
        hint: "Categories and their clue ladders", panel: "boards-panel.js#mountBoards" },
      { key: "sessions", href: "sessions.html", label: "Sessions", glyph: "🎯",
        hint: "Assemble boards from categories, and set the order", panel: "sessions-panel.js#mountSessions" },
    ],
  },
  {
    key: "family-feud",
    name: "Family Feud",
    tagline: "Survey says…",
    description:
      "Two families, the top answers and three strikes. Type a question and its answers — the board builds itself. Face-offs on the phones, steals, double and triple rounds, and Fast Money.",
    accent: "#ff8a3d",
    accent2: "#ffc24d",
    glyph: "👪",
    status: "available",
    console: "feud.html?screen=control",
    pages: [
      { key: "surveys", href: "surveys.html", label: "Surveys", glyph: "👪",
        hint: "Questions, answers and what the survey said", panel: "surveys-panel.js#mountSurveys" },
      { key: "sessions", href: "feud-sessions.html", label: "Sessions", glyph: "🎯",
        hint: "Rounds, multipliers and the Fast Money card", panel: "feud-sessions-panel.js#mountFeudSessions" },
    ],
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
    pages: [
      { key: "puzzles", href: "puzzles.html", label: "Puzzles", glyph: "🧩",
        hint: "Answers and categories", panel: "puzzles-panel.js#mountPuzzles" },
      { key: "sessions", href: "wheel-sessions.html", label: "Sessions", glyph: "🎡",
        hint: "Rounds, toss-ups and the bonus round", panel: "wheel-sessions-panel.js#mountWheelSessions" },
    ],
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

/** Where a game's settings live — one page holding all of its screens. */
export function settingsUrl(key) {
  return `settings.html?game=${encodeURIComponent(key)}`;
}

/** The game a standalone screen URL belongs to, e.g. "puzzles.html" → wheel. */
export function gameForPage(href) {
  const file = String(href || "").split("/").pop().split("?")[0];
  for (const g of GAMES) {
    const page = (g.pages || []).find((p) => p.href === file);
    if (page) return { game: g, page };
  }
  return null;
}
