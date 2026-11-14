/*
  One track's files, read through the VFS into plain data (MONSTER_EXE_ANALYSIS.md section 17).

  WORLD\<name>.SIT names the level; LEVELS\<name>.LVL names the heightfield, colour grid,
  palette, texture list, sky and lighting; those live in DATA\ (heightfield, grid, lists,
  lighting, ground boxes) and ART\ (palette, sky). Every name is looked up in that folder,
  first match in mount order, as the game does.

  Pure: plain data and typed arrays, no DOM, so Node tests load stock tracks with it.
*/
import { decodeActPalette } from "../vendor/openphotex/texture/act.js";
import { isMtm2V6Situation, parseMtmLvl, parseMtmSit, parseTexList, parseTty } from "../vendor/openphotex/mtm/sit.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";
import { decodeMtm2Heights, decodeMtm2HeightPng, decodeMtm2V6Heights, mtm2EngineHeightsFt, mtm2V6HeightsFt } from "../vendor/openphotex/mtm/heights.js";
import { readTxvInfo, readTxvV6 } from "../vendor/openphotex/mtm/txv.js";
import { parseWtr, wtrHeightRange } from "../vendor/openphotex/mtm/wtr.js";
import { checkMtm2VegBounds, parseMtm2Veg, isMtm2Veg } from "../vendor/openphotex/mtm/veg.js";
import { checkMtm2GridSize, decodeClrGrid, mtm2GroundBoxDepth } from "../vendor/openphotex/terrain/ground-boxes.js";
import { readFallFile } from "../vendor/openphotex/sim/cp4/falls.js";

const GRID = 256;

/** A grid of u16 values, little-endian (a track format version 6 track's 16-bit ground box layer). */
const u16Grid = (bytes) => Uint16Array.from({ length: bytes.length >> 1 }, (_, i) => bytes[i * 2] | (bytes[i * 2 + 1] << 8));

/**
 * The world of a track format version 6 track (`.SI3`; docs/EXTENSIONS.md "Track format version 6"): its .TXV's keys
 * (OpenPhotex `readTxvV6`), checked. A bad value refuses the track with the message naming the key (the specification's
 * 5.2); a formatVersion above 6 loads, with its warning shown.
 */
export function readV6World(txvBytes, sitPath) {
  try {
    return readTxvV6(txvBytes);
  } catch (err) {
    if (err instanceof RangeError) throw new Error(`${podPathTitle(sitPath)}: ${err.message}`);
    throw err;
  }
}

/** A version 6 grid file's size checked against the world (OpenPhotex `checkMtm2GridSize`): refused with its message. */
function checkGrid(name, bytes, cells) {
  if (!bytes) return null;
  try {
    return checkMtm2GridSize(name, bytes.length, cells);
  } catch (err) {
    throw new Error(err.message);
  }
}

function stemOf(name) {
  const title = podPathTitle(name);
  const dot = title.lastIndexOf(".");
  return dot >= 0 ? title.slice(0, dot) : title;
}

/** A Community Patch 4 extra the track may carry: a damaged or newer one is left out with a warning, never fatal. */
function safely(read, what) {
  try {
    return read();
  } catch (err) {
    console.warn(`Track ${what} skipped: ${err.message}`);
    return null;
  }
}

/**
 * Community Patch 4 lakes (`WORLD\<stem>.WTR`, OpenPhotex `parseWtr`), or null when the file is damaged or does not fit,
 * with a warning, as any damaged one. The world's size picks the version (the specification's 9.1): a version 6 track
 * (`v6`) of 256 cells reads version 1 only, one of 512 cells version 2 only, each on its N x N tiles. Any other track
 * reads as Community Patch 4 does, which refuses a major version other than 1.
 */
export function readLevelLakes(bytes, { cells = GRID, v6 = false } = {}) {
  if (!bytes) return null;
  return safely(() => {
    const wtr = parseWtr(bytes, v6 ? { cells } : {});
    if (!v6 && wtr.major !== 1) throw new RangeError(`WTR: major version ${wtr.major} needs a newer reader`);
    return wtr;
  }, "lakes");
}

