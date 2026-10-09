/*
  Whole models with their textures, for the things drawn apart from a track's own list: the blimp,
  the helicopter and the pterodactyl, the garage the truck preview stands in.
*/
import { decodeRawTexture, rawTextureSide } from "../vendor/openphotex/index.js";
import { decodeModel } from "./models.js";
import { loadTextureSource } from "./level-load.js";

/**
 * `names` are `MODELS\` files, e.g. "HELI.BIN". Returns `{ models, textures }`: the models that decoded
 * to meshes, and every texture they use as `{ width, height, rgba }` (null when it cannot be decoded).
 */
export async function loadVehicleModels(vfs, palettes, names) {
  const models = [];
  for (const name of names) {
    const bytes = await vfs.read(`MODELS\\${name}`);
    const model = bytes ? decodeModel(bytes, name) : null;
    if (model?.meshes.length) models.push(model);
  }
  const textures = {};
  for (const model of models) {
    for (const mesh of model.meshes) {
      if (!mesh.textureName || mesh.textureName in textures) continue;
      const source = await loadTextureSource(vfs, mesh.textureName, palettes, "model");
      if (!source?.palette || !rawTextureSide(source.raw.length)) { textures[mesh.textureName] = null; continue; }
      const image = decodeRawTexture(source.raw, source.palette);
      textures[mesh.textureName] = { width: image.width, height: image.height, rgba: image.rgba };
    }
  }
  return { models, textures };
}
