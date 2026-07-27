// First-run content for Family Feud.
//
// A new install with an empty library is a dead end — you can't try the console
// without first writing a survey. So the platform ships a starter pack: enough
// surveys for a full four-round game plus a Fast Money card, wired into one
// session so "Open" on the home screen goes straight into a playable show.
//
// Seeding runs once and is safe to call on every page load — the same contract
// the wheel's seeder keeps, so a host who deletes the samples doesn't get them
// handed back the next time they open a page.

import { SurveyRepo, FeudSessionRepo, surveys, feudSessions, makeFeudRound, suggestPoints } from "./feud.js";
import { settings } from "./repos.js";

/**
 * Surveys as a host would type them: a question, the answers in order, and the
 * points. Where points are omitted the app works out the ladder itself — which
 * is also the fastest demonstration of that feature.
 * @type {{q:string, cat:string, difficulty?:number, a:(string|[string,number]|[string,number,string[]])[]}[]}
 */
const PACK = [
  {
    q: "Name something people do the moment they wake up",
    cat: "Everyday life",
    difficulty: 1,
    a: [
      ["Check their phone", 34, ["look at their phone", "scroll"]],
      ["Hit snooze", 22, ["go back to sleep"]],
      ["Stretch", 14],
      ["Go to the bathroom", 12, ["wee", "toilet"]],
      ["Make coffee", 11, ["have a coffee"]],
      ["Brush their teeth", 7],
    ],
  },
  {
    q: "Name a reason someone might be late for work",
    cat: "Everyday life",
    difficulty: 1,
    a: [
      ["Traffic", 38, ["stuck in traffic", "the roads"]],
      ["They overslept", 27, ["slept in", "alarm didn't go off"]],
      ["Car trouble", 13, ["the car broke down"]],
      ["A sick child", 11, ["kids", "the children"]],
      ["Bad weather", 7],
      ["Public transport", 4, ["the train", "the bus"]],
    ],
  },
  {
    q: "Name something you always find at the bottom of a handbag",
    cat: "Everyday life",
    a: [
      ["Old receipts", 30, ["receipts", "paper"]],
      ["Crumbs", 21],
      ["Loose change", 18, ["coins", "money"]],
      ["A hair tie", 13, ["hair bobble"]],
      ["Lip balm", 10, ["lipstick", "chapstick"]],
      ["A pen", 8],
    ],
  },
  {
    q: "Name something people pretend to enjoy",
    cat: "Funny",
    difficulty: 2,
    a: [
      ["Someone else's baby photos", 26, ["baby pictures", "photos of kids"]],
      ["A bad gift", 22, ["presents they hate"]],
      ["Exercise", 19, ["going to the gym", "running"]],
      ["Work meetings", 16, ["meetings"]],
      ["Their in-laws", 11, ["family visits"]],
      ["Salad", 6],
    ],
  },
  {
    q: "Name something that always goes missing in a house",
    cat: "Everyday life",
    a: [
      ["The TV remote", 32, ["remote control", "remote"]],
      ["Keys", 27, ["car keys", "house keys"]],
      ["One sock", 16, ["socks"]],
      ["Phone chargers", 12, ["a charger", "cables"]],
      ["Scissors", 8],
      ["Pens", 5],
    ],
  },
  {
    q: "Name a job that would be terrible to do in the rain",
    cat: "Work",
    difficulty: 2,
    a: [
      ["Roofer", 28, ["builder", "construction"]],
      ["Postman", 24, ["delivery driver", "mail carrier", "postie"]],
      ["Window cleaner", 17],
      ["Farmer", 13],
      ["Traffic warden", 10, ["parking attendant"]],
      ["Photographer", 8],
    ],
  },
  {
    q: "Name something people do to look busy at work",
    cat: "Work",
    difficulty: 2,
    a: [
      ["Stare at their screen", 30, ["look at the computer", "type"]],
      ["Carry paperwork around", 23, ["hold a clipboard", "walk with papers"]],
      ["Send emails", 18],
      ["Take a phone call", 15, ["pretend to be on the phone"]],
      ["Frown at a spreadsheet", 9],
      ["Go to a meeting", 5],
    ],
  },
  {
    q: "Name something a dog would take if it could go shopping",
    cat: "Funny",
    difficulty: 3,
    a: [
      ["Sausages", 31, ["meat", "bacon", "steak"]],
      ["Balls", 22, ["a tennis ball", "toys"]],
      ["Treats", 18, ["dog treats", "biscuits"]],
      ["A bone", 14, ["bones"]],
      ["A squeaky toy", 9],
      ["Shoes to chew", 6, ["shoes", "slippers"]],
    ],
  },
  {
    q: "Name something people argue about on a road trip",
    cat: "Travel",
    a: [
      ["Directions", 29, ["which way to go", "the sat nav", "the gps"]],
      ["The music", 24, ["what to listen to", "the radio"]],
      ["When to stop", 18, ["toilet breaks", "rest stops"]],
      ["The driving", 14, ["how fast they're going", "speeding"]],
      ["The temperature", 9, ["the air conditioning", "the heating"]],
      ["Snacks", 6, ["food"]],
    ],
  },
  {
    q: "Name something you would never want to run out of on holiday",
    cat: "Travel",
    a: [
      // No points typed — the app builds the ladder.
      "Money",
      "Sunscreen",
      "Clean clothes",
      "Phone battery",
      "Medication",
      "Patience",
    ],
  },
  {
    q: "Name something people say they'll start doing on Monday",
    cat: "Funny",
    difficulty: 2,
    a: [
      ["A diet", 33, ["eating healthy", "healthy eating"]],
      ["Going to the gym", 26, ["exercise", "working out"]],
      ["Getting up early", 15],
      ["Saving money", 12, ["budgeting"]],
      ["Quitting smoking", 9, ["giving up smoking"]],
      ["Tidying up", 5, ["cleaning the house"]],
    ],
  },
  {
    q: "Name something that ruins a photo",
    cat: "Everyday life",
    a: [
      ["Someone blinking", 30, ["closed eyes", "eyes shut"]],
      ["A stranger in the background", 24, ["a photobomb", "photobomber"]],
      ["Bad lighting", 17, ["the light", "too dark"]],
      ["A bad angle", 13, ["double chin"]],
      ["Blurry hands", 10, ["it's blurry", "camera shake"]],
      ["Rain", 6, ["the weather"]],
    ],
  },
];

