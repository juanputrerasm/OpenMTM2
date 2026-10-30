import test from "node:test";
import assert from "node:assert/strict";
import { createBoxSolid } from "../src/game/ground-boxes.js";
import { createChaseCamera } from "../src/game/cameras.js";

// A tunnel along z through cells x = 2..4 (64 to 160 ft): walls in columns 2 and 4 from the ground to 40 ft, and
// a roof over column 3 from 10 to 40 ft, the road under it on flat ground at 0.
function tunnel() {
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536);
  for (let row = 0; row < 256; row++) {
    for (const col of [2, 4]) { ra0[row * 256 + col] = 0; ra1[row * 256 + col] = 20; }
    ra0[row * 256 + 3] = 5; ra1[row * 256 + 3] = 20;
  }
  return { ra0, ra1 };
}

test("a ground box is solid between its underside and its top, with room under a roof", () => {
  const solid = createBoxSolid(tunnel(), 0);
  assert.equal(solid(112, 6, 500), false, "under the roof");
  assert.equal(solid(112, 30, 500), true, "in the roof");
  assert.equal(solid(80, 6, 500), true, "in a wall");
  assert.equal(solid(112, 50, 500), false, "over the roof");
  assert.equal(solid(10, 10, 500), false, "a cell with no box");
  assert.equal(solid(112 - 8192, 30, 500 + 8192), true, "the grid wraps with the world");
});

test("a level without ground boxes has no solid test", () => {
  assert.equal(createBoxSolid({ ra0: new Uint8Array(65536), ra1: new Uint8Array(65536) }), null);
});

test("in a tunnel the chase camera stays under the roof", () => {
  const solid = createBoxSolid(tunnel());
  const flat = () => 0;
  const free = createChaseCamera().update(2, [112, 4, 500], 0, flat, 0.016);
  const inside = createChaseCamera().update(2, [112, 4, 500], 0, flat, 0.016, { solid });
  assert.ok(free.position[1] > 10, `with the terrain alone it is up at ${free.position[1]} ft, in or over the roof`);
  assert.ok(inside.position[1] < 10, `kept at ${inside.position[1]} ft, under the roof`);
  assert.equal(solid(...inside.position), false);
});
