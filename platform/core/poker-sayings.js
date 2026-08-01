// What the dealer says — the line library and the picker that chooses one.
//
// Deliberately UI-free: the TV owns *when* the dealer speaks (see
// poker-events.js), this file owns *what* comes out of his mouth. Keeping the
// two apart means the lines can be edited, counted and unit-tested without a
// DOM, and a future settings screen can swap the whole personality by handing
// the picker a different library.
//
// House style for the lines: a Texas card-room dealer who has seen everything
// twice — charming, a bit over-confident, never mean about a player and never
// crude. These run at church game nights and youth events, so the humour stays
// on the right side of a room full of teenagers and grandparents.

/**
 * @typedef {"handStart"|"flop"|"turn"|"river"|"showdown"|"bigBet"|"allIn"
 *          |"royalFlush"|"badBeat"|"fold"|"chopPot"|"idle"} SayingCategory
 */

/** @type {Record<SayingCategory, string[]>} */
export const SAYINGS = {
  handStart: [
    "Fresh deck, fresh chances.",
    "Shuffle up and deal, partner.",
    "Let's see who Lady Luck likes today.",
    "New hand, clean slate.",
    "Cards comin' out — eyes on your own paper.",
    "I've got a good feeling about this one.",
    "Two cards each. Try not to give it all away.",
    "Nobody's lost yet. Enjoy the feeling.",
    "Straight off the top, as always.",
    "Here we go again, and I never get tired of it.",
    "Hold on to your hats.",
    "Fortune favours the brave. And the patient.",
  ],
  flop: [
    "That's one spicy flop.",
    "Three on the felt. Somebody just got happy.",
    "Well now. That changes things.",
    "There's the flop — somebody's grinnin' behind those cards.",
    "I've seen worse flops. Not many, mind you.",
    "Pretty board. Dangerous board.",
    "Somebody out there just found a friend.",
    "That flop's got secrets in it.",
    "Careful now, that's a trap if I ever saw one.",
    "Three cards, and the whole story changed.",
  ],
  turn: [
    "Turn card. Things just got interesting.",
    "Fourth street, and the temperature's rising.",
    "That's the card somebody was praying for.",
    "One more to come. Choose wisely.",
    "The turn always tells the truth.",
    "That card just broke somebody's heart. Politely.",
    "Now we're cooking.",
    "Fourth one's on the felt. No takebacks.",
  ],
  river: [
    "I've seen stranger rivers.",
    "There it is — the last word.",
    "River's in. No more excuses.",
    "That's all the help you're getting from me.",
    "The board is done talking. Your turn.",
    "Last card. Somebody just changed their mind twice.",
    "Well, the river giveth and the river taketh away.",
    "Five on the felt. Show me somethin'.",
  ],
  showdown: [
    "Cards on the table, folks.",
    "The cards never lie.",
    "Let's see what you've been hiding.",
    "Moment of truth, partner.",
    "Turn 'em over. I'll be the judge.",
    "This is the part I like best.",
    "No bluffing your way past me now.",
    "Somebody's about to look real clever.",
  ],
  bigBet: [
    "Big hats don't always mean big hands.",
    "Well that's a mouthful of chips.",
    "Somebody woke up feeling wealthy.",
    "That's a bet with an opinion behind it.",
    "Bold. I like bold.",
    "That'll get everyone's attention.",
    "Whoa now. Save some for the rest of us.",
    "That's not a bet, that's a statement.",
  ],
  allIn: [
    "All in? Bold move, partner.",
    "Everything in the middle. My favourite words.",
    "No chips left to hide behind.",
    "Well, that's one way to end the conversation.",
    "All of it. I admire the commitment.",
    "That's the whole stack. Hope it's a good one.",
    "Somebody's feeling lucky.",
    "In for a penny, in for the whole pile.",
  ],
  royalFlush: [
    "A ROYAL FLUSH! I've dealt thirty years for this moment!",
    "Ten to the ace! Somebody frame that hand!",
    "Royal flush! Folks, you may never see that again!",
    "Well I'll be — a royal! Hats off, truly.",
    "That's the best hand in the deck and I dealt it myself!",
  ],
  badBeat: [
    "Oof. That one's gonna sting for a while.",
    "That is a rough way to lose, partner.",
    "Great hand. Terrible timing.",
    "I'd apologise, but I only deal 'em.",
    "Sometimes the best hand just isn't the winning hand.",
    "Shake it off. That was nobody's fault.",
    "Don't look at me like that. The deck did it.",
  ],
  fold: [
    "Everybody ran off. Pot goes uncontested.",
    "Nobody wanted a piece of that one.",
    "Well, that was over quick.",
    "Taking it down without a fight. Efficient.",
    "Sometimes the best hand is the one nobody calls.",
    "And they all folded like laundry.",
    "Never bluff your grandma. She always calls.",
    "Even a donkey finds aces eventually.",
  ],
  chopPot: [
    "Split pot! Everybody shake hands.",
    "Dead even. Share nicely, now.",
    "A chop. Nobody wins, nobody cries.",
    "Same hand, same prize. Fair's fair.",
    "We're cutting this one down the middle.",
  ],
  idle: [
    "Lady Luck's watching this one.",
    "Take your time. The chips aren't going anywhere.",
    "I've got all night, partner.",
    "Thinking hard, or hardly thinking?",
    "No rush. The cards are patient.",
    "You can stare at 'em all you like — they won't change.",
    "Somebody's feeling lucky.",
  ],
};

/** Fisher-Yates, on a copy. */
function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A picker that won't repeat itself.
 *
 * Each category gets a "bag": the whole list, shuffled, drawn from one at a
 * time and only refilled once it's empty. That guarantees every line is heard
 * before any line is heard twice — which independent random picks emphatically
 * do not, and the dealer saying "that's one spicy flop" three flops running is
 * exactly what makes a character feel like a script instead of a person.
 *
 * @param {Record<string,string[]>} [library]
 * @param {{rng?:()=>number}} [opts]
 */
export function createSayingPicker(library = SAYINGS, { rng = Math.random } = {}) {
  /** @type {Map<string,string[]>} category → remaining lines, popped from the end */
  const bags = new Map();
  /** @type {Map<string,string>} category → the line handed out most recently */
  const last = new Map();

  function refill(category, pool) {
    const bag = shuffled(pool, rng);
    // A fresh bag can legally start with the line the old bag ended on, which
    // is the one case where "no repeats" would still produce a repeat.
    if (bag.length > 1 && bag[bag.length - 1] === last.get(category)) {
      [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    return bag;
  }

  return {
    /**
     * The next line for a category, or null when there's nothing to say.
     * @param {SayingCategory|string} category
     * @returns {string|null}
     */
    pick(category) {
      const pool = library[category];
      if (!pool || !pool.length) return null;
      let bag = bags.get(category);
      if (!bag || !bag.length) { bag = refill(category, pool); bags.set(category, bag); }
      const line = bag.pop();
      last.set(category, line);
      return line;
    },
    /** Forget what's been said — a fresh session, or a swapped personality. */
    reset() { bags.clear(); last.clear(); },
  };
}
