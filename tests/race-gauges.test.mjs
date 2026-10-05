import test from "node:test";
import assert from "node:assert/strict";
import { gaugeAngle, gearLabel, mphFromFeetPerSecond } from "../src/render/race-gauges.js";

test("race gauges convert feet per second and clamp their sweep", () => {
  assert.equal(mphFromFeetPerSecond(88), 60);
  assert.equal(mphFromFeetPerSecond(-88), 60);
  assert.equal(gaugeAngle(-1, 110), gaugeAngle(0, 110));
  assert.equal(gaugeAngle(120, 110), gaugeAngle(110, 110));
});

test("race gear numbers use the HUD's P R N 1 2 3 labels", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(gearLabel), ["P", "R", "N", "1", "2", "3"]);
});
