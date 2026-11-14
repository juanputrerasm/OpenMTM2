/*
  The fly-by camera (not the game's): a look around a track with no truck and no race. Pure, so it
  runs under Node. Game frame and units: feet, x right, y up, z forward; angles in radians, `yaw`
  0 looking along +z and growing toward +x, `pitch` positive upward.

  Three ways of flying it, by `scheme`:

    "traxx"  JSTrackViewer's camera (its src/nav.js; its keys, at the port's own slower rates): move along the ground heading,
             turn, climb and sink, tilt; the mouse looks around and the wheel zooms.
    "tv"     a craft, as in Terminal Velocity: it always moves the way it points, at a speed the
             throttle sets; the stick pitches and turns it, and it banks into its turns.
    "hb"     Hellbender: flown as "tv" with its own keys, and a turbo thrust while its key is held.

  Every speed and rate here is the port's own.
*/
import { nearestCopy } from "../shared/scene-frame.js";
export const FLY_SCHEMES = Object.freeze(["traxx", "tv", "hb"]);
export const FLY_SCHEME_NAMES = Object.freeze({ traxx: "Traxx", tv: "Terminal Velocity", hb: "Hellbender" });

const DEG = Math.PI / 180;
/**
 * JSTrackViewer's own rates (3000 and 2000 world units a second, 80 and 60 degrees) cross a track in five seconds, which
 * suits a map viewer and is far too fast inside the world: these are the port's, about a fast truck's pace.
 */
export const TRAXX_MOVE_FT_S = 300;
export const TRAXX_CLIMB_FT_S = 150;
export const TURN_RAD_S = 55 * DEG;
export const PITCH_RAD_S = 40 * DEG;
export const PITCH_LIMIT = 85 * DEG;
/** JSTrackViewer: degrees a pixel of mouse drag turns and tilts the view. */
export const MOUSE_YAW_RAD = 0.3 * DEG;
export const MOUSE_PITCH_RAD = 0.25 * DEG;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 1.1;
/** The craft: its speed at full throttle, how fast the throttle moves, its bank in a full turn and how fast it rolls. */
export const CRAFT_MAX_FT_S = 600;
export const THROTTLE_PER_S = 0.5;
/** How much faster the craft goes while the turbo thrust is held. */
export const TURBO_FACTOR = 2.5;
export const BANK_RAD = 25 * DEG;
/** How fast it leans into a turn and levels out of one: slowly, so the horizon does not snap. */
export const ROLL_RAD_S = 25 * DEG;
/** How far above the ground the camera is kept, ft. */
export const GROUND_CLEARANCE_FT = 6;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** A camera at `pos`, looking along `yaw`. A craft starts at a third of its throttle. */
export function createFlyCamera({ pos = [0, 0, 0], yaw = 0, pitch = 0 } = {}) {
  return { pos: [...pos], yaw: wrapAngle(yaw), pitch, roll: 0, throttle: 1 / 3, zoom: 1 };
}

/** The unit vector the camera looks along, in the game frame. */
export function flyForward(camera) {
  const c = Math.cos(camera.pitch);
  return [Math.sin(camera.yaw) * c, Math.sin(camera.pitch), Math.cos(camera.yaw) * c];
}

/**
 * Move the camera by `dt` seconds of `input` (game/input/fly-controls.js): `pitch`, `yaw`, `roll`, `throttle`, `move`
 * and `climb` in -1..1, `turbo` 0 or 1, `lookX` and `lookY` in pixels of mouse drag, `zoom` in wheel notches. `groundAt(x, z)` gives the
 * ground's height where the camera is; it is kept `GROUND_CLEARANCE_FT` above it.
 */
export function stepFlyCamera(camera, input, dt, scheme = "traxx", groundAt = null) {
  const i = { pitch: 0, yaw: 0, roll: 0, throttle: 0, turbo: 0, move: 0, climb: 0, lookX: 0, lookY: 0, zoom: 0, ...input };
  camera.yaw = wrapAngle(camera.yaw + i.yaw * TURN_RAD_S * dt + i.lookX * MOUSE_YAW_RAD);
  camera.pitch = clamp(camera.pitch + i.pitch * PITCH_RAD_S * dt - i.lookY * MOUSE_PITCH_RAD, -PITCH_LIMIT, PITCH_LIMIT);
  if (i.zoom) camera.zoom = clamp(camera.zoom * ZOOM_STEP ** i.zoom, ZOOM_MIN, ZOOM_MAX);
  if (scheme === "traxx") {
    camera.roll = 0;
    const step = i.move * TRAXX_MOVE_FT_S * dt;
    camera.pos[0] += Math.sin(camera.yaw) * step;
    camera.pos[2] += Math.cos(camera.yaw) * step;
    camera.pos[1] += i.climb * TRAXX_CLIMB_FT_S * dt;
  } else {
    camera.throttle = clamp(camera.throttle + i.throttle * THROTTLE_PER_S * dt, 0, 1);
    // It banks into a turn, and the roll keys lean it further; with neither it levels out.
    const wanted = clamp(i.yaw * BANK_RAD + i.roll * 2 * BANK_RAD, -PITCH_LIMIT, PITCH_LIMIT);
    const most = ROLL_RAD_S * dt;
    camera.roll += clamp(wanted - camera.roll, -most, most);
    const f = flyForward(camera), step = camera.throttle * CRAFT_MAX_FT_S * (i.turbo > 0 ? TURBO_FACTOR : 1) * dt;
    camera.pos[0] += f[0] * step;
    camera.pos[1] += f[1] * step;
    camera.pos[2] += f[2] * step;
  }
  if (groundAt) camera.pos[1] = Math.max(camera.pos[1], groundAt(camera.pos[0], camera.pos[2]) + GROUND_CLEARANCE_FT);
  return camera;
}

