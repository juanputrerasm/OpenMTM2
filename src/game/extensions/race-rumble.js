/*
  Race & Rumble (docs/EXTENSIONS.md), after the MTM community's rules (mtm2.com/~mtmg/rnr.php): a
  circuit race between two sides, the Racers and the Blockers. The race is over as soon as any racer
  finishes, and the Racers win; the Blockers roam the track to stop them and need not finish a lap.
  Should the race end with no racer home (left early), the Blockers win. An addition, not in the game.

  The race is the track's own circuit race: its checkpoints, laps, countdown and ending (game/race-end.js).
  The mode adds the sides, the blockers' driving, and the places: the winning side first, the racers by
  the order they finished (a racer still racing by its race place), the blockers by their race place.
  Pure, so it runs under Node.
*/
import { byVehicle, fromVehicles } from "./net-wire.js";
import { msg } from "../strings.js";

export const DEFAULT_RNR_LAPS = 3;
/** A truck's role is also its side: 0 the Racers, 1 the Blockers. */
export const RACER = 0, BLOCKER = 1;
export const ROLE_NAMES = Object.freeze([msg("Racer"), msg("Blocker")]);
/** The two sides' names, by role. */
export const SIDE_NAMES = Object.freeze([msg("Racers"), msg("Blockers")]);

export const RNR_EXTENSION = Object.freeze({
  id: "race-rumble",
  name: msg("Race & Rumble"),
  description: msg("Racers against Blockers: the first racer home wins it for the Racers; the Blockers need not finish."),
  length: Object.freeze({ key: "laps", label: msg("Laps"), default: DEFAULT_RNR_LAPS, min: 1, max: 99 }),
  settings: Object.freeze([
    Object.freeze({ key: "laps", label: msg("Laps"), type: "number", min: 1, max: 99, default: DEFAULT_RNR_LAPS }),
    Object.freeze({ key: "blocker", label: msg("Play as blocker"), type: "boolean", default: false }),
  ]),
  /** A circuit with checkpoints to race round. */
  acceptsTrack: (track) => !!track && (track.raceType ?? "circuit") === "circuit",
  trackLocked: false,
  keepsRace: true,
  minEntrants: 2,
  weather: null,
  detailLevel: null,
});

/**
 * The two sides of `count` trucks: the player (truck 0) a racer, or a blocker with `playerBlocks`, and the others
 * alternating from the other side, so the sides differ by at most one. Returns `{ teams, roles }`, which are the same
 * (the side is the role).
 */
export function rnrTeams(count, playerBlocks = false) {
  const first = playerBlocks ? BLOCKER : RACER;
  const roles = Array.from({ length: count }, (_, i) => (i % 2 === 0 ? first : 1 - first));
  return { teams: [...roles], roles };
}

/** Whether a racer has finished: the race is then over, won by the Racers. */
export const racerHome = (roles, trucks) => roles.some((role, i) => role === RACER && trucks[i]?.finished);

/** The winning side: the Racers once one of them is home, else the Blockers. */
export const rnrWinner = (roles, trucks) => (racerHome(roles, trucks) ? RACER : BLOCKER);

/**
 * Each truck's place from the race (`race.trucks[i]` with `finished`, `raceTime` and `place`): the winning side
 * first; racers by their finish (a finished one by its time, ahead of those still racing, those by race place),
 * blockers by race place.
 */
export function rnrPlaces(_teams, roles, trucks) {
  const winner = rnrWinner(roles, trucks);
  const key = (i) => [roles[i] === winner ? 0 : 1, roles[i] === RACER && trucks[i].finished ? 0 : 1, roles[i] === RACER && trucks[i].finished ? trucks[i].raceTime : trucks[i].place];
  const order = roles.map((_, i) => i).sort((i, j) => {
    const a = key(i), b = key(j);
    return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || (i - j);
  });
  const places = new Array(order.length);
  order.forEach((i, k) => { places[i] = k + 1; });
  return places;
}

/** The side places (1 the winner), by side, from `rnrPlaces`. */
export function rnrTeamPlaces(teams, places) {
  const best = new Map();
  teams.forEach((team, i) => best.set(team, Math.min(best.get(team) ?? Infinity, places[i])));
  const order = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([team]) => team);
  return new Map(order.map((team, k) => [team, k + 1]));
}

/**
 * The racer a blocker at `pos` goes for: the nearest one still racing, of `racers` (`{ index, team, pos, vel,
 * finished }`). Null with none.
 */
export function blockTarget(team, pos, racers) {
  let best = null, bestD = Infinity;
  for (const r of racers) {
    if (r.team === team || r.finished) continue;
    const d = Math.hypot(r.pos[0] - pos[0], r.pos[2] - pos[2]);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** Where a blocker meets its target: ahead of it by the distance over 90 ft/s, at most 2 s. */
export function interceptPoint(pos, target) {
  const d = Math.hypot(target.pos[0] - pos[0], target.pos[2] - pos[2]);
  const lead = Math.min(2, d / 90);
  return [target.pos[0] + target.vel[0] * lead, target.pos[1], target.pos[2] + target.vel[2] * lead];
}

// ---- Over the network (docs/EXTENSIONS.md) ----

export function rnrToWire(s, vehicleOf) {
  return { teams: byVehicle(s.teams, vehicleOf), roles: byVehicle(s.roles, vehicleOf), over: !!s.over };
}

export function rnrFromWire(d, localOf, count) {
  return { teams: fromVehicles(d.teams, localOf, count, 0), roles: fromVehicles(d.roles, localOf, count, BLOCKER), over: !!d.over };
}
