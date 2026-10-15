/*
  Per-browser preferences, kept in localStorage.

  Storage can be unavailable (private windows, blocked site data), so every access is guarded
  and the defaults always apply. Game data (the install, driver profiles, the Hall of Fame)
  lives in OPFS instead, through the workers.
*/

import { AA_MODES } from "../game/aa.js";
import { GRAPHICS_FLAGS, GRAPHICS_PRESETS } from "../game/graphics.js";
import { VISUAL_OPTIONS } from "../game/visuals.js";

const KEY = "openmtm2.settings";
/** The settings' format, stored with them and with an export (Options, Data). */
export const SETTINGS_VERSION = 10;

/**
 * The physics a race can run under, as Options (Game) and the console's `physics` list them. A model is one more entry
 * here and its rules in the simulation (OpenPhotex `simRules`). "mtm1" is Monster Truck Madness 1.00's differences
 * from MTM2 as read from its executable (MTM1_MONSTER_EXE_ANALYSIS.md 4.3), and its drag pass rules (7.2).
 */
export const PHYSICS_MODELS = Object.freeze([
  Object.freeze({ id: "mtm2", label: "Monster Truck Madness 2", note: "The 1998 game's" }),
  Object.freeze({ id: "mtm1", label: "Monster Truck Madness", note: "The 1996 game's: tires that touch throw trucks twice as hard, water stops a truck, no deep water, weather does not change the grip, no crash damage, and its own drag rules" }),
]);
/** A physics model by id; an unknown id is the first, MTM2's. */
export const physicsModel = (id) => PHYSICS_MODELS.find((m) => m.id === id) ?? PHYSICS_MODELS[0];

