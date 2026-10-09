import test from "node:test";
import assert from "node:assert/strict";
import { finderAngle, finderLinedUp, wheelFrame } from "../src/render/cockpit.js";

test("the wheel frame follows the steering in 5 degree steps, left negative, full lock 35", () => {
  assert.equal(wheelFrame(0), "C00");
  assert.equal(wheelFrame(0.01), "C00");
  assert.equal(wheelFrame(-0.45), "L35");
  assert.equal(wheelFrame(0.45), "R35");
  assert.equal(wheelFrame(0.9), "R35");
  assert.equal(wheelFrame(0.45 / 7), "R05");
});

test("the finder: a checkpoint ahead is 90 degrees, to the right 0, whatever the heading", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  near(finderAngle([0, 0, 0], 0, [0, 0, 100]), 90);
  near(finderAngle([0, 0, 0], 0, [100, 0, 0]), 0);
  near(finderAngle([0, 0, 0], Math.PI / 2, [100, 0, 0]), 90);
  near(finderAngle([0, 0, 0], 0, [-100, 0, 0]), 180);
  assert.ok(finderLinedUp(90) && finderLinedUp(70) && !finderLinedUp(60) && !finderLinedUp(120));
});
