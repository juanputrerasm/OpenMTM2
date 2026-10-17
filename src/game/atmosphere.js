/*
  The air, by weather, for "Volumetric weather" (docs/VISUALS.md, "Weather"): how thick the fog
  is and how it lies, and how the rain and the snow fall. The game's own numbers are in
  game/weather.js (MONSTER_EXE_ANALYSIS.md section 13: each weather's fog colour, and where its
  fog ends or its view is cut); what is made of them here is the port's.

  The game's fog is a straight ramp over distance, the same at any height. This fog is a layer
  on the land: it lies on a floor that follows the land broadly (game/fog-floor.js), is as
  thick as the weather says up to a deck over that floor, thins above the deck with a scale
  height, and the eye looks through it along a ray. So a hill top stands out of it, a valley
  lies under it, and the sky clears overhead as the eye climbs. Its thickness is set so that it
  hides half of what the game's fog hides at the same half-way distance, so a race is as hard
  to see through as the game makes it; it is the fog itself that hides what is far, not an
  edge the picture stops at.

  Pure, so it runs under Node.
*/
import { WEATHER_LOOK } from "./weather.js";

/**
 * A fog closes fully at `FOG_REACH` times the distance the game's fog ends at, and is faded in
 * to that from `FOG_FADE_FROM` times it. By then the fog has hidden nineteen parts in twenty of
 * what stands there by itself, so nothing is seen to come out of an edge: with the fade
 * nearer, things popped into the picture as they crossed it.
 */
export const FOG_REACH = 2.5, FOG_FADE_FROM = 1.9;
/**
 * A weather without fog has the haze of a clear day: it hides half at `CLEAR_HALF` of the
 * distance where the picture ends, and from `CLEAR_FADE` of it the ground is faded out. The
 * world repeats every 8192 ft, so the picture has to end before the eye reaches the next copy
 * of the track; the haze is what makes that end a distance and not an edge.
 */
export const CLEAR_HALF = 0.6, CLEAR_FADE = 0.5;
/** Under a stadium's roof the haze of a weather without fog is this many times as thin. */
export const INDOOR_CLEARER = 10;
/** How far off a track's backdrop stands, feet: beyond the next copy of the wrapped world, 8192 ft on (render/atmosphere.js). */
export const BACKDROP_DISTANCE_FT = 9000;
/** How high above the horizon a backdrop is still wholly in the haze, as the sine of the angle: below it the ground's own far fade has closed. */
export const BACKDROP_FOOT = 0.03;
/**
 * In the dark weathers, which have darkness and no fog, how much of a backdrop the darkness
 * takes: at Dusk the hills stand dim against the sky, at Night they are shapes, in Pitch
 * Black there is nothing.
 */
export const BACKDROP_DARK = Object.freeze({ 6: 0.62, 7: 0.84, 8: 1 });
/**
 * The fog's banks (docs/VISUALS.md, "Banks"). They stand in the world and move only with the
 * wind, a few feet a second. The line of sight is cut in `slices` (`liteSlices` in a headset)
 * that lengthen with distance, and each is as thick as the fog is where its middle lies: a
 * broad field of banks, one repeat of its noise `broadFt` across, and a second, `midFt`
 * across, read blurred so that nothing in it is finer than a couple of hundred feet. (Finer
 * than that, a truck at speed runs through the fog's own grain several times a second, and the
 * whole fog flickers past.) A weather's `drift` of 1 would take the fog from nothing to twice
 * its thickness; `shade` is how much brighter fog twice as thick is seen; the layer's top
 * stands `topSwell` of its deck higher over a bank and lower over a clearing.
 */
export const FOG_BANKS = Object.freeze({ slices: 5, liteSlices: 2, broadFt: 2600, midFt: 1100, midBlur: 2, reach: 1, shade: 0.12, topSwell: 0.4 });
/**
 * Where slice `index` of `slices` ends, feet, for a fog that ends at `farFt`: by the square of
 * its number, so the nearest slice is the shortest and what is close is told apart finest.
 */
