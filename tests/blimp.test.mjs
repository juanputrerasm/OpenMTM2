import test from "node:test";
import assert from "node:assert/strict";
import { BLIMP_CLEARANCE_FT, BLIMP_SPEED_FT, createBlimp, hasBlimp } from "../src/game/blimp.js";

const straights = [{ startFt: [0, 0, 0] }, { startFt: [0, 0, 1000] }, { startFt: [1000, 0, 1000] }, { startFt: [1000, 0, 0] }];

test("the blimp is there on circuit and rally tracks at detail 2 or more", () => {
  assert.equal(hasBlimp({ detailLevel: 2, raceType: "circuit" }), true);
  assert.equal(hasBlimp({ detailLevel: 2, raceType: "rally" }), true);
  assert.equal(hasBlimp({ detailLevel: 1, raceType: "circuit" }), false);
  assert.equal(hasBlimp({ detailLevel: 2, raceType: "summit" }), false);
});

test("it starts over the first straight, 100 ft above the ground, and flies toward the second at 20 ft/s", () => {
  const blimp = createBlimp(straights, () => 50);
  assert.deepEqual(blimp.state.pos, [0, 50 + BLIMP_CLEARANCE_FT, 0]);
  for (let t = 0; t < 30; t += 1 / 30) blimp.update(1 / 30);
  const [x, y, z] = blimp.state.pos;
  assert.ok(z > 300 && z < 700, `z ${z}`);
  assert.ok(Math.abs(Math.hypot(blimp.state.vel[0], blimp.state.vel[2]) - BLIMP_SPEED_FT) < 1e-9);
  assert.ok(Math.abs(y - 150) < 1, "it holds 100 ft over flat ground");
  assert.ok(x < 60);
});

test("it climbs ahead of a hill and sinks slowly after it", () => {
  const hill = (x, z) => (z > 600 && z < 800 ? 300 : 0);
  const blimp = createBlimp(straights, hill);
  let highest = 0;
  for (let t = 0; t < 120; t += 1 / 30) { blimp.update(1 / 30); highest = Math.max(highest, blimp.state.pos[1]); }
  assert.ok(highest > 380, `rose to ${highest}`);
});

test("it moves on to the next straight when within 100 ft, and round to the first after the last", () => {
  const blimp = createBlimp(straights, () => 0);
  assert.equal(blimp.state.target, 1);
  blimp.state.pos = [0, 100, 950];
  blimp.update(1 / 30);
  assert.equal(blimp.state.target, 2);
  blimp.state.target = 3;
  blimp.state.pos = [1000, 100, 50];
  blimp.update(1 / 30);
  assert.equal(blimp.state.target, 0);
});
