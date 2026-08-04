// The Academy: what it teaches, how it asks, and what it remembers.
//
// A single-player mode with no server, no room code and no other people — so
// unlike every other game on this platform, all of its logic can live in core
// and be tested without a browser. That is most of why it's built this way:
// a trainer whose answers can't be checked is worse than useless, because a
// confident wrong explanation is exactly what a beginner will remember.
//
// Every drill is *generated*, not authored. There is no bank of hand-written
// questions to run out of, get stale, or quietly contain a mistake: a drill
// deals real cards, and its answer is computed by the same evaluator and the
// same odds engine the live table uses. The question and its answer therefore
// cannot disagree, which is a property a written question bank can never have.
//
// Generation is seeded, so a drill can be replayed, linked to, or shown to
// somebody else and be the same drill. `drillSeed` below turns a lesson and an
// attempt number into that seed, which means a player's tenth question in a
// lesson is always their tenth question — retrying a lesson gives the same
// questions in the same order, and moving on gives new ones.

import { bestHandRank, compareHandRanks, describeHandRank, makeDeck, cardCode } from "./poker.js";
import {
  seededRandom, classifyDraws, outsToEquity, potOdds, equity, equityVsRandom,
  startingHandCode, handLabel,
} from "./poker-odds.js";
import { AI_PERSONALITIES, getPersonality } from "./poker-ai.js";

/* ============================================================== curriculum */

/**
 * @typedef {Object} Lesson
 * @property {string} key
 * @property {string} title
 * @property {string} glyph
 * @property {string} blurb     One line, shown on the lesson card.
 * @property {string[]} teaches Bullet points, shown before the first question.
 * @property {string} drill     Which generator this lesson asks from.
 * @property {number} questions How many to get through in one run.
 * @property {number} passMark  Correct answers needed to count as passed.
 * @property {string} [requires] Lesson key that must be passed first.
 */

/** @type {Lesson[]} */
export const LESSONS = [
  {
    key: "rankings",
    title: "What beats what",
    glyph: "🂡",
    blurb: "The ladder every other decision stands on.",
    teaches: [
      "Nine kinds of hand, from high card up to a straight flush.",
      "You play the best five cards available — your two and the five on the board, in any combination.",
      "When two players have the same kind of hand, the highest cards inside it decide.",
    ],
    drill: "whichWins",
    questions: 8,
    passMark: 6,
  },
  {
    key: "outs",
    title: "Counting outs",
    glyph: "🎯",
    blurb: "How many cards are left that would rescue this hand?",
    teaches: [
      "An out is a card still in the deck that turns a losing hand into a winning one.",
      "Four to a flush is nine outs. An open-ended straight draw is eight. A gutshot is four.",
      "Count them before you decide what a call is worth — never after.",
    ],
    drill: "countOuts",
    questions: 8,
    passMark: 6,
    requires: "rankings",
  },
  {
    key: "odds",
    title: "Outs into odds",
    glyph: "📈",
    blurb: "Turning a number of cards into a chance of winning.",
    teaches: [
      "The rule of 2 and 4: multiply your outs by 2 for one card to come, by 4 for two.",
      "It's a shortcut, not the truth. It flatters big draws — fifteen outs is 54%, not 60%.",
      "With one card to come the rule of 2 always understates slightly, so it errs in your favour.",
    ],
    drill: "outsToOdds",
    questions: 8,
    passMark: 6,
    requires: "outs",
  },
  {
    key: "potOdds",
    title: "Pot odds",
    glyph: "🪙",
    blurb: "What the pot is paying, and what you need to justify the call.",
    teaches: [
      "The price is what you must call, against what you'd win — the pot plus that call.",
      "Calling 100 into a pot of 200 needs you to win one time in three.",
      "You don't need the best hand to call. You need to be right more often than the price demands.",
    ],
    drill: "potOdds",
    questions: 8,
    passMark: 6,
    requires: "odds",
  },
  {
    key: "callOrFold",
    title: "Call or fold",
    glyph: "⚖️",
    blurb: "Both halves together: your chance against the price.",
    teaches: [
      "Count the outs, turn them into a percentage, compare it to the price. In that order.",
      "A flush draw with one card to come is about 20% — it needs better than 4:1 to call.",
      "A draw that's a fold at one price is a call at another. The cards didn't change; the price did.",
    ],
    drill: "callOrFold",
    questions: 8,
    passMark: 6,
    requires: "potOdds",
  },
  {
    key: "position",
    title: "Position",
    glyph: "🪑",
    blurb: "Why the same hand is worth more when you act last.",
    teaches: [
      "Acting last means you've watched everybody else before you have to commit.",
      "Hands that are a fold up front are a raise on the button — the cards are identical.",
      "Position is the one advantage in poker you're handed for free. Most players ignore it.",
    ],
    drill: "position",
    questions: 6,
    passMark: 4,
    requires: "rankings",
  },
  {
    key: "reads",
    title: "Reading the table",
    glyph: "🕵️",
    blurb: "The same bet means different things from different people.",
    teaches: [
      "A raise is only information if you know who made it.",
      "The Maniac raises with anything, so his raise says almost nothing.",
      "The Rock has folded for an hour. When she raises, believe her.",
    ],
    drill: "readOpponent",
    questions: 6,
    passMark: 4,
    requires: "callOrFold",
  },
  {
    key: "decisions",
    title: "What would you do?",
    glyph: "🤔",
    blurb: "Real spots, real opponents, graded on what it was worth.",
    teaches: [
      "No hints. A hand, a board, a price and somebody who just bet into you.",
      "Marked on expected value — what the decision was worth on average, not whether it won.",
      "Being right and losing is normal. That's the game, and it's why EV is the thing to learn.",
    ],
    drill: "decision",
    questions: 8,
    passMark: 5,
    requires: "reads",
  },
];

