/*
  The water as a body of water, for "Reflective water" (docs/VISUALS.md, "Water"). The game
  draws its water as a picture on a plane, more or less see-through by the weather
  (MONSTER_EXE_ANALYSIS.md section 13). The port's has depth, and what the eye sees of it is
  worked out as light passing through that depth:

   - water takes the red out of light first and the blue last, so what lies under a little
     water is seen nearly as it is and what lies under a lot is not seen at all;
   - what the water itself sends back is the daylight that fell into it, scattered, in the
     water's own colour: bright at noon, dull under cloud, dim orange at Dusk, nothing in the
     dark. Deep water in the dark is black, not clear.

  Pure, so it runs under Node.
*/

/**
 * How much of red, green and blue light a foot of water takes (the share lost is
 * `1 - exp(-take)`): pond and shore water, far murkier than the open sea, so a truck's depth of
 * it already hides the bed.
 */
export const WATER_TAKES = Object.freeze([0.42, 0.115, 0.08]);
/**
 * The colour of the daylight water sends back out of its depth, for white light falling on it: a few hundredths in green
 * and blue, as lake and coastal water send back, so that deep water is dark and the sky and the land it mirrors show in it.
 */
export const WATER_SCATTER = Object.freeze([0.004, 0.035, 0.041]);
/**
 * The sun's glint (render/water-surface.js): the share of the water's facets that send the sun to the eye, each sending
 * back what water does, over the eye's slant to the water, which is taken as no flatter than `grazing` (the sine of
 * it). No brighter than `most` times the sun's own light on a face square to it: the sun mirrored is far brighter than
 * that, and past it the lens would only spread it into a blaze.
 */
export const WATER_GLINT = Object.freeze({ most: 1.2, grazing: 0.15 });
/** In Rain the water is stirred and silted: its own colour goes this far toward a dull grey green. */
export const WATER_SILT = 0.45, WATER_SILT_TONE = Object.freeze([0.09, 0.105, 0.085]);
/** Water bends a line of sight toward the upright: its index against air's. */
export const WATER_INDEX = 1.333;

/**
 * How far a line of sight runs through water `depthFt` deep, feet, for an eye that looks down
 * at the surface along a line `sine` steep (the sine of its angle to the surface, 1 straight
 * down). The surface bends the line toward the upright, so even a glancing look runs through
 * no more than about one and a half times the depth.
 */
export function waterPathFt(depthFt, sine) {
  const s = Math.min(1, Math.max(0, sine));
  return Math.max(0, depthFt) / Math.sqrt(1 - (1 - s * s) / (WATER_INDEX * WATER_INDEX));
}

/** How much of red, green and blue light gets through `pathFt` of water, 0 to 1 each. */
export const waterPasses = (pathFt) => WATER_TAKES.map((take) => Math.exp(-take * Math.max(0, pathFt)));

/**
 * How much of what lies under `pathFt` of water the water hides, 0 to 1: by how much of the
 * light, as the eye weighs red, green and blue, does not get through.
 */
