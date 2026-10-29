// Sound under water and the rain's two loops (MONSTER_EXE_ANALYSIS.md 12, "Under water" and "Rain").
import { test } from "node:test";
import assert from "node:assert/strict";
import { RAIN_GAIN, RAIN_ROOF_GAIN, UNDERWATER_MASTER, UNDERWATER_PITCH, rainJitter, rainOnRoof, roofGain, underwaterMix } from "../src/game/sound-model.js";

test("under water: a one-shot's volume and pitch by where it starts and is heard", () => {
  assert.deepEqual(underwaterMix(false, false), { gain: 1, rate: 1 });
  assert.deepEqual(underwaterMix(true, false), { gain: 1, rate: 0.9 });
  assert.deepEqual(underwaterMix(false, true), { gain: 0.2, rate: UNDERWATER_PITCH });
  assert.deepEqual(underwaterMix(true, true), { gain: 1.2, rate: UNDERWATER_PITCH });
  assert.equal(UNDERWATER_PITCH, 0.65);
  assert.equal(UNDERWATER_MASTER, 0.75);
});

test("rain: the roof drums only in the cockpit, in the rain, out in the open and above the water", () => {
  assert.equal(rainOnRoof({ weather: 4, cockpit: true, underwater: false, covered: false }), true);
  assert.equal(rainOnRoof({ weather: 4, cockpit: false, underwater: false, covered: false }), false);
  assert.equal(rainOnRoof({ weather: 4, cockpit: true, underwater: true, covered: false }), false);
  assert.equal(rainOnRoof({ weather: 4, cockpit: true, underwater: false, covered: true }), false);
  assert.equal(rainOnRoof({ weather: 5, cockpit: true, underwater: false, covered: false }), false);
  // The game's volumes, 0.25 and 0.7, kept in proportion to the port's rain loop.
  assert.equal(roofGain(RAIN_GAIN), RAIN_ROOF_GAIN);
  assert.equal(rainJitter(() => 0), 0.985);
  assert.equal(rainJitter(() => 0.5), 1);
});
