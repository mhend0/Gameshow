// The Academy, on screen.
//
// A single-player trainer, so unlike every other surface in this codebase
// there is no room, no polling and no second window to stay in step with —
// which makes this the one poker screen that is purely a view over local
// state. All of the thinking is in platform/core/poker-academy.js; this file
// decides only what it looks like and when.
//
// Three screens, one at a time: the lesson map, a lesson (its introduction
// then its questions), and the result. They're rendered by swapping the whole
// root rather than by mutating in place — none of them shares any structure
// with the others, so diffing would be more code and more ways to be wrong.
//
// Cards are drawn with the table's own `cardNode`, so a nine of hearts here is
// pixel-identical to a nine of hearts on the TV. That matters more than it
// sounds: the entire purpose of this mode is that what you learn transfers to
// the real table, and a card that looked different would quietly work against
// that.

import { el, confirmDialog, toast } from "./ui.js";
import { cardNode } from "./poker-table.js";
import { formatChips } from "../core/poker-chips.js";
import { loadPokerSettings, pokerSettings } from "../core/poker-settings.js";
import { getCardTheme } from "../core/poker-themes.js";
import {
  LESSONS, getLesson, unlockedLessons, generateLesson, gradeDrill,
  ACHIEVEMENTS,
} from "../core/poker-academy.js";
import { loadProgress, recordAttempt, resetProgress } from "../core/poker-academy-progress.js";

/**
 * @param {HTMLElement} root
 * @returns {{destroy:()=>void}}
 */
