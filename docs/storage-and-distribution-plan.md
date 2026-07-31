# Storage & distribution plan

Decided 2026-07-27. Written so a fresh session (possibly a different account)
can pick this up and implement it without re-litigating the choices below.
**Nothing in this document is built yet** — it's the plan, not a status report.

## Distribution: stay a web app (decided, do not revisit)

Game Show Studio stays hosted (Vercel today) and is distributed as a link.
People add it to their Dock themselves:

- **Safari** (macOS Sonoma+): Share → Add to Dock
- **Chrome**: the install icon in the address bar

Both give a real window with its own icon and no address bar — indistinguishable
from a native app to the person using it.

**Explicitly rejected, with reasons, so this isn't re-opened later:**

- **Electron wrapper** — would remove the "needs a browser" dependency, but every
  Mac already has Safari, which does the same install trick for free. Electron
  adds a ~150MB download, a code-signing/notarization cost to update cleanly
  ($99/yr Apple Developer Program), and forks the deployment story (web link +
  a Mac binary to rebuild and redistribute) for no capability the hosted app
  lacks.
- **Tauri wrapper** — same rejection, plus a hard blocker: Tauri's windows on
  macOS use Safari's engine (WKWebView) with each window in its own sealed
  context. The Control↔TV sync this whole app depends on
  (`BroadcastChannel` + `localStorage`, see `platform/core/store.js`) does
  **not** cross that boundary — it's a documented, open Tauri limitation. The
  TV display would go dark. Do not use Tauri for this app.
- **Full native (Swift/SwiftUI) rewrite** — would fork every game's rules
  (the Feud answer matcher, the wheel's board-layout engine, the points
  ladder) into a second implementation the phones can't share, for no problem
  this app actually has.

The only scenario that would change this: needing the show to run with **zero
internet**, including a dead venue wifi. The current `Start Trivia Night.command`
local-server setup already does that; a hosted web app does not. Buzzers/phones
need the internet regardless of which path is chosen. Revisit only if this
becomes a real requirement.

## Storage: the problem

Everything today lives in `localStorage` via `Collection` in
`platform/core/store.js` — one JSON blob per collection (`boards`, `puzzles`,
`surveys`, …), the whole blob re-parsed on every read and re-stringified on
every write.

Measured on the current seeded library (2026-07-27):

| Record type | Size each | Records before the 5MB/origin cap |
|---|---|---|
| Wheel puzzle | ~325 bytes | ~8,000 |
| Feud survey | ~977 bytes | ~2,700 |
| Jeopardy board | ~6,325 bytes | ~400 |

Those are per-type ceilings assuming nothing else is stored — split across
three games plus photos, real capacity is much lower. The plan is to import
"thousands of puzzles across multiple games" (CSV import, see below), which
exceeds this.

**The cap is not the first thing that breaks.** Two problems bite earlier:

1. `Collection.put()` parses the *entire* collection and re-stringifies it for
   one record's change. At a few thousand records this makes every edit (and
   every step of a bulk CSV import) slow.
2. `Collection.query()` (used by every library search box) re-parses the whole
   blob on every keystroke.

So the fix is needed well before 5MB is actually hit.

## Storage: the solution (decided)

Swap the backing store from `localStorage` to **IndexedDB**, but keep the
`Collection` API in `platform/core/store.js` exactly as it is today
(`get`/`all`/`put`/`patch`/`remove`/`subscribe`, all synchronous). This is the
seam the code already has — the file's own header says the backing store can
become IndexedDB without touching callers. Cash that in; don't redesign it.

**Why this needs a design decision, not just a swap:** IndexedDB is async;
`Collection`'s callers (every console, every panel) call it synchronously
during render. Rewriting every caller to be async would touch the whole app.

**The pattern: IndexedDB behind an in-memory cache.**

- On boot, load each collection out of IndexedDB once into an in-memory
  JS object/Map.
- `get`/`all`/`query` read from that in-memory copy — synchronous, no change
  to any caller, and *faster* than today because nothing re-parses JSON on
  every call.
