import test from "node:test";
import assert from "node:assert/strict";
import { gaugeAngle, gearLabel, mphFromFeetPerSecond } from "../src/render/race-gauges.js";

test("race gauges convert feet per second and clamp their sweep", () => {
  assert.equal(mphFromFeetPerSecond(88), 60);
  assert.equal(mphFromFeetPerSecond(-88), 60);
  assert.equal(gaugeAngle(-1, 214.5, 2.65, 110), gaugeAngle(0, 214.5, 2.65, 110));
  assert.equal(gaugeAngle(120, 214.5, 2.65, 110), gaugeAngle(110, 214.5, 2.65, 110));
});

test("race gear numbers use the HUD's P R N 1 2 3 labels", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(gearLabel), ["P", "R", "N", "1", "2", "3"]);
});

test("the speedometer reads in kph, with its own full scale", async () => {
  const { kphFromFeetPerSecond, SPEED_SCALE } = await import("../src/render/race-gauges.js");
  assert.ok(Math.abs(kphFromFeetPerSecond(88) - 96.56) < 0.01);
  assert.equal(kphFromFeetPerSecond(-88), kphFromFeetPerSecond(88));
  assert.ok(SPEED_SCALE.kph.max >= 110 * 1.609);
});

test("the dials sweep as the exe's: 0 mph at 214.5 degrees, 2.65 degrees per mph", () => {
  const deg = (r) => (r * 180) / Math.PI;
  assert.ok(Math.abs(deg(gaugeAngle(0, 214.5, 2.65)) - 214.5) < 1e-9);
  assert.ok(Math.abs(deg(gaugeAngle(50, 214.5, 2.65)) - 347) < 1e-9, "50 mph points just above straight right");
  assert.ok(Math.abs(deg(gaugeAngle(8000, 63, 0.0261)) - 271.8) < 1e-9, "8000 rpm points almost straight up");
});
