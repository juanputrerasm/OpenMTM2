/*
  The announcer (MONSTER_EXE_ANALYSIS.md 12, "Commentary (Trucksfx.c)"). A phrase is a short script of voice clips:
  plain `name.wav` tokens, and driver names `(<<n>>`, `*<<n>>` and `)<<n>>`, which are the nth driver's name clip in
  its rising, flat or falling voice (the three "Wave File" names of the truck's .TRK). The game plays the clips as one
  sound and shows the phrase's line as text; the lines are the commentary's part of the game's message table (the
  "MTM2.loc" no POD ships), so they are message tags here and a `.LOC` or a language can reword them.

  - `PHRASES`: each group's phrases as the EXE lists them, with `camera` on the lines said only when the truck the
    camera follows is in the event (and close, for the passing groups), `when` on the two with a rule of their own,
    and `of` on the one that names the event's second truck as its first.
  - `GROUPS`: each queued group's place in the queue: priority (lower first), the silence it needs, its life.
  - `createCommentaryQueue`: the game's queue (0x4213a0): one phrase a frame, the ready one with the lowest priority.
  - `createPhrasePicker`: each group's shuffle bag (RANDGEN, 0x421ef0); a line drawn that may not be said is used up
    and nothing is said.

  Pure, so it runs under Node.
*/
import { msg } from "./strings.js";

const P = (script, text, extra = {}) => Object.freeze({ script, text, ...extra });

