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
});

/**
 * The SIT as hotfix 4 keeps it: the first CP4_LIMITS.trucks of the vehicle list (the player's slot kept), the first
 * CP4_LIMITS.backdrops backdrop models, the primary course and the first four extended ones, each cut to
 * CP4_LIMITS.segments segments. Ramps are capped where they are listed (worker/track-build.js), since a ramp keeps its
 * SIT index. `log(line)` gets the engine's message for each drop. Returns a new object; the input is not changed.
 */
export function withCp4Limits(sit, log = () => {}) {
  if (!sit) return sit;
  const out = { ...sit };
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