export function getLesson(key) {
  return LESSONS.find((l) => l.key === key) || null;
}

/**
 * Which lessons can be started, given what's been passed.
 * A lesson unlocks when the one it requires has been passed at least once.
 */
export function unlockedLessons(progress) {
  const passed = new Set(
    LESSONS.filter((l) => (progress.lessons[l.key] || {}).passed).map((l) => l.key),
  );
  return LESSONS.filter((l) => !l.requires || passed.has(l.requires)).map((l) => l.key);
}

/* ================================================================= dealing */

/** A shuffled deck from a seeded stream, so a drill is reproducible. */
function shuffled(random) {
  const deck = makeDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
  }
  return deck;
}

/** One stable seed per (lesson, question number). */
export function drillSeed(lessonKey, index) {
  let s = index + 1;
  for (let i = 0; i < lessonKey.length; i++) s = Math.imul(s ^ lessonKey.charCodeAt(i), 0x01000193);
  s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
  return (s ^ (s >>> 13)) >>> 0 || 1;
}

/** Pick one item from a list. */
const pick = (random, list) => list[Math.floor(random() * list.length)];

/**
 * The draws worth building a question around: the ones with a name, a
 * memorable out count, and a real bearing on whether to call.
 */
const DRAW_TYPES = new Set(["flush", "openEnded", "doubleGutshot", "gutshot"]);

/**
 * Multiple choice built around a true value.
 *
 * Distractors are the *plausible* wrong answers — the miscounts somebody
 * actually makes — rather than random numbers, because a question whose right
 * answer is the only sensible-looking one teaches nothing but shape-matching.
 */
function choices(truth, distractors, random) {
  const set = [truth];
  for (const d of distractors) {
    if (set.length >= 4) break;
    if (d !== truth && d >= 0 && !set.includes(d)) set.push(d);
  }
  // Shuffle so the answer isn't always first.
  for (let i = set.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = set[i]; set[i] = set[j]; set[j] = tmp;
  }
  return { options: set, answer: set.indexOf(truth) };
}

/* ================================================================= drills */

/**
 * @typedef {Object} Drill
 * @property {string} kind
 * @property {string} question
 * @property {string} [detail]
 * @property {Object} [spot]      Cards to draw: {hole, board, opponentHole, pot, toCall}.
 * @property {string[]} options   What the player picks between.
 * @property {number} answer      Index of the correct option.
 * @property {string} explain     Shown afterwards, right or wrong.
 */

