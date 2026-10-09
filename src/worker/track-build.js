/*
  Everything the renderer needs to draw a track, built in the asset worker.

  Reads the level (level-load.js), builds the terrain atlas and mesh (terrain-mesh.js),
  decodes every model the SIT places (models.js) and every texture those models use, and
  turns each SIT box into a scene transform. Pure apart from the VFS reads; the result is
  plain data with typed arrays, listed by `transferablesOf` for postMessage.
*/
import { weatherSkyStem } from "../game/weather.js";
import { decodeActPalette, decodeRawTexture, mtm2Sim, podPathTitle, rawTextureSide } from "../vendor/openphotex/index.js";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { loadLevel, loadTextureSource } from "./level-load.js";
import { buildTerrainAtlas, buildTerrainMesh, decodeTerrainTextures } from "./terrain-mesh.js";
import { decodeModel } from "./models.js";
import { resolveKeyframeModel } from "./keyframes.js";
import { buildGroundBoxMesh } from "./ground-box-mesh.js";
import { buildTruckRender } from "./truck-build.js";
import { loadVehicleModels } from "./vehicle-models.js";
import { createPaletteResolver } from "./palette-resolver.js";

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
 * @param {{ detailLevel?: number, raceType?: string, truckFiles?: string[] }} [options] `truckFiles`: more trucks to build models for
 */
