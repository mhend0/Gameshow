# Trivia Buzzer

Your own reliable buzzer system. Players join from a link/QR on their phones, tap **Buzz**,
and the **first tap to reach the server wins** — decided by one atomic operation, so ties are
impossible and there's nothing flaky to "glitch."

- **Host console** → `/host` — create a room, show the join link/QR, open/lock buzzers, see the
  live order, keep scores.
- **Players** → `/` (or the join link, e.g. `…/?code=ABCD`) — name + big Buzz button.
- **TV display** → `/display?code=ABCD` — a clean, big "who buzzed" board. Embeddable in your
  Jeopardy console's TV screen (it's our own app, so it frames fine — unlike buzzonk).

## How it stays reliable
- The **server decides buzz order** the instant your tap arrives (one atomic Redis script).
  Fairness never depends on phone clocks or delivery speed.
- **No WebSockets.** Screens poll for the already-decided result (~0.3–0.9s). Nothing to drop or
  reconnect — if a phone's wifi blips, the next poll just picks back up.
- **State lives in Redis** (Upstash), so nothing is lost if a serverless function cold-starts.
- First buzz **auto-locks** the room. Wrong answer? Hit **Re-open** to let the rest buzz. New
  question? Hit **Open buzzers** to clear and start fresh.

---

## Deploy to Vercel (≈10 minutes)

**1. Put this folder on Vercel**

Easiest with the CLI (from inside `buzzer/`):
```bash
npx vercel        # link/create the project, first deploy
npx vercel --prod # production deploy
```
Or push the `buzzer/` folder to a GitHub repo and **Import** it in the Vercel dashboard
(framework preset: **Other** — no build step needed).

**2. Add the state store (Upstash Redis) — free, done inside Vercel**

Vercel dashboard → your project → **Storage** → **Create Database** → pick **Upstash (Redis)**
from the Marketplace → **Connect** it to this project. That auto-adds the env vars
(`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). Then **redeploy** once so the functions
pick them up. (Free tier is plenty for a trivia night; pay-as-you-go is pennies if you ever go over.)

**3. Use it**

- Host: `https://YOUR-APP.vercel.app/host` (bookmark it — your room is remembered on that device)
- Players: the link the host shows, e.g. `https://YOUR-APP.vercel.app/?code=ABCD`
- TV: `https://YOUR-APP.vercel.app/display?code=ABCD`

---

## Try it locally first (no Upstash needed)
```bash
node dev-server.mjs
# → http://localhost:3000/host
```
This runs an **in-memory** copy of the same API so you can test the whole flow on your laptop.
(Production on Vercel uses `/api/*.js` + Upstash instead.)

## Running the game
1. Open **/host**, click **Create a room**. Share the link/QR with players.
2. Per question: **Open buzzers** → players race → first buzz shows 🥇 and locks the room.
3. **Re-open** (same question, if the first answer was wrong) or **Open buzzers** (next question).
4. Award points with the **+ / –** next to each player (or just use your Jeopardy console's scores).

## Wiring it into the Jeopardy console (optional)
Once deployed, the TV display column can embed `…/display?code=ABCD` directly — fully integrated,
no floating window. Send me the deployed URL and I'll wire it in.

## Files
- `api/*.js` — Vercel serverless functions (create, join, buzz, state, host)
- `lib/store.js` — Redis client + helpers
- `index.html` / `host.html` / `display.html` — player / host / TV pages
- `dev-server.mjs` — local in-memory test server
- `vercel.json` — enables clean URLs (`/host`, `/display`)