const DRILLS = {
  /* ---- which of these two hands wins? --------------------------------- */
  whichWins(random) {
    const deck = shuffled(random);
    const mine = [deck[0], deck[1]];
    const theirs = [deck[2], deck[3]];
    const board = deck.slice(4, 9);
    const a = bestHandRank([...mine, ...board]);
    const b = bestHandRank([...theirs, ...board]);
    const cmp = compareHandRanks(a, b);

    const options = ["The first hand", "The second hand", "They split the pot"];
    const answer = cmp > 0 ? 0 : cmp < 0 ? 1 : 2;
    return {
      kind: "whichWins",
      question: "Which hand takes this pot?",
      detail: "Both players use the same five community cards.",
      spot: { hole: mine, opponentHole: theirs, board },
      options,
      answer,
      explain: cmp === 0
        ? `Both play ${describeHandRank(a)} — the pot is split.`
        : `${cmp > 0 ? "The first" : "The second"} hand makes ${describeHandRank(cmp > 0 ? a : b)}, `
          + `beating ${describeHandRank(cmp > 0 ? b : a)}.`,
    };
  },

  /* ---- how many outs? -------------------------------------------------- */
  countOuts(random) {
    // Keep dealing until a hand with a countable draw turns up. Most random
    // flops give somebody nothing at all, and "zero outs" is not a lesson.
    for (let attempt = 0; attempt < 200; attempt++) {
      const deck = shuffled(random);
      const hole = [deck[0], deck[1]];
      const board = deck.slice(2, 5);
      const { draws } = classifyDraws(hole, board);
      const counted = draws.filter((d) => d.outs > 0 && d.type !== "overcards");
      if (!counted.length) continue;

      const main = counted[0];
      const truth = main.outs;
      const { options, answer } = choices(
        truth,
        // The near misses people actually make: forgetting the two cards they
        // hold, counting a gutshot as open-ended, doubling a flush draw.
        [truth + 2, truth - 2, truth + 4, truth - 1, truth * 2],
        random,
      );
      return {
        kind: "countOuts",
        question: `How many outs does this hand have to make a ${main.label.replace(/ draw$/i, "").toLowerCase()}?`,
        detail: "Count only the cards that complete this draw.",
        spot: { hole, board },
        options: options.map(String),
        answer,
        explain: `${main.label}: ${truth} outs — ${main.cards.map(cardCode).join(", ")}.`,
      };
    }
    return DRILLS.whichWins(random);
  },

  /* ---- outs into a percentage ------------------------------------------ */
  outsToOdds(random) {
    const outs = pick(random, [4, 6, 8, 9, 12, 15]);
    const cardsToCome = pick(random, [1, 2]);
    const { exact } = outsToEquity(outs, cardsToCome);
    const truth = Math.round(exact * 100);
    const { options, answer } = choices(
      truth,
      [truth + 6, truth - 6, truth + 12, truth - 10, outs * 2 * cardsToCome],
      random,
    );
    const shortcut = outs * 2 * cardsToCome;
    return {
      kind: "outsToOdds",
      question: `You have ${outs} outs with ${cardsToCome === 1 ? "one card" : "two cards"} to come. About how often do you hit?`,
      detail: "The rule of 2 and 4 will get you close.",
      options: options.map((n) => `${n}%`),
      answer,
      explain: `${outs} × ${cardsToCome === 1 ? 2 : 4} = ${shortcut}%, and the true figure is ${truth}%. `
        + (Math.abs(shortcut - truth) >= 3
          ? "The shortcut drifts once a draw gets big — it can't be trusted past about twelve outs."
          : "Close enough to bet on."),
    };
  },

  /* ---- what does the pot demand? --------------------------------------- */
  potOdds(random) {
    const pot = pick(random, [100, 150, 200, 300, 400, 600, 900]);
    const bet = pick(random, [pot / 2, pot / 3, pot, pot * 0.75]).valueOf();
    const toCall = Math.round(bet / 25) * 25 || 25;
    const { breakEven } = potOdds(toCall, pot);
    const truth = Math.round(breakEven * 100);
    const { options, answer } = choices(
      truth,
      // The classic error is dividing by the pot instead of the pot plus the
      // call, which always overstates what you need.
      [Math.round((toCall / pot) * 100), truth + 8, truth - 7, truth + 15],
      random,
    );
    return {
      kind: "potOdds",
      question: `There's ${pot} in the pot and it costs you ${toCall} to call. How often do you need to win?`,
      detail: "You're calling to win the pot and your own call.",
      spot: { pot, toCall },
      options: options.map((n) => `${n}%`),
      answer,
      explain: `${toCall} to win ${pot + toCall}, so ${toCall} ÷ ${pot + toCall} = ${truth}%. `
        + "The call goes into the pot you're trying to win — that's the part people forget.",
    };
  },

  /* ---- put both halves together ---------------------------------------- */
  callOrFold(random) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const deck = shuffled(random);
      const hole = [deck[0], deck[1]];
      const board = deck.slice(2, 6);           // turn: one card to come
      const { draws, category } = classifyDraws(hole, board);
      // Only the draws the previous lessons actually taught. Without this the
      // generator mostly finds two-out oddities — "you could pair your five
      // and make two pair" — which are worth 4% and are therefore a fold at
      // every price in existence. That's not a lesson, it's a rubber stamp.
      const drawing = draws.filter((d) => DRAW_TYPES.has(d.type));
      if (category >= 4 || !drawing.length) continue;   // already made, or nothing

      const outs = drawing[0].outs;
      const chance = outsToEquity(outs, 1).exact;
      const pot = pick(random, [200, 300, 400, 600, 800]);

      /*
       * The price is built around the draw rather than drawn from a fixed
       * list, so that the question is always a real decision.
       *
       * Picking prices blindly doesn't work: with one card to come even a
       * flush draw is only 20%, while a quarter-pot bet already demands 20%
       * and a half-pot bet demands 33%. Nearly every random pairing is
       * therefore a fold, and a drill that answers "fold" nine times in ten
       * can be passed without reading it.
       *
       * So the target price is set as a multiple of what the draw is actually
       * worth — some comfortably below it, some comfortably above — which is
       * exactly how a person setting the question would choose the numbers.
       * The answer is still whatever the arithmetic says afterwards; only the
       * difficulty is being curated, and the rounding to real chip amounts is
       * allowed to fall where it may.
       */
      const target = chance * pick(random, [0.55, 0.75, 1.3, 1.7]);
      const call = Math.max(25, Math.round((pot * target) / (1 - target) / 25) * 25);
      const { breakEven } = potOdds(call, pot);
      const shouldCall = chance > breakEven;

      return {
        kind: "callOrFold",
        question: `${pot} in the pot, ${call} to call, one card to come. Call or fold?`,
        detail: "Count your outs first.",
        spot: { hole, board, pot, toCall: call },
        options: ["Call", "Fold"],
        answer: shouldCall ? 0 : 1,
        explain: `${drawing[0].label} — ${outs} outs, about ${Math.round(chance * 100)}%. `
          + `The price needs ${Math.round(breakEven * 100)}%, so it's a ${shouldCall ? "call" : "fold"}`
          + `${Math.abs(chance - breakEven) < 0.04 ? ", but only just" : ""}.`,
      };
    }
    return DRILLS.potOdds(random);
  },

  /* ---- position -------------------------------------------------------- */
  position(random) {
    const deck = shuffled(random);
    const hole = [deck[0], deck[1]];
    const code = startingHandCode(hole);
    const seats = pick(random, [6, 9]);
    const early = random() < 0.5;
    const seat = early ? pick(random, ["under the gun", "one off the blinds"]) : pick(random, ["the button", "the cut-off"]);

    /*
     * Hand strength is measured heads-up, which is the standard way of ranking
     * a starting hand and — importantly — the only measure that spreads them
     * out. Against four random hands almost everything is worth under 25%, so
     * a threshold drawn there folds the entire deck and teaches nothing about
     * position, which is the one thing this drill exists to teach.
     *
     * Heads-up, a random hand averages 50%: the thresholds below are roughly
     * the top fifth of hands up front and the top half on the button, so the
     * same cards genuinely change answer with the seat.
     */
    const strength = equityVsRandom(hole, [], { opponents: 1, trials: 400 }).equity;
    const bar = early ? 0.575 : 0.505;
    const shouldPlay = strength > bar;

    return {
      kind: "position",
      question: `${seats}-handed, folded to you ${early ? "in" : "on"} ${seat}. Do you come in with ${code}?`,
      detail: early ? "Everybody behind you is still to act." : "Only the blinds are left behind you.",
      spot: { hole },
      options: ["Raise", "Fold"],
      answer: shouldPlay ? 0 : 1,
      explain: `${code} beats a random hand about ${Math.round(strength * 100)}% of the time. `
        + (early
          ? `Up front you need roughly the top fifth of hands — about ${Math.round(bar * 100)}% — because everybody is still to act behind you.`
          : `Acting last you can play about half of them — anything over ${Math.round(bar * 100)}% — since you'll see what they do before you commit.`),
    };
  },

  /* ---- who just bet at you? -------------------------------------------- */
  readOpponent(random) {
    const who = pick(random, AI_PERSONALITIES);
    const others = AI_PERSONALITIES.filter((p) => p.key !== who.key);
    const wrong = [];
    while (wrong.length < 2) {
      const other = pick(random, others);
      if (!wrong.includes(other)) wrong.push(other);
    }
    const set = [who, ...wrong];
    for (let i = set.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = set[i]; set[i] = set[j]; set[j] = tmp;
    }
    return {
      kind: "readOpponent",
      question: `Somebody at your table plays like this: "${who.tell}" Who is it?`,
      detail: "Knowing who bet matters more than knowing what they bet.",
      options: set.map((p) => p.name),
      answer: set.indexOf(who),
      explain: `${who.name}. ${who.tell}`,
    };
  },

  /* ---- a whole spot, graded on EV -------------------------------------- */
  decision(random) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const deck = shuffled(random);
      const hole = [deck[0], deck[1]];
      const villainHole = [deck[2], deck[3]];
      const board = deck.slice(4, random() < 0.5 ? 7 : 8);   // flop or turn
      const pot = pick(random, [300, 400, 600, 900]);
      const toCall = Math.round(pick(random, [pot / 3, pot / 2, pot]).valueOf() / 25) * 25;
      const who = pick(random, AI_PERSONALITIES);

      // Equity against the hand actually held — this is a graded exam, so it
      // is marked against the truth rather than against an estimate.
      const { hands } = equity([hole, villainHole], board, { exact: true });
      const mine = hands[0].equity;
      const { breakEven } = potOdds(toCall, pot);
      const evCall = mine * (pot + toCall) - toCall;

      // Skip the spots that aren't a question: an obvious fold or an obvious
      // call teaches nothing and is irritating to be asked.
      if (Math.abs(mine - breakEven) < 0.03) continue;

      const shouldCall = evCall > 0;
      return {
        kind: "decision",
        question: `${who.name} bets ${toCall} into ${pot}. What do you do?`,
        detail: who.tell,
        spot: { hole, board, pot, toCall, villain: who.name, villainHole },
        options: ["Call", "Fold"],
        answer: shouldCall ? 0 : 1,
        explain: `You had ${Math.round(mine * 100)}% against their ${handLabel(villainHole)}, `
          + `and the price wanted ${Math.round(breakEven * 100)}%. `
          + `Calling was worth ${evCall > 0 ? "+" : ""}${Math.round(evCall)} chips on average — `
          + `${shouldCall ? "a call" : "a fold"}.`,
      };
    }
    return DRILLS.callOrFold(random);
  },
};