export const DEFAULT_SETTINGS = Object.freeze({
  look: "enhanced",           // "classic" or "enhanced"
  view: 1,                    // the camera view the race starts in (the exe's modes 0 to 9)
  units: "mph",               // the gauges' speed unit: "mph" or "kph"
  dashboard: true,            // the chase view's speedometer and tachometer (the Dashboard key toggles them)
  finder: true,               // the checkpoint finder ring in the cockpit, BlimpCam and RaceCam views (the Finder key)
  minimap: false,             // the course map (the Map key toggles it)
  detailLevel: 2,             // MONSTER.INI detailLevel: boxes with a higher priority are not drawn
  difficulty: 1,              // 0 Rookie, 1 Intermediate, 2 Professional
  laps: 3,
  weather: 0,                 // 0 Clear ... 8 Pitch Black, or "random" (a track may not allow it)
  opponents: 3,               // MONSTER.INI defaultOpponents (built-in default 3)
  opponentTrucks: Object.freeze([]), // explicitly selected CPU truck files from the Races dialog
  gameMode: "default",        // the Races screen's Mode: "default" (the track's own race), "freeroam", "flyby", "hockey" or "tag" (docs/PLAN.md, "Party modes")
  hockeyGoals: 3,             // Hockey: the goals that win
  tagMinutes: 5,              // Tag: the game's length
  wording: "",                // a .LOC from the install that rewords the game's text ("" is the standard wording)
  skin: "auto",               // "auto" (classic on retail and beta builds, modern on a community patch), "classic" or "modern"
  developer: false,           // list tracks and trucks with the developer views on the Start screen
  sound: Object.freeze({ master: 1, effects: 1, music: 0.8, muted: false }),
  commentary: false,          // reserved for commentaryFlag; voice playback is temporarily disabled
  menuMusic: true,            // the menus play SOUND\\SPLASH.WAV from MUSIC.POD
  kookyHorn: false,           // MONSTER.INI kookyHorn: three horns instead of one
  crashDamage: true,          // MONSTER.INI allowCrashDamage (the game's own default is off): collisions dent the bodies
  autoShift: true,            // automatic gears (the game's default)
  bindings: Object.freeze({}), // key code overrides by action, see game/input/bindings.js
  hdWeather: true,            // Community Patch 3's HD skies: the install's WeatherArt folder, else the port's copy (worker/weather-art.js)
  mtm1TrucksApart: true,      // MTM1 trucks that MTM2's shadow by file name listed too, as "Bigfoot (MTM1)" (worker/truck-build.js)
  mtm1Particles: false,       // MTM1's particles and tracks in place of the dust, spray and tire tracks (render/mtm1-particles.js)
  originalBackdrops: false,   // the game's own backdrops over HD ones (worker/track-build.js originalBackdrop)
  mtm1Sounds: false,          // MTM1's skid sounds (game/sound-model.js mtm1CornerSample and the rest)
  mtm1EarthSky: false,        // MTM1's flat sky on every track: an MTM1 track's own, any other EARTHSKY (worker/track-build.js loadSky)
  mtm1TerrainOverlap: false,  // MTM1 tracks: MTM2's two-pixel overlap of the ground tiles
  vsync: true,                // draw with the display's refresh; off draws as fast as the browser allows
  aa: "msaa",                 // anti-aliasing (game/aa.js): off, msaa, fxaa, smaa or taa. The next race takes it up
  fpsLimit: false,            // hold the frame rate to `fpsLimitValue`
  fpsLimitValue: 60,
  opponentFps: 30,            // the frame rate the computer trucks drive as if the game ran at (the 1998 game's is about 30)
  timingHud: true,            // the times, laps and place in the corner (the Timing display key, O, switches them in every view)
  fpsCounter: false,          // the frames per second in the corner (the FPS counter key switches it)
  shortViewCycle: false,      // the Camera key steps through `shortViews` only
  shortViews: Object.freeze([0, 1, 2]), // the short cycle's views (game/cameras.js `shortViews`): the cockpit, Chase Near and Chase Far
  cameraClearance: true,      // the chase camera keeps a few feet over the ground, where the game lets it touch it (game/cameras.js)
  aiNames: Object.freeze([]), // the computer drivers' own names, by place; an empty one is the game's (game/race-setup.js `cpuNames`)
  zModeCameras: false,        // Z mode's zoom and cameras in any race, without GOLD or slew mode, and the Inertia view
  fullAutopilot: false,       // the game's "Full Autopilot": the player's truck drives itself
  autoStage: true,            // drag races: the player's truck stages itself (off: stage it by hand, or press the Auto Stage key)
  dustEffects: true,          // MONSTER.INI smokeEffectFlag: dust puffs behind the wheels on soft ground
  tireTracks: true,           // MONSTER.INI tireTrackFlag: treads left on soft ground (the game reads it but never draws them)
  waterSplash: true,          // drops thrown up where wheels run through water, more with speed (not in the game)
  waterReflections: false,    // MONSTER.INI reflectionFlag: the world mirrored in the game's water (render/water-mirror.js)
  truckReflections: false,    // MONSTER.INI truckReflectionFlag: CLOUDENV over the trucks' bodies (render/truck-reflection.js)
  sparks: true,               // sparks from hull contacts (not in the game); false is the slider's None
  dustAmount: 2,              // the Dust slider, both pictures: 0 None, 1 Few (the game's own), 2 Normal, 3 Many (game/tire-effects.js)
  greyDust: false,            // MTM2's own grey for wheels' dust and collisions' smoke
  sparkAmount: 2,             // the Sparks slider, both pictures: 0 None, 1 Few, 2 Normal, 3 Many (game/tire-effects.js)
  sonicTrucks: false,         // Professional only: the computer trucks drive as on a Sonic track, whatever the SIT's fly-by line says
  defaultOpponents: 3,        // computer trucks in a race until the player picks their own (MONSTER.INI defaultOpponents)
  drawCells: 128,             // terrain cells (32 ft each): how far the world is drawn (the camera's far plane and the fog)
  backdrops: false,           // the SIT's backdrop models behind the world (off by default)
  terrainDetail: true,        // Community Patch 3: the terrain's detail normals where a track paints a mask, and HD tiles' normal maps
  reflections: true,          // Community Patch 3: the sky reflected in materials that ask for it (glass, paint)
  showHiddenTracks: true,     // the two hidden tracks are listed unless this is turned off
  graphics: "off",            // the scenery preset (game/graphics.js): auto, off, low, high, max or custom. Off is the game's own picture
  terrainSmoothing: false,    // the ground's facets rounded and cliffs given relief (game/terrain-relief.js; docs/VISUALS.md)
  enhancedWater: false,       // water with waves, reflections and a shore, and solid ice in Snow (render/water-surface.js)
  volumetricWeather: false,   // fog in drifting layers, rain and snow falling through the air (render/atmosphere.js, precipitation.js)
  weatherAmount: 2,           // the Volumetric weather slider while it is on: 1 Few, 2 Default, 3 Max, the fog's thickness (game/atmosphere.js FOG_AMOUNTS)
  rainPuddles: false,         // wet ground and standing water in Rain (game/ground-maps.js)
  snowCover: false,           // snow settling on the ground in Snow (render/ground-surface.js)
  groundDetail: false,        // grain over the ground's textures, which are filtered for the distance (render/ground-detail.js)
  naturalLight: false,        // the sun's colour, sky and ground light, terrain shadows and the tone curve (render/light-rig.js)
  glossyPaint: false,         // trucks mirror the sky and glint in the sun (render/gloss.js)
  lensEffects: false,         // bright lights glow, on the flat screen (render/lens.js)
  truckLamps: false,          // lamps that glow in their own colour, beams as light in the air, tail lamps that brake bright (render/truck-object.js, light-beam.js)
  richParticles: false,       // dust, spray, snow and sparks that are lit and fogged, and tracks pressed into the ground (render/particles.js, tire-tracks.js)
  replayEffects: false,       // dust, tracks, sparks and sun shadows in replays, read off the recorded film (game/replay-effects.js)
  vr: Object.freeze({}),      // the headset's preferences, see game/vr/settings.js (docs/VR.md)
  offline: true,              // keep a copy of the app in the browser, to start without a server (app/offline.js)
  physics: "mtm2",            // the physics model, one of PHYSICS_MODELS
  flyControls: "traxx",       // how the fly-by camera is flown: "traxx" (JSTrackViewer's), "tv" (Terminal Velocity) or "hb" (Hellbender)
});

