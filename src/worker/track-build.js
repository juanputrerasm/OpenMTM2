/*
  Everything the renderer needs to draw a track, built in the asset worker.

  Reads the level (level-load.js), builds the terrain atlas and mesh (terrain-mesh.js),
  decodes every model the SIT places (models.js) and every texture those models use, and
  turns each SIT box into a scene transform. Pure apart from the VFS reads; the result is
  plain data with typed arrays, listed by `transferablesOf` for postMessage.
*/
import { decodeActPalette, decodeRawTexture, mtm2Sim, podPathTitle, rawTextureSide } from "../vendor/openphotex/index.js";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { loadLevel, loadTextureSource } from "./level-load.js";
import { buildTerrainAtlas, buildTerrainMesh, decodeTerrainTextures } from "./terrain-mesh.js";
import { decodeModel } from "./models.js";
import { buildGroundBoxMesh } from "./ground-box-mesh.js";
import { buildTruckRender } from "./truck-build.js";

const RAMP_TYPE = 99;
const CHECKPOINT_TYPE = 6;
const OLD_MTM_LEVEL = 4;

/**
 * Whether the game draws a box (MONSTER.EXE 0x54ec00, MONSTER_EXE_ANALYSIS.md section 4): it
 * needs a model and a priority within the detail level; a checkpoint only on an old MTM level,
 * and not a CKBOX-style marker (fourth letter O).
 */
export function boxIsDrawn(box, { levelType, raceType, detailLevel }) {
  if (!box.modelName || (box.priority ?? 0) > detailLevel) return false;
  if (box.type !== CHECKPOINT_TYPE) return true;
  const name = podPathTitle(box.modelName);
  return levelType === OLD_MTM_LEVEL && raceType !== "drag" && name[3] !== "O";
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @param {string} sitPath
 * @param {{ detailLevel?: number, raceType?: string }} [options]
 */
export async function buildTrackRender(vfs, sitPath, { detailLevel = 2, raceType = "circuit" } = {}) {
  const level = await loadLevel(vfs, sitPath);
  const { sit } = level;

  const sources = await Promise.all(level.textureNames.map((n) => loadTextureSource(vfs, n, level.palette)));
  const atlas = buildTerrainAtlas(decodeTerrainTextures(sources));
  // In a stadium the game draws only the cells inside its footprint (MONSTER.EXE 0x4f9ff0):
  // [x - sx/2, x + sx/2) by [z - sz/2, z + sz/2).
  const arena = sit.arena?.modelName ? sit.arena : null;
  const cells = arena ? {
    col0: arena.x - Math.trunc(arena.sx / 2), col1: arena.x + Math.trunc(arena.sx / 2),
    row0: arena.y - Math.trunc(arena.sy / 2), row1: arena.y + Math.trunc(arena.sy / 2),
  } : null;
  const mesh = buildTerrainMesh({ heights: level.heights, clr: level.clr, lte: level.lte, atlas, footprint: cells });
  const groundBoxes = buildGroundBoxMesh(level.groundBoxes, atlas, level.lte, level.heights, cells);

  // Models, once each.
  const models = {};
  const objects = [];
  for (const box of sit.boxes) {
    const name = box.modelName ? podPathTitle(box.modelName) : "";
    if (!name || box.type === RAMP_TYPE) continue;
    if (!boxIsDrawn(box, { levelType: level.lvl.levelType, raceType, detailLevel })) continue;
    if (!(name in models)) {
      const bytes = await vfs.read(`MODELS\\${name}`);
      models[name] = bytes ? decodeModel(bytes, name) : null;
    }
    if (!models[name] || !box.positionFt) continue;
    const m = mtm2Sim.eulerToMatrix(box.theta, box.phi, box.psi, new Array(9));
    objects.push({ model: name, type: box.type, matrix: toSceneMatrix(m, box.positionFt) });
  }

  // Collision boxes (MTM2_PHYSICS.md 14.15): every solid box, sized by its model's vertex
  // bounds when it has one. Drawn or not does not matter; the same priority rule applies.
  const boundsOf = {};
  const collisionBoxes = [];
  for (const box of sit.boxes) {
    if (box.type === RAMP_TYPE || !box.positionFt || !mtm2Sim.levelBoxCollides(box, detailLevel)) continue;
    const name = box.modelName ? podPathTitle(box.modelName) : "";
    if (name && !(name in boundsOf)) {
      const model = name in models ? models[name] : await vfs.read(`MODELS\\${name}`).then((b) => (b ? decodeModel(b, name) : null));
      boundsOf[name] = model?.bounds ?? null;
    }
    collisionBoxes.push({
      positionFt: box.positionFt, theta: box.theta, phi: box.phi, psi: box.psi, sizeFt: box.sizeFt,
      mass: box.mass, type: box.type, priority: box.priority ?? 0, bounds: name ? boundsOf[name] : null,
    });
  }

  // The stadium (SIT "*** Stadium ***", MONSTER.EXE 0x564ca0): at cell (x, z), unrotated, at
  // the ground height of its footprint's low corner.
  if (sit.arena?.modelName) {
    const name = podPathTitle(sit.arena.modelName);
    const bytes = await vfs.read(`MODELS\\${name}`);
    models[name] = bytes ? decodeModel(bytes, name) : null;
    if (models[name]) {
      const terrain = mtm2Sim.createTerrain(level.heights, level.waterLevelFt);
      const xFt = sit.arena.x * 32, zFt = sit.arena.y * 32;
      const y = mtm2Sim.groundHeightAt(terrain, xFt - sit.arena.sx * 16, zFt - sit.arena.sy * 16);
      objects.push({ model: name, type: "stadium", matrix: toSceneMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1], [xFt, y, zFt]) });
    }
  }

  // Model textures: cutout where any face using the texture is a cutout face.
  const textureUse = new Map();
  for (const model of Object.values(models)) {
    for (const mesh of model?.meshes ?? []) {
      if (!mesh.textureName) continue;
      textureUse.set(mesh.textureName, (textureUse.get(mesh.textureName) ?? false) || mesh.cutout);
    }
  }
  const modelTextures = {};
  for (const [name, cutout] of textureUse) {
    const source = await loadTextureSource(vfs, name, level.palette);
    if (!source || !rawTextureSide(source.raw.length)) continue;
    try {
      const image = decodeRawTexture(source.raw, source.palette, { cutout });
      modelTextures[name] = { width: image.width, height: image.height, rgba: image.rgba };
    } catch { /* an undecodable texture draws as the mesh colour */ }
  }

  const sky = await loadSky(vfs, level);

  // The SIT's start grid, as a preview of where the trucks stand.
  const truckModels = {};
  const trucks = [];
  for (const truck of sit.trucks.filter((t) => !t.playerSlot && t.positionFt)) {
    const file = podPathTitle(truck.name).toUpperCase();
    if (!(file in truckModels)) truckModels[file] = await buildTruckRender(vfs, file, level.palette);
    if (!truckModels[file]) continue;
    const m = mtm2Sim.eulerToMatrix(truck.theta, truck.phi, truck.psi, new Array(9));
    trucks.push({ file, matrix: toSceneMatrix(m, truck.positionFt) });
  }

  const course = sit.primaryCourse?.segments ?? [];
  return {
    title: level.title,
    trackName: sit.trackName,
    terrain: { ...mesh, atlas: { rgba: atlas.rgba, width: atlas.width, height: atlas.height } },
    groundBoxes,
    // A copy: a VFS read may be a view into a whole archive, which must not be transferred.
    heights: level.heights.slice(),
    waterLevelFt: level.waterLevelFt,
    /** A stadium level: no sky, no wrap, only the stadium's cells drawn. */
    stadium: cells,
    /** The LVL's sun direction (16.16, game frame), or null. */
    sunVector: level.lvl.sunVector,
    models,
    modelTextures,
    objects,
    truckModels,
    trucks,
    sky,
    /** For the simulation worker (copies; the render arrays are transferred separately). */
    sim: {
      clr: level.clr.slice(),
      textureValues: level.textureValues.slice(),
      ra0: level.groundBoxes.ra0 ? level.groundBoxes.ra0.slice() : null,
      ra1: level.groundBoxes.ra1 ? level.groundBoxes.ra1.slice() : null,
      boxes: collisionBoxes,
      start: trucks.length ? {
        file: trucks[0].file,
        pos: sit.trucks.find((t) => !t.playerSlot && t.positionFt)?.positionFt ?? null,
        heading: sit.trucks.find((t) => !t.playerSlot && t.positionFt)?.psi ?? 0,
      } : null,
    },
    /** A sensible first view: the start of the first course straight, in game feet. */
    viewpoint: course.length ? { start: course[0].startFt, end: course[0].endFt } : null,
  };
}

