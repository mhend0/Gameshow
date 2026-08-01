// The dealer — a Texas card-room cowboy who stands at the top of the table.
//
// He is drawn as inline SVG rather than sprites or a canvas for three reasons
// that all matter here: he scales to a wall-sized TV with no assets to load and
// nothing to go blurry, he animates with plain CSS (so `prefers-reduced-motion`
// switches him off for free), and every colour on him is a CSS custom property,
// which is what phase 8's table themes will reach for.
//
// Two vocabularies:
//   • a *mood* is persistent — how his face sits between moments (happy,
//     neutral, sad). It stays until something changes it.
//   • an *emote* is a one-shot performance — a tip of the hat, a shuffle, a
//     celebration. It plays, cleans up after itself and returns him to his mood.
//
// `react(event)` is the layer above both: hand it an event name from
// poker-events.js and he picks the performance and the line to go with it.

import { el } from "./ui.js";
import { createSayingPicker } from "../core/poker-sayings.js";

/**
 * How the dealer performs each thing that can happen at the table.
 * `emote` is the animation, `mood` the face he settles into afterwards, and
 * `say` the category of line he draws from (see poker-sayings.js).
 * @type {Record<string,{emote:string, mood?:string, say:string, hold?:number}>}
 */
const REACTIONS = {
  handStart:  { emote: "shuffle",   mood: "happy",   say: "handStart" },
  flop:       { emote: "deal",      mood: "happy",   say: "flop" },
  turn:       { emote: "deal",      mood: "neutral", say: "turn" },
  river:      { emote: "deal",      mood: "neutral", say: "river" },
  showdown:   { emote: "smile",     mood: "happy",   say: "showdown" },
  bigBet:     { emote: "wink",      mood: "happy",   say: "bigBet" },
  allIn:      { emote: "wow",       mood: "happy",   say: "allIn", hold: 5200 },
  royalFlush: { emote: "royal",     mood: "happy",   say: "royalFlush", hold: 7000 },
  badBeat:    { emote: "sad",       mood: "sad",     say: "badBeat", hold: 5200 },
  fold:       { emote: "sad",       mood: "sad",     say: "fold" },
  chopPot:    { emote: "shrug",     mood: "neutral", say: "chopPot" },
  idle:       { emote: "tipHat",    mood: "happy",   say: "idle" },
};

