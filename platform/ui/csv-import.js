// Generic CSV toolbar (Template / Export / Import) shared by every game's
// library panel. Each game supplies a small mapper (see wheel-csv.js,
// feud-csv.js, board-csv.js) that knows its own columns and how to turn parsed
// rows into real records; this file only knows how to run that mapper and
// show the result.

import { el, modal, toast } from "./ui.js";

/**
 * @param {{mapper: object, getRecords: () => any[], onChanged?: () => void}} opts
 * @returns {{templateBtn:HTMLElement, exportBtn:HTMLElement, importBtn:HTMLElement, fileInput:HTMLElement}}
 */
export function csvToolbar({ mapper, getRecords, onChanged }) {
  ensureStyles();

  const templateBtn = el("button", {
    class: "btn sm ghost", text: "⬇ Template", title: `Download a starter CSV showing the columns ${mapper.itemNounPlural} import expects`,
    onClick: () => mapper.downloadTemplate(),
  });

  const exportBtn = el("button", {
    class: "btn sm ghost", text: "⬇ Export CSV",
    onClick: () => {
      const records = getRecords();
      if (!records.length) { toast(`No ${mapper.itemNounPlural} to export yet`); return; }
      mapper.downloadExport(records);
    },
  });

  const fileInput = el("input", { type: "file", accept: ".csv,text/csv", style: { display: "none" } });
  const importBtn = el("button", { class: "btn sm", text: "⬆ Import CSV", onClick: () => fileInput.click() });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = ""; // so picking the same file twice still fires "change"
    if (!file) return;
    try {
      await runImport(file, mapper, onChanged);
    } catch (e) {
      console.error(e);
      toast(`Couldn't read that CSV: ${e && e.message ? e.message : e}`);
    }
  });

  return { templateBtn, exportBtn, importBtn, fileInput };
}

async function runImport(file, mapper, onChanged) {
  const text = await file.text();
  const { ready, skipped } = mapper.parse(text);
  const { fresh, duplicates } = mapper.plan(ready);

  if (!ready.length) {
    const closeBtn = el("button", { class: "btn primary", text: "Close" });
    const m = modal({
      title: "Nothing to import",
      body: el("p", { class: "muted" }, [
        skipped.length
          ? `Every row in that file was skipped. ${skipped[0].reason ? `First issue: row ${skipped[0].row} — ${skipped[0].reason}.` : ""}`
          : "That file didn't have any rows the importer recognised.",
      ]),
      actions: [closeBtn],
    });
    closeBtn.addEventListener("click", () => m.close());
    return;
  }

  let mode = "skip";
  const summary = el("div", { class: "csv-summary" });
  const body = el("div", { class: "csv-import-body" });

  function renderSummary() {
    const readyCount = fresh.length + (mode === "skip" ? 0 : duplicates.length);
    summary.innerHTML = "";
    summary.append(...[
      el("span", { class: "csv-ok", text: `✓ ${readyCount} ${readyCount === 1 ? mapper.itemNoun : mapper.itemNounPlural} ready` }),
      duplicates.length ? el("span", { class: "csv-dup", text: `  ·  ${duplicates.length} already in your library` }) : null,
      skipped.length ? el("span", { class: "csv-bad", text: `  ·  ${skipped.length} skipped` }) : null,
    ].filter(Boolean));
  }
  renderSummary();
  body.appendChild(summary);

  if (skipped.length) {
    body.appendChild(el("details", { class: "csv-skip-detail" }, [
      el("summary", { text: `Why ${skipped.length} row${skipped.length === 1 ? "" : "s"} were skipped` }),
      el("ul", { class: "csv-skip-ul" }, skipped.slice(0, 40).map((s) => el("li", { text: `Row ${s.row}: ${s.reason}` }))),
      skipped.length > 40 ? el("li", { class: "muted", text: `…and ${skipped.length - 40} more` }) : null,
    ].filter(Boolean)));
  }

  if (duplicates.length) {
    const options = [
      ["skip", `Skip — leave the ${duplicates.length} existing ${duplicates.length === 1 ? mapper.itemNoun : mapper.itemNounPlural} unchanged`],
      ["replace", `Replace — overwrite ${duplicates.length === 1 ? "it" : "them"} with the CSV version`],
      ["add", "Add anyway — import as new, duplicates and all"],
    ];
    const modeBox = el("div", { class: "csv-mode" }, [
      el("div", { class: "field-label", text: `${duplicates.length} row${duplicates.length === 1 ? "" : "s"} match something already in your library` }),
      ...options.map(([val, label], i) => el("label", { class: "csv-radio" }, [
        el("input", { type: "radio", name: "csvmode", value: val, checked: i === 0, onChange: () => { mode = val; renderSummary(); } }),
        el("span", { text: label }),
      ])),
    ]);
    body.appendChild(modeBox);
  }

  const importBtn2 = el("button", { class: "btn primary", text: "Import" });
  const cancelBtn = el("button", { class: "btn ghost", text: "Cancel", onClick: () => m.close() });
  const m = modal({
    title: `Import ${mapper.itemNounPlural} from CSV`,
    wide: true,
    body,
    actions: [cancelBtn, importBtn2],
  });

  importBtn2.addEventListener("click", () => {
    const result = mapper.commit(fresh, duplicates, mode);
    m.close();
    const parts = [`${result.added} added`];
    if (result.replaced) parts.push(`${result.replaced} replaced`);
    if (result.skipped) parts.push(`${result.skipped} skipped (already existed)`);
    toast(parts.join(" · "));
    onChanged && onChanged();
  });
}

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { id: "csv-import-styles", html: `
  .csv-import-body { display:flex; flex-direction:column; gap:14px; }
  .csv-summary { display:flex; flex-wrap:wrap; align-items:center; font-size:14px; font-weight:600; }
  .csv-ok { color:var(--good); }
  .csv-dup { color:var(--warn); }
  .csv-bad { color:var(--text-2); }
  .csv-skip-detail summary { cursor:pointer; font-size:13px; font-weight:600; color:var(--text-1); }
  .csv-skip-ul { margin:8px 0 0; padding-left:18px; font-size:12.5px; color:var(--text-2); display:flex; flex-direction:column; gap:3px; max-height:180px; overflow:auto; }
  .csv-mode { display:flex; flex-direction:column; gap:9px; padding:12px 14px; background:var(--bg-2); border:1px solid var(--line-soft); border-radius:var(--r-md); }
  .csv-radio { display:flex; align-items:center; gap:9px; font-size:13.5px; cursor:pointer; }
  .csv-radio input { margin:0; }
  ` }));
}
