/*
  The ground as it is drawn, read back off its mesh (docs/VISUALS.md, "Read back off the
  mesh"): what is laid flat on the ground lies on the triangles that are drawn, not on the
  surface they were cut from.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createDrawnGround } from "../src/game/drawn-ground.js";
import { SNOW_DEPTH_SCALE_FT, createSnowCover } from "../src/game/snow-cover.js";
import { buildReliefData, createRelief } from "../src/game/terrain-relief.js";
import { buildReliefMesh } from "../src/worker/relief-mesh.js";
import { buildTerrainAtlas } from "../src/worker/terrain-mesh.js";

const GRID = 256, CELLS = GRID * GRID;
const atlas = buildTerrainAtlas([null, null]);

/** Level ground with a hill, a cliff and a pit (as tests/relief-mesh.test.mjs has it). */
function testLevel() {
  const heights = new Uint8Array(CELLS).fill(20);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const hill = Math.max(0, 30 - Math.hypot(col - 40, row - 40) * 2.2);
      const cliff = col >= 120 && col < 135 && row > 20 && row < 110 ? 70 : 0;
      const pit = Math.max(0, 12 - Math.hypot(col - 90, row - 150));
      heights[row * GRID + col] = Math.round(20 + hill + cliff - pit);
    }
  }
  return heights;
}

function meshOf(heights, { course = null, vertexBudget } = {}) {
  const clr = new Uint16Array(CELLS);
  const data = buildReliefData({ clr, textureValues: [1200, 100], ...(course ? { courses: [course] } : {}) });
  const relief = createRelief({ heights, ...data });
  const snow = course ? createSnowCover({ relief, calm: data.calm, held: data.smooth }) : null;
  return { relief, snow, mesh: buildReliefMesh({ heights, clr, lte: null, atlas, relief, snow, ...(vertexBudget ? { vertexBudget } : {}) }) };
}

test("the drawn ground's height at a place is that of the triangle drawn there", () => {
  const { mesh, relief } = meshOf(testLevel());
  const drawn = createDrawnGround(mesh.fine);
  assert.ok(drawn, "the mesh's triangles come cell after cell");
  const { positions, indices } = mesh.fine;
  // At each of its own points the mesh is the mesh.
  for (let v = 0; v < positions.length / 3; v += 13) {
    const x = positions[v * 3], z = -positions[v * 3 + 2];
    assert.ok(Math.abs(drawn.heightAt(x, z) - positions[v * 3 + 1]) < 1e-3, `vertex ${v} at ${x}, ${z}`);
  }
  // In the middle of a triangle it is the mean of the corners: flat between its points, which the surface is not.
  let apart = 0;
  for (let t = 0; t < indices.length / 3; t += 17) {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    const x = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3, z = -(positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
    const flat = (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3;
    assert.ok(Math.abs(drawn.heightAt(x, z) - flat) < 1e-3, `triangle ${t}`);
    apart = Math.max(apart, Math.abs(flat - relief.heightAt(x, z)));
  }
  // The mesh stands off the surface it was cut from, within its tolerance and what a cell's own cut leaves.
  assert.ok(apart > 0.01, `the mesh is not the surface: ${apart}`);
  // Across the world's wrap it is the same place.
  assert.equal(drawn.heightAt(40 * 32 + 5 + 8192, 40 * 32 + 9 - 8192), drawn.heightAt(40 * 32 + 5, 40 * 32 + 9));
  assert.equal(drawn.hasSnow, false);
  assert.equal(drawn.snowAt(1000, 1000), 0);
});

test("on a mesh cut coarse for its budget, a point on the surface can be well under the mesh or over it", () => {
  // A rough level on a small budget: the mesh is cut as coarse as it must be.
  const { mesh, relief } = meshOf(testLevel(), { vertexBudget: 270000 });
  const drawn = createDrawnGround(mesh.fine);
  let over = 0, under = 0;
  for (let i = 0; i < 4000; i++) {
    // Over the hill and the cliff, where the ground curves.
    const x = (20 + (i * 7919) % 12000 / 100) * 32, z = (20 + (i * 104729) % 9000 / 100) * 32;
    const off = drawn.heightAt(x, z) - relief.heightAt(x, z);
    over = Math.max(over, off); under = Math.min(under, off);
  }
  assert.ok(over > 0.05 && under < -0.05, `the mesh lies ${over} over and ${-under} under the surface`);
  // A track laid on the surface would be hidden or would float by that much; laid on the mesh it is on it.
  assert.ok(mesh.toleranceFt > 0.1, `cut looser than the tightest: ${mesh.toleranceFt}`);
});

test("built for Snow, the mesh says how deep the snow settles between its points, as the renderer lifts it", () => {
  // Level ground with a course across it, so the snow has a bank to be cut for.
  const course = [{ startFt: [1000, 0, 3000], endFt: [5000, 0, 3000], trackWidthFt: 40 }];
  const { mesh } = meshOf(new Uint8Array(CELLS).fill(10), { course });
  const drawn = createDrawnGround(mesh.fine);
  assert.equal(drawn.hasSnow, true);
  const { positions, snow } = mesh.fine;
  let deepest = 0;
  for (let v = 0; v < snow.length; v += 5) {
    const x = positions[v * 3], z = -positions[v * 3 + 2];
    assert.ok(Math.abs(drawn.snowAt(x, z) - (snow[v] / 255) * SNOW_DEPTH_SCALE_FT) < 1e-3, `vertex ${v}`);
    deepest = Math.max(deepest, drawn.snowAt(x, z));
  }
  assert.ok(deepest > 0.8 && deepest < SNOW_DEPTH_SCALE_FT);
  // On the course the snow is thin, and between the mesh's points it is what the mesh has, a blend of its corners.
  assert.ok(drawn.snowAt(3000, 3000) < 0.25 && drawn.snowAt(3000, 3000) > 0);
  assert.ok(drawn.snowAt(3003.3, 3100.7) > 0.4);
});

test("a mesh whose triangles do not come cell after cell cannot be read this way", () => {
  // Two triangles in one cell with one from another cell between them.
  const positions = new Float32Array([0, 0, 0, 32, 0, 0, 32, 0, -32, 0, 0, -32, 64, 0, 0, 96, 0, 0, 96, 0, -32]);
  assert.equal(createDrawnGround({ positions, indices: new Uint32Array([0, 1, 2, 4, 5, 6, 0, 2, 3]) }), null);
  const drawn = createDrawnGround({ positions, indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6]) });
  assert.equal(drawn.heightAt(10, 20), 0);
  // Nothing is drawn where the mesh has no triangle.
  assert.equal(drawn.heightAt(5000, 5000), null);
  assert.equal(drawn.snowAt(5000, 5000), 0);
});

test("the drawn ground over heights in feet (a CART Precision Racing level) is the game's where nothing smooths it", async () => {
  const { createRelief } = await import("../src/game/terrain-relief.js");
  const feet = new Float32Array(256 * 256).map((_, i) => (i % 256) * 0.5);
  const relief = createRelief({ heights: feet });
  // Corner (row 0, col 10) is 5 ft: heights in feet are read as feet, not as 2 ft steps.
  assert.ok(Math.abs(relief.simAt(320, 0) - 5) < 1e-6, `${relief.simAt(320, 0)}`);
  const { cprRoadKeepouts } = await import("../src/worker/track-build.js");
  assert.deepEqual(cprRoadKeepouts([{ pos: [100, 0, 200], left: 20, right: 25 }]), [{ x: 100, z: 200, radius: 35 }]);
  assert.deepEqual(cprRoadKeepouts(null), []);
});
