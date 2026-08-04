// Tests for the Academy.
//
// A trainer's one unforgivable bug is confidently teaching something false, so
// the bulk of this file re-derives each drill's answer independently and checks
// the drill agrees. Where a generator says "9 outs", the test counts the cards
// itself; where it says "call", the test does the arithmetic itself. Asserting
// only that a drill *has* an answer would let a wrong one through, and a
// beginner would remember the wrong one.
//
// Every generator is exercised across hundreds of seeds rather than one, since
// these deal real cards and the interesting failures are the rare boards.
//
// Run with `node --test platform/core/*.test.js`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LESSONS, getLesson, unlockedLessons, DRILL_KINDS, generateDrill, generateLesson,
  gradeDrill, drillSeed, ACHIEVEMENTS, earnedAchievements, emptyProgress,
  normaliseProgress, applyAttempt,
} from "./poker-academy.js";
import { bestHandRank, compareHandRanks } from "./poker.js";
import { classifyDraws, outsToEquity, potOdds, equity } from "./poker-odds.js";

/** Enough seeds to hit the awkward boards, few enough to stay quick. */
const SEEDS = Array.from({ length: 150 }, (_, i) => i * 7919 + 13);

/** The draws callOrFold is allowed to build a question around. */
const DRAW_TYPES = ["flush", "openEnded", "doubleGutshot", "gutshot"];

/* ------------------------------------------------------------ curriculum */

describe("the curriculum", () => {
  test("every lesson is complete and coherent", () => {
    for (const lesson of LESSONS) {
      assert.ok(lesson.title, `${lesson.key} has no title`);
      assert.ok(lesson.blurb.length > 10, `${lesson.key} has no blurb`);
      assert.ok(lesson.teaches.length >= 2, `${lesson.key} teaches nothing`);
      assert.ok(DRILL_KINDS.includes(lesson.drill), `${lesson.key} asks for a drill that doesn't exist`);
      assert.ok(lesson.questions > 0, `${lesson.key} asks nothing`);
      assert.ok(lesson.passMark > 0 && lesson.passMark <= lesson.questions,
        `${lesson.key} has an unreachable pass mark`);
    }
  });

  test("lesson keys are unique", () => {
    assert.equal(new Set(LESSONS.map((l) => l.key)).size, LESSONS.length);
  });

  test("nothing requires a lesson that doesn't exist, or itself", () => {
    const keys = new Set(LESSONS.map((l) => l.key));
    for (const lesson of LESSONS) {
      if (!lesson.requires) continue;
      assert.ok(keys.has(lesson.requires), `${lesson.key} requires the missing ${lesson.requires}`);
      assert.notEqual(lesson.requires, lesson.key, `${lesson.key} requires itself`);
    }
  });

  test("every lesson is reachable from a standing start", () => {
    // Walk the unlock graph and make sure it reaches everything — a lesson
    // gated behind a cycle would be invisible forever.
    const progress = emptyProgress();
    let reached = new Set(unlockedLessons(progress));
    for (let step = 0; step < LESSONS.length + 1; step++) {
      for (const key of [...reached]) {
        progress.lessons[key] = { attempts: 1, passed: true, bestScore: 99, bestOutOf: 99 };
      }
      reached = new Set(unlockedLessons(progress));
    }
    assert.equal(reached.size, LESSONS.length, `only reached ${[...reached].join(", ")}`);
  });

  test("exactly the opening lessons are available before anything is passed", () => {
    const open = unlockedLessons(emptyProgress());
    assert.ok(open.includes("rankings"), "you can't start anywhere");
    assert.ok(!open.includes("decisions"), "the hardest lesson is unlocked from the start");
  });
});

/* ---------------------------------------------------------- determinism */

describe("drills are reproducible", () => {
  test("the same seed always builds the same drill", () => {
    for (const kind of DRILL_KINDS) {
      const a = generateDrill(kind, 4242);
      const b = generateDrill(kind, 4242);
      assert.deepEqual(b, a, `${kind} is not deterministic`);
    }
  });

  test("different seeds build different drills", () => {
    for (const kind of DRILL_KINDS) {
      const seen = new Set(SEEDS.slice(0, 40).map((s) => JSON.stringify(generateDrill(kind, s))));
      assert.ok(seen.size > 5, `${kind} only ever produces ${seen.size} distinct questions`);
    }
  });

  test("a lesson's questions are stable, and moving on gives new ones", () => {
    const first = generateLesson("rankings");
    assert.deepEqual(generateLesson("rankings"), first, "a retry changed the questions");
    const later = generateLesson("rankings", { offset: 100 });
    assert.notDeepEqual(later, first, "moving on gave the same questions");
    assert.equal(first.length, getLesson("rankings").questions);
  });

  test("seeds are distinct across a lesson's questions", () => {
    const seeds = new Set(Array.from({ length: 50 }, (_, i) => drillSeed("outs", i)));
    assert.equal(seeds.size, 50, "two questions in a lesson share a seed");
  });

  test("an unknown drill is an error, not a silent empty question", () => {
    assert.throws(() => generateDrill("nonsense", 1), /Unknown drill/);
    assert.throws(() => generateLesson("nonsense"), /Unknown lesson/);
  });
});

