/*
  CART Precision Racing's road layer as drawn (src/worker/cpr-road.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { quadNormal } from "../src/worker/cpr-road.js";

test("a road quad's normal comes from all four corners: a slot narrowed to a point at one record still has one", () => {
  const square = [[0, 0, 0], [0, 0, -10], [10, 0, -10], [10, 0, 0]];
  assert.deepEqual(quadNormal(square).map((v) => Math.round(v * 1000) / 1000), [0, -1, 0]);
  // Corners 0 and 1 in one place: the first three corners alone give no normal, and a lit triangle with none is black.
  const triangle = [[0, 0, 0], [0, 0, 0], [10, 0, -10], [10, 0, 0]];
  const n = quadNormal(triangle);
  assert.ok(Math.abs(Math.abs(n[1]) - 1) < 1e-9, `${n}`);
  assert.deepEqual(quadNormal([[1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3]]), [0, 1, 0], "a quad with no area faces up");
});