export function mountAcademy(root) {
  ensureStyles();
  let progress = loadProgress();

  /*
   * `cardNode` draws itself entirely from CSS custom properties, which the
   * live table sets when a theme is applied — on its own it renders a card
   * with no face at all. So the chosen theme has to be painted onto an
   * ancestor here too.
   *
   * Using the player's own saved theme rather than a fixed one is the point:
   * whatever the cards look like on the TV is what they look like while you're
   * learning them, and the whole value of this mode is that it transfers.
   */
  function paintCardTheme() {
    const { vars } = getCardTheme(loadPokerSettings().cardTheme);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  }
  paintCardTheme();
  // The settings screen is often open in another tab; pick up a change there
  // without needing a reload, exactly as the TV does.
  const stopWatching = pokerSettings.subscribe(paintCardTheme);

  /* ================================================================== map */

  function showMap() {
    const unlocked = new Set(unlockedLessons(progress));
    const passed = LESSONS.filter((l) => (progress.lessons[l.key] || {}).passed).length;
    const { answered, correct } = progress.totals;
    const accuracy = answered ? Math.round((correct / answered) * 100) : null;

    root.innerHTML = "";
    root.append(
      el("header", { class: "ac-head" }, [
        el("div", {}, [
          el("h1", { text: "The Academy" }),
          el("p", { text: "Learn Hold'em properly — hand rankings, odds, the price of a call, and when to let go." }),
        ]),
        el("div", { class: "ac-scoreboard" }, [
          stat(`${passed}/${LESSONS.length}`, "lessons passed"),
          stat(answered ? String(answered) : "—", "questions"),
          stat(accuracy == null ? "—" : `${accuracy}%`, "right"),
        ]),
      ]),

      el("div", { class: "ac-lessons" }, LESSONS.map((lesson) => lessonCard(lesson, unlocked))),

      el("section", { class: "ac-section" }, [
        el("h2", { text: "Achievements" }),
        el("div", { class: "ac-badges" }, ACHIEVEMENTS.map((a) => {
          const got = progress.achievements.includes(a.key);
          return el("div", { class: `ac-badge ${got ? "got" : ""}`, title: a.hint }, [
            el("span", { class: "ac-badge-glyph", text: a.glyph }),
            el("span", { class: "ac-badge-name", text: a.name }),
            el("small", { text: got ? "Earned" : a.hint }),
          ]);
        })),
      ]),

      el("div", { class: "ac-footer" }, [
        el("button", {
          class: "btn sm ghost", text: "Start over",
          onClick: async () => {
            if (!(await confirmDialog({
              title: "Start over?",
              message: "Every lesson goes back to locked and your achievements are cleared. The lessons themselves don't change.",
              confirmText: "Start over", danger: true,
            }))) return;
            progress = resetProgress();
            toast("Progress cleared");
            showMap();
          },
        }),
      ]),
    );
  }

  const stat = (value, label) => el("div", { class: "ac-stat" }, [
    el("strong", { text: value }), el("small", { text: label }),
  ]);

  function lessonCard(lesson, unlocked) {
    const record = progress.lessons[lesson.key] || {};
    const open = unlocked.has(lesson.key);
    const state = record.passed ? "passed" : open ? "open" : "locked";
    const needs = lesson.requires ? getLesson(lesson.requires) : null;

    return el("button", {
      class: `ac-lesson ${state}`,
      disabled: !open,
      onClick: () => open && showIntro(lesson),
    }, [
      el("span", { class: "ac-lesson-glyph", text: state === "locked" ? "🔒" : lesson.glyph }),
      el("span", { class: "ac-lesson-body" }, [
        el("strong", { text: lesson.title }),
        el("small", {
          text: open
            ? lesson.blurb
            : `Unlocks when you pass ${needs ? needs.title : "the lesson before it"}.`,
        }),
      ]),
      el("span", { class: "ac-lesson-mark" }, [
        record.bestOutOf
          ? el("span", { class: "ac-best", text: `${record.bestScore}/${record.bestOutOf}` })
          : null,
        record.passed ? el("span", { class: "ac-tick", text: "✓" }) : null,
      ].filter(Boolean)),
    ]);
  }

  /* =============================================================== lesson */

  function showIntro(lesson) {
    const record = progress.lessons[lesson.key] || {};
    root.innerHTML = "";
    root.append(
      backBar(lesson.title),
      el("div", { class: "ac-pane" }, [
        el("div", { class: "ac-intro" }, [
          el("div", { class: "ac-intro-glyph", text: lesson.glyph }),
          el("h2", { text: lesson.title }),
          el("p", { class: "ac-intro-blurb", text: lesson.blurb }),
          el("ul", { class: "ac-teaches" }, lesson.teaches.map((line) => el("li", { text: line }))),
          el("p", { class: "ac-intro-rule", text:
            `${lesson.questions} questions — get ${lesson.passMark} right to pass.` }),
          el("button", {
            class: "btn primary big", text: record.attempts ? "Try again" : "Start",
            // A retry gives the same questions; a pass moves on to fresh ones,
            // so practising a lesson you've beaten isn't just re-reading it.
            onClick: () => runLesson(lesson, record.passed ? (record.attempts || 0) * lesson.questions : 0),
          }),
        ]),
      ]),
    );
  }

  function backBar(title) {
    return el("div", { class: "ac-backbar" }, [
      el("button", { class: "btn sm ghost", text: "← Lessons", onClick: showMap }),
      el("span", { class: "ac-backbar-title", text: title }),
    ]);
  }

  /* ========================================================== the questions */

  function runLesson(lesson, offset) {
    const drills = generateLesson(lesson.key, { offset });
    let at = 0;
    let score = 0;
    /** Set once the current question has been answered — locks the buttons. */
    let answered = false;

    const dots = el("div", { class: "ac-dots" });
    const stage = el("div", { class: "ac-stage" });

    root.innerHTML = "";
    root.append(backBar(lesson.title), el("div", { class: "ac-pane" }, [dots, stage]));

    function paintDots() {
      dots.innerHTML = "";
      drills.forEach((_, i) => dots.appendChild(el("i", {
        class: `ac-dot ${i < at ? "done" : ""} ${i === at ? "now" : ""}`,
      })));
      dots.appendChild(el("span", { class: "ac-count", text: `${Math.min(at + 1, drills.length)} / ${drills.length}` }));
    }

    function paintQuestion() {
      answered = false;
      paintDots();
      const drill = drills[at];

      const options = el("div", { class: "ac-options" });
      const verdict = el("div", { class: "ac-verdict" });

      drill.options.forEach((label, i) => {
        options.appendChild(el("button", {
          class: "ac-option", text: label,
          onClick: () => {
            if (answered) return;
            answered = true;
            const result = gradeDrill(drill, i);
            if (result.correct) score++;

            // Mark the chosen one and, when it was wrong, the one that wasn't.
            [...options.children].forEach((node, j) => {
              node.disabled = true;
              if (j === drill.answer) node.classList.add("right");
              if (j === i && !result.correct) node.classList.add("wrong");
            });

            verdict.className = `ac-verdict show ${result.correct ? "right" : "wrong"}`;
            verdict.innerHTML = "";
            verdict.append(
              el("strong", { text: result.correct ? "Right" : `Not quite — ${result.should}` }),
              el("p", { text: result.explain }),
              el("button", {
                class: "btn primary", text: at === drills.length - 1 ? "See how you did" : "Next question",
                onClick: () => {
                  at++;
                  if (at >= drills.length) finish();
                  else paintQuestion();
                },
              }),
            );
            verdict.querySelector("button").focus();
          },
        }));
      });

      stage.innerHTML = "";
      stage.append(
        el("h2", { class: "ac-question", text: drill.question }),
        drill.detail ? el("p", { class: "ac-detail", text: drill.detail }) : null,
        spotNode(drill.spot),
        options,
        verdict,
      );
    }

    function finish() {
      const outcome = recordAttempt(lesson.key, score, drills.length);
      progress = outcome.progress;
      showResult(lesson, score, drills.length, outcome);
    }

    paintQuestion();
  }

  /**
   * The cards, board and money a question is about.
   *
   * Everything is optional — a pot-odds question has money and no cards, a
   * rankings question has cards and no money — so each block only appears
   * when the drill actually gave it something to draw.
   */
  function spotNode(spot) {
    if (!spot) return null;
    const parts = [];

    if (spot.hole) {
      parts.push(el("div", { class: "ac-hand" }, [
        el("small", { text: spot.opponentHole ? "First hand" : "You" }),
        el("div", { class: "ac-cards" }, spot.hole.map((c) => cardNode(c, { big: true }))),
      ]));
    }
    if (spot.opponentHole) {
      parts.push(el("div", { class: "ac-hand" }, [
        el("small", { text: "Second hand" }),
        el("div", { class: "ac-cards" }, spot.opponentHole.map((c) => cardNode(c, { big: true }))),
      ]));
    }
    if (spot.board && spot.board.length) {
      parts.push(el("div", { class: "ac-hand board" }, [
        el("small", { text: "The board" }),
        el("div", { class: "ac-cards" }, spot.board.map((c) => cardNode(c, { big: true }))),
      ]));
    }

    const money = [];
    if (spot.pot != null) money.push(el("span", {}, [el("small", { text: "Pot" }), el("b", { text: `🪙 ${formatChips(spot.pot)}` })]));
    if (spot.toCall != null) money.push(el("span", {}, [el("small", { text: "To call" }), el("b", { text: `🪙 ${formatChips(spot.toCall)}` })]));
    if (money.length) parts.push(el("div", { class: "ac-money" }, money));

    return parts.length ? el("div", { class: "ac-spot" }, parts) : null;
  }

  /* =============================================================== result */

  function showResult(lesson, score, outOf, outcome) {
    const perfect = score === outOf;
    const next = LESSONS.find((l) => l.requires === lesson.key);
    const nextOpen = next && unlockedLessons(progress).includes(next.key);

    root.innerHTML = "";
    root.append(
      backBar(lesson.title),
      el("div", { class: "ac-pane" }, [
        el("div", { class: `ac-result ${outcome.passed ? "passed" : "failed"}` }, [
          el("div", { class: "ac-result-glyph", text: perfect ? "✨" : outcome.passed ? "✅" : "📖" }),
          el("h2", { text: perfect ? "Every one." : outcome.passed ? "Passed" : "Not this time" }),
          el("div", { class: "ac-score", text: `${score} / ${outOf}` }),
          el("p", { text: outcome.passed
            ? (next ? `${next.title} is now open.` : "That's the last lesson — you've been through the lot.")
            : `You needed ${lesson.passMark}. The questions stay the same if you go again, so work out the ones you missed.` }),

          outcome.unlocked.length
            ? el("div", { class: "ac-unlocked" }, [
                el("small", { text: outcome.unlocked.length > 1 ? "Achievements earned" : "Achievement earned" }),
                el("div", { class: "ac-badges tight" }, outcome.unlocked.map((a) =>
                  el("div", { class: "ac-badge got" }, [
                    el("span", { class: "ac-badge-glyph", text: a.glyph }),
                    el("span", { class: "ac-badge-name", text: a.name }),
                  ]))),
              ])
            : null,

          el("div", { class: "ac-result-actions" }, [
            el("button", { class: "btn", text: "Try again", onClick: () => showIntro(lesson) }),
            nextOpen
              ? el("button", { class: "btn primary", text: `Next: ${next.title}`, onClick: () => showIntro(next) })
              : el("button", { class: "btn primary", text: "Back to lessons", onClick: showMap }),
          ]),
        ]),
      ]),
    );
  }

  showMap();

  return {
    destroy() {
      if (typeof stopWatching === "function") stopWatching();
      root.innerHTML = "";
    },
  };
}