export const fogSliceEnd = (index, slices, farFt) => farFt * ((index + 1) / slices) ** 2;
/**
 * The fog's thickness where its noise reads `noise` (0 to 1, about a half), against an even
 * fog's, for a weather's `drift`: banks and thin places with soft edges, 1 on the whole.
 */
export function fogBank(noise, drift) {
  const t = Math.min(1, Math.max(0, (noise - 0.36) / 0.28));
  return Math.max(0, 1 + drift * FOG_BANKS.reach * (t * t * (3 - 2 * t) * 2 - 1));
}
/*
  Foggy's top (docs/VISUALS.md, "The top"). A fog that lies in valleys has a top, as a cloud
  has: thickest just under it, where the fog is wettest, and ending over a few feet, with wisps
  above. From over it, it is a sea of cloud, lit by the day from above and darker inside.
   - `cap`: how much thicker the fog is just under its top than in its deck, thinning by 1/e
     every `capFt` down.
   - `crispFt`: over the top the fog ends by 1/e every `crispFt`, all but `wisps` of it; the
     wisps thin by the weather's scale height, and lie in patches.
   - `billowFt`: the top is not level but heaped in billows, this high from hollow to crown,
     the broadest some `billowSizeFt` across, and the billows drift with the wind.
   - `lit`: the top is lit by the day, up to `1 + lit` times as bright as the fog inside (in a
     full sun; under a weak one, less), and the light reaches `lightFt` into it by 1/e. The face
     of a billow turned toward the sun is the brighter, one turned away the darker.
   - `steps`: the line of sight is followed in this many steps (`liteSteps` in a headset)
     where it passes through the billows; elsewhere the fog is summed in closed form.
*/
export const FOG_TOP = Object.freeze({ cap: 2.5, capFt: 13, crispFt: 7, wisps: 0.15, billowFt: 34, billowSizeFt: 260, lit: 0.85, lightFt: 40, steps: 8, liteSteps: 4 });
/** The shape of a fog without a top: full below its deck, thinning above it by the scale height alone. */
const NO_TOP = Object.freeze({ cap: 0, capFt: 1, crispFt: 1, wisps: 1 });

/**
 * How thick the fog is `overFt` over its top (under it when negative), against its deck's
 * thickness, for a fog of `shape` (`fogVolume(...).shape`) thinning above by `scaleHeightFt`.
 */
export function fogProfile(overFt, shape, scaleHeightFt) {
  const { cap, capFt, crispFt, wisps } = shape ?? NO_TOP;
  if (overFt <= 0) return 1 + cap * Math.exp(overFt / capFt);
  return (1 + cap) * ((1 - wisps) * Math.exp(-overFt / crispFt) + wisps * Math.exp(-overFt / scaleHeightFt));
}

/**
 * How much fog a line of sight passes, as feet of fog at its deck's thickness: the line starts
 * `overFt` over the layer's top (under it when negative), runs `distanceFt` and climbs `climb`
 * feet a foot (falls when negative), through a layer of `shape` (`fogProfile`) whose wisps thin
 * by `scaleHeightFt`; a number alone for `shape` is a fog without a top that thins by that scale
 * height. The same sum the shaders do (render/atmosphere.js).
 */
export function fogColumn(overFt, climb, distanceFt, shape) {
  const scaleHeightFt = typeof shape === "number" ? shape : shape.scaleHeightFt;
  const form = typeof shape === "number" ? NO_TOP : shape;
  if (Math.abs(climb) < 1e-5) return distanceFt * fogProfile(overFt, form, scaleHeightFt);
  const end = overFt + climb * distanceFt, low = Math.min(overFt, end), high = Math.max(overFt, end);
  const { cap, capFt, crispFt, wisps } = form;
  let sum = 0;
  if (low < 0) {
    const top = Math.min(high, 0);
    sum += top - low + cap * capFt * (Math.exp(top / capFt) - Math.exp(low / capFt));
  }
  if (high > 0) {
    const from = Math.max(low, 0);
    const fade = (scale) => scale * (Math.exp(-from / scale) - Math.exp(-high / scale));
    sum += (1 + cap) * ((1 - wisps) * fade(crispFt) + wisps * fade(scaleHeightFt));
  }
  return sum / Math.abs(climb);
}

