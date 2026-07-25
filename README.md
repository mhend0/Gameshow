# Game Show Studio

A local **game-show platform** — Jeopardy today, built to host more games over time.
Create and edit boards, plan sessions (a running order of boards), and run the show live
on a TV with buzzers and a carry-over scoreboard.

## The platform

Double-click **`Start Trivia Night.command`** and your browser opens the **Home screen**
(`home.html`). From there:

- **Home** — pick a game. Jeopardy opens its Control Console at your most-recent session.
- **Boards** (`boards.html`) — your board library: search, sort, tag, favourite, duplicate,
  preview, and open the **Editor** (`editor.html`) to edit categories, clues, answers, point
  values, Daily Doubles, media (drag-and-drop, copied into the app so the project stays
  portable), difficulty and notes.
- **Sessions** (`sessions.html`) — plan a night: choose which boards play and in what order.
  A session *references* boards, so one board can be reused across many sessions. **Launch**
  drops straight into the console for that run.

All content lives on your machine (browser storage under the `gsp:` namespace). The platform
architecture lives in `platform/core` (data models, store, repositories, importer, assets)
and `platform/ui` (design system + shared components), so new games plug in with minimal
duplication.

Your original two boards are imported automatically on first run and become editable boards
in the library — nothing is lost.

---

## The live console (Control + TV Display)

The console you run the show on uses **two windows**:

- **Control** (your laptop) — the board you click, points, teams, settings, buzzer setup.
- **TV Display** (your HDMI TV) — a clean screen with just the board, buzzers and scores.
  Everything you do on Control instantly mirrors here.

---

## How to start

1. **Double‑click `Start Trivia Night.command`.**
   (First time only: if macOS blocks it, right‑click → **Open** → **Open**.)
   Your browser opens the **Control** window. A small Terminal window also opens — just
   leave it running in the background.

2. In the Control window, click **🖥 Open TV Display**. A second browser window opens.
   Drag it onto your TV, then press **⛶ Fullscreen** (or the browser's own fullscreen).

That's it. Operate everything from the Control window; the TV mirrors it.

---

## Running the game

- **Ask a question:** click a tile on the Control board. It opens on the TV too.
- **Reveal the answer:** click **Reveal Correct Response** (or press Spacebar).
- **Close it:** click **Continue** (or press Esc).
- **Award points:** the **Award** box at the top auto‑fills with the open question's value.
  Click **+** on the team that got it right (or **–** to deduct). The tile greys out as used.
  You can also type any award amount, double‑click a score to edit it, or use **✎ Teams**
  to rename / add / remove teams.
- **Next board:** when every tile is played you'll be prompted to continue to Board 2 — or
  click **Board 2 →** any time. **Scores and teams carry over automatically.**
- **Final scores:** after Board 2 finishes you get a winner podium.

---

## Buzzers (Buzzonk)

Buzzonk only shows the live "who buzzed" list to the **host's own window**. Browsers block
an embedded page from acting as a host, so the buzzers run in **their own window** (not
inside the TV page). A floated window looks the same to your audience.

1. On Control, click **🔔 Open Buzzer window** — a Buzzonk window opens.
2. In that window, click **Create a room** — you're now the host.
3. Buzzonk shows a join code like `buzzonk.com/ab12cd`. **Read that code to your players** —
   they open it on their phones and get a Buzz button. When someone buzzes, their name jumps
   up the list in this window.
4. **To show the buzzes on the TV:** drag that Buzzonk window onto the TV's buzzer area.
   Keep the TV display **maximised, not full‑screen**, so the window floats on top.
   *(Or just keep it on your laptop and call out who buzzed — whichever you prefer.)*
5. **Between clues, click Reset** in that window to clear the buzzers for the next question.

> Why not inside the TV page? Buzzonk's "who buzzed" list is only visible to the host, and
> browsers won't let an embedded site be a host — so it has to be its own window. Everything
> else (board, scores) is still fully integrated on the TV.

---

## Good to know

- **Everything is saved** as you go (scores, which board, used tiles). If a window
  refreshes or reopens, it picks up where you left off.
- Needs an **internet connection** (the boards load their images, and Buzzonk is online).
- To **start a brand‑new game**, open **⚙ Setup → Reset everything**.
- When you're completely done, just close the Terminal window (that stops the server).

## Files

- `home.html` — Game Show Studio home screen (the entry point).
- `boards.html` · `editor.html` · `sessions.html` — board library, board editor, session planner.
- `index.html` — the live console (both Control and TV views).
- `play-board.html` — renders a data-model board for the console (replaces the static boards
  when you launch from a session/editor; the console drives it unchanged).
- `platform/core/*` — data models, store, repositories, board importer, asset system.
- `platform/ui/*` — design system (`theme.css`) and shared components (`ui.js`, `board-view.js`).
- `board1.html`, `board2.html` — the original static boards (kept as a fallback; their content
  is also imported into the editable library on first run).
- `buzzer/` — the buzzer service (Buzzonk-compatible).
- `Start Trivia Night.command` — the double‑click launcher.
