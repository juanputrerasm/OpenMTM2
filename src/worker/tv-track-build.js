/*
  A Terminal Velocity, Fury3 or Hellbender level, built into what a race draws and simulates: the same result
  worker/track-build.js gives for an MTM2 track. It is a place to drive or fly about in, no more: these games have no
  course and no checkpoints, and what their own objectives are is in their executables, which are not read
  (docs/CHANGELOG.md Stage 3.2).

  The files (OpenPhotex `parseTvLvl`, `parseDef`, the NAV readers; the rules are JSTrackViewer's):

    LEVELS\<level>.LVL      the manifest: every other file by name
      DATA\<level>.RAW      heights, one byte a corner: 256 by 256, or 128 by 128 in Hellbender
      DATA\<level>.CLR      the tile each cell draws: one byte (six bits of tile, two of turn) or MTM's two
      <level>.ACT           the level palette; DATA\<level>.TEX the tile list, ART\*.RAW the tiles
      <level>.DEF           the objects: definitions and placements, MODELS\*.BIN
      DATA\<level>.NAV      the navigation points; the start point is where the player begins
      the sky               a 64 by 64 texture in palette slots 240 to 254, coloured by the sky .ACT (as MTM1's is)

  The engine is MTM's ancestor and the world is the same shape: a square of cells, wrapping. A Hellbender level is
  128 cells a side, half MTM's: since it wraps, it is laid out twice each way to fill MTM's 256 (`tileGrid`), its
  objects with it, which is what flying on across its edge shows in any case. The scale is the games' own: a cell
  is MTM's 32 ft, and the engines are isotropic (a cell 2^20 world units in Terminal Velocity and Fury3, 2^19 in
  Hellbender, a height step 2^15 in both), so a height step is 1/32 of a cell in Terminal Velocity and Fury3, 1 ft,
  and 1/16 in Hellbender, 2 ft (MTM's own); a model unit is 1/128 (TV, Fury3) or 1/64 (Hellbender) of MTM's. See
  JSTrackViewer's docs/TV_GAME_EXE_ANALYSIS.md 3.5 and HELLBENDER_EXE_ANALYSIS.md 2.

  Objects stand where each engine puts them (TV GAME.EXE 0x230a0, Fury3 0x40c2b0, HELLBEND.EXE 0x404f60; see
  `settleTvPlacement`). The ground is MTM2's, whose cells split on the same checkerboard diagonals as these games'.

  What the port decides:
    - MTM2's trucks drive it, with MTM2's physics. The ground is Dirt everywhere and there is no water.
    - Objects are drawn and not collided with. The ground boxes (`.RA0`, `.RA1`, `.CL0`: the buildings and walls) are
      drawn and solid, as MTM's are.
    - The sky is the level's own, a ceiling fixed in the world at SKY_CEILING_FT: it can be flown up to, which no
      MTM sky can. The height is the port's; the games' own ceiling is not known here.

  Not built: tunnel levels (each a tube built from its .TNL, OpenPhotex `parseTvTunnel`), Terminal Velocity's
  chamber ceilings, Hellbender's cavern under the ground with its openings and the objects that stand in it, its
  moving terrain (.QKE), powerups, texture animation, and star-field skies (drawn as the horizon colour).
*/
import { TR_ANGLE_TO_RAD, defPlacementToEditor, parseDef } from "../vendor/openphotex/tv/def.js";
import { parseBin } from "../vendor/openphotex/model/bin.js";
import { decodeRawTexture, rawTextureSide } from "../vendor/openphotex/texture/raw.js";
import { isNullAssetName, parseTvLvl } from "../vendor/openphotex/tv/lvl.js";
import { parseHbNavPoints } from "../vendor/openphotex/tv/hb-nav.js";
import { parseNavPoints } from "../vendor/openphotex/tv/nav.js";
import { parseTexList } from "../vendor/openphotex/mtm/sit.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import { skyGradient, skyHorizon } from "../vendor/openphotex/texture/sky.js";
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { loadArtTexture } from "./art-texture.js";
import { decodeModel } from "./models.js";
import { createPaletteResolver } from "./palette-resolver.js";
import { buildGroundBoxMesh } from "./ground-box-mesh.js";
import { buildTerrainAtlas, buildTerrainMesh } from "./terrain-mesh.js";
import { loadRaceVehicles } from "./track-build.js";
import { buildTrucks, cachedTruckRender } from "./truck-build.js";

