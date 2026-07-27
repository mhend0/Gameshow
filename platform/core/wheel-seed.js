// First-run content for Wheel of Fortune.
//
// A brand-new library is a dead end: you can't try the console until you've typed
// puzzles, and you can't tell whether the console works until you've tried it. So
// we seed a night's worth of real puzzles and a session that plays them, all
// editable and deletable like anything else you'd create yourself.

import { puzzles, wheelSessions, PuzzleRepo, WheelSessionRepo, makeRound } from "./wheel.js";
import { settings } from "./repos.js";

/** Chosen to exercise the layout engine: one, two, three and four-line boards. */
const STARTERS = [
  { category: "Phrase", answer: "Piece of cake" },
  { category: "Phrase", answer: "Blowing in the wind" },
  { category: "Proverb", answer: "A penny saved is a penny earned" },
  { category: "Proverb", answer: "Don't count your chickens before they hatch" },
  { category: "Thing", answer: "The kitchen sink" },
  { category: "Food & Drink", answer: "Fish and chips" },
  { category: "Place", answer: "New York City" },
  { category: "Person", answer: "Mother-in-law" },
  { category: "Around the House", answer: "A fresh coat of paint" },
  { category: "Song Title", answer: "Sweet Caroline" },
  { category: "Movie Title", answer: "The Empire Strikes Back" },
  { category: "Same Name", answer: "Rock & roll hall of fame" },
];

/**
 * Seed once. Idempotent and safe to call on every page load.
 * @returns {{seeded:boolean, puzzles:number}}
 */
export function ensureWheelSeeded() {
  const s = settings.get() || {};
  if (s.wheelSeededV1 && puzzles.count() > 0) {
    return { seeded: false, puzzles: puzzles.count() };
  }

  const made = STARTERS.map((p) => PuzzleRepo.create({ ...p, meta: { tags: ["starter"] } }));

  if (made.length && wheelSessions.count() === 0) {
    // Shaped like a broadcast: a toss-up to open, standard rounds through the
    // middle, and the bonus round to finish — so all three types are there to try.
    const kinds = ["toss-up", "standard", "standard", "standard", "bonus"];
    WheelSessionRepo.create({
      name: "Wheel Night",
      rounds: made.slice(0, kinds.length).map((p, i) => makeRound({ puzzleId: p.id, kind: kinds[i] })),
      meta: { notes: "Auto-created so you can try the console straight away.", tags: ["default"] },
    });
  }

  settings.set({ ...s, wheelSeededV1: true });
  return { seeded: true, puzzles: made.length };
}

/** Force the starters back (used by a "restore samples" action). */
export function reseedWheel() {
  const s = settings.get() || {};
  settings.set({ ...s, wheelSeededV1: false });
  return ensureWheelSeeded();
}
