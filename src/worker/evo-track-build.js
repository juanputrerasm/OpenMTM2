/*
  A 4x4 Evolution 1 or 2 track, built into what a race draws and simulates: the same result
  worker/track-build.js gives for an MTM2 track, so the race screen needs nothing of its own.

  The files (JSTrackViewer's docs/4X4_EVO_TRACK_RENDERING_ANALYSIS.md, OpenPhotex docs/EVO.md):

    WORLD\<track>.SIT       the scene: placements, the starting grid, the courses
      LEVELS\<track>.LVL    the terrain manifest: grids, texture table, sky, water
        DATA\<track>.RAW    heights, 16 bits a corner, 1/32 ft (looked up in DATA first: Evo 1
                            also ships ART\<track>.RAW, the track's logo)
        DATA\<track>.CLR    the tile each cell draws
        DATA\<track>.TEX    the tile textures (the ordinary group is what the .CLR indexes)
      MODELS\*.SMF          models, with ART\*.RAW + .ACT (+ .OPA) or ART\*.TIF
      DATA\<track>.VEG      Evo 2's trees
      AI\CLASSc\AI_cn<track>.TXT   recorded laps, which say what part of the course is the lap

  Evo's world is MTM2's: 256 cells of 32 ft, x, height, z, the same headings. A placement's
  `wOrient` is (pitch, roll, heading), which is the game's theta, phi, psi.

  What 4x4 Evolution 2 does (docs/EVO2_EXE_ANALYSIS.md):
    - Each texture's surface is the first number of its .TEX record (MTM2's type * 100 + depth),
      and water lies under the level's water height (4.1, 4.2).
    - Trees stand in 512 ft sectors; a tree's model slot is its index in its sector & 3, its yaw
      its byte * pi / 128, and its model's base is drawn at its stored height + treeBiasY (2.2).
      A level without a .VEG gets trees generated from each texture's vegetation class (2.3).
    - The .RTD shade map darkens the terrain to 0.35 and the .SDW swaps a cell's tile for its
      pre-shadowed copy from the .TEX shadow group, under a sun (3.1, 3.2).
    - Grass is drawn per cell from a fixed pattern by the texture's vegetation class (2.4):
      `grass` hands the renderer what it needs.

  What the port decides, since Evo's own rules are not known here:
    - Eight trucks at most race; the physics is the one the race picks (Options, Game).
    - Objects collide as the SIT says (`collisionOf`): rocks are driven on by their own
      surface, authored collision boxes are decks or obstacles, the rest are upright boxes
      around their models, trees their trunks alone. A boxed object the course runs through
      (a bridge, an arch, a tunnel mouth) is driven on by its surface: a box would close the road.
    - A gate is at least GATE_MIN wide and tall, and is turned to face the way the course runs.
    - The sky and the weathers are MTM2's. The world wraps at its edges, as MTM2's does.

    - A generated forest takes the level's own tree models (Evo's default deftree.smf ships in no
      install), the game's default sizes and spacing, and a seed from the track's name.
    - Shade and shadow tiles are drawn in Clear, Cloudy and Dusk weather (Evo's weather numbers
      for its own test are not all identified), and only where the port draws no sun shadows of
      its own (the enhanced look's would shade the same ground twice).
    - A truck that meets a tree knocks it over (2.5) and goes on: the game's effect on the truck and the fall's motion
      are not traced, so the tree simply topples away from the truck (render side) and stops counting.

  Not drawn yet: the `.WAT` water animation.
*/
import { EVO_SDW_NONE, EVO_SHADE_LIGHT, evoGenerateTrees, evoGrassPattern, evoShadeAt, parseEvoRtd, parseEvoSdw } from "../vendor/openphotex/evo/vegetation.js";
import { decodeActPalette } from "../vendor/openphotex/texture/act.js";
import { decodeRawTexture, rawTextureSide } from "../vendor/openphotex/texture/raw.js";
import { evoTreeSlot, evoTreeYaw, parseEvoVeg } from "../vendor/openphotex/evo/veg.js";
import { lapRuns, matchEvoAiLineName, parseEvoAiLine } from "../vendor/openphotex/evo/ai-line.js";
import { parseEvoLvl } from "../vendor/openphotex/evo/lvl.js";
import { parseEvoScript } from "../vendor/openphotex/evo/script.js";
import { parseEvoSit } from "../vendor/openphotex/evo/sit.js";
import { parseEvoTex } from "../vendor/openphotex/evo/tex.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import * as evoSim from "../vendor/openphotex/sim/evo/index.js";
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";
import { weatherSkyStem } from "../game/weather.js";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { alongCourse } from "./cpr-road.js";
import { decodeSmfModel, loadEvoModelTextures, loadEvoTexture } from "./evo-models.js";
import { createPaletteResolver } from "./palette-resolver.js";
import { loadHdSky } from "./weather-art.js";
import { buildFineTerrainMesh, buildTerrainAtlas, buildTerrainMesh } from "./terrain-mesh.js";
import { loadRaceVehicles } from "./track-build.js";
import { buildTrucks, cachedTruckRender } from "./truck-build.js";

const GRID = 256;
const MTM_SKY = "CLOUDY2";
/** A course whose last straight ends further than this from its first one's start does not close: a one-way rally. */
const OPEN_COURSE_GAP_FT = 1000;
const HEIGHT_DIVISOR = 32;
const WATER_DIVISOR = 2;
const MAX_GRID = 8;
/** How high over the ground a truck's body is set on the grid, as on MTM2's own grids. */
const GRID_RIDE_FT = 6;
const CHECKPOINT_TYPE = 6;
/** A gate's least width and height, and its least length along the course, in feet. */
const GATE_MIN_WIDTH_FT = 120, GATE_MIN_HEIGHT_FT = 60, GATE_MIN_LENGTH_FT = 32;
/** A tree's trunk as a collision box: its side in feet. */
const TRUNK_FT = 2;
/** Dirt, as the simulation's surface value (type 2, depth 0). */
const DIRT = 200;
/** How far apart the course is sampled to find the objects it runs through, in feet. */
const COURSE_SAMPLE_FT = 8;

