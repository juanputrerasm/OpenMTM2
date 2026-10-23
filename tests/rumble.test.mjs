import test from "node:test";
import assert from "node:assert/strict";
import {
  RUMBLE_LEVELS, createRumble, engineRumble, joltSize, objectKnock, shakeOn, shakeSurface, surfaceCode, wheelKnock,
} from "../src/game/input/rumble.js";

const ground = (surface, load = 2500) => ({ onGround: true, surface, force: [0, load, 0] });
const close = (a, b) => Math.abs(a - b) < 1e-9;

test("force feedback: the jolt is F * 6.25e-5 plus the bottoming's dv / dt * 0.02, at the game's 30 frames", () => {
  assert.equal(joltSize(16000, 0), 1);
  assert.ok(close(joltSize(0, 1), 0.6));
});

test("rumble: a wheel's knock past the suspension's dead band, and an object's hit", () => {
  assert.equal(wheelKnock(1500), 0);
  assert.ok(close(wheelKnock(10000), 0.5));
  assert.ok(close(objectKnock(10), 0.3));
});

test("force feedback: the surface with the most weight shakes, 30 for 1100, 40 for 1400, a tire in the air 1300", () => {
  assert.equal(surfaceCode(734), 700);
  assert.equal(shakeSurface([ground(200), ground(200), ground(1100), { onGround: false }]), 1100);
  assert.equal(shakeSurface([ground(1100), ground(1400)]), 1400);
  assert.equal(shakeSurface([ground(200), { onGround: false }, { onGround: false }, { onGround: false }]), 1300);
});

test("force feedback: shake sizes, frequencies and the still surfaces", () => {
  const half = () => 0.5;
  const dirt = shakeOn(200, 40, 1, half);
  assert.ok(close(dirt.size, Math.hypot(0.4, 0.4)));
  assert.equal(dirt.hz, 3);
  assert.equal(shakeOn(200, 400, 1, half).hz, 7);
  assert.ok(close(shakeOn(1100, 2, 1, half).size, 0.15));
  for (const code of [300, 500, 800, 1300]) assert.equal(shakeOn(code, 40, 1, half), null);
  assert.ok(close(shakeOn(1000, 40, 1, half).size, Math.hypot(0.075, 0.075)));
});

test("rumble: the engine idles softly and rises with its speed", () => {
  assert.ok(close(engineRumble(800), 0.09));
  assert.ok(close(engineRumble(8500), 0.29));
});

test("rumble: a hit fades over 0.5 s on the strong motor, and each level adds its effects", () => {
  const rumble = createRumble({ rand: () => 0.5 });
  const still = { impact: 0, tires: [ground(100)], vx: 0, vz: 0, rpm: 800 };
  assert.equal(rumble.update(still, 0.05, 1, RUMBLE_LEVELS.HITS).strong, 0);
  const hit = rumble.update({ ...still, impact: 8000 }, 0.1, 1, RUMBLE_LEVELS.HITS);
  assert.ok(close(hit.hit, 0.5 * 0.4 / 0.5));
  assert.equal(hit.lastHit.impact, 8000);
  assert.equal(rumble.update(still, 0.5, 1, RUMBLE_LEVELS.HITS).strong, 0);
  // Ground: dirt shakes both motors; Engine: the engine under it.
  const driving = { ...still, tires: [ground(200)], vz: 40 };
  const onDirt = rumble.update(driving, 0.05, 1, RUMBLE_LEVELS.GROUND);
  assert.ok(onDirt.weak > 0 && onDirt.surface === 200);
  const all = rumble.update({ ...driving, tires: [{ onGround: false }] }, 0.05, 1, RUMBLE_LEVELS.ENGINE);
  assert.ok(close(all.strong, 0.09) && all.weak === 0);
});

test("rumble: a wheel's load jumping is a hit", () => {
  const rumble = createRumble({ rand: () => 0.5 });
  const at = (load) => ({ tires: [ground(100, load)], vx: 0, vz: 0 });
  rumble.update(at(2500), 0.05, 1, RUMBLE_LEVELS.HITS);
  const knock = rumble.update(at(12500), 0.05, 1, RUMBLE_LEVELS.HITS);
  assert.equal(knock.lastHit.wheels, 10000);
  assert.ok(knock.hit > 0);
});