/** Each group's phrases: `script` the clips, `text` the line (a message tag), `camera` and `when` as above. */
export const PHRASES = Object.freeze({
  introRace: [
    P("getready.wav", msg("Get Ready!")),
    P("start_10.wav", msg("Please fasten your seatbelts and return 'em to the upright position; this is gonna be a little bit bumpy.")),
    P("gen_11.wav", msg("Ready or not, here we go!")),
    P("gen_21.wav", msg("Are you ready for some down and dirty racing?")),
  ],
  introSummit: [
    P("gen_19.wav", msg("Everybody ready to rassle?")),
    P("gen_20.wav", msg("Let's get ready to rassle.")),
    P("start_09.wav", msg("This is where we separate the men from the boys.")),
    P("gen_43.wav", msg("Now don't go biting anyone's ear off out there.")),
    P("sum_14.wav", msg("Who wants it more?")),
    P("load_05.wav", msg("Do all roads lead to the top? We'll soon find out.")),
  ],
  go: [P("go.wav", "")],
  finishWinner: [
    P("whatfin.wav", msg("What a finish! What a race!")),
    P("(<<1>> crown.wav", msg("<<1>> takes the monster crown.")),
    P("(<<1>> wincirc.wav", msg("<<1>> is in the winner's circle this time.")),
    P("(<<1>> pull.wav *<<2>> allway.wav", msg("<<1>> pulls it out! It's <<2>> all the way.")),
    P("(<<1>> takehome.wav", msg("<<1>> takes one home.")),
    P("(<<1>> cruise.wav", msg("<<1>> can take a cruise down victory lane.")),
    P("win_02.wav )<<1>>", msg("Looks like today is payday for <<1>>.")),
  ],
  hasFinished: [P("(<<1>> hasfin.wav", msg("<<1>> has finished the race."))],
  hasWon: [P("(<<1>> haswon.wav", msg("<<1>> has won the race."))],
  move: [
    P("(<<1>> makemove.wav", msg("<<1>> is making its move.")),
    // Said of the truck ahead: the event's second truck is the phrase's first (`of`).
    P("fear.wav )<<1>>", msg("This is where the fear starts for <<1>>."), { of: [2] }),
    P("whobe.wav", msg("Who's it gonna be?"), { camera: true }),
    P("pass_01.wav", msg("This road ain't big enough for the both of ya."), { camera: true }),
  ],
  pass: [
    P("its.wav *<<1>> allway2.wav", msg("It's <<1>> all the way."), { camera: true }),
    P("(<<1>> kisslead.wav", msg("<<1>> can kiss that lead goodbye."), { when: "passedLeader" }),
    P("pass_03b.wav", msg("Like taking candy from a baby."), { camera: true }),
    P("(<<1>> pass_05.wav", msg("<<1>> shows no mercy."), { camera: true }),
    P("(<<1>> pass_06.wav", msg("<<1>> turns the tables."), { camera: true }),
    P("(<<1>> pass_13.wav )<<2>>", msg("<<1>> inches past <<2>>.")),
  ],
  lead: [
    P("(<<1>> leadpack.wav", msg("<<1>> wants to be the leader of the pack.")),
    P("(<<1>> makelead.wav", msg("<<1>> is making its move and going for that lead position.")),
    P("betpack.wav *<<1>> holdback.wav", msg("You can bet the pack is going to try and hold <<1>> back.")),
  ],
  edge: [
    P("(<<1>> outedge.wav", msg("<<1>> is taking the outside edge.")),
    P("(<<1>> longhome.wav", msg("<<1>> is taking the long way home.")),
  ],
  goingYourWay: [
    P("goway.wav", msg("When it's going your way, its going your way.")),
    P("hardwork.wav )<<1>>", msg("Hard work pays off for <<1>>.")),
    P("pass_03b.wav", msg("Like taking candy from a baby.")),
    P("(<<1>> pass_05.wav", msg("<<1>> shows no mercy.")),
    P("(<<1>> pass_06.wav", msg("<<1>> turns the tables.")),
  ],
  clash: [
    P("clash.wav", msg("Clash of the titans!"), { camera: true }),
    P("(<<1>> and1.wav *<<2>> upclose.wav", msg("<<1>> and <<2>> are getting up close and personal.")),
    P("(<<1>> and2.wav *<<2>> headache.wav", msg("<<1>> and <<2>> are going head to head and somebody's going to end up with a headache.")),
    P("pisthead.wav", msg("That's how pistonheads say hello."), { camera: true }),
    P("getatten.wav )<<1>>", msg("That should get the attention of <<1>>."), { camera: true }),
    P("seerear.wav", msg("How'd you like to see that in your rear view mirror?"), { camera: true }),
    P("bitedust.wav", msg("Another one bites the dust."), { camera: true }),
    P("gotbreak.wav", msg("That's gotta break the heart of any competitor."), { camera: true }),
    P("crash_01.wav", msg("Nothing a little plastic surgery can't fix."), { camera: true }),
    P("crash_05.wav", msg("Bam! Who's passing out the harps and the halos?"), { camera: true }),
    P("crash_08.wav", msg("Hey, that's coming out of somebody's paycheck."), { camera: true }),
    P("crash_11.wav", msg("Oh, the humanity."), { camera: true }),
    P("add_01.wav", msg("That's gonna leave a mark!"), { camera: true }),
  ],
  cow: [P("gen_14.wav", msg("Cowabunga!"))],
  water: [
    P("(<<1>> walkwatr.wav", msg("<<1>> is walking on water.")),
    P("(<<1>> overhead.wav", msg("<<1>> may be in over its head.")),
    P("(<<1>> fishing.wav", msg("<<1>> has gone fishing.")),
    P("amphib.wav", msg("I've heard of amphibious cars, but this is ridiculous."), { camera: true }),
    P("(<<1>> drink.wav", msg("<<1>> has gone in the drink.")),
    P("(<<1>> terr_02.wav", msg("<<1>> is doing it in the drink.")),
    P("(<<1>> water_01.wav", msg("<<1>> wants to sail the seven seas.")),
  ],
  spin: [
    P("olympic.wav", msg("This could be an Olympic event in the year 2000.")),
    P("tripaxle.wav", msg("What's next, a triple axel from the double axle?")),
  ],
  ice: [
    P("chains.wav", msg("Chains will not, I repeat, will not be required for this event.")),
    P("idonthnk.wav *<<1>> chains2.wav", msg("I don't think <<1>> will need chains for this event.")),
  ],
  air: [
    P("(<<1>> doingair.wav", msg("<<1>> is doing it in the air.")),
    P("(<<1>> flyfin.wav", msg("<<1>> is flying to the finish line."), { when: "nearFinish" }),
    P("(<<1>> terr_03.wav", msg("<<1>>'s got four big wheels but ain't using any of 'em!")),
    P("terr_04a.wav *<<1>>, terr_04b.wav", msg("Here comes <<1>>, duck and cover!")),
    P("(<<1>> terr_05.wav", msg("<<1>> is reaching for the stars.")),
  ],
  roll: [
    P("rollbaby.wav", msg("Roll baby roll.")),
    P("beethov.wav", msg("Roll over Beethoven.")),
    P("(<<1>> crshdest.wav", msg("<<1>> has crashed, leaving an incredible path of destruction behind it.")),
  ],
  wheelie: [
    P("(<<1>> hangten.wav", msg("<<1>> is hanging ten.")),
    P("(<<1>> tippytoe.wav", msg("<<1>> is on its tippy toes.")),
    P("leaninto.wav", msg("Lean into it.")),
  ],
  flipped: [
    P("(<<1>> bellyup.wav", msg("<<1>> has gone belly side up, so the whirly bird's gonna fix 'em up.")),
    P("ridediff.wav", msg("Now for a ride of a different sort."), { camera: true }),
    P("ourbuddy.wav *<<1>> needhand.wav", msg("Our old buddy <<1>> needs a helping hand.")),
    P("whirly.wav", msg("The whirly bird's comin' in."), { camera: true }),
    P("whirly2.wav", msg("They're calling in the whirly bird for the big flip."), { camera: true }),
    P("(<<1>> hook.wav", msg("<<1>> is on the hook.")),
  ],
  missedCheckpoint: [
    P("gen_35.wav", msg("Now listen.  What part of the word \"checkpoint\" do you not understand?")),
    P("(<<1>> checkpnt.wav", msg("<<1>> has just missed a checkpoint. Turn around buddy.")),
  ],
  stealth: [
    P("(<<1>> add_15.wav", msg("<<1>> is driving in the stealth mode.")),
    P("add_17.wav", msg("Watch those tail lights."), { camera: true }),
  ],
  blimp: [P("blimp_01.wav", ""), P("blimp_02.wav", "")],
});

