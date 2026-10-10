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

  What the port decides, since Evo's own rules are not known here:
    - MTM2 trucks race, eight at most, with MTM2's physics. The ground is Dirt everywhere and
      water under the level's water height.
    - Objects collide as the SIT says (`collisionOf`): rocks are driven on by their own
      surface, authored collision boxes are decks or obstacles, the rest are upright boxes
      around their models, trees their trunks alone. A boxed object the course runs through
      (a bridge, an arch, a tunnel mouth) is driven on by its surface: a box would close the road.
    - A gate is at least GATE_MIN wide and tall, and is turned to face the way the course runs.
    - The sky and the weathers are MTM2's. The world wraps at its edges, as MTM2's does.

  Not drawn yet: the `.SDW` shadow overlay, the small vegetation, the `.WAT` water animation.
*/
import {
  decodeActPalette, decodeRawTexture, lapRuns, matchEvoAiLineName, mtm2Sim, parseEvoAiLine, parseEvoLvl, parseEvoSit, parseEvoTex,
  parseEvoVeg, podPathTitle, rawTextureSide,
} from "../vendor/openphotex/index.js";
import { weatherSkyStem } from "../game/weather.js";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { alongCourse } from "./cpr-road.js";
import { decodeSmfModel, loadEvoModelTextures, loadEvoTexture } from "./evo-models.js";
import { createPaletteResolver } from "./palette-resolver.js";
import { buildTerrainAtlas, buildTerrainMesh } from "./terrain-mesh.js";
import { loadRaceVehicles } from "./track-build.js";
import { buildTruckRender } from "./truck-build.js";

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
/** Rocks and wood, as surface values. */
const ROCKS = 1200, WOOD = 1100;
/** An authored collision box no higher than this is a surface to drive on; a higher one an obstacle. */
const DECK_MAX_HEIGHT_FT = 6;
/** The trunk box of an Evo 1 tree, whose own box sizes are not read: its height. */
const TRUNK_HEIGHT_FT = 20;

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
  if (!lvlBytes) throw new Error(`LEVELS\\${lvlName} is missing.`);
  return { title, stem, sit, lvl: parseEvoLvl(lvlBytes, lvlName) };
}

