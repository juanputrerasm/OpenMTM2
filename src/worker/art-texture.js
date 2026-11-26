/*
  A model's texture as the engine finds it (Community Patch 3, AUTHORING_HD_ART.md): by STEM, probing
  ART\<stem>.PNG, then ART\<stem>.TGA, then the legacy ART\<stem>.RAW with its palette. A texture recorded as `ROCK.RAW`,
  `ROCK.PNG` or plain `ROCK` is one texture. An HD file that is damaged, not really a PNG, or not a square power of two
  from 32 to 2048 is passed over for the legacy one, as JSTrackViewer does. On a retail install there are no HD files and
  this is exactly the old path.

  A texture may also carry a normal map, `ART\<stem>_N.PNG` or `.TGA` (never a .RAW): linear data, DirectX green-down.

  A track's masks and detail art (`_MASK`, `_WMSK`, `_DTL`, `_WDTL`) are looked for in a `MaskArt\` folder first
  (Community Patch 4, CP4_EXE_ANALYSIS.md 15.2.1): for each extension, MaskArt\ when the file is there (an archive's
  entry, then the game folder's loose MaskArt folder, which the install copies to `install/MASKART`), else ART\.
*/
import { decodeRawTexture, rawTextureSide } from "../vendor/openphotex/texture/raw.js";
import { loadTextureSource } from "./level-load.js";
import { DETAIL_MAX_DIM, decodeTrueColorTexture, hdDimensionRefusal } from "./image-decoder.js";
import { readFile } from "../shared/opfs.js";
import { INSTALL_DIR } from "./install-store.js";

/** The largest side an HD texture keeps (Options, Graphics: Texture size); larger art is box-filtered down as it loads. */
export const HD_TEXTURE_SIDES = Object.freeze([2048, 1024, 512, 256]);
let hdLimit = 2048;
/** Sets the largest HD side for the loads that follow (the worker's track and truck builds); anything else is full size. */
export function setHdTextureLimit(side) { hdLimit = HD_TEXTURE_SIDES.includes(Number(side)) ? Number(side) : 2048; }
export const hdTextureLimit = () => hdLimit;

export const artStem = (name) => String(name ?? "").toUpperCase().replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");

async function hdImage(vfs, stem) {
  for (const extension of ["PNG", "TGA"]) {
    const bytes = await vfs.read(`ART\\${stem}.${extension}`);
    if (!bytes) continue;
    try {
      const image = await decodeTrueColorTexture(bytes, `${stem}.${extension}`, extension);
      if (hdDimensionRefusal(`${stem}.${extension}`, image.width, image.height)) continue;
      const loaded = { width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.rgba), source: extension };
      return loaded.width > hdLimit || loaded.height > hdLimit ? shrinkImage(loaded, hdLimit) : loaded;
    } catch { /* not usable: the next source */ }
  }
  return null;
}

/** Where the install keeps the game folder's loose MaskArt folder (install/inspect-source.js `findMaskArt`). */
export const MASK_ART_DIR = `${INSTALL_DIR}/MASKART`;

/** A file of the install's MaskArt folder by name (`NAME.PNG`), its bytes, or null. */
export async function readMaskArt(name) {
  try {
    const file = await readFile(`${MASK_ART_DIR}/${name}`);
    return file ? new Uint8Array(await file.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Names whose art Community Patch 4 looks for in MaskArt\ first. */
const MASK_ART_NAME = /_(?:MASK|WMSK|WDTL|DTL)$/;

/**
 * The bytes of `<stem>.<extension>` as Community Patch 4 finds a mask or detail map: MaskArt\ when it is there (an
 * archive's entry, then the install's loose folder), else ART\. Other stems are read from ART\ alone.
 */
async function readArt(vfs, stem, extension, maskArt) {
  if (MASK_ART_NAME.test(stem)) {
    const masked = (await vfs.read(`MASKART\\${stem}.${extension}`)) ?? (await maskArt(`${stem}.${extension}`));
    if (masked) return masked;
  }
  return vfs.read(`ART\\${stem}.${extension}`);
}

/**
 * A PNG or TGA by stem at whatever size it has (a terrain mask is a picture of the level, not a texture), or null.
 * `maskArt` reads the install's MaskArt folder (tests stand in for it).
 */
export async function loadPlainImage(vfs, stem, { maskArt = readMaskArt } = {}) {
  for (const extension of ["PNG", "TGA"]) {
    const bytes = await readArt(vfs, stem, extension, maskArt);
    if (!bytes) continue;
    try {
      const image = await decodeTrueColorTexture(bytes, `${stem}.${extension}`, extension);
      return { width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.rgba), source: extension };
    } catch { /* not usable: the next source */ }
  }
  return null;
}

/**
 * A track's detail normal (`<level>_DTL`, `<level>_WDTL`) as Community Patch 4 beta 0.53 hotfix 3 loads it
 * (CP4_EXE_ANALYSIS.md 15.2.1, 15.3): PNG then TGA, each from MaskArt\ first; a side over DETAIL_MAX_DIM (2048) is
 * refused, and the engine's generated map stands in (null here); any other size is loaded, even one that is not a square
 * power of two (the engine warns that it mips less cleanly). Shrunk to the Texture size as HD art is. Or null.
 */
export async function loadDetailImage(vfs, stem, { maskArt = readMaskArt } = {}) {
  for (const extension of ["PNG", "TGA"]) {
    const bytes = await readArt(vfs, stem, extension, maskArt);
    if (!bytes) continue;
    let image;
    try {
      image = await decodeTrueColorTexture(bytes, `${stem}.${extension}`, extension);
    } catch { continue; /* not usable: the next source */ }
    if (image.width > DETAIL_MAX_DIM || image.height > DETAIL_MAX_DIM) return null;
    // (hdDimensionRefusal with the hotfix's cap names what is odd about it; the engine loads it anyway.)
    const odd = hdDimensionRefusal(`${stem}.${extension}`, image.width, image.height, DETAIL_MAX_DIM);
    const loaded = { width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.rgba), source: extension, ...(odd ? { odd } : {}) };
    return loaded.width > hdLimit || loaded.height > hdLimit ? shrinkImage(loaded, hdLimit) : loaded;
  }
  return null;
}

/**
 * `{ width, height, rgba, source }` for a texture name, or null. `cutout` keys the legacy art's black out; HD art keeps
 * its own alpha, which the material uses or ignores by the face's rules.
 */
export async function loadArtTexture(vfs, name, palettes, { cutout = false, kind = "model", hdOnly = false, legacyOnly = false } = {}) {
  const stem = artStem(name);
  if (!stem) return null;
  // `legacyOnly`: the game's own RAW, an HD file of the same stem passed over (an original backdrop, worker/track-build.js).
  const hd = legacyOnly ? null : await hdImage(vfs, stem);
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