/* =================================================================== styles */

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  document.head.appendChild(el("style", { text: `
  .ac-head { display:flex; gap:24px; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; margin-bottom:22px; }
  .ac-head h1 { font-size:30px; margin:0; }
  .ac-head p { margin:6px 0 0; color:var(--text-2); max-width:52ch; line-height:1.55; }
  .ac-scoreboard { display:flex; gap:22px; }
  .ac-stat { display:flex; flex-direction:column; gap:2px; }
  .ac-stat strong { font-size:24px; color:var(--gold); font-variant-numeric:tabular-nums; }
  .ac-stat small { font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--text-2); font-weight:800; }

  .ac-lessons { display:grid; gap:10px; grid-template-columns:minmax(0,1fr); }
  @media (min-width:820px){ .ac-lessons { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  .ac-lesson { display:flex; align-items:center; gap:14px; text-align:left; font:inherit; cursor:pointer;
    padding:14px 16px; border-radius:var(--r-md); background:var(--bg-2); color:var(--text-0);
    border:1px solid var(--line); transition:transform var(--dur) var(--ease), border-color var(--dur); }
  .ac-lesson:hover:not(:disabled) { transform:translateY(-2px); border-color:color-mix(in srgb,var(--accent) 50%,var(--line)); }
  .ac-lesson:disabled { cursor:not-allowed; opacity:.45; }
  .ac-lesson.passed { border-color:color-mix(in srgb,var(--good) 45%,var(--line)); }
  .ac-lesson-glyph { font-size:26px; flex:none; width:34px; text-align:center; }
  .ac-lesson-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .ac-lesson-body strong { font-size:15px; }
  .ac-lesson-body small { color:var(--text-2); font-size:12.5px; line-height:1.45; }
  .ac-lesson-mark { flex:none; display:flex; align-items:center; gap:8px; }
  .ac-best { font-size:12px; font-weight:800; color:var(--text-2); font-variant-numeric:tabular-nums; }
  .ac-tick { color:var(--good); font-weight:900; font-size:17px; }

  .ac-section { margin-top:30px; }
  .ac-section h2 { font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--text-2); margin:0 0 12px; }
  .ac-badges { display:grid; gap:9px; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); }
  /* The result screen shows only what was just earned — a row, not a grid,
     so two badges sit beside each other rather than stacking in a column. */
  .ac-badges.tight { display:flex; flex-wrap:wrap; justify-content:center; }
  .ac-badges.tight .ac-badge { min-width:130px; }
  .ac-badge { display:flex; flex-direction:column; align-items:center; gap:3px; text-align:center;
    padding:12px 10px; border-radius:var(--r-sm); background:var(--bg-2); border:1px solid var(--line-soft); opacity:.5; }
  .ac-badge.got { opacity:1; border-color:color-mix(in srgb,var(--gold) 45%,var(--line)); }
  .ac-badge-glyph { font-size:24px; filter:grayscale(1); }
  .ac-badge.got .ac-badge-glyph { filter:none; }
  .ac-badge-name { font-size:12.5px; font-weight:800; }
  .ac-badge small { font-size:10.5px; color:var(--text-2); line-height:1.4; }

  .ac-footer { margin-top:26px; display:flex; justify-content:center; }

  /* ---- a lesson ------------------------------------------------------- */
  .ac-backbar { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
  .ac-backbar-title { font-weight:800; letter-spacing:.04em; color:var(--text-2); font-size:13px; }
  .ac-pane { max-width:720px; margin:0 auto; }

  .ac-intro { text-align:center; display:flex; flex-direction:column; align-items:center; gap:12px; }
  .ac-intro-glyph { font-size:52px; }
  .ac-intro h2 { font-size:26px; margin:0; }
  .ac-intro-blurb { margin:0; color:var(--text-1); font-size:15px; }
  .ac-teaches { text-align:left; margin:8px 0 0; padding:0 0 0 20px; color:var(--text-1);
    line-height:1.7; max-width:56ch; }
  .ac-teaches li { margin-bottom:6px; }
  .ac-intro-rule { margin:6px 0 4px; font-size:12.5px; color:var(--text-2); }

  .ac-dots { display:flex; align-items:center; gap:6px; margin-bottom:20px; justify-content:center; }
  .ac-dot { width:8px; height:8px; border-radius:50%; background:var(--bg-3); display:block; }
  .ac-dot.done { background:var(--accent); }
  .ac-dot.now { background:var(--gold); transform:scale(1.35); }
  .ac-count { margin-left:8px; font-size:11.5px; font-weight:800; color:var(--text-2); font-variant-numeric:tabular-nums; }

  .ac-question { font-size:21px; margin:0 0 6px; text-align:center; line-height:1.35; }
  .ac-detail { margin:0 0 18px; text-align:center; color:var(--text-2); font-size:13px; }

  /* The card themes size their backs in container units (cqw), so the cards
     need a container to measure against or the pattern collapses. */
  .ac-spot { container-type:inline-size;
    display:flex; flex-wrap:wrap; gap:26px; justify-content:center; align-items:flex-end;
    padding:20px 18px; margin-bottom:20px; border-radius:var(--r-md);
    background:radial-gradient(120% 140% at 50% 0%, color-mix(in srgb,var(--accent) 22%,var(--bg-1)), var(--bg-1));
    border:1px solid var(--line); }
  /* The board is the shared part of the question, so it's set apart from the
     hands rather than sitting in the same row as just another group. */
  .ac-hand.board { padding-left:26px; border-left:1px solid var(--line); }
  .ac-hand { display:flex; flex-direction:column; align-items:center; gap:6px; }
  .ac-hand small { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--text-2); font-weight:800; }
  .ac-cards { display:flex; gap:5px; }
  /* The table sizes cards in container units; here they're just a fixed size. */
  .ac-spot .pt-card { width:52px; height:74px; border-radius:6px; gap:2px; }
  .ac-spot .pt-card-rank { font-size:23px; }
  .ac-spot .pt-card-suit { font-size:20px; }
  .ac-money { display:flex; gap:18px; align-items:flex-end; }
  .ac-money span { display:flex; flex-direction:column; align-items:center; gap:2px; }
  .ac-money small { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--text-2); font-weight:800; }
  .ac-money b { font-size:19px; color:var(--gold); font-variant-numeric:tabular-nums; }

  .ac-options { display:grid; gap:9px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
  .ac-option { font:inherit; cursor:pointer; padding:15px 14px; font-size:15px; font-weight:700;
    border-radius:var(--r-sm); background:var(--bg-2); color:var(--text-0); border:1px solid var(--line);
    transition:transform var(--dur) var(--ease), border-color var(--dur), background var(--dur); }
  .ac-option:hover:not(:disabled) { transform:translateY(-2px); border-color:var(--accent); }
  .ac-option:disabled { cursor:default; opacity:.6; }
  .ac-option.right { background:color-mix(in srgb,var(--good) 28%,var(--bg-2)); border-color:var(--good); opacity:1; }
  .ac-option.wrong { background:color-mix(in srgb,var(--bad) 28%,var(--bg-2)); border-color:var(--bad); opacity:1; }

  .ac-verdict { max-height:0; overflow:hidden; transition:max-height var(--dur); }
  .ac-verdict.show { max-height:420px; margin-top:18px; padding:16px; border-radius:var(--r-md);
    background:var(--bg-2); border:1px solid var(--line); }
  .ac-verdict strong { display:block; font-size:16px; margin-bottom:6px; }
  .ac-verdict.right strong { color:var(--good); }
  .ac-verdict.wrong strong { color:var(--bad); }
  .ac-verdict p { margin:0 0 14px; color:var(--text-1); line-height:1.6; font-size:14px; }

  /* ---- the result ----------------------------------------------------- */
  .ac-result { text-align:center; display:flex; flex-direction:column; align-items:center; gap:10px; }
  .ac-result-glyph { font-size:56px; }
  .ac-result h2 { font-size:26px; margin:0; }
  .ac-result .ac-score { font-size:40px; font-weight:900; font-variant-numeric:tabular-nums; }
  .ac-result.passed .ac-score { color:var(--good); }
  .ac-result.failed .ac-score { color:var(--text-2); }
  .ac-result p { margin:0; color:var(--text-1); max-width:46ch; line-height:1.6; }
  .ac-unlocked { margin-top:12px; display:flex; flex-direction:column; gap:8px; align-items:center; }
  .ac-unlocked small { font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--gold); font-weight:800; }
  .ac-result-actions { display:flex; gap:10px; margin-top:18px; flex-wrap:wrap; justify-content:center; }
  ` }));
}
