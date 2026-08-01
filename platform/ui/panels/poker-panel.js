// Texas Hold'em table settings, as a mountable panel.
//
// Poker has no content library to curate — the deck is the deck — so its
// settings screen is about how the table *looks* on the big screen, plus the
// accessibility options that go with it.
//
// Every swatch here is built from the same theme definitions the live table
// uses (platform/core/poker-themes.js), rendered by the same card component,
// so a preview cannot drift from what actually appears on the TV.

import { el, toast } from "../ui.js";
import { cardNode, chipStackNode } from "../poker-table.js";
import { CARD_THEMES, TABLE_THEMES, getCardTheme, getTableTheme } from "../../core/poker-themes.js";
import { loadPokerSettings, savePokerSettings } from "../../core/poker-settings.js";

/**
 * @param {HTMLElement} root
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountPokerSettings(root) {
  ensureStyles();
  let settings = loadPokerSettings();

  const tableGrid = el("div", { class: "pk-grid" });
  const cardGrid = el("div", { class: "pk-grid" });
  const toggles = el("div", { class: "pk-toggles" });

  root.innerHTML = "";
  root.append(
    section("Table", "The felt, the rail and the light in the room.", tableGrid),
    section("Cards", "Faces and backs, everywhere cards are drawn.", cardGrid),
    section("Play & access", "Options that change how the table reads, not how it looks.", toggles),
  );

  function section(title, hint, body) {
    return el("section", { class: "pk-section" }, [
      el("div", { class: "pk-section-head" }, [
        el("h2", { text: title }),
        el("p", { text: hint }),
      ]),
      body,
    ]);
  }

  /* ------------------------------------------------------------ swatches */

  /** A miniature of the felt, built from the theme's own variables. */
  function tableSwatch(theme) {
    const preview = el("div", { class: "pk-felt" });
    for (const [k, v] of Object.entries(theme.vars)) preview.style.setProperty(k, v);
    preview.append(
      el("div", { class: "pk-felt-rail" }),
      el("div", { class: "pk-felt-pot", text: "🪙 1,250" }),
    );
    return option(theme, preview, "tableTheme");
  }

  /** Two real cards and a back, drawn by the table's own card renderer. */
  function cardSwatch(theme) {
    const preview = el("div", { class: "pk-cards" });
    for (const [k, v] of Object.entries(theme.vars)) preview.style.setProperty(k, v);
    preview.append(
      cardNode({ rank: 14, suit: "s" }, { big: true }),
      cardNode({ rank: 12, suit: "h" }, { big: true }),
      cardNode(null, { big: true }),
    );
    return option(theme, preview, "cardTheme");
  }

  function option(theme, preview, key) {
    const node = el("button", {
      class: `pk-option ${settings[key] === theme.key ? "on" : ""}`,
      type: "button",
      "aria-pressed": String(settings[key] === theme.key),
      onClick: () => choose(key, theme.key),
    }, [preview, el("span", { class: "pk-name", text: theme.name })]);
    return node;
  }

  function choose(key, value) {
    settings = savePokerSettings({ [key]: value });
    render();
    toast(`${key === "cardTheme" ? getCardTheme(value).name : getTableTheme(value).name} applied`);
  }

  /* ------------------------------------------------------------- toggles */

  function toggle({ key, label, hint }) {
    const on = !!settings[key];
    const knob = el("span", { class: "pk-knob" });
    return el("button", {
      class: `pk-toggle ${on ? "on" : ""}`, type: "button", role: "switch",
      "aria-checked": String(on),
      onClick: () => { settings = savePokerSettings({ [key]: !settings[key] }); render(); },
    }, [
      el("span", { class: "pk-toggle-text" }, [
        el("strong", { text: label }),
        el("small", { text: hint }),
      ]),
      el("span", { class: "pk-switch" }, [knob]),
    ]);
  }

  /* -------------------------------------------------------------- render */

  function render() {
    tableGrid.innerHTML = "";
    for (const theme of TABLE_THEMES) tableGrid.appendChild(tableSwatch(theme));

    cardGrid.innerHTML = "";
    for (const theme of CARD_THEMES) cardGrid.appendChild(cardSwatch(theme));

    toggles.innerHTML = "";
    const chipPreview = el("div", { class: `pk-chip-preview ${settings.chipLabels ? "pt pt--labels" : "pt"}` });
    chipPreview.appendChild(chipStackNode(1675));
    toggles.append(
      toggle({
        key: "chipLabels",
        label: "Print values on chips",
        hint: "Helps anyone who finds the casino colours hard to tell apart.",
      }),
      chipPreview,
      toggle({
        key: "dealerSpeech",
        label: "Dealer speaks",
        hint: "Speech bubbles from the cowboy dealer between the action.",
      }),
    );
  }

  render();

  return {
    destroy() { root.innerHTML = ""; },
    refresh() { settings = loadPokerSettings(); render(); },
  };
}

