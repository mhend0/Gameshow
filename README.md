# Game Show Studio

A local **game-show platform** — **Jeopardy**, **Wheel of Fortune** and **Family Feud**
today, built to host more games over time. Create and edit your content, plan sessions (a running order), and run
the show live on a TV with buzzers, phones and a carry-over scoreboard.

## The platform

Double-click **`Start Trivia Night.command`** and your browser opens the **Home screen**
(`home.html`). From there:

- **Home** — pick a game. Clicking a card opens that game's Control Console at your
  most-recent session. Each card also has a **⚙** button that opens a settings page
  (`settings.html?game=…`) with a tab for every screen that belongs to *that game* —
  Jeopardy's boards and the wheel's puzzles never clutter each other, and each tab is a
  URL you can bookmark or share (`&tab=…`). What tabs a game gets is entirely driven by
  its entry in `platform/core/games.js`, so a future game brings its whole settings page
  with it — no changes needed here.

Jeopardy's tabs, under its **⚙**:

- **Boards** (`boards.html`) — your Jeopardy board library: search, sort, tag, favourite,
  duplicate, preview, and open the **Editor** (`editor.html`) to edit categories, clues,
  answers, point values, Daily Doubles, media (drag-and-drop, copied into the app so the
  project stays portable), difficulty and notes.
- **Sessions** (`sessions.html`) — plan a night: choose which boards play and in what order.
  A session *references* boards, so one board can be reused across many sessions. **Launch**
  drops straight into the console for that run.
Wheel of Fortune's tabs, under its **⚙**:

- **Puzzles** (`puzzles.html`) — your Wheel of Fortune library. You type an **answer** and a
  **category**; the app lays the board out for you.
- **Wheel Sessions** (`wheel-sessions.html`) — the running order of puzzles, one per round.

Family Feud's tabs, under its **⚙**:

- **Surveys** (`surveys.html`) — your Family Feud library. You type a **question** and its
  **answers**; the app ranks them and builds the board (and will work out the points too).
- **Feud Sessions** (`feud-sessions.html`) — the running order: which surveys play, whether
  each is a single, double or triple round, and the five on the Fast Money card.

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

### Installing it as an app

Chrome (desktop or mobile) can install Game Show Studio like a native app — an icon
install button in the address bar, or **⋮ → Install Game Show Studio**. Installed, it
opens in its own window with no address bar, works offline for pages you've already
visited, and needs no reinstall to get updates — it's still the same hosted app under
the hood, just launched without a browser chrome around it.

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

---

## Wheel of Fortune

Open it from the **Wheel of Fortune** card on Home (its **⚙** holds the puzzle library and
the session planner), or from the **🎡 Open Wheel Console** button at the top.
It runs the same two-window way as Jeopardy: **Control** on your laptop, **TV Display**
on the big screen (**🖥 TV Display** opens it).

### Writing puzzles

In **Puzzles** you enter two things — the **answer** and the **category**. That's it.
The app wraps the answer across the board's four rows without splitting words, balances
the line lengths and centres each line, exactly as the show does. The board next to the
fields is the real thing, so you can see the layout as you type. If an answer can't fit,
it tells you why instead of letting you find out mid-show.

**⚡ Bulk add** takes a whole list at once — one per line, optionally `CATEGORY | ANSWER`.

### Round types

Every round in a session has a type, set in **Wheel Sessions** next to the puzzle.
The console reshapes itself around whichever one is up, so there's only ever one set
of controls on screen.

- **🎡 Standard** — the wheel round. Its stakes come off the wheel.
- **⚡ Toss-up** — nobody has a turn. The board uncovers itself one tile at a time and
  the first player to buzz in gets a single guess at a fixed prize. Wrong and they're
  locked out while the tiles keep coming; right and they take the money *and* control
  of the next round. Buzz someone in with the 🔔 on their card, or press **1**–**9**.