export function waterHides(pathFt) {
  const [r, g, b] = waterPasses(pathFt);
  return 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/**
 * Under water (docs/VISUALS.md, "Under water"). The eye sees `sightFt` at the most, through
 * water of the colour its depth sends back, and what daylight there is has lost its red. The game's own underwater fog is 320 ft in the weather's
 * fog colour (game/weather.js), which is what is drawn with "Reflective water" off.
 */
export const UNDERWATER = Object.freeze({ sightFt: 170, tint: Object.freeze([0.5, 0.86, 0.95]), corners: 0.45 });

/**
 * What fills the water about the eye (render/underwater.js). `motes` motes of silt hang in a box
 * `moteBoxFt` across about the eye, each `moteFt` across, drifting with the water at `driftFtS`
 * and swaying; lit as the water itself is, `moteBright` times as bright as it, and gone by
 * `moteGoneFt` away. By day `shafts` shafts of sunlight come down through the waves, `shaftFt`
 * wide, standing in a square `shaftBoxFt` across about the eye, `shaftReachFt` long: each takes
 * `shaftShare` of the sun's light coming into the water, fades by 1/e every `shaftFadeFt` down,
 * and brightens and dims as the waves over it gather the light and spread it. The water darkens
 * with the eye's depth: the light it is lit by has come down through `depthShare` of the water
 * over the eye, which takes it as water does (`WATER_TAKES`, red first).
 */
export const UNDERWATER_LOOK = Object.freeze({
  motes: 4000, moteBoxFt: 56, moteFt: Object.freeze([0.035, 0.1]), driftFtS: 0.3, moteBright: 1.8, moteGoneFt: 26,
  shafts: 90, shaftFt: Object.freeze([0.6, 3.5]), shaftBoxFt: 110, shaftReachFt: 48, shaftShare: 0.04, shaftFadeFt: 14,
  depthShare: 0.6,
});

/** The share of the daylight at the surface by which an eye `depthFt` under the water sees the water lit: red, green, blue. */
export const lightAtDepth = (depthFt) => waterPasses(Math.max(0, depthFt) * UNDERWATER_LOOK.depthShare);

/**
 * The way the sun's light runs down through the water (any axes with y up), for `toSun` the way to
 * the sun over it: bent toward straight down at the surface (Snell's law, `WATER_INDEX`), so that
 * however low the sun, its light under the water is never further than 48.6 degrees from straight
 * down.
 */
export function sunUnderWater(toSun) {
  const length = Math.hypot(toSun[0], toSun[1], toSun[2]) || 1;
  const x = -toSun[0] / length / WATER_INDEX, z = -toSun[2] / length / WATER_INDEX;
  return [x, -Math.sqrt(Math.max(0, 1 - x * x - z * z)), z];
}

/**
 * Snell's window: from under water the sky is seen only within this of straight up (the
 * cosine of 48.6 degrees). Outside it the surface is a mirror of the water below.
 */
export const SNELL_WINDOW = Math.sqrt(1 - 1 / (WATER_INDEX * WATER_INDEX));

/**
 * The bed under water (render/water-surface.js): light dances on it where the water is
 * shallow, down to `causticsToFt`, as much as `caustics` brighter and darker; and the ground
 * within `wetShoreFt` over the waterline is wet from it, `wetShore` darker.
 */
export const WATER_BED = Object.freeze({ caustics: 0.5, causticsToFt: 9, wetShoreFt: 0.7, wetShore: 0.28 });

/*
  Ripples and wakes (docs/VISUALS.md, "Ripples and wakes"), for "Reflective water". The water
  about the eye is a field of waves that the trucks stir: a wheel at the surface pushes the
  water down where it is, so a truck that moves drags a wake behind it and one that stops sends
  out a ring; a wheel that comes down into the water throws a ring out from where it struck.
  The waves run as waves on water do, slower in the shallows, which bends them toward the shore,
  and they are thrown back from it. A turning tire beats the water white, and a wheel on the bed
  stirs up its silt: the field carries both, the foam fresh and thick about the wheels and
  breaking into lace behind them, the silt a cloud that spreads and settles.
*/
/**
 * The field is `windowTexels` square, a point every `texelFt`, kept round the eye. It runs in
 * steps of `stepS`, `mostSteps` at the most in a frame. A wave runs no faster than
 * `fastestFtPerS` (a shallow water wave's speed, `waveSpeed`, over deeper water), and dies away
 * by 1/e in `calmS`. Foam thicker than `foamThick[1]` (1 is all the field holds) collapses,
 * halving every `foamCollapseS`; foam thinner than `foamThick[0]` lingers as lace, halving every
 * `foamLingerS`; between the two, between the two. Silt halves every `siltHalfLifeS`, and spreads
 * further than foam. It takes `stirs` wheels at once.
 *
 * Shallow water cannot hold a crest much higher than it is deep (a puddle's, or the level's
 * water at its shore): a crest standing over `breaks[0]` of the depth above the rest starts to
 * break, and from `breaks[1]` of it spends itself by 1/e in `breakS`. Nor can the water fall
 * further below its rest than `bareBelow` of its depth: a trough leaves the bed bare, and no
 * lower, and the water running back fills it as any wave moves.
 */
export const WATER_RIPPLES = Object.freeze({
  windowTexels: 512, texelFt: 0.6, stepS: 1 / 60, mostSteps: 4, fastestFtPerS: 12, calmS: 1.8,
  foamCollapseS: 1.2, foamLingerS: 8, foamThick: Object.freeze([0.12, 0.45]), siltHalfLifeS: 14, stirs: 32,
  breaks: Object.freeze([0.35, 0.7]), breakS: 0.12, bareBelow: 1.2,
});

/**
 * How much of a wave `heightFt` above or below the rest (negative below) is left after `seconds`
 * in water `depthFt` deep, by the field's rules (`WATER_RIPPLES`), the wave held where it is: a
 * crest breaks while it is high for the depth, and a trough never falls further than the bed
 * allows.
 */
export function waveAfter(heightFt, depthFt, seconds, { stepS, calmS, breaks: [from, to], breakS, bareBelow } = WATER_RIPPLES) {
  let h = heightFt;
  for (let t = 0; t < seconds - 1e-9; t += stepS) {
    h *= Math.exp(-stepS / calmS);
    h *= 1 - (1 - Math.exp(-stepS / breakS)) * smooth(from, to, h / depthFt);
    h = Math.max(h, -bareBelow * depthFt);
  }
  return h;
}

/**
 * How long after a wheel last stirred it the field has run down to nothing that shows, seconds: its waves (no higher
 * than the 3 ft the field holds) under a thousandth of a foot, and its foam and silt under a shade of an 8 bit picture
 * (1/256 of all the field holds), each by the rules above. The field is not stepped once it has, nor before a wheel
 * has stirred it at all, until one does (render/water-ripples.js): stepped, it cost a 512 by 512 pass every sixtieth of
 * a second of the race, wheels in the water or not.
 */
export function rippleQuietS({ calmS, foamLingerS, siltHalfLifeS } = WATER_RIPPLES) {
  const shade = Math.log2(256);
  return Math.max(calmS * Math.log(3 / 0.001), foamLingerS * shade, siltHalfLifeS * shade);
}

/** How much foam there is after `seconds`, from `amount` (a share of all the field holds), by the rules above. */
export function foamAfter(amount, seconds, { foamCollapseS, foamLingerS, foamThick: [thin, thick], stepS } = WATER_RIPPLES) {
  let foam = amount;
  for (let t = 0; t < seconds; t += stepS) {
    const halfLife = foamLingerS + (foamCollapseS - foamLingerS) * smooth(thin, thick, foam);
    foam *= 0.5 ** (stepS / halfLife);
  }
  return foam;
}

/** How fast a wave runs over water `depthFt` deep, ft/s: a shallow water wave's `sqrt(g d)`, no faster than `fastestFtPerS`. */
export const waveSpeed = (depthFt) => Math.min(WATER_RIPPLES.fastestFtPerS, Math.sqrt(32.17 * Math.max(0, depthFt)));

/**
 * How a turning tire churns the water (`wheelStir`): its tread beats the water white from
 * `fromFtS` of tread, all it can from `fullFtS`, over `reach` of the tire's radius about it, its
 * width and the white water thrown off it; and on the bed it stirs up the silt, from
 * `siltFromFtS` of tread, all it can from `siltFullFtS`.
 */
export const WHEEL_CHURN = Object.freeze({ fromFtS: 3, fullFtS: 25, reach: 1.2, siltFromFtS: 1, siltFullFtS: 15 });

/**
 * How a wheel stirs the water. `hubFt` is its hub's height and `radiusFt` the tire's, `levelFt`
 * the water's, `speedFtS` how fast it moves across it and `treadFtS` how fast its tread runs: its
 * spin times its radius (the game turns a wheel on the ground with the ground and one in the air
 * with the engine), as fast as it moves where that is not known. A wheel that meets the surface
 * pushes it down over `radiusFt` about it, by `depthFt`, more the faster it goes; one clear of
 * the water, or wholly under it by more than a foot and a half (where the surface over it only
 * stirs faintly, and not at all past that), does not. Its tread churns the surface white
 * (`WHEEL_CHURN`): `foam` is how fast, 0 to 1, over `foamFt` about it. And a wheel in the water at
 * all, deep under it or not, stirs the bed's silt up into it: `silt`, 0 to 1.
 * @returns {{ depthFt: number, radiusFt: number, foam: number, foamFt: number, silt: number }}
 */
export function wheelStir({ hubFt, radiusFt = 2.75, levelFt, speedFtS = 0, treadFtS = speedFtS }) {
  const wetFt = levelFt - (hubFt - radiusFt), topFt = hubFt + radiusFt - levelFt;
  const meets = smooth(0, 0.3, wetFt) * smooth(-2, 0, topFt);
  const speed = Math.abs(speedFtS), tread = Math.max(speed, Math.abs(treadFtS));
  const { fromFtS, fullFtS, reach, siltFromFtS, siltFullFtS } = WHEEL_CHURN;
  return {
    depthFt: meets * Math.min(0.9, 0.12 + 0.025 * speed), radiusFt: 1.8,
    foam: meets * smooth(fromFtS, fullFtS, tread), foamFt: radiusFt * reach,
    silt: smooth(0, 0.3, wetFt) * smooth(siltFromFtS, siltFullFtS, tread),
  };
}

/**
 * A wheel that comes down into the water at `fallFtS` throws a ring out from where it struck: the
 * surface is pushed down by `depthFt` over `radiusFt` at once, beaten white over `foamFt` and its
 * bed's silt thrown up. Nothing for a touch under 5 ft/s.
 */
export function landingStir(fallFtS) {
  if (!(fallFtS >= 5)) return null;
  return { depthFt: Math.min(2.5, 0.06 * fallFtS), radiusFt: 3, foam: Math.min(1, fallFtS / 30), foamFt: 4, silt: Math.min(1, fallFtS / 20) };
}

function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How a wheel on the ground stirs a puddle it runs through (render/water-ripples.js), where the
 * puddle stands `depthFt` deep, at `speedFtS`: as `wheelStir`, but a puddle is inches deep. The
 * tire stands on the ground through it: it holds the water down to the bed over `radiusFt` about
 * itself, `bareFt` deeper than the bed at its middle (`PUDDLE_PARTING`), and the faster it goes
 * the harder it pushes the water aside. None in a puddle too shallow to hold a wave.
 */
export function puddleStir({ depthFt, speedFtS = 0 }) {
  const holds = smooth(0.01, 0.1, depthFt), speed = Math.abs(speedFtS);
  const { radiusFt, bedShare } = PUDDLE_PARTING;
  // (A puddle's ground draws its churned water as silt and froth both: it has no silt of its own.)
  return {
    depthFt: holds * Math.max(bedShare * depthFt, Math.min(0.3, 0.04 + 0.008 * speed)), radiusFt,
    foam: holds * Math.min(1, Math.max(0, (speed - 4) / 25)), foamFt: 1.5, silt: 0,
  };
}

/**
 * A tire in a puddle (`puddleStir`): it holds the water down over `radiusFt` about itself, at its
 * middle toward `bedShare` of the puddle's depth below the rest. The field pulls the water three
 * fifths of the way there in a step, so even a tire that crosses a point in one step bares the
 * bed under its tread.
 */
export const PUDDLE_PARTING = Object.freeze({ radiusFt: 2, bedShare: 2.2 });

/** A puddle's surface lies this far under its full level while the rain is still filling it, feet (game/atmosphere.js `puddlesFilled`). */
export const PUDDLE_FILL_DROP_FT = 0.1;

/*
  The land in the water (docs/VISUALS.md, "Water", "The land in it"), for "Reflective water". A
  level mirror shows the eye what an eye as far under the water as it is over it would see of
  the land above the water: the land's own picture from below, upside down. The port works out
  that picture once a frame, as a map of directions from the eye under the water: for each, the
  first ground the line meets once it has come up through the water, lit as the ground is and
  hazed by how far the light has come. The water reads the map along each point's own line off
  its waves.

  The map is `columns` round the horizon and `rows` from the horizon to straight up, by the
  square root of the sine of the elevation (`reflectionRow`): the land in the water lies low,
  within a few degrees of the horizon, where the rows are finest.

  A line is followed over the highest ground in the cells it crosses (`highestGround`): cells
  `cellFt` across, and twice as wide at each of `levels` sizes. Where it enters a cell over all
  the ground in it, it runs on to where it leaves the cell (it only climbs) and tries the next
  size up; where it does not, it tries the next size down; in the finest cell that it does not
  clear, it is followed against the drawn ground itself, in steps of `stepFt`, or `stepShare`
  of how far it has run when that is the longer. Each line reads at most `reads` times.
*/
export const WATER_REFLECTION = Object.freeze({
  columns: 512, rows: 128, cellFt: 32, levels: 5, stepFt: 8, stepShare: 0.012, reads: 64,
});

/** The place in the map's rows, 0 at the horizon to 1 straight up, of a direction `sine` steep (the sine of its elevation). */
export const reflectionRow = (sine) => Math.sqrt(Math.min(1, Math.max(0, sine)));
/** The sine of the elevation of the direction at `row` (0 to 1) in the map's rows. */
export const reflectionSine = (row) => Math.min(1, Math.max(0, row)) ** 2;

/**
 * The highest ground in each cell, at each of `levels` sizes: level 0 is cells `cellFt` across,
 * each next level's twice as wide. A cell holds the highest of the ground map's samples in it and
 * in a row of samples round it, since the ground between samples is drawn from the four about it:
 * no point of the ground in a cell stands higher. So a line that climbs, and enters a cell over
 * that height, is over the ground until it leaves the cell. `heights` is the ground map
 * (game/ground-maps.js `buildGroundMap`), `side` samples square over a world of `worldFt`.
 * `wraps` false is a level drawn once, which has no samples past its edges.
 *
 * @returns {{ levels: Float32Array[], sides: number[], topFt: number }} each level's cells, row
 *   by row along the map's z, and the highest ground anywhere
 */
export function highestGround(heights, side, { worldFt = 8192, cellFt = WATER_REFLECTION.cellFt, levels = WATER_REFLECTION.levels, wraps = true } = {}) {
  const per = Math.max(1, Math.round((cellFt * side) / worldFt));
  let n = Math.max(1, Math.floor(side / per));
  let raw = new Float32Array(n * n).fill(-Infinity), topFt = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let most = -Infinity;
      for (let jj = j * per - 1; jj <= (j + 1) * per; jj++) {
        for (let ii = i * per - 1; ii <= (i + 1) * per; ii++) {
          if (!wraps && (jj < 0 || ii < 0 || jj >= side || ii >= side)) continue;
          const h = heights[((jj + side) % side) * side + ((ii + side) % side)];
          if (h > most) most = h;
        }
      }
      raw[j * n + i] = most;
      if (most > topFt) topFt = most;
    }
  }
  const out = [], sides = [];
  for (let level = 0; level < levels && n >= 1; level++) {
    out.push(raw);
    sides.push(n);
    if (n === 1) break;
    // The next level's cells, each the highest of the four under it.
    const half = n >> 1, next = new Float32Array(half * half);
    for (let j = 0; j < half; j++) {
      for (let i = 0; i < half; i++) {
        next[j * half + i] = Math.max(raw[2 * j * n + 2 * i], raw[2 * j * n + 2 * i + 1], raw[(2 * j + 1) * n + 2 * i], raw[(2 * j + 1) * n + 2 * i + 1]);
      }
    }
    raw = next;
    n = half;
  }
  return { levels: out, sides, topFt };
}

const srgbByte = (linear) => {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

/**
 * The ground's colour in each of the terrain's `grid` by `grid` cells, as the land in the water
 * shows it: the mean of the texture the cell wears (game/lighting.js `tileTones`, linear), by
 * the cell's `.CLR` word (its low twelve bits name the texture; MTM2_PHYSICS.md 2.3). `fallback`
 * where the cell names none there is. RGBA, sRGB bytes, rows along the map's z.
 */
export function landTones(clr, tones, fallback, grid = 256) {
  const out = new Uint8Array(grid * grid * 4);
  for (let cell = 0; cell < grid * grid; cell++) {
    const tone = (clr ? tones?.[clr[cell] & 0x0fff] : null) ?? fallback;
    out[cell * 4] = srgbByte(tone[0]);
    out[cell * 4 + 1] = srgbByte(tone[1]);
    out[cell * 4 + 2] = srgbByte(tone[2]);
    out[cell * 4 + 3] = 255;
  }
  return out;
}
