import test from "node:test";
import assert from "node:assert/strict";
import { createFrameLimiter, limitIntervalMs } from "../src/render/frame-limit.js";

const drawnOver = (tickMs, intervalMs, seconds = 10) => {
  const limiter = createFrameLimiter();
  let drawn = 0;
  for (let now = 0; now < seconds * 1000; now += tickMs) if (limiter.take(now, intervalMs)) drawn++;
  return drawn / seconds;
};

test("the limit is off unless switched on", () => {
  assert.equal(limitIntervalMs({ fpsLimit: false, fpsLimitValue: 60 }), 0);
  assert.equal(limitIntervalMs({ fpsLimit: true, fpsLimitValue: 60 }), 1000 / 60);
  assert.equal(limitIntervalMs({ fpsLimit: true }), 1000 / 60);
});

test("a fast timer is held to the chosen rate", () => {
  // V-sync off: the timer wakes about every 4 ms.
  assert.ok(Math.abs(drawnOver(4, 1000 / 60) - 60) < 1.5);
  assert.ok(Math.abs(drawnOver(1, 1000 / 90) - 90) < 1.5);
});

test("60 on a 75 Hz display draws 60 frames a second, not 37.5", () => {
  assert.ok(Math.abs(drawnOver(1000 / 75, 1000 / 60) - 60) < 1.5);
});

test("a stall is not followed by a burst of frames", () => {
  const limiter = createFrameLimiter();
  assert.ok(limiter.take(0, 16));
  assert.ok(limiter.take(200, 16));
  assert.equal(limiter.take(204, 16), false);
  assert.ok(limiter.take(216, 16));
});