/** The Fast Money card: short questions with a clear top answer. */
const FAST_MONEY = [
  {
    q: "Name a fruit people eat for breakfast",
    cat: "Fast Money",
    a: [["Banana", 41], ["Apple", 24], ["Orange", 15], ["Berries", 12], ["Grapefruit", 8]],
  },
  {
    q: "Name something you keep in the fridge door",
    cat: "Fast Money",
    a: [["Milk", 38], ["Ketchup", 22], ["Butter", 17], ["Eggs", 13], ["Juice", 10]],
  },
  {
    q: "Name a place people go on a first date",
    cat: "Fast Money",
    a: [["A restaurant", 36, ["dinner", "for a meal"]], ["The cinema", 25, ["the movies", "a film"]], ["A pub", 18, ["a bar", "for a drink"]], ["A coffee shop", 13, ["for coffee"]], ["A walk in the park", 8, ["the park", "a walk"]]],
  },
  {
    q: "Name something people do while brushing their teeth",
    cat: "Fast Money",
    a: [["Look in the mirror", 34, ["stare at themselves"]], ["Scroll their phone", 26, ["check their phone"]], ["Walk around", 18, ["wander"]], ["Hum or sing", 13, ["sing"]], ["Get dressed", 9]],
  },
  {
    q: "Name an animal you would not want in your kitchen",
    cat: "Fast Money",
    a: [["A mouse", 35, ["mice", "a rat", "rats"]], ["A spider", 24, ["spiders"]], ["A snake", 17, ["snakes"]], ["A bear", 15, ["bears"]], ["A cow", 9, ["cows"]]],
  },
];

/** Turn the compact literals above into real surveys. */
function buildSurvey(row) {
  const answers = row.a.map((entry) => {
    if (typeof entry === "string") return { text: entry, points: 0, alts: [] };
    const [text, points, alts] = entry;
    return { text, points: points || 0, alts: alts || [] };
  });
  // Points left blank get the app's own ladder — the same one the editor offers.
  if (answers.every((a) => !a.points)) {
    const ladder = suggestPoints(answers.length);
    answers.forEach((a, i) => { a.points = ladder[i]; });
  }
  return SurveyRepo.create({
    question: row.q,
    category: row.cat,
    answers,
    meta: { tags: ["sample"], ...(row.difficulty ? { difficulty: row.difficulty } : {}) },
  });
}

/**
 * Seed the survey library and a demo session, once.
 * Idempotent and safe to call on every page load.
 * @returns {{seeded:boolean, surveys:number}}
 */
export function ensureFeudSeeded() {
  const s = settings.get() || {};
  if (s.feudSeededV1 && surveys.count() > 0) {
    return { seeded: false, surveys: surveys.count() };
  }

  const main = PACK.map(buildSurvey);
  const fast = FAST_MONEY.map(buildSurvey);

  if (main.length && feudSessions.count() === 0) {
    // Shaped like a broadcast: four rounds up the show's ladder — single,
    // single, double, triple — and a full Fast Money card to finish.
    FeudSessionRepo.create({
      name: "Sample Show",
      rounds: main.slice(0, 4).map((sv, i) => makeFeudRound({ surveyId: sv.id, multiplier: [1, 1, 2, 3][i] })),
      fastMoneyIds: fast.map((sv) => sv.id),
      meta: { notes: "Auto-created so you can try the console straight away.", tags: ["default"] },
    });
  }

  settings.set({ ...s, feudSeededV1: true });
  return { seeded: true, surveys: main.length + fast.length };
}

/** Force the starters back (used by a "restore samples" action). */
export function reseedFeud() {
  const s = settings.get() || {};
  settings.set({ ...s, feudSeededV1: false });
  return ensureFeudSeeded();
}
