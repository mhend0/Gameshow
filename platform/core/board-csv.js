// CSV import/export for Jeopardy boards.
//
// One row per clue: board, category, value, prompt, response, dailyDouble.
// Rows are grouped first by board, then by category, in the order they appear
// in the file. Text only — photos/audio/video aren't representable in a CSV
// and are dropped on import; a board exported to CSV and re-imported keeps its
// text but loses any media it had.

import { parseCsvObjects, stringifyCsv, downloadCsv } from "./csv.js";
import { boards, BoardRepo, makeCategory, makeClue } from "./repos.js";
import { makeBoard, makeRichContent } from "./models.js";

export const itemNoun = "board";
export const itemNounPlural = "boards";
export const header = ["board", "category", "value", "prompt", "response", "dailyDouble"];
export const templateFilename = "jeopardy-boards-template.csv";
export const exportFilename = "jeopardy-boards.csv";

export const templateRows = [
  { board: "Trivia Night — Board 1", category: "Science", value: 100, prompt: "The powerhouse of the cell", response: "What is the mitochondria?", dailyDouble: "" },
  { board: "Trivia Night — Board 1", category: "Science", value: 200, prompt: "The gas plants absorb from the air", response: "What is carbon dioxide?", dailyDouble: "" },
  { board: "Trivia Night — Board 1", category: "History", value: 100, prompt: "The year the Titanic sank", response: "What is 1912?", dailyDouble: "" },
  { board: "Trivia Night — Board 1", category: "History", value: 200, prompt: "The first President of the United States", response: "Who is George Washington?", dailyDouble: "TRUE" },
];

const truthy = (v) => /^(true|yes|y|1|x)$/i.test(String(v || "").trim());

/** @returns {{ready:{name:string,categories:{name:string,clues:object[]}[]}[], skipped:{row:number,reason:string}[]}} */
export function parse(text) {
  const { rows } = parseCsvObjects(text);
  const byBoard = new Map(); // board name -> Map(category name -> {name, clues})
  const skipped = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const boardName = (r.board || "").trim();
    const category = (r.category || "").trim();
    const prompt = (r.prompt || "").trim();
    if (!boardName) { skipped.push({ row: rowNum, reason: "missing board" }); return; }
    if (!category) { skipped.push({ row: rowNum, reason: "missing category" }); return; }
    if (!prompt) { skipped.push({ row: rowNum, reason: "missing prompt" }); return; }

    if (!byBoard.has(boardName)) byBoard.set(boardName, new Map());
    const cats = byBoard.get(boardName);
    if (!cats.has(category)) cats.set(category, { name: category, clues: [] });
    cats.get(category).clues.push({
      value: Math.max(0, Math.round(Number(r.value) || 0)),
      prompt,
      response: (r.response || "").trim(),
      dailyDouble: truthy(r.dailydouble),
    });
  });
  const ready = [...byBoard.entries()].map(([name, cats]) => ({ name, categories: [...cats.values()] }));
  return { ready, skipped };
}

function buildCategories(item) {
  return item.categories.map((c) => makeCategory({
    name: c.name,
    clues: c.clues.map((cl) => makeClue({
      value: cl.value,
      prompt: makeRichContent(cl.prompt),
      response: makeRichContent(cl.response),
      dailyDouble: cl.dailyDouble,
    })),
  }));
}

/** Split ready boards into brand-new vs. ones that match an existing board by name. */
export function plan(readyItems) {
  const existing = BoardRepo.list();
  const byKey = new Map(existing.map((b) => [b.name.trim().toLowerCase(), b]));
  const fresh = [], duplicates = [];
  for (const item of readyItems) {
    const dup = byKey.get(item.name.trim().toLowerCase());
    if (dup) duplicates.push({ item, existing: dup });
    else fresh.push(item);
  }
  return { fresh, duplicates };
}

export function commit(fresh, duplicates, mode) {
  const now = new Date().toISOString();
  const toCreate = mode === "add" ? fresh.concat(duplicates.map((d) => d.item)) : fresh;
  const newRecords = toCreate.map((item) => makeBoard({ name: item.name, categories: buildCategories(item) }));

  let replacedRecords = [], skippedCount = duplicates.length;
  if (mode === "replace") {
    skippedCount = 0;
    replacedRecords = duplicates.map(({ item, existing }) => ({
      ...existing,
      categories: buildCategories(item),
      updatedAt: now,
    }));
  } else if (mode === "add") {
    skippedCount = 0;
  }

  if (newRecords.length) boards.bulkPut(newRecords);
  if (replacedRecords.length) boards.bulkPut(replacedRecords);
  return { added: newRecords.length, replaced: replacedRecords.length, skipped: skippedCount };
}

export function toRows(records) {
  const rows = [];
  for (const b of records) {
    for (const c of b.categories || []) {
      for (const clue of c.clues || []) {
        rows.push({
          board: b.name, category: c.name, value: clue.value,
          prompt: clue.prompt?.text || "", response: clue.response?.text || "",
          dailyDouble: clue.dailyDouble ? "TRUE" : "",
        });
      }
    }
  }
  return rows;
}

export function downloadTemplate() {
  downloadCsv(templateFilename, stringifyCsv(header, templateRows));
}

export function downloadExport(records) {
  downloadCsv(exportFilename, stringifyCsv(header, toRows(records)));
}
