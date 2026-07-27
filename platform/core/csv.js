// Shared CSV parsing/writing — one implementation, reused by every game's own
// column mapper (wheel-csv.js, feud-csv.js, board-csv.js). RFC-4180: quoted
// fields, embedded commas/newlines inside quotes, doubled quotes as an escaped
// quote, CRLF or LF line endings, and Excel's UTF-8 BOM.

/** Parse CSV text into rows of raw field strings (no header handling). */
export function parseCsv(text) {
  const s = String(text ?? "").replace(/^﻿/, ""); // strip a UTF-8 BOM
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ""; i++; continue; }
    if (c === '\r') { i++; continue; } // swallow; \n (or EOF) ends the row
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normaliseHeaderKey(h) {
  return String(h ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Parse CSV text into header-keyed row objects. Keys are normalised
 * (lowercased, whitespace stripped) so "Daily Double", "dailydouble" and
 * "DailyDouble" in the source file all land on the same key — callers never
 * need to guess a header's exact casing.
 * @returns {{header:string[], rows:Object<string,string>[]}}
 */
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => String(h ?? "").trim());
  const keys = header.map(normaliseHeaderKey);
  const objRows = rows.slice(1)
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => {
      const o = {};
      keys.forEach((k, i) => { if (k) o[k] = String(r[i] ?? "").trim(); });
      return o;
    });
  return { header, rows: objRows };
}

function csvField(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Stringify row objects into CSV text using `header` as both the column order
 * and the source of each row's keys (normalised the same way `parseCsvObjects`
 * would produce them).
 * @param {string[]} header  Display header (written as-is on the first line).
 * @param {Object[]} rows
 */
export function stringifyCsv(header, rows) {
  const keys = header.map(normaliseHeaderKey);
  const lines = [header.map(csvField).join(",")];
  for (const r of rows) lines.push(keys.map((k) => csvField(r[k])).join(","));
  return lines.join("\r\n");
}

/** Trigger a browser download of CSV text (BOM included so Excel opens it as UTF-8). */
export function downloadCsv(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