const stemOf = (name) => podPathTitle(name).toUpperCase().replace(/\.[^.]*$/, "");
const isCheckpoint = (box) => box.sourceClass === "CCheckpoint" || box.boxType === CHECKPOINT_TYPE;
const isFacing = (box) => box.sourceClass === "CNonCollideFacing" || box.boxType === 8;
/** Rocks, as a surface value. */
const ROCKS = 1200;
/** The trunk box of an Evo 1 tree, whose own box sizes are not read: its height. */
const TRUNK_HEIGHT_FT = 20;
/** A tree card's inset into its quarter of the sheet, as the grass's (render/evo-grass.js), so no neighbour bleeds in. */
const CARD_UV_INSET = 0.0078125;
/** Weathers with a sun, where the shade map and the shadow tiles show (OpenPhotex WEATHER: Clear, Cloudy, Dusk). */
const SUNNY = new Set([0, 1, 6]);
/** The .VEG the game assumes when a level has none (0x673538 and following). */
const DEFAULT_VEG = Object.freeze({
  maxTrees: 20000, treeLine: 1000, minDistanceSquared: { sparse: 10000, medium: 1600, dense: 400 },
  treeSizes: [0, 1, 2, 3].map(() => ({ sizeX: 80, sizeY: 128, biasY: -28 })),
  vegSizes: [0, 1, 2, 3].map(() => ({ min: 2, max: 4, bias: 0 })),
});
/** Tree models of 4x4 Evolution 2 a generated forest may borrow when a level has none of its own. */
const EVO2_TREE_MODELS = ["PINE80.SMF", "PINE100.SMF"];
/** A stable seed from a track's name. */
const seedOf = (name) => [...name].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);

/**
 * How an object collides, from what the SIT says of it:
 *
 *   Evo 2 (classes)   CCollide with `collisionType` 1 is driven on by its own surface ("mesh"): in the stock tracks
 *                     that is every rock and coral, and nothing else. CCollide with 0 is a box around its model.
 *                     CCollisionBox has no model: it is the box itself. Every other class (CNonCollide, CCheckpoint,
 *                     CTreasure, flying objects) is passed through.
 *   Evo 1 (MTM types) 6 checkpoint, 7 drive-through, 8 facing and 12 (the trees, which carry a model-less child box
 *                     for their trunk) are passed through; a model-less child box is a trunk; the rest are boxes.
 */
function collisionOf(box, hasModel) {
  const cls = box.sourceClass ?? "";
  if (cls && cls !== "Box") {
    if (cls === "CCollisionBox") return "box";
    if (cls !== "CCollide") return "none";
    return String(box.sourceFields?.collisionType ?? "0").trim() === "1" ? "mesh" : "box";
  }
  if ([6, 7, 8, 12].includes(box.boxType)) return "none";
  if (!hasModel) return box.parent ? "trunk" : "none";
  return "box";
}
const isTree = (name) => /TREE|PINE|PALM|JUNGLE|BUSH|SHRUB|PLANT/i.test(name ?? "");

/** Faces steeper than this from level (its normal's upward part under cos 50 degrees) are walls. */
const WALL_NORMAL_Y = Math.cos((50 * Math.PI) / 180);
/**
 * A steep triangle (world points `w`, game feet) as a wall face for the simulation (OpenPhotex `createFace`): its
 * corners and the way out of it (`out`, from the model's own normals), or null for a face that is not steep or too
 * small. The simulation meets the triangle itself: nothing of it reaches past its edges.
 */
function steepFace(w, out) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const n = cross(sub(w[1], w[0]), sub(w[2], w[0]));
  const area = Math.hypot(...n);
  if (!(area > 0.25) || Math.abs(n[1] / area) >= WALL_NORMAL_Y) return null;
  return [...w[0], ...w[1], ...w[2], ...out];
}

/** One of the level's 256 x 256 16-bit grids, from DATA\, or null. */
async function readGrid(vfs, name, stem, extension) {
  const bytes = (name ? await vfs.read(`DATA\\${podPathTitle(name)}`) : null) ?? (await vfs.read(`DATA\\${stem}${extension}`));
  return bytes && bytes.length === GRID * GRID * 2 ? bytes : null;
}

async function loadEvoLevel(vfs, sitPath, sitBytes) {
  const title = podPathTitle(sitPath);
  const sit = parseEvoSit(sitBytes, title);
  const stem = stemOf(title);
  const lvlName = sit.lvlName ? podPathTitle(sit.lvlName) : `${stem}.LVL`;
  const lvlBytes = (await vfs.read(`LEVELS\\${lvlName}`)) ?? (await vfs.read(`LEVELS\\${stem}.LVL`));
  // A Lite track borrows its level from a stock world, which has to be installed.
  if (!lvlBytes && /\.LTE$/i.test(title)) throw new Error(`This Lite track is built on ${stemOf(lvlName)} from 4x4 Evolution: add the POD that holds LEVELS\\${lvlName}.`);
  if (!lvlBytes) throw new Error(`LEVELS\\${lvlName} is missing.`);
  return { title, stem, sit, lvl: parseEvoLvl(lvlBytes, lvlName) };
}

/**
 * MTM2's sky for the weather, as on its own old levels (its 16 colours sit at 192 to 207 of its palette, drawn from 230 on).
 * With "CP3 HD weather" (`hdWeather`) the HD sky art first, as on an MTM2 track (worker/weather-art.js `loadHdSky`).
 */
async function loadEvoSky(vfs, lvl, weather, { hdWeather = false } = {}) {
  const stem = weatherSkyStem(weather, MTM_SKY);
  if (stem) {
    const mtm = vfs.scoped?.("MTM") ?? vfs;
    const hd = await loadHdSky(mtm, stem, weather, { on: hdWeather });
    if (hd) return hd;
    const raw = await mtm.read(`ART\\${stem}.RAW`), act = await mtm.read(`ART\\${stem}.ACT`);
    const colours = act && decodeActPalette(act);
    if (raw && colours && rawTextureSide(raw.length)) {
      const palette = colours.slice();
      palette.set(colours.subarray(192 * 3, 208 * 3), 230 * 3);
      const image = decodeRawTexture(raw, palette);
      return { name: stem, width: image.width, height: image.height, rgba: image.rgba };
    }
  }
  const own = lvl.skyName ? await loadEvoTexture(vfs, lvl.skyName) : null;
  return own ? { name: stemOf(lvl.skyName), width: own.width, height: own.height, rgba: own.rgba } : null;
}

