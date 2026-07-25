// First-run seeding.
//
// On a fresh install the board store is empty. We import the two legacy boards so
// the platform opens with real, editable content instead of a blank slate — and we
// create a default "Trivia Night" session that references them, matching how the
// console has always played board1 → board2.

import { boards, sessions, settings } from "./repos.js";
import { importBoardFromUrl } from "./board-import.js";
import { makeSession } from "./models.js";

const LEGACY_BOARDS = [
  { url: "board1.html", name: "Trivia Night — Board 1" },
  { url: "board2.html", name: "Trivia Night — Board 2" },
];

/**
 * Ensure the store has been seeded once. Idempotent and safe to call on every page.
 * @returns {Promise<{seeded:boolean, boards:number}>}
 */
export async function ensureSeeded() {
  const s = settings.get() || {};
  if (s.seededV1 && boards.count() > 0) {
    return { seeded: false, boards: boards.count() };
  }

  const imported = [];
  for (const b of LEGACY_BOARDS) {
    try {
      const board = await importBoardFromUrl(b.url, b.name);
      board.meta.tags = ["trivia night"];
      boards.put(board);
      imported.push(board);
    } catch (e) {
      console.warn("Seed: could not import", b.url, e);
    }
  }

  // Default session referencing the imported boards in order.
  if (imported.length && sessions.count() === 0) {
    const session = makeSession({
      name: "Trivia Night",
      boardIds: imported.map((b) => b.id),
      meta: { notes: "Auto-created from your original two boards.", tags: ["default"] },
    });
    sessions.put(session);
  }

  settings.set({ ...s, seededV1: true });
  return { seeded: true, boards: imported.length };
}

/** Force a clean re-seed (used by an eventual "restore samples" action). */
export async function reseed() {
  const s = settings.get() || {};
  settings.set({ ...s, seededV1: false });
  return ensureSeeded();
}
