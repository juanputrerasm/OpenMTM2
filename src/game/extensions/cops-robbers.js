/*
  Cops & Robbers (docs/EXTENSIONS.md), after the MTM community's rules (mtm2.com/~mtmg/cnr.php): one
  truck is the robber, the others are cops, on any track, for a set number of minutes (20 by default).
  An addition, not in the game.

  A cop captures the robber by touching it while the robber cannot drive: off its wheels (on its side or
  its roof), or stuck (slower than 3 ft/s for 3 s). A robber that turned over by itself is still
  captured by the first cop to reach it. After a capture the robber is carried off by the helicopter to
  a place at least 400 ft from every cop and cannot be captured for 5 s. The robber may call the
  helicopter only from deep water; the cops may call it as usual.

  Each capture is 60 points to the cop who made it; the robber gains 1 point for each whole second free.
  Places go by points. The judge here replaces the host who counted captures by hand.

  Computer trucks: the robber runs and hides as Tag's free trucks do from It; the cops chase it as
  Tag's It chases. Pure, so it runs under Node.
*/
import { byVehicle, fromVehicles, localIndex, vehicleIndex } from "./net-wire.js";
import { msg } from "../strings.js";

export const DEFAULT_CNR_MINUTES = 20;
export const CNR_EXTENSION = Object.freeze({
  id: "cops-robbers",
  name: msg("Cops & Robbers"),
  description: msg("One truck is the robber; the cops capture it by touching it once it is off its wheels or stuck."),
  length: Object.freeze({ key: "minutes", label: msg("Minutes"), default: DEFAULT_CNR_MINUTES, min: 1, max: 99 }),
  settings: Object.freeze([
    Object.freeze({ key: "minutes", label: msg("Round length"), type: "number", min: 1, max: 99, default: DEFAULT_CNR_MINUTES, suffix: msg("minutes") }),
  ]),
  acceptsTrack: () => true,
  trackLocked: false,
  minEntrants: 2,
  weather: null,
  detailLevel: null,
});

/** The robber's arrow and label, and the cops' labels. */
export const ROBBER_COLOUR = "#ff4436";
export const COP_COLOUR = "#3f8cff";
export const ROBBER_NAME = msg("Robber"), COP_NAME = msg("Cop");
/** A truck whose up axis has less than this upward share is off its wheels. */
export const OFF_WHEELS_UP = 0.5;
/** Slower than this for this long, and the robber is stuck. */
export const STUCK_FT_S = 3, STUCK_S = 3;
/** After a capture: the robber is set down this far from every cop, and is safe this long. */
export const ESCAPE_FT = 400, GRACE_S = 5;
/** Points for a capture, and for each whole second the robber is free. */
export const CAPTURE_POINTS = 60, FREE_PS = 1;
/** The robber is held this long after the countdown while the cops get going, as Tag holds It; here the cops wait. */
export const COPS_HOLD_S = 5;

/** A game among `count` trucks, the robber picked by `random`. */
export function createCnr(count, random = Math.random) {
  return {
    robber: Math.min(count - 1, Math.floor(random() * count)),
    points: new Array(count).fill(0),
    captures: new Array(count).fill(0),
    /** The robber's whole-second accumulator, and how long it has been slow. */
    second: 0, slow: 0,
    /** The robber cannot be captured until this time (seconds since the countdown ended). */
    safeUntil: COPS_HOLD_S,
    /** The last capture (`{ kind: "capture", by }`) and how many there have been. */
    event: null, events: 0,
  };
}

/** Whether a truck is off its wheels: `up` is its up axis's world y (matrix[4]). */
export const offWheels = (up) => up < OFF_WHEELS_UP;

/**
 * One step once the countdown has ended. `clock` is the seconds since, `touches` the pairs of trucks whose
 * hulls met in the step before, `robber` the robber's `{ up, speed }` (its up axis's y, its speed in ft/s).
 * Returns the capture (`{ kind: "capture", by }`) when there is one, else null; the caller then moves the robber.
 */
export function cnrStep(g, clock, dt, touches, robber) {
  g.slow = robber.speed < STUCK_FT_S ? g.slow + dt : 0;
  if (clock >= g.safeUntil) {
    g.second += dt;
    const ticks = Math.floor(g.second + 1e-9);
    if (ticks > 0) { g.second -= ticks; g.points[g.robber] += FREE_PS * ticks; }
  }
  if (clock < g.safeUntil) return null;
  const helpless = offWheels(robber.up) || g.slow >= STUCK_S;
  if (!helpless) return null;
  for (const [a, b] of touches) {
    const cop = a === g.robber ? b : b === g.robber ? a : -1;
    if (cop < 0) continue;
    g.captures[cop]++;
    g.points[cop] += CAPTURE_POINTS;
    g.event = { kind: "capture", by: cop };
    g.events++;
    g.safeUntil = clock + GRACE_S;
    g.slow = 0;
    return g.event;
  }
  return null;
}

/** The cops are held after the countdown while the robber gets away. */
export const cnrHeld = (g, i, clock) => i !== g.robber && clock < COPS_HOLD_S;

/** Whether truck `i` may call the helicopter: a cop always, the robber only from deep water (`inWater`). */
export const cnrHeliAllowed = (g, i, inWater) => i !== g.robber || !!inWater;

/** Each truck's place: the most points first, ties by entry order. */
export function cnrPlaces(g) {
  const order = g.points.map((_, i) => i).sort((i, j) => (g.points[j] - g.points[i]) || (i - j));
  const places = new Array(order.length);
  order.forEach((i, k) => { places[i] = k + 1; });
  return places;
}

/**
 * Where the robber is set down after a capture: of `candidates` (`[x, y, z]` each), the first at least
 * `ESCAPE_FT` from every cop, else the one farthest from the nearest cop.
 */
export function escapeSpot(candidates, cops) {
  let best = null, bestD = -1;
  for (const c of candidates) {
    const d = Math.min(Infinity, ...cops.map((p) => Math.hypot(p[0] - c[0], p[2] - c[2])));
    if (d >= ESCAPE_FT) return c;
    if (d > bestD) { bestD = d; best = c; }
  }
  return best;
}

// ---- Over the network (docs/EXTENSIONS.md) ----

export function cnrToWire(s, vehicleOf) {
  const v = (i) => vehicleIndex(i, vehicleOf);
  return {
    robber: v(s.robber), points: byVehicle(s.points, vehicleOf), captures: byVehicle(s.captures, vehicleOf), safeUntil: s.safeUntil,
    events: s.events, over: !!s.over, resets: s.resets | 0, spot: s.spot ?? null, event: s.event ? { ...s.event, by: v(s.event.by) } : null,
  };
}

export function cnrFromWire(d, localOf, count) {
  const i = (vehicle) => localIndex(vehicle, localOf);
  return {
    robber: Math.max(0, i(d.robber)), points: fromVehicles(d.points, localOf, count, 0), captures: fromVehicles(d.captures, localOf, count, 0),
    safeUntil: Number(d.safeUntil) || 0, events: d.events | 0, over: !!d.over, resets: d.resets | 0, spot: d.spot ?? null,
    event: d.event ? { ...d.event, by: i(d.event.by) } : null,
  };
}
