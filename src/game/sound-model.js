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

/** The crash sample and loudness for a hull impact (the force in lb), or null when it is too soft to hear. */
export function crashSound(force, pick = () => 1) {
  if (force < 600) return null;
  const gain = clamp(force / 20000, 0.25, 1);
  if (force < 2500) return { name: "THUNKIT", gain };
  if (force < 9000) return { name: "CRUNCHX", gain };
  const crashes = ["CRASH_01", "CRASH_05", "CRASH_08", "CRASH_09", "CRASH_11", "CRASH_12", "CRASH_13", "CRASH_14", "CRASH_15", "CRASH_16"];
  return { name: crashes[(pick(crashes.length) - 1) % crashes.length], gain };
}

/** The sample for landing from the air with this downward speed (ft/s), or null for a soft touch. */
export function landingSound(fallSpeed, pick = () => 1) {
  if (fallSpeed < 12) return null;
  const names = ["SUSPEN1", "SUSPEN3", "SUSPEN5", "SUSPEN6"];
  return { name: names[(pick(names.length) - 1) % names.length], gain: clamp(fallSpeed / 45, 0.3, 1) };
}

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
