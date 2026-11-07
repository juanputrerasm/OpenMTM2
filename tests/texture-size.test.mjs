import test from "node:test";
import assert from "node:assert/strict";
import { HD_TEXTURE_SIDES, hdTextureLimit, setHdTextureLimit, shrinkImage } from "../src/worker/art-texture.js";

test("Texture size takes 1024, 512 or 256; anything else is full size", () => {
  for (const side of HD_TEXTURE_SIDES) { setHdTextureLimit(side); assert.equal(hdTextureLimit(), side); }
  setHdTextureLimit(300); assert.equal(hdTextureLimit(), 1024);
  setHdTextureLimit(undefined); assert.equal(hdTextureLimit(), 1024);
  setHdTextureLimit("512"); assert.equal(hdTextureLimit(), 512);
  setHdTextureLimit(1024);
});

test("an HD image over the limit halves until it fits, by box filtering", () => {
  const rgba = new Uint8ClampedArray(1024 * 1024 * 4).fill(200);
  const out = shrinkImage({ width: 1024, height: 1024, rgba, source: "PNG" }, 256);
  assert.equal(out.width, 256);
  assert.equal(out.rgba.length, 256 * 256 * 4);
  assert.equal(out.rgba[0], 200);
  assert.equal(out.source, "PNG");
});
