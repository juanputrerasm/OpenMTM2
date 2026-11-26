/*
  The limits Community Patch 4 beta 0.53 hotfix 4 keeps on a track's lists (docs/CP4_EXE_ANALYSIS.md 17.1): where older
  builds overran a table, it keeps the first N in the file's order, drops the rest and logs a line. OpenMTM2 keeps the
  same first N, so a track behaves as in the fixed game; each drop is logged to the console with the engine's wording.
  Pure: the tests use it.
*/

export const CP4_LIMITS = Object.freeze({
  /** Trucks the SIT's vehicle list places (besides the player's slot). */
  trucks: 10,
  /** Entries of the SIT's ramp section. */
  ramps: 100,
  /** Backdrop models the SIT lists. */
  backdrops: 5,
  /** AI courses: the primary and four extended ones. */
  courses: 5,
  /** Segments a course keeps. */
  segments: 249,
  // Community Patch 4 2.0.52.4 (docs/CP4_ENGINE_UPDATES.md 6):
  /** Placed objects of a `.SIT`/`.SI2`, and of a `.SI3`. */
  objects: 4608,
  objectsSi3: 16384,
  /** Checkpoint slots on every track type; more refuses the track. */
  checkpoints: 100,
  /** Top-crush cars. */
  topCrush: 100,
  /** Movers: trains (type 10) and moving boxes (type 13). */
  movers: 100,
  /** Surface (.SRF) boxes a track. */
  surfaceBoxes: 64,
  /** Vegetation: species, trees, ground-cover clumps, clumps a tile. */
  vegSpecies: 64,
  vegTrees: 32768,
  vegClumps: 2097152,
  vegClumpsPerTile: 1024,
});

/**
 * The SIT as hotfix 4 keeps it: the first CP4_LIMITS.trucks of the vehicle list (the player's slot kept), the first
 * CP4_LIMITS.backdrops backdrop models, the primary course and the first four extended ones, each cut to
 * CP4_LIMITS.segments segments. Ramps are capped where they are listed (worker/track-build.js), since a ramp keeps its
 * SIT index. `log(line)` gets the engine's message for each drop. Returns a new object; the input is not changed.
 */
export function withCp4Limits(sit, log = () => {}, { si3 = false } = {}) {
  if (!sit) return sit;
  const out = { ...sit };
  // 2.0.52.4's object cap: the first N placed objects (checkpoints, ramps and movers are boxes too).
  const objects = si3 ? CP4_LIMITS.objectsSi3 : CP4_LIMITS.objects;
  if ((sit.boxes?.length ?? 0) > objects) {
    log(`This track places ${sit.boxes.length} objects; this build holds ${objects}.`);
    out.boxes = sit.boxes.slice(0, objects);
  }
  if ((sit.topCrush?.length ?? 0) > CP4_LIMITS.topCrush) {
    log(`This track places ${sit.topCrush.length} top-crush cars; this build holds ${CP4_LIMITS.topCrush}.`);
    out.topCrush = sit.topCrush.slice(0, CP4_LIMITS.topCrush);
  }
  // Movers past the first 100 stand still: their places in the box list are kept.
  let movers = 0;
  if (out.boxes?.some((b) => (b.type === 10 || b.type === 13) && b.bvel)) {
    out.boxes = out.boxes.map((b) => {
      if ((b.type !== 10 && b.type !== 13) || !b.bvel) return b;
      return ++movers > CP4_LIMITS.movers ? { ...b, bvel: null } : b;
    });
    if (movers > CP4_LIMITS.movers) log(`This track has ${movers} moving objects; this build moves ${CP4_LIMITS.movers}.`);
  }
  const placed = (sit.trucks ?? []).filter((t) => !t.playerSlot);
  if (placed.length > CP4_LIMITS.trucks) {
    log(`This track places ${placed.length} trucks; this build holds ${CP4_LIMITS.trucks}.`);
    const kept = new Set(placed.slice(0, CP4_LIMITS.trucks));
    out.trucks = sit.trucks.filter((t) => t.playerSlot || kept.has(t));
  }
  if ((sit.backdropModelNames?.length ?? 0) > CP4_LIMITS.backdrops) {
    log(`This track lists ${sit.backdropModelNames.length} backdrop models; this build holds ${CP4_LIMITS.backdrops}.`);
    out.backdropModelNames = sit.backdropModelNames.slice(0, CP4_LIMITS.backdrops);
  }
  const extended = sit.extendedCourses ?? [];
  if (extended.length > CP4_LIMITS.courses - 1) {
    log(`This track defines ${extended.length + 1} AI courses; this build holds ${CP4_LIMITS.courses}.`);
  }
  let cut = false;
  const trim = (course) => {
    if (!course?.segments || course.segments.length <= CP4_LIMITS.segments) return course;
    cut = true;
    return { ...course, segments: course.segments.slice(0, CP4_LIMITS.segments) };
  };
  out.primaryCourse = trim(sit.primaryCourse);
  out.extendedCourses = extended.slice(0, CP4_LIMITS.courses - 1).map(trim);
  if (cut) log(`An AI course on this track has more than ${CP4_LIMITS.segments} segments; the rest were dropped.`);
  return out;
}

