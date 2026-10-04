/*
  The terrain mesh draws exactly the surface the simulation stands on.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim } from "../src/vendor/openphotex/index.js";
import { buildTerrainAtlas, buildTerrainMesh, decodeTerrainTextures } from "../src/worker/terrain-mesh.js";
import { loadLevel, loadTextureSource } from "../src/worker/level-load.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

/** Height of the mesh under game point (x, z), from the triangle that contains it. */
function meshHeightAt(mesh, x, z) {
  const col = Math.floor(x / 32), row = Math.floor(z / 32);
  const cell = row * 256 + col;
  const sx = x, sz = -z; // scene frame
  for (let t = 0; t < 2; t++) {
    const tri = [0, 1, 2].map((k) => mesh.indices[cell * 6 + t * 3 + k]);
    const p = tri.map((i) => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]);
    const d = (p[1][2] - p[2][2]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][2] - p[2][2]);
    const a = ((p[1][2] - p[2][2]) * (sx - p[2][0]) + (p[2][0] - p[1][0]) * (sz - p[2][2])) / d;
    const b = ((p[2][2] - p[0][2]) * (sx - p[2][0]) + (p[0][0] - p[2][0]) * (sz - p[2][2])) / d;
    const c = 1 - a - b;
    if (a >= -1e-9 && b >= -1e-9 && c >= -1e-9) return a * p[0][1] + b * p[1][1] + c * p[2][1];
  }
  throw new Error(`no triangle under ${x}, ${z}`);
}

function randomLevel(seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 8) & 0xff;
  const heights = new Uint8Array(65536).map(() => rnd());
  const clr = new Uint16Array(65536).map(() => rnd() & 3);
  return { heights, clr };
}

test("mesh height equals the simulation's sampler, both diagonals, across the wrap", () => {
  const { heights, clr } = randomLevel(11);
  const atlas = buildTerrainAtlas([null, null, null, null]);
  const mesh = buildTerrainMesh({ heights, clr, lte: null, atlas });
  const terrain = mtm2Sim.createTerrain(heights);
  let seed = 5;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 10000; i++) {
    // Whole 1/256 ft, as the game truncates positions.
    const x = Math.floor(rnd() * 8192 * 256) / 256, z = Math.floor(rnd() * 8192 * 256) / 256;
    const want = mtm2Sim.terrainHeightAt(terrain, x, z);
    assert.ok(Math.abs(meshHeightAt(mesh, x, z) - want) < 1e-3, `${x}, ${z}`);
  }
  // The last cell joins row and column 0.
  assert.equal(mesh.positions[(65535 * 4 + 2) * 3 + 1], heights[0] * 2);
});

test("faces point up; CLR rotation and mirror pick the tile corners", () => {
  const heights = new Uint8Array(65536);
  const clr = new Uint16Array(65536);
  clr[0] = 1 | (1 << 14); // slot 1, a quarter turn
  clr[1] = 1 | (1 << 12); // slot 1, mirror bit 0
  const atlas = buildTerrainAtlas([null, null]);
  const mesh = buildTerrainMesh({ heights, clr, lte: null, atlas });
  for (const i of [0, 3, 6 * 300]) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[i + k]);
    const p = (n) => [mesh.positions[n * 3], mesh.positions[n * 3 + 1], mesh.positions[n * 3 + 2]];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    assert.ok(e1[2] * e2[0] - e1[0] * e2[2] > 0, "counter-clockwise from above");
  }
  const [rx, ry, rw, rh] = atlas.rects[1];
  const corner = (k) => [mesh.uvs[k * 2], mesh.uvs[k * 2 + 1]];
  const u0 = rx / atlas.width, u1 = (rx + rw) / atlas.width, v0 = ry / atlas.height, v1 = (ry + rh) / atlas.height;
  // Unturned corner order is (u0, v1), (u1, v1), (u1, v0), (u0, v0); a quarter turn shifts it by one.
  assert.deepEqual(corner(0).map((n) => +n.toFixed(6)), [u1, v1].map((n) => +n.toFixed(6)));
  // Mirror bit 0 maps corner k to 3 - k.
  assert.deepEqual(corner(4).map((n) => +n.toFixed(6)), [u0, v0].map((n) => +n.toFixed(6)));
});

