/*
  A track made for Community Patch 4 (one with a DATA\<stem>.TXV record) is built as meshes: its placed models collide
  by their triangles under the OpenMTM2 physics too, not only under CommPatch4; the MTM2 and MTM1 physics keep the
  game's boxes (src/worker/sim-worker.js
  `trackTriangles`, src/ui/screens/race.js `cp4TrackTriangles`). Every surface box counts: CP4 keeps 64, OpenMTM2 all.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/worker/sim-worker.js";

/** A closed 40 x 4 x 40 ft slab's triangles, centred on the origin (nine numbers a triangle). */
function slabSoup() {
  const h = [20, 2, 20];
  const c = (x, y, z) => [x * h[0], y * h[1], z * h[2]];
  const quads = [
    [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)], [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)],
    [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)], [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
    [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)], [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
  ];
  return Float32Array.from(quads.flatMap(([a, b, d, e]) => [...a, ...b, ...d, ...a, ...d, ...e]));
}

function session({ rules, flag, decks = 1 }) {
  const positions = slabSoup();
  const boxes = Array.from({ length: decks }, (_, i) => ({
    positionFt: [1000 + (i % 9) * 60, 120, 1000 + Math.floor(i / 9) * 60], theta: 0, phi: 0, psi: 0, sizeFt: null, mass: 0, type: 0,
    priority: 0, bounds: { min: [-20, -2, -20], max: [20, 2, 20] }, sitIndex: i, modelName: "DECK", bvel: null, hitSound: null,
  }));
  return createSession({
    heights: new Uint8Array(65536).fill(50).buffer, clr: new Uint8Array(131072).buffer, textureValues: new Uint8Array(256).buffer,
    boxes, waterLevelFt: 0, weather: 0, difficulty: 1, rules,
    collisionSoups: { DECK: { positions, surfaceTypes: new Int16Array(12).fill(800) } }, cp4TrackTriangles: flag,
    trucks: [{ truck: {}, start: { pos: [500, 110, 500], heading: 0 }, autopilot: false }], race: null,
  });
}

test("a CP4 track's models collide by their triangles under the OpenMTM2 physics", () => {
  assert.ok(session({ rules: "omtm2", flag: true }).levelBoxes[0].shape);
});

test("the MTM2 and MTM1 physics keep the game's boxes on a CP4 track", () => {
  assert.equal(session({ rules: "mtm2", flag: true }).levelBoxes[0].shape, undefined);
  assert.equal(session({ rules: "mtm1", flag: true }).levelBoxes[0].shape, undefined);
});

test("without the CP4 track flag the OpenMTM2 physics keeps the game's boxes", () => {
  assert.equal(session({ rules: "omtm2", flag: false }).levelBoxes[0].shape, undefined);
});

test("every surface box counts, past CP4's 64", () => {
  const s = session({ rules: "omtm2", flag: true, decks: 65 });
  const last = s.levelBoxes[64].pos;
  assert.equal(s.ground.tireSurface(last[0], 123, last[2]), 800);
});