const GRID = 256;
const CELL_FT = 32;
/** JSTrackViewer's editor units to a cell, in which OpenPhotex gives positions. */
const EDITOR_PER_CELL = 64;
/** Feet to a height step, and a model's size against an MTM model's, by the level's kind. */
export const TV_SCALES = Object.freeze({
  "TV/F3": Object.freeze({ heightFt: 1, model: 1 / 128 }),
  HB: Object.freeze({ heightFt: 2, model: 1 / 64 }),
});
/** World units per height step, in all three games. */
const WORLD_PER_STEP = 1 << 15;
/** World units per cell: Terminal Velocity and Fury3, and Hellbender's 16.16 at 8 a cell. */
const WORLD_PER_CELL = Object.freeze({ "TV/F3": 1 << 20, HB: 8 * 65536 });
/** The Terminal Velocity and Fury3 logics the engine lifts by half the model radius: the flyers. */
const FLYER_LOGICS = new Set([2, 4, 7, 8]);
/** The sky's height over the level's lowest ground, feet: above the highest a heightfield can reach. The port's. */
export const SKY_CEILING_FT = 640;
/** The sky art's palette slots, and where the sky .ACT keeps their sixteen colours (as MTM1's flat sky). */
const SKY_FIRST_SLOT = 240;
/** How high over the ground the player's truck is set down, as on MTM2's grids, and the fly-by camera's eye. */
const GRID_RIDE_FT = 6;
const DIRT = 200;
/** A tunnel level's first line. */
const LVL_KIND_TUNNEL = 1;

const titleOf = (name) => podPathTitle(name ?? "").toUpperCase();
const stemOf = (name) => titleOf(name).replace(/\.[^.]*$/, "");

/** A file a level names: in `folder` first, then by its own name. */
async function readNamed(vfs, folder, name) {
  if (isNullAssetName(titleOf(name))) return null;
  return (await vfs.read(`${folder}\\${titleOf(name)}`)) ?? (await vfs.read(String(name)));
}

/**
 * Whether a level's manifest is one that can be built: a complete Terminal Velocity, Fury3 or Hellbender level on the
 * surface (a heightfield, not a tunnel's spine). Returns the parsed level or null.
 */
export function drivableTvLevel(bytes) {
  let lvl;
  try { lvl = parseTvLvl(bytes); } catch { return null; }
  if (!lvl.complete) return null;
  const first = new TextDecoder("latin1").decode(bytes.subarray(0, 16)).split(/\r\n|\r|\n/)[0].trim();
  if (Number.parseInt(first, 10) === LVL_KIND_TUNNEL) return null;
  const raw = titleOf(lvl.rawOrTnlName);
  if (!raw.endsWith(".RAW") || isNullAssetName(raw)) return null;
  return lvl;
}

/**
 * A level's `.CLR` as MTM's words (bits 0 to 11 the tile, 14 and 15 the quarter turns). One byte a cell packs six
 * bits of tile and two of turn when the level has no more than 64 tiles, and Terminal Velocity and Fury3 turn their
 * tiles one step back from MTM's (JSTrackViewer's `readCell` and `effectiveRot`).
 */
export function tvClrWords(clr, textureCount, origin, grid = GRID) {
  const cells = grid * grid, out = new Uint16Array(cells);
  if (!clr?.length) return out;
  if (clr.length >= cells * 2) {
    for (let i = 0; i < cells; i++) out[i] = clr[i * 2] | (clr[i * 2 + 1] << 8);
    return out;
  }
  const back = origin === "HB" ? 0 : 3;
  for (let i = 0; i < cells && i < clr.length; i++) {
    const b = clr[i], tile = b & 0x3f;
    if (textureCount > 0 && textureCount <= 64 && tile < textureCount) out[i] = tile | ((((b >> 6) + back) & 3) << 14);
    else out[i] = textureCount > 0 ? Math.min(b, textureCount - 1) : 0;
  }
  return out;
}

