/*
  What the trucks sound like. The engine follows the game's per-frame routine at 0x41e030: three
  looping samples play at once, `startidl` (idle), `m1-2-m2` (the mid revs) and `accel3b` (under
  throttle), and each frame the engine speed and throttle set how loud and how fast each plays
  (MONSTER_EXE_ANALYSIS.md 12). The skid, crash and ambience choices are the port's reading of
  the game's sample names and routines (0x41d2b0, 0x41d6d0, 0x41db00). Pure, so it runs under Node.
*/

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The engine's three loops, as `{ gain, rate }` each. `rpm` and `throttle` as the sim has them. */
export function engineVoices({ rpm, throttle, airborne = 0, raceClock = null, countdown = 3, player = true, scale = 1, random = 0.5 }) {
  // The playback rate follows the revs, halved in its excursion, within 0.625 to 1.6; airborne
  // wheels free-rev up to 8% more; a little random wobble rides on it.
  const f = Math.max(1e-3, ((airborne * 0.02 + 1) * rpm) / 3700);
  const rate = f >= 1 ? 1 + 0.5 * (f - 1) : 1 / (1 + 0.5 * (1 / f - 1));
  const pitch = (clamp(rate, 0.625, 1.6) + (2 * random - 1) * 0.07) * scale;

  // Idle fades out between 1000 and 3000 revs; through the last 1.5 s of the countdown the
  // engine rises from idle.
  const idleShape = rpm < 1000 ? 1 : rpm < 3000 ? (rpm - 1000) * -0.0005 + 1 : 0;
  let running = 1 - idleShape;
  if (raceClock !== null && raceClock < countdown) {
    const ramp = raceClock > countdown - 1.5 ? (raceClock - 1.5) / 1.5 : 0;
    running *= clamp(ramp, 0, 1);
  }
  const idle = clamp(1 - running, 0, 1);
  const k = player ? 0.97 : 0.85;

  const body = (1 - idle) * k * (rpm * 5e-5 + throttle * 0.3 + 0.55);
  const taper = rpm < 2000 ? 1 : rpm < 7000 ? (rpm - 2000) * -0.00016 + 1 : 0.2;
  const accelWeight = clamp(taper * throttle * 0.8 + (rpm - 5500) * 0.000363636, 0, 1);
  return {
    idle: { gain: idle * k, rate: scale },
    mid: { gain: (accelWeight * -0.95 + 1) * body, rate: pitch },
    accel: { gain: (accelWeight * 0.8 + 0.2) * body, rate: pitch * 0.65 },
  };
}

/** The sound families by ground type (the TTY value over 100: 1 cement ... 12 rocks), after the game's switch. */
export function surfaceFamily(type) {
  if (type === 2 || type === 4 || type === 5 || type === 6) return "dirt";
  if (type === 3 || type === 8 || type === 9 || type === 13) return "ice";
  if (type === 7 || type === 12) return "gravel";
  if (type === 10 || type === 11 || type === 14) return "rock";
  return "cement";
}

/**
 * The sample for a tire that is losing grip: wheelspin, or a skid or hard corner. `pick(n)` is a
 * random 1..n. Names are the stock `SOUND\*.WAV`.
 */
export function skidSample({ type, spinning, speed, pick = () => 1 }) {
  const family = surfaceFamily(type);
  if (spinning) {
    return { cement: `SPINCEM${pick(3)}`, dirt: `SPINDIR${pick(3)}`, ice: "SPINICE", gravel: `SPINDIR${pick(3)}`, rock: `SPINROC${pick(3)}` }[family];
  }
  if (speed > 45 && family === "cement") return "CORNCEM1";
  if (speed > 45 && family === "dirt") return "CORNDIR1";
  if (speed > 45 && family === "ice") return "CORNICE1";
  return {
    cement: "SKID-C2", dirt: `SKID-D${pick(2)}`, gravel: `SKID-G${pick(3)}`,
    ice: type === 9 ? `SNWSKID${4 + pick(3)}` : "SPINICE", rock: `SPINROC${pick(3)}`,
  }[family];
}

/** How hard a tire is skidding, 0 (gripping) to 1: the share of its friction limit in use, past 85%. */
export function skidAmount(tire) {
  if (!tire.onGround || tire.grip < 20) return 0;
  const used = Math.hypot(tire.force[0], tire.force[2]) / tire.grip;
  return clamp((used - 0.85) / 0.35, 0, 1);
}

/**
 * The sound of a hull impact (0x429080, called from the contact response at 0x46ba80): one of
 * two samples at random, `suspen5` or `suspen6` while the truck is undamaged, `suspen1` or
 * `suspen3` once it is not, at x1.8. The game has no other crash sample for trucks. It is not
 * started while the truck's previous impact sound is still playing. `null` when too soft to hear.
 */
export function impactSound(force, damaged = false, pick = () => 1) {
  if (force < 600) return null;
  const names = damaged ? ["SUSPEN1", "SUSPEN3"] : ["SUSPEN5", "SUSPEN6"];
  return { name: names[(pick(2) - 1) % 2], gain: IMPACT_GAIN };
}
export const IMPACT_GAIN = 1.8;

