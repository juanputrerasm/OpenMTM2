/*
  Community Patch 4's texture mipmaps (docs/CP4_EXE_ANALYSIS.md 15.13): colour the mean of the texels that are not
  black, alpha the OR of the four, down to 1 x 1; only for a see-through square power of two.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cp4MipChain } from "../src/shared/cp4-mips.js";

const image = (side, fill) => ({ width: side, height: side, rgba: Uint8Array.from({ length: side * side * 4 }, (_, i) => fill(Math.floor(i / 4), i % 4)) });

test("a thin blade keeps its cover: alpha by OR, colour from the texels that are not black", () => {
  // 4 x 4, clear and black but for one opaque green texel at (1, 1).
  const img = image(4, (t, ch) => (t === 5 ? [0, 200, 0, 255][ch] : 0));
  const chain = cp4MipChain(img);
  assert.equal(chain.length, 3);
  assert.deepEqual([chain[1].width, chain[2].width], [2, 1]);
  assert.deepEqual([...chain[1].data.slice(0, 4)], [0, 200, 0, 255], "the green texel alone, solid");
  assert.deepEqual([...chain[1].data.slice(4, 8)], [0, 0, 0, 0]);
  assert.deepEqual([...chain[2].data], [0, 200, 0, 255]);
  // Soft alphas OR together: 0x80 | 0x41 = 0xc1.
  const soft = image(2, (t, ch) => (ch === 3 ? [0x80, 0x41, 0, 0][t] : 100));
  assert.equal(cp4MipChain(soft)[1].data[3], 0xc1);
});

test("opaque pictures and odd shapes keep the GPU's mipmaps", () => {
  assert.equal(cp4MipChain(image(4, () => 255)), null);
  assert.equal(cp4MipChain({ width: 6, height: 6, rgba: new Uint8Array(144) }), null);
  assert.equal(cp4MipChain({ width: 8, height: 4, rgba: new Uint8Array(128) }), null);
});

test("model textures take them in the enhanced look, and stay out of texture stacks", () => {
  const ts = readFileSync(new URL("../src/render/track-scene.js", import.meta.url), "utf8");
  assert.match(ts, /const chain = look === "classic" \? null : cp4MipChain\(image\);/);
  assert.match(ts, /textures\.set\(name, modelTextures\[name\] \? modelTexture\(modelTextures\[name\], look\) : null\);/);
  assert.match(readFileSync(new URL("../src/render/part-merge.js", import.meta.url), "utf8"), /map\.userData\.ownMips/);
});
