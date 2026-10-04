/*
  One track's files, read through the VFS into plain data (MONSTER_EXE_ANALYSIS.md section 17).

  WORLD\<name>.SIT names the level; LEVELS\<name>.LVL names the heightfield, colour grid,
  palette, texture list, sky and lighting; those live in DATA\ (heightfield, grid, lists,
  lighting, ground boxes) and ART\ (palette, sky). Every name is looked up in that folder,
  first match in mount order, as the game does.

  Pure: plain data and typed arrays, no DOM, so Node tests load stock tracks with it.
*/
import {
  decodeActPalette, mtm2Sim, parseMtmLvl, parseMtmSit, parseTexList, parseTty, podPathTitle,
} from "../vendor/openphotex/index.js";

const GRID = 256;

function stemOf(name) {
  const title = podPathTitle(name);
  const dot = title.lastIndexOf(".");
  return dot >= 0 ? title.slice(0, dot) : title;
}

/** Read `name` from `folder`, by its file name only (the LVL writes bare names). */
async function readIn(vfs, folder, name) {
  if (!name) return null;
  return vfs.read(`${folder}\\${podPathTitle(name)}`);
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @param {string} sitPath e.g. "WORLD\\TPARK.SIT"
 */
export async function loadLevel(vfs, sitPath) {
  const sitBytes = await vfs.read(sitPath);
  if (!sitBytes) throw new Error(`${sitPath} is not in the mounted archives.`);
  const title = podPathTitle(sitPath);
  const sit = parseMtmSit(sitBytes, title);
  const stem = stemOf(title);

  const lvlBytes = await vfs.read(`LEVELS\\${stem}.LVL`);
  if (!lvlBytes) throw new Error(`LEVELS\\${stem}.LVL is missing.`);
  const lvl = parseMtmLvl(lvlBytes);

  const heights = await readIn(vfs, "DATA", lvl.rawName);
  if (!heights || heights.length !== GRID * GRID) throw new Error(`${lvl.rawName}: not a 256 x 256 heightfield.`);
  const clrBytes = await readIn(vfs, "DATA", lvl.clrName);
  const clr = new Uint16Array(GRID * GRID);
  if (clrBytes && clrBytes.length >= GRID * GRID * 2) {
    for (let i = 0; i < clr.length; i++) clr[i] = clrBytes[i * 2] | (clrBytes[i * 2 + 1] << 8);
  }

  const texBytes = await readIn(vfs, "DATA", lvl.texName);
  const textureNames = texBytes ? parseTexList(texBytes).map((n) => podPathTitle(n)) : [];
  const ttyBytes = await vfs.read(`DATA\\${stemOf(lvl.texName)}.TTY`);
  const tty = ttyBytes ? parseTty(ttyBytes) : [];
  const textureValues = mtm2Sim.textureTypeValues(textureNames, tty);

  const palette = decodeActPalette(await readIn(vfs, "ART", lvl.actName));
  const lte = await readIn(vfs, "DATA", lvl.lteName);
  const groundBoxes = {
    ra0: await vfs.read(`DATA\\${stem}.RA0`),
    ra1: await vfs.read(`DATA\\${stem}.RA1`),
    cl0: await vfs.read(`DATA\\${stem}.CL0`),
  };

  const sky = lvl.skyRawName
    ? { name: podPathTitle(lvl.skyRawName), actName: lvl.skyActName ? podPathTitle(lvl.skyActName) : null }
    : null;

  return {
    title, stem, sit, lvl,
    heights, clr, lte,
    textureNames, tty, textureValues,
    palette,
    groundBoxes,
    sky,
    /** The water level in feet (the LVL's `!waterHeight` is in half feet), or null for none. */
    waterLevelFt: lvl.waterHeight ? lvl.waterHeight / 2 : null,
  };
}

/**
 * A texture as the game loads it: ART\<name>.RAW with ART\<stem>.ACT, or the level palette
 * when the texture has no .ACT of its own (cTextureMap::load, 0x55a690).
 * Returns `{ name, raw, palette }` or null when the texture is missing.
 */
export async function loadTextureSource(vfs, name, levelPalette) {
  const title = podPathTitle(name);
  const raw = await vfs.read(`ART\\${title.endsWith(".RAW") ? title : `${stemOf(title)}.RAW`}`);
  if (!raw) return null;
  const own = decodeActPalette(await vfs.read(`ART\\${stemOf(title)}.ACT`));
  return { name: title, raw, palette: own ?? levelPalette };
}