/** The sample for a gear change (first to second, second to third), or null. */
export function gearSound(from, to) {
  if (from === 4 && to === 5) return "2NDGEAR";
  if (from === 5 && to === 6) return "3RDGEAR";
  return null;
}

/** A one-shot's delay until it plays next: uniform between its two timers, seconds. */
export function nextDelay(timerMin, timerMax, random = Math.random) {
  return timerMin + (timerMax - timerMin) * random();
}

/** Which loop to run in a `.KLP` buffer: `{ start, end }` in samples (end null: the sample's end), or null for the whole sample. */
export function loopRegion(klp, length) {
  const loop = klp?.loops?.[0];
  if (!loop) return null;
  const end = loop.end === null || loop.end === undefined ? length : loop.end;
  if (loop.start < 0 || loop.start >= end || end > length) return null;
  return { start: loop.start, end };
}

/**
 * The sound an object makes when a truck hits it (0x428bc0): the SIT's own name for it, or by
 * its type (1 post, 2 barricade, 4 pylon, 10 train) when it names none, louder or softer by what
 * it is. `name` is the file as the SIT writes it; null when there is nothing to play.
 */
export function objectHitSound({ hitSound, type }) {
  let name = hitSound ? hitSound.replace(/\.wav$/i, "") : { 1: "hitPost1", 2: "barricad", 4: "pylon", 10: "crash1" }[type] ?? null;
  if (!name) return null;
  let gain = 1;
  if (/^strike/i.test(name)) { name = "strike1"; gain = 3; }
  const scale = [["hickz", 2], ["flush", 1.5], ["hay", 0.6], ["dino", 2.2], ["rock", 1.3], ["barn1", 2], ["cowpain", 4], ["doctor", 2.5], ["coffin", 2.8]];
  for (const [prefix, k] of scale) if (name.toLowerCase().startsWith(prefix)) { gain *= k; break; }
  return { name, gain };
}

/** The horn's sample: `horn1` alone, or with the kooky horn on, one of three that does not repeat (0x429490). */
export function hornSample(kooky, last = -1, random = Math.random) {
  if (!kooky) return { name: "HORN1", gain: 1, index: 0 };
  let index = Math.floor(random() * 3);
  for (let tries = 0; tries < 10 && index === last; tries++) index = Math.floor(random() * 3);
  return { name: ["HORN1", "HORN-A", "HORN-F"][index], gain: index === 0 ? 1 : 1.5, index };
}

/** YeeHaw's volume (0x429350). */
export const YEEHAW_GAIN = 1.8;

/*
  The mixer (MONSTER_EXE_ANALYSIS.md 12, "The mixer": 0x563800 each frame, 0x462d60 per sound). At most 16
  sounds are mixed at once; a positioned sound's gain falls with the square root of its distance over the
  audible range, which the weather sets; a sound below 1/128 is inaudible and not mixed; when more than 16
  are audible the loudest 16 are kept.
*/
export const MAX_VOICES = 16;
export const INAUDIBLE_GAIN = 1 / 128;

/** The audible range in feet (0x41f980): 1000, 500 in Fog, 300 in Dense Fog, 800 in Rain, 700 in Snow. */
export const soundRange = (weather) => ({ 2: 500, 3: 300, 4: 800, 5: 700 }[weather] ?? 1000);

/** The gain a positioned sound keeps at `distance` feet: 1 close, 0 at the range, falling like 1 - sqrt(d / range). */
export const attenuation = (distance, range) => (distance >= range ? 0 : clamp(1 - Math.sqrt(Math.max(0, distance) / range), 0, 1));

/**
 * Which of the sounds (by loudness) are mixed: `true` for the loudest `max` that are audible. `held[i]` marks a sound
 * that was mixed the last time; it keeps its place unless another is a quarter louder, so two sounds of near level do not
 * trade places every frame (which would be heard as a flutter).
 */
export function cullVoices(levels, max = MAX_VOICES, held = []) {
  const order = levels.map((level, i) => ({ level, i, rank: level * (held[i] ? 1.25 : 1) })).filter(({ level }) => level >= INAUDIBLE_GAIN).sort((a, b) => b.rank - a.rank || a.i - b.i);
  const keep = levels.map(() => false);
  for (const { i } of order.slice(0, max)) keep[i] = true;
  return keep;
}

/**
 * A `.KLP` the strict reader refuses but that still names its loop: `ACCEL3B.KLP` says five loops and lists four (the game
 * rejects it as well and restarts the sample at a random place whenever it ends). The first `end start` pair is taken (an end
 * of 0 is the sample's end), so the accel sample loops its steady tail instead of replaying its attack every cycle.
 */
export function lenientKlp(bytes) {
  const tokens = new TextDecoder("latin1").decode(bytes).trim().split(/\s+/).map((t) => parseInt(t, 10));
  if (tokens.length < 4 || tokens.some((n) => !Number.isFinite(n)) || tokens[0] < 3 || tokens[0] > 6) return null;
  const end = tokens[2], start = tokens[3];
  return start >= 0 ? { loops: [{ start, end: end <= 0 ? null : end }] } : null;
}
