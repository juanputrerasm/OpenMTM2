/*
  The ground of a track built of meshes (src/game/mesh-ground.js): the drivable surface under a point, walls and drops
  down a computer racer's way, and the ground the views stand on.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { clearStandingView, meshGroundFromBuild, meshObstacles, viewBlocked, viewGroundOn, VIEW_MARGIN_FT } from "../src/game/mesh-ground.js";
import { createChaseCamera, distanceZoom } from "../src/game/cameras.js";

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

// A 400 ft long deck 20 ft over flat terrain at 100 ft (its top at 122), and a wall standing on it.
const build = {
  sim: {
    cp4Track: true,
    collisionSoups: { DECK: { positions: boxSoup([20, 2, 200]) }, WALL: { positions: boxSoup([20, 10, 2]) } },
    boxes: [placed("DECK", [1000, 120, 1000], [20, 2, 200]), placed("WALL", [1000, 132, 1150], [20, 10, 2])],
  },
};
const mesh = meshGroundFromBuild(build, { terrainHeight: () => 100 });

test("the surface under a point: the deck's top, else the terrain", () => {
  assert.ok(Math.abs(mesh.surfaceBelow(1000, 130, 1000, 60) - 122) < 0.01);
  assert.equal(mesh.surfaceBelow(1100, 130, 1000, 60), 100);
});

test("on the deck: a drop off its side, and the wall ahead", () => {
  // Heading +x across the deck: its edge is 20 ft away.
  const across = meshObstacles(mesh, [1000, 127, 1000], 122, Math.PI / 2, 100, 11);
  assert.ok(across.some((o) => o.pos[0] > 1015 && o.pos[0] < 1045), JSON.stringify(across));
  // Heading +z along it: the wall at z = 1148.
  const along = meshObstacles(mesh, [1000, 127, 1000], 122, 0, 220, 11);
  assert.ok(along.some((o) => Math.abs(o.pos[2] - 1148) < 2), JSON.stringify(along));
});

test("a view stands on the deck near what it watches, not on the terrain under it", () => {
  const view = viewGroundOn(mesh, () => 100, () => 124);
  assert.ok(Math.abs(view(1000, 1000) - 122) < 0.01);
  assert.equal(view(1200, 1000), 100);
});

test("no mesh ground on a track not made for CP4", () => {
  assert.equal(meshGroundFromBuild({ sim: { ...build.sim, cp4Track: false } }, { terrainHeight: () => 100 }), null);
});

// A tunnel: a floor at 230 and a roof 26 ft over it (Beaver City's), 400 ft long down z, 60 ft wide.
const tunnel = meshGroundFromBuild({
  sim: {
    cp4Track: true,
    collisionSoups: { SLAB: { positions: boxSoup([30, 1, 200]) } },
    boxes: [placed("SLAB", [2000, 229, 2000], [30, 1, 200]), placed("SLAB", [2000, 257, 2000], [30, 1, 200])],
  },
}, { terrainHeight: () => 200 });

test("a view's ground is the tunnel's floor, never its roof, even with the truck bounced up", () => {
  for (const truckY of [235, 241]) assert.ok(Math.abs(viewGroundOn(tunnel, () => 200, () => truckY)(2000, 1950) - 230) < 0.01, `truck at ${truckY}`);
});

test("Chase Far stays under a tunnel's roof and in front of what stands behind the truck", () => {
  const truck = [2000, 235.5, 2000];
  const ground = viewGroundOn(tunnel, () => 200, () => truck[1]);
  const v = createChaseCamera().update(14, truck, 0, ground, 1 / 60, { clearFt: 3, blocked: viewBlocked(tunnel) });
  assert.ok(v.position[1] < 256 - 1 && v.position[1] > 230, `camera y ${v.position[1]}`);
  assert.equal(tunnel.segmentHit(truck, v.position), null);
  // A wall 10 ft behind the truck: the camera stops in front of it.
  const walled = meshGroundFromBuild({ sim: { cp4Track: true, collisionSoups: { WALL: { positions: boxSoup([20, 20, 1]) } }, boxes: [placed("WALL", [2000, 245, 1990], [20, 20, 1])] } }, { terrainHeight: () => 230 });
  const w = createChaseCamera().update(14, truck, 0, () => 230, 1 / 60, { blocked: viewBlocked(walled) });
  assert.ok(w.position[2] > 1991 && w.position[2] < 2000, `camera z ${w.position[2]}`);
});

test("a standing view moves in front of a face between it and the truck, its lens widened for the nearer distance", () => {
  const truck = [2000, 235.5, 2000];
  const view = { position: [2000, 300, 1800], target: [2000, 235.5, 2000], zoom: 2 };
  const moved = clearStandingView(viewBlocked(tunnel), truck, view, distanceZoom);
  assert.ok(moved.position[1] < 256, `camera y ${moved.position[1]}`);
  assert.ok(moved.zoom >= view.zoom, "nearer, the lens is as wide as the game makes it at that distance");
  assert.equal(clearStandingView(null, truck, view, distanceZoom), view);
  assert.ok(VIEW_MARGIN_FT > 0);
});

test("the boxes found through the grid give the answers of trying every box, across the world's seam too", () => {
  // Decks and walls scattered over a wrapping world, some across its seam, one wider than a cell by far.
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const soups = {}, boxes = [];
  for (let i = 0; i < 60; i++) {
    const half = [10 + random() * 60, 1 + random() * 8, 10 + random() * 60];
    if (i === 0) { half[0] = 900; half[2] = 700; }
    soups[`M${i}`] = { positions: boxSoup(half) };
    boxes.push(placed(`M${i}`, [random() * 8192, 100 + random() * 60, random() * 8192], half));
  }
  const scattered = { sim: { cp4Track: true, collisionSoups: soups, boxes } };
  const wrapDelta = (d) => d - 8192 * Math.round(d / 8192);
  const terrainHeight = () => 90;
  const gridded = meshGroundFromBuild(scattered, { terrainHeight, wrapDelta, worldFt: 8192 });
  const tried = meshGroundFromBuild(scattered, { terrainHeight, wrapDelta });
  for (let n = 0; n < 4000; n++) {
    const x = random() * 8192, z = random() * 8192, y = 100 + random() * 120;
    assert.equal(gridded.surfaceBelow(x, y, z, 80), tried.surfaceBelow(x, y, z, 80));
  }
  for (let n = 0; n < 400; n++) {
    const pos = [random() * 8192, 0, random() * 8192], reach = random() * 600;
    assert.deepEqual(gridded.near(pos, reach).map((b) => gridded.boxes.indexOf(b)), tried.near(pos, reach).map((b) => tried.boxes.indexOf(b)));
    const from = [pos[0], 130, pos[2]], to = [pos[0] + (random() - 0.5) * 400, 100 + random() * 80, pos[2] + (random() - 0.5) * 400];
    assert.equal(gridded.segmentHit(from, to), tried.segmentHit(from, to));
    const heading = random() * Math.PI * 2;
    assert.deepEqual(meshObstacles(gridded, [pos[0], 127, pos[2]], 122, heading, 220, 11), meshObstacles(tried, [pos[0], 127, pos[2]], 122, heading, 220, 11));
  }
});
