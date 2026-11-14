/*
  Community Patch 4 beta 0.53's "outside light" for roofed arenas: the shadow shells (docs/CP4_EXE_ANALYSIS.md 13).

  A shell is a placed object with a model at least SHELL_MIN_FT wide and long whose roof covers at least
  SHELL_ROOF_PCT percent of it. Each frame the shells whose box holds the camera are listed (at most SHELLS_LISTED),
  and each listed shell's model is left out of the sun's shadow-map pass while it stays drawn: under the roof the
  trucks, the ground and the props are lit by the open sun. Nothing else about the light changes.

  Pure: game feet (x right, y up, z forward), no three.js, so the worker and the tests use it.
*/
import { mapWrap } from "../shared/scene-frame.js";

/** `[Graphics] shadowShellMinFt`'s default: the least width and length of a shell, feet. */
export const SHELL_MIN_FT = 500;
/** `[Graphics] shadowShellRoofPct`'s default: the least roof cover of a shell, percent. */
export const SHELL_ROOF_PCT = 70;
/** The roof cover's rays: a grid of this many by this many over the model. */
export const ROOF_GRID = 12;
/** A ray counts when it meets a triangle in this top share of the model's height. */
export const ROOF_TOP_SHARE = 0.4;
/** A model less tall than this, feet, has no roof: its cover is 0. */
export const ROOF_MIN_HEIGHT_FT = 30;
/** How far below the model a shell's box reaches, feet. */
export const SHELL_FLOOR_FT = 10;
/** The most shells listed in a frame. */
export const SHELLS_LISTED = 8;

/**
 * A model's roof cover, percent: `positions` its triangles (nine numbers each, model space, feet, y up), `bounds`
 * `{ min, max }` its extents (from the triangles when not given). A grid of ROOF_GRID x ROOF_GRID vertical rays,
 * one through the middle of each cell over the model's width and length; a ray counts when it meets a triangle at a
 * height in the top ROOF_TOP_SHARE of the model's. Cover = hits x 100 / 144. A model under ROOF_MIN_HEIGHT_FT tall
 * scores 0. The z mirror into the scene changes nothing: the grid is the same either way round.
 */
export function roofCover(positions, bounds = boundsOf(positions)) {
  if (!positions?.length || !bounds) return 0;
  const [x0, y0, z0] = bounds.min, [x1, y1, z1] = bounds.max;
  const height = y1 - y0;
  if (!(height >= ROOF_MIN_HEIGHT_FT)) return 0;
  const floor = y1 - ROOF_TOP_SHARE * height;
  // Only the triangles that reach the top share can count.
  const top = [];
  for (let t = 0; t + 8 < positions.length; t += 9) {
    if (Math.max(positions[t + 1], positions[t + 4], positions[t + 7]) >= floor) top.push(t);
  }
  let hits = 0;
  for (let i = 0; i < ROOF_GRID; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / ROOF_GRID;
    for (let j = 0; j < ROOF_GRID; j++) {
      const z = z0 + ((j + 0.5) * (z1 - z0)) / ROOF_GRID;
      for (const t of top) {
        const y = heightOnTriangle(positions, t, x, z);
        if (y !== null && y >= floor) { hits++; break; }
      }
    }
  }
  return (hits * 100) / (ROOF_GRID * ROOF_GRID);
}

/** Where the vertical line through (x, z) meets triangle `t` of `p`, its height, or null where it misses it. */
function heightOnTriangle(p, t, x, z) {
  const ax = p[t], ay = p[t + 1], az = p[t + 2];
  const bx = p[t + 3], by = p[t + 4], bz = p[t + 5];
  const cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  // A triangle on edge to the ray (a wall) is never met by it.
  if (Math.abs(d) < 1e-9) return null;
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
  const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  const w = 1 - u - v;
  const e = -1e-9;
  if (u < e || v < e || w < e) return null;
  return u * ay + v * by + w * cy;
}

/** The extents of triangles `positions`, `{ min, max }`, or null for none. */
export function boundsOf(positions) {
  if (!positions?.length) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * Whether a model of extents `bounds` (`{ min, max }`, feet) and roof cover `roofPct` makes a shell: at least `minFt`
 * wide (x) and long (z), its roof at least `roofPct` percent.
 */
export function isShadowShell(bounds, roofPct, { minFt = SHELL_MIN_FT, minRoofPct = SHELL_ROOF_PCT } = {}) {
  if (!bounds) return false;
  const width = bounds.max[0] - bounds.min[0], length = bounds.max[2] - bounds.min[2];
  return width >= minFt && length >= minFt && roofPct >= minRoofPct;
}

/**
 * A model's shell, measured once a level: `{ min, max, roofPct }` (its extents, game feet), or null when it is not
 * one. The size is tested first, so a model too small is never measured.
 */
export function shellModelOf(bounds, positions, options) {
  if (!bounds || !isShadowShell(bounds, Infinity, options)) return null;
  const roofPct = roofCover(positions, bounds);
  return isShadowShell(bounds, roofPct, options) ? { min: [...bounds.min], max: [...bounds.max], roofPct } : null;
}

/**
 * Which shells hold the point (x, y, z), game feet: their indexes in `shells`, in order, written into `out`, at most
 * `max` (SHELLS_LISTED). The count is returned. A shell is `{ pos, rot, min, max }`: where it stands (game feet), its
 * turn (row-major, body to world, as OpenPhotex's `eulerToMatrix`), and its model's extents; its box is those
 * extents turned with it, the bottom SHELL_FLOOR_FT lower. With `wraps` the world repeats every `worldFt` (8192 ft, or a
 * track format version 6 world's) and the copy
 * of the point nearest the shell is tested. Nothing is made: it runs each frame.
 */
export function shellsHolding(shells, x, y, z, out, { max = SHELLS_LISTED, wraps = true, worldFt = 8192 } = {}) {
  let count = 0;
  const cap = Math.min(max, out.length);
  for (let i = 0; i < shells.length && count < cap; i++) {
    const { pos, rot: m, min, max: top } = shells[i];
    const dx = wraps ? mapWrap(x - pos[0], worldFt) : x - pos[0], dy = y - pos[1], dz = wraps ? mapWrap(z - pos[2], worldFt) : z - pos[2];
    // Into the shell's own frame: the turn's transpose.
    const bx = m[0] * dx + m[3] * dy + m[6] * dz;
    const by = m[1] * dx + m[4] * dy + m[7] * dz;
    const bz = m[2] * dx + m[5] * dy + m[8] * dz;
    if (bx >= min[0] && bx <= top[0] && by >= min[1] - SHELL_FLOOR_FT && by <= top[1] && bz >= min[2] && bz <= top[2]) out[count++] = i;
  }
  return count;
}

/**
 * The shells of a level's placed objects: `objects` `[{ model, pos, rot }]` (game feet, `rot` row-major), `modelOf(name)`
 * `{ bounds, positions }` (the model's extents and its triangles in model space, game feet) or null. Each model is
 * measured once. Returns the objects that are shells, in their order, each with its model's `min`, `max` and `roofPct`.
 */
export function levelShells(objects, modelOf, options) {
  const measured = new Map();
  const shells = [];
  for (const object of objects) {
    const { model, pos, rot } = object;
    if (!measured.has(model)) {
      const found = modelOf(model);
      measured.set(model, found ? shellModelOf(found.bounds, found.positions, options) : null);
    }
    const shell = measured.get(model);
    if (shell) shells.push({ ...object, pos: [...pos], rot: [...rot], min: shell.min, max: shell.max, roofPct: shell.roofPct });
  }
  return shells;
}
