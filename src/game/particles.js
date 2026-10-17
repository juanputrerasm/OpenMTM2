/*
  What the trucks throw up and leave behind, for "Rich particles" (docs/VISUALS.md,
  "Particles"). The game draws dust as twelve frames of a sprite and nothing else
  (MONSTER_EXE_ANALYSIS.md 14); with the switch off the port draws that, and its own plain drops,
  sparks and tread ribbons (game/tire-effects.js). With it on, what a wheel throws follows what
  it stands on, and everything thrown is lit by the scene's light and veiled by its fog.

  Two sorts of particle. A puff is a soft cloud that swells, drifts and thins: dust, smoke, the
  powder of snow, the mist of water. A streak is a small hard thing in flight, drawn out along
  its way: a spark, a drop, a chip of ice or packed snow, a clod.

  When a tire raises dust is still the game's rule (`dustPuffs`). All else here is the port's.

  Pure, so it runs under Node.
*/
import { skidAmount } from "./sound-model.js";
import { MPH_PER_FTS } from "./tire-effects.js";

const RAIN = 4, SNOW = 5;
/** The `.TTY` ground types that are what they are in any weather (MTM2_PHYSICS.md 2.3). */
const TYPE_MUD = 4, TYPE_SAND = 5, TYPE_GRASS = 6, TYPE_ICE = 8, TYPE_SNOW = 9;

/** How many of each the scene holds at once; a headset throws `LITE_SHARE` of the puffs. */
export const PUFF_POOL = 1536, STREAK_POOL = 4096, LITE_SHARE = 0.5;

/*
  Puffs. `tone` is the colour of what it is made of (linear, as lit by white light), and `ground`
  how much of the ground's own colour dust takes instead. Powder and mist are over white:
  a cloud of snow or of drops throws light about inside itself and is brighter than a matt
  white face in the same light. `sizeFt` is its radius at birth
  (from, to), `growFt` what its radius gains over its life, `squash` its height over its width
  (what hangs by the ground spreads along it), `lifeS` how long it lasts (from,
  to), `opacity` how much it hides at its thickest, `riseFtPerS` how it climbs (or sinks),
  `drag` how fast it loses the speed it was thrown with, per second.
*/
export const PUFF_KINDS = Object.freeze({
  dust: Object.freeze({ tone: [0.4, 0.31, 0.22], ground: 0.5, sizeFt: [1.8, 2.6], growFt: 6.5, squash: 0.75, lifeS: [1.7, 3.1], opacity: 0.42, riseFtPerS: 1.2, drag: 2.2 }),
  smoke: Object.freeze({ tone: [0.11, 0.11, 0.12], ground: 0, sizeFt: [1.5, 2.2], growFt: 5, squash: 1, lifeS: [1.3, 2.4], opacity: 0.46, riseFtPerS: 3.6, drag: 1.6 }),
  powder: Object.freeze({ tone: [1.2, 1.24, 1.3], ground: 0, sizeFt: [1.3, 2], growFt: 4.6, squash: 0.8, lifeS: [0.8, 1.5], opacity: 0.5, riseFtPerS: -1.2, drag: 2.6 }),
  // Fine spray off a wet tread: low and flat, and so fine that the air takes what it was thrown with at once (`MIST`).
  mist: Object.freeze({ tone: [0.95, 1, 1.06], ground: 0, sizeFt: [0.7, 1.2], growFt: 3, squash: 0.5, lifeS: [0.7, 1.3], opacity: 0.11, riseFtPerS: 0.4, drag: 6 }),
  // The smoke of a tire that slides on hard ground: pale, and thinner than a crash's.
  rubber: Object.freeze({ tone: [0.5, 0.5, 0.52], ground: 0, sizeFt: [1.6, 2.4], growFt: 6, squash: 0.85, lifeS: [1.4, 2.8], opacity: 0.2, riseFtPerS: 2.4, drag: 2 }),
});

/*
  Thick dust (docs/VISUALS.md, "How a puff is drawn"). A puff is drawn on a square, and each
  point of each square is worked out and laid over the picture, however little it adds: where
  the eye follows trucks through their dust the squares add up to dozens of pictures' worth. How
  many (`puffCover`, summed) says when the puffs are `heavy`: from `heavyFrom` pictures' worth,
  and until they are back under `heavyUntil`, so a cloud at the edge of it does not flicker
  between the two. Heavy puffs are drawn into a picture `shrink` times smaller each way and laid
  over the scene from that (render/over-scene.js). The heavy way has a cost of its own, the
  scene's depth copied for it (3.8 ms where a picture's worth of squares drawn the light way
  is about 1, on the chip it was measured on), which `heavyUntil` is set by.
*/
export const OVER = Object.freeze({ heavyFrom: 6, heavyUntil: 4, shrink: 4 });

/** Whether puffs whose squares cover `load` pictures' worth are heavy, given whether they `were` a frame ago. */
export const overIsHeavy = (were, load) => load >= (were ? OVER.heavyUntil : OVER.heavyFrom);

/**
 * How much of the picture a puff's square covers, 0 to 1 (render/particles.js `PUFF_VERTEX` draws
 * it): the puff's middle is `x` to the right of the eye, `y` above it and `depth` ahead of it,
 * feet, and `radius` across; `focal` is the view's focal length against half its height
 * (1 / tan of half its field of view), `aspect` its width over its height and `near` its near
 * plane. The square stands across the way to the eye at the puff's near side, as wide as the
 * puff looks from there, and is the whole picture when the eye is in the puff or nearly. Taken
 * here as square to the view, which is near enough to count pictures by.
 */
export function puffCover(x, y, depth, radius, focal, aspect, near) {
  const dist = Math.hypot(x, y, depth);
  if (dist - radius <= near * 3) return 1;
  // Behind the eye.
  if (depth <= near) return 0;
  // Half the square's side against its distance, and so against half the picture's height and half its width.
  const half = radius / Math.sqrt(dist * dist - radius * radius) * 1.02 * (dist / depth);
  const halfY = half * focal, halfX = halfY / aspect;
  const atX = (x / depth) * focal / aspect, atY = (y / depth) * focal;
  const wide = Math.min(1, atX + halfX) - Math.max(-1, atX - halfX), tall = Math.min(1, atY + halfY) - Math.max(-1, atY - halfY);
  return wide > 0 && tall > 0 ? (wide * tall) / 4 : 0;
}

