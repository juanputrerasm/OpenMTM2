// Mipmaps for an animated texture's frames that are one picture far off (src/shared/steady-mips.js).
import test from "node:test";
import assert from "node:assert/strict";
import { steadyMipmaps } from "../src/shared/steady-mips.js";

const frame = (r, g, b) => ({ width: 8, height: 8, rgba: Uint8Array.from({ length: 256 }, (_, i) => [r, g, b, 255][i % 4]) });

test("each frame is itself up close and every frame the same from the third halving on", () => {
  const frames = [frame(40, 80, 160), frame(120, 140, 200)];
  const [a, b] = steadyMipmaps(frames);
  assert.deepEqual(a.map((level) => level.width), [8, 4, 2, 1]);
  // The frame's own bytes, untouched.
  assert.equal(a[0].data, frames[0].rgba);
  assert.equal(b[0].data, frames[1].rgba);
  // The first halving is part way to the common picture, the frames still apart.
  assert.ok(a[1].data[0] > 40 && a[1].data[0] < b[1].data[0] && b[1].data[0] < 120);
  // From the third on they are the same picture: far off the water does not pulse with its frames.
  assert.deepEqual([...a[3].data], [...b[3].data]);
  assert.equal(a[3].data[3], 255);
  // Averaged as light, not as bytes: brighter than the bytes' mean of 80.
  assert.ok(a[3].data[0] > 85 && a[3].data[0] < 120);
});

test("a picture whose sides are not powers of two still ends in a single point", () => {
  const odd = { width: 6, height: 3, rgba: new Uint8Array(6 * 3 * 4).fill(200) };
  const [levels] = steadyMipmaps([odd]);
  assert.deepEqual(levels.map((level) => [level.width, level.height]), [[6, 3], [3, 1], [1, 1]]);
});
