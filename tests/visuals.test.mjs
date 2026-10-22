/*
  The switches of the port's own scenery (docs/VISUALS.md): each a setting, each in Options.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../src/app/settings.js";
import { VISUAL_OPTIONS, trackVisuals, visualSettings } from "../src/game/visuals.js";

/** The switches in the order Options lists them, and what `visualSettings` calls each. */
const VISUAL_KEYS = ["terrainSmoothing", "enhancedWater", "volumetricWeather", "rainPuddles", "snowCover", "groundDetail", "naturalLight", "glossyPaint", "lensEffects", "truckLamps", "richParticles", "replayEffects"];
const VISUAL_PARTS = ["smoothing", "water", "weather", "puddles", "snow", "detail", "light", "gloss", "lens", "lamps", "particles", "replay"];

test("every part of the scenery has a switch, off by default, that Options shows", () => {
  assert.deepEqual(VISUAL_OPTIONS.map((option) => option.key), VISUAL_KEYS);
  for (const option of VISUAL_OPTIONS) {
    assert.equal(DEFAULT_SETTINGS[option.key], false, option.key);
    assert.ok(option.label && option.hint);
  }
  assert.deepEqual(visualSettings(DEFAULT_SETTINGS), Object.fromEntries(VISUAL_PARTS.map((part) => [part, false])));
  // Settings saved before the switches existed have none of the keys: all off, the game's own picture.
  assert.deepEqual(visualSettings({}), visualSettings(DEFAULT_SETTINGS));
  const on = Object.fromEntries(VISUAL_OPTIONS.map((option) => [option.key, true]));
  assert.deepEqual(visualSettings(on), Object.fromEntries(VISUAL_PARTS.map((part) => [part, true])));
  // Custom is the only list of switches in Display's Enhanced graphics section, and it is this same list.
  const panel = readFileSync(new URL("../src/ui/options-panel.js", import.meta.url), "utf8");
  assert.match(panel, /el\("h3", \{\}, t\("Enhanced graphics"\)\)/);
  // A part with an amount (Volumetric weather) shows a slider in place of its switch.
  assert.match(panel, /choice === "custom"[\s\S]*VISUAL_OPTIONS\.map\(\(option\) => \(option\.amountKey \? slider\([\s\S]*?: toggle\(option\.label, option\.key, option\.hint\)\)\)/);
  assert.deepEqual(VISUAL_OPTIONS.filter((option) => option.amountKey).map((option) => option.key), ["volumetricWeather"]);
});

test("the track is built with what the switches ask for: the puddle map only where it may rain, the snow's depth only for a race in Snow", () => {
  const all = Object.fromEntries(VISUAL_OPTIONS.map((option) => [option.key, true]));
  // Rain is weather 4 and Snow 5; The Graveyard's mask 0x90 allows Rain and Night, Torture Pit's 1 only Clear.
  assert.deepEqual(trackVisuals(all, { weather: 0, weatherMask: 0x90 }), { smoothing: true, groundMap: true, puddles: true, snow: false, cover: true });
  assert.deepEqual(trackVisuals(all, { weather: 0, weatherMask: 1 }), { smoothing: true, groundMap: true, puddles: false, snow: false, cover: false });
  assert.equal(trackVisuals(all, { weather: 4, weatherMask: 0 }).puddles, true, "a replay recorded in Rain");
  assert.equal(trackVisuals({ ...all, rainPuddles: false }, { weather: 4, weatherMask: 0x90 }).puddles, false);
  // The snow's depth makes the mesh finer along the course: only a race that begins in Snow pays for it.
  assert.equal(trackVisuals(all, { weather: 5, weatherMask: 0xffff }).snow, true);
  assert.equal(trackVisuals(all, { weather: 0, weatherMask: 0xffff }).snow, false, "a track that allows Snow, raced in the clear");
  assert.equal(trackVisuals({ ...all, snowCover: false }, { weather: 5, weatherMask: 0xffff }).snow, false);
  // With everything off nothing extra is built, and the track comes as it always did.
  const off = Object.fromEntries(VISUAL_OPTIONS.map((option) => [option.key, false]));
  assert.deepEqual(trackVisuals(off, { weather: 4, weatherMask: 0xffff }), { smoothing: false, groundMap: false, puddles: false, snow: false, cover: false });
  assert.deepEqual(trackVisuals(off, { weather: 5, weatherMask: 0xffff }), { smoothing: false, groundMap: false, puddles: false, snow: false, cover: false });
  // The ground map serves the water, the weather and the puddles: any one of them asks for it.
  assert.equal(trackVisuals({ ...off, enhancedWater: true }, {}).groundMap, true);
  assert.equal(trackVisuals({ ...off, volumetricWeather: true }, {}).groundMap, true);
  assert.equal(trackVisuals({ ...off, rainPuddles: true }, { weather: 4 }).groundMap, true);
  assert.equal(trackVisuals({ ...off, snowCover: true }, { weather: 5 }).groundMap, false);
  // Snow cover alone, without the smoothed ground, still gets the snow's depth.
  assert.deepEqual(trackVisuals({ ...off, snowCover: true }, { weather: 5 }), { smoothing: false, groundMap: false, puddles: false, snow: true, cover: true });
  // What stands over the ground is mapped where rain or snow may fall, for whichever of the three draws them.
  assert.equal(trackVisuals(all, { weather: 4, weatherMask: 0 }).cover, true, "a replay recorded in Rain");
  assert.equal(trackVisuals(all, { weather: 0, weatherMask: 0x20 }).cover, true, "a track that allows Snow");
  for (const key of ["volumetricWeather", "rainPuddles", "snowCover"]) assert.equal(trackVisuals({ ...off, [key]: true }, { weather: 4 }).cover, true, key);
  assert.equal(trackVisuals({ ...off, terrainSmoothing: true, enhancedWater: true }, { weather: 4 }).cover, false);
});
