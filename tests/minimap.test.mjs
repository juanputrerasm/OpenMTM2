import test from "node:test";
import assert from "node:assert/strict";
import { courseLoop, edgeOffsets, toMapFrame, MAP_HALF_WIDTH_FT } from "../src/render/minimap.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("the map's loop is each straight's start then end, in course order", () => {
  const course = [
    { ctype: 1, startFt: [0, 0, 0], endFt: [100, 5, 0] },
    { ctype: 1, startFt: [120, 0, 20], endFt: [120, 0, 100] },
  ];
  assert.deepEqual(courseLoop(course), [[0, 0], [100, 0], [120, 20], [120, 100]]);
});

test("each corner's offset is the bisector of its two edges, 48 ft long", () => {
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const offsets = edgeOffsets(square);
  offsets.forEach((o) => near(Math.hypot(o[0], o[1]), MAP_HALF_WIDTH_FT, 1e-6));
  near(Math.abs(offsets[0][0]), MAP_HALF_WIDTH_FT * Math.SQRT1_2, 1e-6);
});

test("the offsets stay on one side of the path through an S bend, so the two outlines never cross", () => {
  const s = [[0, 0], [100, 0], [200, 50], [300, 50], [400, 0], [500, 0]];
  const offsets = edgeOffsets(s);
  const side = (i) => {
    const a = s[(i + s.length - 1) % s.length], b = s[(i + 1) % s.length];
    const along = [b[0] - a[0], b[1] - a[1]];
    return Math.sign(along[0] * offsets[i][1] - along[1] * offsets[i][0]);
  };
  const sides = [1, 2, 3, 4].map(side);
  assert.ok(sides.every((x) => x === sides[0]), sides.join());
});

test("an almost straight run offsets along the path's normal", () => {
  const o = edgeOffsets([[0, 0], [100, 0], [200, 0], [300, 1000]])[1];
  near(Math.hypot(o[0], o[1]), MAP_HALF_WIDTH_FT, 1e-6);
});

test("the map turns with the truck so that its heading is up", () => {
  const [r, u] = toMapFrame(0, 100, 0, 0, 0);
  near(r, 0); near(u, 100);
  // Facing +x (psi = pi/2): a point ahead along +x is straight up, one on +z is to the left.
  const ahead = toMapFrame(100, 0, 0, 0, Math.PI / 2);
  near(ahead[0], 0); near(ahead[1], 100);
  const side = toMapFrame(0, 100, 0, 0, Math.PI / 2);
  near(side[0], -100); near(side[1], 0);
});

test("a Rumble's map takes a track build's checkpoint gates (position, full size) as well as simulation boxes", async () => {
  const { boxCorners } = await import("../src/render/minimap.js");
  const gate = { position: [100, 50, 200], size: [40, 10, 20], angles: [0, 0, 0] };
  assert.deepEqual(boxCorners(gate), [[80, 190], [120, 190], [120, 210], [80, 210]]);
  assert.deepEqual(boxCorners({ pos: [100, 50, 200], half: [20, 5, 10] }), boxCorners(gate));
});

test("Map line thickness: 0.25x to 1.75x the game's line, 1x (the middle) for anything unreadable", async () => {
  const { mapLineScale, MAP_LINE_MIN, MAP_LINE_MAX } = await import("../src/render/minimap.js");
  assert.equal(mapLineScale(undefined), 1);
  assert.equal(mapLineScale("x"), 1);
  assert.equal(mapLineScale(0.5), 0.5);
  assert.equal(mapLineScale(0), MAP_LINE_MIN);
  assert.equal(mapLineScale(99), MAP_LINE_MAX);
  assert.equal((MAP_LINE_MIN + MAP_LINE_MAX) / 2, 1);
});

test("the map's transparency is 0 (solid, the game's) by default and held to its range", async () => {
  const { mapTransparency, MAP_TRANSPARENCY_MAX } = await import("../src/render/minimap.js");
  assert.equal(mapTransparency(undefined), 0);
  assert.equal(mapTransparency("x"), 0);
  assert.equal(mapTransparency(0.4), 0.4);
  assert.equal(mapTransparency(-1), 0);
  assert.equal(mapTransparency(5), MAP_TRANSPARENCY_MAX);
});

test("beta 0.53's fold: a difference across the world edge is the short way, in [-4096, 4096)", async () => {
  const { mapWrap } = await import("../src/render/minimap.js");
  assert.equal(mapWrap(100), 100);
  assert.equal(mapWrap(8000), -192);
  assert.equal(mapWrap(-8000), 192);
  assert.equal(mapWrap(4096), -4096);
  assert.equal(mapWrap(-4096), -4096);
});

test("a course across the world edge unwraps point by point, so its loop never spans the world", () => {
  const course = [
    { ctype: 1, startFt: [8000, 0, 100], endFt: [8150, 0, 100] },
    { ctype: 1, startFt: [100, 0, 100], endFt: [200, 0, 300] },
    { ctype: 1, startFt: [100, 0, 500], endFt: [7950, 0, 400] },
  ];
  const loop = courseLoop(course);
  assert.deepEqual(loop, [[8000, 100], [8150, 100], [8292, 100], [8392, 300], [8292, 500], [7950, 400]]);
  for (let i = 1; i < loop.length; i++) assert.ok(Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]) < 500);
});

test("the map draws each edge at the copy whose midpoint is nearest the player, never across the world", async () => {
  const { wrapRuns } = await import("../src/render/minimap.js");
  // A loop that closes across the edge (it winds once round the world): the closing edge is folded short.
  const pts = [[8100, 0], [8300, 0], [8300, 200], [8192 + 8100, 200]];
  const runs = wrapRuns(pts, true, 50, 100);
  for (const run of runs) for (let i = 1; i < run.length; i++) assert.ok(Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z) <= 200 + 1e-9);
  // Every drawn point is within half a world of the player.
  for (const run of runs) for (const p of run) assert.ok(Math.abs(p.x - 50) <= 4096 && Math.abs(p.z - 100) <= 4096);
  // The player at x = 50 sees the course just west of them, not 8000 ft east.
  assert.ok(runs.flat().some((p) => p.x < 50 && p.x > -200));
});

test("an open course is not closed, and edges that meet are drawn as one run", async () => {
  const { wrapRuns } = await import("../src/render/minimap.js");
  const runs = wrapRuns([[0, 0], [100, 0], [100, 100]], false, 0, 0);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].map((p) => [p.x, p.z, p.i]), [[0, 0, 0], [100, 0, 1], [100, 100, 2]]);
});

test("a mark across the world edge is drawn at its copy nearest the player", () => {
  const [r, u] = toMapFrame(8100, 0, 50, 0, 0);
  near(r, -142); near(u, 0);
  const [r2] = toMapFrame(8100, 0, 50, 0, 0, false);
  near(r2, 8050);
});

test("the road's edge offsets at a loop closing across the world edge use the near copies of its neighbours", () => {
  const square = [[8142, 0], [8242, 0], [8242, 100], [8142, 100]];
  const wrapped = [[8142, 0], [50, 0], [50, 100], [8142, 100]];
  const a = edgeOffsets(square), b = edgeOffsets(wrapped);
  a.forEach((o, i) => { near(o[0], b[i][0], 1e-6); near(o[1], b[i][1], 1e-6); });
});
