/*
  A computer racer looking ahead for what it would hit (an addition, not the game's): the level's solid objects and
  the ground boxes that stand up out of the ground like walls. The course autopilot only follows its line, and a
  truck pushed off it (a pass, a shove, a slide, a start off the course) drives into whatever stands there.

  Each step the truck looks down its way of travel for `lookS` seconds (at least `minLookFt`, at most `maxLookFt`)
  through a corridor as wide as itself plus `marginFt`. The nearest thing in that corridor turns the wheel away
  from it, the more the nearer and the more squarely it stands in the way; one squarely in the way and close eases
  the throttle too. A ground box the course itself runs over (a bridge's deck, a ramp's top) is part of the way, not
  in it. Pure, so it runs under Node.
*/

export const AVOID = Object.freeze({
  /** How far ahead the truck looks: its speed for this long, within these bounds (feet). */
  lookS: 1.6, minLookFt: 45, maxLookFt: 220,
  /** Half the truck's width and the room it keeps beside a thing, feet. */
  halfWidthFt: 6, marginFt: 5,
  /** The most the wheel is turned away, of the ±0.45 lock. */
  steer: 0.3,
  /** Squarely in the way within this share of the look: ease the throttle to this share. */
  closeShare: 0.45, ease: 0.6,
  /** A ground box is a wall when its top stands this far over the truck's wheels and its underside is below the cab. */
  wallFt: 4, overheadFt: 8,
  /** The truck's origin stands about this far over its wheels' contact, feet. */
  rideFt: 5,
  /** Ground box cells, feet, and the samples along the look. */
  cellFt: 32, sampleFt: 16,
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * The ground boxes standing up near `pos` as obstacles: `{ pos, radius }` for each 32 ft cell along the look from
 * `pos` toward `heading` whose top is a wall to a truck at `pos[1]`. `ra0`, `ra1` are the level's ground box layers
 * (bytes, `stepFt` feet each), `onCourse(x, z)` says a point lies on the course's own way.
 */
export function groundBoxWalls(pos, heading, lookFt, { ra0, ra1, stepFt = 2, onCourse = null }, T = AVOID) {
  if (!ra0 || !ra1) return [];
  const out = [];
  const seen = new Set();
  const feet = pos[1] - T.rideFt;
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const side = T.halfWidthFt + T.marginFt;
  for (let d = T.sampleFt; d <= lookFt; d += T.sampleFt) {
    for (const off of [-side, 0, side]) {
      const x = pos[0] + sin * d + cos * off, z = pos[2] + cos * d - sin * off;
      const col = (Math.trunc(x * 256) >> 13) & 255, row = (Math.trunc(z * 256) >> 13) & 255;
      const i = row * 256 + col;
      if (seen.has(i)) continue;
      seen.add(i);
      const lo = ra0[i] * stepFt, hi = ra1[i] * stepFt;
      if (lo === hi || !(hi > feet + T.wallFt) || !(lo < pos[1] + T.overheadFt)) continue;
      // The cell's centre in the copy of the world the truck is in.
      const cx = Math.floor(x / T.cellFt) * T.cellFt + T.cellFt / 2, cz = Math.floor(z / T.cellFt) * T.cellFt + T.cellFt / 2;
      if (onCourse?.(cx, cz)) continue;
      out.push({ pos: [cx, hi, cz], radius: T.cellFt * 0.6 });
    }
  }
  return out;
}

/**
 * The way to steer clear, for a truck `state` (pos, euler, bvel, matrix) among `obstacles` (`{ pos, radius }`, world
 * feet). Returns `{ steer, ease }`: `steer` the wheel to add (positive right, as the controls take it), `ease` the
 * share of the throttle to keep (1 for all of it). `aim`, a point down the course, picks the side when a thing
 * stands dead ahead. Nothing ahead: `{ steer: 0, ease: 1 }`.
 */
export function avoidObstacles(state, obstacles, aim = null, T = AVOID) {
  const none = { steer: 0, ease: 1 };
  if (!obstacles?.length) return none;
  const m = state.matrix, b = state.bvel;
  // The way of travel, from the world velocity; the nose when barely moving.
  const vx = m[0] * b[0] + m[1] * b[1] + m[2] * b[2], vz = m[6] * b[0] + m[7] * b[1] + m[8] * b[2];
  const speed = Math.hypot(vx, vz);
  if (b[2] < 1) return none;
  const heading = speed > 5 ? Math.atan2(vx, vz) : state.euler[2];
  const look = clamp(speed * T.lookS, T.minLookFt, T.maxLookFt);
  const sin = Math.sin(heading), cos = Math.cos(heading);
  let best = null;
  for (const o of obstacles) {
    const rx = o.pos[0] - state.pos[0], rz = o.pos[2] - state.pos[2];
    const along = rx * sin + rz * cos;
    if (along <= 0 || along > look + o.radius) continue;
    // Positive: the thing is to the right of the way.
    const across = rx * cos - rz * sin;
    const room = o.radius + T.halfWidthFt + T.marginFt;
    if (Math.abs(across) >= room) continue;
    if (!best || along < best.along) best = { along, across, room };
  }
  if (!best) return none;
  let away = best.across > 0 ? -1 : 1;
  // Dead ahead: the side the course lies on.
  if (Math.abs(best.across) < 1 && aim) {
    const toAim = (aim[0] - state.pos[0]) * cos - (aim[2] - state.pos[2]) * sin;
    away = toAim >= 0 ? 1 : -1;
  }
  const near = 1 - clamp(best.along / look, 0, 1);
  const square = 1 - Math.abs(best.across) / best.room;
  const steer = away * T.steer * clamp(0.35 + 0.65 * near, 0, 1) * clamp(0.4 + 0.6 * square, 0, 1);
  const ease = near > 1 - T.closeShare && square > 0.5 ? T.ease : 1;
  return { steer, ease };
}

/**
 * A level box as obstacles, onto `out`: one circle for a compact box, a row of circles along a long one (a wall, a
 * fence), so the room beside it is not taken as blocked. `offset` moves it to the copy of the world nearest the truck.
 */
export function boxObstacles(box, out = [], offset = [0, 0]) {
  const m = box.matrix, h = box.half;
  // The box's x and z axes in the world (its matrix's columns), flattened.
  const ax = [m[0], m[6]], az = [m[2], m[8]];
  const long = h[0] >= h[2] ? { axis: ax, half: h[0], short: h[2] } : { axis: az, half: h[2], short: h[0] };
  const radius = Math.max(long.short, 2) * 1.15;
  const x = box.pos[0] + offset[0], z = box.pos[2] + offset[1];
  if (long.half <= radius * 1.5) {
    out.push({ pos: [x, box.pos[1], z], radius: Math.hypot(h[0], h[2]) });
    return out;
  }
  const count = Math.min(24, Math.ceil(long.half / radius) + 1);
  for (let k = 0; k < count; k++) {
    const u = count === 1 ? 0 : -long.half + (2 * long.half * k) / (count - 1);
    out.push({ pos: [x + long.axis[0] * u, box.pos[1], z + long.axis[1] * u], radius });
  }
  return out;
}
