// Small UI toolkit shared across platform pages (library, editor, sessions).
// Deliberately tiny + dependency-free: DOM helpers, toasts, modals, formatting.

/** Create an element from a tag, props and children. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k === "value") node.value = v;          // property, so <textarea>/<select> populate
    else if (k === "checked") node.checked = !!v;
    // Boolean attributes are present-or-absent, not true-or-false: HTML reads
    // `disabled="false"` as disabled, so `setAttribute(k, false)` does the
    // exact opposite of what the caller asked for. Setting the property
    // instead gets both directions right. (This had left the poker host
    // console's blind buttons permanently disabled — `disabled: !between` is
    // the obvious way to write it, and it silently never worked.)
    else if (typeof v === "boolean") {
      if (k in node) node[k] = v;
      else if (v) node.setAttribute(k, "");
      else node.removeAttribute(k);
    }
    // Custom properties have to go through setProperty — assigning `--x` onto
    // a CSSStyleDeclaration is silently dropped, which makes a themed element
    // render with no theme and nothing to show for it in the console.
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        if (val == null) continue;
        if (prop.startsWith("--")) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    }
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Toast — ensures a single shared toast node exists. */
let toastEl, toastTimer;
export function toast(msg, ms = 2600) {
  if (!toastEl) {
    toastEl = document.querySelector(".toast") || el("div", { class: "toast" });
    if (!toastEl.isConnected) document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

/**
 * Modal dialog. Returns an object with `.close()`.
 * @param {{title?:string, body:Node|string, actions?:HTMLElement[], wide?:boolean, onClose?:Function}} opts
 */
export function modal({ title = "", body, actions = [], wide = false, onClose } = {}) {
  ensureModalStyles();
  const overlay = el("div", { class: "gsp-modal-overlay" });
  const card = el("div", { class: `gsp-modal card ${wide ? "wide" : ""}` });

  const header = title
    ? el("div", { class: "gsp-modal-head" }, [
        el("h3", { text: title }),
        el("button", { class: "btn icon ghost", html: "✕", onClick: close, "aria-label": "Close" }),
      ])
    : null;

  const content = el("div", { class: "gsp-modal-body" }, [typeof body === "string" ? el("div", { html: body }) : body]);
  const footer = actions.length ? el("div", { class: "gsp-modal-foot" }, actions) : null;

  card.append(...[header, content, footer].filter(Boolean));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => overlay.classList.add("show"));

  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.classList.remove("show");
    document.body.style.overflow = "";
    setTimeout(() => overlay.remove(), 200);
    onClose && onClose();
  }

  return { close, overlay, card };
}

/** Confirm dialog → resolves boolean. */
export function confirmDialog({ title = "Are you sure?", message = "", confirmText = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    let m;
    const cancel = el("button", { class: "btn ghost", text: "Cancel", onClick: () => { resolve(false); m.close(); } });
    const ok = el("button", { class: `btn ${danger ? "danger" : "primary"}`, text: confirmText, onClick: () => { resolve(true); m.close(); } });
    m = modal({ title, body: el("p", { class: "muted", text: message, style: { margin: "2px 0 4px" } }), actions: [cancel, ok], onClose: () => resolve(false) });
    ok.focus();
  });
}

/** Prompt dialog → resolves string|null. */
export function promptDialog({ title = "", label = "", value = "", confirmText = "Save", placeholder = "" } = {}) {
  return new Promise((resolve) => {
    let m;
    const input = el("input", { class: "input", value, placeholder });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { resolve(input.value.trim() || null); m.close(); } });
    const field = el("label", { class: "field" }, [label ? el("span", { class: "field-label", text: label }) : null, input].filter(Boolean));
    const cancel = el("button", { class: "btn ghost", text: "Cancel", onClick: () => { resolve(null); m.close(); } });
    const ok = el("button", { class: "btn primary", text: confirmText, onClick: () => { resolve(input.value.trim() || null); m.close(); } });
    m = modal({ title, body: field, actions: [cancel, ok], onClose: () => resolve(null) });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/** Relative time, e.g. "3 min ago", "yesterday". */
export function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Standard platform top bar. `links` = [{href,label}], `active` matches label. */
export function topbar({ active = "", links = [], right = [] } = {}) {
  const bar = el("header", { class: "topbar" }, [
    el("a", { class: "brand", href: "home.html", style: { color: "inherit" } }, [
      el("span", { class: "brand-mark", html: "🎬" }),
      el("span", { text: "Game Show Studio" }),
    ]),
    el("nav", { class: "topnav" }, links.map((l) =>
      el("a", { class: `topnav-link ${l.label === active ? "active" : ""}`, href: l.href, text: l.label }))),
    el("span", { class: "spacer" }),
    ...right,
  ]);
  return bar;
}

function ensureModalStyles() {
  if (document.getElementById("gsp-modal-styles")) return;
  const css = `
  .gsp-modal-overlay{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:24px;
    background:color-mix(in srgb,#000 62%,transparent);backdrop-filter:blur(6px);opacity:0;transition:opacity .2s var(--ease)}
  .gsp-modal-overlay.show{opacity:1}
  .gsp-modal{width:min(560px,100%);max-height:88vh;display:flex;flex-direction:column;transform:translateY(12px) scale(.98);
    transition:transform .22s var(--ease);overflow:hidden}
  .gsp-modal.wide{width:min(920px,100%)}
  .gsp-modal-overlay.show .gsp-modal{transform:none}
  .gsp-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--line-soft)}
  .gsp-modal-head h3{font-size:18px}
  .gsp-modal-body{padding:20px;overflow:auto}
  .gsp-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 20px;border-top:1px solid var(--line-soft)}
  `;
  document.head.appendChild(el("style", { id: "gsp-modal-styles", html: css }));
}

// Base UI styles — injected once at import time so they apply even before any
// modal/topbar helper is called.
(function injectBaseStyles() {
  if (typeof document === "undefined" || document.getElementById("gsp-base-styles")) return;
  const css = `
  .topnav{display:flex;gap:4px;margin-left:10px}
  .topnav-link{padding:7px 13px;border-radius:10px;color:var(--text-2);font-weight:600;font-size:14px;transition:all .2s var(--ease)}
  .topnav-link:hover{color:var(--text-0);background:var(--bg-2)}
  .topnav-link.active{color:var(--text-0);background:var(--bg-3)}
  .field{display:flex;flex-direction:column;gap:7px}
  .field-label{font-size:13px;font-weight:600;color:var(--text-1)}
  `;
  const style = document.createElement("style");
  style.id = "gsp-base-styles";
  style.textContent = css;
  document.head.appendChild(style);
})();
