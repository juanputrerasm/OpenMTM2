/*
  A drawn box nothing meets (type 6 or 7) never moves, so it is drawn by chunks around the camera, once and culled
  (render/track-scene.js `createForest`), not over all nine copies of the world (`placeObjects`). TD's River Run, an
  Evo 2 conversion, has 3,759 such boxes: 1.09 million triangles a world, 9.8 million a frame over the copies.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const build = readFileSync(new URL("../src/worker/track-build.js", import.meta.url), "utf8");

test("a box the simulation never meets is drawn as a forest object; a camera-facing one and a crush car's part are not", () => {
  assert.match(build, /!billboard && !box\.crushRole && !mtm2Sim\.levelBoxCollides\(box, detailLevel\) \? \{ forest: true \}/);
});
