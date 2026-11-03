/*
  CP3's painted terrain detail mask is read at the ground's vertices (shared/terrain-mask.js), not as a texture: the
  ground's shader is near the sixteen textures a graphics card may allow one, and two more left River Run with no ground.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TERRAIN_MASK_FT, terrainMaskShares } from "../src/shared/terrain-mask.js";

/** A 2 x 2 mask: black on the left, white on the right. */
const mask = { width: 2, height: 2, rgba: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]) };
const at = (x, zGame) => terrainMaskShares(new Float32Array([x, 0, -zGame]), mask)[0];

test("a vertex at a texel's centre reads that texel", () => {
  const quarter = TERRAIN_MASK_FT / 4;
  assert.equal(at(quarter, quarter), 0);
  assert.equal(at(3 * quarter, quarter), 255);
});

test("between texels the mask is blended, and it repeats with the world", () => {
  assert.equal(at(TERRAIN_MASK_FT / 2, TERRAIN_MASK_FT / 4), 128);
  assert.equal(at(TERRAIN_MASK_FT * 1.25, TERRAIN_MASK_FT / 4), at(TERRAIN_MASK_FT / 4, TERRAIN_MASK_FT / 4));
});

test("the detail takes no texture for the mask, and none of its own without the track's _DTL", () => {
  const scene = readFileSync(new URL("../src/render/track-scene.js", import.meta.url), "utf8");
  const hook = scene.slice(scene.indexOf("function addTerrainDetail"), scene.indexOf("function addRoadMask"));
  assert.doesNotMatch(hook, /detailMask/);
  assert.match(hook, /own \? "uniform sampler2D detailMap;" : SHARED_NOISE_GLSL/);
  assert.match(hook, /attribute float detailShare/);
});