/* --------------------------------------------------------------- shape */

describe("every drill is answerable", () => {
  test("options, a valid answer index, and an explanation", () => {
    for (const kind of DRILL_KINDS) {
      for (const seed of SEEDS) {
        const d = generateDrill(kind, seed);
        assert.ok(d.question.length > 5, `${kind}/${seed}: no question`);
        assert.ok(d.options.length >= 2, `${kind}/${seed}: nothing to choose between`);
        assert.ok(Number.isInteger(d.answer), `${kind}/${seed}: answer isn't an index`);
        assert.ok(d.answer >= 0 && d.answer < d.options.length,
          `${kind}/${seed}: answer ${d.answer} is outside ${d.options.length} options`);
        assert.ok(d.explain.length > 10, `${kind}/${seed}: no explanation`);
        assert.equal(new Set(d.options).size, d.options.length, `${kind}/${seed}: duplicate options`);
      }
    }
  });

  test("grading agrees with the drill's own answer", () => {
    for (const kind of DRILL_KINDS) {
      const d = generateDrill(kind, 999);
      assert.equal(gradeDrill(d, d.answer).correct, true);
      const wrong = (d.answer + 1) % d.options.length;
      assert.equal(gradeDrill(d, wrong).correct, false);
      assert.equal(gradeDrill(d, d.answer).should, d.options[d.answer]);
    }
  });

  test("cards shown to the player are always real and never repeated", () => {
    for (const kind of DRILL_KINDS) {
      for (const seed of SEEDS) {
        const { spot } = generateDrill(kind, seed);
        if (!spot) continue;
        const cards = [...(spot.hole || []), ...(spot.board || []),
          ...(spot.opponentHole || []), ...(spot.villainHole || [])];
        const codes = cards.map((c) => `${c.rank}${c.suit}`);
        assert.equal(new Set(codes).size, codes.length,
          `${kind}/${seed}: the same card was dealt twice`);
        for (const card of cards) {
          assert.ok(card.rank >= 2 && card.rank <= 14, `${kind}/${seed}: impossible rank ${card.rank}`);
          assert.ok("shdc".includes(card.suit), `${kind}/${seed}: impossible suit ${card.suit}`);
        }
      }
    }
  });
});

/* ------------------------------------------------- the answers are right */

