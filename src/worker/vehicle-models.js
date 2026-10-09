/*
  Whole models with their textures, for the things drawn apart from a track's own list: the blimp,
  the helicopter and the pterodactyl, the garage the truck preview stands in.
*/
import { decodeModel } from "./models.js";
import { loadArtTexture } from "./art-texture.js";

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
      textures[mesh.textureName] = await loadArtTexture(vfs, mesh.textureName, palettes, { cutout: mesh.cutout });
    }
  }
  return { models, textures };
}