/**
 * How bright the fog is `overFt` over its top (under it when negative), against the fog's own
 * colour, for a top lit `lit` (`fogTopLit`): `1 + lit` at the top and over it, less and less
 * further in, down to the fog's colour deep in its deck.
 */
export const fogLight = (overFt, lit, lightFt = FOG_TOP.lightFt) => 1 + lit * Math.exp(Math.min(0, overFt) / lightFt);
/** How much brighter a fog's top is lit than its inside, for a weather that lets `sun` of the sunlight through (game/weather.js `sun`). */
export const fogTopLit = (volume, sun) => (volume?.lit ?? 0) * (0.4 + 0.6 * Math.min(1, Math.max(0, sun)));

/**
 * The Volumetric weather slider (Options, Enhanced graphics, Custom): 0 None (the switch off, the game's own fog),
 * 1 Few, 2 Default (what a preset sets) and 3 Max, the fog as thick as `fogVolume` describes it. Each is that share
 * of the fog's thickness.
 */
export const FOG_AMOUNTS = Object.freeze([0, 0.3, 0.55, 1]);
export const WEATHER_LEVEL_NAMES = Object.freeze(["None", "Few", "Default", "Max"]);
export const DEFAULT_WEATHER_LEVEL = 2;
/** The level the settings ask for: `weatherAmount` 1..3 while Volumetric weather is on, else 0. */
export function weatherLevel(settings) {
  if (settings?.volumetricWeather !== true) return 0;
  const level = settings?.weatherAmount;
  return Number.isInteger(level) && level >= 0 && level <= 3 ? level : DEFAULT_WEATHER_LEVEL;
}

/*
  Per weather, the port's choices (the distances come from WEATHER_LOOK):
   - `deckFt`: how far over its floor (game/fog-floor.js) the fog is at its full thickness.
   - `scaleHeightFt`: the height over which it thins to 1/e above that. Foggy is a low layer
     with a top: a truck that climbs a hundred feet over the land about it is coming out of it,
     and at two hundred is in the clear. Dense Fog has no top to come out of: it thins a little
     with height and no more. The haze of rain or snow is as deep as the weather.
   - `drift`: how far its thickness varies from place to place, 0 to 1 (`fogBank`), and
     `windFtPerS` how fast those banks move.
   - `skyDepth`: how much of it lies between the eye and the sky straight overhead, for an eye
     on the fog's floor (optical depth): 1 hides about two thirds of the zenith.
   - `open`: the fog has a top an eye can climb out of, and from there the land is seen as far
     as on a clear day, lying under its fog. Such a fog has no edge of its own where the
     picture stops: the fog along each line of sight is what hides things.
   - `glow`: how strongly it lights up toward the sun, 0 to 1.
   - `top`: it has a top as a cloud has (`FOG_TOP`): Foggy, which lies in the valleys. The
     others thin above their deck by the scale height alone.
*/
const VOLUMES = Object.freeze({
  0: Object.freeze({ deckFt: 0, scaleHeightFt: 1400, drift: 0.18, windFtPerS: 4, skyDepth: 0.1, glow: 0.3 }),
  1: Object.freeze({ deckFt: 0, scaleHeightFt: 1200, drift: 0.22, windFtPerS: 5, skyDepth: 0.16, glow: 0.12 }),
  2: Object.freeze({ deckFt: 45, scaleHeightFt: 40, drift: 0.55, windFtPerS: 4, skyDepth: 0.9, glow: 0.4, open: true, top: true }),
  3: Object.freeze({ deckFt: 60, scaleHeightFt: 450, drift: 0.4, windFtPerS: 3, skyDepth: 2.4, glow: 0.22 }),
  4: Object.freeze({ deckFt: 0, scaleHeightFt: 600, drift: 0.4, windFtPerS: 9, skyDepth: 0.5, glow: 0.04 }),
  5: Object.freeze({ deckFt: 0, scaleHeightFt: 400, drift: 0.34, windFtPerS: 5, skyDepth: 1.2, glow: 0.2 }),
});

