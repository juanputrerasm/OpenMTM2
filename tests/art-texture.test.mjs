import test from "node:test";
import assert from "node:assert/strict";
import { artStem, loadArtTexture, loadNormalMap } from "../src/worker/art-texture.js";

/** An uncompressed 24-bit TGA, `size` square, bottom-left origin, every texel `rgb`. */
function tga(size, rgb) {
  const out = new Uint8Array(18 + size * size * 3);
  out[2] = 2; out[12] = size & 255; out[13] = size >> 8; out[14] = size & 255; out[15] = size >> 8; out[16] = 24;
  for (let i = 0; i < size * size; i++) out.set([rgb[2], rgb[1], rgb[0]], 18 + i * 3);
  return out;
}
const vfsOf = (files) => ({ read: async (path) => files[path] ?? null, find: () => null });

test("a texture is its stem, whatever extension the model records", () => {
  assert.equal(artStem("ROCK.RAW"), "ROCK");
  assert.equal(artStem("rock.png"), "ROCK");
  assert.equal(artStem("ART\\Rock"), "ROCK");
});

test("HD art is found by stem and wins; a bad size is passed over; a normal map is <stem>_N", async () => {
  const vfs = vfsOf({ "ART\\ROCK.TGA": tga(32, [10, 20, 30]), "ART\\ROCK_N.TGA": tga(64, [128, 128, 255]), "ART\\ODD.TGA": tga(48, [1, 2, 3]) });
  const rock = await loadArtTexture(vfs, "ROCK.RAW", null);
  assert.equal(rock.source, "TGA");
  assert.equal(rock.width, 32);
  assert.deepEqual([...rock.rgba.slice(0, 4)], [10, 20, 30, 255]);
  assert.equal((await loadNormalMap(vfs, "ROCK.RAW")).width, 64);
  // 48 is not a power of two: refused, and with no legacy art either there is nothing.
  assert.equal(await loadArtTexture(vfs, "ODD.RAW", null, { hdOnly: true }), null);
});