/** How long each emote's animation runs, so the class can be cleaned up after. */
const EMOTE_MS = {
  shuffle: 1400, deal: 700, gather: 900, push: 900,
  wink: 700, tipHat: 1100, shrug: 1000, smile: 1200,
  sad: 1400, wow: 1200, celebrate: 1800, royal: 2600,
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build the cowboy. Kept as markup so the shapes read in one place. */
function dealerSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 240 210");
  svg.setAttribute("class", "dl-svg");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <!-- torso: shoulders, waistcoat, neckerchief -->
    <g class="dl-body">
      <path class="dl-shirt" d="M34 210 C38 158 76 130 120 130 C164 130 202 158 206 210 Z"/>
      <path class="dl-vest"  d="M34 210 C38 158 76 130 120 130 L120 210 Z"/>
      <path class="dl-vest"  d="M206 210 C202 158 164 130 120 130 L120 210 Z"/>
      <path class="dl-shirt" d="M98 130 L142 130 L120 176 Z"/>
      <path class="dl-scarf" d="M96 128 L144 128 L120 164 Z"/>
      <circle class="dl-stud" cx="120" cy="132" r="5"/>
    </g>

    <!-- arms: stroked paths so each bends at the elbow with one shape. They
         come down and forward so the hands rest out on the felt, which is
         where the cards and chips leave from. -->
    <g class="dl-arm dl-arm-l">
      <path class="dl-sleeve" d="M70 152 C50 170 46 192 56 206"/>
      <circle class="dl-cuff" cx="56" cy="202" r="11"/>
      <circle class="dl-hand" cx="55" cy="209" r="12"/>
    </g>
    <g class="dl-arm dl-arm-r">
      <path class="dl-sleeve" d="M170 152 C190 170 194 192 184 206"/>
      <circle class="dl-cuff" cx="184" cy="202" r="11"/>
      <circle class="dl-hand" cx="185" cy="209" r="12"/>
    </g>

    <!-- head -->
    <g class="dl-head">
      <rect class="dl-skin" x="105" y="106" width="30" height="22" rx="10"/>
      <ellipse class="dl-skin" cx="86"  cy="80" rx="7" ry="9"/>
      <ellipse class="dl-skin" cx="154" cy="80" rx="7" ry="9"/>
      <ellipse class="dl-skin dl-face" cx="120" cy="78" rx="35" ry="39"/>

      <path class="dl-brow dl-brow-l" d="M92 60 Q104 54 116 59"/>
      <path class="dl-brow dl-brow-r" d="M124 59 Q136 54 148 60"/>

      <g class="dl-eye dl-eye-l">
        <ellipse class="dl-sclera" cx="105" cy="74" rx="7" ry="6.4"/>
        <circle  class="dl-pupil"  cx="105" cy="75" r="3.4"/>
        <ellipse class="dl-lid"    cx="105" cy="74" rx="8" ry="7.4"/>
      </g>
      <g class="dl-eye dl-eye-r">
        <ellipse class="dl-sclera" cx="135" cy="74" rx="7" ry="6.4"/>
        <circle  class="dl-pupil"  cx="135" cy="75" r="3.4"/>
        <ellipse class="dl-lid"    cx="135" cy="74" rx="8" ry="7.4"/>
      </g>

      <ellipse class="dl-nose" cx="120" cy="86" rx="5.5" ry="4.5"/>

      <!-- moustache first, then the mouth below it: a cowboy's tache sits on
           his lip, not over his smile -->
      <path class="dl-tache" d="M99 92 Q110 85 120 91 Q130 85 141 92 Q130 99 120 95 Q110 99 99 92"/>
      <!-- one mouth per mood; CSS shows exactly one -->
      <path class="dl-mouth dl-mouth-happy"   d="M107 105 Q120 116 133 105"/>
      <path class="dl-mouth dl-mouth-neutral" d="M109 108 L131 108"/>
      <path class="dl-mouth dl-mouth-sad"     d="M107 114 Q120 104 133 114"/>

      <!-- hair sits under the brim: invisible while he's wearing the hat, and
           the reason he isn't suddenly bald when it flies off -->
      <path class="dl-hair" d="M86 68 C86 34 154 34 154 68 C142 52 98 52 86 68 Z"/>
      <path class="dl-hair" d="M85 66 C82 76 84 84 88 88 C86 78 86 72 88 66 Z"/>
      <path class="dl-hair" d="M155 66 C158 76 156 84 152 88 C154 78 154 72 152 66 Z"/>

      <!-- hat last so it sits over the brow -->
      <g class="dl-hat">
        <ellipse class="dl-brim" cx="120" cy="48" rx="66" ry="14"/>
        <path class="dl-crown" d="M90 50 C88 22 96 10 120 10 C144 10 152 22 150 50 Z"/>
        <path class="dl-band"  d="M89 43 C104 49 136 49 151 43 L151 36 C136 42 104 42 89 36 Z"/>
      </g>
    </g>
  `;
  return svg;
}

/**
 * @typedef {Object} PokerDealerHandle
 * @property {HTMLElement} el
 * @property {(name:string)=>void} emote     Play a one-shot performance.
 * @property {(mood:string)=>void} setMood   happy | neutral | sad.
 * @property {(text:string, opts?:{ms?:number})=>void} say
 * @property {(event:string)=>void} react    An event name from poker-events.js.
 * @property {()=>HTMLElement} handsAnchor   Where cards and chips leave from
 *           — the attach point for the dealing animations in phase 5.
 * @property {()=>void} destroy
 */

/**
 * @param {Object} [opts]
 * @param {{pick:(c:string)=>string|null}} [opts.picker]  Line source; defaults
 *        to the standard library with its no-repeat bag.
 * @param {boolean} [opts.speech]  Set false for a silent dealer.
 * @returns {PokerDealerHandle}
 */
export function createPokerDealer({ picker = createSayingPicker(), speech = true } = {}) {
  ensureStyles();

  const svg = dealerSvg();
  const bubble = el("div", { class: "dl-bubble", role: "status", "aria-live": "polite" });
  const sparkles = el("div", { class: "dl-sparkles", "aria-hidden": "true" });
  for (let i = 0; i < 7; i++) sparkles.appendChild(el("i", { style: { "--s-i": String(i) } }));

  const root = el("div", { class: "dl", dataset: { mood: "happy" } }, [sparkles, svg, bubble]);

  let emoteTimer = null;
  let bubbleTimer = null;
  let currentEmote = null;

  function setMood(mood) {
    if (["happy", "neutral", "sad"].includes(mood)) root.dataset.mood = mood;
  }

  function emote(name) {
    if (!EMOTE_MS[name]) return;
    // Interrupting is the right behaviour: the table doesn't wait for him to
    // finish a shrug before the next card lands.
    if (currentEmote) root.classList.remove(`is-${currentEmote}`);
    clearTimeout(emoteTimer);
    // Force a reflow so re-triggering the same emote restarts its animation.
    void root.offsetWidth;
    currentEmote = name;
    root.classList.add(`is-${name}`);
    emoteTimer = setTimeout(() => {
      root.classList.remove(`is-${name}`);
      currentEmote = null;
    }, EMOTE_MS[name]);
  }

  function say(text, { ms } = {}) {
    if (!speech || !text) return;
    // Long lines need longer on screen; short ones shouldn't linger.
    const hold = ms || Math.min(7000, 1900 + text.length * 55);
    bubble.textContent = text;
    bubble.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove("show"), hold);
  }

  function react(event) {
    const plan = REACTIONS[event];
    if (!plan) return;
    emote(plan.emote);
    if (plan.mood) setMood(plan.mood);
    say(picker.pick(plan.say), { ms: plan.hold });
  }

  function destroy() {
    clearTimeout(emoteTimer);
    clearTimeout(bubbleTimer);
    root.remove();
  }

  return {
    el: root,
    emote, setMood, say, react, destroy,
    handsAnchor: () => svg,
  };
}

/* =================================================================== styles */

let injected = false;
function ensureStyles() {
  if (injected) return;
  injected = true;
  const css = `
  .dl{
    container-type:inline-size; position:relative; width:100%; line-height:0;
    --skin:#e8b98d; --skin-dark:#c9945f; --hat:#8a5a33; --hat-dark:#603a1e;
    --band:#2b1a10; --shirt:#f2ede3; --vest:#2f3646; --scarf:#c0392b;
    --hair:#3a2415; --ink:#2a1a10;
  }
  .dl-svg{ width:100%; height:auto; overflow:visible; display:block;
    filter:drop-shadow(0 1.5cqw 2cqw rgba(0,0,0,.55)); }

  /* ---- palette -------------------------------------------------------- */
  .dl-skin{ fill:var(--skin); }
  .dl-face{ stroke:var(--skin-dark); stroke-width:1.2; }
  .dl-shirt{ fill:var(--shirt); }
  .dl-vest{ fill:var(--vest); }
  .dl-scarf{ fill:var(--scarf); }
  .dl-stud{ fill:var(--band); }
  .dl-brim{ fill:var(--hat-dark); }
  .dl-crown{ fill:var(--hat); }
  .dl-band{ fill:var(--band); }
  .dl-nose{ fill:var(--skin-dark); opacity:.75; }
  .dl-sclera{ fill:#fff; }
  .dl-pupil{ fill:var(--ink); }
  .dl-lid{ fill:var(--skin); transform-box:fill-box; transform-origin:center top;
    transform:scaleY(0); }
  .dl-brow{ stroke:var(--hair); stroke-width:5; stroke-linecap:round; fill:none; }
  .dl-hair{ fill:var(--hair); }
  .dl-tache{ fill:var(--hair); }
  .dl-mouth{ stroke:var(--ink); stroke-width:4.5; stroke-linecap:round; fill:none; opacity:0; }
  /* Shirt-coloured sleeves: a vest-coloured arm over a vest-coloured torso is
     an invisible arm and two floating hands. */
  .dl-sleeve{ stroke:var(--shirt); stroke-width:19; stroke-linecap:round; fill:none;
    filter:drop-shadow(0 0 .6px rgba(0,0,0,.35)); }
  .dl-cuff{ fill:var(--vest); }
  .dl-hand{ fill:var(--skin); stroke:var(--skin-dark); stroke-width:1.2; }

  /* ---- mood: exactly one mouth ---------------------------------------- */
  .dl[data-mood="happy"]   .dl-mouth-happy,
  .dl[data-mood="neutral"] .dl-mouth-neutral,
  .dl[data-mood="sad"]     .dl-mouth-sad{ opacity:1; }

  /* ---- idle life: breathing and blinking ------------------------------ */
  .dl-body{ transform-box:fill-box; transform-origin:center bottom;
    animation:dl-breathe 4.5s ease-in-out infinite; }
  .dl-head{ transform-box:fill-box; transform-origin:center bottom;
    animation:dl-bob 6s ease-in-out infinite; }
  .dl-lid{ animation:dl-blink 6.5s infinite; }
  .dl-eye-r .dl-lid{ animation-delay:.04s; }   /* eyes never blink in perfect sync */
  @keyframes dl-breathe{ 0%,100%{ transform:scaleY(1); } 50%{ transform:scaleY(1.022); } }
  @keyframes dl-bob{ 0%,100%{ transform:translateY(0) rotate(0deg); } 50%{ transform:translateY(-1.2%) rotate(.7deg); } }
  @keyframes dl-blink{ 0%,95.5%,100%{ transform:scaleY(0); } 97%,98.4%{ transform:scaleY(1); } }

  /* ---- arms ----------------------------------------------------------- */
  .dl-arm{ transform-box:view-box; }
  .dl-arm-l{ transform-origin:70px 152px; }   /* the shoulder each arm hangs from */
  .dl-arm-r{ transform-origin:170px 152px; }

  /* ---- emotes --------------------------------------------------------- */
  /* deal: the right arm flicks out, the way a card is spun onto the felt */
  .dl.is-deal .dl-arm-r{ animation:dl-deal .7s cubic-bezier(.3,.9,.4,1) both; }
  @keyframes dl-deal{
    0%{ transform:rotate(0deg); } 35%{ transform:rotate(-26deg); }
    55%{ transform:rotate(14deg); } 100%{ transform:rotate(0deg); }
  }

  /* shuffle: hands together, riffling */
  .dl.is-shuffle .dl-arm-l{ animation:dl-shuf-l 1.4s ease-in-out both; }
  .dl.is-shuffle .dl-arm-r{ animation:dl-shuf-r 1.4s ease-in-out both; }
  @keyframes dl-shuf-l{
    0%,100%{ transform:rotate(0deg); }
    18%{ transform:rotate(-16deg); }
    30%,50%,70%{ transform:rotate(-13deg) translateY(-2px); }
    40%,60%,80%{ transform:rotate(-19deg) translateY(2px); }
  }
  @keyframes dl-shuf-r{
    0%,100%{ transform:rotate(0deg); }
    18%{ transform:rotate(16deg); }
    30%,50%,70%{ transform:rotate(13deg) translateY(2px); }
    40%,60%,80%{ transform:rotate(19deg) translateY(-2px); }
  }

  /* gather / push: gathering the pot in, sliding it out to a winner */
  .dl.is-gather .dl-arm-l{ animation:dl-gather-l .9s ease-in-out both; }
  .dl.is-gather .dl-arm-r{ animation:dl-gather-r .9s ease-in-out both; }
  @keyframes dl-gather-l{ 0%,100%{ transform:rotate(0deg); } 50%{ transform:rotate(-30deg) translateY(6px); } }
  @keyframes dl-gather-r{ 0%,100%{ transform:rotate(0deg); } 50%{ transform:rotate(30deg) translateY(6px); } }
  .dl.is-push .dl-arm-l{ animation:dl-push-l .9s ease-in-out both; }
  .dl.is-push .dl-arm-r{ animation:dl-push-r .9s ease-in-out both; }
  @keyframes dl-push-l{ 0%,100%{ transform:rotate(0deg); } 45%{ transform:rotate(18deg) translateY(10px); } }
  @keyframes dl-push-r{ 0%,100%{ transform:rotate(0deg); } 45%{ transform:rotate(-18deg) translateY(10px); } }

  /* wink: one eye, and a little smirk of the head */
  .dl.is-wink .dl-eye-r .dl-lid{ animation:dl-winklid .7s ease-in-out both; }
  .dl.is-wink .dl-head{ animation:dl-tilt .7s ease-in-out both; }
  @keyframes dl-winklid{ 0%,100%{ transform:scaleY(0); } 25%,60%{ transform:scaleY(1); } }
  @keyframes dl-tilt{ 0%,100%{ transform:rotate(0deg); } 45%{ transform:rotate(-5deg); } }

  /* tip of the hat */
  .dl.is-tipHat .dl-hat{ animation:dl-tip 1.1s cubic-bezier(.3,.8,.4,1) both; }
  .dl.is-tipHat .dl-arm-r{ animation:dl-tiparm 1.1s ease-in-out both; }
  @keyframes dl-tip{
    0%,100%{ transform:translate(0,0) rotate(0deg); }
    35%,60%{ transform:translate(6px,-16px) rotate(-14deg); }
  }
  @keyframes dl-tiparm{ 0%,100%{ transform:rotate(0deg); } 40%,60%{ transform:rotate(-52deg); } }

  /* shrug: shoulders and both hands up, palms out */
  .dl.is-shrug .dl-body{ animation:dl-shrugbody 1s ease-in-out both; }
  .dl.is-shrug .dl-arm-l{ animation:dl-shrug-l 1s ease-in-out both; }
  .dl.is-shrug .dl-arm-r{ animation:dl-shrug-r 1s ease-in-out both; }
  @keyframes dl-shrugbody{ 0%,100%{ transform:translateY(0); } 45%{ transform:translateY(-5%); } }
  @keyframes dl-shrug-l{ 0%,100%{ transform:rotate(0deg); } 45%{ transform:rotate(34deg) translateY(-8px); } }
  @keyframes dl-shrug-r{ 0%,100%{ transform:rotate(0deg); } 45%{ transform:rotate(-34deg) translateY(-8px); } }

  /* smile: a beat of extra warmth */
  .dl.is-smile .dl-head{ animation:dl-nod 1.2s ease-in-out both; }
  @keyframes dl-nod{ 0%,100%{ transform:translateY(0) rotate(0deg); } 40%{ transform:translateY(2%) rotate(1.5deg); } }

  /* wow: leans back, eyes wide, hat lifts off the brow */
  .dl.is-wow .dl-head{ animation:dl-wowhead 1.2s cubic-bezier(.3,.9,.4,1) both; }
  .dl.is-wow .dl-hat{ animation:dl-wowhat 1.2s cubic-bezier(.3,.9,.4,1) both; }
  .dl.is-wow .dl-pupil{ animation:dl-wowpupil 1.2s ease-in-out both; }
  @keyframes dl-wowhead{ 0%,100%{ transform:translateY(0) scale(1); } 40%{ transform:translateY(-3%) scale(1.05); } }
  @keyframes dl-wowhat{ 0%,100%{ transform:translateY(0) rotate(0); } 35%{ transform:translateY(-13px) rotate(3deg); } }
  @keyframes dl-wowpupil{ 0%,100%{ r:3.8; } 40%{ r:5.2; } }

  /* disappointed: head drops, a slow shake */
  .dl.is-sad .dl-head{ animation:dl-sadhead 1.4s ease-in-out both; }
  @keyframes dl-sadhead{
    0%,100%{ transform:translateY(0) rotate(0deg); }
    30%{ transform:translateY(4%) rotate(-6deg); }
    60%{ transform:translateY(4%) rotate(6deg); }
    85%{ transform:translateY(3%) rotate(-2deg); }
  }

  /* celebrate / royal flush */
  .dl.is-celebrate .dl-arm-l, .dl.is-royal .dl-arm-l{ animation:dl-cheer-l 1.8s ease-in-out both; }
  .dl.is-celebrate .dl-arm-r, .dl.is-royal .dl-arm-r{ animation:dl-cheer-r 1.8s ease-in-out both; }
  .dl.is-celebrate .dl-body,  .dl.is-royal .dl-body{ animation:dl-hop 1.8s ease-in-out both; }
  .dl.is-royal .dl-arm-l, .dl.is-royal .dl-arm-r, .dl.is-royal .dl-body{ animation-duration:2.6s; }
  .dl.is-royal .dl-hat{ animation:dl-hatfly 2.6s cubic-bezier(.3,.8,.4,1) both; }
  @keyframes dl-cheer-l{ 0%,100%{ transform:rotate(0deg); } 20%,80%{ transform:rotate(58deg) translateY(-14px); } }
  @keyframes dl-cheer-r{ 0%,100%{ transform:rotate(0deg); } 20%,80%{ transform:rotate(-58deg) translateY(-14px); } }
  @keyframes dl-hop{
    0%,100%{ transform:translateY(0); }
    15%,45%,75%{ transform:translateY(-4%); }
    30%,60%,90%{ transform:translateY(0); }
  }
  /* Kept modest on purpose: he stands at the very top of the screen, so a hat
     that flies much further than this disappears behind the page chrome. */
  @keyframes dl-hatfly{
    0%,100%{ transform:translateY(0) rotate(0deg); }
    25%{ transform:translateY(-26px) rotate(-20deg); }
    50%{ transform:translateY(-18px) rotate(14deg); }
    75%{ transform:translateY(-8px) rotate(-5deg); }
  }

  /* ---- sparkles (royal flush only) ------------------------------------ */
  .dl-sparkles{ position:absolute; inset:-10% -20% 20%; pointer-events:none; }
  .dl-sparkles i{
    position:absolute; width:2.6cqw; height:2.6cqw; border-radius:50%;
    background:radial-gradient(circle, #fff, #ffcf5c 55%, transparent 70%);
    left:calc(8% + var(--s-i) * 13%); top:calc(6% + (var(--s-i) * 37deg) * 0);
    opacity:0;
  }
  .dl.is-royal .dl-sparkles i{ animation:dl-spark 2.6s ease-out both; animation-delay:calc(var(--s-i) * .12s); }
  @keyframes dl-spark{
    0%{ opacity:0; transform:translateY(20%) scale(.4); }
    30%{ opacity:1; transform:translateY(-40%) scale(1.15); }
    100%{ opacity:0; transform:translateY(-130%) scale(.5); }
  }

  /* ---- speech bubble --------------------------------------------------- */
  .dl-bubble{
    position:absolute; left:92%; top:12%; z-index:3;
    /* Sized in the dealer's own container units, so it scales with him. He is
       roughly a fifth of the table wide, so a readable line needs well over
       100cqw — at 44cqw the shortest quip wrapped onto four lines. */
    width:max-content; min-width:40cqw; max-width:135cqw;
    padding:2.4cqw 3.2cqw; border-radius:3.2cqw; line-height:1.28;
    background:linear-gradient(180deg,#fffdf6,#f2ebda); color:#241a10;
    font-size:6cqw; font-weight:800; letter-spacing:-.01em;
    box-shadow:0 1.6cqw 3.2cqw -.8cqw rgba(0,0,0,.7);
    opacity:0; transform:translate(-4%, 6%) scale(.92); transform-origin:0% 60%;
    transition:opacity .22s var(--ease,ease), transform .28s cubic-bezier(.2,1.3,.4,1);
    pointer-events:none;
  }
  .dl-bubble.show{ opacity:1; transform:translate(0,0) scale(1); }
  /* tail, pointing back at him */
  .dl-bubble::before{
    content:""; position:absolute; left:-2.2cqw; top:52%;
    border:2.4cqw solid transparent; border-right-color:#fffdf6; border-left:0;
    filter:drop-shadow(-.3cqw .2cqw .2cqw rgba(0,0,0,.25));
  }

  /* ---- reduced motion -------------------------------------------------- */
  /* He keeps his face and his voice; he just stops moving. */
  @media (prefers-reduced-motion: reduce){
    .dl-body, .dl-head, .dl-lid, .dl-hat, .dl-arm, .dl-pupil, .dl-sparkles i{
      animation:none !important;
    }
    .dl-lid{ transform:scaleY(0); }
  }
  `;
  document.head.appendChild(el("style", { text: css }));
}