/* =================================================================== styles */

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { text: `
  .pk-section { margin-bottom:34px; }
  .pk-section-head { margin-bottom:14px; }
  .pk-section-head h2 { font-size:17px; }
  .pk-section-head p { margin:3px 0 0; color:var(--text-2); font-size:13px; }

  .pk-grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); }
  .pk-option {
    display:flex; flex-direction:column; gap:9px; padding:10px; cursor:pointer; font:inherit; text-align:left;
    background:var(--bg-2); border:1px solid var(--line); border-radius:var(--r-md); color:var(--text-1);
    transition:border-color var(--dur), box-shadow var(--dur), transform var(--dur) var(--ease);
  }
  .pk-option:hover { transform:translateY(-2px); border-color:color-mix(in srgb, var(--accent) 45%, var(--line)); }
  .pk-option.on { border-color:var(--accent); color:var(--text-0); box-shadow:var(--ring); }
  .pk-name { font-size:13px; font-weight:700; }
  .pk-option.on .pk-name::after { content:" ✓"; color:var(--accent); }

  /* miniature felt, drawn from the theme's own variables */
  .pk-felt {
    position:relative; height:96px; border-radius:46%/34%;
    background:
      radial-gradient(60% 70% at 50% 40%, color-mix(in srgb, var(--felt) 92%, #fff 8%), transparent 70%),
      radial-gradient(120% 120% at 50% 50%, var(--felt), var(--felt-2));
    box-shadow:0 0 0 6px var(--rail), 0 0 0 8px var(--rail-2), inset 0 0 18px rgba(0,0,0,.45);
    display:grid; place-items:center;
  }
  .pk-felt-rail { position:absolute; inset:0; border-radius:inherit;
    box-shadow:inset 0 2px 3px rgba(255,255,255,.10), inset 0 -3px 6px rgba(0,0,0,.35); }
  .pk-felt-pot { font-size:13px; font-weight:900; color:var(--gold); text-shadow:0 2px 4px rgba(0,0,0,.6); }

  /* cards drawn by the table's own renderer, so previews can't drift */
  .pk-cards { container-type:inline-size; height:96px; display:flex; align-items:center; justify-content:center; gap:6px;
    background:var(--bg-0); border-radius:var(--r-sm); border:1px solid var(--line-soft); }
  .pk-cards .pt-card { width:52px; height:74px; border-radius:6px; gap:2px; }
  .pk-cards .pt-card-rank { font-size:23px; }
  .pk-cards .pt-card-suit { font-size:20px; }
  .pk-cards .pt-card.back { box-shadow:0 3px 7px rgba(0,0,0,.5), inset 0 0 0 3px var(--card-ring); }
  .pk-cards .pt-card:first-child { transform:rotate(-6deg); }
  .pk-cards .pt-card:last-child { transform:rotate(6deg); }

  /* toggles */
  .pk-toggles { display:flex; flex-direction:column; gap:12px; max-width:620px; }
  .pk-toggle {
    display:flex; align-items:center; gap:16px; padding:14px 16px; cursor:pointer; font:inherit; text-align:left;
    background:var(--bg-2); border:1px solid var(--line); border-radius:var(--r-md); color:var(--text-0);
  }
  .pk-toggle:hover { border-color:color-mix(in srgb, var(--accent) 45%, var(--line)); }
  .pk-toggle-text { flex:1; display:flex; flex-direction:column; gap:2px; }
  .pk-toggle-text strong { font-size:14px; }
  .pk-toggle-text small { color:var(--text-2); font-size:12.5px; }
  .pk-switch { flex:none; width:46px; height:26px; border-radius:999px; background:var(--bg-3);
    border:1px solid var(--line); position:relative; transition:background var(--dur); }
  .pk-knob { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%;
    background:var(--text-2); transition:transform var(--dur) var(--ease), background var(--dur); }
  .pk-toggle.on .pk-switch { background:color-mix(in srgb, var(--accent) 70%, transparent); border-color:transparent; }
  .pk-toggle.on .pk-knob { transform:translateX(20px); background:#fff; }

  .pk-chip-preview { container-type:inline-size; width:100%; max-width:620px; padding:14px 18px;
    background:var(--bg-0); border:1px solid var(--line-soft); border-radius:var(--r-md); }
  /* The chip component sizes in container units; give it a sane scale here. */
  .pk-chip-preview .pt-chipstack { --chip-d:26px; --chip-step:7px; }
  .pk-chip-preview.pt--labels .pt-chipstack { --chip-d:32px; --chip-step:9px; }
  .pk-chip-preview .pt-chipstack-amt { font-size:15px; }
  .pk-chip-preview .pt-chip { border-width:3px; box-shadow:0 2px 4px rgba(0,0,0,.5), inset 0 0 0 2px var(--chip-edge); }
  .pk-chip-preview.pt--labels .pt-chip.top::after { font-size:11px; -webkit-text-stroke:1.5px rgba(0,0,0,.75); }
  ` }));
}
