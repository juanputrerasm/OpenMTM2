/*
  A truck's models for drawing (MONSTER_EXE_ANALYSIS.md section 3, 0x4bfa10).

  TRUCK\<name>.TRK names the parts: the body MODELS\<truckModelBaseName>.BIN, the tires
  MODELS\<tireModelBaseName>16L.BIN and 16R.BIN (the full-detail left and right tires; 10 and 08
  are the lower levels of detail), and the axle model. The four wheel anchors are the TRK's
  `static_bpos` values in body feet (FR, FL, RR, RL); a tire model is drawn with its origin there.
*/
import { decodeRawTexture, MTM_WHEEL_KEYS, parseTruckManifest, podPathTitle, rawTextureSide } from "../vendor/openphotex/index.js";
import { decodeModel } from "./models.js";
import { loadTextureSource } from "./level-load.js";

async function model(vfs, name) {
  if (!name) return null;
  const title = podPathTitle(name).toUpperCase();
  const file = title.endsWith(".BIN") ? title : `${title}.BIN`;
  const bytes = await vfs.read(`MODELS\\${file}`);
  return bytes ? decodeModel(bytes, file) : null;
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @param {string} trkName e.g. "bigfoot.trk"
 * @param {Uint8Array|null} fallbackPalette for textures without their own .ACT
 */
export async function buildTruckRender(vfs, trkName, fallbackPalette = null) {
  const title = podPathTitle(trkName).toUpperCase();
  const bytes = await vfs.read(`TRUCK\\${title.endsWith(".TRK") ? title : `${title}.TRK`}`);
  if (!bytes) return null;
  const { manifest } = parseTruckManifest(bytes, title);
  const tireBase = manifest.tireModelBaseName ?? "";
  const parts = {
    body: await model(vfs, manifest.truckModelBaseName),
    tireLeft: await model(vfs, `${tireBase}16L`),
    tireRight: await model(vfs, `${tireBase}16R`),
    axle: await model(vfs, manifest.axleModelName),
  };
  const anchors = MTM_WHEEL_KEYS.map((key) => {
    const a = manifest.wheelAnchors[key];
    return a ? [a.x, a.y, a.z] : null;
  });

  const textures = {};
  for (const part of Object.values(parts)) {
    for (const mesh of part?.meshes ?? []) {
      const name = mesh.textureName;
      if (!name || name in textures) continue;
      const source = await loadTextureSource(vfs, name, fallbackPalette);
      if (!source?.palette || !rawTextureSide(source.raw.length)) { textures[name] = null; continue; }
      const image = decodeRawTexture(source.raw, source.palette, { cutout: mesh.cutout });
      textures[name] = { width: image.width, height: image.height, rgba: image.rgba };
    }
  }
  return { file: title, name: manifest.truckName, parts, anchors, textures };
}