/**
 * The fog as a volume for a weather, or null where the weather has none of its own: Dusk, Night
 * and Pitch Black cut the view with darkness, not with fog, and stay as they were.
 *
 * `clearRange` is where a weather without fog of its own fades into the distance, feet
 * `{ startFt, endFt }` (the renderer's draw distance decides it). `indoor` is a stadium: under
 * its roof there is no day's haze, only the air of a hall, a tenth as thick. `amount` is the
 * Volumetric weather slider's share of the fog (`FOG_AMOUNTS`): 1, Max, is the fog as described
 * above; less thins it, and the picture still fades out at the same distance.
 *
 * @returns {{ densityPerFt: number, deckFt: number, scaleHeightFt: number, fadeStartFt: number, farFt: number, reachFt: number,
 *   drift: number, windFtPerS: number, skyDepth: number, glow: number, shape: object, billowFt: number, billowSizeFt: number,
 *   lit: number, lightFt: number }|null}
 *   `fadeStartFt` to `farFt` is where the picture is faded out whatever the fog; `reachFt` how far
 *   from the eye the fog's banks are told apart (its slices end there; beyond, the fog is even).
 *   `shape` is the layer's (`fogProfile`, with its `scaleHeightFt`); `billowFt` to `lightFt` its
 *   top's (`FOG_TOP`), none for a fog without one.
 */
export function fogVolume(weather, clearRange = { startFt: 2500, endFt: 7000 }, { indoor = false, amount = 1 } = {}) {
  const look = WEATHER_LOOK[weather], volume = VOLUMES[weather];
  if (!look || !volume) return null;
  let halfFt, fadeStartFt, farFt, reachFt = null;
  if (!look.fogEndFt) {
    // No fog of its own: the haze of a clear day, which gives the distance its depth and ends where the picture does.
    halfFt = clearRange.endFt * CLEAR_HALF * (indoor ? INDOOR_CLEARER : 1);
    fadeStartFt = clearRange.endFt * CLEAR_FADE;
    farFt = clearRange.endFt;
  } else if (look.fogStartFt > 0) {
    // The game cuts the view here and has no fog: the port's ramp from `fogStartFt` to the cut, as a haze that ends at the cut.
    halfFt = (look.fogStartFt + look.fogEndFt) / 2;
    fadeStartFt = look.fogEndFt * 0.8;
    farFt = look.fogEndFt;
  } else {
    // The game's fog, a ramp from the eye to `fogEndFt`: half hidden at half that distance.
    halfFt = look.fogEndFt / 2;
    reachFt = look.fogEndFt * FOG_REACH;
    if (volume.open) {
      // A fog with a top: from over it the land is seen as far as on a clear day.
      fadeStartFt = Math.max(reachFt, clearRange.endFt * CLEAR_FADE);
      farFt = Math.max(reachFt, clearRange.endFt);
    } else {
      fadeStartFt = look.fogEndFt * FOG_FADE_FROM;
      farFt = reachFt;
    }
  }
  const { open = false, top = false, ...lay } = volume;
  const form = top ? FOG_TOP : NO_TOP;
  return {
    ...lay, open, densityPerFt: Math.LN2 / halfFt * amount, skyDepth: lay.skyDepth * amount, fadeStartFt, farFt, reachFt: reachFt ?? farFt,
    shape: Object.freeze({ cap: form.cap, capFt: form.capFt, crispFt: form.crispFt, wisps: form.wisps, scaleHeightFt: lay.scaleHeightFt }),
    billowFt: top ? FOG_TOP.billowFt : 0, billowSizeFt: FOG_TOP.billowSizeFt, lit: top ? FOG_TOP.lit : 0, lightFt: FOG_TOP.lightFt,
  };
}