- **🏆 Bonus** — one player against the clock. It starts with whoever's had the best
  night (or press 🏆 on anyone's card to pick them), gives them **R S T L N E** free,
  takes **three consonants and a vowel**, then puts **ten seconds** on a countdown the
  whole room can see.

### Running a standard round

The player whose turn it is can **Spin**, **Buy a vowel** ($250) or **Solve**.

- **Spin** — the wheel replaces the puzzle while it turns, then hands the screen back.
  Land on cash and they call a consonant, worth that much per tile. **Bankrupt** wipes
  their round money, **Lose a Turn** just ends it, and **Free Play** lets them call
  anything with nothing to lose.
- **Wrong letter** — the turn passes. **Solve** — mark it right or wrong; solving pays out
  the round money (minimum $1,000) and the totals carry into the next round.
- **Next round →** moves on; the player who solved starts the next one.

Everything else the room can throw at you is under **⚙ Overrides**: force a Bankrupt or
Lose a Turn, un-call a letter, reveal the puzzle, or add and subtract money by hand.

### Host keyboard shortcuts

The buttons show their key, and the shortcuts only mean one thing at a time:

| When | Key | Does |
| --- | --- | --- |
| Their turn | `Space` | Spin — or start the toss-up / bonus round |
| Their turn | `V` | Buy a vowel |
| Their turn | `S` | Solve |
| Their turn | `→` | Skip to the next player |
| Calling or picking a letter | `A`–`Z` | Call that letter |
| Calling a letter | `Esc` | Cancel |
| Solving | `Y` / `N` | Right / wrong |
| Toss-up reveal | `1`–`9` | Buzz that player in |
| Toss-up reveal | `Space` | Pause / resume the reveal |
| Bonus, board up | `Space` | Start the ten seconds |
| Round over | `Space` | Next round |

Hovering a letter highlights the tiles it would turn, so you can confirm a call at a glance.

### Phones (optional)

Two ways to play, switched under **📱 Phones**:

- **🗣 Verbal** (default) — players say their letter, you click it. No phones, no internet.
- **📱 Phone picks** — **Create a room**, then show the code (**📺 Show QR on TV**).
  Players join on their phones and whoever's turn it is gets their own letter grid, a
  Spin button and a Solve box. Solving is **checked automatically** — spelling,
  punctuation and case don't matter. Everyone who joins is added as a player here.
  In a **toss-up** every phone shows one big **BUZZ IN** button instead, and the
  server hands the round to whichever one reaches it first.

The phone service is the same one the buzzers use, so it needs an internet connection
and a deployed copy of `buzzer/`. Verbal mode needs neither.

---

## Family Feud

Open it from the **Family Feud** card on Home (its **⚙** holds the survey library and the
session planner). Same two windows as the others: **Control** on your laptop, **TV Display**
on the big screen (**🖥 TV Display** opens it).

### Writing surveys

In **Surveys** you type a **question** and its **answers**. The board builds itself —
ranked by points, laid out one column or two the way the set is. Points are optional:
**✨ Work out the points** fills in a believable survey ladder (a big top answer, a long
tail, adding up to 100) that you can then edit.

Each answer also takes an **also accept** list — other wordings that should count as the
same answer. You rarely need it, because the console matches what the room actually says
(see below), but it's there for the ones only your family would say.

**⚡ Bulk add** takes a whole night at once: a question, its answers under it, a blank line
between surveys. Add `| 34` after an answer to set its points, or leave them off.

### Planning a night

In **Feud Sessions** you pick the surveys that play as rounds and set what each is worth —
**single**, **double** or **triple** — plus the five surveys on the **Fast Money** card.
Sessions reference the library, so one survey can play in many nights.

### The face-off

**👐 Start the face-off** puts a countdown on the TV and arms the buzzers. The two players
at the front of each family's line are the ones who can buzz; whoever gets there first
answers, and the other is locked out. If a family isn't on phones, buzz for them with
**A** / **B**.

Give the top answer and that family takes the board outright. Anything else and the other
player gets one go — the higher-ranked answer wins the board. If neither finds anything,
the next two players face off instead.

### Playing the board

The fastest thing you can do is **type what they said and press Enter**.

The console matches it against the board the way you would: it forgives spelling,
plurals and the words around the answer, so *"grab a coffee"* finds **Make coffee** and
*"scroll on their phone"* finds **Check their phone** — but *"drink tea"* doesn't find
**Drink coffee**, because it's a different answer. When it isn't sure it shows you the
three closest with a confidence on each; click one, or press **↓** and Enter. Enter with
nothing close is a **strike**. You can always just click the answer on the board instead —
the host's board shows what's behind every slot.

Three strikes and the other family gets **one guess to steal the lot**. Right and they
take the whole board; wrong and the family who built it keeps it. Either way the rest of
the answers turn over, and the pot goes up by the round's multiplier.

### Fast Money

Two players, five questions, one clock each — 20 seconds, then 25. Type each answer and
press Enter; **Tab** passes and puts that question at the back of the queue so you come
back to it if the clock allows. The app scores every answer against the survey as you go.

When the turn ends you **reveal the scores one at a time** (space bar) — ding for a hit,
buzz for nothing — then bring in the second player, whose answers stay off the board until
their turn. A repeat of the first player's answer is **flagged the moment you type it**,
which is exactly when you need to ask for a different one. Any score can be corrected by
hand before it's revealed. Clear the target (200 by default) and the family wins.

### Host keyboard shortcuts

| When | Key | Does |
| --- | --- | --- |
| Round not started | `Space` | Start the face-off |
| Buzzers armed | `A` / `B` | Buzz for that family |
| Anywhere | Type + `Enter` | Match what they said, or take a strike |
| Answer box | `↓` `↑` | Move between the suggested answers |
| Anywhere | `X` | Strike |
| Board up | `1`–`8` | Reveal that answer |
| Round over | `Space` | Next round |
| Fast Money | `Space` | Start the clock / reveal the next score |
| Fast Money | `Tab` | Pass |

### Rule variations

**⚙ Setup** holds the ones worth changing mid-night: verbal or phone answers, face-off
buzzers on or off and how long the countdown runs, how many strikes, whether the rest of
the board turns over at the end of a round, auto-advance, whether Fast Money plays at all,
its target and both clocks, and how fast the board animates. **⚙ Overrides** is for putting
the game back where it should be — adjust a score, un-reveal an answer, hand the board to
the other family, or award the pot by hand.

### Phones (optional)

Under **📱 Phones**, **Create a room** and show the code (**📺 Show QR on TV**). Everyone
who joins is added to a family, filling the two sides evenly — move anyone across in Setup.

- **🗣 Verbal** (default) — the room answers out loud and you type it. No phones needed.
- **📱 Phone answers** — the player whose turn it is gets a box on their phone. Their
  answer arrives on your console as a card showing what they said and what it matches;
  nothing reaches the board until you **accept** it. Face-off buzzers work either way.

In Fast Money the questions go to the contestant's phone one at a time with the clock on
it, and they can pass from there.

## Good to know

- **Everything is saved** as you go (scores, which board or round, used tiles, called
  letters). If a window refreshes or reopens, it picks up where you left off — including
  mid-spin.
- **Photos are resized when you add them** (max 1400px) — a straight-from-the-phone
  photo is far bigger than the browser will let a board store. The Editor shows how
  much media storage you're using; if it ever fills up, **🗜 Free up space** shrinks
  the photos already stored instead of you having to delete clues.
- Needs an **internet connection** (the boards load their images, and Buzzonk is online).
- To **start a brand‑new game**, open **⚙ Setup → Reset everything**.
- When you're completely done, just close the Terminal window (that stops the server).

## Files

- `home.html` — Game Show Studio home screen (the entry point).
- `settings.html` — one settings page per game (`?game=jeopardy|wheel|family-feud`), tabbed
  across whatever screens that game declares in `games.js`. Each standalone library/session
  page below is the *same* tab, reachable directly by its own URL too.
- `boards.html` · `editor.html` · `sessions.html` — board library, board editor, session planner.
- `index.html` — the live Jeopardy console (both Control and TV views).
- `play-board.html` — renders a data-model board for the console (replaces the static boards
  when you launch from a session/editor; the console drives it unchanged).
- `puzzles.html` · `wheel-sessions.html` — the Wheel of Fortune puzzle library and running orders.
- `wheel.html` — the live Wheel console (both Control and TV views).
- `surveys.html` · `feud-sessions.html` — the Family Feud survey library and running orders.
- `feud.html` — the live Family Feud console (both Control and TV views); its logic lives in
  `platform/ui/feud-console.js`.
- `platform/core/*` — data models, store, repositories, board importer, asset system, and each
  game's own domain core (`wheel.js`: puzzles, the board layout engine, the wedges, the rules —
  `feud.js`: surveys, the points ladder, the answer matcher, the rules).
- `platform/ui/*` — design system (`theme.css`) and shared components (`ui.js`, `board-view.js`,
  `puzzle-board.js`, `wheel-view.js`, `feud-board.js`, `sfx.js`, `pwa.js`), plus `panels/` — library
  and session screens as mountable panels, so a standalone page and a game's settings tab are the
  same code.
- `manifest.json`, `sw.js`, `icons/*`, `offline.html` — what makes the app installable: the PWA
  manifest, a network-first service worker (falls back to cache only when there's no connection,
  so it never fights `serve.py`'s "never cache" rule), the app icons, and the page shown for a
  route you haven't opened before while offline. `platform/ui/pwa.js` registers the service worker
  on every page and shows the install button on the top-level ones.
- `serve.py` — the local web server the launcher starts. It's `http.server` plus "never cache",
  so an update can't leave your browser running half of the old app.
- `board1.html`, `board2.html` — the original static boards (kept as a fallback; their content
  is also imported into the editable library on first run).
- `buzzer/` — the buzzer service (Buzzonk-compatible).
- `Start Trivia Night.command` — the double‑click launcher.
