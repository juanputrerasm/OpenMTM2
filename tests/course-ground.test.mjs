/*
  The autopilot's ground on a track built of meshes (game/course-ground.js; OpenMTM2's rule, not the game's): the
  drivable surface at the course's own height, never under the terrain.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createCourseGround } from "../src/game/course-ground.js";
import * as S from "../src/vendor/openphotex/sim/mtm2/index.js";

/** A deck 40 ft wide at `deckY` along x from 0 to 1000 (z -20 to 20), over terrain at `terrainY`. */
function deckWorld(deckY, terrainY = 0) {
  const terrain = () => terrainY;
  const surfaceBelow = (x, y, z, depth) => {
    const onDeck = x >= 0 && x <= 1000 && Math.abs(z) <= 20 && deckY <= y;
    const mesh = onDeck ? deckY : -Infinity;
    const ground = terrainY <= y ? terrainY : -Infinity;
    const h = Math.max(mesh, ground);
    return h >= y - depth ? h : null;
  };
  return { terrain, surfaceBelow };
}

const straight = (a, b) => ({ startFt: a, endFt: b });

test("a road high over the terrain reads the road, not the terrain under it", () => {
  const { terrain, surfaceBelow } = deckWorld(1500);
  const g = createCourseGround({ straightsLists: [[straight([0, 1500, 0], [1000, 1500, 0])]], surfaceBelow, terrain });
  assert.equal(g(500, 0), 1500);
  assert.equal(g(500, 15), 1500);
});

test("over open air near the course (an arc's centre) the course's own height is read", () => {
  const { terrain, surfaceBelow } = deckWorld(1500);
  const g = createCourseGround({ straightsLists: [[straight([0, 1500, 0], [1000, 1500, 0])]], surfaceBelow, terrain });
  assert.equal(g(500, 120), 1500);
});

test("the reference height runs along the nearest straight", () => {
  const terrain = () => 0;
  const g = createCourseGround({ straightsLists: [[straight([0, 1000, 0], [1000, 2000, 0])]], surfaceBelow: () => null, terrain });
  assert.equal(g(250, 50), 1250);
  assert.equal(g(-100, 0), 1000);
});

test("never under the terrain: a course drawn under the ground reads the ground, as before", () => {
  const g = createCourseGround({ straightsLists: [[straight([0, 0, 0], [1000, 0, 0])]], surfaceBelow: () => null, terrain: () => 50 });
  assert.equal(g(500, 0), 50);
});

test("a course on the ground under a bridge reads the ground, not the deck over it", () => {
  const { terrain, surfaceBelow } = deckWorld(100, 0);
  const g = createCourseGround({ straightsLists: [[straight([500, 0, -500], [500, 0, 500])]], surfaceBelow, terrain });
  assert.equal(g(500, 0), 0);
});

test("no course, no course ground", () => {
  assert.equal(createCourseGround({ straightsLists: [[], undefined], surfaceBelow: () => null, terrain: () => 0 }), null);
});

test("a sky course's arcs are built at the road's height, with their own corner speed", () => {
  const Y = 1500;
  const terrain = () => 0;
  // A square of straights 1000 ft a side at Y; the road is everywhere within 40 ft of the square's edges.
  const pts = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
  const straights = pts.map((p, i) => {
    const q = pts[(i + 1) % 4];
    const a = [p[0] + (q[0] - p[0]) * 0.2, Y, p[1] + (q[1] - p[1]) * 0.2], b = [p[0] + (q[0] - p[0]) * 0.8, Y, p[1] + (q[1] - p[1]) * 0.8];
    return { ctype: 1, cspeedType: 0, startFt: a, endFt: b, cdecPoint: 30, cspeed: 0, trackWidthFt: 32 };
  });
  const surfaceBelow = (x, y, z, depth) => {
    const nearEdge = Math.min(Math.abs(x), Math.abs(x - 1000), Math.abs(z), Math.abs(z - 1000)) <= 40 || (x > 0 && x < 1000 && z > 0 && z < 1000 && Math.min(x, 1000 - x, z, 1000 - z) <= 250);
    const h = Math.max(nearEdge && Y <= y ? Y : -Infinity, 0 <= y ? 0 : -Infinity);
    return h >= y - depth ? h : null;
  };
  const g = createCourseGround({ straightsLists: [straights], surfaceBelow, terrain });
  const course = S.buildCourse(straights, g, {});
  const arcs = course.filter((s) => S.isArc(s));
  assert.equal(arcs.length, 4);
  for (const a of arcs) {
    assert.equal(a.centre[1], Y, "the arc's centre is at the road's height");
    assert.ok(Math.abs(a.bank) < 1e-9, "a flat road gives a flat arc");
  }
  // The terrain alone puts the centres 1,500 ft under the road (what the trucks drove by before).
  const old = S.buildCourse(straights, terrain, {}).filter((s) => S.isArc(s));
  assert.equal(old[0].centre[1], 0);
});