test("stock TPARK: atlas from ART textures, LTE shading", { skip: skipWithoutStock("POD.INI") }, async () => {
  const vfs = stockVfs();
  const level = await loadLevel(vfs, "WORLD\\TPARK.SIT");
  const sources = await Promise.all(level.textureNames.map((n) => loadTextureSource(vfs, n, level.palette)));
  const decoded = decodeTerrainTextures(sources);
  assert.ok(decoded.filter(Boolean).length >= decoded.length - 1);
  const atlas = buildTerrainAtlas(decoded);
  assert.equal(atlas.tileSide, 64);
  const mesh = buildTerrainMesh({ heights: level.heights, clr: level.clr, lte: level.lte, atlas });
  assert.ok(mesh.hasLte);
  const mean = mesh.shade.reduce((a, b) => a + b, 0) / mesh.shade.length;
  assert.ok(mean > 0.5 && mean < 1, `mean ground brightness ${mean}`);
});

test("stock tracks build for rendering: objects placed, textures decoded", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildTrackRender, transferablesOf } = await import("../src/worker/track-build.js");
  const vfs = stockVfs();
  const build = await buildTrackRender(vfs, "WORLD\\TPARK.SIT");
  assert.equal(build.trackName, "Farm Road 29");
  // 315 boxes have a model; the 6 checkpoint gates among them are not drawn on an MTM2 level.
  assert.equal(build.objects.length, 309);
  assert.ok(build.objects.every((o) => !o.model.startsWith("CKBOX")));
  const missing = Object.entries(build.models).filter(([, m]) => !m).map(([n]) => n);
  assert.deepEqual(missing, []);
  const used = new Set(Object.values(build.models).flatMap((m) => m.textureNames));
  const decoded = Object.keys(build.modelTextures);
  assert.ok(decoded.length >= used.size * 0.95, `${decoded.length} of ${used.size} model textures`);
  assert.ok(build.sky && build.sky.width === 256);
  // Transferables are distinct buffers, none of them an archive.
  const buffers = transferablesOf(build);
  assert.equal(new Set(buffers).size, buffers.length);
  assert.ok(buffers.every((b) => b.byteLength < 64 * 1024 * 1024));
});

test("which boxes are drawn", async () => {
  const { boxIsDrawn } = await import("../src/worker/track-build.js");
  const ctx = { levelType: 0, raceType: "circuit", detailLevel: 2 };
  assert.equal(boxIsDrawn({ type: 0, modelName: "TREE.BIN", priority: 2 }, ctx), true);
  assert.equal(boxIsDrawn({ type: 0, modelName: "TREE.BIN", priority: 2 }, { ...ctx, detailLevel: 1 }), false);
  assert.equal(boxIsDrawn({ type: 0, modelName: "" }, ctx), false);
  assert.equal(boxIsDrawn({ type: 6, modelName: "CKBOXN.BIN" }, ctx), false);
  assert.equal(boxIsDrawn({ type: 6, modelName: "FLAG.BIN" }, { ...ctx, levelType: 4 }), true);
  assert.equal(boxIsDrawn({ type: 6, modelName: "CKBOX.BIN" }, { ...ctx, levelType: 4 }), false);
  assert.equal(boxIsDrawn({ type: 6, modelName: "FLAG.BIN" }, { ...ctx, levelType: 4, raceType: "drag" }), false);
});

test("ground boxes: only exposed faces, sides start at the terrain", async () => {
  const { buildGroundBoxMesh } = await import("../src/worker/ground-box-mesh.js");
  const { buildTerrainAtlas } = await import("../src/worker/terrain-mesh.js");
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536), heights = new Uint8Array(65536);
  // Two boxes side by side in row 10 (cols 10 and 11), from step 0 to 20, on ground at step 5.
  heights.fill(5);
  for (const c of [10, 11]) { ra0[10 * 256 + c] = 0; ra1[10 * 256 + c] = 20; }
  const mesh = buildGroundBoxMesh({ ra0, ra1, cl0: null }, buildTerrainAtlas([null]), null, heights);
  // Each box: top, three open sides; the shared sides and the buried bottoms are culled.
  assert.equal(mesh.faces, 8);
  // Every side face starts at the ground (10 ft), not at the box bottom (0 ft).
  let lowest = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) lowest = Math.min(lowest, mesh.positions[i]);
  assert.equal(lowest, 10);
  assert.equal(mesh.indices.length, 8 * 6);
  assert.ok(Math.max(...mesh.indices) < 8 * 4);
});