/** Sky art by weather (MONSTER.EXE 0x42b430); other weathers use the level's own sky. */
const WEATHER_SKIES = { 4: "CCLOUDS", 6: "DUSKSKY", 7: "NITESKY" };
const OLD_MTM_SKY = "CLOUDY2";

/**
 * The sky texture as the game draws it: the level's sky (or the weather's), its 16 colours
 * taken from entries 192-207 of the sky's .ACT and placed at entries 230-245 of the level
 * palette, which is where the sky art's indices point. Cloudy weather greys them (the game's
 * weights are not traced; a plain average here).
 */
export async function loadSky(vfs, level, weather = 0) {
  let stem = level.sky ? level.sky.name.replace(/\.RAW$/, "") : null;
  if (level.lvl.levelType === OLD_MTM_LEVEL) stem = OLD_MTM_SKY;
  if (WEATHER_SKIES[weather]) stem = WEATHER_SKIES[weather];
  if (!stem || !level.palette) return null;
  let raw = await vfs.read(`ART\\${stem}.RAW`);
  let act = await vfs.read(`ART\\${stem}.ACT`);
  if (!raw || !act) {
    raw = await vfs.read(`ART\\${OLD_MTM_SKY}.RAW`);
    act = await vfs.read(`ART\\${OLD_MTM_SKY}.ACT`);
  }
  if (!raw || !act || !rawTextureSide(raw.length)) return null;
  const palette = level.palette.slice();
  const colours = decodeActPalette(act);
  if (!colours) return null;
  palette.set(colours.subarray(192 * 3, 208 * 3), 230 * 3);
  if (weather === 1) {
    for (let i = 230 * 3; i < 246 * 3; i += 3) {
      const grey = Math.trunc((palette[i] + palette[i + 1] + palette[i + 2]) / 3);
      palette[i] = palette[i + 1] = palette[i + 2] = grey;
    }
  }
  const image = decodeRawTexture(raw, palette);
  return { name: stem, width: image.width, height: image.height, rgba: image.rgba };
}

/** Every ArrayBuffer in a build result, for postMessage's transfer list. */
export function transferablesOf(result) {
  const out = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (ArrayBuffer.isView(value)) { out.add(value.buffer); return; }
    for (const v of Array.isArray(value) ? value : Object.values(value)) visit(v);
  };
  visit(result);
  return [...out];
}
