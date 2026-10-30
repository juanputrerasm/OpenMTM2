import test from "node:test";
import assert from "node:assert/strict";
import { watermarkPlace } from "../src/ui/watermark.js";

test("the watermark's corner falls on a whole device pixel at any pixel ratio", () => {
  for (const ratio of [1, 1.25, 1.5, 1.75, 2, 2.25, 3]) {
    for (const [w, h] of [[1366, 768], [1280, 913], [1919, 1079]]) {
      const { left, top } = watermarkPlace(101, 17, w, h, ratio, 33);
      assert.ok(Number.isInteger(Math.round(left * ratio * 1e6) / 1e6), `left ${left} at ${ratio}`);
      assert.ok(Number.isInteger(Math.round(top * ratio * 1e6) / 1e6), `top ${top} at ${ratio}`);
    }
  }
});

test("at a ratio of 1 the mark sits 8 px from the right and 6 px from the bottom", () => {
  assert.deepEqual(watermarkPlace(100, 20, 800, 600, 1), { left: 692, top: 574 });
});
