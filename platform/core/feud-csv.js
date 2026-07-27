// CSV import/export for Family Feud surveys.
//
// Two accepted shapes:
//  - "long": one row per answer, grouped by question — what a spreadsheet
//    naturally produces (question,category,answer,points,alts).
//  - "wide": one row per survey, answers spread across answer1/points1 …
//    answer8/points8 — auto-detected from the header, since people paste this
//    shape in from elsewhere.
// Export always writes the long shape; it's lossless and re-imports cleanly.

import { parseCsvObjects, stringifyCsv, downloadCsv } from "./csv.js";
import { surveys, SurveyRepo, makeSurvey, makeSurveyAnswer, FEUD_RULES } from "./feud.js";

export const itemNoun = "survey";
export const itemNounPlural = "surveys";
export const header = ["question", "category", "answer", "points", "alts"];
export const templateFilename = "feud-surveys-template.csv";
export const exportFilename = "feud-surveys.csv";

export const templateRows = [
  { question: "Name something people do the moment they wake up", category: "Everyday life", answer: "Check their phone", points: 34, alts: "look at phone; scroll" },
  { question: "Name something people do the moment they wake up", category: "Everyday life", answer: "Hit snooze", points: 22, alts: "go back to sleep" },
  { question: "Name something people do the moment they wake up", category: "Everyday life", answer: "Stretch", points: 14, alts: "" },
  { question: "Name a reason to be late for work", category: "Work", answer: "Traffic", points: 38, alts: "" },
  { question: "Name a reason to be late for work", category: "Work", answer: "Overslept", points: 26, alts: "slept in" },
];

function isWideHeader(rawHeader) {
  return rawHeader.some((h) => /^answer\s*1$/i.test(h.trim()));
}

function splitAlts(s) {
  return String(s || "").split(/[;,]/).map((a) => a.trim()).filter(Boolean);
}

function parseLong(rows) {
  const bySurvey = new Map(); // normalised question -> {question, category, answers}
  const skipped = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const question = (r.question || "").trim();
    const answer = (r.answer || "").trim();
    if (!question) { skipped.push({ row: rowNum, reason: "missing question" }); return; }
    if (!answer) { skipped.push({ row: rowNum, reason: "missing answer" }); return; }
    const key = question.toLowerCase();
    if (!bySurvey.has(key)) bySurvey.set(key, { question, category: (r.category || "").trim(), answers: [] });
    bySurvey.get(key).answers.push({
      text: answer,
      points: Math.max(0, Math.round(Number(r.points) || 0)),
      alts: splitAlts(r.alts),
    });
  });
  return { ready: [...bySurvey.values()], skipped };
}

function parseWide(rows) {
  const ready = [], skipped = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const question = (r.question || "").trim();
    if (!question) { skipped.push({ row: rowNum, reason: "missing question" }); return; }
    const answers = [];
    for (let n = 1; n <= FEUD_RULES.maxAnswers; n++) {
      const text = (r[`answer${n}`] || "").trim();
      if (!text) continue;
      answers.push({ text, points: Math.max(0, Math.round(Number(r[`points${n}`]) || 0)), alts: splitAlts(r[`alts${n}`]) });
    }
    if (!answers.length) { skipped.push({ row: rowNum, reason: "no answers found" }); return; }
    ready.push({ question, category: (r.category || "").trim(), answers });
  });
  return { ready, skipped };
}

/** @returns {{ready:{question:string,category:string,answers:{text,points,alts}[]}[], skipped:{row:number,reason:string}[]}} */
export function parse(text) {
  const { header: rawHeader, rows } = parseCsvObjects(text);
  if (!rows.length) return { ready: [], skipped: [] };
  return isWideHeader(rawHeader) ? parseWide(rows) : parseLong(rows);
}

/** Split ready rows into brand-new vs. ones that match an existing survey by question. */
export function plan(readyItems) {
  const existing = SurveyRepo.list();
  const byKey = new Map(existing.map((s) => [s.question.trim().toLowerCase(), s]));
  const fresh = [], duplicates = [];
  for (const item of readyItems) {
    const dup = byKey.get(item.question.trim().toLowerCase());
    if (dup) duplicates.push({ item, existing: dup });
    else fresh.push(item);
  }
  return { fresh, duplicates };
}

export function commit(fresh, duplicates, mode) {
  const now = new Date().toISOString();
  const toCreate = mode === "add" ? fresh.concat(duplicates.map((d) => d.item)) : fresh;
  const newRecords = toCreate.map((item) => makeSurvey({ question: item.question, category: item.category, answers: item.answers }));

  let replacedRecords = [], skippedCount = duplicates.length;
  if (mode === "replace") {
    skippedCount = 0;
    replacedRecords = duplicates.map(({ item, existing }) => ({
      ...existing,
      category: item.category,
      answers: item.answers.map((a) => makeSurveyAnswer(a)),
      updatedAt: now,
    }));
  } else if (mode === "add") {
    skippedCount = 0;
  }

  if (newRecords.length) surveys.bulkPut(newRecords);
  if (replacedRecords.length) surveys.bulkPut(replacedRecords);
  return { added: newRecords.length, replaced: replacedRecords.length, skipped: skippedCount };
}

export function toRows(records) {
  const rows = [];
  for (const s of records) {
    for (const a of s.answers || []) {
      rows.push({ question: s.question, category: s.category, answer: a.text, points: a.points, alts: (a.alts || []).join("; ") });
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
