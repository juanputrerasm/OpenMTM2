/*
  4x4 Evolution 2's smoothed ground at its three levels of detail (src/worker/terrain-mesh.js `fineTerrainLevel`): chunks at
  any mix of levels cover the ground once and meet without a crack.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { fineTerrainLevel } from "../src/worker/terrain-mesh.js";

const SUB = 4, GRID = 8, CHUNK = 4, N = SUB + 1;

/** A vertex's place on the fine grid, as buildFineTerrainMesh lays a cell's own vertices out. */
function pointOf(v) {
  const cell = Math.floor(v / (N * N)), k = v % (N * N);
  const row = Math.floor(cell / GRID), col = cell % GRID, j = Math.floor(k / N), i = k % N;
  return [col * SUB + i, row * SUB + j];
}

/** The triangles of each chunk at the level `levelOf(chunkIndex)` asks for, as fine-grid points. */
function triangles(levelOf) {
  const levels = Object.fromEntries([1, 2, 4].map((step) => [step, fineTerrainLevel({ sub: SUB, step, chunkCells: CHUNK, grid: GRID })]));
  const out = [];
  for (let chunk = 0; chunk < (GRID / CHUNK) ** 2; chunk++) {
    const level = levels[levelOf(chunk)], part = level.chunks[chunk];
    for (let k = part.start; k < part.start + part.count; k += 3) out.push([0, 1, 2].map((d) => pointOf(level.indices[k + d])));
  }
  return out;
}

function check(levelOf) {
  const tris = triangles(levelOf);
  const edges = new Map();
  let area = 0;
  for (const [a, b, c] of tris) {
    const signed = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    // Every triangle turns as the fine level's do, and none is empty.
    assert.ok(signed > 0, `triangle ${JSON.stringify([a, b, c])} turns the wrong way or is empty`);
    area += signed;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = [p, q].map(String).sort().join("|");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const side = GRID * SUB;
  assert.equal(area, side * side, "the ground is covered once");
  // Inside, every edge has a triangle on each side: no crack and no overlap.
  const onOutside = (key) => key.split("|").map((p) => p.split(",").map(Number)).every(([x, z], _, all) =>
    all.every(([x2]) => x2 === x) && (x === 0 || x === side) || all.every(([, z2]) => z2 === z) && (z === 0 || z === side));
  for (const [key, count] of edges) assert.equal(count, onOutside(key) ? 1 : 2, `edge ${key}`);
}

test("each level covers the ground once, its inside edges shared", () => {
  for (const step of [1, 2, 4]) check(() => step);
});

test("chunks at different levels meet without a crack", () => {
  check((chunk) => [1, 2, 4, 2][chunk]);
  check((chunk) => [4, 1, 1, 4][chunk]);
  check((chunk) => [2, 4, 1, 1][chunk]);
});

test("the far levels draw far fewer triangles than the fine one", () => {
  const big = (step) => fineTerrainLevel({ sub: SUB, step }).indices.length / 3;
  const fine = 256 * 256 * SUB * SUB * 2;
  assert.ok(big(2) < fine / 3, `middle ${big(2)}`);
  assert.ok(big(4) < fine / 10, `coarse ${big(4)}`);
});
