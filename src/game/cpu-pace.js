/*
  A computer truck learning the track (an addition, not the game's): the course autopilot drives every corner at the
  SIT's speed, which on Professional's course 2 is often more than the tires give, so the same trucks slide wide at
  the same corners lap after lap and miss the gates there. Each truck keeps a pace factor per course segment:

  - a slide, a spin or a missed checkpoint at a segment lowers that segment's factor by `drop` (a spin or a miss also
    the segment before it, where the trouble started), never below `floor`;
  - leaving a segment cleanly gives `gain` of its pace back, up to 1;
  - on an arc the autopilot's target speed is scaled by the arc's factor; on a straight by the smaller of its own
    and the next arc's, since a straight's target is the braking toward that arc.

  The factor scales the target speed only, never the engine, so a truck that has learnt a corner still accelerates
  out of it as before. Measured headless on Professional, 8 computer trucks (docs/CHANGELOG.md): with the corner-aware
  slide catch and the cheaper helicopter, 18 to 31 laps on Valparaíso Racing 2026 in 300 s, 16 to 29 on Crazy 98.
  A flat 10 percent corner margin measured worse: it slows every corner, this one only the corners a truck cannot
  take. Pure, so it runs under Node.
*/

/** The figures: what a slide, spin or miss costs a segment, the least pace kept, and what a clean pass gives back. */
export const CPU_PACE = Object.freeze({ drop: 0.92, floor: 0.7, gain: 0.02 });

/** A truck's memory: a factor per segment, the segment it is in, and whether that segment has gone wrong. */
export function createCpuPace(segments) {
  return { factors: new Array(Math.max(0, segments | 0)).fill(1), segment: -1, bad: false, missed: false };
}

/**
 * One step. `segment` is the truck's course segment, `slide`, `spin` whether a slide or spin began this step,
 * `missed` whether the race rules hold the truck as having missed its checkpoint (an edge is taken here). Returns
 * whether the step lowered a factor.
 */
export function cpuPaceObserve(m, { segment, slide = false, spin = false, missed = false }, T = CPU_PACE) {
  const n = m.factors.length;
  if (!n || !(segment >= 0 && segment < n)) return false;
  const miss = missed && !m.missed;
  m.missed = missed;
  if (segment !== m.segment) {
    // Leaving a segment cleanly: a little of its pace comes back.
    if (m.segment >= 0 && m.segment < n && !m.bad) m.factors[m.segment] = Math.min(1, m.factors[m.segment] + T.gain);
    m.segment = segment;
    m.bad = false;
  }
  if (!slide && !spin && !miss) return false;
  m.bad = true;
  const lower = (i) => { m.factors[i] = Math.max(T.floor, m.factors[i] * T.drop); };
  lower(segment);
  if (spin || miss) lower((segment + n - 1) % n);
  return true;
}

/**
 * The factor on the autopilot's target speed for `segment` of `course` (built segments, `ctype` 2 an arc): the
 * arc's own, or on a straight the smaller of its own and the next segment's. 1 when the segment is unknown.
 */
export function cpuPaceFactor(m, segment, course) {
  const n = m.factors.length;
  if (!n || !(segment >= 0 && segment < n)) return 1;
  const own = m.factors[segment];
  if (course?.[segment]?.ctype === 2) return own;
  return Math.min(own, m.factors[(segment + 1) % n]);
}

/**
 * The direction the course runs at `pos` on `seg` (a built segment), radians, heading `atan2(dx, dz)`: a straight's
 * direction, an arc's tangent at the truck's angle round the centre. Used to tell a truck that has spun round.
 */
export function segmentHeading(seg, pos) {
  if (!seg) return null;
  if (seg.ctype !== 2) return Math.atan2(seg.end[0] - seg.start[0], seg.end[2] - seg.start[2]);
  const theta = Math.atan2(pos[0] - seg.centre[0], pos[2] - seg.centre[2]);
  const span = wrapPi(seg.exitAngle - seg.entryAngle);
  return theta + (span > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/**
 * The signed curvature of `seg` for the slide catch (game/cpu-control.js): 1 / radius, positive for a right-hand arc
 * (the heading grows round it), 0 on a straight or with no segment.
 */
export function segmentCurvature(seg) {
  if (!seg || seg.ctype !== 2 || !(seg.radius > 0)) return 0;
  return (wrapPi(seg.exitAngle - seg.entryAngle) > 0 ? 1 : -1) / seg.radius;
}

/** Whether a truck's travel is a slide: over `slipRad` off its nose at `minSpeed` or more, `minWheels` down, going forward. */
export function isSliding(state, { slipRad = 0.35, minSpeed = 25, minWheels = 3 } = {}) {
  const [vx, , vz] = state.bvel;
  if (!(vz > 0) || Math.hypot(vx, vz) < minSpeed) return false;
  const down = state.tires ? state.tires.filter((t) => t.onGround).length : 4;
  return down >= minWheels && Math.abs(Math.atan2(vx, vz)) > slipRad;
}

/** Whether a truck has spun: its nose more than `rad` off the course's direction `heading`. */
export function isSpun(state, heading, rad = 1.75) {
  if (heading === null || heading === undefined) return false;
  return Math.abs(wrapPi(heading - state.euler[2])) > rad;
}

function wrapPi(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
}
