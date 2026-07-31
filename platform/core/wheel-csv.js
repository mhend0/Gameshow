// CSV import/export for Wheel of Fortune puzzles.
//
// One row per puzzle: answer, category, tags. `answer` is the only required
// column — it's validated against the real board layout engine, so a row that
// won't fit the board is skipped with the same reason the editor would show.

import { parseCsvObjects, stringifyCsv, downloadCsv } from "./csv.js";
import { puzzles, PuzzleRepo, makePuzzle, layoutPuzzle, normaliseAnswer } from "./wheel.js";

export const itemNoun = "puzzle";
export const itemNounPlural = "puzzles";
export const header = ["answer", "category", "tags"];
export const templateFilename = "wheel-puzzles-template.csv";
export const exportFilename = "wheel-puzzles.csv";

export const templateRows = [
  { answer: "A penny saved is a penny earned", category: "Phrase", tags: "proverb" },
  { answer: "The kitchen sink", category: "Thing", tags: "" },
  { answer: "Singin' in the Rain", category: "Movie Title", tags: "classic film" },
];

/** @returns {{ready:{answer:string,category:string,tags:string[]}[], skipped:{row:number,reason:string}[]}} */
export function parse(text) {
  const { rows } = parseCsvObjects(text);
  const ready = [], skipped = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2; // header is row 1
    const answer = (r.answer || "").trim();
    if (!answer) { skipped.push({ row: rowNum, reason: "missing answer" }); return; }
    const layout = layoutPuzzle(answer);
    if (!layout.ok) { skipped.push({ row: rowNum, reason: layout.error || "doesn't fit the board" }); return; }
    const category = (r.category || "").trim();
    const tags = (r.tags || "").split(",").map((s) => s.trim()).filter(Boolean);
    ready.push({ answer, category, tags });
  });
  return { ready, skipped };
}

/** Split ready rows into brand-new vs. ones that match an existing puzzle by answer. */
export function plan(readyItems) {
  const existing = PuzzleRepo.list();
  const byKey = new Map(existing.map((p) => [normaliseAnswer(p.answer), p]));
  const fresh = [], duplicates = [];
  for (const item of readyItems) {
    const dup = byKey.get(normaliseAnswer(item.answer));
    if (dup) duplicates.push({ item, existing: dup });
    else fresh.push(item);
  }
  return { fresh, duplicates };
}

/**
 * @param {mode} "skip"|"replace"|"add" what to do with `duplicates`
 * @returns {{added:number, replaced:number, skipped:number}}
 */
export function commit(fresh, duplicates, mode) {
  const now = new Date().toISOString();
  const toCreate = mode === "add" ? fresh.concat(duplicates.map((d) => d.item)) : fresh;
  const newRecords = toCreate.map((item) => makePuzzle({ answer: item.answer, category: item.category, meta: { tags: item.tags } }));

  let replacedRecords = [], skippedCount = duplicates.length;
  if (mode === "replace") {
    skippedCount = 0;
    replacedRecords = duplicates.map(({ item, existing }) => ({
      ...existing,
      answer: normaliseAnswer(item.answer),
      category: item.category,
      meta: { ...existing.meta, tags: item.tags },
      updatedAt: now,
    }));
  } else if (mode === "add") {
    skippedCount = 0;
  }

  if (newRecords.length) puzzles.bulkPut(newRecords);
  if (replacedRecords.length) puzzles.bulkPut(replacedRecords);
  return { added: newRecords.length, replaced: replacedRecords.length, skipped: skippedCount };
}

export function toRows(records) {
  return records.map((p) => ({ answer: p.answer, category: p.category, tags: (p.meta?.tags || []).join(", ") }));
}

export function downloadTemplate() {
  downloadCsv(templateFilename, stringifyCsv(header, templateRows));
}

export function downloadExport(records) {
  downloadCsv(exportFilename, stringifyCsv(header, toRows(records)));
}
