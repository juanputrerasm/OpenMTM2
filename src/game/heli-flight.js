/*
  The recovery helicopter, as this port runs it for the player (the original only lifted a truck
  that lay stuck on its hull; here the Helicopter key works at any time and is immediate). The truck
  is frozen; the helicopter spirals in, hooks it, carries it in the air to the nearest point of the
  course, turning it to face along the course and levelling it, and sets it down. In a race only the part of the
  course round the truck's own segment is searched (`courseWindow`), so at a crossroads it is not set down on
  another part of the lap.

  The CPU trucks keep the game's own flight (MONSTER_EXE_ANALYSIS.md 8.2, 0x46ed90): `timerVisual`
  places the helicopter for that flight from the truck's `heliTimer`.
*/
const TWO_PI = Math.PI * 2;

/** An angle brought into -pi to pi. */
export const wrapPi = (a) => a - Math.round(a / TWO_PI) * TWO_PI;
const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;

/** The truck hangs this far under the helicopter (the game draws the helicopter 12 ft above the truck's origin, 0x54f570). */
export const HANG_FT = 12;
export const APPROACH_S = 1.5;
export const CARRY_S = 4;
export const SET_DOWN_S = 1.5;
export const DEPART_S = 3;
export const APPROACH_FT = 60;
/** Height above the ground at which the truck travels, and at which it is let go. */
export const CRUISE_FT = 30;
export const DROP_FT = 6;
/** The helicopter never takes the truck lower than this over the ground. */
export const CLEARANCE_FT = 8;
const DEPART_RATE_FT = 40;
/**
 * The part of the course the helicopter may set a truck down on (an addition): from this many segments before the
 * one it is on to this many after (straights and arcs alternate, so 2 is one straight back and 6 three ahead).
 */
export const WINDOW_BACK = 2, WINDOW_AHEAD = 6;

/**
 * The point of course segment `seg` nearest (in x and z) to `pos`: `{ x, z, heading, distance }`, the heading the
 * course runs there; null for a segment of no size.
 */
export function spotOnSegment(seg, pos) {
  if (seg.ctype === 2) {
    const span = wrapPi(seg.exitAngle - seg.entryAngle);
    if (!(Math.abs(span) >= 1e-6)) return null;
    const rel = wrapPi(Math.atan2(pos[0] - seg.centre[0], pos[2] - seg.centre[2]) - seg.entryAngle);
    const u = Math.min(1, Math.max(0, rel / span));
    const angle = seg.entryAngle + span * u;
    const x = seg.centre[0] + Math.sin(angle) * seg.radius, z = seg.centre[2] + Math.cos(angle) * seg.radius;
    return { x, z, heading: angle + (span >= 0 ? Math.PI / 2 : -Math.PI / 2), distance: Math.hypot(x - pos[0], z - pos[2]) };
  }
  const dx = seg.end[0] - seg.start[0], dz = seg.end[2] - seg.start[2];
  const length2 = dx * dx + dz * dz;
  if (!(length2 >= 1e-9)) return null;
  const u = Math.min(1, Math.max(0, ((pos[0] - seg.start[0]) * dx + (pos[2] - seg.start[2]) * dz) / length2));
  const x = seg.start[0] + dx * u, z = seg.start[2] + dz * u;
  return { x, z, heading: Math.atan2(dx, dz), distance: Math.hypot(x - pos[0], z - pos[2]) };
}

/**
 * The course segment indexes of a window round segment `around`: `back` before it and `ahead` after it, in the
 * order they are driven (the course wraps). All of them when `around` is not a segment of the course.
 */
export function courseWindow(count, around, back = WINDOW_BACK, ahead = WINDOW_AHEAD) {
  if (!Number.isInteger(around) || around < 0 || around >= count || back + ahead + 1 >= count) return [...Array(count).keys()];
  const out = [];
  for (let k = -back; k <= ahead; k++) out.push((around + k + count) % count);
  return out;
}

/**
 * The nearest point of the course (in x and z) to `pos`, with the heading the course runs there:
 * `{ pos: [x, y, z], heading, distance, segment }`, or null for no course. `course` is the oriented course
 * (alternating straights and arcs), `height(x, z)` the ground. `around`, the segment the truck is on in the race,
 * keeps the search to the part of the course it has reached (`courseWindow`): at a crossroads the nearest point
 * may be on a part of the lap still to come or long past.
 */
