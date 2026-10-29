import test from "node:test";
import assert from "node:assert/strict";
import { createChaseCamera } from "../src/game/cameras.js";
import { SETTINGS_VERSION } from "../src/app/settings.js";

test("old saved settings move to the enhanced look and the listed hidden tracks once, and drop hidden trucks", async () => {
  const store = new Map([["openmtm2.settings", JSON.stringify({ look: "classic", showHiddenTracks: false, showHiddenTrucks: true, laps: 5 })]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const { loadSettings, saveSettings } = await import("../src/app/settings.js");
  const first = loadSettings();
  assert.equal(first.look, "enhanced");
  assert.equal(first.showHiddenTracks, true);
  assert.equal(first.laps, 5);
  assert.ok(!("showHiddenTrucks" in first));
  // A choice made after that sticks.
  saveSettings({ ...first, look: "classic", showHiddenTracks: false });
  const second = loadSettings();
  assert.equal(second.look, "classic");
  assert.equal(second.showHiddenTracks, false);
  delete globalThis.localStorage;
});

test("the track backdrops stay off by default, and a saved choice sticks", async () => {
  const store = new Map([["openmtm2.settings", JSON.stringify({ version: 5, backdrops: false, look: "classic" })]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import("../src/app/settings.js");
  assert.equal(DEFAULT_SETTINGS.backdrops, false);
  const first = loadSettings();
  assert.equal(first.backdrops, false);
  assert.equal(first.look, "classic", "what an earlier version settled is left alone");
  assert.equal(first.version, SETTINGS_VERSION);
  saveSettings({ ...first, backdrops: true });
  assert.equal(loadSettings().backdrops, true);
  delete globalThis.localStorage;
});

test("a save from before the scenery presets takes Off, and one that turned a part off stays Custom", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const { loadSettings } = await import("../src/app/settings.js");
  store.set("openmtm2.settings", JSON.stringify({ version: 6, aa: "taa", look: "classic" }));
  const plain = loadSettings();
  assert.equal(plain.graphics, "off");
  assert.equal(plain.version, SETTINGS_VERSION);
  assert.equal(plain.lensEffects, false);
  assert.equal(plain.aa, "taa");
  assert.equal(plain.look, "classic");
  store.set("openmtm2.settings", JSON.stringify({ version: 6, naturalLight: false, look: "classic" }));
  const custom = loadSettings();
  assert.equal(custom.graphics, "custom");
  assert.equal(custom.naturalLight, false);
  assert.equal(custom.look, "classic");
  store.set("openmtm2.settings", JSON.stringify({ version: 7, graphics: "low", lensEffects: true }));
  const kept = loadSettings();
  assert.equal(kept.graphics, "low");
  assert.equal(kept.lensEffects, true);
  store.set("openmtm2.settings", JSON.stringify({ version: 7, graphics: "dlss", aa: "msaa" }));
  assert.equal(loadSettings().graphics, "off");
  delete globalThis.localStorage;
});

test("the front views ease their heading for two seconds, then hold it rigidly", () => {
  const flat = () => -1000;
  const cam = createChaseCamera();
  cam.update(5, [0, 0, 0], 0, flat, 0.016);
  // A quick turn of the truck: while settling the camera lags, and after two seconds it is exact.
  const lagging = cam.update(5, [0, 0, 0], 1, flat, 0.016).position;
  const exact = createChaseCamera();
  exact.update(5, [0, 0, 0], 1, flat, 0.016);
  const target = exact.update(5, [0, 0, 0], 1, flat, 0.016).position;
  assert.ok(Math.hypot(lagging[0] - target[0], lagging[2] - target[2]) > 1);
  for (let t = 0; t < 2.2; t += 0.05) cam.update(5, [0, 0, 0], 1, flat, 0.05);
  const held = cam.update(5, [0, 0, 0], 2, flat, 0.016).position;
  const direct = createChaseCamera();
  direct.update(5, [0, 0, 0], 2, flat, 0.016);
  const rigid = direct.update(5, [0, 0, 0], 2, flat, 0.016).position;
  near(held, rigid);
});

function near(a, b) { assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) < 1e-6, `${a} vs ${b}`); }

test("the water bobs a quarter foot over eight seconds, is frozen in Snow, and fogs a camera under it", async () => {
  const { waterOffsetFt, isUnderwater, UNDERWATER_FOG_FT } = await import("../src/game/weather.js");
  assert.equal(waterOffsetFt(0, 0), 0);
  assert.ok(Math.abs(waterOffsetFt(2, 0) - 0.25) < 1e-9);
  assert.ok(Math.abs(waterOffsetFt(6, 0) + 0.25) < 1e-9);
  assert.ok(Math.abs(waterOffsetFt(8, 0)) < 1e-9);
  assert.equal(waterOffsetFt(2, 5), 0);
  assert.equal(UNDERWATER_FOG_FT, 320);
  assert.equal(isUnderwater(10, 12, 0), true);
  assert.equal(isUnderwater(10, 12, 5), false);
  assert.equal(isUnderwater(13, 12, 0), false);
  assert.equal(isUnderwater(0, null, 0), false);
});

test("the water frames ping-pong over fourteen quarter-second steps, with the weather's translucency", async () => {
  const w = await import("../src/game/weather.js");
  assert.deepEqual(w.WATER_FRAME_SEQUENCE.map((i) => i + 1), [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal(w.WATER_FRAME_SECONDS, 0.25);
  assert.equal(w.waterFrameStep(0.3), 1);
  assert.equal(w.waterFrameStep(14 * 0.25 + 0.01), 0);
  assert.deepEqual([0, 4, 5, 6, 7, 8].map(w.waterOpacity), [0.75, 0.5, 0.9375, 0.25, 0.25, 0.0625]);
});

test("an exported options file reads back, older ones brought up to date, and anything else is refused", async () => {
  const { OPTIONS_FILE_FORMAT, SETTINGS_VERSION, optionsFile, readOptionsFile } = await import("../src/app/settings.js");
  const file = optionsFile({ look: "classic", aiNames: ["Zed"], aa: "fxaa" }, new Date("2026-10-14T00:00:00Z"));
  assert.deepEqual(Object.keys(file), ["format", "version", "exported", "settings"]);
  assert.equal(file.format, OPTIONS_FILE_FORMAT);
  assert.equal(file.version, SETTINGS_VERSION);
  const back = readOptionsFile(JSON.stringify(file)).settings;
  assert.equal(back.look, "classic");
  assert.deepEqual(back.aiNames, ["Zed"]);
  assert.equal(back.aa, "fxaa");
  assert.equal(back.version, SETTINGS_VERSION);
  assert.equal(back.graphics, "off", "what the file does not hold takes the default");
  // A version 4 file: the draw distance in feet is dropped, as for a stored one.
  assert.equal(readOptionsFile(JSON.stringify({ format: OPTIONS_FILE_FORMAT, version: 4, settings: { drawDistance: 900 } })).settings.drawDistance, undefined);
  assert.match(readOptionsFile("not json").error, /not JSON/);
  assert.match(readOptionsFile(JSON.stringify({ look: "classic" })).error, /not an OpenMTM2 settings file/);
  assert.match(readOptionsFile(JSON.stringify({ format: OPTIONS_FILE_FORMAT, version: SETTINGS_VERSION + 1, settings: {} })).error, /newer/);
});

test("version 8 keeps MTM1's trucks apart by default, over the off an older save carried", async () => {
  const { migrateSettings } = await import("../src/app/settings.js");
  assert.equal(migrateSettings({ version: 7, mtm1TrucksApart: false }).mtm1TrucksApart, true);
  assert.equal(migrateSettings({ version: 8, mtm1TrucksApart: false }).mtm1TrucksApart, false);
  // Version 12: the old default physics becomes the vehicle's own; a choice saved since stays.
  assert.equal(migrateSettings({ version: 11, physics: "mtm2" }).physics, "auto");
  assert.equal(migrateSettings({ version: 12, physics: "mtm2" }).physics, "mtm2");
  assert.equal(migrateSettings({ version: 11, physics: "evo2" }).physics, "evo2");
});

test("version 13 starts races in Chase Far and leaves the ground boxes' grain off, over the old defaults an older save carried", async () => {
  const { DEFAULT_SETTINGS, migrateSettings } = await import("../src/app/settings.js");
  assert.equal(DEFAULT_SETTINGS.view, 2, "Chase Far");
  assert.equal(DEFAULT_SETTINGS.groundBoxGrain, false);
  const old = migrateSettings({ version: 12, view: 1, groundBoxGrain: true });
  assert.equal(old.view ?? DEFAULT_SETTINGS.view, 2, "the old default Chase Near gives way to the new one");
  assert.equal(old.groundBoxGrain ?? DEFAULT_SETTINGS.groundBoxGrain, false);
  assert.equal(migrateSettings({ version: 12, view: 3 }).view, 3, "another view was a choice");
  assert.equal(migrateSettings({ version: 13, view: 1, groundBoxGrain: true }).groundBoxGrain, true);
  assert.equal(DEFAULT_SETTINGS.cprSkill, "rookie");
  assert.equal(DEFAULT_SETTINGS.freeLook, true);
});

test("the MTM1 Classic preset turns every MTM1 choice and the backdrops on, dust and sparks off, the 1996 physics, smooth textures and the enhanced graphics off", async () => {
  const { applyMtm1Classic } = await import("../src/app/settings.js");
  const settings = applyMtm1Classic({ graphics: "max", physics: "mtm2", look: "classic", backdrops: false, sparks: true, sparkAmount: 3, dustEffects: true, dustAmount: 3 });
  for (const key of ["mtm1EarthSky", "mtm1TrucksApart", "originalBackdrops", "mtm1Particles", "mtm1Sounds", "backdrops"]) assert.equal(settings[key], true, key);
  for (const key of ["sparks", "dustEffects"]) assert.equal(settings[key], false, key);
  assert.equal(settings.sparkAmount, 0);
  assert.equal(settings.dustAmount, 0);
  assert.equal(settings.look, "enhanced");
  assert.equal(settings.terrainOverlap, false);
  assert.equal(settings.physics, "mtm1");
  assert.equal(settings.graphics, "off");
});

test("version 9 turns MTM2's water and truck reflections off and makes MTM1's sky one for every track, off, over older saves", async () => {
  const { DEFAULT_SETTINGS, migrateSettings } = await import("../src/app/settings.js");
  assert.equal(DEFAULT_SETTINGS.waterReflections, false);
  assert.equal(DEFAULT_SETTINGS.truckReflections, false);
  assert.equal(DEFAULT_SETTINGS.mtm1EarthSky, false);
  const old = migrateSettings({ version: 8, waterReflections: true, truckReflections: true, mtm1EarthSky: true });
  assert.deepEqual([old.waterReflections, old.truckReflections, old.mtm1EarthSky], [false, false, false]);
  const kept = migrateSettings({ version: 9, waterReflections: true, truckReflections: true, mtm1EarthSky: true });
  assert.deepEqual([kept.waterReflections, kept.truckReflections, kept.mtm1EarthSky], [true, true, true]);
});

test("the MTM2 Classic preset: no MTM1 choice, the 1998 game's own picture and none of the patch's weather or reflections", async () => {
  const { applyMtm1Classic, applyMtm2Classic } = await import("../src/app/settings.js");
  const settings = applyMtm2Classic(applyMtm1Classic({ graphics: "max", sparks: true, sparkAmount: 3, waterSplash: true, reflections: true, hdWeather: true }));
  for (const key of ["mtm1EarthSky", "mtm1TrucksApart", "mtm1Particles", "mtm1Sounds", "hdWeather", "reflections", "waterSplash", "sparks"]) assert.equal(settings[key], false, key);
  for (const key of ["originalBackdrops", "greyDust", "waterReflections", "truckReflections", "backdrops", "dustEffects"]) assert.equal(settings[key], true, key);
  assert.equal(settings.terrainOverlap, true);
  assert.equal(settings.physics, "mtm2");
  assert.equal(settings.sparkAmount, 0);
  assert.equal(settings.graphics, "off");
});

test("the OpenMTM2 preset: no MTM1 or MTM2 choice, the port's effects with normal dust, every enhanced part with the glossy paint, and the patch's extras", async () => {
  const { applyMtm1Classic, applyOpenMtm2 } = await import("../src/app/settings.js");
  const { VISUAL_OPTIONS } = await import("../src/game/visuals.js");
  const settings = applyOpenMtm2(applyMtm1Classic({ waterReflections: true, truckReflections: true, greyDust: true }));
  for (const key of ["mtm1EarthSky", "mtm1Particles", "mtm1Sounds", "originalBackdrops", "greyDust", "waterReflections", "truckReflections"]) assert.equal(settings[key], false, key);
  for (const key of ["tireTracks", "waterSplash", "terrainDetail", "hdWeather", "reflections", "backdrops"]) assert.equal(settings[key], true, key);
  assert.equal(settings.physics, "auto");
  assert.equal(settings.dustAmount, 2);
  assert.equal(settings.sparkAmount, 2);
  assert.equal(settings.graphics, "max");
  for (const option of VISUAL_OPTIONS) assert.equal(settings[option.key], true, option.key);
  assert.equal(applyOpenMtm2({ groundBoxGrain: true }).groundBoxGrain, false, "the ground boxes keep their textures plain");
});

test("version 10 keeps the chase camera clear of the ground by default, over older saves, and every preset turns it on", async () => {
  const { DEFAULT_SETTINGS, applyMtm1Classic, applyMtm2Classic, applyOpenMtm2, migrateSettings } = await import("../src/app/settings.js");
  assert.equal(DEFAULT_SETTINGS.cameraClearance, true);
  assert.equal(migrateSettings({ version: 9, cameraClearance: false }).cameraClearance, true);
  assert.equal(migrateSettings({ version: 10, cameraClearance: false }).cameraClearance, false);
  for (const apply of [applyMtm1Classic, applyMtm2Classic, applyOpenMtm2]) assert.equal(apply({ cameraClearance: false }).cameraClearance, true, apply.name);
});

test("the Volumetric weather slider: Default where a preset turns it on, None where it is off", async () => {
  const { DEFAULT_SETTINGS, applyOpenMtm2 } = await import("../src/app/settings.js");
  const { GRAPHICS_FLAGS } = await import("../src/game/graphics.js");
  const { weatherLevel } = await import("../src/game/atmosphere.js");
  assert.equal(weatherLevel(DEFAULT_SETTINGS), 0);
  assert.equal(weatherLevel({ ...DEFAULT_SETTINGS, volumetricWeather: true }), 2);
  for (const tier of ["high", "max"]) assert.equal(GRAPHICS_FLAGS[tier].weatherAmount, 2, tier);
  for (const tier of ["off", "low"]) assert.equal(GRAPHICS_FLAGS[tier].weatherAmount, 0, tier);
  assert.equal(weatherLevel(applyOpenMtm2({})), 2);
});

test("version 11 moves shipped mode settings into extension-owned panels", async () => {
  const { migrateSettings } = await import("../src/app/settings.js");
  const moved = migrateSettings({ version: 10, hockeyGoals: 7, tagMinutes: 12 });
  assert.deepEqual(moved.extensions.hockey, { goals: 7, minutes: 10, suddenDeath: true });
  assert.deepEqual(moved.extensions.tag, { rules: "openmtm2", minutes: 12, proximity: true, zoneFt: 400, nearPoints: 1, farPoints: 5, itDrain: 1 });
  assert.ok(!("hockeyGoals" in moved));
  assert.ok(!("tagMinutes" in moved));
});