export function loadSettings() {
  try {
    return migrateSettings(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Settings as stored by any version (or imported from a file, Options, Data) brought up to this one: the steps below
 * for what was saved before them, then the defaults for whatever is missing. `stored` is changed.
 */
export function migrateSettings(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { ...DEFAULT_SETTINGS };
  // Version 2 made the enhanced look the default and version 3 listed the hidden tracks; what was saved
  // before them was never a choice.
  if (!(stored.version >= 2)) stored.look = "enhanced";
  if (!(stored.version >= 3)) stored.showHiddenTracks = true;
  // Version 4 made the menus follow the build unless the player picks one.
  if (!(stored.version >= 4)) stored.skin = "auto";
  // Version 5 counts the draw distance in terrain cells, 128 the standard; the feet saved before are dropped.
  if (!(stored.version >= 5)) delete stored.drawDistance;
  // Version 7 sets the scenery from a preset. A save that had turned a part off keeps that
  // mix as Custom. One that had not takes the default, Off: every part is the player's to turn on.
  if (!(stored.version >= 7) && !GRAPHICS_PRESETS.some((preset) => preset.id === stored.graphics)) {
    if (VISUAL_OPTIONS.some((option) => stored[option.key] === false)) stored.graphics = "custom";
    else delete stored.graphics;
  }
  // Version 8 keeps MTM1's trucks apart by default; the "off" saved before it was the old default, not a choice.
  if (!(stored.version >= 8)) delete stored.mtm1TrucksApart;
  // Version 9 turns MTM2's water and truck reflections off by default, and makes MTM1's sky one for every track, off by
  // default; what was saved before them was the old defaults.
  if (!(stored.version >= 9)) { delete stored.waterReflections; delete stored.truckReflections; delete stored.mtm1EarthSky; }
  // Version 10 keeps the chase camera clear of the ground by default; the "off" saved before it was the old default.
  if (!(stored.version >= 10)) delete stored.cameraClearance;
  stored.version = SETTINGS_VERSION;
  delete stored.showHiddenTrucks;
  // A value that is not one of the choices draws the default.
  if (!AA_MODES.some((mode) => mode.id === stored.aa)) delete stored.aa;
  if (!GRAPHICS_PRESETS.some((preset) => preset.id === stored.graphics)) delete stored.graphics;
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** The format name an exported options file carries (Options, Data). */
export const OPTIONS_FILE_FORMAT = "openmtm2-options";

/** An options file as Options, Data exports it: `{ format, version, exported, settings }`. */
export function optionsFile(settings, now = new Date()) {
  return { format: OPTIONS_FILE_FORMAT, version: SETTINGS_VERSION, exported: now.toISOString(), settings };
}

/**
 * The settings in an exported options file (its text), brought up to this version: `{ settings }`, or `{ error }` for
 * a file that is not one, or is from a newer version of the app than this one.
 */
export function readOptionsFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: "That file is not a settings file (it is not JSON)." }; }
  if (data?.format !== OPTIONS_FILE_FORMAT || !data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) {
    return { error: "That file is not an OpenMTM2 settings file." };
  }
  const version = Number.isInteger(data.version) ? data.version : 0;
  if (version > SETTINGS_VERSION) return { error: `Those settings are from a newer OpenMTM2 (version ${version}; this one reads up to ${SETTINGS_VERSION}).` };
  return { settings: migrateSettings({ ...data.settings, version }) };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not persisted; the session keeps working with what it has.
  }
}

