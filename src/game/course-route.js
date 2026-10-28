/*
  A computer racer off its course with an unmovable obstacle in its way (an addition, not the game's): the level's
  courses are the source of truth for where a truck can drive, so it takes another of the SIT's courses that passes
  within reach and follows it until that course meets the one it races; with none in reach it calls the helicopter.

  On Castle Nugget the grid stands on a castle, far from course 1, behind the castle's walls (terrain, ground boxes
  and an invisible box); the SIT's course 2 runs from the castle's yard down its ramp and canyon to the track. The
  game drives the course autopilot toward the nearest arc of course 1 and into the wall.

  The obstacles counted are the unmovable ones: a rise of the ground steeper than `WALL_SLOPE` (a cliff face), a ground
  box standing up as a wall and a solid level box that does not move (obstacle-avoid.js gives the last two as circles).
  A moving object (Castle Nugget's sliding gate) is not one: it passes. Pure, so it runs under Node.
*/
import { spotOnSegment } from "./heli-flight.js";

/** The game's off-course distance (MTM2_PHYSICS.md 14.24, `0x486630`): this far from its segment a truck is off it. */
export const OFF_COURSE_FT = 160;
/** How far along its way a truck looks for an obstacle, and the steps of the look (feet). */
export const PROBE_FT = 60, PROBE_STEP_FT = 8;
/** A rise of the ground steeper than this (rise over run) is a wall, not a slope a truck climbs. */
export const WALL_SLOPE = 1;
/** Half a truck's width and the room beside it, feet: a thing nearer the way than this is in it. */
export const HALF_WIDTH_FT = 7;
/** Within this of an obstacle and slower than the game's stuck speed (15 ft/s) with no course to take: the helicopter. */
export const CLOSE_FT = 25, STOPPED_FT_S = 15;

/** The nearest point of a course segment (straight or arc) to `pos`, as heli-flight.js gives it, or null. */
const spot = (seg, pos) => spotOnSegment(seg, pos);

/** Whether `pos` is off course segment `seg`: more than `OFF_COURSE_FT` from it (x and z). No segment: not off it. */
export function offCourse(seg, pos) {
  if (!seg) return false;
  const near = spot(seg, pos);
  return !!near && near.distance > OFF_COURSE_FT;
}

/**
 * The distance along `heading` from `pos` to the first unmovable obstacle within `probeFt`, or null: a ground rise
 * steeper than `WALL_SLOPE` between two samples (`height(x, z)`), or a circle of `circles` (`{ pos, radius }`) within
 * `HALF_WIDTH_FT` of the way.
 */
export function obstacleAhead(pos, heading, { height, circles = [], probeFt = PROBE_FT, stepFt = PROBE_STEP_FT }) {
  const sin = Math.sin(heading), cos = Math.cos(heading);
  let nearest = null;
  for (const o of circles) {
    const rx = o.pos[0] - pos[0], rz = o.pos[2] - pos[2];
    const along = rx * sin + rz * cos, across = rx * cos - rz * sin;
    if (along <= 0 || Math.abs(across) >= o.radius + HALF_WIDTH_FT) continue;
    // Where the way meets the circle's edge, at its nearest.
    const d = Math.max(0, along - Math.sqrt(Math.max(0, (o.radius + HALF_WIDTH_FT) ** 2 - across * across)));
    if (d <= probeFt && (nearest === null || d < nearest)) nearest = d;
  }
  if (height) {
    let before = height(pos[0], pos[2]);
    for (let d = stepFt; d <= probeFt && (nearest === null || d < nearest); d += stepFt) {
      const h = height(pos[0] + sin * d, pos[2] + cos * d);
      if (h - before > WALL_SLOPE * stepFt) { nearest = d - stepFt; break; }
      before = h;
    }
  }
  return nearest;
}

/**
 * The course to take from `pos`: among `routes` (built courses), the one with a segment nearest `pos` within
 * `OFF_COURSE_FT`, as `{ route, segment }` (indexes); null when none is in reach. A straight is picked, so the
 * autopilot starts along it.
 */
export function pickRoute(routes, pos) {
  let best = null;
  routes.forEach((course, route) => {
    course.forEach((seg, segment) => {
      if (seg.ctype === 2) return;
      const near = spot(seg, pos);
      if (near && near.distance <= OFF_COURSE_FT && (!best || near.distance < best.distance)) best = { route, segment, distance: near.distance };
    });
  });
  return best && { route: best.route, segment: best.segment };
}

/**
 * Where a truck at `pos` meets the course it races (`course`, built): the index of a straight whose way it is on
 * (within the straight's track width of it), or -1.
 */
export function joinedSegment(course, pos) {
  for (let i = 0; i < course.length; i++) {
    const seg = course[i];
    if (seg.ctype === 2) continue;
    const near = spot(seg, pos);
    if (near && near.distance <= (seg.trackWidth ?? 16)) return i;
  }
  return -1;
}