describe("the answers are actually correct", () => {
  test("whichWins names the hand that really wins", () => {
    for (const seed of SEEDS) {
      const d = generateDrill("whichWins", seed);
      const { hole, opponentHole, board } = d.spot;
      const cmp = compareHandRanks(bestHandRank([...hole, ...board]), bestHandRank([...opponentHole, ...board]));
      const truth = cmp > 0 ? 0 : cmp < 0 ? 1 : 2;
      assert.equal(d.answer, truth, `seed ${seed}: said "${d.options[d.answer]}"`);
    }
  });

  test("countOuts counts the cards that are really there", () => {
    for (const seed of SEEDS) {
      const d = generateDrill("countOuts", seed);
      if (d.kind !== "countOuts") continue;          // fell back — covered elsewhere
      const { draws } = classifyDraws(d.spot.hole, d.spot.board);
      const counted = draws.filter((x) => x.outs > 0 && x.type !== "overcards");
      assert.ok(counted.length, `seed ${seed}: asked about a draw that isn't there`);
      assert.equal(Number(d.options[d.answer]), counted[0].outs,
        `seed ${seed}: said ${d.options[d.answer]}, really ${counted[0].outs}`);
    }
  });

  test("outsToOdds matches the exact probability, not the shortcut", () => {
    for (const seed of SEEDS) {
      const d = generateDrill("outsToOdds", seed);
      const m = d.question.match(/have (\d+) outs with (one|two) card/);
      assert.ok(m, `seed ${seed}: unreadable question "${d.question}"`);
      const truth = Math.round(outsToEquity(Number(m[1]), m[2] === "one" ? 1 : 2).exact * 100);
      assert.equal(d.options[d.answer], `${truth}%`, `seed ${seed}`);
    }
  });

  test("potOdds matches call ÷ (pot + call)", () => {
    for (const seed of SEEDS) {
      const d = generateDrill("potOdds", seed);
      const truth = Math.round(potOdds(d.spot.toCall, d.spot.pot).breakEven * 100);
      assert.equal(d.options[d.answer], `${truth}%`, `seed ${seed}`);
    }
  });

  test("potOdds offers the classic mistake as a wrong answer", () => {
    // Dividing by the pot alone instead of the pot plus the call. If that
    // never appears, the question is easier than it should be.
    let offered = 0;
    for (const seed of SEEDS) {
      const d = generateDrill("potOdds", seed);
      const mistake = `${Math.round((d.spot.toCall / d.spot.pot) * 100)}%`;
      if (d.options.includes(mistake) && d.options[d.answer] !== mistake) offered++;
    }
    assert.ok(offered > SEEDS.length / 3, `the common error was only offered ${offered} times`);
  });

  test("callOrFold compares the real chance against the real price", () => {
    for (const seed of SEEDS) {
      const d = generateDrill("callOrFold", seed);
      if (d.kind !== "callOrFold") continue;
      const { draws } = classifyDraws(d.spot.hole, d.spot.board);
      const outs = draws.filter((x) => DRAW_TYPES.includes(x.type))[0].outs;
      const chance = outsToEquity(outs, 1).exact;
      const { breakEven } = potOdds(d.spot.toCall, d.spot.pot);
      assert.equal(d.options[d.answer], chance > breakEven ? "Call" : "Fold", `seed ${seed}`);
    }
  });

  test("callOrFold only ever asks about hands that are still drawing", () => {
    for (const seed of SEEDS) {
      const d = generateDrill("callOrFold", seed);
      if (d.kind !== "callOrFold") continue;
      const { category } = classifyDraws(d.spot.hole, d.spot.board);
      assert.ok(category < 4, `seed ${seed}: asked to draw with a made straight or better`);
      assert.equal(d.spot.board.length, 4, `seed ${seed}: "one card to come" on a ${d.spot.board.length}-card board`);
    }
  });

  test("decision is graded on the expected value of the real hands", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const d = generateDrill("decision", seed);
      if (d.kind !== "decision") continue;
      const { hands } = equity([d.spot.hole, d.spot.villainHole], d.spot.board, { exact: true });
      const ev = hands[0].equity * (d.spot.pot + d.spot.toCall) - d.spot.toCall;
      assert.equal(d.options[d.answer], ev > 0 ? "Call" : "Fold",
        `seed ${seed}: EV was ${ev.toFixed(0)} but the answer was ${d.options[d.answer]}`);
    }
  });

  test("decision never asks about a spot too close to call", () => {
    // A question whose right answer turns on the third decimal place is a
    // coin flip dressed up as a lesson.
    for (const seed of SEEDS.slice(0, 60)) {
      const d = generateDrill("decision", seed);
      if (d.kind !== "decision") continue;
      const { hands } = equity([d.spot.hole, d.spot.villainHole], d.spot.board, { exact: true });
      const { breakEven } = potOdds(d.spot.toCall, d.spot.pot);
      assert.ok(Math.abs(hands[0].equity - breakEven) >= 0.03,
        `seed ${seed}: only ${Math.abs(hands[0].equity - breakEven).toFixed(3)} in it`);
    }
  });

  test("readOpponent's answer is the personality whose tell was quoted", () => {
    for (const seed of SEEDS) {
      const d = generateDrill("readOpponent", seed);
      assert.ok(d.explain.startsWith(d.options[d.answer]),
        `seed ${seed}: quoted one player's tell and answered with another`);
    }
  });

  test("neither yes/no drill is secretly always the same answer", () => {
    // A drill that's 90% "Fold" can be passed without reading the question.
    for (const kind of ["callOrFold", "decision", "position"]) {
      const answers = SEEDS.slice(0, 80)
        .map((s) => generateDrill(kind, s))
        .filter((d) => d.kind === kind)
        .map((d) => d.options[d.answer]);
      const first = answers.filter((a) => a === answers[0]).length;
      assert.ok(first / answers.length < 0.85,
        `${kind}: ${Math.round((first / answers.length) * 100)}% of answers are "${answers[0]}"`);
    }
  });
});

/* ------------------------------------------------------------- progress */

