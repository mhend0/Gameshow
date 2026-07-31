// Registers the service worker and offers the "Install app" prompt on the
// studio's top-level entry pages.
//
// Loaded as a plain classic <script defer> — not a module — on every page,
// including the legacy Jeopardy console (index.html), which is deliberately
// a non-module script. Keep this file free of import/export.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

// Only the pages someone actually launches the studio from get an install
// button — a board editor or a session planner mid-edit doesn't need one.
var TOP_LEVEL_PAGES = ["", "home.html", "index.html", "wheel.html", "feud.html"];

(function () {
  var page = location.pathname.split("/").pop();
  if (TOP_LEVEL_PAGES.indexOf(page) === -1) return;

  var deferredPrompt = null;
  var btn = null;

  function ensureButton() {
    if (btn) return btn;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn primary sm";
    btn.textContent = "⬇ Install App";
    btn.setAttribute("aria-label", "Install Game Show Studio");
    btn.style.position = "fixed";
    btn.style.right = "18px";
    btn.style.bottom = "18px";
    btn.style.zIndex = "500";
    btn.style.boxShadow = "var(--shadow-3)";
    btn.hidden = true;
    btn.addEventListener("click", function () {
      if (!deferredPrompt) return;
      btn.hidden = true;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
    });
    document.body.appendChild(btn);
    return btn;
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    ensureButton().hidden = false;
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    if (btn) btn.hidden = true;
  });
})();