/** A level's own square grid of `side` cells (128 or 256) laid out to fill MTM's 256 by 256, repeating as the world wraps. */
export function tileGrid(values, side, Out = values.constructor) {
  if (side === GRID) return values;
  const out = new Out(GRID * GRID);
  for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) out[row * GRID + col] = values[(row % side) * side + (col % side)];
  return out;
}

/** The bytes a cell's box takes in a `.CL0`: six faces of two. */
const CL0_BYTES = 12;

/** `tileGrid` for a grid of `bytes`-long records. */
export function tileRecords(values, side, bytes) {
  if (side === GRID) return values;
  const out = new Uint8Array(GRID * GRID * bytes);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const from = ((row % side) * side + (col % side)) * bytes;
      out.set(values.subarray(from, from + bytes), (row * GRID + col) * bytes);
    }
  }
  return out;
}

/**
 * The engine's model radius, in world units (TV GAME.EXE 0x22df0, Fury3 0x40bf80, HELLBEND.EXE 0x404d40): per axis the
 * larger of |min| and |max| over the raw vertices at `raw * 65536 / magnify`, then the length of that corner. It is
 * what the engine writes over a definition's hit radius. Null for a model with no vertices.
 */
export function binCornerRadius(bytes) {
  if (!bytes?.length) return null;
  const bin = parseBin(bytes);
  if (bin.kind !== "mrgl" || !bin.vertices.length || !(bin.magnify > 0)) return null;
  const extent = [0, 0, 0], scale = 65536 / bin.magnify;
  for (let i = 0; i < bin.vertices.length; i++) extent[i % 3] = Math.max(extent[i % 3], Math.abs(bin.vertices[i] * scale));
  return Math.round(Math.hypot(extent[0], extent[1], extent[2]));
}

/**
 * Where an engine puts a placement, in feet `[x, y, z]`, from where the file stores it (`stored`, feet).
 *
 * Terminal Velocity and Fury3 ignore the stored height on a surface level: the object goes on the ground at (x, z),
 * plus the definition's Y offset, plus half the model radius for the flyers. Hellbender keeps the stored height,
 * raises it to the ground when it is below, and onto the top of a ground box it is inside; it adds no Y offset and
 * lifts nothing. All three add the X and Z offsets.
 *
 * @param {{ origin: string, heightFt: number, groundAt: (x: number, z: number) => number,
 *   boxAt?: (x: number, z: number) => ({ lowerFt: number, upperFt: number } | null) }} level
 */
export function settleTvPlacement(stored, definition, radius, level) {
  const [x, storedY, z] = stored;
  const perCell = WORLD_PER_CELL[level.origin] ?? WORLD_PER_CELL["TV/F3"];
  const ox = ((definition.groundOffsetX ?? 0) / perCell) * CELL_FT, oz = ((definition.groundOffsetZ ?? 0) / perCell) * CELL_FT;
  const ground = level.groundAt(x, z);
  if (level.origin !== "HB") {
    const lift = FLYER_LOGICS.has(definition.logic) && radius ? radius / 2 : 0;
    return [x + ox, ground + (((definition.groundOffsetY ?? 0) + lift) / WORLD_PER_STEP) * level.heightFt, z + oz];
  }
  let y = storedY;
  if (y < ground) y = ground;
  else {
    const box = level.boxAt?.(x, z);
    if (box && y >= box.lowerFt && y < box.upperFt) y = box.upperFt;
  }
  return [x + ox, y, z + oz];
}

/** A position OpenPhotex gives in JSTrackViewer's editor space, `[x, z, height steps]`, as game feet `[x, y, z]`. */
export function tvEditorToFeet([ex, ez, steps], heightFt) {
  return [(ex / EDITOR_PER_CELL) * CELL_FT, steps * heightFt, (ez / EDITOR_PER_CELL) * CELL_FT];
}