/** A level name's stem as the waterfall loader takes it: up to the first '.', at most 63 characters (CP4_EXE_ANALYSIS.md 12.1.1). */
export const fallStem = (name) => podPathTitle(name).split(".")[0].slice(0, 63);

/**
 * Community Patch 4 beta 0.53's waterfalls (docs/CP4_EXE_ANALYSIS.md 12.1.1): `WORLD\<stem>.WFL`, read by the engine's
 * parser (OpenPhotex `readFallFile`), only when it is in the same archive as the level's .LVL (`levelHit`); in another
 * one it is ignored, which the engine only logs. `{ size, ...readFallFile }`, or null for none.
 *
 * `cells` is the world's N on a track format version 6 track (`v6`): the world's size picks the version (the
 * specification's 9.3), version 1 (256 x 256) on a 256-cell world, version 2 (512 x 512) on a 512-cell one; any other
 * pairing is "authored for a different terrain size". Any other track reads as Community Patch 4 beta 0.53 does, which
 * refuses a major version other than 1 ("needs a newer build").
 */
export async function readLevelFalls(vfs, stems, levelHit, { cells = GRID, v6 = false } = {}) {
  for (const stem of stems) {
    if (!stem) continue;
    const path = `WORLD\\${stem}.WFL`;
    const bytes = await vfs.read(path);
    if (!bytes) continue;
    const hit = vfs.find?.(path);
    if (hit && levelHit && hit.mount !== levelHit.mount) {
      console.info(`Waterfalls IGNORED: ${path} is in ${hit.mount.name} but the level is in ${levelHit.mount.name}`);
      return null;
    }
    const file = readFallFile(bytes, { cells: v6 ? cells : GRID });
    // Version 2 is a version 6 track's: beta 0.53 stops at the major version, before the header's size.
    if (!v6 && file.major === 2) return { size: bytes.length, ...file, status: 4, stride: 0, falls: [], counters: Object.fromEntries(Object.keys(file.counters).map((k) => [k, 0])) };
    return { size: bytes.length, ...file };
  }
  return null;
}

