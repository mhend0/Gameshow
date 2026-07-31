// Service worker for Game Show Studio.
//
// Network-first, always: the app is plain ES modules loaded straight from
// disk during local dev (see serve.py's own no-cache headers), so a service
// worker that served stale JS from its cache would look exactly like a bug
// that isn't there. Every same-origin GET tries the network first; the cache
// is only ever a fallback for when that fetch fails outright — i.e. offline.
const CACHE = "gsp-shell-v1";
const OFFLINE_URL = "offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                    // never intercept writes
  if (new URL(req.url).origin !== location.origin) return; // leave buzzer/API calls etc. alone

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Stash a copy of whatever the network just returned so it's there
        // next time we're offline — the response shown right now is always
        // the fresh network one, never this cached copy.
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match(OFFLINE_URL);
          return Response.error();
        })
      )
  );
});
