/** The Driver Check-in truck preview: the truck's models and the mini garage (`MODELS\GARAGE.BIN`) it stands in. */
import { buildTruckRender } from "./truck-build.js";
import { createPaletteResolver } from "./palette-resolver.js";
import { loadVehicleModels } from "./vehicle-models.js";

/** `winner` also loads the globe and crown (`MODELS/WINNER.BIN`). */
export async function buildTruckPreview(vfs, file, { winner = false } = {}) {
  const palettes = createPaletteResolver(vfs, "MTM2", null);
  const truck = await buildTruckRender(vfs, file, palettes);
  const garage = await loadVehicleModels(vfs, palettes, ["GARAGE.BIN"]);
  const crown = winner ? await loadVehicleModels(vfs, palettes, ["WINNER.BIN"]) : null;
  return {
    truck, garage: garage.models[0] ? { model: garage.models[0], textures: garage.textures } : null,
    winner: crown?.models[0] ? { model: crown.models[0], textures: crown.textures } : null,
  };
}