- `put`/`patch`/`remove` update the in-memory copy immediately (so the UI
  reflects the change instantly, same as today) and write through to
  IndexedDB in the background, not blocking the caller.

**This is why it adds no latency during a live show:** the fast path (every
click, reveal, and round-advance) never touches IndexedDB directly — it reads
memory. IndexedDB is only touched to persist a change, and that happens
off the interaction path. The one place IndexedDB is read directly is the
one-time load at app boot, before a show starts — loading a few thousand
records into memory is well under a second.

**Migration:** on first boot after this ships, read any existing
`localStorage` data, write it into IndexedDB, and keep the `localStorage` copy
in place for one release as a fallback before removing it. Nobody's existing
boards/puzzles/surveys should be at risk during the switch.

**Also do:** call `navigator.storage.persist()` on boot. Without it, browser
storage is best-effort and can be evicted under disk pressure — a real risk
once someone has built a library of thousands of records by hand. Installed
web apps (which is what we're standardizing on) are the case browsers are
most likely to grant this for.

## Assets (photos): store as Blobs, not text

Photos currently get base64-encoded into the JSON blob (`platform/core/assets.js`),
which is why they broke storage first — encoding inflates size by roughly a
third versus the raw file, on top of already being large.

Store assets as real Blobs in their own IndexedDB object store, referenced by
ID from the record that uses them (a board's clue, etc.), and served via
`URL.createObjectURL()` when displayed. Do **not** load asset blobs into the
in-memory cache described above — only the records that reference them. Assets
are read on demand, not on every render.

## Cost

$0, and structurally can't become non-zero: IndexedDB is local disk space on
whoever's machine is running the show, built into every browser. No server, no
hosting bill, no subscription. This does not change if the library grows to
tens of thousands of records.

## CSV import/export (the next piece, not yet designed in code)

Motivation: building libraries of "thousands of puzzles across multiple
games" by hand doesn't scale, and boards/puzzles/surveys currently live only
in one browser's storage — CSV is also the answer to sharing a library with
a teammate.

Decisions made in discussion, not yet implemented:

- One shared, strict CSV parser (`platform/core/csv.js` — doesn't exist yet):
  RFC-4180 quoting, embedded newlines, Excel's UTF-8 BOM, CRLF. One parser,
  not one per game.
- Each game gets its own column mapper on top of the shared parser.
- **Wheel:** simple, one row per puzzle (`answer,category,tags`).
- **Feud:** one row *per answer*, grouped by question, because a survey has a
  variable number of answers and this is what a spreadsheet naturally
  produces:
  ```
  question,category,answer,points,alts
  "Name something people do when they wake up",Everyday life,Check their phone,34,"look at phone;scroll"
  "Name something people do when they wake up",Everyday life,Hit snooze,22,go back to sleep
  ```
  Auto-detect the wide format (`answer1,points1,…answer8,points8`) too, since
  people will paste that shape from elsewhere.
- **Jeopardy** is the awkward one: `board,category,value,prompt,response,dailyDouble`.
- Import needs a preview step before committing ("4,812 ready · 37 skipped,
  here's why"), a dedupe choice against the existing library
  (skip/replace/add-anyway), and must use `bulkPut` (already exists on
  `Collection`) rather than one `create()` per row — this only matters once
  the storage swap above lands, since `bulkPut` on the old localStorage store
  still re-stringifies everything per call.
- Build CSV **export** alongside import, not later — it makes import
  self-testing (export, re-import, diff) and is the actual prerequisite for
  handing a library to a teammate, which is a standing gap noted in project
  memory (`distribution-web-not-native.md`).

## Suggested build order

1. IndexedDB swap behind `Collection`, with the localStorage migration.
   Invisible to users; everything else depends on it. Verify against the
   existing seeded Jeopardy/Wheel/Feud data before moving on.
2. Assets to Blobs.
3. Shared CSV parser + Wheel import/export, then Feud, then Jeopardy.

## Non-goals (explicit, so future sessions don't wander)

- No Electron, no Tauri, no native rewrite (see above).
- No backend/server/database service of any kind — storage is local-only by
  design, which is also what keeps this free.
- No change to the `Collection` public API — callers should not need to
  change when this lands.