export function clearSettings(storage = globalThis.localStorage) {
  try {
    storage.removeItem(KEY);
  } catch {
    // The OPFS data can still be cleared when local storage is unavailable.
  }
}

/**
 * The "MTM1 Classic preset" (Options, Advanced): every MTM1 choice on, the 1996 physics, and the enhanced graphics off,
 * the game's own sharp texels with them. Changes `settings` in place.
 */
export function applyMtm1Classic(settings) {
  Object.assign(settings, {
    mtm1EarthSky: true, mtm1TerrainOverlap: false, mtm1TrucksApart: true, originalBackdrops: true, mtm1Particles: true, mtm1Sounds: true,
    physics: "mtm1", graphics: "off", look: "classic", hdWeather: false, cameraClearance: true,
  });
  return settings;
}

/** Every MTM1 choice off: MTM2's sky, tile overlap, particles, sounds and physics, and a truck name to the archive mounted first. */
const NO_MTM1 = Object.freeze({
  mtm1EarthSky: false, mtm1TerrainOverlap: true, mtm1TrucksApart: false, mtm1Particles: false, mtm1Sounds: false, physics: "mtm2",
});

/**
 * The "MTM2 Classic preset" (Options, Advanced): the 1998 game's own picture. No MTM1 choice, the original backdrops and
 * grey dust, the game's few puffs, no sparks or splashes, MTM2's water and truck reflections and the backdrops, none of
 * Community Patch 3's weather or reflections, and the enhanced graphics off. Changes `settings` in place.
 */
export function applyMtm2Classic(settings) {
  Object.assign(settings, NO_MTM1, {
    originalBackdrops: true, greyDust: true, hdWeather: false, reflections: false, waterSplash: false,
    dustAmount: 1, dustEffects: true, sparkAmount: 0, sparks: false,
    waterReflections: true, truckReflections: true, backdrops: true, graphics: "off", cameraClearance: true,
  });
  return settings;
}

/**
 * The "OpenMTM2 preset" (Options, Advanced): the port's own picture. No MTM1 or MTM2 choice (MTM1's trucks stay listed
 * apart, which hides nothing), tire tracks, splashes, many dust puffs and the normal sparks, every enhanced part but the
 * glossy paint (Custom), and Community Patch 3's terrain detail, HD weather and reflections. Changes `settings` in place.
 */
export function applyOpenMtm2(settings) {
  Object.assign(settings, NO_MTM1, {
    mtm1TrucksApart: true, originalBackdrops: false, greyDust: false, waterReflections: false, truckReflections: false, backdrops: false,
    tireTracks: true, waterSplash: true, dustAmount: 3, dustEffects: true, sparkAmount: 2, sparks: true,
    ...GRAPHICS_FLAGS.max, glossyPaint: false, graphics: "custom", look: "enhanced",
    terrainDetail: true, hdWeather: true, reflections: true, cameraClearance: true,
  });
  return settings;
}
