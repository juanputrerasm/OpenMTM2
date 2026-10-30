import test from "node:test";
import assert from "node:assert/strict";
import { createReplaySound, replayRpm } from "../src/game/replay-sound.js";

test("replay sound: the engine speed as the drive turns it, idle at least, the throttle's share in Park", () => {
  // First gear (4): ratio 40.467, transfer 1.185, a 2.75 ft wheel at 20 ft/s.
  const expected = (1.185 * 40.467 * 20 * 60) / (2.75 * 2 * Math.PI);
  assert.ok(Math.abs(replayRpm(20, 4, 1, 2.75) - expected) < 1e-9);
  assert.equal(replayRpm(0, 4, 1, 2.75), 800);
  assert.equal(replayRpm(0, 1, 0.5, 2.75), 4250);
  assert.equal(replayRpm(500, 4, 1, 2.75), 8500);
});

test("replay sound: each truck's frame follows its engine smoothly and starts afresh after a jump", () => {
  const sound = createReplaySound([2.75, 2.75]);
  const truck = { speed: 20, gear: 4, throttle: 1 };
  const [first, none] = sound.frame([truck, null], 0.05);
  assert.equal(none, null);
  assert.ok(first.rpm > 800 && first.rpm < replayRpm(20, 4, 1, 2.75));
  assert.equal(first.gear, 4);
  sound.reset([truck]);
  assert.ok(Math.abs(sound.frame([truck], 0)[0].rpm - replayRpm(20, 4, 1, 2.75)) < 1e-9);
});

test("replay sound: the engine follows the body-forward speed, not the fall, and free-revs with every wheel in the air", () => {
  const sound = createReplaySound([2.75]);
  const falling = { speed: 60, forward: 10, gear: 4, throttle: 1 };
  sound.reset([falling]);
  assert.ok(Math.abs(sound.frame([falling], 0)[0].rpm - replayRpm(10, 4, 1, 2.75)) < 1e-9);
  const air = { tires: [0, 1, 2, 3].map(() => ({ onGround: false, surface: 200 })) };
  const frame = sound.frame([falling], 10, 0, [air])[0];
  assert.equal(frame.airborne, 4);
  assert.ok(Math.abs(frame.rpm - replayRpm(0, 0, 1, 2.75)) < 1);
});

test("replay sound: the frame carries the brakes, the tires, the water and a hard landing from what the picture shows", () => {
  const sound = createReplaySound([2.75]);
  const tires = [0, 1, 2, 3].map(() => ({ onGround: true, surface: 1100 }));
  const [frame] = sound.frame([{ speed: 20, forward: 20, gear: 4, throttle: 0, brake: 0.8 }], 0.016, 0, [{ tires, vy: -12, inWater: true, clearance: 3, impact: 1200 }]);
  assert.equal(frame.brake, 0.8);
  assert.equal(frame.airborne, 0);
  assert.equal(frame.tires, tires);
  assert.equal(frame.inWater, true);
  assert.equal(frame.vy, -12);
  assert.equal(frame.impact, 1200);
});