/** The scheme after `scheme`, going round. */
export function nextFlyScheme(scheme) {
  return FLY_SCHEMES[(FLY_SCHEMES.indexOf(scheme) + 1) % FLY_SCHEMES.length];
}

/*
  Following the course: the camera is carried along the track's course, a set height over the ground, looking ahead.
  The course's straights are joined end to start (the turns between them are cut straight across), and the last back to
  the first unless the course is open (a rally from A to B), where the tour starts over at its beginning.
  Every figure here is the port's.
*/
export const TOUR_FT_S = 90, TOUR_MIN_FT_S = 20, TOUR_MAX_FT_S = 400;
/** How fast the Up and Down keys change the tour's speed, ft/s each second. */
export const TOUR_SPEED_PER_S = 80;
export const TOUR_HEIGHT_FT = 28, TOUR_LOOK_AHEAD_FT = 160, TOUR_PITCH = -0.14;

/** The course as a path to follow: `{ points, lengths, total, open, at, speed }`, or null when there is none. */
export function createCourseTour(course, { open = false } = {}) {
  const points = [];
  for (const seg of course ?? []) {
    for (const p of [seg.startFt, seg.endFt]) {
      if (!p) continue;
      const last = points[points.length - 1];
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[2]) > 1) points.push([p[0], p[2]]);
    }
  }
  if (points.length < 2) return null;
  if (!open) points.push([...points[0]]);
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  return total > 0 ? { points, lengths, total, open, at: 0, speed: TOUR_FT_S } : null;
}

/** The point `distance` feet along a tour, `[x, z]`, going round (or starting over, on an open course). */
export function tourPoint(tour, distance) {
  let d = ((distance % tour.total) + tour.total) % tour.total;
  for (let i = 0; i < tour.lengths.length; i++) {
    const len = tour.lengths[i];
    if (d <= len || i === tour.lengths.length - 1) {
      const t = len > 0 ? Math.min(1, d / len) : 0, a = tour.points[i], b = tour.points[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    d -= len;
  }
  return [...tour.points[0]];
}

/** Put the tour at the point of the course nearest (x, z), so following begins where the camera is. */
export function startTourNear(tour, x, z) {
  let best = 0, bestDistance = Infinity;
  for (let d = 0; d < tour.total; d += 16) {
    const p = tourPoint(tour, d), gap = Math.hypot(p[0] - x, p[1] - z);
    if (gap < bestDistance) { bestDistance = gap; best = d; }
  }
  tour.at = best;
  return tour;
}

/**
 * Carry the camera `dt` seconds along the tour. `input.move` or `input.throttle` (-1..1) changes the speed. The
 * camera eases to its place and its heading, so joining the course and its corners are not jumps.
 */
export function stepCourseTour(tour, camera, dt, input = {}, groundAt = null, worldFt = 8192) {
  const change = (input.move ?? 0) || (input.throttle ?? 0) || -(input.pitch ?? 0);
  tour.speed = clamp(tour.speed + change * TOUR_SPEED_PER_S * dt, TOUR_MIN_FT_S, TOUR_MAX_FT_S);
  tour.at = (tour.at + tour.speed * dt) % tour.total;
  const here = tourPoint(tour, tour.at), ahead = tourPoint(tour, tour.at + TOUR_LOOK_AHEAD_FT);
  // The ground under the camera and a little ahead, so a rise is climbed before it is met.
  const ground = groundAt ? Math.max(groundAt(here[0], here[1]), groundAt(...tourPoint(tour, tour.at + 40)), groundAt(...tourPoint(tour, tour.at + 80))) : 0;
  const ease = Math.min(1, dt * 3);
  // The world is a torus: the camera goes to the copy of its place on the course that is nearest it, so a course (or a
  // camera) that crosses the world's edge is followed across it and not back round the world (`worldFt` its size).
  const near = nearestCopy([here[0], 0, here[1]], camera.pos, worldFt), lookAt = nearestCopy([ahead[0], 0, ahead[1]], camera.pos, worldFt);
  camera.pos[0] += (near[0] - camera.pos[0]) * ease;
  camera.pos[2] += (near[2] - camera.pos[2]) * ease;
  camera.pos[1] += (ground + TOUR_HEIGHT_FT - camera.pos[1]) * Math.min(1, dt * 2);
  if (groundAt) camera.pos[1] = Math.max(camera.pos[1], groundAt(camera.pos[0], camera.pos[2]) + GROUND_CLEARANCE_FT);
  const wanted = Math.atan2(lookAt[0] - camera.pos[0], lookAt[2] - camera.pos[2]);
  const turn = Math.atan2(Math.sin(wanted - camera.yaw), Math.cos(wanted - camera.yaw));
  camera.yaw = wrapAngle(camera.yaw + turn * Math.min(1, dt * 2.5));
  camera.pitch += (TOUR_PITCH - camera.pitch) * Math.min(1, dt * 2);
  camera.roll += (0 - camera.roll) * Math.min(1, dt * 2);
  return camera;
}