describe("progress and achievements", () => {
  test("a fresh record is empty rather than absent", () => {
    const p = emptyProgress();
    assert.deepEqual(p.lessons, {});
    assert.equal(p.totals.answered, 0);
    assert.deepEqual(p.achievements, []);
  });

  test("a corrupt or ancient saved record is repaired, not fatal", () => {
    assert.deepEqual(normaliseProgress(null), emptyProgress());
    assert.deepEqual(normaliseProgress("nonsense"), emptyProgress());
    assert.deepEqual(normaliseProgress({ lessons: 42, achievements: "no" }), emptyProgress());
    const partial = normaliseProgress({ totals: { answered: 5 } });
    assert.equal(partial.totals.answered, 5);
    assert.equal(partial.totals.correct, 0);
  });

  test("passing a lesson records it and unlocks the next", () => {
    const lesson = getLesson("rankings");
    const { progress, passed } = applyAttempt(emptyProgress(), "rankings", lesson.passMark, lesson.questions);
    assert.equal(passed, true);
    assert.equal(progress.lessons.rankings.passed, true);
    assert.ok(unlockedLessons(progress).includes("outs"));
  });

  test("falling short is recorded but doesn't pass", () => {
    const lesson = getLesson("rankings");
    const { progress, passed } = applyAttempt(emptyProgress(), "rankings", lesson.passMark - 1, lesson.questions);
    assert.equal(passed, false);
    assert.equal(progress.lessons.rankings.passed, false);
    assert.equal(progress.lessons.rankings.attempts, 1);
    assert.ok(!unlockedLessons(progress).includes("outs"));
  });

  test("a bad run after a good one doesn't take the pass away", () => {
    const lesson = getLesson("rankings");
    const good = applyAttempt(emptyProgress(), "rankings", lesson.questions, lesson.questions).progress;
    const after = applyAttempt(good, "rankings", 0, lesson.questions).progress;
    assert.equal(after.lessons.rankings.passed, true, "practising cost somebody their progress");
    assert.equal(after.lessons.rankings.bestScore, lesson.questions, "the best score was overwritten by a worse one");
    assert.equal(after.lessons.rankings.attempts, 2);
  });

  test("attempts accumulate into the running totals", () => {
    let p = emptyProgress();
    p = applyAttempt(p, "rankings", 6, 8).progress;
    p = applyAttempt(p, "rankings", 4, 8).progress;
    assert.equal(p.totals.answered, 16);
    assert.equal(p.totals.correct, 10);
  });

  test("applyAttempt doesn't mutate what it was given", () => {
    const before = emptyProgress();
    const snapshot = JSON.stringify(before);
    applyAttempt(before, "rankings", 8, 8);
    assert.equal(JSON.stringify(before), snapshot, "the caller's record was modified underneath them");
  });

  test("achievements are reported the run they're earned, and only then", () => {
    const lesson = getLesson("rankings");
    const first = applyAttempt(emptyProgress(), "rankings", lesson.questions, lesson.questions);
    const keys = first.unlocked.map((a) => a.key);
    assert.ok(keys.includes("firstLesson"), "passing the first lesson earned nothing");
    assert.ok(keys.includes("perfect"), "a perfect score wasn't noticed");

    const again = applyAttempt(first.progress, "rankings", lesson.questions, lesson.questions);
    assert.deepEqual(again.unlocked, [], "the same achievements were awarded twice");
  });

  test("every achievement is reachable and describes itself", () => {
    for (const a of ACHIEVEMENTS) {
      assert.ok(a.name && a.glyph && a.hint.length > 8, `${a.key} is unfinished`);
    }
    assert.equal(new Set(ACHIEVEMENTS.map((a) => a.key)).size, ACHIEVEMENTS.length);

    // Passing everything perfectly should collect the lot.
    let p = emptyProgress();
    for (const lesson of LESSONS) {
      // Enough runs to clear the "answer 100 questions" bar too.
      for (let i = 0; i < 3; i++) p = applyAttempt(p, lesson.key, lesson.questions, lesson.questions).progress;
    }
    const earned = earnedAchievements(p);
    for (const a of ACHIEVEMENTS) {
      assert.ok(earned.includes(a.key), `${a.key} can't be earned even by a perfect record`);
    }
  });

  test("achievement rules survive a record they weren't expecting", () => {
    // Guards the try/catch in earnedAchievements: a half-written lesson entry
    // shouldn't take the whole achievements panel down.
    const broken = { lessons: { rankings: null }, totals: {}, achievements: [] };
    assert.doesNotThrow(() => earnedAchievements(broken));
  });
});
