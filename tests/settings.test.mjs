import test from "node:test";
import assert from "node:assert/strict";
import { createChaseCamera } from "../src/game/cameras.js";

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