/** Read `name` from `folder`, by its file name only (the LVL writes bare names). */
async function readIn(vfs, folder, name) {
  if (!name) return null;
  return vfs.read(`${folder}\\${podPathTitle(name)}`);
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @param {string} sitPath e.g. "WORLD\\TPARK.SIT"
 * @param {Uint8Array} [sitBytes] the SIT, when the caller has read it already
 * @param {{ waterfalls?: boolean }} [options] `waterfalls`: read Community Patch 4 beta 0.53's .WFL (the engine's
 *   `[Graphics] waterfalls`, Options' "Waterfalls")
 */
export async function loadLevel(vfs, sitPath, sitBytes = null, { waterfalls = true } = {}) {
  sitBytes ??= await vfs.read(sitPath);
  if (!sitBytes) throw new Error(`${sitPath} is not in the mounted archives.`);
  const title = podPathTitle(sitPath);
  let sit = parseMtmSit(sitBytes, title);
  const stem = stemOf(title);
  // A track format version 6 track (`WORLD\<stem>.SI3`): its .TXV says the world's size and how its heights are read.
  const v6Track = isMtm2V6Situation(sitPath);

  // The SIT names its level, which need not share its stem (MTM1's HILLCLIM.SIT runs on ARTIC.LVL).
  const lvlTitle = sit.lvlName ? podPathTitle(sit.lvlName) : `${stem}.LVL`;
  const lvlBytes = (await vfs.read(`LEVELS\\${lvlTitle}`)) ?? (await vfs.read(`LEVELS\\${stem}.LVL`));
  if (!lvlBytes) throw new Error(`LEVELS\\${lvlTitle} is missing.`);
  const lvl = parseMtmLvl(lvlBytes);

  // The files the LVL names, read together: each a separate archive read, none waits on another. A pair is the level's
  // own name first, then the SIT's.
  const either = async (a, b) => (await vfs.read(a)) ?? (await vfs.read(b));
  const [rawHeights, clrBytes, texBytes, ttyBytes, actBytes, lte, ra0, ra1, cl0] = await Promise.all([
    readIn(vfs, "DATA", lvl.rawName), readIn(vfs, "DATA", lvl.clrName), readIn(vfs, "DATA", lvl.texName),
    vfs.read(`DATA\\${stemOf(lvl.texName)}.TTY`), readIn(vfs, "ART", lvl.actName), readIn(vfs, "DATA", lvl.lteName),
    either(`DATA\\${stemOf(lvlTitle)}.RA0`, `DATA\\${stem}.RA0`),
    either(`DATA\\${stemOf(lvlTitle)}.RA1`, `DATA\\${stem}.RA1`),
    either(`DATA\\${stemOf(lvlTitle)}.CL0`, `DATA\\${stem}.CL0`),
  ]);

  // The Community Patch 4 records beside the level (docs/CP4_EXE_ANALYSIS.md): DATA\<stem>.TXV says which terrain grid the
  // heights are on and may name a height PNG; WORLD\<stem>.WTR adds lakes, WORLD\<stem>.VEG vegetation. Each is optional.
  const cpr = sit.origin === "CPR";
  const [txvBytes, wtrBytes, vegBytes] = cpr ? [null, null, null] : await Promise.all([
    either(`DATA\\${stemOf(lvlTitle)}.TXV`, `DATA\\${stem}.TXV`),
    either(`WORLD\\${stemOf(lvlTitle)}.WTR`, `WORLD\\${stem}.WTR`),
    either(`WORLD\\${stemOf(lvlTitle)}.VEG`, `WORLD\\${stem}.VEG`),
  ]);
  const txv = txvBytes ? readTxvInfo(txvBytes) : null;
  // A version 6 track's world (null for any other track, read by today's rules: its .TXV's version 6 keys are ignored).
  const v6 = v6Track ? readV6World(txvBytes, sitPath) : null;
  const cells = v6?.worldCells ?? GRID, worldFt = v6?.worldFt ?? GRID * 32;
  // A negative place in the SIT is wrapped by the world's size, not 8192 ft (the specification's 8.4).
  if (v6 && worldFt !== GRID * 32) sit = parseMtmSit(sitBytes, title, { worldFt });
  // Beta 0.53's waterfalls, beside them (docs/CP4_EXE_ANALYSIS.md 12.1).
  const levelHit = vfs.find?.(`LEVELS\\${lvlTitle}`) ?? vfs.find?.(`LEVELS\\${stem}.LVL`) ?? null;
  const falls = cpr || !waterfalls ? null : await readLevelFalls(vfs, [...new Set([fallStem(lvlTitle), fallStem(stem)])], levelHit, { cells, v6: !!v6 });
  // Every grid file of a version 6 track holds N x N cells, or the track is refused (the specification's 8.2). The
  // ground box pairs may be 16-bit, both files of a pair alike (8.3). Files the level does not have are not asked for.
  let groundBoxDepth = 8;
  if (v6) {
    checkGrid(lvl.clrName || `${stem}.CLR`, clrBytes, cells);
    checkGrid(lvl.lteName || `${stem}.LTE`, lte, cells);
    checkGrid(`${stem}.CL0`, cl0, cells);
    if (ra0 && ra1) {
      try {
        groundBoxDepth = mtm2GroundBoxDepth(ra0, ra1, cells);
      } catch (err) {
        throw new Error(err.message);
      }
    } else {
      checkGrid(`${stem}.RA0`, ra0, cells);
      checkGrid(`${stem}.RA1`, ra1, cells);
    }
    // The files OpenMTM2 does not draw from (the second ground box layers, the other face grids) are checked all the same.
    const extras = ["RA2", "RA3", "RA4", "RA5", "CL1", "CL2"];
    const extraBytes = await Promise.all(extras.map((ext) => either(`DATA\\${stemOf(lvlTitle)}.${ext}`, `DATA\\${stem}.${ext}`)));
    extras.forEach((ext, i) => checkGrid(`${stem}.${ext}`, extraBytes[i], cells));
    const [ra4, ra5] = extraBytes.slice(2, 4);
    if (ra4 && ra5) {
      try {
        mtm2GroundBoxDepth(ra4, ra5, cells, ["RA4", "RA5"]);
      } catch (err) {
        throw new Error(err.message);
      }
    }
  }

  let heights = null, heightsFt = null, fineFt = null, terrainMode = "classic8", terrainWarning = null;
  if (cpr) {
    // CART Precision Racing: 16 bits a corner, sixteenths of a foot (the road's own altitudes, in feet, then lie a median
    // 2 ft over the ground at Laguna).
    if (rawHeights?.length !== GRID * GRID * 2) throw new Error(`${lvl.rawName}: not a 256 x 256 16-bit heightfield.`);
    heightsFt = Float32Array.from({ length: GRID * GRID }, (_, i) => (rawHeights[i * 2] | (rawHeights[i * 2 + 1] << 8)) / 16);
    terrainMode = "cpr";
  } else if (v6?.terrainHeightMap) {
    // A version 6 height map (the specification's 7): N x N or 4N x 4N samples, base + sample / step feet each, held
    // exactly (OpenPhotex `mtm2V6HeightsFt`, the 1/128 ft store of 7.3 in feet); a spline expanded at N.
    const name = v6.terrainHeightMap;
    const mapBytes = await vfs.read(name.includes("\\") ? name : `DATA\\${podPathTitle(name)}`);
    if (!mapBytes) throw new Error(`${name} (the track's .TXV terrainHeightMap) is missing.`);
    let decoded;
    try {
      decoded = decodeMtm2V6Heights(mapBytes, { name, cells, step: v6.terrainHeightStep, base: v6.terrainHeightBase, terrainGrid: v6.terrainGrid });
    } catch (err) {
      throw new Error(`${name}: ${err.message}`);
    }
    terrainMode = decoded.mode === "classic" ? "classic16" : decoded.mode;
    terrainWarning = decoded.warning;
    heightsFt = mtm2V6HeightsFt(decoded.coarse, v6.terrainHeightStep, v6.terrainHeightBase);
    if (decoded.fine) fineFt = mtm2V6HeightsFt(decoded.fine, v6.terrainHeightStep, v6.terrainHeightBase);
  } else {
    // MTM2: a byte a corner, 2 ft steps; or Community Patch 4's 16-bit grids, 1/128 ft a step: 256 x 256 at 32 ft, the
    // same expanded by the engine's spline to 8 ft, or a 1024 x 1024 Full Map at 8 ft (OpenPhotex mtm/heights.ts).
    const pngName = txv?.terrainHeights;
    const pngBytes = pngName ? await vfs.read(pngName.includes("\\") ? pngName : `DATA\\${podPathTitle(pngName)}`) : null;
    if (pngName && !pngBytes && !rawHeights) throw new Error(`${pngName} (the track's .TXV terrainHeights) is missing.`);
    if (!pngBytes && !rawHeights) throw new Error(`${lvl.rawName} is missing.`);
    let decoded;
    try {
      decoded = pngBytes ? decodeMtm2HeightPng(pngBytes, txv?.terrainGrid) : decodeMtm2Heights(rawHeights, txv?.terrainGrid);
    } catch (err) {
      throw new Error(`${pngBytes ? pngName : lvl.rawName}: ${err.message}`);
    }
    terrainMode = decoded.mode;
    terrainWarning = decoded.warning;
    if (decoded.mode === "classic8" && rawHeights?.length === GRID * GRID) heights = rawHeights;
    else {
      // As the engine holds them: v >> 1, 1/64 ft (docs/CP4_EXE_ANALYSIS.md 1), after the spline.
      heightsFt = mtm2EngineHeightsFt(decoded.coarse);
      if (decoded.fine) fineFt = mtm2EngineHeightsFt(decoded.fine);
    }
  }
  let clr = new Uint16Array(GRID * GRID);
  if (v6) clr = (clrBytes ? decodeClrGrid(clrBytes, cells) : null) ?? new Uint16Array(cells * cells);
  else if (clrBytes && clrBytes.length >= GRID * GRID * 2) {
    for (let i = 0; i < clr.length; i++) clr[i] = clrBytes[i * 2] | (clrBytes[i * 2 + 1] << 8);
  }
  const textureNames = texBytes ? parseTexList(texBytes).map((n) => podPathTitle(n)) : [];
  const tty = ttyBytes ? parseTty(ttyBytes) : [];
  const textureValues = mtm2Sim.textureTypeValues(textureNames, tty);

  const palette = decodeActPalette(actBytes);
  // The ground boxes' heights (the specification's 8.3): base + 2 ft a byte, or base + value / step for a 16-bit pair.
  // A version 6 track without terrainHeightMap keeps CP4's rules for its heights, and so step 128 and base 0.
  const boxStep = v6?.terrainHeightMap ? v6.terrainHeightStep : 128, boxBase = v6?.terrainHeightMap ? v6.terrainHeightBase : 0;
  const groundBoxes = groundBoxDepth === 16
    ? { ra0: u16Grid(ra0), ra1: u16Grid(ra1), cl0, depth: 16, stepFt: 1 / boxStep, baseFt: boxBase }
    : { ra0, ra1, cl0, depth: 8, stepFt: 2, baseFt: boxBase };

  const sky = lvl.skyRawName
    ? { name: podPathTitle(lvl.skyRawName), actName: lvl.skyActName ? podPathTitle(lvl.skyActName) : null }
    : null;

  return {
    title, stem, sit, lvl,
    /** `heights`: the MTM byte heightfield; `heightsFt`: corner heights in feet where the level's is finer (then `heights` is null). */
    heights, heightsFt, clr, lte,
    /**
     * `fineFt`: Community Patch 4's 8 ft grid (1024 x 1024 heights in feet, rows along z) for a Spline or Full Map track,
     * else null. `terrainMode`: "classic8", "classic16", "spline", "fine" or "cpr"; `terrainWarning` as Traxx reports a
     * .TXV that disagrees with the height file.
     */
    fineFt, terrainMode, terrainWarning, txv,
    /**
     * The world: `cells` a side (N, 256 but on a track format version 6 track) and `worldFt` (32 N). `v6` the version 6
     * keys (OpenPhotex `readTxvV6`: step, base, warnings) of a `.SI3` track, else null.
     */
    cells, worldFt, v6,
    /** Community Patch 4 lakes (OpenPhotex `parseWtr`) and vegetation (`parseMtm2Veg`), or null. */
    // A version 6 track's lakes are .WTR version 1 at 256 cells and version 2 at 512, on its N x N tiles (the
    // specification's 9.1); its vegetation stands anywhere in its world (9.2). A file that does not fit is left out with
    // a warning, as any damaged one.
    lakes: readLevelLakes(wtrBytes, { cells, v6: !!v6 }),
    /** The valid lake heights in half-feet (OpenPhotex `wtrHeightRange`), by the .WTR's major version. */
    lakeHeightRange: (major) => wtrHeightRange(major, boxStep, boxBase),
    vegetation: vegBytes && isMtm2Veg(vegBytes) ? safely(() => {
      const veg = parseMtm2Veg(vegBytes);
      if (v6) checkMtm2VegBounds(veg, cells);
      return veg;
    }, "vegetation") : null,
    /** Community Patch 4 beta 0.53's waterfalls as the engine's parser reads them (`{ size, status, falls, ... }`), or null. */
    falls,
    textureNames, tty, textureValues,
    palette,
    groundBoxes,
    sky,
    /** The water level in feet (the LVL's `!waterHeight` is in half feet), or null for none. */
    waterLevelFt: lvl.waterHeight ? lvl.waterHeight / 2 : null,
  };
}

/**
 * A texture and the palette selected by `paletteResolver` (palette-resolver.js).
 * Returns `{ name, raw, palette }` or null when the texture is missing.
 */
export async function loadTextureSource(vfs, name, paletteResolver, kind = "terrain") {
  const title = podPathTitle(name);
  const path = `ART\\${title.endsWith(".RAW") ? title : `${stemOf(title)}.RAW`}`;
  const hit = vfs.find(path);
  if (!hit) return null;
  const raw = await hit.mount.readEntry(hit.entry);
  const resolved = await paletteResolver.resolve(title, hit.entry, kind);
  return { name: title, raw, palette: resolved.palette, paletteSource: resolved.source };
}
