// CSV import/export for the Jeopardy category library.
//
// One row per clue: category, value, prompt, response. Rows are grouped by
// category, in the order they appear in the file — each distinct category name
// becomes one category record with its clue ladder. Daily Double placement and
// board assembly aren't part of a category, so they aren't CSV columns; place
// the Daily Double per board in the session editor instead. Text only —
// photos/audio/video aren't representable in a CSV and are dropped on import;
// a category exported to CSV and re-imported keeps its text but loses any
// media it had.

import { parseCsvObjects, stringifyCsv, downloadCsv } from "./csv.js";
import { categories, CategoryRepo, makeCategory, makeClue } from "./repos.js";
import { makeRichContent } from "./models.js";

export const itemNoun = "category";
export const itemNounPlural = "categories";
export const header = ["category", "value", "prompt", "response"];
export const templateFilename = "jeopardy-categories-template.csv";
export const exportFilename = "jeopardy-categories.csv";

export const templateRows = [
  { category: "Science", value: 100, prompt: "The powerhouse of the cell", response: "What is the mitochondria?" },
  { category: "Science", value: 200, prompt: "The gas plants absorb from the air", response: "What is carbon dioxide?" },
  { category: "History", value: 100, prompt: "The year the Titanic sank", response: "What is 1912?" },
  { category: "History", value: 200, prompt: "The first President of the United States", response: "Who is George Washington?" },
];

/** @returns {{ready:{name:string,clues:object[]}[], skipped:{row:number,reason:string}[]}} */
export function parse(text) {
  const { rows } = parseCsvObjects(text);
  const byCategory = new Map(); // category name -> {name, clues}
  const skipped = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const category = (r.category || "").trim();
    const prompt = (r.prompt || "").trim();
    if (!category) { skipped.push({ row: rowNum, reason: "missing category" }); return; }
    if (!prompt) { skipped.push({ row: rowNum, reason: "missing prompt" }); return; }

    if (!byCategory.has(category)) byCategory.set(category, { name: category, clues: [] });
    byCategory.get(category).clues.push({
      value: Math.max(0, Math.round(Number(r.value) || 0)),
      prompt,
      response: (r.response || "").trim(),
    });
  });
  const ready = [...byCategory.values()];
  return { ready, skipped };
}

function buildClues(item) {
  return item.clues.map((cl) => makeClue({
    value: cl.value,
    prompt: makeRichContent(cl.prompt),
    response: makeRichContent(cl.response),
  }));
}

/** Split ready categories into brand-new vs. ones that match an existing category by name. */
export function plan(readyItems) {
  const existing = CategoryRepo.list();
  const byKey = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));
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
  const newRecords = toCreate.map((item) => makeCategory({ name: item.name, clues: buildClues(item) }));

  let replacedRecords = [], skippedCount = duplicates.length;
  if (mode === "replace") {
    skippedCount = 0;
    replacedRecords = duplicates.map(({ item, existing }) => ({
      ...existing,
      clues: buildClues(item),
      updatedAt: now,
    }));
  } else if (mode === "add") {
    skippedCount = 0;
  }

  if (newRecords.length) categories.bulkPut(newRecords);
  if (replacedRecords.length) categories.bulkPut(replacedRecords);
  return { added: newRecords.length, replaced: replacedRecords.length, skipped: skippedCount };
}

export function toRows(records) {
  const rows = [];
  for (const c of records) {
    for (const clue of c.clues || []) {
      rows.push({
        category: c.name, value: clue.value,
        prompt: clue.prompt?.text || "", response: clue.response?.text || "",
      });
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
