/*
  4x4 Evolution 2's computer drivers (game/evo-driver.js, EVO2_EXE_ANALYSIS.md 12).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { EVO_AI, bandFactor, bandLevel, createEvoDriver, evoAiLine, evoDriveStep } from "../src/game/evo-driver.js";

/** A circle of 100 points, radius 500 ft, driven at 80 ft/s. */
const ring = () => {
  const points = [], speeds = [];
  for (let i = 0; i < 105; i++) { const a = (i / 100) * Math.PI * 2; points.push([Math.sin(a) * 500, 0, Math.cos(a) * 500]); speeds.push(80); }
  return evoAiLine({ points, speeds });
};

test("the line drops its last five points and keeps each point's speed", () => {
  const line = ring();
  assert.equal(line.points.length, 100);
  assert.equal(line.speeds[3], 80);
  assert.ok(line.turn[10] > 3 && line.turn[10] < 4, "a 100-point circle turns 3.6 degrees a point");
});

test("the rubber band: the base close by, slower far ahead, faster far behind, at most 0.1 a second", () => {
  const b = bandLevel(2);
  assert.equal(b.base, 1.0);
  assert.equal(bandFactor(2, 3 * 15, 15), 1.0);
  assert.ok(Math.abs(bandFactor(2, -3 * 15, 15) - 1.1) < 1e-12, "x 1.1 behind, within 5 lengths");
  assert.ok(Math.abs(bandFactor(2, 20 * 15, 15) - b.lowest) < 1e-12);
  assert.ok(Math.abs(bandFactor(2, -10 * 15, 15) - b.highest) < 1e-12);
});

test("a driver steers toward the line ahead (at most 15 degrees for full lock), flat out under the line's speed", () => {
  const line = ring(), d = createEvoDriver(line, 2);
  const p = line.points[0];
  // Heading along the circle's tangent at the first point, slow: full throttle and a turn the circle's way.
  const out = evoDriveStep(d, { pos: [p[0], 0, p[2]], heading: Math.PI / 2, speed: 20, allDown: true },
    { weather: null, humans: [], others: [], lengthFt: 15, rearSteerFactor: 0 }, 1 / 60);
  assert.ok(out.throttle > 0);
  assert.ok(Math.abs(out.steer) <= EVO_AI.steerAngle);
  assert.equal(out.rearSteer, -0 * out.steer);
  assert.equal(out.warp, null);
});
