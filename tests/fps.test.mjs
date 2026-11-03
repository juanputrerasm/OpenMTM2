import test from "node:test";
import assert from "node:assert/strict";
import { createFpsTracker, formatFps } from "../src/game/fps.js";

test("the FPS tracker starts at 60 and holds a steady frame rate", () => {
  const tracker = createFpsTracker();
  assert.equal(Math.round(tracker.fps), 60);
  for (let i = 0; i < 200; i++) tracker.update(1 / 60);
  assert.ok(Math.abs(tracker.fps - 60) < 1);
});

test("the FPS tracker settles toward a new steady frame rate", () => {
  const tracker = createFpsTracker();
  for (let i = 0; i < 200; i++) tracker.update(1 / 30);
  assert.ok(Math.abs(tracker.fps - 30) < 1);
});

test("the FPS tracker ignores a missing or non-positive frame time", () => {
  const tracker = createFpsTracker();
  tracker.update(1 / 60);
  const before = tracker.fps;
  tracker.update(0);
  tracker.update(-1 / 60);
  assert.equal(tracker.fps, before);
});

test("the FPS text shows whole frames per second", () => {
  assert.equal(formatFps(59.6), "60 FPS");
  assert.equal(formatFps(29.4), "29 FPS");
});

test("the FPS tracker averages the kept window", () => {
  const tracker = createFpsTracker();
  for (let i = 0; i < 200; i++) tracker.update(1 / 60);
  assert.ok(Math.abs(tracker.average - 60) < 1);
  assert.ok(Math.abs(tracker.avgMs - 1000 / 60) < 0.5);
  assert.ok(Math.abs(tracker.low1 - 60) < 2);
});

test("the FPS 1% low reads the slowest frames as a rate", () => {
  const tracker = createFpsTracker();
  for (let i = 0; i < 198; i++) tracker.update(1 / 60);
  tracker.update(1 / 20);
  tracker.update(1 / 20);
  assert.ok(Math.abs(tracker.low1 - 20) < 1);
  assert.ok(tracker.average < 60 && tracker.average > tracker.low1);
  assert.ok(Math.abs(tracker.p95Ms - 1000 / 60) < 0.5);
  assert.equal(Math.round(tracker.worstMs), 50);
});

test("the FPS percentiles spot a single hitch", () => {
  const tracker = createFpsTracker();
  for (let i = 0; i < 99; i++) tracker.update(1 / 60);
  tracker.update(0.1);
  assert.ok(Math.abs(tracker.p99Ms - 1000 / 60) < 0.5);
  assert.equal(Math.round(tracker.worstMs), 100);
  assert.ok(Math.abs(tracker.low1 - 10) < 1);
});

test("the FPS tracker keeps a capped window of samples and resets it", () => {
  const tracker = createFpsTracker({ history: 10 });
  for (let i = 0; i < 20; i++) tracker.update(1 / 60 + i * 0.0001);
  assert.equal(tracker.count, 10);
  const samples = tracker.samples();
  assert.equal(samples.length, 10);
  assert.ok(samples[0] < samples[samples.length - 1]);
  samples.push(1);
  assert.equal(tracker.count, 10);
  const before = tracker.count;
  tracker.update(0);
  tracker.update(-1 / 60);
  assert.equal(tracker.count, before);
  tracker.reset();
  assert.equal(tracker.count, 0);
  assert.equal(tracker.samples().length, 0);
  assert.equal(Math.round(tracker.fps), 60);
});

test("uneven frames read at their true rate: the frame time is smoothed, not the rate", () => {
  const tracker = createFpsTracker();
  for (let i = 0; i < 400; i++) tracker.update(i % 2 ? 0.035 : 0.005);
  assert.ok(Math.abs(tracker.fps - 50) < 2, `read ${tracker.fps}`);
  assert.ok(Math.abs(tracker.average - 50) < 0.5);
});