/** The level's sky as a flat ceiling (render/track-scene.js `createFlatSky`), or a plain one of the horizon colour. */
async function loadTvSky(vfs, lvl, palette) {
  const act = isNullAssetName(titleOf(lvl.skyActName)) ? null : await readNamed(vfs, "ART", lvl.skyActName);
  const gradient = act ? skyGradient(act) : null;
  const horizon = gradient ? Array.from(skyHorizon(gradient)) : [0, 0, 0];
  const plain = { name: "TVSKY", width: 1, height: 1, rgba: new Uint8ClampedArray([horizon[0], horizon[1], horizon[2], 255]), flat: { horizon, ceilingFt: SKY_CEILING_FT } };
  const name = titleOf(lvl.skyName);
  if (!name.endsWith(".RAW") || isNullAssetName(name)) return plain;
  const raw = await readNamed(vfs, "ART", name);
  if (!raw || !rawTextureSide(raw.length)) return plain;
  const colours = (palette ?? new Uint8Array(768)).slice(0, 768);
  if (gradient) colours.set(gradient, SKY_FIRST_SLOT * 3);
  const image = decodeRawTexture(raw, colours);
  return { name: stemOf(name), width: image.width, height: image.height, rgba: image.rgba, flat: { horizon, ceilingFt: SKY_CEILING_FT } };
}