/*
  Dust (docs/VISUALS.md, "Dust"). Whether a tire raises dust is still the game's rule
  (game/tire-effects.js `dustPuffs`: over 10 mph on dusty ground, and a second puff with even
  odds over 20). How much is the port's:
   - The trail. A tire raising dust lays it along the way it rolled, a puff every `spacingFt`
     for each of the game's puffs that tick, so the cloud behind it is even. A truck further than
     `farFt` from the eye lays them `farSpacing` times as far apart, each `farScale` times the
     size.
   - The ground. How dusty ground is follows what it is (its `.TTY` type) and how it looks: the
     mean colour of the texture under the wheel (`groundDust`). Ground that gives less than
     `least` gives none.
   - The weather (`DUST_WEATHER`).
   - Its colour is the ground's, paler (`dustColour`).
*/
export const DUST = Object.freeze({ spacingFt: 6, farFt: 400, farSpacing: 2, farScale: 1.3, least: 0.1, paler: 1.3 });

/*
  Mist (docs/VISUALS.md, "Mist"). A tread running over a film of water flings it off as spray so
  fine that the air stops it at once: it hangs low behind the wheel and thins away, a veil that
  trails behind a truck at speed, not a cloud that rolls along with it. So it is laid along the
  way a tire rolls, as dust is, a puff every so many feet: from `fromMph` (`fromWaterMph` wading
  in the level's water), a puff every `spacingFt[0]` feet, closing to `spacingFt[1]` from
  `fullMph`. Each leaves behind the tread, carried with `carried` of the truck's velocity and up
  at `upFtS`.
*/
export const MIST = Object.freeze({ fromMph: 14, fromWaterMph: 12, fullMph: 50, spacingFt: Object.freeze([6, 1.8]), carried: 0.3, upFtS: Object.freeze([0.5, 2.5]) });

/** How far apart a tire running at `speedFtS` lays its mist on what it stands on (`stood`, "wet" or "water"), feet; Infinity where it lays none. */
export function mistSpacingFt(speedFtS, stood = "wet") {
  const mph = Math.abs(speedFtS) * MPH_PER_FTS, from = stood === "water" ? MIST.fromWaterMph : MIST.fromMph;
  if (!(mph > from) || (stood !== "wet" && stood !== "water")) return Infinity;
  const fast = Math.min(1, (mph - from) / (MIST.fullMph - from));
  return MIST.spacingFt[0] + (MIST.spacingFt[1] - MIST.spacingFt[0]) * fast;
}

/**
 * How much dust each ground type gives where its colour says it is dry and bare (the `.TTY`
 * type, MTM2_PHYSICS.md 2.3): dirt and sand the most, gravel, rocks and grass some, mud a little.
 * Anything else is not soft ground and gives none.
 */
export const DUST_BY_TYPE = Object.freeze({ 2: 1, 4: 0.3, 5: 1, 6: 0.35, 7: 0.6, 12: 0.45 });

