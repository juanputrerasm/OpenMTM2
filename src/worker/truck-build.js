/*
  A truck's models for drawing (MONSTER_EXE_ANALYSIS.md section 3, 0x4bfa10).

  TRUCK\<name>.TRK names the parts: the body MODELS\<truckModelBaseName>.BIN, the tires
  MODELS\<tireModelBaseName>16L.BIN and 16R.BIN (the full-detail left and right tires; 10 and 08
  are the lower levels of detail), and the axle model. The four wheel anchors are the TRK's
  `static_bpos` values in body feet (FR, FL, RR, RL); a tire model is drawn with its origin there.
*/
import { MTM_WHEEL_KEYS, parseTruckManifest, podPathTitle } from "../vendor/openphotex/index.js";
import { decodeModel } from "./models.js";
import { artStem, loadAoMap, loadArtTexture, loadNormalMap } from "./art-texture.js";

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
 * @param {ReturnType<import("./palette-resolver.js").createPaletteResolver>} paletteResolver
 */
export async function buildTruckRender(vfs, trkName, paletteResolver) {
  const title = podPathTitle(trkName).toUpperCase();
  const bytes = await vfs.read(`TRUCK\\${title.endsWith(".TRK") ? title : `${title}.TRK`}`);
  if (!bytes) return null;
  const { manifest } = parseTruckManifest(bytes, title);
  const tireBase = manifest.tireModelBaseName ?? "";
  const parts = {
    body: await model(vfs, manifest.truckModelBaseName),
    tireLeft: await model(vfs, `${tireBase}16L`),
    tireRight: await model(vfs, `${tireBase}16R`),
    // Community Patch 3 trucks may carry a tire per corner (16FR, 16FL, 16RR, 16RL), used where present (JSTruckViewer).
    tireFR: await model(vfs, `${tireBase}16FR`), tireFL: await model(vfs, `${tireBase}16FL`),
    tireRR: await model(vfs, `${tireBase}16RR`), tireRL: await model(vfs, `${tireBase}16RL`),
    axle: await model(vfs, manifest.axleModelName),
    driveshaft: await model(vfs, "DRVSHAFT"),
  };
  // The suspension parts drawn between the axles and the body (game/suspension.js).
  const suspension = manifest.axlebarOffset && manifest.driveshaftPos ? {
    axlebar: manifest.axlebarOffset, driveshaft: manifest.driveshaftPos,
    shockTexture: (manifest.shockTextureName ?? "shock.raw").toUpperCase(), barTexture: (manifest.barTextureName ?? "axlebar.raw").toUpperCase(),
  } : null;
  const anchors = MTM_WHEEL_KEYS.map((key) => {
    const a = manifest.wheelAnchors[key];
    return a ? [a.x, a.y, a.z] : null;
  });

  const textures = {};
  for (const part of Object.values(parts)) {
    for (const mesh of part?.meshes ?? []) {
      const name = mesh.textureName;
      if (!name || name in textures) continue;
      textures[name] = await loadArtTexture(vfs, name, paletteResolver, { cutout: mesh.cutout });
      const normal = await loadNormalMap(vfs, name);
      if (normal) textures[`${artStem(name)}_N`] = normal;
      const ao = await loadAoMap(vfs, name);
      if (ao) textures[`${artStem(name)}_AO`] = ao;
    }
  }
  for (const name of suspension ? [suspension.shockTexture, suspension.barTexture] : []) {
    textures[name] = await loadArtTexture(vfs, name, paletteResolver);
  }
  // The lamps (game/truck-lights.js): each with its lens bitmap and, when it throws a beam, the cone's texture.
  const lights = (manifest.lights ?? []).map((l) => ({
    type: l.type ?? 0, pos: [l.pos?.x ?? 0, l.pos?.y ?? 0, l.pos?.z ?? 0], radius: l.bitmapRadius ?? 0,
    heading: l.heading ?? 0, pitch: l.pitch ?? 0, spin: l.spinSpeed ?? 0,
    coneLength: l.coneLength ?? 0, coneBase: l.coneBaseRadius ?? 0, coneRim: l.coneRimRadius ?? 0,
    coneTexture: (l.coneTexture ?? "").toUpperCase(), source: (l.sourceBitmap ?? "").toUpperCase(),
    msOn: l.msOn ?? 0, msOff: l.msOff ?? 0,
  }));
  const lightTextures = {};
  for (const name of new Set(lights.flatMap((l) => [l.source, l.coneLength > 0 ? l.coneTexture : ""]).filter(Boolean))) {
    lightTextures[name] = await loadArtTexture(vfs, name, paletteResolver);
  }
  const scrapePoints = (manifest.scrapePoints ?? []).map((v) => [v.x, v.y, v.z]);
  return { file: title, name: manifest.truckName, parts, anchors, scrapePoints, textures, suspension, lights, lightTextures };
}
