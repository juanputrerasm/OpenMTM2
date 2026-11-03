// 4x4 Evolution's tire particles (game/evo-particles.js) and falling trees (game/falling-trees.js): the rules read from
// the executable (docs/EVO2_EXE_ANALYSIS.md 2.5, 5).

import test from "node:test";
import assert from "node:assert/strict";
import { KIND, burstCount, burstStrength, createTireGates, particleKind, particleScale, stepGates } from "../src/game/evo-particles.js";
import { LEAN_MAX, createLean, ease, stepLean, touchLean } from "../src/game/falling-trees.js";

test("the kind a surface throws: Cement none, Gravel, Grass one time in 7, Sand, Mud, Snow, else dirt", () => {
  assert.equal(particleKind(1), null);
  assert.equal(particleKind(7), KIND.GRAVEL);
  assert.equal(particleKind(5), KIND.SAND);
  assert.equal(particleKind(4), KIND.MUD);
  assert.equal(particleKind(9), KIND.SNOW);
  assert.equal(particleKind(2), KIND.DIRT);
  assert.equal(particleKind(6, () => 0), KIND.GRASS);
  assert.equal(particleKind(6, () => 0.5), KIND.DIRT);
});

test("half as many again on mud, sand and snow; strength min(1, wheelspin * 3 / 100)", () => {
  assert.equal(burstCount(KIND.MUD), Math.round(burstCount(KIND.DIRT) * 1.5));
  assert.equal(burstCount(KIND.SNOW), burstCount(KIND.SAND));
  assert.equal(burstStrength(10, 0), 0.3);
  assert.equal(burstStrength(50, 0), 1);
  // Without a wheelspin value (MTM physics), the sideways speed.
  assert.equal(burstStrength(0, 10), 0.3);
});

test("sizes by kind", () => {
  assert.equal(particleScale(KIND.MUD, () => 0), 0.15);
  assert.equal(particleScale(KIND.SNOW, () => 1), 0.4);
  assert.equal(particleScale(KIND.SAND, () => 0), 0.25);
});

test("the gates: wheelspin past 3 rad/s with some wheelspin, any sliding; each re-armed after it fires", () => {
  const gates = createTireGates(() => 0.5); // re-armed at 0.1 s
  assert.deepEqual(stepGates(gates, 0.05, { spin: 10, slip: 5, vLat: 0 }, () => 0.5), { spin: false, slide: false });
  assert.deepEqual(stepGates(gates, 0.06, { spin: 10, slip: 5, vLat: 0 }, () => 0.5), { spin: true, slide: false });
  assert.deepEqual(stepGates(gates, 0.2, { spin: 2, slip: 5, vLat: 1 }, () => 0.5), { spin: false, slide: true });
  assert.deepEqual(stepGates(gates, 0.2, { spin: 10, slip: 0, vLat: 0 }, () => 0.5), { spin: false, slide: false });
});

test("a touched tree leans away from the truck by the game's rule and springs back upright (0x5461e0)", () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const lean = createLean("t1", identity, [100, 0, 200]);
  // At 44 ft/s or more the lean heads for 10 degrees, at 7 of the rest a second.
  for (let i = 0; i < 120; i++) { touchLean(lean, [60, 0]); stepLean(lean, 1 / 60); }
  assert.ok(Math.abs(lean.angle - LEAN_MAX) < 0.01);
  assert.equal(LEAN_MAX.toFixed(4), "0.1745");
  // Half that speed, half the lean.
  const slow = createLean("t2", identity, [0, 0, 0]);
  for (let i = 0; i < 240; i++) { touchLean(slow, [22, 0]); stepLean(slow, 1 / 60); }
  assert.ok(Math.abs(slow.angle - LEAN_MAX / 2) < 0.01);
  // Let go, it rights itself at 3 a second and is done under a degree.
  let m = null;
  for (let i = 0; i < 600 && !lean.done; i++) m = stepLean(lean, 1 / 60) ?? m;
  assert.ok(lean.done);
  assert.deepEqual(m, identity, "back exactly as it stood");
  assert.equal(stepLean(lean, 1 / 60), null);
  assert.equal(ease(1, 7, 0, 1), 1, "a step of a whole rate or more lands on the target");
});