const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * How readily ground gives dust, 0 to 1, from its `.TTY` type and the mean colour of its texture
 * (`tone`, linear; without one, the type alone says):
 *  - dark ground is damp, or rich with what grows in it, and gives less: none at a luminance of
 *    0.01, all from 0.075 (the game's ground is dark on the whole, and its dirt is mostly over that);
 *  - what grows holds the ground down: a hue from yellow-green (45 degrees, on linear colour)
 *    to green (75) is plants, where it is a colour at all (from 15 % of its brightest in full
 *    at 40 %), and plants give a tenth;
 *  - warm colours, ochre, tan and brown, are bare dry earth; grey is stone, and gives about half.
 */
export function groundDust(tone, type) {
  const byType = DUST_BY_TYPE[type] ?? 0;
  if (!tone) return byType;
  const [r, g, b] = tone, light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (!(light > 0)) return 0;
  const most = Math.max(r, g, b), chroma = most - Math.min(r, g, b);
  const hue = chroma <= 0 ? 0 : most === r ? 60 * ((((g - b) / chroma) + 6) % 6) : most === g ? 60 * ((b - r) / chroma + 2) : 60 * ((r - g) / chroma + 4);
  const dry = smoothstep(0.01, 0.075, light);
  const plants = smoothstep(45, 75, hue) * (1 - smoothstep(150, 180, hue)) * smoothstep(0.15, 0.4, chroma / most);
  const warm = smoothstep(0, 0.6, (r - b) / light);
  return byType * dry * (1 - 0.9 * plants) * (0.55 + 0.45 * warm);
}

/**
 * How much of its dust ground gives in each weather (game/weather.js order). Rain soaks it and Snow
 * freezes it, as the game has it (in either it is not "dust" underfoot at all: `footing`); fog
 * and a clear night's dew damp it.
 */
export const DUST_WEATHER = Object.freeze([1, 1, 0.5, 0.35, 0, 0, 1, 0.8, 0.8, 1]);

/**
 * The colour of dust off ground of `family` and `type` whose texture's mean colour is `ground`
 * (linear): the ground type's own (`dustTone`), mixed half and half with the ground's colour made
 * paler, since dry fine dust is lighter than the earth it is raised from.
 */
export function dustColour(ground, family, type = 0) {
  const own = dustTone(family, type), share = PUFF_KINDS.dust.ground;
  if (!ground) return own;
  return own.map((c, k) => c + (Math.min(1, ground[k] * DUST.paler + 0.02) - c) * share);
}

/** A spark's light as it leaves and as it goes out (`SPARKS`). */
const SPARKS_HOT = Object.freeze([14, 9, 4.2]), SPARKS_COLD = Object.freeze([1.3, 0.1, 0.01]);

/*
  Streaks. `tone` as above; a spark's is its own light (`glow`), far brighter than white, and
  cools to `cool` over its life. `widthFt` is how wide it is, `trailS` how long a time of its
  flight it is drawn out over, `lifeS` how long it lasts if nothing stops it, `bounce` how much
  of its speed it keeps off the ground (0: it ends there).
*/
export const STREAK_KINDS = Object.freeze({
  // A spark is a glowing dot: its light follows its heat (`sparkGlow`), from `tone` as it leaves to `cool` as it goes out,
  // and the air brakes it a little, toward `terminalFtS` (`SPARKS`).
  spark: Object.freeze({ tone: SPARKS_HOT, cool: SPARKS_COLD, ground: 0, glow: 1, widthFt: 0.11, trailS: 0, lifeS: [0.3, 1.0], bounce: 0.3, opacity: 1, terminalFtS: [30, 50] }),
  // A drop of water: the air brakes it toward `terminalFtS`, the larger the faster.
  drop: Object.freeze({ tone: [0.72, 0.8, 0.88], ground: 0, glow: 0, widthFt: 0.09, trailS: 0.018, lifeS: [0.7, 2.0], bounce: 0, opacity: 0.4, terminalFtS: [18, 30] }),
  chip: Object.freeze({ tone: [0.92, 0.95, 1], ground: 0, glow: 0, widthFt: 0.1, trailS: 0.014, lifeS: [0.5, 1.2], bounce: 0.2, opacity: 0.95 }),
  clod: Object.freeze({ tone: [0.1, 0.075, 0.05], ground: 0.35, glow: 0, widthFt: 0.13, trailS: 0.012, lifeS: [0.5, 1.3], bounce: 0.12, opacity: 1 }),
  // A bubble under water: it rises as fast as its size lets it, and is gone at the surface (`BUBBLES`).
  bubble: Object.freeze({ tone: [0.8, 0.9, 0.96], ground: 0, glow: 0, widthFt: 0.06, trailS: 0, lifeS: [14, 20], bounce: 0, opacity: 0.7, rises: true }),
});

/*
  Bubbles (docs/VISUALS.md, "Under water"). A bubble has next to no weight of its own to carry it
  on: whatever it was thrown with, the water takes from it at once (by 1/e in `settleS`), and it
  rises as fast as its size lets it, under a foot a second for one a quarter of an inch across and
  a foot and a half for one of an inch and a half. Middling ones climb in a spiral and big ones
  wobble; the smallest go straight up. They rise to the surface, however long that takes (`lifeS`
  is for one lost in very deep water), and are gone there. A tire under the water lets them go in
  little clouds behind its tread, carried a moment by the water it drags along.
*/
/**
 * A bubble is `widthFt` across, most of them near the small end (`bubbleWidth`), and rises at
 * `riseFtS`, from the first for the smallest to the second for the largest. It spirals
 * `turnsPerS` times a second (the larger, the slower) about a circle `spiral` of its own width
 * across, the smallest not at all. A tire lets `clouds` go each tick (`DUST_TICK_S`), from the
 * first at `fromMph` to the second at `fullMph`, each of one to `cloud` bubbles, carried with
 * `carried` of the truck's velocity give or take `jitterFtS`.
 */
export const BUBBLES = Object.freeze({
  widthFt: Object.freeze([0.025, 0.15]), riseFtS: Object.freeze([0.75, 1.5]), settleS: 0.15,
  turnsPerS: Object.freeze([4, 1.5]), spiral: 1.2,
  clouds: Object.freeze([0.15, 0.55]), fromMph: 3, fullMph: 30, cloud: 4, carried: 0.2, jitterFtS: 1,
});

/** How wide a new bubble is, feet, from `random()` in [0, 1): most of them small. */
export const bubbleWidth = (random = Math.random) => BUBBLES.widthFt[0] + (BUBBLES.widthFt[1] - BUBBLES.widthFt[0]) * random() ** 2;

/** How fast a bubble `widthFt` across rises once the water has taken what it was thrown with, ft/s. */
export function bubbleRiseFtS(widthFt) {
  const [small, large] = BUBBLES.widthFt, share = Math.min(1, Math.max(0, (widthFt - small) / (large - small)));
  return BUBBLES.riseFtS[0] + (BUBBLES.riseFtS[1] - BUBBLES.riseFtS[0]) * share;
}

/** How a bubble `widthFt` across climbs: `{ turnsPerS, radiusFt }` of its spiral, none for the smallest. */
export function bubbleSpiral(widthFt) {
  const [small, large] = BUBBLES.widthFt, share = Math.min(1, Math.max(0, (widthFt - small) / (large - small)));
  return {
    turnsPerS: BUBBLES.turnsPerS[0] + (BUBBLES.turnsPerS[1] - BUBBLES.turnsPerS[0]) * share,
    radiusFt: BUBBLES.spiral * widthFt * smoothstep(0.1, 0.4, share),
  };
}

/** A bubble's velocity `vel` (ft/s, game axes) after `dt` seconds rising at `riseFtS`: the water takes what it was thrown with. */
export function bubbleVelocity(vel, dt, riseFtS) {
  const keep = Math.exp(-dt / BUBBLES.settleS);
  return [vel[0] * keep, riseFtS + (vel[1] - riseFtS) * keep, vel[2] * keep];
}

/*
  Sparks (docs/VISUALS.md, "Sparks"). A spark is a glowing dot: a fleck torn off where two
  things are dragged against each other, burning as it flies.

   - Where it goes. Torn off between the two, it leaves at the average of their velocities (half
     the truck's against the ground or a wall, which stand still), scattered a little every way
     off the surface it was struck from, the more the harder they meet.
   - The air brakes it a little, so it falls no faster than its terminal speed.
   - Its heat. It leaves white hot and yellow, and cools as it flies through orange to a dull
     red; touching the ground cools it more.
   - The ground. It skips off hard ground, keeping part of its speed along it and little of
     its fall, three times at most.
*/
/**
 * Each of the game's sparks is `shower` flecks with "Rich particles", the more the faster the
 * two meet (from the first at a standstill to the second at `showerFullFtS`). A fleck is
 * scattered from the two things' average velocity by `jitterFtS` and up to `spread` of how fast
 * they meet (twice that for a blow), every way off the surface, and kicked off it by up to
 * `kickFtS` more; its terminal speed is `terminalFtS` and it burns for `lifeS`. Its light runs
 * `hot`, `warm`, `cold` (linear, times white) as it cools.
 */
export const SPARKS = Object.freeze({
  shower: Object.freeze([2, 5]), showerFullFtS: 60,
  jitterFtS: 4, spread: 0.2, kickFtS: 4,
  terminalFtS: STREAK_KINDS.spark.terminalFtS, lifeS: STREAK_KINDS.spark.lifeS,
  hot: SPARKS_HOT, warm: Object.freeze([7, 2.4, 0.4]), cold: SPARKS_COLD,
});

/**
 * In the dark a shower of sparks lights what is about it (render/tire-effects.js): a light as
 * strong as `strength` times its flash, which gains `perFleck` for each fleck thrown, up to
 * `most`, and dies away by 1/e in `fadeS`, flickering; it reaches `reachFt`, and only a shower
 * within `withinFt` of the eye has it.
 */
export const SPARK_LIGHT = Object.freeze({ strength: 30, perFleck: 0.08, most: 2.5, fadeS: 0.07, reachFt: 35, withinFt: 250 });

/** How many flecks one of the game's sparks is, for a scrape at `speedFtS`. */
export const sparkShower = (speedFtS, random = Math.random) => {
  const [few, many] = SPARKS.shower, t = Math.min(1, Math.max(0, speedFtS / SPARKS.showerFullFtS));
  return Math.round(few + (many - few) * t * (0.6 + 0.8 * random()));
};

/**
 * A fleck's velocity as it leaves, ft/s, game axes: the average of the two things' velocities,
 * `vel` the truck's and `other` what it struck (still, for the ground or a wall), scattered
 * every way off the surface (`normal`: up off the ground, out from a wall toward the truck). A
 * blow (`hit`) scatters them twice as far.
 */
export function sparkVelocity({ vel = [0, 0, 0], other = [0, 0, 0], normal = [0, 1, 0], hit = false, random = Math.random }) {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  const n = length > 1e-6 ? normal.map((c) => c / length) : [0, 1, 0];
  const meet = Math.hypot(vel[0] - other[0], vel[1] - other[1], vel[2] - other[2]);
  // A way at random, turned off the surface where it points into it.
  const up = random() * 2 - 1, around = random() * Math.PI * 2, flat = Math.sqrt(1 - up * up);
  let way = [flat * Math.cos(around), up, flat * Math.sin(around)];
  const into = way[0] * n[0] + way[1] * n[1] + way[2] * n[2];
  if (into < 0) way = way.map((c, k) => c - 2 * into * n[k]);
  const scatter = SPARKS.jitterFtS + meet * SPARKS.spread * (hit ? 2 : 1) * random();
  const kick = SPARKS.kickFtS * random();
  return [0, 1, 2].map((k) => (vel[k] + other[k]) / 2 + way[k] * scatter + n[k] * kick);
}

/**
 * A fleck's velocity `dt` seconds on through the air, falling under `gravity` (ft/s squared)
 * and braked by the air toward its terminal speed `terminalFtS`: the drag goes with the square of
 * its speed. Taken implicitly, so it is steady however long the step.
 */
export function sparkFlight(v, dt, terminalFtS, gravity = 32.2) {
  const fallen = [v[0], v[1] - gravity * dt, v[2]];
  const speed = Math.hypot(fallen[0], fallen[1], fallen[2]);
  const brake = 1 / (1 + (gravity * speed * dt) / (terminalFtS * terminalFtS));
  return fallen.map((c) => c * brake);
}

/** A fleck's light at `heat` (1 as it leaves, falling to nothing as it goes out), linear: white hot, orange, dull red, dark. */
export function sparkGlow(heat) {
  const h = Math.max(0, heat), { hot, warm, cold } = SPARKS;
  if (h >= 0.6) { const t = Math.min(1, (h - 0.6) / 0.4); return [0, 1, 2].map((k) => warm[k] + (hot[k] - warm[k]) * t); }
  if (h >= 0.25) { const t = (h - 0.25) / 0.35; return [0, 1, 2].map((k) => cold[k] + (warm[k] - cold[k]) * t); }
  const t = h / 0.25;
  return cold.map((c) => c * t);
}

/**
 * Snow that will settle this deep, feet, is what a wheel stands on, whatever is under it. Thinner snow mostly does not
 * show (game/snow-cover.js `SNOW_LINE`): along the course, where it is kept thin, the road is bare to the eye and
 * frozen under the tire.
 */
export const SNOW_FOOTING_FT = 0.2;

/**
 * A wheel whose tire's top is this far under the water's surface, feet, or further, is under water: it throws nothing
 * out of the water, only bubbles.
 */
export const SUBMERGED_FT = 0.3;
/** In Rain a wheel stands in a puddle where the puddle is this deep or more, feet (render/ground-surface.js). */
export const PUDDLE_FOOTING_FT = 0.03;

/**
 * What a wheel stands on, for what it throws up and the track it leaves:
 *  - "water": the level's water, and "ice" the same in Snow, when the game freezes it; "under" when the whole tire is
 *    under the water (`submerged`, `SUBMERGED_FT`), where nothing it does reaches the surface;
 *  - "snow": snow that settles `SNOW_FOOTING_FT` deep or more, or ground that is snow in any weather
 *    (`.TTY` type 9), and "ice" ground that is ice (type 8);
 *  - "puddle": a puddle in Rain `PUDDLE_FOOTING_FT` deep or more (`puddleFt`), whatever is under it;
 *  - "mud" and "wet": soft and hard ground in Rain;
 *  - "dust" and "hard": the same when dry. In Snow, ground the snow has not yet covered is
 *    frozen: "hard", whatever it is made of.
 * `family` is the ground's sound family (game/sound-model.js), `type` its `.TTY` type.
 */
export function footing({ family, type = 0, weather = 0, snowFt = 0, inWater = false, submerged = false, puddleFt = 0 }) {
  if (inWater) return weather === SNOW ? "ice" : submerged ? "under" : "water";
  if (weather === RAIN && puddleFt >= PUDDLE_FOOTING_FT) return "puddle";
  if (type === TYPE_SNOW || (weather === SNOW && snowFt >= SNOW_FOOTING_FT)) return "snow";
  if (type === TYPE_ICE) return "ice";
  const soft = family === "dirt" || family === "gravel";
  if (weather === RAIN) return soft ? "mud" : "wet";
  return soft && weather !== SNOW ? "dust" : "hard";
}

/** The colour of the dust a ground type gives, before the level's own ground colour is mixed in: sand is pale, mud dark, gravel and rock grey. */
export function dustTone(family, type = 0) {
  if (type === TYPE_SAND) return [0.52, 0.44, 0.31];
  if (type === TYPE_MUD) return [0.24, 0.18, 0.12];
  if (type === TYPE_GRASS) return [0.34, 0.29, 0.19];
  if (family === "gravel") return [0.38, 0.36, 0.33];
  return PUFF_KINDS.dust.tone;
}

const NOTHING = Object.freeze({ puff: null, streak: null, streaks: 0 });

/**
 * What one wheel on the ground throws in one tick (`DUST_TICK_S`) at `speedFtS`, from what it
 * stands on: `{ puff, streak, streaks }`, a puff's kind or null and how many streaks of which
 * kind. `random()` is in [0, 1). Dust is not decided here: `dustPuffs` says when a tire raises
 * it, as the game does.
 */
export function tireThrows(stoodOn, speedFtS, random = Math.random) {
  const mph = Math.abs(speedFtS) * MPH_PER_FTS;
  const odds = (p) => (random() < p ? 1 : 0);
  switch (stoodOn) {
    // Clods fly from soft ground at speed, more the faster.
    case "dust": return mph > 22 ? { puff: null, streak: "clod", streaks: odds(Math.min(0.7, (mph - 22) / 50)) } : NOTHING;
    // Mud is flung in clods; it raises neither dust nor spray.
    case "mud": return mph > 8 ? { puff: null, streak: "clod", streaks: 1 + odds(Math.min(0.9, mph / 60)) } : NOTHING;
    // Wet hard ground: drops off the tread at speed. Its mist is laid along the way the tire rolls (`MIST`).
    case "wet": return mph > 14 ? { puff: null, streak: "drop", streaks: mph > 22 ? 1 + odds(0.5) : 0 } : NOTHING;
    case "snow": return mph > 5 ? { puff: odds(Math.min(0.75, 0.3 + mph / 80)) ? "powder" : null, streak: "chip", streaks: Math.floor(mph / 24) + odds(0.45) } : NOTHING;
    case "ice": return mph > 10 ? { puff: mph > 30 && odds(0.2) ? "powder" : null, streak: "chip", streaks: odds(Math.min(0.6, mph / 70)) } : NOTHING;
    // Open water is thrown aside in sheets of spray (`SPRAY`), and at speed some of it is beaten to mist, laid along the way
    // as on wet ground (`MIST`).
    case "water": return NOTHING;
    // A puddle is thrown aside in sheets of spray (`SPRAY`), and raises no mist.
    case "puddle": return NOTHING;
    // Under water a tire stirs up bubbles, a little cloud of them now and then, more often the faster (`BUBBLES`), and
    // nothing breaks the surface.
    case "under": {
      if (!(mph > BUBBLES.fromMph)) return NOTHING;
      const fast = Math.min(1, (mph - BUBBLES.fromMph) / (BUBBLES.fullMph - BUBBLES.fromMph));
      const clouds = odds(BUBBLES.clouds[0] + (BUBBLES.clouds[1] - BUBBLES.clouds[0]) * fast);
      return { puff: null, streak: "bubble", streaks: clouds ? 1 + Math.floor(random() * BUBBLES.cloud) : 0 };
    }
    default: return NOTHING;
  }
}

/*
  Spray (docs/VISUALS.md, "Spray"). A tire running through standing water, a puddle or the
  shallows of the level's water, pushes it aside: it leaves in a sheet either side of the tire,
  low and fanning out, slower than the truck, so the two sheets trail back from the wheel in a V;
  and the tread lifts a little of it and throws it up behind. Puddle water is muddy: its drops
  take `muddy` of the ground's colour.
*/
/**
 * `sheet` drops a side and `tread` drops off the tread, a tick (`DUST_TICK_S`), from `fromMph`
 * to all of them at `fullMph`, in water `deepFt` deep: shallower water throws fewer, down to
 * `shallowest` of them, and deeper more, up to `most`. A sheet is a fan: a drop leaves from
 * somewhere across it, from its root by the tire to its outer edge, and the further out, the
 * slower along the truck's way (`ahead`, of the truck's velocity), the faster out from the tire
 * (`outward`, of its speed) and the higher (`rise`, of its speed, give or take a fifth), each
 * from its first number at the root to its second at the edge. So drops thrown together lie on
 * one curtain. A drop off the tread leaves with `treadAhead` and `treadRise`. Each is scattered
 * by up to `jitterFtS` every way. `veil` of a sheet's drops are drawn large and faint
 * (`veilWidthFt` across, hiding `veilOpacity`), so that together they make the sheet a veil of
 * water; the rest are small and plain (`widthFt`, `opacity`), and catch the eye one by one.
 */
export const SPRAY = Object.freeze({
  fromMph: 4, fullMph: 45, sheet: Object.freeze([3, 18]), tread: Object.freeze([1, 4]), deepFt: 0.15, shallowest: 0.35, most: 1.4,
  ahead: Object.freeze([0.75, 0.5]), outward: Object.freeze([0.1, 0.3]), rise: Object.freeze([0.1, 0.3]),
  treadAhead: Object.freeze([0.2, 0.5]), treadRise: Object.freeze([0.2, 0.4]), jitterFtS: 0.7, muddy: 0.35,
  veil: 0.6, veilWidthFt: Object.freeze([0.2, 0.36]), veilOpacity: 0.12, widthFt: Object.freeze([0.04, 0.08]), opacity: 0.45,
});

/** How many drops a tire running at `speedFtS` through water `depthFt` deep throws in a tick: `{ sheet }` to either side of it, `{ tread }` off its tread. */
export function sprayDrops(speedFtS, depthFt, random = Math.random) {
  const mph = Math.abs(speedFtS) * MPH_PER_FTS;
  if (!(mph > SPRAY.fromMph)) return { sheet: 0, tread: 0 };
  const fast = Math.min(1, (mph - SPRAY.fromMph) / (SPRAY.fullMph - SPRAY.fromMph));
  const deep = Math.min(SPRAY.most, Math.max(SPRAY.shallowest, depthFt / SPRAY.deepFt));
  const some = ([few, many]) => Math.floor((few + (many - few) * fast) * deep + random());
  return { sheet: some(SPRAY.sheet), tread: some(SPRAY.tread) };
}

/**
 * A drop of spray's velocity as it leaves, ft/s, game axes: `vel` is the truck's and `forward`
 * its heading (x, z, a unit vector); `side` 1 for the sheet to the tire's right, -1 for the one
 * to its left, 0 for a drop off the tread.
 */
export function sprayVelocity({ vel, forward, side, random = Math.random }) {
  const speed = Math.hypot(vel[0], vel[2]), at = random(), across = ([from, to]) => from + (to - from) * at;
  const ahead = across(side ? SPRAY.ahead : SPRAY.treadAhead);
  const rise = side ? across(SPRAY.rise) * (0.8 + 0.4 * random()) : SPRAY.treadRise[0] + (SPRAY.treadRise[1] - SPRAY.treadRise[0]) * random();
  const out = side ? across(SPRAY.outward) * side * speed : 0;
  const jitter = () => (random() - 0.5) * 2 * SPRAY.jitterFtS;
  // The truck's right, in game axes.
  const right = [forward[1], -forward[0]];
  return [vel[0] * ahead + right[0] * out + jitter(), speed * rise + jitter(), vel[2] * ahead + right[1] * out + jitter()];
}

/*
  Rooster tails (docs/VISUALS.md, "Spray"). A tire wading in the level's water, its tread part way
  under, paddles the water up with its lugs and flings it off behind as the tread comes up out of
  the water: a tall fan of spray behind each wheel, the higher the faster the tread runs. A tire
  about half under throws the most; one barely wet throws only its sheets, and one wholly under
  throws nothing out of the water. A puddle is too shallow to wade in.
*/
/**
 * `drops` a tick (`DUST_TICK_S`), from `fromFtS` of tread to all of them at `fullFtS`, times how
 * much the tire wades (`roosterWading`). A drop leaves the back of the tire at the water, up at
 * `rise` of the tread's speed and along the truck's way at `ahead` of its speed, the higher the
 * slower, so the tail leans back from the wheel; each scattered by up to `spreadFtS` every way.
 * `veil` of them are drawn large and faint (`veilWidthFt` across, hiding `veilOpacity`): together
 * a plume.
 */
export const ROOSTER = Object.freeze({
  fromFtS: 6, fullFtS: 45, drops: Object.freeze([2, 10]), rise: Object.freeze([0.3, 0.8]), ahead: Object.freeze([0.5, 0.1]), spreadFtS: 2.5,
  veil: 0.6, veilWidthFt: Object.freeze([0.25, 0.5]), veilOpacity: 0.13,
});

/** How much a tire of radius `radiusFt` wades, 0 to 1, with its foot `wetFt` under the water: most about half under, none barely wet or wholly under. */
export function roosterWading(wetFt, radiusFt = 2.75) {
  return smoothstep(0.15 * radiusFt, 0.7 * radiusFt, wetFt) * (1 - smoothstep(1.5 * radiusFt, 2.1 * radiusFt, wetFt));
}

/** How many drops of its rooster tail a tire whose tread runs at `treadFtS`, wading `wading`, throws in a tick. */
export function roosterDrops(treadFtS, wading, random = Math.random) {
  const fast = Math.min(1, Math.max(0, (Math.abs(treadFtS) - ROOSTER.fromFtS) / (ROOSTER.fullFtS - ROOSTER.fromFtS)));
  if (!(fast > 0) || !(wading > 0)) return 0;
  return Math.floor((ROOSTER.drops[0] + (ROOSTER.drops[1] - ROOSTER.drops[0]) * fast) * wading + random());
}

/**
 * A rooster tail's drop's velocity as it leaves, ft/s, game axes: `vel` is the truck's, `forward` its heading (x, z, a
 * unit vector) and `treadFtS` how fast the tire's tread runs.
 */
export function roosterVelocity({ vel, forward, treadFtS, random = Math.random }) {
  const at = random(), across = ([from, to]) => from + (to - from) * at;
  const up = across(ROOSTER.rise) * Math.abs(treadFtS), ahead = across(ROOSTER.ahead);
  const jitter = () => (random() - 0.5) * 2 * ROOSTER.spreadFtS;
  return [vel[0] * ahead + jitter(), up + jitter(), vel[2] * ahead + jitter()];
}

/** The colour of spray off a puddle over ground whose colour is `ground` (linear): water, with `muddy` of the ground's own, a little paler. */
export function muddyWater(ground) {
  const water = STREAK_KINDS.drop.tone;
  if (!ground) return water;
  return water.map((c, k) => c + (Math.min(1, ground[k] * 1.6 + 0.04) - c) * SPRAY.muddy);
}

/** A wheel that has been off the ground this long, seconds, and comes down this fast, ft/s, has landed. */
export const LANDING_AIR_S = 0.18, LANDING_MIN_FT_PER_S = 6;

/**
 * What a wheel throws as it lands at `fallFtPerS` (how fast it came down) on what it stands
 * on: `{ puff, puffs, streak, streaks }`, or null for a touch too light to throw anything. A
 * hard landing on ice also stars it (game/ice.js).
 */
export function landingThrows(stoodOn, fallFtPerS) {
  if (!(fallFtPerS >= LANDING_MIN_FT_PER_S)) return null;
  // From a touch to a 40 ft/s fall, which is one from twenty five feet up.
  const hard = Math.min(1, (fallFtPerS - LANDING_MIN_FT_PER_S) / 34);
  const some = (few, many) => Math.round(few + (many - few) * hard);
  switch (stoodOn) {
    case "dust": return { puff: "dust", puffs: some(3, 9), streak: "clod", streaks: some(5, 18) };
    case "mud": return { puff: null, puffs: 0, streak: "clod", streaks: some(7, 22) };
    case "wet": return { puff: "mist", puffs: some(2, 6), streak: "drop", streaks: some(6, 18) };
    case "snow": return { puff: "powder", puffs: some(4, 10), streak: "chip", streaks: some(6, 20) };
    case "ice": return { puff: "powder", puffs: some(1, 4), streak: "chip", streaks: some(8, 24) };
    case "water": return { puff: "mist", puffs: some(4, 9), streak: "drop", streaks: some(12, 34) };
    case "under": return { puff: null, puffs: 0, streak: "bubble", streaks: some(4, 14) };
    case "puddle": return { puff: null, puffs: 0, streak: "drop", streaks: some(12, 32) };
    default: return null;
  }
}

/*
  Tracks. A tire leaves one on what gives under it. `TRACK_KINDS` are what the drawing tells
  apart (render/tire-tracks.js): earth pressed dark, snow packed and shadowed (or cut through
  where it lies thin), mud darker still, ice scuffed pale, and the rubber a sliding tire
  leaves on hard ground. Every tire leaves its own.
*/
export const TRACK_KINDS = Object.freeze({ dust: 0, snow: 1, mud: 2, ice: 3, rubber: 4 });
/**
 * How a rut is drawn. Earth and mud are darkened: `earth` and `mud` are how much of the ground's light a rut's floor
 * takes, between the lugs and under them, and `wall` what the foot of each wall takes besides. One truck's rut leaves
 * the ground four fifths as bright and the lug prints three fifths; where many have gone the line is worn darker. Snow
 * that will settle under `thinSnowFt[0]` is cut through and darkened the same way; from `thinSnowFt[1]` it is packed.
 * Rubber left by a tire sliding on hard ground takes `rubber` of the ground's light at a full slide. A tire that
 * slides on soft ground digs: its rut is up to `slideDeeper` darker again. Under standing water a rut is seen through
 * the water's face: `underWater` of it is hidden at the waterline, and the second share where the water is
 * `underWaterFt` deep or more. A tire coming to a puddle presses its rut less as the water under it deepens
 * (`puddleRut`), so a rut runs out into the water and does not end in a square.
 */
export const RUT = Object.freeze({
  earth: Object.freeze([0.2, 0.42]), mud: Object.freeze([0.3, 0.5]), wall: 0.1, thinSnowFt: Object.freeze([0.12, 0.34]), rubber: 0.5, slideDeeper: 0.5,
  underWater: Object.freeze([0.6, 0.97]), underWaterFt: 0.08,
});
/**
 * A tire ploughs deep snow (docs/VISUALS.md, "Tracks"): it packs what was under it down to
 * `packedFt` and `packed` of the snow's depth more, and pushes up `berm` of what it moved into a
 * ridge either side, `bermFt` wide, as high as that makes it. The rut between is a trench whose
 * walls lean out by `wallLean` feet for each foot up. A ridge's crest stands at the trench's rim, and
 * its inner face comes down to the snow's level `lipFt` in from there, where the trench opens.
 */
export const PLOUGH = Object.freeze({ packedFt: 0.06, packed: 0.12, berm: 0.7, bermFt: 0.9, wallLean: 0.35, lipFt: 0.2 });
/**
 * The ploughed snow is drawn from one map of it (render/tire-tracks.js), so that ruts that cross or
 * run side by side make one surface: `side` points a side, `texelFt` feet apart, about the eye.
 * In it a ridge is heaped in clumps from `clumps[0]` to `clumps[1]` of its height, and a rut's rim
 * stands in from its edge by `rimFt` and up to `raggedFt` more, ragged along the way. A rut's wall
 * is the tire's rounded shoulder: never narrower than `shoulderFt`, however shallow. The eye's
 * line into a rut is followed down through the map in `steps` and found to within `refine` halvings
 * more, for at most `reachFt`; where the map ends, `edge` of the way in from either side, each rut
 * is drawn by itself again, its walls lit as leaning `wallLit` up for each foot across: what the
 * map's slope makes of a wall, taken as it is across more than the wall's width. The map is drawn
 * again when a piece of rut is laid, when the eye has gone `redrawFt` from where it was drawn about,
 * and every `redrawS` besides (the snow deepens).
 */
export const PLOUGH_MAP = Object.freeze({
  side: 2048, texelFt: 0.25, clumps: Object.freeze([0.65, 1.35]), rimFt: 0.1, raggedFt: 0.3, shoulderFt: 0.4, steps: 14, refine: 5, reachFt: 10, edge: 0.06,
  redrawFt: 16, redrawS: 0.25, wallLit: 0.7,
});
/**
 * What a tire pressing `press` hard (0 to 1) leaves in snow lying `snowFt` deep: `floorFt`, the
 * packed snow under it over the bare ground; `bermFt`, how high the ridges either side stand over
 * the snow; `deepFt`, how far the trench's floor lies under the ridges' tops.
 */
export function snowTrench(snowFt, press = 1) {
  const snow = Math.max(0, snowFt);
  const floorFt = Math.min(snow, PLOUGH.packedFt + PLOUGH.packed * snow);
  const bermFt = PLOUGH.berm * (snow - floorFt) * Math.min(1, Math.max(0, press));
  return { floorFt, bermFt, deepFt: snow + bermFt - floorFt };
}

/** How hard a tire presses its rut where standing water `puddleFt` deep lies under it: less as it deepens, none from where it stands in the puddle (`PUDDLE_FOOTING_FT`). */
export const puddleRut = (puddleFt) => Math.max(0, 1 - Math.max(0, puddleFt) / PUDDLE_FOOTING_FT);

/**
 * The kind of track a tire leaves on what it stands on, or null where it leaves none. A tire that rolls leaves none on
 * hard ground or in water; one that slides on hard ground (`sliding`, 0 to 1, `slideAmount`) leaves rubber.
 */
export function trackKind(stoodOn, sliding = 0) {
  if (stoodOn === "hard" || stoodOn === "wet") return sliding > 0 && stoodOn === "hard" ? TRACK_KINDS.rubber : null;
  return TRACK_KINDS[stoodOn] ?? null;
}
/** A track is this wide, feet, and its tread repeats every this many feet along it. */
export const TRACK_WIDTH_FT = 2.7, TREAD_REPEAT_FT = 4;
/**
 * Tracks fade out between these distances from the eye, feet: beyond, they would only shimmer. They lie on the
 * ground's fine level (game/drawn-ground.js), which a headset draws to 800 ft: there they are gone by then.
 */
export const TRACK_FADE_FT = Object.freeze([900, 1500]), TRACK_FADE_LITE_FT = Object.freeze([500, 760]);

/*
  Sliding and spinning (docs/VISUALS.md, "Sliding and spinning"). The simulation says of each tire how much grip it has,
  what force it is putting through the ground, and how fast it turns. A tire slides when it asks for more than the
  ground will give sideways, and spins when its tread runs faster than the ground goes by under it. (Under full
  throttle a driven tire's push forward runs past the game's measure of a skid, which the skid's sound goes by, while
  the wheel still turns with the ground: that is not a slide anyone sees.)
*/
/** A tire is seen to slide from this much of the game's own measure of a skid (game/sound-model.js `skidAmount`), taken of its sideways force alone, and in full from 1. */
export const SLIDE_SHOWS = 0.25;
/** A tire is seen to spin when its tread outruns the ground by this, feet a second, and in full at `SPIN_FULL_FT_S` more. */
export const SPIN_SHOWS_FT_S = 7, SPIN_FULL_FT_S = 28;

/**
 * How hard a tire slides or spins, 0 to 1: `tire` is the simulation's (`{ onGround, grip, force, spin }`, `spin` in
 * radians a second), `radiusFt` its radius, `forwardFtS` how fast the truck goes forward. Without the simulation's
 * tire (a replay, which records none) it is taken from how fast the truck slips sideways, `sidewaysFtS`.
 */
export function slideAmount({ tire = null, radiusFt = 2.75, forwardFtS = 0, sidewaysFtS = 0 }) {
  if (!tire) return Math.min(1, Math.max(0, (Math.abs(sidewaysFtS) - 7) / 20));
  if (!tire.onGround) return 0;
  const slide = Math.max(0, (skidAmount({ onGround: true, grip: tire.grip, force: [tire.force?.[0] ?? 0, 0, 0] }) - SLIDE_SHOWS) / (1 - SLIDE_SHOWS));
  const spin = Math.max(0, (Math.abs(tire.spin ?? 0) * radiusFt - Math.abs(forwardFtS) - SPIN_SHOWS_FT_S) / SPIN_FULL_FT_S);
  return Math.min(1, Math.max(slide, spin));
}

/**
 * What a tire that slides or spins `sliding` hard (0 to 1) throws in one tick besides what a rolling tire does:
 * `{ puff, streak, streaks }`. On hard ground the tire smokes; soft ground, snow and water are dug out and flung.
 */
export function slideThrows(stoodOn, sliding, random = Math.random) {
  if (!(sliding > 0)) return NOTHING;
  const odds = (p) => (random() < p ? 1 : 0);
  switch (stoodOn) {
    case "hard": return { puff: odds(0.25 + 0.6 * sliding) ? "rubber" : null, streak: null, streaks: 0 };
    case "wet": return { puff: odds(0.5 * sliding) ? "mist" : null, streak: "drop", streaks: odds(sliding) };
    case "dust": return { puff: odds(0.35 + 0.6 * sliding) ? "dust" : null, streak: "clod", streaks: 1 + Math.round(2 * sliding) };
    case "mud": return { puff: null, streak: "clod", streaks: 2 + Math.round(3 * sliding) };
    case "snow": return { puff: odds(0.4 + 0.5 * sliding) ? "powder" : null, streak: "chip", streaks: 1 + Math.round(2 * sliding) };
    case "ice": return { puff: odds(0.3 * sliding) ? "powder" : null, streak: "chip", streaks: 1 + odds(sliding) };
    case "water": return { puff: odds(0.6) ? "mist" : null, streak: "drop", streaks: 2 + Math.round(3 * sliding) };
    case "under": return { puff: null, streak: "bubble", streaks: 1 + Math.round(3 * sliding) };
    case "puddle": return { puff: null, streak: "drop", streaks: 2 + Math.round(2 * sliding) };
    default: return NOTHING;
  }
}

/**
 * What a hull that scrapes along the ground raises, by what it stands on (`footing`), in place of
 * the game's dark smoke: dust off dusty ground, powder off snow and ice, smoke off hard ground, and
 * nothing off mud, wet ground or water. Against a thing (a wall, another truck) it is the game's
 * smoke.
 */
export function scrapePuff(stood) {
  if (stood === "dust") return "dust";
  if (stood === "snow" || stood === "ice") return "powder";
  return stood === "hard" ? "smoke" : null;
}

/**
 * What a hull throws where it scrapes or strikes (the name of a streak's kind). Steel strikes sparks from what is
 * hard: an object (a wall, a fence, another truck), or hard ground, stone and gravel. Earth and mud give clods, snow
 * and ice chips. Under water nothing burns: a spark is quenched as it is struck, and what is seen is bubbles.
 * `onGround` says the hull met the ground and not a thing; `underWater` that it met it under the water's surface;
 * `onIce` that the ground it met is the ice over the level's water in Snow.
 */
export function scrapeThrows({ onGround = false, underWater = false, onIce = false, family = "cement", type = 0, weather = 0, snowFt = 0 }) {
  if (underWater) return "bubble";
  if (!onGround) return "spark";
  const stood = footing({ family, type, weather, snowFt, inWater: onIce && weather === SNOW });
  if (stood === "snow" || stood === "ice") return "chip";
  if (stood === "hard" || stood === "wet" || family === "gravel") return "spark";
  return "clod";
}
