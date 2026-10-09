/*
  A model's texture as the engine finds it (Community Patch 3, AUTHORING_HD_ART.md): by STEM, probing
  ART\<stem>.PNG, then ART\<stem>.TGA, then the legacy ART\<stem>.RAW with its palette. A texture recorded as `ROCK.RAW`,
  `ROCK.PNG` or plain `ROCK` is one texture. An HD file that is damaged, not really a PNG, or not a square power of two
  from 32 to 1024 is passed over for the legacy one, as JSTrackViewer does. On a retail install there are no HD files and
  this is exactly the old path.

  A texture may also carry a normal map, `ART\<stem>_N.PNG` or `.TGA` (never a .RAW): linear data, DirectX green-down.
*/
import { decodeRawTexture, rawTextureSide } from "../vendor/openphotex/index.js";
import { loadTextureSource } from "./level-load.js";
import { decodeTrueColorTexture, hdDimensionRefusal } from "./image-decoder.js";

export const artStem = (name) => String(name ?? "").toUpperCase().replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");

async function hdImage(vfs, stem) {
  for (const extension of ["PNG", "TGA"]) {
    const bytes = await vfs.read(`ART\\${stem}.${extension}`);
    if (!bytes) continue;
    try {
      const image = await decodeTrueColorTexture(bytes, `${stem}.${extension}`, extension);
      if (hdDimensionRefusal(`${stem}.${extension}`, image.width, image.height)) continue;
      return { width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.rgba), source: extension };
    } catch { /* not usable: the next source */ }
  }
  return null;
}

/**
 * `{ width, height, rgba, source }` for a texture name, or null. `cutout` keys the legacy art's black out; HD art keeps
 * its own alpha, which the material uses or ignores by the face's rules.
 */
export async function loadArtTexture(vfs, name, palettes, { cutout = false, kind = "model", hdOnly = false } = {}) {
  const stem = artStem(name);
  if (!stem) return null;
  const hd = await hdImage(vfs, stem);
  if (hd || hdOnly) return hd;
  const source = await loadTextureSource(vfs, `${stem}.RAW`, palettes, kind);
  if (!source?.palette || !rawTextureSide(source.raw.length)) return null;
  const image = decodeRawTexture(source.raw, source.palette, { cutout });
  return { width: image.width, height: image.height, rgba: image.rgba, source: "RAW" };
}

/** The ambient occlusion map of a texture (`<stem>_AO`, greyscale, white open), or null. */
export async function loadAoMap(vfs, name) {
  const stem = artStem(name);
  return stem ? hdImage(vfs, `${stem}_AO`) : null;
}

/** The normal map of a texture (`<stem>_N`), or null. */
export async function loadNormalMap(vfs, name) {
  const stem = artStem(name);
  return stem ? hdImage(vfs, `${stem}_N`) : null;
}

/** An image scaled down by box filtering until its side is at most `maxSide` (power-of-two sides halve exactly). */
export function shrinkImage(image, maxSide) {
  let { width, height, rgba } = image;
  while (width > maxSide || height > maxSide) {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(width - 1, x * 2 + dx), sy = Math.min(height - 1, y * 2 + dy);
            sum += rgba[(sy * width + sx) * 4 + c];
          }
          out[(y * w + x) * 4 + c] = (sum + 2) >> 2;
        }
      }
    }
    width = w; height = h; rgba = out;
  }
  return { ...image, width, height, rgba };
}