/**
 * Each queued group's figures for a truck the announcer talks about (the player's, or the one the camera follows):
 * `priority` (lower first), `silence` the seconds the announcer must have been quiet, `life` the seconds it may wait.
 * The start, GO and the finish lines that are said at once are `now`.
 */
export const GROUPS = Object.freeze({
  introRace: { now: true }, introSummit: { now: true }, go: { now: true },
  finishWinner: { priority: 0, silence: 0, life: 1 },
  hasWon: { priority: 0, silence: 0, life: 1 },
  hasFinished: { priority: 5, silence: 2, life: 3 },
  move: { priority: 10, silence: 6, life: 3 },
  pass: { priority: 8, silence: 6, life: 2.5 },
  lead: { priority: 6, silence: 6, life: 2.5 },
  edge: { priority: 15, silence: 8, life: 3 },
  goingYourWay: { priority: 8, silence: 6, life: 2.5 },
  clash: { priority: 4, silence: 3, summitSilence: 8, life: 2 },
  cow: { priority: 10, silence: 8, life: 3 },
  water: { priority: 15, silence: 8, life: 3 },
  spin: { priority: 15, silence: 8, life: 3 },
  ice: { priority: 15, silence: 8, life: 3 },
  air: { priority: 13, silence: 8, life: 3 },
  roll: { priority: 13, silence: 8, life: 3 },
  wheelie: { priority: 20, silence: 8, life: 3 },
  flipped: { priority: 2, silence: 8, life: 3 },
  missedCheckpoint: { priority: 2, silence: 8, life: 3 },
  stealth: { priority: 10, silence: 8, life: 3 },
  blimp: { priority: 100, silence: 5, life: 0.1 },
});

/** The queue holds at most this many phrases (the game's 32 slots). */
export const QUEUE_SLOTS = 32;
/** The game's FUN_00421600 plays every phrase at 0.7. */
export const COMMENTARY_GAIN = 0.7;

/** The clips in a phrase: `{ kind: "wav", name }` and `{ kind: "name", variant, arg }` (arg counts from 1). */
export function parseSpec(spec) {
  const out = [];
  for (const token of String(spec).split(/[\s,]+/).filter(Boolean)) {
    const driver = /^([()*])<<(\d+)>>$/.exec(token);
    if (driver) out.push({ kind: "name", variant: driver[1], arg: Number(driver[2]) });
    else out.push({ kind: "wav", name: token });
  }
  return out;
}

/** The clip for a driver name in a voice: `*` the first of the truck's three wave files, `(` the second, `)` the third. */
export function nameClip(waves, variant) {
  const index = variant === "*" ? 0 : variant === "(" ? 1 : 2;
  return waves?.[index] ?? null;
}

