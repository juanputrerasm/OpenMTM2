/*
  A course's runs as the path a truck drives, with the corners rounded off: the OpenMTM2 map's line
  (render/open-map.js). Ported from JSTrackViewer's Smooth course style (scene.js `smoothCoursePath`), flat, in feet.

  A course is a list of straight runs. MTM's usually meet end to start; an Evo course leaves the corners out, so each
  run ends before its corner and the next starts after it. Each join gets the curve the road takes:

    runs that turn         a curve with its control point where the two runs' lines meet
    runs that double back  a U turn from the end of one to the start of the other, carried past whichever stops short
    anything else          an S curve leaving and arriving along each run (a lane change, a slight bend)

  A turn reaches back along both runs, as far as COURSE_CORNER_RADIUS_FT from the corner and never more than half of
  either run, so a corner draws as a wide sweep rather than a kink, and two curves on one run never overlap.
*/

export const COURSE_CORNER_RADIUS_FT = 240;
export const COURSE_CURVE_STEPS = 16;
const MAX_SEGMENTS = 256;

/** The course's straights as `[[x, z], [x, z]]` runs, feet, in course order (the primary course's type 1 entries). */
export function courseSegments(course) {
  const segments = [];
  for (const g of course ?? []) {
    if (g.ctype !== undefined && g.ctype !== 1) continue;
    if (!g.startFt || !g.endFt) continue;
    segments.push([[g.startFt[0], g.startFt[2]], [g.endFt[0], g.endFt[2]]]);
    if (segments.length >= MAX_SEGMENTS) break;
  }
  return segments;
}

const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
const quad = (p0, p1, p2, t) => { const u = 1 - t; return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]; };
const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
};
/** The curve's points between its ends. */
const inner = (at) => Array.from({ length: COURSE_CURVE_STEPS - 1 }, (_, i) => at((i + 1) / COURSE_CURVE_STEPS));

/** The curve from run a to run b: where it leaves a, where it joins b, and the points between. */
export function courseJoin([aStart, aEnd], [bStart, bEnd]) {
  const R = COURSE_CORNER_RADIUS_FT;
  let d0 = [aEnd[0] - aStart[0], aEnd[1] - aStart[1]], d1 = [bEnd[0] - bStart[0], bEnd[1] - bStart[1]];
  const lenA = Math.hypot(d0[0], d0[1]), lenB = Math.hypot(d1[0], d1[1]);
  const straight = { from: aEnd, to: bStart, points: [] };
  if (lenA < 1e-3 || lenB < 1e-3) return straight;
  d0 = [d0[0] / lenA, d0[1] / lenA]; d1 = [d1[0] / lenB, d1[1] / lenB];
  const gap = [bStart[0] - aEnd[0], bStart[1] - aEnd[1]];
  const cross = d0[0] * d1[1] - d0[1] * d1[0];
  // A point `along` a run measured from its start (and past it).
  const onA = (along) => lerp(aStart, aEnd, along / lenA);
  const onB = (along) => lerp(bStart, bEnd, along / lenB);

  if (Math.abs(cross) > 0.05) {
    // Where the two runs' lines meet: s ahead of a's end, t behind b's start.
    const s = (gap[0] * d1[1] - gap[1] * d1[0]) / cross;
    const t = (d0[0] * gap[1] - d0[1] * gap[0]) / cross;
    if (s > -lenA / 2 && t > -lenB / 2 && s < 4 * R && t < 4 * R) {
      // The same distance back along both runs where it can be, so the curve is even.
      const lo = Math.max(s, t, 0);
      const hi = Math.min(s + lenA / 2, t + lenB / 2);
      const r = lo <= hi ? Math.min(Math.max(R, lo), hi) : null;
      const rA = r ?? Math.min(Math.max(R, s, 0), s + lenA / 2);
      const rB = r ?? Math.min(Math.max(R, t, 0), t + lenB / 2);
      const from = onA(lenA + s - rA), to = onB(rB - t), corner = onA(lenA + s);
      return { from, to, points: inner((f) => quad(from, corner, to, f)) };
    }
  }

  const g = Math.hypot(gap[0], gap[1]);
  if (g < 1) return straight;
  const ahead0 = (k) => [aEnd[0] + d0[0] * k, aEnd[1] + d0[1] * k], behind1 = (k) => [bStart[0] - d1[0] * k, bStart[1] - d1[1] * k];
  if (d0[0] * d1[0] + d0[1] * d1[1] < 0) {
    // Doubling back: carry on past whichever run stops short, then come round.
    const ahead = gap[0] * d0[0] + gap[1] * d0[1];
    const width = Math.abs(gap[0] * d0[1] - gap[1] * d0[0]);
    const c0 = ahead0(Math.max(ahead, 0) + width * 0.66), c1 = behind1(Math.max(-ahead, 0) + width * 0.66);
    return { from: aEnd, to: bStart, points: inner((f) => cubic(aEnd, c0, c1, bStart, f)) };
  }
  const c0 = ahead0(g / 3), c1 = behind1(g / 3);
  return { from: aEnd, to: bStart, points: inner((f) => cubic(aEnd, c0, c1, bStart, f)) };
}

/** The whole path, `[x, z]` feet: each run with its joins rounded; a loop ends where it began. */
export function smoothCoursePath(segments, loop = true) {
  const n = segments.length;
  if (!n) return [];
  const starts = segments.map(([start]) => start);
  const ends = segments.map(([, end]) => end);
  const curves = [];
  for (let i = 0; i < (loop ? n : n - 1); i++) {
    const j = (i + 1) % n;
    const join = courseJoin(segments[i], segments[j]);
    ends[i] = join.from;
    starts[j] = join.to;
    curves[i] = join.points;
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push(starts[i], ends[i], ...(curves[i] ?? []));
  if (loop) out.push(starts[0]);
  return out;
}
