/*
  Community Patch 4's 3D cockpit for a truck (CP4_EXE_ANALYSIS.md 6), ready to draw (render/cockpit3d.js).

  The default layout is `DATA\_DEFAULT_CP.CPT` with its models in `MODELS\` and its art in `ART\` (CP4's cockpit.pod,
  which also holds the 2D cockpit's art). A truck's `.TRK` may name its own layout (game/cockpit3d.js
  `trkCockpitName`); which one it gets follows the engine's fallbacks (`resolveCockpit`). The models are decoded as a
  truck's are (models.js) and their textures found as a truck's are (art-texture.js: PNG, TGA, then RAW).

  The result is `{ layout, reason, models: { NAME.BIN: model }, textures: { name: image } }`, or null for the 2D
  cockpit: another game's vehicle or an MTM1 truck kept apart, no default layout, no default cab, or a truck the rules give the 2D cockpit.
*/
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import { parseCpt } from "../vendor/openphotex/mtm/cpt.js";
import { parseTruckManifest } from "../vendor/openphotex/truck/manifest.js";
import { DEFAULT_CPT, checkLayout, layoutModels, resolveCockpit, trkCockpitName } from "../game/cockpit3d.js";
import { decodeModel } from "./models.js";
import { artStem, loadAoMap, loadArtTexture, loadNormalMap } from "./art-texture.js";
import { parseForeignTruckId } from "./foreign-truck-build.js";
import { parseMtm1TruckId } from "./truck-build.js";

/** A .CPT checked, or null when it is missing or the engine refuses it (1..65536 bytes, VERSION 1). */
async function readLayout(vfs, name) {
  const bytes = await vfs.read(`DATA\\${podPathTitle(name).toUpperCase()}`);
  if (!bytes || bytes.length < 1 || bytes.length > 65536) return null;
  try {
    return checkLayout(parseCpt(bytes));
  } catch {
    return null;
  }
}

/** The layout a truck's cockpit is drawn from: `{ kind, layout, reason }` (game/cockpit3d.js `resolveCockpit`) and the models read. */
export async function resolveTruckCockpit(vfs, trkName) {
  const models = new Map();
  const readModel = async (name) => {
    const key = String(name).toUpperCase();
    if (!models.has(key)) {
      models.set(key, vfs.read(`MODELS\\${key}`).then((bytes) => {
        if (!bytes) return null;
        try { return decodeModel(bytes, key); } catch { return null; }
      }));
    }
    return models.get(key);
  };
  const base = await readLayout(vfs, DEFAULT_CPT);
  const file = podPathTitle(trkName).toUpperCase();
  const trkBytes = await vfs.read(`TRUCK\\${file.endsWith(".TRK") ? file : `${file}.TRK`}`);
  let cluster = null;
  if (trkBytes) {
    try { cluster = parseTruckManifest(trkBytes, file).manifest?.instrumentCluster ?? null; } catch { /* not a truck */ }
  }
  const named = trkCockpitName(trkBytes);
  const custom = named && podPathTitle(named).toUpperCase() !== DEFAULT_CPT ? await readLayout(vfs, named) : named ? base : null;
  // Every model either layout names, read at once, so the rules can ask which are there.
  const wanted = [...new Set([...layoutModels(base), ...layoutModels(custom)])];
  const decoded = await Promise.all(wanted.map(readModel));
  const found = new Set(wanted.filter((_, i) => decoded[i]?.meshes?.length));
  const resolved = resolveCockpit({ base, named, custom, cluster, hasModel: (name) => found.has(String(name).toUpperCase()) });
  return { ...resolved, models: Object.fromEntries(wanted.map((name, i) => [name, decoded[i]])) };
}

/**
 * The 3D cockpit for `trkName` (a truck's .TRK file), or null for the 2D one. `paletteResolver` finds a RAW texture's
 * palette (palette-resolver.js), as for the truck.
 */
export async function buildCockpit3d(vfs, trkName, paletteResolver) {
  // Another game's vehicle, or an MTM1 truck kept apart (truck-build.js), keeps the 2D cockpit, as before.
  if (!trkName || parseForeignTruckId(trkName) || parseMtm1TruckId(trkName)) return null;
  const resolved = await resolveTruckCockpit(vfs, trkName);
  if (resolved.kind !== "3d") return null;
  const { layout, reason } = resolved;
  const models = {};
  for (const name of [...new Set([layout.cab, layout.speedo?.model, layout.tach?.model, layout.wheel?.model, layout.shifter?.model, layout.shiftLight?.model, ...layout.gearLamps.map((l) => l?.model)].filter(Boolean))]) {
    if (resolved.models[name]) models[name] = resolved.models[name];
  }
  // Each texture the models name, with its normal and occlusion maps, as a truck's (truck-build.js).
  const wanted = new Map();
  for (const model of Object.values(models)) {
    for (const mesh of model.meshes) {
      for (const frame of (mesh.textureFrames ?? []).slice(1)) if (!wanted.has(frame)) wanted.set(frame, { cutout: mesh.cutout, maps: false });
      if (mesh.textureName && !wanted.has(mesh.textureName)) wanted.set(mesh.textureName, { cutout: mesh.cutout, maps: true });
    }
  }
  const loads = await Promise.all([...wanted].map(([name, { cutout, maps }]) => Promise.all([
    loadArtTexture(vfs, name, paletteResolver, { cutout }), maps ? loadNormalMap(vfs, name) : null, maps ? loadAoMap(vfs, name) : null,
  ])));
  const textures = {};
  [...wanted.keys()].forEach((name, i) => {
    const [image, normal, ao] = loads[i];
    textures[name] = image;
    if (normal) textures[`${artStem(name)}_N`] = normal;
    if (ao) textures[`${artStem(name)}_AO`] = ao;
  });
  return { layout, reason, models, textures };
}
