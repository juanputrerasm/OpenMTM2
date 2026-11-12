import test from "node:test";
import assert from "node:assert/strict";
import { forEachBoxPair } from "../src/worker/box-pairs.js";

// OpenPhotex collideBoxes returns at once unless the two bounding spheres overlap (MTM2_PHYSICS.md 14.21).
const overlap = (a, b) => (a.pos[0] - b.pos[0]) ** 2 + (a.pos[1] - b.pos[1]) ** 2 + (a.pos[2] - b.pos[2]) ** 2 < (a.radius + b.radius) ** 2;

function boxes(count, seed, spread = 3000) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, i) => {
    // Props of 1 to 4 ft, some buildings to 300 ft, a few merged areas to 3,000 ft (wider than the grid's limit).
    const k = rnd();
    const radius = k < 0.85 ? 1 + rnd() * 3 : k < 0.97 ? 20 + rnd() * 280 : 500 + rnd() * 2500;
    return { id: i, radius, pos: [rnd() * spread, rnd() * 40, rnd() * spread] };
  });
}

/** The pairs the step's full loops try that do anything (spheres overlapping), in their order. */
function fullLoops(moving, still) {
  const out = [];
  for (let i = 0; i < moving.length; i++) {
    for (let j = i + 1; j < moving.length; j++) if (overlap(moving[i], moving[j])) out.push([moving[i].id, moving[j].id]);
    for (const b of still) if (overlap(moving[i], b)) out.push([moving[i].id, b.id]);
  }
  return out;
}

test("the grid hands over every pair whose spheres overlap, in the full loops' order", () => {
  for (const seed of [3, 11, 2024, 77777]) {
    const all = boxes(1200, seed);
    const moving = all.filter((_, i) => i % 3 === 0), still = all.filter((_, i) => i % 3 !== 0);
    const got = [];
    forEachBoxPair(moving, still, (a, b) => { if (overlap(a, b)) got.push([a.id, b.id]); });
    assert.deepEqual(got, fullLoops(moving, still));
  }
});

test("a mover wider than the grid's limit is tried against every box, as before", () => {
  const moving = [{ id: 0, radius: 5000, pos: [0, 0, 0] }, { id: 1, radius: 2, pos: [9000, 0, 9000] }];
  const still = [{ id: 2, radius: 1, pos: [4000, 0, 0] }];
  const tried = [];
  forEachBoxPair(moving, still, (a, b) => tried.push([a.id, b.id]));
  assert.deepEqual(tried.slice(0, 2), [[0, 1], [0, 2]]);
});

test("no moving boxes, no pairs", () => {
  let n = 0;
  forEachBoxPair([], boxes(50, 5), () => n++);
  assert.equal(n, 0);
});