/** The phrase's arguments as the driver numbers it names (1-based), in order of first use. */
export function specArgs(spec) {
  return [...new Set(parseSpec(spec).filter((t) => t.kind === "name").map((t) => t.arg))];
}

/**
 * The game's shuffle bag (RANDGEN, 0x421ef0): items in a list; each draw walks a random number of places along it,
 * takes the item there and moves it to the back, so the last ones drawn are the least likely to come again soon.
 */
export function createBag(items, random = Math.random) {
  const order = [...items.keys()];
  return () => {
    if (order.length < 2) return items[order[0] ?? 0];
    let at = 0;
    for (let tries = 0; tries < 100; tries++) {
      if (Math.floor(random() * 4) === 0) break;
      at = at + 1 >= order.length - 1 ? 0 : at + 1;
    }
    const [index] = order.splice(at, 1);
    order.push(index);
    return items[index];
  };
}

/**
 * The game's queue (0x4213a0): `add` a phrase for a group with its arguments (`GROUPS` gives its figures, `delay` 0);
 * `tick(dt, speaking)` once a frame returns the phrase to say now, or null. The silence counts up only while nothing
 * is said. Ready phrases go lowest priority first, then the one longer past its delay, then the one with less life.
 */
export function createCommentaryQueue({ summit = false } = {}) {
  const slots = [];
  let silence = 0;
  return {
    add(group, args, extra = {}) {
      const g = GROUPS[group];
      if (!g || g.now || slots.length >= QUEUE_SLOTS) return false;
      slots.push({
        group, args, extra, priority: g.priority, delay: 0, life: g.life,
        silence: summit && g.summitSilence !== undefined ? g.summitSilence : g.silence,
      });
      return true;
    },
    tick(dt, speaking) {
      for (const s of slots) { s.delay -= dt; s.life -= dt; }
      for (let i = slots.length - 1; i >= 0; i--) if (slots[i].life <= 0) slots.splice(i, 1);
      if (speaking) { silence = 0; return null; }
      silence += dt;
      const ready = slots.filter((s) => s.delay <= 0 && silence >= s.silence);
      if (!ready.length) return null;
      ready.sort((a, b) => a.priority - b.priority || a.delay - b.delay || a.life - b.life);
      const next = ready[0];
      slots.splice(slots.indexOf(next), 1);
      return next;
    },
    get size() { return slots.length; },
    get silence() { return silence; },
  };
}

/**
 * Each group's shuffle bag. `pick(group, ctx)` draws the next phrase and returns it, or null when the line drawn may
 * not be said: `ctx.camera` the truck the camera follows is in the event (and close, for move and pass);
 * `ctx.passedLeader` the truck passed had the lead; `ctx.nearFinish` past three quarters of the lap, not a Summit
 * Rumble. A phrase naming a driver the event has none for is not said either. The phrase comes back with `args`, the
 * drivers it names in its own order (`phraseArgs`).
 */
export function createPhrasePicker(random = Math.random) {
  const bags = new Map();
  return {
    pick(group, ctx = {}) {
      if (!PHRASES[group]) throw new Error(`Unknown phrase group "${group}"`);
      if (!bags.has(group)) bags.set(group, createBag(PHRASES[group], random));
      const phrase = bags.get(group)();
      if (phrase.camera && !ctx.camera) return null;
      if (phrase.when && !ctx[phrase.when]) return null;
      const args = phraseArgs(phrase, ctx.args ?? []);
      if (specArgs(phrase.script).some((n) => !(args[n - 1] >= 1))) return null;
      return { ...phrase, args };
    },
  };
}

/** The drivers a phrase names, in its own order: the event's (`eventArgs`), or those its `of` picks from them. */
export function phraseArgs(phrase, eventArgs) {
  return phrase.of ? phrase.of.map((k) => eventArgs[k - 1]) : [...eventArgs];
}

/**
 * The text of a phrase: `text` (the line, with `<<1>>` and `<<2>>`) with the drivers' names put in; `names[n - 1]`
 * is the nth driver's.
 */
export function phraseText(text, names) {
  return String(text).replace(/<<(\d+)>>/g, (_, n) => names[Number(n) - 1] ?? "");
}

/** How long a line stays on screen after the game (0x414660): one second and a thirty-second per character. */
export function textSeconds(text) {
  return 1 + String(text).length / 32;
}
