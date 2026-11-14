/*
  The ground a party mode sets a truck down on (src/game/spawn-ground.js): the drivable surface, a ground box's deck, a
  road or mesh layer or a CP4 track's meshes, not the terrain under it; and Deathmatch's spawn spots on it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createSpawnGround } from "../src/game/spawn-ground.js";
import { terrainOfBuild } from "../src/shared/build-terrain.js";
import { SPAWN, spawnSpots } from "../src/game/extensions/deathmatch.js";
import { fillGrid } from "../src/game/race-setup.js";

const flatFt = (h) => Array.from({ length: 256 * 256 }, () => h);
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

/** A closed box's triangles, half sizes `h`, centred on the origin. */
function boxSoup(h) {
  const c = (x, y, z) => [x * h[0], y * h[1], z * h[2]];
  const quads = [
    [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)], [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)],
    [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)], [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
    [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)], [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
  ];
  return Float32Array.from(quads.flatMap(([a, b, d, e]) => [...a, ...b, ...d, ...a, ...d, ...e]));
}
const placed = (name, pos, half) => ({ positionFt: pos, theta: 0, phi: 0, psi: 0, mass: 0, type: 0, modelName: name, bounds: { min: half.map((v) => -v), max: half } });

test("on a track made for CP4: the street mesh, not the terrain under the city", () => {
  // A 400 ft street slab whose top is at 122 ft, over terrain at 100 ft.
  const build = {
    heightsFt: flatFt(100),
    sim: { cp4Track: true, collisionSoups: { DECK: { positions: boxSoup([20, 2, 200]) } }, boxes: [placed("DECK", [1000, 120, 1000], [20, 2, 200])] },
  };
  const ground = createSpawnGround(build, terrainOfBuild(build));
  assert.ok(near(ground(1000, 1000), 122), String(ground(1000, 1000)));
  assert.equal(ground(1100, 1000), 100, "off the street: the terrain");
  // A course point down on the terrain (a road under the deck) keeps to the terrain.
  assert.equal(ground(1000, 1000, 100), 100);
  assert.ok(near(ground(1000, 1000, 121), 122), "a course point on the deck");
  // The spawn spots along a course on the deck stand on it.
  const course = [{ startFt: [1000, 122, 820], endFt: [1000, 122, 1180] }];
  const spots = spawnSpots({ kind: "course", course, heightAt: ground });
  assert.ok(spots.length >= 2);
  for (const s of spots) assert.ok(near(s.pos[1], 122 + SPAWN.rideFt), JSON.stringify(s));
});

test("a level's ground boxes: the deck's top where one is", () => {
  const ra0 = new Uint8Array(256 * 256), ra1 = new Uint8Array(256 * 256);
  // Cell (col 31, row 31), x and z 992 to 1024: underside 30 ft, top 40 ft.
  ra0[31 * 256 + 31] = 15; ra1[31 * 256 + 31] = 20;
  const build = { heightsFt: flatFt(10), sim: { ra0, ra1 } };
  const ground = createSpawnGround(build, terrainOfBuild(build));
  assert.equal(ground(1000, 1000), 40);
  assert.equal(ground(900, 900), 10);
  assert.equal(ground(1000, 1000, 10), 10, "under the deck, from a course point under it");
  // The filled start grid round a slot on the deck is set on the deck.
  const grid = fillGrid([{ file: "", pos: [1000, 44, 1000], heading: 0 }], 2, ground);
  assert.equal(grid.length, 2);
});

test("a road or mesh layer (CPR's road, 4x4 Evolution's decks)", () => {
  // One flat triangle at 50 ft over terrain at 10.
  const positions = new Float32Array([0, 50, 0, 400, 50, 0, 0, 50, 400]);
  const build = { heightsFt: flatFt(10), sim: { meshGround: { positions, surfaceValues: new Int32Array([100]) } } };
  const ground = createSpawnGround(build, terrainOfBuild(build));
  assert.equal(ground(50, 50), 50);
  assert.equal(ground(390, 390), 10);
});

test("a plain terrain is the terrain", () => {
  const build = { heightsFt: flatFt(33), sim: {} };
  const ground = createSpawnGround(build, terrainOfBuild(build));
  assert.equal(ground(4000, 4000), 33);
  assert.equal(ground(4000, 4000, 500), 33);
});
