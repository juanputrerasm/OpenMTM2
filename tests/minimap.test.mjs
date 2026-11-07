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
