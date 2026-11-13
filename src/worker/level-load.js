/*
  One track's files, read through the VFS into plain data (MONSTER_EXE_ANALYSIS.md section 17).

  WORLD\<name>.SIT names the level; LEVELS\<name>.LVL names the heightfield, colour grid,
  palette, texture list, sky and lighting; those live in DATA\ (heightfield, grid, lists,
  lighting, ground boxes) and ART\ (palette, sky). Every name is looked up in that folder,
  first match in mount order, as the game does.

  Pure: plain data and typed arrays, no DOM, so Node tests load stock tracks with it.
*/
import { decodeActPalette } from "../vendor/openphotex/texture/act.js";
import { parseMtmLvl, parseMtmSit, parseTexList, parseTty } from "../vendor/openphotex/mtm/sit.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";
import { decodeMtm2Heights, decodeMtm2HeightPng, mtm2EngineHeightsFt } from "../vendor/openphotex/mtm/heights.js";
import { readTxvInfo } from "../vendor/openphotex/mtm/txv.js";
import { parseWtr } from "../vendor/openphotex/mtm/wtr.js";
import { parseMtm2Veg, isMtm2Veg } from "../vendor/openphotex/mtm/veg.js";
import { readFallFile } from "../vendor/openphotex/sim/cp4/falls.js";

const GRID = 256;

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

/** A level name's stem as the waterfall loader takes it: up to the first '.', at most 63 characters (CP4_EXE_ANALYSIS.md 12.1.1). */
export const fallStem = (name) => podPathTitle(name).split(".")[0].slice(0, 63);

/**
 * Community Patch 4 beta 0.53's waterfalls (docs/CP4_EXE_ANALYSIS.md 12.1.1): `WORLD\<stem>.WFL`, read by the engine's
 * parser (OpenPhotex `readFallFile`), only when it is in the same archive as the level's .LVL (`levelHit`); in another
 * one it is ignored, which the engine only logs. `{ size, ...readFallFile }`, or null for none.
 */
export async function readLevelFalls(vfs, stems, levelHit) {
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
    return { size: bytes.length, ...readFallFile(bytes) };
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
  const sit = parseMtmSit(sitBytes, title);
  const stem = stemOf(title);

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
  // Beta 0.53's waterfalls, beside them (docs/CP4_EXE_ANALYSIS.md 12.1).
  const levelHit = vfs.find?.(`LEVELS\\${lvlTitle}`) ?? vfs.find?.(`LEVELS\\${stem}.LVL`) ?? null;
  const falls = cpr || !waterfalls ? null : await readLevelFalls(vfs, [...new Set([fallStem(lvlTitle), fallStem(stem)])], levelHit);

  let heights = null, heightsFt = null, fineFt = null, terrainMode = "classic8", terrainWarning = null;
  if (cpr) {
    // CART Precision Racing: 16 bits a corner, sixteenths of a foot (the road's own altitudes, in feet, then lie a median
    // 2 ft over the ground at Laguna).
    if (rawHeights?.length !== GRID * GRID * 2) throw new Error(`${lvl.rawName}: not a 256 x 256 16-bit heightfield.`);
    heightsFt = Float32Array.from({ length: GRID * GRID }, (_, i) => (rawHeights[i * 2] | (rawHeights[i * 2 + 1] << 8)) / 16);
    terrainMode = "cpr";
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
  const clr = new Uint16Array(GRID * GRID);
  if (clrBytes && clrBytes.length >= GRID * GRID * 2) {
    for (let i = 0; i < clr.length; i++) clr[i] = clrBytes[i * 2] | (clrBytes[i * 2 + 1] << 8);
  }

  const textureNames = texBytes ? parseTexList(texBytes).map((n) => podPathTitle(n)) : [];
  const tty = ttyBytes ? parseTty(ttyBytes) : [];
  const textureValues = mtm2Sim.textureTypeValues(textureNames, tty);

  const palette = decodeActPalette(actBytes);
  const groundBoxes = { ra0, ra1, cl0 };

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
    /** Community Patch 4 lakes (OpenPhotex `parseWtr`) and vegetation (`parseMtm2Veg`), or null. */
    lakes: wtrBytes ? safely(() => parseWtr(wtrBytes), "lakes") : null,
    vegetation: vegBytes && isMtm2Veg(vegBytes) ? safely(() => parseMtm2Veg(vegBytes), "vegetation") : null,
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