/** Every drill kind a lesson may ask for. */
export const DRILL_KINDS = Object.keys(DRILLS);

/**
 * Build one drill.
 * @param {string} kind
 * @param {number} seed
 * @returns {Drill}
 */
export function generateDrill(kind, seed) {
  const make = DRILLS[kind];
  if (!make) throw new Error(`Unknown drill: ${kind}`);
  const drill = make(seededRandom(seed));
  return { ...drill, seed };
}

/** The whole run of questions for one attempt at a lesson. */
export function generateLesson(lessonKey, { offset = 0 } = {}) {
  const lesson = getLesson(lessonKey);
  if (!lesson) throw new Error(`Unknown lesson: ${lessonKey}`);
  return Array.from({ length: lesson.questions }, (_, i) =>
    generateDrill(lesson.drill, drillSeed(lessonKey, offset + i)));
}

/** Was this answer right? Kept as a function so grading lives with generation. */
export function gradeDrill(drill, choice) {
  return {
    correct: choice === drill.answer,
    chose: drill.options[choice],
    should: drill.options[drill.answer],
    explain: drill.explain,
  };
}

/* ============================================================ achievements */

/**
 * @typedef {Object} Achievement
 * @property {string} key
 * @property {string} name
 * @property {string} glyph
 * @property {string} hint  How to get it — shown before it's earned, too, so
 *                          it reads as a goal rather than a surprise.
 * @property {(p:Progress)=>boolean} earned
 */

