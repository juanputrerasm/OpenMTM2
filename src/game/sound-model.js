/*
  What the trucks sound like. The engine follows the game's per-frame routine at 0x41e030: three
  looping samples play at once, `startidl` (idle), `m1-2-m2` (the mid revs) and `accel3b` (under
  throttle), and each frame the engine speed and throttle set how loud and how fast each plays
  (MONSTER_EXE_ANALYSIS.md 12). The skids follow 0x41bbd0, 0x47c480, 0x477520, 0x41d2b0 and 0x41db00, the water and
  the bridges 0x41bbd0 and 0x41ec90. Pure, so it runs under Node.
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

/*
  Skids (MONSTER_EXE_ANALYSIS.md 12, "Skids"). Only the rear tires sound, each with a corner loop and a wheelspin loop
  chosen by the surface under it; braking makes no skid sound in MTM2. Every name is MTM2's: SOUND.POD also holds MTM1's
  skid set (CORNCEM1, SPINDIR1, SKIDCEM0 ...), which MTM2 never plays.
*/

/** The skids' surface code of a tire: its value's `type * 100`, -1 in the air; in Snow all but 1400 are snow, deep water ice. */
export function skidSurface(value, onGround = true, weather = 0) {
  if (!onGround || !(value >= 0)) return -1;
  const code = Math.floor(value / 100) * 100;
  if (weather !== 5 || code === 1400) return code;
  return code === 1300 ? 800 : 900;
}

const DIRT = [200, 400, 500, 600], GRAVEL = [700, 1200], ICE = [300, 800, 900, 1300], ROCK = [1000, 1100, 1400];

/**
 * A variant picker that never gives the one it gave last (the game tries ten times): `pick(n)` is 1..n. One per routine,
 * as the game keeps one last variant per sample family and routine.
 */
export function variantPicker(random = Math.random) {
  const last = new Map();
  return (family, n) => {
    let v = 1 + Math.floor(random() * n);
    for (let tries = 0; tries < 10 && v === last.get(family) && n > 1; tries++) v = 1 + Math.floor(random() * n);
    last.set(family, v);
    return v;
  };
}

/** The corner skid's sample and gain for a surface code (0x41db00), or null (in the air, or rocks: `cornroc1` is not in SOUND.POD). */
export function cornerSample(code, pick = () => 1) {
  if (code < 0) return null;
  if (DIRT.includes(code)) return { name: `SKID-D${pick("d", 2)}`, gain: 1.1 };
  if (GRAVEL.includes(code)) return { name: `SKID-G${pick("g", 3)}`, gain: 1.3 };
  if (ICE.includes(code)) return { name: `SNWSKID${4 + pick("snw", 3)}`, gain: 0.35 };
  if (ROCK.includes(code)) return { name: "CORNROC1", gain: 1 };
  return { name: "SKID-C2", gain: 0.7 };
}

/** The wheelspin's sample and gain for a surface code (0x41d2b0), or null in the air. */
export function spinSample(code, pick = () => 1) {
  if (code < 0) return null;
  if (DIRT.includes(code)) return { name: `SKID-D${pick("d", 2)}`, gain: 1.1 };
  if (GRAVEL.includes(code)) return { name: `SKID-G${pick("g", 3)}`, gain: 1.3 };
  if (ICE.includes(code)) return { name: "SPINICE", gain: 1 };
  if (ROCK.includes(code)) return { name: `SPINROC${pick("roc", 3)}`, gain: 1 };
  return { name: "SKID-C2", gain: 0.7 };
}

/*
  MTM1's skid sounds ("MTM1 sounds" in Options; MTM1_MONSTER_EXE_ANALYSIS.md 6.7): the same triggers, MTM1's samples,
  and the brake skid MTM2 left unused. Null where MTM1 plays nothing.
*/
const MTM1_FAMILY = (code) => (code === 0 || code === 100 ? "CEM" : [200, 400, 500, 600].includes(code) ? "DIR"
  : [300, 800, 900].includes(code) ? "ICE" : [700, 1000, 1100, 1200].includes(code) ? "ROC" : null);