export async function buildTrackRender(vfs, sitPath, { detailLevel = 2, raceType = "circuit", truckFiles = [], weather = 0 } = {}) {
  const level = await loadLevel(vfs, sitPath);
  const { sit } = level;
  const palettes = createPaletteResolver(vfs, "MTM2", level.palette);

  const sources = await Promise.all(level.textureNames.map((n) => loadTextureSource(vfs, n, palettes, "terrain")));
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
  const decoded = new Map();
  const decodeNamed = async (name) => {
    const title = podPathTitle(name);
    if (!decoded.has(title)) decoded.set(title, vfs.read(`MODELS\\${title}`).then((bytes) => bytes ? decodeModel(bytes, title) : null));
    return decoded.get(title);
  };
  const loadModel = async (name) => {
    const title = podPathTitle(name);
    if (title in models) return models[title];
    const model = await decodeNamed(title);
    models[title] = await resolveKeyframeModel(model, decodeNamed);
    return models[title];
  };
  const objects = [];
  for (const [sitIndex, box] of sit.boxes.entries()) {
    const name = box.modelName ? podPathTitle(box.modelName) : "";
    if (!name || box.type === RAMP_TYPE) continue;
    if (!boxIsDrawn(box, { levelType: level.lvl.levelType, raceType, detailLevel })) continue;
    if (!(name in models)) await loadModel(name);
    if (!models[name] || !box.positionFt) continue;
    const m = mtm2Sim.eulerToMatrix(box.theta, box.phi, box.psi, new Array(9));
    objects.push({
      model: name, type: box.type, sitIndex, matrix: toSceneMatrix(m, box.positionFt),
      billboard: box.type === 8 || box.type === 9,
    });
  }

  // Backdrops are ordinary BIN assets with a special camera-centred draw policy.
  const backdrops = (sit.backdropModelNames ?? []).map(podPathTitle).filter(Boolean);
  for (const name of backdrops) await loadModel(name);

  // Collision boxes (MTM2_PHYSICS.md 14.15): every solid box, sized by its model's vertex
  // bounds when it has one. Drawn or not does not matter; the same priority rule applies.
  const boundsOf = {};
  const collisionBoxes = [];
  for (const [sitIndex, box] of sit.boxes.entries()) {
    if (box.type === RAMP_TYPE || !box.positionFt || !mtm2Sim.levelBoxCollides(box, detailLevel)) continue;
    const name = box.modelName ? podPathTitle(box.modelName) : "";
    if (name && !(name in boundsOf)) {
      const model = name in models ? models[name] : await loadModel(name);
      boundsOf[name] = model?.bounds ?? null;
    }
    collisionBoxes.push({
      positionFt: box.positionFt, theta: box.theta, phi: box.phi, psi: box.psi, sizeFt: box.sizeFt,
      mass: box.mass, type: box.type, priority: box.priority ?? 0, bounds: name ? boundsOf[name] : null, sitIndex,
      bvel: box.type === 10 && box.bvel ? [...box.bvel] : null,
      hitSound: box.hitSound ?? null, modelName: name,
    });
  }

  // Objects that make a sound of their own (SIT "@sound effect entries", second name): a train's
  // rumble, a crossing's bell, a stand's crowd. Moving ones carry on from the poses the sim sends.
  const soundObjects = [];
  for (const [sitIndex, box] of sit.boxes.entries()) {
    if (!box.loopSound || !box.positionFt) continue;
    soundObjects.push({ sitIndex, positionFt: box.positionFt, sound: box.loopSound, moving: box.type === 10, model: box.modelName ? podPathTitle(box.modelName) : "" });
  }

  // Checkpoint models, for their extents (they are not collision boxes).
  for (const box of sit.boxes) {
    if (box.type !== 6 || !box.modelName) continue;
    const name = podPathTitle(box.modelName);
    if (name in boundsOf) continue;
    const model = name in models ? models[name] : await loadModel(name);
    boundsOf[name] = model?.bounds ?? null;
  }

  // Ramps (MTM2_PHYSICS.md 14.19): wedges whose tops the height query knows.
  const ramps = [];
  for (const box of sit.boxes) {
    if (box.type !== RAMP_TYPE || !box.positionFt) continue;
    const name = box.modelName ? podPathTitle(box.modelName) : "";
    if (name && !(name in boundsOf)) {
      const model = name in models ? models[name] : await loadModel(name);
      boundsOf[name] = model?.bounds ?? null;
    }
    ramps.push({ positionFt: box.positionFt, theta: box.theta, phi: box.phi, psi: box.psi, sizeFt: box.sizeFt, mass: box.mass, bounds: name ? boundsOf[name] : null });
  }

  // The stadium (SIT "*** Stadium ***", MONSTER.EXE 0x564ca0): at cell (x, z), unrotated, at
  // the ground height of its footprint's low corner.
  if (sit.arena?.modelName) {
    const name = podPathTitle(sit.arena.modelName);
    models[name] = await loadModel(name);
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
    const source = await loadTextureSource(vfs, name, palettes, "model");
    if (!source || !rawTextureSide(source.raw.length)) continue;
    try {
      const image = decodeRawTexture(source.raw, source.palette, { cutout });
      modelTextures[name] = { width: image.width, height: image.height, rgba: image.rgba };
    } catch { /* an undecodable texture draws as the mesh colour */ }
  }

  // The blimp (game/blimp.js) and the recovery helicopter (game/heli-flight.js): GOODY.BIN, HELI.BIN and the
  // pterodactyl's four wing frames (TERYL.BIN lists TERYL1 to TERYL4), each with its textures.
  const loadVehicle = (names) => loadVehicleModels(vfs, palettes, names);
  const goody = await loadVehicle(["GOODY.BIN"]);
  const blimp = goody.models.length ? { model: goody.models[0], textures: goody.textures } : null;
  // The pterodactyl is an animated BIN: TERYL.BIN lists four wing frames that become morph targets of the first.
  const heliBytes = await vfs.read("MODELS\\TERYL.BIN");
  const terylList = heliBytes ? decodeModel(heliBytes, "TERYL.BIN") : null;
  const terylNames = (terylList?.frameNames ?? []).map((n) => n.toUpperCase());
  const helicopter = await loadVehicle(["HELI.BIN", ...terylNames]);
  const frameOf = async (name) => helicopter.models.find((m) => m.name === name.toUpperCase()) ?? null;
  const teryl = terylList ? await resolveKeyframeModel(terylList, frameOf) : null;
  const heliModel = helicopter.models.find((m) => m.name === "HELI.BIN") ?? null;
  const heli = heliModel || teryl?.meshes?.length ? { heli: heliModel, teryl: teryl?.meshes?.length ? teryl : null, textures: helicopter.textures } : null;

  const sky = await loadSky(vfs, level, weather);

  // The SIT's start grid, as a preview of where the trucks stand.
  const truckModels = {};
  const trucks = [];
  for (const truck of sit.trucks.filter((t) => !t.playerSlot && t.positionFt)) {
    const file = podPathTitle(truck.name).toUpperCase();
    if (!(file in truckModels)) truckModels[file] = await buildTruckRender(vfs, file, palettes);
    if (!truckModels[file]) continue;
    const m = mtm2Sim.eulerToMatrix(truck.theta, truck.phi, truck.psi, new Array(9));
    trucks.push({ file, matrix: toSceneMatrix(m, truck.positionFt) });
  }
  // The trucks a race puts on the grid instead (the player's pick and the CPU trucks).
  for (const file of truckFiles.map((f) => podPathTitle(f).toUpperCase())) {
    if (!(file in truckModels)) truckModels[file] = await buildTruckRender(vfs, file, palettes);
  }

  const course = sit.primaryCourse?.segments ?? [];
  return {
    title: level.title,
    /** The level's music file in MUSIC.POD (the LVL names it), e.g. "farm.wav"; null when it names none. */
    musicName: level.lvl.musicName ?? null,
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
    soundObjects,
    modelTextures,
    objects,
    blimp, heli,
    /** Where each SIT box started (x, y, z feet, theta, phi, psi): the replay file's `Original object locations`. */
    originals: sit.boxes.map((b) => (b.positionFt ? [b.positionFt[0], b.positionFt[1], b.positionFt[2], b.theta ?? 0, b.phi ?? 0, b.psi ?? 0] : [0, 0, 0, 0, 0, 0])),
    backdrops,
    truckModels,
    trucks,
    sky,
    /**
     * The start lights' fill colours (MONSTER_EXE_ANALYSIS.md 6.1): level palette indices 0
     * (off), 1 (the red lamps' colour) and 2 (the green lamps'), as RGB.
     */
    startLightColours: level.palette ? [0, 1, 2].map((i) => Array.from(level.palette.subarray(i * 3, i * 3 + 3))) : null,
    /** For the simulation worker (copies; the render arrays are transferred separately). */
    sim: {
      clr: level.clr.slice(),
      textureValues: level.textureValues.slice(),
      ra0: level.groundBoxes.ra0 ? level.groundBoxes.ra0.slice() : null,
      ra1: level.groundBoxes.ra1 ? level.groundBoxes.ra1.slice() : null,
      boxes: collisionBoxes,
      ramps,
      /** The primary course's straights (MTM2_PHYSICS.md 12); the session builds the arcs. */
      course: (sit.primaryCourse?.segments ?? []).map((g) => ({
        startFt: g.startFt, endFt: g.endFt, ctype: g.ctype, cspeedType: g.cspeedType, cdecPoint: g.cdecPoint,
        cspeed: g.cspeed, speedLimit: g.speedLimit, trackWidthFt: g.trackWidthFt,
      })),
      sonicTrack: !!sit.sonicTrack,
      /** The start grid in file order (game feet), each with its truck file. */
      grid: sit.trucks.filter((t) => !t.playerSlot && t.positionFt).map((t) => ({
        file: podPathTitle(t.name).toUpperCase(), pos: t.positionFt, heading: t.psi,
      })),
      /** The checkpoints, gate and detector (MONSTER_EXE_ANALYSIS.md 6.2), sized by their models. */
      checkpoints: mtm2Sim.buildCheckpoints(sit.boxes, (name) => {
        const b = boundsOf[podPathTitle(name)];
        return b ? [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] : null;
      }),
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

const OLD_MTM_SKY = "CLOUDY2";

/** Just a track's sky for a weather, when the weather changes in a race (GOLD mode). */
export async function buildSky(vfs, sitPath, weather) {
  return loadSky(vfs, await loadLevel(vfs, sitPath), weather);
}

/**
 * The sky texture as the game draws it: the level's sky (or the weather's), its 16 colours
 * taken from entries 192-207 of the sky's .ACT and placed at entries 230-245 of the level
 * palette, which is where the sky art's indices point. Cloudy weather greys them (the game's
 * weights are not traced; a plain average here).
 */
export async function loadSky(vfs, level, weather = 0) {
  let stem = level.sky ? level.sky.name.replace(/\.RAW$/, "") : null;
  if (level.lvl.levelType === OLD_MTM_LEVEL) stem = OLD_MTM_SKY;
  stem = weatherSkyStem(weather, stem);
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