export function nearestCourseSpot(course, pos, height, { around = null, back = WINDOW_BACK, ahead = WINDOW_AHEAD } = {}) {
  if (!course?.length) return null;
  let best = null;
  for (const i of courseWindow(course.length, around, back, ahead)) {
    const spot = spotOnSegment(course[i], pos);
    if (spot && (!best || spot.distance < best.distance)) best = { pos: [spot.x, height(spot.x, spot.z), spot.z], heading: spot.heading, distance: spot.distance, segment: i };
  }
  return best;
}

/**
 * Start a flight for a truck at `s` (`pos`, `euler`: pitch, roll, heading) to `spot`
 * (`{ pos, heading }`). `teryl` asks for the pterodactyl instead of the helicopter.
 */
export function createFlight(s, spot, { teryl = false, height }) {
  return {
    t: 0, teryl,
    from: { pos: [...s.pos], pitch: s.euler[0], roll: s.euler[1], heading: s.euler[2] },
    to: { pos: [spot.pos[0], spot.pos[1], spot.pos[2]], heading: spot.heading },
    groundAt: (x, z) => height(x, z),
    angle: Math.atan2(s.pos[0] - spot.pos[0], s.pos[2] - spot.pos[2]),
  };
}

export const flightSeconds = () => APPROACH_S + CARRY_S + SET_DOWN_S;

/** Move the frozen truck for one step of the flight; returns true when it is set down. */
export function stepFlight(flight, s, dt) {
  flight.t += dt;
  const { from, to } = flight;
  const carryEnd = APPROACH_S + CARRY_S, end = carryEnd + SET_DOWN_S;
  if (flight.t < APPROACH_S) return false;
  let x, z, y, u;
  if (flight.t < carryEnd) {
    u = smooth((flight.t - APPROACH_S) / CARRY_S);
    x = lerp(from.pos[0], to.pos[0], u);
    z = lerp(from.pos[2], to.pos[2], u);
    y = lerp(from.pos[1], to.pos[1] + CRUISE_FT, u);
  } else {
    u = 1;
    x = to.pos[0]; z = to.pos[2];
    y = lerp(to.pos[1] + CRUISE_FT, to.pos[1] + DROP_FT, smooth(Math.min(1, (flight.t - carryEnd) / SET_DOWN_S)));
  }
  s.pos[0] = x;
  s.pos[2] = z;
  s.pos[1] = Math.max(y, flight.groundAt(x, z) + CLEARANCE_FT);
  s.euler[0] = from.pitch * (1 - u);
  s.euler[1] = from.roll * (1 - u);
  s.euler[2] = from.heading + wrapPi(to.heading - from.heading) * u;
  return flight.t >= end;
}

/** Where the helicopter is, `{ pos, heading, teryl }`, for a flight at its present time (`s` is the truck). */
export function flightVisual(flight, s) {
  const out = (pos, heading) => ({ pos, heading, teryl: flight.teryl });
  if (flight.t < APPROACH_S) {
    const u = smooth(flight.t / APPROACH_S);
    const r = APPROACH_FT * (1 - u), a = flight.angle + 0.5 * Math.PI * u;
    const x = s.pos[0] + Math.sin(a) * r, z = s.pos[2] + Math.cos(a) * r;
    return out([x, s.pos[1] + HANG_FT + r, z], Math.atan2(s.pos[0] - x, s.pos[2] - z));
  }
  return out([s.pos[0], s.pos[1] + HANG_FT, s.pos[2]], s.euler[2]);
}

/** After the truck is let go the helicopter climbs away for a few seconds: `{ pos, heading, teryl }` or null. */
export function departVisual(exit) {
  if (!exit || exit.t >= DEPART_S) return null;
  return { pos: [exit.pos[0], exit.pos[1] + HANG_FT + DEPART_RATE_FT * exit.t, exit.pos[2]], heading: exit.heading, teryl: exit.teryl };
}

/**
 * The game's own flight, placed from the truck's `heliTimer` (15 s down to 0; 0x46ed90): from 11.5
 * to 10 s the helicopter spirals in at 40 ft per second of timer (radius and height); then it hangs
 * 12 ft over the truck, facing its heading, carrying it. Before 11.5 s it waits at the spiral's edge.
 */
export function timerVisual(timer, pos, heading) {
  if (!(timer > 0)) return null;
  if (timer >= 10) {
    const r = (Math.min(timer, 15) - 10) * 40;
    const a = heading + Math.PI - timer * (Math.PI / 2);
    const x = pos[0] + Math.sin(a) * r, z = pos[2] + Math.cos(a) * r;
    return { pos: [x, pos[1] + HANG_FT + r, z], heading: Math.atan2(pos[0] - x, pos[2] - z), teryl: false };
  }
  return { pos: [pos[0], pos[1] + HANG_FT, pos[2]], heading, teryl: false };
}