/**
 * How much of what lies `distanceFt` away along a level line the fog hides, 0 to 1, for an eye
 * in the fog's deck: the same sum the shaders do (render/atmosphere.js), without its banks.
 */
export function fogHides(volume, distanceFt) {
  if (!volume) return 0;
  const thick = 1 - Math.exp(-volume.densityPerFt * distanceFt);
  const fade = Math.min(1, Math.max(0, (distanceFt - volume.fadeStartFt) / (volume.farFt - volume.fadeStartFt)));
  return Math.max(thick, fade * fade * (3 - 2 * fade));
}

/**
 * The weathers whose fog stands between the eye and a backdrop: Foggy, Dense Fog, Rain and Snow. In the others (Clear,
 * Cloudy, the dark ones) the day's haze is the ground's distance and not the backdrop's: an HD backdrop is the picture of a
 * far range in its own air already, and seen through the haze too it was washed out.
 */
export const BACKDROP_HAZED = new Set([2, 3, 4, 5]);

/**
 * How much of a track's backdrop the fog hides, 0 to 1, for an eye on the fog's floor looking
 * `sine` (the sine of the angle) above the horizon in `weather`: the same sum the shader does
 * (render/atmosphere.js), without its banks. In a weather of `BACKDROP_HAZED` the backdrop is seen
 * through the whole depth of the fog, which thins as the line of sight climbs out of it; in every
 * weather its foot is lost in the haze the ground fades into, so the ground's far edge is never
 * seen against it.
 */
export function backdropHides(volume, sine, weather = 0) {
  if (!volume) return 0;
  const through = BACKDROP_HAZED.has(weather) ? 1 - Math.exp(-volume.densityPerFt * fogColumn(-volume.deckFt, sine, BACKDROP_DISTANCE_FT, volume.shape)) : 0;
  const foot = Math.min(1, Math.max(0, sine / BACKDROP_FOOT));
  return Math.max(through, 1 - foot * foot * (3 - 2 * foot));
}

/**
 * How thick the fog is `overFloorFt` over its floor, against its deck's thickness: all of it in
 * the deck (more just under a top), thinning above.
 */
export const fogAtHeight = (volume, overFloorFt) => (volume ? fogProfile(overFloorFt - volume.deckFt, volume.shape, volume.scaleHeightFt) : 0);

/**
 * The rain and the snow as they fall around the eye. Speeds are the port's, as before: rain at
 * 70 ft/s on a 12 ft/s wind, snow at 9 ft/s drifting. Each has a near field of particles close
 * enough to see one by one and a far field of larger, fainter ones that fills the distance.
 *
 * `count`, `boxFt` (the field's width and depth) and `heightFt` say how many fall in how much
 * air; `sizeFt` is a drop's width or a flake's diameter; `lengthFt` a streak's length when the
 * eye is still (it stretches and leans with the eye's own speed).
 */
export const PRECIPITATION = Object.freeze({
  rain: Object.freeze({
    fallFtPerS: 70, windFtPerS: Object.freeze([12, 0]),
    near: Object.freeze({ count: 12000, boxFt: 110, heightFt: 70, sizeFt: 0.035, lengthFt: 2.2, opacity: 0.3 }),
    far: Object.freeze({ count: 6000, boxFt: 340, heightFt: 150, sizeFt: 0.1, lengthFt: 5, opacity: 0.14 }),
    splashes: 520, splashBoxFt: 90,
  }),
  snow: Object.freeze({
    fallFtPerS: 9, windFtPerS: Object.freeze([2.5, 1]),
    near: Object.freeze({ count: 9000, boxFt: 130, heightFt: 80, sizeFt: 0.11, lengthFt: 0, opacity: 0.9 }),
    far: Object.freeze({ count: 6000, boxFt: 420, heightFt: 170, sizeFt: 0.45, lengthFt: 0, opacity: 0.4 }),
    splashes: 0, splashBoxFt: 0,
  }),
});

