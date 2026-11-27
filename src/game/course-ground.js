/**
 * The ground the computer trucks' autopilot reads on a track built of meshes (OpenMTM2's rule, not the game's).
 *
 * The autopilot's height lookup (MTM2_PHYSICS.md 12 and 14.22, `0x550090`) is the ground with box and ramp tops: the
 * surface the course runs on. On a classic track that is the terrain. On a track whose road is made of meshes standing
 * high over the terrain (a sky track: the road 1,500 ft over a plain), the terrain alone puts every aim point and every
 * arc centre far under the truck: the straights' target speed comes out 0, the arcs' racing line collapses toward
 * their centres and the cross-track error is read many times too large.
 *
 * So on such a track a height asked for at (x, z) is read at the course's own height there, as the helicopter already
 * does (sim-worker.js `courseGround`): the reference is the nearest of the SIT's straights (in x and z), its height
 * read along it; the answer is the drivable surface under the reference (a mesh face or the terrain, from 6 ft over it
 * down 80 ft), else the reference itself (an arc's centre hanging in the air over the plain). It is never below the
 * terrain, so a course whose points lie under the ground reads what it read before.
 *
 * @param straightsLists  the SIT courses: arrays of straights with `startFt` and `endFt` ([x, y, z] feet)
 * @param surfaceBelow    `(x, y, z, depth) => height | null` (game/mesh-ground.js)
 * @param terrain         `(x, z) => height`, the terrain with ramps (the ground the classic autopilot reads)
 * @param wrapDelta       `(d) => d` folded into the world (a world that wraps), identity otherwise
 * @returns `(x, z) => height`, or null when there is no course to take heights from
 */
export function createCourseGround({ straightsLists, surfaceBelow, terrain, wrapDelta = (d) => d }) {
  const segs = [];
  for (const list of straightsLists) {
    for (const s of list ?? []) {
      const a = s?.startFt, b = s?.endFt;
      if (!a || !b || ![a[0], a[1], a[2], b[0], b[1], b[2]].every(Number.isFinite)) continue;
      segs.push({ ax: a[0], ay: a[1], az: a[2], dx: b[0] - a[0], dy: b[1] - a[1], dz: b[2] - a[2] });
    }
  }
  if (!segs.length) return null;
  /** The course's height nearest (x, z): along the nearest straight, by its share of the way. */
  const referenceY = (x, z) => {
    let best = Infinity, y = 0;
    for (const s of segs) {
      const px = wrapDelta(x - s.ax), pz = wrapDelta(z - s.az);
      const len2 = s.dx * s.dx + s.dz * s.dz;
      const u = len2 > 0 ? Math.max(0, Math.min(1, (px * s.dx + pz * s.dz) / len2)) : 0;
      const ex = px - s.dx * u, ez = pz - s.dz * u;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) { best = d2; y = s.ay + s.dy * u; }
    }
    return y;
  };
  return (x, z) => {
    const ref = referenceY(x, z);
    const h = surfaceBelow(x, ref + 6, z, 80) ?? ref;
    const g = terrain(x, z);
    return h > g ? h : g;
  };
}