/** The level's own sky, for the `sky` request (the weather changed: these levels have the one sky). */
export async function buildTvSky(vfs, lvlPath) {
  const bytes = await vfs.read(lvlPath);
  const lvl = bytes && drivableTvLevel(bytes);
  if (!lvl) return null;
  const act = await readNamed(vfs, "ART", lvl.actName);
  return loadTvSky(vfs, lvl, act ? act.subarray(0, 768) : null);
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs the level's own view of the archives
 * @param {string} lvlPath `LEVELS\<level>.LVL`
 */
export async function buildTvTrackRender(vfs, lvlPath, { truckFiles = [], tileOverlap = true } = {}) {
  const bytes = await vfs.read(lvlPath);
  const lvl = bytes && drivableTvLevel(bytes);
  if (!lvl) throw new Error(`${lvlPath} is not a Terminal Velocity, Fury3 or Hellbender surface level`);
  const origin = lvl.origin, scales = TV_SCALES[origin] ?? TV_SCALES["TV/F3"];
  const title = titleOf(lvlPath), missing = new Set();
  const mtm = vfs.scoped?.("MTM") ?? vfs;

  const raw = await readNamed(vfs, "DATA", lvl.rawOrTnlName);
  const side = raw ? Math.round(Math.sqrt(raw.length)) : 0;
  if (!raw || side * side !== raw.length || GRID % side !== 0) throw new Error(`${title}: its heightfield ${lvl.rawOrTnlName} is missing or not a square that fills the world`);
  /** How many times the level repeats each way inside MTM's world, and its own width in feet. */
  const repeats = GRID / side, spanFt = side * CELL_FT;
  const heights = tileGrid(raw, side, Uint8Array);
  // Hellbender's step is MTM's 2 ft, so its heights are MTM's as they are; Terminal Velocity's go in feet.
  const heightsFt = scales.heightFt === 2 ? null : Float32Array.from(heights, (h) => h * scales.heightFt);
  const act = await readNamed(vfs, "ART", lvl.actName);
  const palette = act ? act.slice(0, 768) : null;
  const palettes = createPaletteResolver(vfs, origin, palette);

  // The ground's tiles.
  const texBytes = await readNamed(vfs, "DATA", lvl.texName);
  const textureNames = texBytes ? parseTexList(texBytes) : [];
  const decoded = [];
  for (const name of textureNames) {
    const image = await loadArtTexture(vfs, name, palettes, { kind: "terrain" });
    if (!image) missing.add(`ART\\${titleOf(name)}`);
    decoded.push(image);
  }
  const atlas = buildTerrainAtlas(decoded);
  const clrBytes = await readNamed(vfs, "DATA", lvl.clrName);
  const clr = tileGrid(tvClrWords(clrBytes, textureNames.length, origin, side), side, Uint16Array);
  const mesh = buildTerrainMesh({ heights, heightsFt, clr, lte: null, atlas, tileInset: tileOverlap === false ? 0 : 2 });
  // The ground boxes (the buildings and walls a level is built of), found by the heightfield's name as MTM's are:
  // `.RA0` and `.RA1` the lower and upper heights of each cell's box, `.CL0` its six faces' tiles.
  const boxStem = stemOf(lvl.rawOrTnlName);
  const boxFile = async (extension, perCell) => {
    const data = await vfs.read(`DATA\\${boxStem}${extension}`);
    return data && data.length === side * side * perCell ? data : null;
  };
  const ra0Own = await boxFile(".RA0", 1), ra1Own = await boxFile(".RA1", 1), cl0Own = await boxFile(".CL0", CL0_BYTES);
  const ra0 = ra0Own && ra1Own ? tileGrid(ra0Own, side, Uint8Array) : null, ra1 = ra0 ? tileGrid(ra1Own, side, Uint8Array) : null;
  const cl0 = ra0 && cl0Own ? tileRecords(cl0Own, side, CL0_BYTES) : null;
  const groundBoxes = ra0 ? buildGroundBoxMesh({ ra0, ra1, cl0 }, atlas, null, heights, null, { stepFt: scales.heightFt, heightsFt }) : null;
  const groundAt = (() => {
    const terrain = heightsFt ? mtm2Sim.createTerrainFt(heightsFt, null) : mtm2Sim.createTerrain(heights, null);
    return (x, z) => mtm2Sim.terrainHeightAt(terrain, x, z);
  })();

  // The objects: each placement of a definition that names a model, where its engine puts it.
  const models = {}, objects = [], originals = [];
  const radii = new Map();
  const radiusOf = async (definition) => {
    const simple = titleOf(definition.simpleAsset);
    if (!simple.endsWith(".BIN")) return null;
    if (!radii.has(simple)) radii.set(simple, binCornerRadius(await vfs.read(`MODELS\\${simple}`)));
    return radii.get(simple);
  };
  const boxAt = ra0 ? (x, z) => {
    const col = ((Math.floor(x / CELL_FT) % GRID) + GRID) % GRID, row = ((Math.floor(z / CELL_FT) % GRID) + GRID) % GRID;
    const upper = ra1[row * GRID + col];
    return upper >= 1 ? { lowerFt: ra0[row * GRID + col] * scales.heightFt, upperFt: upper * scales.heightFt } : null;
  } : null;
  const level = { origin, heightFt: scales.heightFt, groundAt, boxAt };
  const defBytes = isNullAssetName(titleOf(lvl.defName)) ? null : await readNamed(vfs, "DATA", lvl.defName);
  const def = defBytes ? parseDef(defBytes) : null;
  for (const [index, placement] of (def?.placements ?? []).entries()) {
    originals.push([0, 0, 0, 0, 0, 0]);
    const definition = def.definitions[placement.defIndex];
    const file = titleOf(definition?.binForHydration);
    if (placement.strength === 0 || !definition || !file.endsWith(".BIN")) continue;
    // Below zero a Hellbender placement stands in the cavern, which is not built.
    if (origin === "HB" && placement.y < 0) continue;
    if (!(file in models)) {
      const data = await vfs.read(`MODELS\\${file}`);
      if (!data) missing.add(`MODELS\\${file}`);
      try { models[file] = data ? decodeModel(data, file, scales.model) : null; } catch { models[file] = null; }
    }
    if (!models[file]?.meshes.length) continue;
    const stored = tvEditorToFeet(defPlacementToEditor(placement, definition, side, origin), scales.heightFt);
    const pos = settleTvPlacement(stored, definition, await radiusOf(definition), level);
    const theta = placement.pitch * TR_ANGLE_TO_RAD, phi = placement.roll * TR_ANGLE_TO_RAD, psi = placement.yaw * TR_ANGLE_TO_RAD;
    originals[index] = [pos[0], pos[1], pos[2], theta, phi, psi];
    const rotation = mtm2Sim.eulerToMatrix(theta, phi, psi, new Array(9));
    // Once in every copy of the level.
    for (let i = 0; i < repeats; i++) {
      for (let j = 0; j < repeats; j++) {
        objects.push({ model: file, type: 0, sitIndex: index, billboard: false, matrix: toSceneMatrix(rotation, [pos[0] + i * spanFt, pos[1], pos[2] + j * spanFt]) });
      }
    }
  }
  for (const file of Object.keys(models)) if (!models[file]?.meshes.length) delete models[file];
  const modelTextures = {};
  for (const model of Object.values(models)) {
    for (const mesh of model.meshes) {
      for (const name of mesh.textureFrames ?? [mesh.textureName]) {
        if (!name || name in modelTextures) continue;
        modelTextures[name] = await loadArtTexture(vfs, name, palettes, { cutout: mesh.cutout });
        if (!modelTextures[name]) missing.add(`ART\\${name}`);
      }
    }
  }
  for (const name of Object.keys(modelTextures)) if (!modelTextures[name]) delete modelTextures[name];

  // Where the player begins: the level's start point, else the middle of the map.
  const navBytes = isNullAssetName(titleOf(lvl.navName)) ? null : await readNamed(vfs, "DATA", lvl.navName);
  const nav = navBytes ? (origin === "HB" ? parseHbNavPoints(navBytes, side) : parseNavPoints(navBytes, side)) : [];
  const startPoint = nav.find((p) => p.typeName === "Start point" && !p.positionIsPlaceholder) ?? null;
  const at = startPoint ? tvEditorToFeet(startPoint.position, scales.heightFt) : [spanFt / 2, 0, spanFt / 2];
  const heading = startPoint ? startPoint.heading * TR_ANGLE_TO_RAD : 0;
  const start = { file: null, pos: [at[0], groundAt(at[0], at[2]) + GRID_RIDE_FT, at[2]], heading };

  // MTM2's trucks, blimp and helicopter.
  const truckPalettes = createPaletteResolver(mtm, "MTM2", null);
  const { blimp, heli } = await loadRaceVehicles(mtm, truckPalettes);
  const truckModels = {};
  await buildTrucks(truckModels, truckFiles, (file) => cachedTruckRender(mtm, file, truckPalettes));

  let lowest = Infinity;
  for (const h of heights) if (h < lowest) lowest = h;
  const sky = await loadTvSky(vfs, lvl, palette);
  sky.flat.ceilingFt = lowest * scales.heightFt + SKY_CEILING_FT;
  return {
    problems: [...missing].sort(),
    title, game: origin === "HB" ? "HB" : "TV", musicName: null, trackName: lvl.displayName ?? stemOf(title), tileOverlap: tileOverlap !== false,
    terrain: {
      ...mesh,
      // The atlas with its layout, as MTM2's (worker/track-build.js), so the ground is drawn from a mipmapped stack of its
      // tiles (render/ground-detail.js `createGroundTiles`); every tile is Dirt, as the simulation has it (`slotValues`).
      atlas: {
        rgba: atlas.rgba, width: atlas.width, height: atlas.height, tileSide: atlas.tileSide, padding: atlas.padding, slots: atlas.rects.length,
        slotValues: new Int32Array(atlas.rects.length).fill(DIRT),
      },
      normalAtlas: null, detail: null,
    },
    groundBoxes, road: null,
    heights: heightsFt ? null : heights, heightsFt, waterLevelFt: null, stadium: null, sunVector: null,
    models, soundObjects: [], trackLights: [], modelTextures, objects, blimp, heli, originals,
    backdrops: [], truckModels, trucks: [],
    sky, skyReachable: true,
    startLightColours: null,
    sim: {
      // No surface table is read for these games: one tile slot, Dirt.
      clr: new Uint16Array(GRID * GRID), textureValues: Int32Array.of(DIRT),
      // There is no water: without this, MTM2's rule would read ground at 0 ft as deep water.
      waterLevelFt: -1e6,
      ra0, ra1, groundBoxStepFt: scales.heightFt,
      boxes: [], ramps: [], course: [], proCourse: null, sonicTrack: false,
      road: null, meshGround: null, walls: [], checkpoints: [],
      grid: [{ file: "", pos: start.pos, heading }],
      start,
    },
    // The fly-by begins at the start point, looking the way it faces.
    viewpoint: { start: start.pos, end: [start.pos[0] + Math.sin(heading) * 100, start.pos[1], start.pos[2] + Math.cos(heading) * 100] },
  };
}