export async function buildEvoSky(vfs, sitPath, sitBytes, weather, { hdWeather = false } = {}) {
  const { lvl } = await loadEvoLevel(vfs, sitPath, sitBytes);
  return loadEvoSky(vfs, lvl, weather, { hdWeather });
}

/** The recorded laps of a track, each distinct one once (OpenPhotex `parseEvoAiLine`). */
async function loadAiLines(vfs, stem) {
  const seen = new Set();
  const lines = [];
  for (const { path, mount, entry } of vfs.list(".TXT")) {
    if (!matchEvoAiLineName(path, stem)) continue;
    const bytes = await mount.readEntry(entry);
    const key = new TextDecoder("latin1").decode(bytes);
    if (seen.has(key)) continue;
    seen.add(key);
    const line = parseEvoAiLine(bytes);
    if (line.points.length >= 2) lines.push(line);
  }
  return lines;
}

/** A model's scene matrix scaled along its own axes (column-major, as toSceneMatrix writes it). */
function scaled(matrix, sx, sy, sz) {
  for (let i = 0; i < 3; i++) { matrix[i] *= sx; matrix[4 + i] *= sy; matrix[8 + i] *= sz; }
  return matrix;
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs the track's own view of the archives
 * @param {string} sitPath
 * @param {Uint8Array} sitBytes
 */
/**
 * `lite`: a 4x4 Evolution 1 Lite track (OpenPhotex `parseEvoLte`, docs/EVO2_EXE_ANALYSIS.md 5b), whose heights and tiles
 * stand in for the .RAW and .CLR, and whose base world gives the .TEX.
 */
export async function buildEvoTrackRender(vfs, sitPath, sitBytes, { truckFiles = [], weather = 0, hdWeather = false, tileOverlap = true, forest = true, sunShadows = false, smoothTerrain = false, lite = null } = {}) {
  const { title, stem, sit, lvl } = await loadEvoLevel(vfs, sitPath, sitBytes);
  const game = `EVO${sit.game}`;
  const mtm = vfs.scoped?.("MTM") ?? vfs;
  const missing = new Set();

  // Terrain.
  const rawHeights = lite ? null : await readGrid(vfs, lvl.heightName, stem, ".RAW");
  if (!lite && !rawHeights) throw new Error(`${lvl.heightName || `${stem}.RAW`}: not a 256 x 256 heightfield.`);
  const rawCorners = lite ? lite.heights : Uint16Array.from({ length: GRID * GRID }, (_, i) => rawHeights[i * 2] | (rawHeights[i * 2 + 1] << 8));
  const heightsFt = Float32Array.from(rawCorners, (v) => v / HEIGHT_DIVISOR);
  const clrBytes = lite ? null : await readGrid(vfs, lvl.clrName, stem, ".CLR");
  const clr = lite ? Uint16Array.from(lite.tiles) : new Uint16Array(GRID * GRID);
  if (clrBytes) for (let i = 0; i < clr.length; i++) clr[i] = clrBytes[i * 2] | (clrBytes[i * 2 + 1] << 8);
  // A Lite track's tiles are its base world's (`<base>.tex`).
  const texBytes = (lite ? await vfs.read(`DATA\\${lite.baseWorld.toUpperCase()}.TEX`) : null)
    ?? (lvl.texName ? await vfs.read(`DATA\\${podPathTitle(lvl.texName)}`) : null) ?? (await vfs.read(`DATA\\${stem}.TEX`));
  const tex = texBytes ? parseEvoTex(texBytes, `${stem}.TEX`) : { ordinary: [] };
  const tiles = [];
  for (const record of tex.ordinary) {
    const image = await loadEvoTexture(vfs, record.name);
    if (!image) missing.add(`ART\\${podPathTitle(record.name)}`);
    tiles.push(image);
  }
  // Under a sun, the .SDW swaps a cell's tile for its copy with the shadow painted in (the .TEX shadow group, whose
  // indices run on from the ordinary group's); the simulation keeps the .CLR's surfaces.
  const sunny = SUNNY.has(weather);
  // Where the port draws the sun's shadows (`sunShadows`, the enhanced look), the painted ones would shade the ground a
  // second time under them: the shadow tiles and the shade map are left off, as MTM2's .LTE is in that look.
  const painted = sunny && !sunShadows;
  const sdwBytes = painted && tex.shadow?.length ? await vfs.read(`DATA\\${stem}.SDW`) : null;
  const sdw = sdwBytes ? parseEvoSdw(sdwBytes) : null;
  let drawnClr = clr;
  // What ground each drawn tile is, for the ground's grain and dust (render/scenery.js): a shadow tile is the ground of the
  // tile it stands in for (the shadow group's own surface numbers are not reliable: 0 or one value for all).
  const surfaceOf = (slot) => tex.ordinary[slot]?.surfaceValue ?? tex.ordinary[slot]?.param0 ?? DIRT;
  let slotValues = null;
  if (sdw) {
    for (const record of tex.shadow) tiles.push(await loadEvoTexture(vfs, record.name));
    drawnClr = clr.slice();
    slotValues = Int32Array.from(tiles, (_, slot) => (slot < tex.ordinary.length ? surfaceOf(slot) : DIRT));
    const valued = new Uint8Array(tiles.length);
    for (let i = 0; i < drawnClr.length; i++) {
      const word = sdw[i];
      if (word === EVO_SDW_NONE || word >= tiles.length || !tiles[word]) continue;
      // The cell keeps its turn and mirror (bits 12-15).
      drawnClr[i] = (clr[i] & 0xf000) | word;
      if (!valued[word]) { valued[word] = 1; slotValues[word] = surfaceOf(clr[i] & 0xfff); }
    }
  }
  const atlas = buildTerrainAtlas(tiles);
  // The tiles overlap by two pixels at each edge, as MTM2's do.
  // 4x4 Evolution 2 at its high detail smooths the ground into a 4 x 4 grid a cell, and drives on it too
  // (docs/EVO2_EXE_ANALYSIS.md 5a): with "Smooth terrain" the port does both.
  const fineFt = smoothTerrain && sit.game === 2 ? Float32Array.from(evoSim.evoSmoothHeights(rawCorners), (v) => v / HEIGHT_DIVISOR) : null;
  const tileInset = tileOverlap === false ? 0 : 2;
  const mesh = fineFt
    ? buildFineTerrainMesh({ fineFt, sub: evoSim.EVO_SUB, clr: drawnClr, atlas, tileInset })
    : buildTerrainMesh({ heights: null, heightsFt, clr: drawnClr, lte: null, atlas, tileInset });
  // A zero-opacity water colour declares a height but draws no water.
  const waterLevelFt = lvl.water && lvl.water.color?.[3] > 0 && lvl.water.height > 0 ? lvl.water.height / WATER_DIVISOR : null;
  const terrain = mtm2Sim.createTerrainFt(heightsFt, waterLevelFt, fineFt);
  const groundAt = (x, z) => mtm2Sim.terrainHeightAt(terrain, x, z);
  // The shade map (.RTD): under a sun, a vertex in shade takes 0.35 of the light; under water the light fades to nothing
  // over 50 ft (0x46c030). The mesh's vertices are in scene feet with z mirrored (shared/scene-frame.js).
  const rtdBytes = painted ? await vfs.read(`DATA\\${stem}.RTD`) : null;
  const rtd = rtdBytes ? parseEvoRtd(rtdBytes) : null;
  let shaded = false;
  if (rtd || waterLevelFt !== null) {
    const { positions, shade } = mesh;
    for (let v = 0; v < shade.length; v++) {
      const x = positions[v * 3], y = positions[v * 3 + 1], z = -positions[v * 3 + 2];
      let light = rtd && evoShadeAt(rtd, x, z) ? EVO_SHADE_LIGHT : 1;
      if (waterLevelFt !== null && y < waterLevelFt) light *= 1 - Math.min(50, waterLevelFt - y) / 50;
      if (light !== 1) shaded = true;
      shade[v] = light;
    }
  }

  // Vegetation: the level's .VEG, or the game's defaults with a generated forest (2.3).
  const vegBytes = await vfs.read(`DATA\\${stem}.VEG`);
  let veg = null;
  try { veg = vegBytes ? parseEvoVeg(vegBytes, `${stem}.VEG`) : null; } catch { veg = null; }
  const vegClassOfCell = new Uint8Array(GRID * GRID);
  for (let i = 0; i < vegClassOfCell.length; i++) vegClassOfCell[i] = tex.ordinary[clr[i] & 0xfff]?.vegClass ?? 0;
  const cellOf = (x, z) => ((Math.floor(z / 32) & 255) << 8) | (Math.floor(x / 32) & 255);

  // Models, once each.
  const models = {};
  const modelFile = (name) => { const t = podPathTitle(name).toUpperCase(); return /\.[^.]+$/.test(t) ? t : `${t}.SMF`; };
  const loadModel = async (name) => {
    const file = modelFile(name);
    if (file in models) return models[file];
    const bytes = await vfs.read(`MODELS\\${file}`);
    if (!bytes) missing.add(`MODELS\\${file}`);
    try { models[file] = bytes ? decodeSmfModel(bytes, file) : null; } catch { models[file] = null; }
    return models[file];
  };
  for (const box of sit.boxes) if (box.modelName) await loadModel(box.modelName);
  for (const name of veg?.treeModels ?? []) if (name) await loadModel(name);
  // A level without a .VEG: its own tree models (Evo 1's trees are SIT objects), else Evo 2's pines when installed.
  let forestModels = [];
  if (!veg) {
    forestModels = [...new Set(sit.boxes.map((b) => (b.modelName ? modelFile(b.modelName) : "")).filter((f) => isTree(f) && models[f]?.meshes.length))];
    if (!forestModels.length) {
      for (const name of EVO2_TREE_MODELS) if ((await loadModel(name))?.meshes.length) forestModels.push(name);
    }
  }
  // AI life's bird (game/evo-life.js): LIFE.POD's, on a level of either game where it is installed.
  const birdModel = (await vfs.read("MODELS\\BIRD.SMF")) ? await loadModel("BIRD.SMF") : null;
  for (const file of Object.keys(models)) if (!models[file]?.meshes.length) delete models[file];
  const modelTextures = await loadEvoModelTextures(vfs, models, missing);

  // The course: the first one, cut to the lap by the recorded laps.
  const aiLines = await loadAiLines(vfs, stem);
  const runs = lapRuns(sit.courses[0]?.segments ?? [], aiLines);
  // AI life (game/evo-life.js): the flocks follow the computer drivers' line (the game's AI path), and start at a checkpoint
  // without one; the game has none on a level of fewer than 3 checkpoints.
  const checkpointPositions = sit.boxes.filter((b) => isCheckpoint(b) && b.position).map((b) => [...b.position]);
  const life = birdModel?.meshes.length && checkpointPositions.length >= 3
    ? { model: "BIRD.SMF", path: (aiLines[0]?.points ?? []).map((p) => [p[0], p[1], p[2]]), checkpoints: checkpointPositions }
    : null;
  const course = runs.map((g) => ({
    startFt: [g.start[0], g.start[1], g.start[2]], endFt: [g.end[0], g.end[1], g.end[2]],
    // As MTM2's stock straights are written; Evo's own speed limits are in units not known here, so none is taken.
    ctype: 1, cspeedType: 0, cdecPoint: 30, cspeed: 0, speedLimit: 0, trackWidthFt: g.trackWidth || 32,
  }));
  const courseOpen = course.length > 1 && Math.hypot(
    course[0].startFt[0] - course[course.length - 1].endFt[0], course[0].startFt[2] - course[course.length - 1].endFt[2]) > OPEN_COURSE_GAP_FT;
  const samples = [];
  course.forEach((g, i) => {
    for (const [a, b] of [[g.startFt, g.endFt], [g.endFt, course[(i + 1) % course.length].startFt]]) {
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / COURSE_SAMPLE_FT));
      for (let k = 0; k < steps; k++) samples.push([a[0] + ((b[0] - a[0]) * k) / steps, a[2] + ((b[2] - a[2]) * k) / steps]);
    }
  });
  /** Whether the course runs through an upright box of half sizes (hx, hz) at (x, z) turned by psi. */
  const courseThrough = (x, z, psi, hx, hz) => {
    const sin = Math.sin(psi), cos = Math.cos(psi), reach = Math.hypot(hx, hz);
    for (const [sx, sz] of samples) {
      const dx = sx - x, dz = sz - z;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      if (Math.abs(dx * cos - dz * sin) <= hx && Math.abs(dx * sin + dz * cos) <= hz) return true;
    }
    return false;
  };

  // Placements: what is drawn, and what is solid (see `collisionOf`).
  const objects = [];
  const statics = [];
  const movers = [];
  /** The rocks' steep faces, 12 numbers each (`steepFace`). */
  const faces = [];
  const meshPositions = [];
  const meshValues = [];
  /** A triangle given in an object's own frame, as ground where it faces up enough to stand on. */
  const addGround = (m, pos, a, b, c, value) => {
    const w = [a, b, c].map((v) => [
      pos[0] + m[0] * v[0] + m[1] * v[1] + m[2] * v[2], pos[1] + m[3] * v[0] + m[4] * v[1] + m[5] * v[2], pos[2] + m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]);
    const ux = w[1][0] - w[0][0], uy = w[1][1] - w[0][1], uz = w[1][2] - w[0][2], vx = w[2][0] - w[0][0], vy = w[2][1] - w[0][1], vz = w[2][2] - w[0][2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (!length || Math.abs(ny) / length < 0.5) return;
    meshPositions.push(...w[0], ...w[1], ...w[2]);
    meshValues.push(value);
  };
  const byId = new Map(sit.boxes.filter((b) => b.instanceId !== null && b.instanceId !== undefined).map((b) => [b.instanceId, b]));
  // Evo 2 reads MTM's type 10 as a CTrain (0x41d560) with its trainVelocity, and moves it as MTM2 does (0x5517fb list,
  // stepped by x and z at the ground's height, wrapping round the world).
  const isMover = (box) => !!box && (box.boxType === 10 || box.sourceClass === "CTrain") && !!box.bvel;
  // Object paths (game/evo-paths.js; OpenPhotex `paths`): each moves a box, counted from 1, and what hangs from it
  // (`parent`, by instance) goes with it, held where it stands against it (a helicopter's rotors).
  const sitIndexOfId = new Map(sit.boxes.map((b, i) => [b.instanceId, i]));
  const pathOfRoot = new Map();
  (sit.paths ?? []).forEach((p, k) => { if (p.object > 0 && p.points.length >= 4 && sit.boxes[p.object - 1]?.position) pathOfRoot.set(p.object - 1, k); });
  const movedBy = new Map([...pathOfRoot.keys()].map((i) => [i, i]));
  for (let changed = true; changed;) {
    changed = false;
    sit.boxes.forEach((b, i) => {
      const up = b.parent ? sitIndexOfId.get(b.parent) : undefined;
      if (up !== undefined && movedBy.has(up) && !movedBy.has(i)) { movedBy.set(i, movedBy.get(up)); changed = true; }
    });
  }
  const pathRuns = [];
  sit.boxes.forEach((box, sitIndex) => {
    if (!box.position) return;
    const [theta = 0, phi = 0, psi = 0] = box.orient ?? [];
    const pos = [box.position[0], box.position[1], box.position[2]];
    const rotation = mtm2Sim.eulerToMatrix(theta, phi, psi, new Array(9));
    const file = box.modelName ? modelFile(box.modelName) : "";
    const model = file ? models[file] : null;
    const parent = box.parent ? byId.get(box.parent) : null;
    const kind = collisionOf(box, !!model);
    // Moved by a path: a box the simulation puts where its path says each step, solid where its class is (game/evo-paths.js).
    if (movedBy.has(sitIndex)) {
      // `moving`: drawn by itself, not among the still objects' instances, which a move would make the shadows redraw (render/track-scene.js).
      if (model) objects.push({ model: file, type: box.boxType ?? 0, sitIndex, billboard: isFacing(box), matrix: toSceneMatrix(rotation, pos), moving: true });
      const bounds = model?.bounds ?? (box.size ? { min: box.size.map((v) => -v / 2), max: box.size.map((v) => v / 2) } : null);
      if (!bounds) return;
      const c = [0, 1, 2].map((a) => (bounds.min[a] + bounds.max[a]) / 2);
      const root = movedBy.get(sitIndex);
      const entry = {
        positionFt: [0, 1, 2].map((i) => pos[i] + rotation[i * 3] * c[0] + rotation[i * 3 + 1] * c[1] + rotation[i * 3 + 2] * c[2]),
        theta, phi, psi, mass: 0, type: 0, priority: 0, bounds, sitIndex, bvel: null, hitSound: null, modelName: file,
        drawOffset: c.map((v) => -v), ghost: kind === "none", pathRoot: root,
      };
      if (root === sitIndex) {
        pathRuns.push({ path: sit.paths[pathOfRoot.get(sitIndex)], number: pathOfRoot.get(sitIndex) + 1, sitIndex, bottom: -bounds.min[1] });
      } else {
        // Where it stands against the path's object, in that object's frame.
        const r = sit.boxes[root];
        const [rt = 0, rp = 0, rs = 0] = r.orient ?? [];
        const rm = mtm2Sim.eulerToMatrix(rt, rp, rs, new Array(9));
        const d = [0, 1, 2].map((a) => pos[a] - r.position[a]);
        entry.attach = {
          pos: [0, 1, 2].map((col) => rm[col] * d[0] + rm[3 + col] * d[1] + rm[6 + col] * d[2]),
          matrix: [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => rm[row] * rotation[col] + rm[3 + row] * rotation[3 + col] + rm[6 + row] * rotation[6 + col])),
        };
      }
      movers.push(entry);
      return;
    }
    if (!model) {
      if (kind === "box" && box.size) {
        // An authored collision box (Evo 2's CCollisionBox): a solid box turned as the SIT turns it, its sides walls and
        // its top driven on through the simulation's box contacts, as MTM2's boxes are. Decks and piers are such boxes, a
        // few feet thick, and a quarter of the stock ones are tilted or rolled on their side (SHTARTC's ramp is a
        // 4.5 x 121 x 36.5 slab rolled 103 degrees). A deck drawn as a surface alone had no sides to meet.
        statics.push({ pos, size: [box.size[0], box.size[1], box.size[2]], psi, matrix: Array.from(rotation) });
      } else if (kind === "trunk") statics.push({ pos: [pos[0], pos[1] + TRUNK_HEIGHT_FT / 2, pos[2]], size: [TRUNK_FT, TRUNK_HEIGHT_FT, TRUNK_FT], psi: 0 });
      return;
    }
    // A moving object (Evo 1 keeps MTM's type 10: The Hill's semis) runs on its velocity as in MTM2, and what is
    // attached to it (a semi's load, `parent`) goes with it: the same velocity, turned into the child's own frame.
    const carrier = isMover(box) ? box : isMover(parent) ? parent : null;
    // `frameSeconds`: an animated model's time a frame, the SIT's timePerFrame (0x41def0 steps dt / timePerFrame).
    objects.push({
      model: file, type: box.boxType ?? 0, sitIndex, billboard: isFacing(box), matrix: toSceneMatrix(rotation, pos),
      ...(model.keyframes && box.timePerFrame > 0 ? { frameSeconds: box.timePerFrame } : {}),
      ...(carrier && model.bounds ? { moving: true } : {}),
    });
    if (carrier && model.bounds) {
      let bvel = [carrier.bvel[0], carrier.bvel[1], carrier.bvel[2]];
      if (carrier !== box) {
        const [pt = 0, pp = 0, ps = 0] = carrier.orient ?? [];
        const pm = mtm2Sim.eulerToMatrix(pt, pp, ps, new Array(9));
        const world = [0, 1, 2].map((r) => pm[r * 3] * bvel[0] + pm[r * 3 + 1] * bvel[1] + pm[r * 3 + 2] * bvel[2]);
        bvel = [0, 1, 2].map((c) => rotation[c] * world[0] + rotation[3 + c] * world[1] + rotation[6 + c] * world[2]);
      }
      movers.push({ positionFt: pos, theta, phi, psi, mass: 0, type: 10, priority: 0, bounds: model.bounds, sitIndex, bvel, hitSound: null, modelName: file });
      return;
    }
    if (kind === "none" || !model.bounds) return;
    // A boxed object with a mass and no parent moves when hit (4x42.exe lists every object of mass over 0 without a parent
    // as a moving one, 0x552fe0; the rest are static, 0x553110): signposts, fences, crates, barrels, buses. It is MTM2's
    // level box, the SIT's mass in slugs as MTM2's (a mailbox 6.2, 200 lb), at least 1 so that it is stepped as a body; the
    // simulation's box stands round the model's own box, and its pose is given back at the model's origin (`drawOffset`).
    const mass = Number(box.sourceFields?.mass ?? 0);
    if (kind === "box" && mass > 0 && !box.parent) {
      const { min, max } = model.bounds;
      const c = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
      const centre = [0, 1, 2].map((i) => pos[i] + rotation[i * 3] * c[0] + rotation[i * 3 + 1] * c[1] + rotation[i * 3 + 2] * c[2]);
      movers.push({
        positionFt: centre, theta, phi, psi, mass: Math.max(1, mass), type: 0, priority: 0, bounds: model.bounds, sitIndex,
        bvel: null, hitSound: null, modelName: file, drawOffset: c.map((v) => -v),
      });
      return;
    }
    /**
     * The model's steep faces (more than 50 degrees from level) as walls: each its own triangle, faced the way the
     * model's normals there point (outward; the winding where they say nothing).
     */
    const steepAsWalls = () => {
      const turn = (v) => [0, 1, 2].map((i) => rotation[i * 3] * v[0] + rotation[i * 3 + 1] * v[1] + rotation[i * 3 + 2] * v[2]);
      for (const mesh of model.meshes) {
        const p = mesh.positions, nv = mesh.normals;
        for (let k = 0; k + 8 < p.length; k += 9) {
          // The model's meshes are in the scene's frame (z mirrored); back to the game's.
          const w = [0, 3, 6].map((o) => turn([p[k + o], p[k + o + 1], -p[k + o + 2]]).map((v, i) => v + pos[i]));
          // Front-facing in the scene is clockwise in the game's frame (the mirror), so the winding's way out is the
          // reverse of the corners' cross product.
          const e1 = [0, 1, 2].map((i) => w[1][i] - w[0][i]), e2 = [0, 1, 2].map((i) => w[2][i] - w[0][i]);
          const wound = [-(e1[1] * e2[2] - e1[2] * e2[1]), -(e1[2] * e2[0] - e1[0] * e2[2]), -(e1[0] * e2[1] - e1[1] * e2[0])];
          const smooth = nv ? turn([0, 3, 6].reduce((a, o) => [a[0] + nv[k + o], a[1] + nv[k + o + 1], a[2] - nv[k + o + 2]], [0, 0, 0])) : null;
          const out = smooth && Math.hypot(...smooth) > 0.3 ? smooth : wound;
          const face = steepFace(w, out);
          if (face) faces.push(...face);
        }
      }
    };
    /** The model's faces as ground: driven on by its own surface. */
    const surfaceAsGround = (value) => {
      for (const mesh of model.meshes) {
        const p = mesh.positions;
        // The model's meshes are in the scene's frame (z mirrored); back to the game's.
        for (let k = 0; k + 8 < p.length; k += 9) {
          addGround(rotation, pos, [p[k], p[k + 1], -p[k + 2]], [p[k + 3], p[k + 4], -p[k + 5]], [p[k + 6], p[k + 7], -p[k + 8]], value);
        }
      }
    };
    // Evo 2's collisionType 1: every rock and coral. Its faces that look up enough are ground; the steep ones are walls.
    if (kind === "mesh") { surfaceAsGround(ROCKS); steepAsWalls(); return; }
    const { min, max } = model.bounds;
    const sin = Math.sin(psi), cos = Math.cos(psi);
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
    const centre = [pos[0] + cx * cos + cz * sin, pos[1] + cy, pos[2] - cx * sin + cz * cos];
    const size = isTree(file) ? [TRUNK_FT, max[1] - min[1], TRUNK_FT] : [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    // A boxed object the course runs through is a bridge, an arch or a tunnel mouth: a box around it would close the
    // road, so it is driven on by its surface instead. What of it is over a truck is not that truck's ground, so a
    // bridge carries the trucks on its deck and an arch lets them under.
    if (!isTree(file) && courseThrough(centre[0], centre[2], psi, size[0] / 2, size[2] / 2)) { surfaceAsGround(DIRT); return; }
    statics.push({ pos: centre, size, psi });
  });

  // Trees (2.2): the model by the tree's index in its sector, its yaw from its byte, scaled to the slot's size, its base at
  // the stored height plus treeBiasY. A level without a .VEG gets a generated forest (2.3).
  // `forest` (Options, "Evo forest"): whether a level without a .VEG gets one.
  const vegUsed = veg ?? (forest && forestModels.length ? { ...DEFAULT_VEG, treeModels: forestModels.slice(0, 4) } : null);
  const blockers = statics.map((b) => ({ x: b.pos[0], z: b.pos[2], r: Math.hypot(b.size[0], b.size[2]) / 2 + 20 }));
  const trees = veg ? veg.trees : vegUsed ? evoGenerateTrees({
    heightAt: groundAt,
    vegClassAt: (x, z) => vegClassOfCell[cellOf(x, z)],
    blocked: (x, z) => blockers.some((b) => Math.hypot(x - b.x, z - b.z) < b.r),
    waterLevelFt, maxTrees: vegUsed.maxTrees, treeLine: vegUsed.treeLine, minDistanceSquared: vegUsed.minDistanceSquared,
    biasY: vegUsed.treeSizes.map((t) => t.biasY),
  }, seedOf(stem)) : [];
  // Far trees (2.2): away from the camera the game draws a tree as a card from the .VEG's `treeTexture`, a 2 x 2 sheet of
  // pictures, one a model slot (bit 0 moves u by a half, bit 1 v, as the grass's sheet). The port draws a forest chunk's
  // models near the camera and its cards elsewhere (render/track-scene.js `createForest`).
  const cardImage = veg?.treeTexture ? await loadEvoTexture(vfs, veg.treeTexture) : null;
  const cardTexture = cardImage ? `${podPathTitle(veg.treeTexture).toUpperCase()}#cards` : null;
  if (cardImage) modelTextures[cardTexture] = cardImage;
  const cards = [];
  /** The card of a slot, `width` by `height` feet, standing on its origin and facing +z (scene frame), named as a model. */
  const cardOf = (slot, width, height) => {
    if (!cards[slot]) {
      const name = `${cardTexture}${slot}`;
      const w = width / 2, u0 = (slot & 1) * 0.5 + CARD_UV_INSET, u1 = u0 + 0.5 - 2 * CARD_UV_INSET;
      const v0 = (slot >> 1) * 0.5 + CARD_UV_INSET, v1 = v0 + 0.5 - 2 * CARD_UV_INSET;
      models[name] = {
        name, textureNames: [cardTexture], frameNames: null, bounds: { min: [-w, 0, 0], max: [w, height, 0] },
        meshes: [{
          positions: Float32Array.of(-w, 0, 0, w, 0, 0, w, height, 0, -w, 0, 0, w, height, 0, -w, height, 0),
          normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
          uvs: Float32Array.of(u0, v1, u1, v1, u1, v0, u0, v1, u1, v0, u0, v0),
          textureName: cardTexture, cutout: true, doubleSided: true, blended: false,
        }],
      };
      cards[slot] = name;
    }
    return cards[slot];
  };
  const upright = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const tree of trees) {
    const names = vegUsed.treeModels;
    if (!names.length) break;
    const slot = evoTreeSlot(tree.index);
    const file = modelFile(names[slot % names.length] ?? "");
    const model = models[file];
    if (!model?.bounds) continue;
    const { min, max } = model.bounds;
    const height = max[1] - min[1], width = Math.max(1e-3, max[0] - min[0]), depth = Math.max(1e-3, max[2] - min[2]);
    const want = vegUsed.treeSizes?.[slot] ?? null;
    const sy = want && height > 0 ? want.sizeY / height : 1;
    const sx = want ? want.sizeX / width : sy, sz = want ? want.sizeX / depth : sy;
    const base = tree.y + (want?.biasY ?? 0);
    const matrix = toSceneMatrix(mtm2Sim.eulerToMatrix(0, 0, evoTreeYaw(tree.value), new Array(9)), [tree.x, base - min[1] * sy, tree.z]);
    // A tree is knocked over by a truck (2.5): `tree` names it for the simulation and the drawing (`sitIndex`).
    const id = `t${objects.length}`;
    // `far`: the tree's card, as wide and tall as its model is drawn, on the same base.
    const far = cardImage ? { model: cardOf(slot, width * sx, height * sy), matrix: toSceneMatrix(upright, [tree.x, base, tree.z]) } : null;
    // `forest`: drawn by sectors around the camera (render/track-scene.js `createForest`), not over every copy of the world.
    objects.push({ model: file, type: 0, billboard: false, matrix: scaled(matrix, sx, sy, sz), sitIndex: id, forest: true, ...(far ? { far } : {}) });
    statics.push({ pos: [tree.x, base + (height * sy) / 2, tree.z], size: [TRUNK_FT, height * sy, TRUNK_FT], psi: 0, tree: id });
  }

  // Grass (2.4): the pattern, each cell's class, the grass texture (a 2 x 2 atlas of slots) and the slots' biases.
  const grassName = veg?.grassTexture ?? lvl.vegTexture ?? null;
  const grassImage = grassName ? await loadEvoTexture(vfs, grassName) : null;
  const grassSizes = (vegUsed ?? DEFAULT_VEG).vegSizes;
  const pattern = evoGrassPattern(grassSizes, seedOf(stem));
  const grass = grassImage && vegClassOfCell.some((c) => c > 0) ? {
    texture: { rgba: grassImage.rgba, width: grassImage.width, height: grassImage.height },
    x: pattern.x, z: pattern.z, size: pattern.size, slot: pattern.slot,
    bias: Float32Array.from([0, 1, 2, 3], (k) => grassSizes[k]?.bias ?? 0),
    vegClass: vegClassOfCell,
    waterLevelFt,
  } : null;

  // Checkpoints, in file order, however many.
  const checkpointBoxes = sit.boxes.filter((box) => isCheckpoint(box) && box.position).map((box) => {
    const bounds = box.modelName ? models[modelFile(box.modelName)]?.bounds : null;
    const [sx, sy, sz] = bounds ? [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]] : box.size ?? [0, 0, 0];
    const gate = {
      type: CHECKPOINT_TYPE, positionFt: [box.position[0], box.position[1], box.position[2]],
      theta: 0, phi: 0, psi: box.orient?.[2] ?? 0, modelName: "",
      // SIT order: length (z), width (x), height (y).
      sizeFt: [Math.max(sz, GATE_MIN_LENGTH_FT), Math.max(sx, GATE_MIN_WIDTH_FT), Math.max(sy, GATE_MIN_HEIGHT_FT)],
    };
    return { ...gate, psi: alongCourse(gate, course) };
  });

  // The grid: the SIT's vehicle slots, a truck's body over the ground.
  const grid = sit.vehicles.filter((v) => v.position).slice(0, MAX_GRID).map((v) => ({
    file: "", pos: [v.position[0], groundAt(v.position[0], v.position[2]) + GRID_RIDE_FT, v.position[2]], heading: v.orient?.[2] ?? 0,
  }));

  // MTM2's trucks, blimp and helicopter.
  const truckPalettes = createPaletteResolver(mtm, "MTM2", null);
  const { blimp, heli } = await loadRaceVehicles(mtm, truckPalettes);
  // The track's script (OpenPhotex parseEvoScript): its rules, and the trigger boxes they name (worker/sim-worker.js).
  const scriptBytes = await vfs.read(`SCRIPTS\\${stem}.SC`);
  const script = scriptBytes ? parseEvoScript(scriptBytes, `${stem}.SC`) : null;
  const triggers = sit.boxes.filter((b) => b.sourceClass === "CTriggerBox" && b.position && b.size).map((b) => ({
    name: (b.name ?? "").toLowerCase(), pos: [...b.position], size: [...b.size], orient: [...(b.orient ?? [0, 0, 0])],
  }));
  const truckModels = {};
  await buildTrucks(truckModels, truckFiles, (file) => cachedTruckRender(mtm, file, truckPalettes));

  return {
    problems: [...missing].sort(),
    title, game, musicName: null, trackName: sit.trackName, tileOverlap: tileOverlap !== false,
    terrain: {
      ...mesh, hasLte: shaded, shadeLit: shaded,
      // The atlas with its layout, as MTM2's (worker/track-build.js), so the ground is drawn from a mipmapped stack of its
      // tiles (render/ground-detail.js `createGroundTiles`); `slotValues`: each drawn tile's surface, shadow tiles included.
      atlas: { rgba: atlas.rgba, width: atlas.width, height: atlas.height, tileSide: atlas.tileSide, padding: atlas.padding, slots: atlas.rects.length, slotValues },
      normalAtlas: null, detail: null,
    },
    grass,
    groundBoxes: null, road: null,
    // The world wraps as MTM2's does: across the seam the stock heightfields step no more than between any two
    // neighbouring corners (Baja Beach, Tri Baja 250, Pikes Peak, Truck Stop 101; Aspen alone does not meet).
    heights: null, heightsFt, fineFt, waterLevelFt, stadium: null, sunVector: null,
    models, soundObjects: [], trackLights: [], modelTextures, objects, blimp, heli, life,
    originals: sit.boxes.map((b) => (b.position ? [b.position[0], b.position[1], b.position[2], b.orient?.[0] ?? 0, b.orient?.[1] ?? 0, b.orient?.[2] ?? 0] : [0, 0, 0, 0, 0, 0])),
    backdrops: [], truckModels, trucks: [],
    sky: await loadEvoSky(vfs, lvl, weather, { hdWeather }),
    startLightColours: null,
    sim: {
      // Each texture's surface from its .TEX record (4.1); a level without one is Dirt.
      clr, textureValues: tex.ordinary.length ? Int32Array.from(tex.ordinary, (r) => r.surfaceValue ?? r.param0 ?? DIRT) : Int32Array.of(DIRT),
      ra0: null, ra1: null, boxes: movers, ramps: [], course, proCourse: null, sonicTrack: false,
      // The grid may stand anywhere on the course.
      startOnNearestSegment: true,
      road: null,
      /** A one-way course (a rally from A to B): the map draws it with two ends. */
      courseOpen,
      /** Surfaces a truck drives on over the terrain (rocks, planks), each triangle with its surface value. */
      /** Object paths (game/evo-paths.js): each with its object's sitIndex, its number for the script, its bottom. */
      paths: pathRuns,
      /** The script's rules and the trigger boxes they name. */
      script: script?.rules.length ? { rules: script.rules, triggers } : null,
      meshGround: meshValues.length ? { positions: new Float32Array(meshPositions), surfaceValues: new Int32Array(meshValues) } : null,
      /** Solid scenery as upright boxes (the simulation's static boxes, as CPR's walls are). */
      walls: statics,
      /** The rocks' steep faces as walls (OpenPhotex `collideTruckFace`): 12 numbers each, its corners and the way out. */
      faces: faces.length ? new Float32Array(faces) : null,
      grid,
      checkpoints: mtm2Sim.buildCheckpoints(checkpointBoxes),
      start: grid.length ? { file: null, pos: grid[0].pos, heading: grid[0].heading } : null,
    },
    viewpoint: course.length ? { start: course[0].startFt, end: course[0].endFt } : null,
  };
}