/** MTM1's corner skid (0x43cac0): `corncem1`, `corndir1` (rocks too) or `cornice1`. */
export function mtm1CornerSample(code) {
  const family = MTM1_FAMILY(code);
  return family ? { name: `CORN${family === "ROC" ? "DIR" : family}1`, gain: 1 } : null;
}
/** A variant as MTM1 draws it: `(rand << 2) / 0x7fff`, 0 to 3. */
export const mtm1Variant = (random = Math.random) => Math.min(3, Math.floor(random() * 4));
/** MTM1's wheelspin (0x43cd60): `spin<family><variant>`, none for variant 0 (MTM1 has no such file). */
export function mtm1SpinSample(code, variant) {
  const family = MTM1_FAMILY(code);
  return family && variant > 0 ? { name: `SPIN${family}${variant}`, gain: 1 } : null;
}
/** MTM1's brake skid (0x43d050), once a rear tire: `skidcem` and `skiddir` 0 to 3; MTM1 has no ice or rock ones. */
export function mtm1SkidSample(code, variant) {
  const family = MTM1_FAMILY(code);
  return family === "CEM" || family === "DIR" ? { name: `SKID${family}${variant}`, gain: 1 } : null;
}
/** The brake skid starts when the brake goes on from fully off faster than this, ft/s (0x43d580). */
export const MTM1_SKID_SPEED = 29.34;

/** A skid loop's pitch: the truck's own, plus or minus a tenth at random. */
export const skidRate = (random = Math.random, scale = 1) => scale + (2 * random() - 1) * 0.1;

/** Corner skids need the truck faster than this, ft/s (0x47c480). */
export const CORNER_MIN_SPEED = 29.34;

/**
 * Whether a tire slides (0x47c480): its lateral coefficient past 0.975 in size starts it, below 0.95 ends it, and between
 * it keeps what it was. A tire in the air, or a truck slower than `CORNER_MIN_SPEED`, does not slide.
 */
export function tireSliding(was, { onGround, lateral }, speed) {
  if (speed <= CORNER_MIN_SPEED || !onGround) return false;
  const c = Math.abs(lateral ?? 0);
  if (c > 0.975) return true;
  if (c < 0.95) return false;
  return !!was;
}

/** The surface types whose value carries the dust flag (8 in 0x4de180): Cement, Dirt, Sand. Only these spin audibly. */
export const DUST_TYPES = new Set([1, 2, 5]);

/**
 * What the wheelspin does this step (0x477520): "start" (both rear spin loops, if not playing), "stop" (all the skid
 * loops) or null. Full throttle is 1.0 exactly; `forward` the body's forward speed, ft/s.
 */
export function spinAction({ throttle, wasThrottle, forward, tires }) {
  const full = throttle >= 1, wasFull = wasThrottle >= 1;
  const v = Math.abs(forward);
  if (!full) return wasFull ? "stop" : null;
  if (v <= 1) return wasFull ? "stop" : null;
  if (v < 58.68) return tires.some((t) => t.onGround && DUST_TYPES.has(Math.floor(t.surface / 100))) ? "start" : null;
  return v > 102.69 ? "stop" : null;
}

/** The splash on going into water (0x41bbd0): `splash1` at `0.1 - v_y / 9`, at most 1.7; null when that is not above 0. */
export function splashGain(vy) {
  const gain = 0.1 - vy / 9;
  return gain > 0 ? Math.min(1.7, gain) : null;
}

/** The loop of a truck in water (`Wtr-abv1`): `0.1 + speed / 10`, at most 1.2. */
export const wadeGain = (speed) => Math.min(1.2, 0.1 + speed / 10);

/** The bridge loop (0x41ec90): its gain (`speed / 60`, at most 1.4) and pitch (`speed / 90`, 0.3..1); null at 2 ft/s or slower. */
export function bridgeVoice(speed) {
  if (!(speed > 2)) return null;
  return { gain: Math.min(1.4, speed / 60), rate: Math.min(1, Math.max(0.3, speed / 90)) };
}

/** The surfaces that sound as a bridge (0x41bbd0 calls 0x41ec90 for these two). */
export const BRIDGE_SURFACES = [1100, 1400];

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

/**
 * A `.KLP` loop in seconds, `{ start, end }`, or null for the whole sample. The points count the file's own samples,
 * made at `sourceRate`; a browser decodes at its own rate, so the decoded length is turned back into source samples
 * first. Without a known source rate the decoded one stands in (a WAV the browser kept at its rate).
 */
export function loopSeconds(klp, duration, sourceRate, decodedRate) {
  const rate = Number.isFinite(sourceRate) && sourceRate > 0 ? sourceRate : decodedRate;
  const region = loopRegion(klp, Math.ceil(duration * rate));
  return region ? { start: region.start / rate, end: region.end / rate } : null;
}