/** @type {Achievement[]} */
export const ACHIEVEMENTS = [
  {
    key: "firstLesson", name: "Sat Down", glyph: "🪑",
    hint: "Pass your first lesson.",
    earned: (p) => passedCount(p) >= 1,
  },
  {
    key: "perfect", name: "Clean Sheet", glyph: "✨",
    hint: "Get every question in a lesson right.",
    earned: (p) => Object.values(p.lessons).some((l) => l.bestScore >= l.bestOutOf && l.bestOutOf > 0),
  },
  {
    key: "counter", name: "Card Counter", glyph: "🎯",
    hint: "Pass Counting outs.",
    earned: (p) => !!(p.lessons.outs || {}).passed,
  },
  {
    key: "pricing", name: "Knows the Price", glyph: "🪙",
    hint: "Pass Pot odds.",
    earned: (p) => !!(p.lessons.potOdds || {}).passed,
  },
  {
    key: "reader", name: "People Reader", glyph: "🕵️",
    hint: "Pass Reading the table.",
    earned: (p) => !!(p.lessons.reads || {}).passed,
  },
  {
    key: "graduate", name: "Graduate", glyph: "🎓",
    hint: "Pass every lesson.",
    earned: (p) => passedCount(p) >= LESSONS.length,
  },
  {
    key: "grinder", name: "Grinder", glyph: "⏱️",
    hint: "Answer 100 questions.",
    earned: (p) => p.totals.answered >= 100,
  },
  {
    key: "sharp", name: "Sharp", glyph: "🔪",
    hint: "Answer 50 questions with three quarters of them right.",
    earned: (p) => p.totals.answered >= 50 && p.totals.correct / p.totals.answered >= 0.75,
  },
];

