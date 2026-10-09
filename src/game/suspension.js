/*
  The truck's visible suspension parts (MONSTER_EXE_ANALYSIS.md 3.2, truck draw 0x54cdb0, bars and
  shocks 0x54bc00, driveshaft 0x54bf00, ribbons 0x54b650): per axle two axle bars from the axle's
  ends to a point on the chassis, four shocks standing on the axle, and a driveshaft from the
  transfer case to the axle. Positions are in body axes (x right, y up, z forward), feet. The
  game's numbers are in 1/256 ft: they are written here in feet with the integer in a comment.
  Pure, so it runs under Node.
*/

/** The axle bar's end on the axle (x +-512, y -79, z 79 toward the chassis) and shock feet (x +-542, y 84, z +-71), in the axle's frame. */
export const BAR_AXLE_END = Object.freeze({ x: 512 / 256, y: -79 / 256, z: 79 / 256 });
export const SHOCK_FOOT = Object.freeze({ x: 542 / 256, y: 84 / 256, z: 71 / 256 });
/** The shocks' tops on the body: x +-542, y 0, z = the axle's +-71.68. */
export const SHOCK_TOP = Object.freeze({ x: 542 / 256, y: 0, z: 71.68 / 256 });
/** Half the ribbon widths: bars 40.96, shocks 38.4 units. */
export const BAR_HALF_WIDTH_FT = 40.96 / 256, SHOCK_HALF_WIDTH_FT = 38.4 / 256;

/**
 * The bar's chassis point from the TRK's `axlebarOffset`: x is pulled in by 0.1 ft toward the
 * centre, y is at most -2 ft (-512) and then 39.68 units higher, z as given.
 */
export function barChassisPoint(offset) {
  const x = offset.x > 0 ? offset.x - 0.1 : offset.x + 0.1;
  return { x, y: Math.min(offset.y, -512 / 256) + 39.68 / 256, z: offset.z };
}

const toBody = (axle, p) => {
  const c = Math.cos(axle.articulation), s = Math.sin(axle.articulation);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c + axle.travel, p[2] + axle.z];
};

/**
 * The parts at one moment. `axles` are `{ z, travel, articulation }` front then rear (z the axle's place
 * along the body, travel its height); `axlebar` and `driveshaft` the TRK's offsets.
 * Returns `{ bars: [[from, to]], shocks: [[from, to]], shafts: [{ from, to, length }] }`.
 */
export function suspensionParts({ axles, axlebar, driveshaft }) {
  const top = barChassisPoint(axlebar);
  const bars = [], shocks = [], shafts = [];
  for (const axle of axles) {
    // The bar's axle end sits toward the chassis: behind the front axle, ahead of the rear.
    const toward = axle.z > 0 ? -1 : 1;
    for (const side of [1, -1]) {
      bars.push([toBody(axle, [side * BAR_AXLE_END.x, BAR_AXLE_END.y, toward * BAR_AXLE_END.z]), [side * top.x, top.y, top.z]]);
      for (const end of [1, -1]) {
        shocks.push([toBody(axle, [side * SHOCK_FOOT.x, SHOCK_FOOT.y, end * SHOCK_FOOT.z]), [side * SHOCK_TOP.x, SHOCK_TOP.y, axle.z + end * SHOCK_TOP.z]]);
      }
    }
    // The driveshaft runs from the transfer point to the axle's centre, in the y-z plane.
    const to = [driveshaft.x, axle.travel, axle.z];
    const from = [driveshaft.x, driveshaft.y, driveshaft.z];
    shafts.push({ from, to, length: Math.hypot(to[1] - from[1], to[2] - from[2]) });
  }
  return { bars, shocks, shafts };
}

/**
 * The four corners of a camera-facing ribbon between `a` and `b` of half width `half`, seen from `eye`
 * (the game's 0x54b650 quads face the viewer): `[a + side, a - side, b - side, b + side]`.
 */
export function ribbonCorners(a, b, half, eye) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const view = [eye[0] - mid[0], eye[1] - mid[1], eye[2] - mid[2]];
  let side = [d[1] * view[2] - d[2] * view[1], d[2] * view[0] - d[0] * view[2], d[0] * view[1] - d[1] * view[0]];
  const length = Math.hypot(...side);
  // Looking along the ribbon there is no width to find: use any perpendicular.
  if (length < 1e-9) side = Math.abs(d[1]) < 0.9 * Math.hypot(...d) ? [-d[2], 0, d[0]] : [1, 0, 0];
  const k = half / (Math.hypot(...side) || 1);
  side = side.map((v) => v * k);
  const plus = (p, s) => [p[0] + s[0], p[1] + s[1], p[2] + s[2]];
  const minus = (p, s) => [p[0] - s[0], p[1] - s[1], p[2] - s[2]];
  return [plus(a, side), minus(a, side), minus(b, side), plus(b, side)];
}
