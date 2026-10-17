/*
  The switches of the port's own scenery (docs/VISUALS.md): the smoothed ground, the water, the
  volumetric weather, puddles in the rain, snow lying on the ground, the light and what the trucks throw up. Each is a setting of its
  own (app/settings.js), off unless a preset (game/graphics.js) or the player turns it on in Options, and each off leaves that
  part of the picture as it was drawn before.

  Pure, so it runs under Node.
*/
import { DEFAULT_WEATHER_LEVEL, WEATHER_LEVEL_NAMES, weatherLevel } from "./atmosphere.js";
import { allowedWeathers } from "./weather.js";

/** The switches as the Options screen lists them: the setting's key, its name and what it does. */
export const VISUAL_OPTIONS = Object.freeze([
  Object.freeze({ key: "terrainSmoothing", label: "Smooth terrain", hint: "Rounds the ground's 32 ft facets and gives steep slopes and cliffs relief. Trucks drive on the same ground as before." }),
  Object.freeze({ key: "enhancedWater", label: "Reflective water", hint: "Wind waves that gust, the sky and the hills mirrored in it, the sun's glint, a shore that shallows, wakes and rings where the trucks stir it, and solid ice in Snow." }),
  // A slider, not a switch: None (off), Few, Default or Max, how thick the fog is (game/atmosphere.js `FOG_AMOUNTS`).
  Object.freeze({ key: "volumetricWeather", label: "Volumetric weather", hint: "Fog that lies in layers and drifts, a sea of cloud in the valleys with a lit top, and rain and snow that fall through the air around you. The slider sets how thick the fog is: None is the game's own fog, Max the thickest.", amountKey: "weatherAmount", levels: WEATHER_LEVEL_NAMES, defaultLevel: DEFAULT_WEATHER_LEVEL, level: weatherLevel }),
  Object.freeze({ key: "rainPuddles", label: "Rain puddles", hint: "In Rain the ground is wet, and water stands where the ground has a low point, which the trucks splash through and stir." }),
  Object.freeze({ key: "snowCover", label: "Snow cover", hint: "In Snow the ground lies under snow that deepens as it settles: deep on level ground, thin on slopes and along the track." }),
  Object.freeze({ key: "groundDetail", label: "Ground detail", hint: "Ground that stays sharp close up and steady far off: fine grain over the game's textures, cliffs without smeared texels, and no shimmer in the distance." }),
  Object.freeze({ key: "naturalLight", label: "Natural light", hint: "Sunlight in the colour of its hour, light from the sky and off the ground, shadows cast by the hills, and bright light that rolls off instead of clipping. Needs the enhanced look." }),
  Object.freeze({ key: "glossyPaint", label: "Glossy paint", hint: "Trucks mirror the sky and throw the sun back as a glint, more so when wet." }),
  Object.freeze({ key: "lensEffects", label: "Lens effects", hint: "Bright lights glow: the sun, its glints on water and paint, headlights, lightning. On the flat screen only; a headset draws without it." }),
  Object.freeze({ key: "truckLamps", label: "Truck lamps", hint: "Lamps that glow in their own colour, headlight beams as light in the air (plain in fog and at night, faint by day), tail lamps that run dim and brake bright, headlights that light the ground whenever they are on, and a start gantry of real lamps." }),
  Object.freeze({ key: "richParticles", label: "Rich particles", hint: "Dust that billows along behind a truck as thick as the ground there is dry and bare, and takes the light, powder and chips off snow and ice, sheets of spray out of water and puddles, sparks that glow and cool as they fly, and tracks pressed into the ground, ploughed through deep snow where ruts that cross make one snow, and gone under standing water. Which of them are thrown at all is under Effects." }),
  Object.freeze({ key: "replayEffects", label: "Replay effects", hint: "Dust, tire tracks and sparks in replays, as in the race, read off the recorded film, and the enhanced look's sun shadows. Which of them are thrown at all is under Effects." }),
]);

const RAIN = 4, SNOW = 5;

/** Which of them are on, from the settings: only an explicit `true` is on, so a missing one is the game's own picture. */
export function visualSettings(settings = {}) {
  return {
    smoothing: settings.terrainSmoothing === true,
    water: settings.enhancedWater === true,
    weather: settings.volumetricWeather === true,
    puddles: settings.rainPuddles === true,
    snow: settings.snowCover === true,
    detail: settings.groundDetail === true,
    light: settings.naturalLight === true,
    gloss: settings.glossyPaint === true,
    lens: settings.lensEffects === true,
    lamps: settings.truckLamps === true,
    particles: settings.richParticles === true,
    replay: settings.replayEffects === true,
  };
}

/**
 * What the asset worker is to build for a race (worker/track-build.js `visuals`): the drawn
 * ground, the map of its height (the water reads its depth from it, the rain and snow where to
 * stop), the map of where rain stands, and the depth of the snow on the terrain. The puddle map
 * is built only where it may be needed: the race is in Rain, or the track allows Rain and GOLD
 * mode may change to it. The snow's depth is built only for a race that begins in Snow: it
 * makes the terrain's mesh finer along the course, which no other weather should pay for, so
 * snow that GOLD mode brings on later lies flat. `cover` is the map of what stands over the
 * ground (bridges, tunnels), under which neither rain nor snow falls.
 */
export function trackVisuals(settings, { weather = 0, weatherMask = null } = {}) {
  const on = visualSettings(settings);
  const allowed = allowedWeathers(weatherMask);
  const puddles = on.puddles && (weather === RAIN || allowed.includes(RAIN));
  // What falls from the sky needs to know what stands over the ground: built where it may rain or snow, for whichever part draws that.
  const falls = weather === RAIN || weather === SNOW || allowed.includes(RAIN) || allowed.includes(SNOW);
  return {
    smoothing: on.smoothing, groundMap: on.water || on.weather || puddles, puddles, snow: on.snow && weather === SNOW,
    cover: falls && (on.weather || on.puddles || on.snow),
  };
}