/** MTM2's sky for the weather, as on its own old levels (its 16 colours sit at 192 to 207 of its palette, drawn from 230 on). */
async function loadEvoSky(vfs, lvl, weather) {
  const stem = weatherSkyStem(weather, MTM_SKY);
  if (stem) {
    const mtm = vfs.scoped?.("MTM") ?? vfs;
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

export async function buildEvoSky(vfs, sitPath, sitBytes, weather) {
  const { lvl } = await loadEvoLevel(vfs, sitPath, sitBytes);
  return loadEvoSky(vfs, lvl, weather);
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
export async function buildEvoTrackRender(vfs, sitPath, sitBytes, { truckFiles = [], weather = 0, tileOverlap = true } = {}) {
  const { title, stem, sit, lvl } = await loadEvoLevel(vfs, sitPath, sitBytes);
  const game = `EVO${sit.game}`;
  const mtm = vfs.scoped?.("MTM") ?? vfs;
  const missing = new Set();

  // Terrain.
  const rawHeights = await readGrid(vfs, lvl.heightName, stem, ".RAW");
  if (!rawHeights) throw new Error(`${lvl.heightName || `${stem}.RAW`}: not a 256 x 256 heightfield.`);
  const heightsFt = Float32Array.from({ length: GRID * GRID }, (_, i) => (rawHeights[i * 2] | (rawHeights[i * 2 + 1] << 8)) / HEIGHT_DIVISOR);
  const clrBytes = await readGrid(vfs, lvl.clrName, stem, ".CLR");
  const clr = new Uint16Array(GRID * GRID);
  if (clrBytes) for (let i = 0; i < clr.length; i++) clr[i] = clrBytes[i * 2] | (clrBytes[i * 2 + 1] << 8);
  const texBytes = (lvl.texName ? await vfs.read(`DATA\\${podPathTitle(lvl.texName)}`) : null) ?? (await vfs.read(`DATA\\${stem}.TEX`));
  const tex = texBytes ? parseEvoTex(texBytes, `${stem}.TEX`) : { ordinary: [] };
  const tiles = [];
  for (const record of tex.ordinary) {
    const image = await loadEvoTexture(vfs, record.name);
    if (!image) missing.add(`ART\\${podPathTitle(record.name)}`);
    tiles.push(image);
  }
  const atlas = buildTerrainAtlas(tiles);
  // The tiles overlap by two pixels at each edge, as MTM2's do.
  const mesh = buildTerrainMesh({ heights: null, heightsFt, clr, lte: null, atlas, tileInset: tileOverlap === false ? 0 : 2 });
  // A zero-opacity water colour declares a height but draws no water.
  const waterLevelFt = lvl.water && lvl.water.color?.[3] > 0 && lvl.water.height > 0 ? lvl.water.height / WATER_DIVISOR : null;
  const terrain = mtm2Sim.createTerrainFt(heightsFt, waterLevelFt);
  const groundAt = (x, z) => mtm2Sim.terrainHeightAt(terrain, x, z);

  // Vegetation (Evo 2).
  const vegBytes = await vfs.read(`DATA\\${stem}.VEG`);
  let veg = null;
  try { veg = vegBytes ? parseEvoVeg(vegBytes, `${stem}.VEG`) : null; } catch { veg = null; }

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
  for (const file of Object.keys(models)) if (!models[file]?.meshes.length) delete models[file];
  const modelTextures = await loadEvoModelTextures(vfs, models, missing);

  // The course: the first one, cut to the lap by the recorded laps.
  const aiLines = await loadAiLines(vfs, stem);
  const runs = lapRuns(sit.courses[0]?.segments ?? [], aiLines);
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
  const isMover = (box) => !!box && box.boxType === 10 && !!box.bvel;
  sit.boxes.forEach((box, sitIndex) => {
    if (!box.position) return;
    const [theta = 0, phi = 0, psi = 0] = box.orient ?? [];
    const pos = [box.position[0], box.position[1], box.position[2]];
    const rotation = mtm2Sim.eulerToMatrix(theta, phi, psi, new Array(9));
    const file = box.modelName ? modelFile(box.modelName) : "";
    const model = file ? models[file] : null;
    const parent = box.parent ? byId.get(box.parent) : null;
    const kind = collisionOf(box, !!model);
    if (!model) {
      if (kind === "box" && box.size) {
        // An authored collision box (Evo 2's CCollisionBox): a low one is a surface to drive on (planks, ramps, decks),
        // laid as it is turned; a tall one is an upright obstacle.
        const [sx, sy, sz] = box.size.map((v) => v / 2);
        if (box.size[1] <= DECK_MAX_HEIGHT_FT) {
          const top = [[-sx, sy, -sz], [sx, sy, -sz], [sx, sy, sz], [-sx, sy, sz]];
          addGround(rotation, pos, top[0], top[1], top[2], WOOD);
          addGround(rotation, pos, top[0], top[2], top[3], WOOD);
        } else statics.push({ pos, size: [box.size[0], box.size[1], box.size[2]], psi });
      } else if (kind === "trunk") statics.push({ pos: [pos[0], pos[1] + TRUNK_HEIGHT_FT / 2, pos[2]], size: [TRUNK_FT, TRUNK_HEIGHT_FT, TRUNK_FT], psi: 0 });
      return;
    }
    objects.push({ model: file, type: box.boxType ?? 0, sitIndex, billboard: isFacing(box), matrix: toSceneMatrix(rotation, pos) });
    // A moving object (Evo 1 keeps MTM's type 10: The Hill's semis) runs on its velocity as in MTM2, and what is
    // attached to it (a semi's load, `parent`) goes with it: the same velocity, turned into the child's own frame.
    const carrier = isMover(box) ? box : isMover(parent) ? parent : null;
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
    // Evo 2's collisionType 1: every rock and coral.
    if (kind === "mesh") { surfaceAsGround(ROCKS); return; }
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

  // Evo 2's trees: a model by the record's value, scaled to the size the level asks, standing on the ground
  // (JSTrackViewer's reading of the record; the yaw from the value is its convention too).
  for (const tree of veg?.trees ?? []) {
    if (!veg.treeModels.length) break;
    const slot = (tree.value & 3) % veg.treeModels.length;
    const file = modelFile(veg.treeModels[slot] ?? "");
    const model = models[file];
    if (!model?.bounds) continue;
    const { min, max } = model.bounds;
    const height = max[1] - min[1], width = Math.max(1e-3, max[0] - min[0]);
    const want = veg.treeSizes?.[slot] ?? null;
    const sy = want && height > 0 ? want.sizeY / height : 1, sxz = want ? want.sizeX / width : sy;
    const ground = groundAt(tree.x, tree.z);
    const yaw = ((tree.value >> 4) & 15) * (Math.PI / 8);
    // The models are centred on their origin, not standing on it.
    const matrix = toSceneMatrix(mtm2Sim.eulerToMatrix(0, 0, yaw, new Array(9)), [tree.x, ground - min[1] * sy, tree.z]);
    objects.push({ model: file, type: 0, billboard: false, matrix: scaled(matrix, sxz, sy, sxz) });
    statics.push({ pos: [tree.x, ground + (height * sy) / 2, tree.z], size: [TRUNK_FT, height * sy, TRUNK_FT], psi: 0 });
  }

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
  const truckModels = {};
  for (const file of truckFiles.map((f) => podPathTitle(f).toUpperCase())) {
    if (!(file in truckModels)) truckModels[file] = await buildTruckRender(mtm, file, truckPalettes);
  }

  return {
    problems: [...missing].sort(),
    title, game, musicName: null, trackName: sit.trackName, tileOverlap: tileOverlap !== false,
    terrain: { ...mesh, atlas: { rgba: atlas.rgba, width: atlas.width, height: atlas.height }, normalAtlas: null, detail: null },
    groundBoxes: null, road: null,
    // The world wraps as MTM2's does: across the seam the stock heightfields step no more than between any two
    // neighbouring corners (Baja Beach, Tri Baja 250, Pikes Peak, Truck Stop 101; Aspen alone does not meet).
    heights: null, heightsFt, waterLevelFt, stadium: null, sunVector: null,
    models, soundObjects: [], trackLights: [], modelTextures, objects, blimp, heli,
    originals: sit.boxes.map((b) => (b.position ? [b.position[0], b.position[1], b.position[2], b.orient?.[0] ?? 0, b.orient?.[1] ?? 0, b.orient?.[2] ?? 0] : [0, 0, 0, 0, 0, 0])),
    backdrops: [], truckModels, trucks: [],
    sky: await loadEvoSky(vfs, lvl, weather),
    startLightColours: null,
    sim: {
      // No surface table is known for Evo: one texture slot, Dirt.
      clr: new Uint16Array(GRID * GRID), textureValues: Int32Array.of(DIRT),
      ra0: null, ra1: null, boxes: movers, ramps: [], course, proCourse: null, sonicTrack: false,
      // The grid may stand anywhere on the course.
      startOnNearestSegment: true,
      road: null,
      /** A one-way course (a rally from A to B): the map draws it with two ends. */
      courseOpen,
      /** Surfaces a truck drives on over the terrain (rocks, planks), each triangle with its surface value. */
      meshGround: meshValues.length ? { positions: new Float32Array(meshPositions), surfaceValues: new Int32Array(meshValues) } : null,
      /** Solid scenery as upright boxes (the simulation's static boxes, as CPR's walls are). */
      walls: statics,
      grid,
      checkpoints: mtm2Sim.buildCheckpoints(checkpointBoxes),
      start: grid.length ? { file: null, pos: grid[0].pos, heading: grid[0].heading } : null,
    },
    viewpoint: course.length ? { start: course[0].startFt, end: course[0].endFt } : null,
  };
}