/**
 * A track's checkpoint slots (box type 6) checked against 2.0.52.4's 100 (CP4_ENGINE_UPDATES.md 6): the refusal's note,
 * or null. With a `.CPX` the slots are its own (copies share a slot), counted by the rules check instead.
 */
export function checkpointRefusal(sit) {
  const n = (sit?.boxes ?? []).filter((b) => b.type === 6).length;
  return n > CP4_LIMITS.checkpoints ? `this track has ${n} checkpoints; the most a track may have is ${CP4_LIMITS.checkpoints}` : null;
}

/**
 * A `.VEG` (OpenPhotex `parseMtm2Veg`) as 2.0.52.4 keeps it (CP4_ENGINE_UPDATES.md 6): the first 64 species, the first
 * 32,768 trees and 2,097,152 clumps; a tile entry of more than 1,024 clumps, or one out of (tz, tx) order, repeated or
 * overlapping the one before, is dropped whole. Returns a new object.
 */
export function withCp4VegLimits(veg, log = () => {}) {
  if (!veg) return veg;
  const L = CP4_LIMITS;
  const out = { ...veg };
  if (veg.species.length > L.vegSpecies) {
    log(`This track's vegetation has ${veg.species.length} species; this build holds ${L.vegSpecies}.`);
    out.species = veg.species.slice(0, L.vegSpecies);
  }
  const t = veg.trees;
  if (t.count > L.vegTrees) {
    log(`This track has ${t.count} trees; this build holds ${L.vegTrees}.`);
    const n = L.vegTrees;
    out.trees = { count: n, position: t.position.subarray(0, 3 * n), species: t.species.subarray(0, n), heading: t.heading.subarray(0, n), scale: t.scale.subarray(0, n), tint: t.tint.subarray(0, n), tier: t.tier.subarray(0, n) };
  }
  const c = veg.clumps;
  if (c.tiles?.length) {
    const tiles = [];
    let last = -1, end = 0, total = 0, dropped = 0;
    for (const tile of c.tiles) {
      const key = tile.tz * 65536 + tile.tx;
      const ok = key > last && tile.first >= end && tile.count <= L.vegClumpsPerTile && tile.first + tile.count <= c.count && total + tile.count <= L.vegClumps;
      if (!ok) { dropped++; continue; }
      tiles.push(tile);
      last = key; end = tile.first + tile.count; total += tile.count;
    }
    if (dropped) {
      log(`${dropped} ground-cover tiles were dropped (out of order, over ${L.vegClumpsPerTile} clumps, or past ${L.vegClumps} in all).`);
      out.clumps = { ...c, tiles };
    }
  }
  return out;
}
