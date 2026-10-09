import test from "node:test";
import assert from "node:assert/strict";
import { iceMosaic, joinSheets } from "../src/game/sheets.js";

const image = (v, w = 4, h = 2) => ({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(v) });

test("sheets join side by side, optionally as left and right halves", () => {
  const joined = joinSheets([image(10), image(20)]);
  assert.deepEqual([joined.width, joined.height, joined.cells], [8, 2, 2]);
  assert.equal(joined.rgba[0], 10);
  assert.equal(joined.rgba[4 * 4], 20);
  const halves = joinSheets([image(10), image(20)], { halves: true });
  assert.deepEqual([halves.width, halves.height, halves.cells], [8, 2, 4]);
});

test("the ice mosaic puts SNOW0 to SNOW3 by x parity and 2 times z parity", () => {
  const mosaic = iceMosaic([image(1, 2, 2), image(2, 2, 2), image(3, 2, 2), image(4, 2, 2)]);
  assert.equal(mosaic.width, 4);
  const at = (x, y) => mosaic.rgba[(y * 4 + x) * 4];
  assert.deepEqual([at(0, 0), at(2, 0), at(0, 2), at(2, 2)], [1, 2, 3, 4]);
});
