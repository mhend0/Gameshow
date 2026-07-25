# Trivia Night — Jeopardy Console

A little local app to run your two Jeopardy boards on a TV, with a live buzzer panel
(Buzzonk) and a scoreboard that carries across both boards.

It uses **two windows**:

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

- `index.html` — the app (both Control and TV views).
- `board1.html`, `board2.html` — your two Jeopardy boards.
- `Start Trivia Night.command` — the double‑click launcher.
