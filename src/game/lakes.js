/*
  Community Patch 4's lakes (docs/CP4_EXE_ANALYSIS.md 2), as the drawing and the eye need them. The
  engine's water level at (x, z) (`FUN_140205570`) is the lake's surface on a lake tile, else the
  track's own water. Pure: no three.js, so the tests and the workers can use it.
*/

const TILE_FT = 32, TILES = 256;

/**
 * The lake id (0 none) of the 32 ft tile under game (x, z), the world wrapping at 8192 ft, or at a track format version 6
 * world's size (its tile map `lakes.cells` a side). `lakes` is a build's.
 */
export function lakeAt(lakes, x, z) {
  if (!lakes?.tileMap || !Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const tiles = lakes.cells ?? TILES;
  const col = ((Math.floor(x / TILE_FT) % tiles) + tiles) % tiles;
  const row = ((Math.floor(z / TILE_FT) % tiles) + tiles) % tiles;
  return lakes.tileMap[row * tiles + col];
}

/**
 * The water level at game (x, z): a lake's surface on its tiles, else `trackLevelFt` (the track's water, bob and all,
 * or null for none).
 */
export function waterLevelAt(lakes, x, z, trackLevelFt = null) {
  const id = lakeAt(lakes, x, z);
  // Every id left on the map is a kept lake (worker/track-build.js `lakesOf`): its surface may be at or below 0 ft on a track
  // format version 6 track.
  return id ? lakes.levelFt[id] : trackLevelFt;
}

/** waterLakeOwnPass's default (docs/CP4_EXE_ANALYSIS.md 2): a lake further than this above the base plane has its own reflection pass. */
export const LAKE_OWN_PASS_FT = 10;
/** waterMirrorExtra's default: the planes besides the base one that may have their own pass in a frame. */
export const MIRROR_EXTRA = 2;

/**
 * Which lakes the base plane's reflection serves (docs/CP4_EXE_ANALYSIS.md 2): the lakes grouped by distinct height,
 * lowest first; the base plane is the track's water, or the lowest lake where there is none; a group within
 * LAKE_OWN_PASS_FT of it shares its pass. The rest would each need a pass of their own (`ownPass`, the first
 * MIRROR_EXTRA of them by height; `unserved` the others). Heights in feet.
 */
export function lakeReflectionPlan(bodies, trackLevelFt = null) {
  const heights = [...new Set(bodies.map((b) => b.levelFt))].sort((a, b) => a - b);
  const base = trackLevelFt ?? heights[0] ?? null;
  const shared = [], own = [];
  for (const h of heights) (base !== null && h - base <= LAKE_OWN_PASS_FT ? shared : own).push(h);
  return { base, shared, ownPass: own.slice(0, MIRROR_EXTRA), unserved: own.slice(MIRROR_EXTRA) };
}
