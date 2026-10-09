/*
  Dust, tire tracks and sparks (MONSTER_EXE_ANALYSIS.md 14). The dust follows the game's own rules
  (0x4de010 spawns a puff into a pool of 96, 0x4deab0 decides per tire, 0x4de390 draws it); the tire
  tracks and the sparks are the port's additions (the game reads `tireTrackFlag` but never uses it, and its
  `0x531e40` only throws sparks from a hull contact that the port draws). Pure, so it runs under Node.
*/
export const MPH_PER_FTS = 0.681818;
/** The game puffs only within 512 ft of the camera (squared distance 262144); the port puffs for every truck. */
export const DUST_RANGE_FT = Infinity;
/** One puff a tire above this speed, a second at its pair with even odds above the faster one, mph. */
export const DUST_SLOW_MPH = 10, DUST_FAST_MPH = 20;
// The game's pool holds 96; the port's longer, larger dust from every truck needs far more.
export const PUFF_POOL = 640, PUFF_FRAMES = 12;
/** How often a tire's dust is decided, seconds (the game decides every frame, its pool of 96 limiting it). */
export const DUST_TICK_S = 1 / 15;

/** A puff lives 1.5 to 3.5 seconds. */
export const puffLife = (random) => 1.5 + 2 * random;
/** A puff's half size at birth, feet: 384 to 640 units of 1/256 ft. */
export const puffSize = (random) => 1.5 + random;
/** How far through its frames a puff is at fraction `p` of its life: quick at first, then slowing so the last frames linger. */
export const puffProgress = (p) => 1 - (1 - Math.min(1, Math.max(0, p))) ** 2;
/** The frame (0 to 11, PUFF2_01 to PUFF2_12) a puff of `life` seconds shows after `age`; -1 when it is over. */
export const puffFrame = (age, life) => {
  if (age >= life || age < 0) return -1;
  return Math.min(PUFF_FRAMES - 1, Math.floor(PUFF_FRAMES * puffProgress(age / life)));
};
/** A hull contact makes smoke only once it has lasted this long, seconds, and then a puff this often. */
export const SMOKE_AFTER_S = 0.25, SMOKE_EVERY_S = 0.15;
/** Contact is over when no report has come for this long. */
export const CONTACT_GAP_S = 0.6;
/** The puff grows by a foot over its life. */
export const puffHalfSize = (size, age, life) => size + Math.min(1, age / life);

/** The surfaces that raise dust: dirt, grass and gravel (the sound families), not concrete, ice or rock. */
export const raisesDust = (family) => family === "dirt" || family === "gravel";
/** The surfaces that keep a tread: the soft ones and snow (type 9). */
export const keepsTread = (family, type) => family === "dirt" || family === "gravel" || type === 9;

/**
 * Which tires puff this tick: each tire on a dusty surface above 10 mph, plus a second puff at its place
 * with even odds above 20 mph. Returns a list of tire indices (a repeated index is the second puff).
 */
export function dustPuffs({ speedFtS, onGround, dusty, random }) {
  if (!dusty) return [];
  const mph = Math.abs(speedFtS) * MPH_PER_FTS;
  if (mph <= DUST_SLOW_MPH) return [];
  const out = [];
  onGround.forEach((on, i) => {
    if (!on) return;
    out.push(i);
    if (mph > DUST_FAST_MPH && random() < 0.5) out.push(i);
  });
  return out;
}

/** Tire tracks: a mark every this many feet of travel, as wide as the tire, kept this long (the last part fading). */
export const TRACK_STEP_FT = 3, TRACK_WIDTH_FT = 2.2, TRACK_LIFE_S = 70, TRACK_FADE_S = 25, TRACK_POOL = 30000;
/** Every truck lays tracks wherever it is (no distance limit); the pool is large enough for a full field. */
export const TRACK_RANGE_FT = Infinity;
/** A jump longer than this between marks (a reset, the helicopter) starts a new strip. */
export const TRACK_BREAK_FT = 10;

/** The opacity of a mark that is `age` seconds old: full, then fading to nothing at its end. */
export const trackOpacity = (age) => (age >= TRACK_LIFE_S ? 0 : age <= TRACK_LIFE_S - TRACK_FADE_S ? 1 : (TRACK_LIFE_S - age) / TRACK_FADE_S);

/** Sparks: two thrown every eighth of a second while a hull contact scrapes at speed (0x531e40), and a burst on a hard hit. */
export const SPARK_INTERVAL_S = 0.125, SPARK_MIN_SPEED = 5, SPARK_POOL = 320, SPARK_HIT_FORCE = 600;
export const sparksForHit = (force) => (force < SPARK_HIT_FORCE ? 0 : Math.min(28, Math.round(6 + force / 250)));
export const puffsForHit = (force) => (force < SPARK_HIT_FORCE ? 0 : Math.min(5, 1 + Math.floor(force / 1500)));

/**
 * Advance a contact's scrape timer by `seconds` of contact; returns `{ timer, sparks }`: how many sparks to
 * throw now (2 per interval) when the truck moves faster than 5 ft/s.
 */
export function scrapeSparks(timer, seconds, speedFtS) {
  if (speedFtS < SPARK_MIN_SPEED) return { timer: 0, sparks: 0 };
  let t = timer + seconds, sparks = 0;
  while (t >= SPARK_INTERVAL_S) { t -= SPARK_INTERVAL_S; sparks += 2; }
  return { timer: t, sparks };
}