const passedCount = (p) => Object.values(p.lessons).filter((l) => l.passed).length;

/** Which achievements this progress has earned. */
export function earnedAchievements(progress) {
  return ACHIEVEMENTS.filter((a) => {
    try { return a.earned(progress); } catch { return false; }
  }).map((a) => a.key);
}

/* =============================================================== progress */

/**
 * @typedef {Object} Progress
 * @property {Object<string, {attempts:number, passed:boolean, bestScore:number, bestOutOf:number, lastAt:number}>} lessons
 * @property {{answered:number, correct:number}} totals
 * @property {string[]} achievements
 */

/*
 * Saving lives next door in poker-academy-progress.js, and this file knows
 * nothing about it.
 *
 * Not a stylistic preference: `store.js` opens a BroadcastChannel at import
 * time, which keeps Node's event loop alive forever, so anything that reaches
 * it — however indirectly — can never be run under `node --test`. Keeping the
 * curriculum, the drills and the scoring on this side of that line is what
 * makes all of it testable, which for a trainer is the whole point.
 */

/** @returns {Progress} */
export function emptyProgress() {
  return { lessons: {}, totals: { answered: 0, correct: 0 }, achievements: [] };
}

/**
 * Fill in anything a saved blob is missing — same defence as the settings
 * loaders elsewhere, so a record written by an older build can't throw.
 * @param {any} saved
 * @returns {Progress}
 */
export function normaliseProgress(saved) {
  const base = emptyProgress();
  if (!saved || typeof saved !== "object") return base;
  return {
    lessons: saved.lessons && typeof saved.lessons === "object" ? saved.lessons : base.lessons,
    totals: { ...base.totals, ...(saved.totals || {}) },
    achievements: Array.isArray(saved.achievements) ? saved.achievements : [],
  };
}

/**
 * Fold one finished run into a progress record.
 *
 * Pure, and separate from `recordAttempt` below purely so it can be tested:
 * the store it persists to is a browser thing, and this — what counts as a
 * pass, what a best score is, which achievement just landed — is the part
 * worth being sure about.
 *
 * @param {Progress} progress  Not mutated.
 * @param {string} lessonKey
 * @param {number} score   Right answers.
 * @param {number} outOf   Questions asked.
 * @returns {{progress:Progress, passed:boolean, unlocked:Achievement[]}}
 *          `unlocked` is only what was earned *by this run*, so the UI can
 *          celebrate it without having to diff two states itself.
 */
export function applyAttempt(progress, lessonKey, score, outOf) {
  const lesson = getLesson(lessonKey);
  const before = new Set(progress.achievements);
  const next = {
    lessons: { ...progress.lessons },
    totals: { ...progress.totals },
    achievements: [...progress.achievements],
  };

  const previous = next.lessons[lessonKey] || { attempts: 0, passed: false, bestScore: 0, bestOutOf: 0 };
  const passed = !!lesson && score >= lesson.passMark;
  next.lessons[lessonKey] = {
    attempts: previous.attempts + 1,
    // Passing is permanent. Somebody who has proved they can count outs and
    // then has a bad run has not un-learned it, and re-locking the lessons
    // behind it would be a punishment for practising.
    passed: previous.passed || passed,
    bestScore: Math.max(previous.bestScore, score),
    bestOutOf: Math.max(previous.bestOutOf, outOf),
    lastAt: Date.now(),
  };
  next.totals.answered += outOf;
  next.totals.correct += score;
  next.achievements = earnedAchievements(next);

  return {
    progress: next,
    passed,
    unlocked: ACHIEVEMENTS.filter((a) => next.achievements.includes(a.key) && !before.has(a.key)),
  };
}