/** The precipitation a weather has, or null. */
export const precipitationOf = (weather) => PRECIPITATION[WEATHER_LOOK[weather]?.precipitation] ?? null;

/**
 * Snow on the ground and on the ice. The game spreads its ice over the water from nothing,
 * gaining 1/200 of full a second and stopping at half (section 13: 0x7fff of 0xffff after 100
 * seconds). The port's snow keeps that clock, with one change: a race that begins in Snow has
 * `SNOW_START` of it down already, since it has been snowing, and the rest settles over the
 * game's 100 seconds. Snow that begins during a race (GOLD mode's weather change) settles from
 * nothing, as the game's does. On the ice it ends covering a seventh (`ICE_SNOW_SHARE`): the
 * game's overlay ends half opaque over all of the ice, but the port's ice is worth seeing, and
 * snow in a few drifts along the shore shows it off where snow over half of it would hide it.
 * On the ground, which the game leaves bare, it ends at its full depth (game/snow-cover.js).
 */
export const SNOW_SETTLE_SECONDS = 100, ICE_SNOW_SHARE = 0.14, SNOW_START = 0.3;
/** How far the game's clock has run after `seconds` of Snow, 0 to 1. */
export const snowSettled = (seconds) => Math.min(1, Math.max(0, seconds / SNOW_SETTLE_SECONDS));
/** How much of the snow is down after `seconds`, 0 to 1, with `start` of it down to begin with. */
export const snowDown = (seconds, start = SNOW_START) => start + (1 - start) * snowSettled(seconds);

/**
 * Wet ground (render/ground-surface.js). It is `darker` of its dry brightness and its colours
 * `deeper` (their distance from grey grows by that share), and it has a sheen: it mirrors
 * `sheen` of the sky seen from straight above and `sheenLow` along the ground, never more than
 * `sheenMost`. The sheen is kept slight on purpose. A wet road seen along its length from a
 * chase camera would otherwise be one grey mirror, and what a track is made of, which a driver
 * reads the course by, would be lost under it. Standing water is the mirror; the ground is not.
 */
export const WET = Object.freeze({ darker: 0.74, deeper: 0.3, sheen: 0.015, sheenLow: 0.17, sheenMost: 0.24 });

/**
 * Standing water (render/ground-surface.js). Up a puddle's bank, where the water has soaked it,
 * the ground is `soaked` darker. Rain standing on dirt is muddy: a puddle hides the ground under
 * it in the colour of its silt, the ground's own colour taken broadly at `mud` of its brightness,
 * by 1 - e^(-depth / `murkFt`) and never more than `murkMost`, so that under an inch of water
 * little of the ground shows. Stirred up by a wheel the silt hides the ground whole, a shade
 * paler (`stirredPaler` more of the ground's brightness), and where the wheel beat it hardest a
 * scum of muddy froth covers up to `froth` of the water for a while. The soaked bank, and a
 * puddle's bed where a wave has just bared it, keep a film of the muddy water: `film` of the
 * silt's colour over the ground's.
 */
export const POOL_LOOK = Object.freeze({ soaked: 0.3, murkFt: 0.06, murkMost: 0.85, mud: 0.6, stirredPaler: 0.25, froth: 0.55, film: 0.4 });

/** How much of a puddle's bed its muddy water hides where it stands `depthFt` deep, 0 to `POOL_LOOK.murkMost`. */
export const poolMurk = (depthFt) => POOL_LOOK.murkMost * (1 - Math.exp(-Math.max(0, depthFt) / POOL_LOOK.murkFt));

/** How wet the ground is after `seconds` of Rain, 0 to 1: it darkens within seconds, and the puddles fill over a minute. */
export const groundWetness = (seconds) => Math.min(1, Math.max(0, seconds / 8));
export const puddlesFilled = (seconds) => Math.min(1, Math.max(0, 0.35 + seconds / 60));
