/*
  The announcer (MONSTER_EXE_ANALYSIS.md 12, Trucksfx.c 0x421600). A phrase is a short script of
  voice clips: plain `name.wav` tokens, and driver names `(<<n>>`, `*<<n>>` and `)<<n>>`, which
  are the nth driver's name clip in its rising, flat or falling voice (the three "Wave File"
  names of the truck's .TRK: `bfootu`, `bfootf`, `bfootd` order is f, u, d, see nameClip). The
  game plays the clips back to back, and shows the same line as text.

  What follows is the phrase table as the EXE holds it, grouped by what the phrases are for, and
  the port's own rules for when to say them: the game's triggers are spread over Trucksfx.c and
  are not traced. Phrases come from a shuffle bag per group, so none repeats until the rest have
  played (RANDGEN, 0x421ef0). Pure, so it runs under Node.
*/

export const PHRASES = Object.freeze({
  introRace: ["getready.wav", "start_10.wav", "gen_11.wav", "gen_21.wav"],
  introSummit: ["gen_19.wav", "gen_20.wav", "start_09.wav", "gen_43.wav", "sum_14.wav", "load_05.wav"],
  go: ["go.wav"],
  finishWinner: ["whatfin.wav", "(<<1>> crown.wav", "(<<1>> wincirc.wav", "(<<1>> pull.wav *<<2>> allway.wav", "(<<1>> takehome.wav", "(<<1>> cruise.wav", "win_02.wav )<<1>>"],
  hasFinished: ["(<<1>> hasfin.wav"],
  hasWon: ["(<<1>> haswon.wav"],
  move: ["(<<1>> makemove.wav", "fear.wav )<<1>>", "whobe.wav", "pass_01.wav"],
  takeLead: ["its.wav *<<1>> allway2.wav", "(<<1>> kisslead.wav", "(<<1>> leadpack.wav", "(<<1>> makelead.wav", "betpack.wav *<<1>> holdback.wav"],
  pass: ["pass_03b.wav", "(<<1>> pass_05.wav", "(<<1>> pass_06.wav", "(<<1>> pass_13.wav )<<2>>"],
  edge: ["(<<1>> outedge.wav", "(<<1>> longhome.wav"],
  goingYourWay: ["goway.wav", "hardwork.wav )<<1>>"],
  clash: ["clash.wav", "(<<1>> and1.wav *<<2>> upclose.wav", "(<<1>> and2.wav *<<2>> headache.wav", "pisthead.wav", "getatten.wav )<<1>>", "seerear.wav"],
  wipeout: ["bitedust.wav", "gotbreak.wav", "crash_01.wav", "crash_05.wav", "crash_08.wav", "crash_11.wav", "add_01.wav", "(<<1>> remodel.wav", "(<<1>> wrekball.wav"],
  roadsign: ["detour2.wav", "(<<1>> signcake.wav", "truktime.wav", "alivkill.wav", "(<<1>> detour.wav"],
  train: ["train_01.wav", "train_02.wav", "train_03.wav"],
  cow: ["gen_14.wav"],
  water: ["(<<1>> walkwatr.wav", "(<<1>> overhead.wav", "(<<1>> fishing.wav", "amphib.wav", "(<<1>> drink.wav", "(<<1>> terr_02.wav", "(<<1>> water_01.wav"],
  spin: ["olympic.wav", "tripaxle.wav"],
  ice: ["chains.wav", "idonthnk.wav *<<1>> chains2.wav"],
  air: ["(<<1>> doingair.wav", "(<<1>> flyfin.wav", "(<<1>> terr_03.wav", "terr_04a.wav *<<1>>, terr_04b.wav", "(<<1>> terr_05.wav"],
  roll: ["rollbaby.wav", "beethov.wav", "(<<1>> crshdest.wav"],
  wheelie: ["(<<1>> hangten.wav", "(<<1>> tippytoe.wav", "leaninto.wav"],
  flipped: ["(<<1>> bellyup.wav", "ridediff.wav", "ourbuddy.wav *<<1>> needhand.wav"],
  helicopter: ["whirly.wav", "whirly2.wav", "(<<1>> hook.wav"],
  missedCheckpoint: ["gen_35.wav", "(<<1>> checkpnt.wav"],
  tailLights: ["add_17.wav"],
  stealth: ["(<<1>> add_15.wav"],
});

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

/** A shuffle bag: every item once in random order, then again; never the same one twice in a row across a refill. */
export function createBag(items, random = Math.random) {
  let queue = [];
  let last = null;
  return () => {
    if (queue.length === 0) {
      queue = [...items];
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      if (queue.length > 1 && queue[queue.length - 1] === last) [queue[0], queue[queue.length - 1]] = [queue[queue.length - 1], queue[0]];
    }
    last = queue.pop();
    return last;
  };
}

/**
 * The announcer's choosing: which phrase to say for an event, and whether now is a good time.
 * `say(group, args, now, options)` returns `{ group, spec, args }` or null. A phrase is skipped
 * while another is still being spoken (`finished(now)` must be called when one ends), when the
 * group said something less than `groupGap` seconds ago, or when a less important one is
 * wanted while a more important one spoke less than `gap` seconds ago.
 */
export function createAnnouncer({ random = Math.random, gap = 3, groupGap = 14 } = {}) {
  const bags = new Map();
  const lastByGroup = new Map();
  let speaking = false, lastEnd = -1e9, lastPriority = 0;
  const bag = (group) => {
    if (!bags.has(group)) bags.set(group, createBag(PHRASES[group], random));
    return bags.get(group);
  };
  return {
    /** @param {string} group a key of PHRASES; `args` the driver numbers (1-based) the phrase names, in order */
    say(group, args, now, { priority = 1, groupCooldown = groupGap, force = false } = {}) {
      if (!PHRASES[group]) throw new Error(`Unknown phrase group "${group}"`);
      if (!force) {
        if (speaking) return null;
        if (now - (lastByGroup.get(group) ?? -1e9) < groupCooldown) return null;
        if (priority <= lastPriority && now - lastEnd < gap) return null;
      }
      const spec = bag(group)();
      const needed = specArgs(spec);
      // A phrase that names a driver the event has no one for is not said.
      if (needed.some((n) => args[n - 1] === undefined)) return null;
      lastByGroup.set(group, now);
      speaking = true;
      lastPriority = priority;
      return { group, spec, args };
    },
    /** The phrase has been spoken. */
    finished(now) {
      speaking = false;
      lastEnd = now;
    },
    get speaking() { return speaking; },
  };
}

/**
 * The text of a phrase: `text` (the EXE's English line, with `<<1>>` and `<<2>>`) with the
 * drivers' names put in; `names[n - 1]` is the nth driver's.
 */
export function phraseText(text, names) {
  return String(text).replace(/<<(\d+)>>/g, (_, n) => names[Number(n) - 1] ?? "");
}

/** How long a line stays on screen after the game (0x414660): one second and a thirty-second per character. */
export function textSeconds(text) {
  return 1 + String(text).length / 32;
}
