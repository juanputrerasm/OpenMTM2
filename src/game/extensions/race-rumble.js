/*
  Race & Rumble (docs/EXTENSIONS.md), an addition, not in the game. Circuit tracks only; the race is the track's
  own circuit race (its checkpoints, laps, countdown and ending, game/race-end.js). Two ways to play it, chosen in
  Options (`variant`):

  - "classic", after the MTM community's rules (mtm2.com/~mtmg/rnr.php): teams of two, a Racer and a Blocker in
    each. The first racer home wins it for its team; a blocker stops the other teams' racers, or fights the blocker
    going for its own racer.
  - "timed", a block against the clock between two sides: the Racers and the Blockers (a truck's side is its role).
    The Racers win as soon as any racer finishes within the time limit; the Blockers win when the time runs out first.

  Teams and roles come from the Computer Opponents dialog, or are filled in here. The places put the winning team
  first. Pure, so it runs under Node.
*/
import { byVehicle, fromVehicles } from "./net-wire.js";
import { TEAM_COLOURS, TEAM_NAMES } from "./teams.js";
import { msg } from "../strings.js";

export const DEFAULT_RNR_LAPS = 3;
export const DEFAULT_RNR_MINUTES = 5;
/** A truck's role; in the timed block it is also its side: 0 the Racers, 1 the Blockers. */
export const RACER = 0, BLOCKER = 1;
export const ROLE_NAMES = Object.freeze([msg("Racer"), msg("Blocker")]);
/** The timed block's two sides' names, by role. */
export const SIDE_NAMES = Object.freeze([msg("Racers"), msg("Blockers")]);
export const RNR_CLASSIC = "classic", RNR_TIMED = "timed";
/** A classic team is two trucks; there are as many teams as the field fills, four at most (the teams' colours). */
export const RNR_TEAM_SIZE = 2;
export const RNR_MAX_TEAMS = TEAM_NAMES.length;
/** A blocker guards its own racer from an enemy blocker this near it, feet. */
export const GUARD_FT = 150;

export const RNR_EXTENSION = Object.freeze({
  id: "race-rumble",
  name: msg("Race & Rumble"),
  description: msg("Racers and Blockers. Classic: teams of a racer and a blocker, the first racer home wins it for its team. Timed block: two sides, the Racers must get one of theirs home before the time runs out."),
  length: Object.freeze({ key: "laps", label: msg("Laps"), default: DEFAULT_RNR_LAPS, min: 1, max: 99 }),
  settings: Object.freeze([
    Object.freeze({
      key: "variant", label: msg("Mode"), type: "select", default: RNR_CLASSIC,
      options: Object.freeze([
        Object.freeze({ value: RNR_CLASSIC, label: msg("Classic: teams of a racer and a blocker") }),
        Object.freeze({ value: RNR_TIMED, label: msg("Timed block: Racers against Blockers") }),
      ]),
    }),
    Object.freeze({ key: "laps", label: msg("Laps"), type: "number", min: 1, max: 99, default: DEFAULT_RNR_LAPS }),
    Object.freeze({ key: "minutes", label: msg("Timed block's time limit"), type: "number", min: 1, max: 99, default: DEFAULT_RNR_MINUTES, suffix: msg("minutes") }),
    Object.freeze({ key: "blocker", label: msg("Play as blocker"), type: "boolean", default: false }),
  ]),
  /** A circuit with checkpoints to race round. */
  acceptsTrack: (track) => !!track && (track.raceType ?? "circuit") === "circuit",
  trackLocked: false,
  keepsRace: true,
  minEntrants: 2,
  /**
   * The Computer Opponents dialog: classic, each truck's team and its role; the timed block, its role alone (the side,
   * in the Racers' and the Blockers' colours).
   */
  teamPicker: (settings) => (rnrVariant(settings?.variant) === RNR_TIMED
    ? { teams: 0, roles: SIDE_NAMES, roleColours: TEAM_COLOURS.slice(0, 2) }
    : { teams: RNR_MAX_TEAMS, teamNames: TEAM_NAMES, teamColours: TEAM_COLOURS, roles: ROLE_NAMES }),
  weather: null,
  detailLevel: null,
});

/** The variant a settings value names, classic unless it is the timed block. */
export const rnrVariant = (value) => (value === RNR_TIMED ? RNR_TIMED : RNR_CLASSIC);

/** How many classic teams `count` trucks make: one for every two, at least two, four at most. */
export const rnrTeamCount = (count) => Math.max(2, Math.min(RNR_MAX_TEAMS, Math.ceil(count / RNR_TEAM_SIZE)));

const roleOf = (pick) => (pick?.role === RACER || pick?.role === BLOCKER ? pick.role : null);

/**
 * The teams and roles of `count` trucks, the player's (truck 0) first. `picks[i]` is `{ team, role }` from the Computer
 * Opponents dialog, or null; the trucks with none are filled in, truck 0 as a blocker with `playerBlocks`.
 *
 * - Timed: the side is the role. Unpicked trucks alternate from the player's side, or once some are picked join the
 *   smaller side, so the sides differ by at most one.
 * - Classic: `rnrTeamCount` teams of two. An unpicked truck joins the smallest team, taking the role it lacks (a racer
 *   first), so each team has its racer and its blocker.
 *
 * Returns `{ teams, roles }`.
 */
export function rnrTeams(count, playerBlocks = false, { variant = RNR_CLASSIC, picks = [] } = {}) {
  const wanted = (i) => roleOf(picks?.[i]) ?? (i === 0 ? (playerBlocks ? BLOCKER : RACER) : null);
  if (rnrVariant(variant) === RNR_TIMED) {
    const roles = Array.from({ length: count }, (_, i) => roleOf(picks?.[i]));
    const anyPick = roles.some((role) => role !== null);
    if (count > 0 && roles[0] === null) roles[0] = wanted(0);
    const sizes = [0, 0];
    roles.forEach((role) => { if (role !== null) sizes[role]++; });
    for (let i = 1; i < count; i++) {
      if (roles[i] !== null) continue;
      const role = anyPick ? (sizes[RACER] <= sizes[BLOCKER] ? RACER : BLOCKER) : (i % 2 === 0 ? roles[0] : 1 - roles[0]);
      roles[i] = role;
      sizes[role]++;
    }
    return { teams: [...roles], roles };
  }
  const pickedTeam = (i) => {
    const team = picks?.[i]?.team;
    return Number.isInteger(team) && team >= 0 && team < RNR_MAX_TEAMS ? team : null;
  };
  let teamCount = rnrTeamCount(count);
  for (let i = 0; i < count; i++) if (pickedTeam(i) !== null) teamCount = Math.max(teamCount, pickedTeam(i) + 1);
  const teams = new Array(count).fill(null), roles = new Array(count).fill(null);
  const members = Array.from({ length: teamCount }, () => []);
  for (let i = 0; i < count; i++) {
    const team = pickedTeam(i);
    if (team === null) continue;
    teams[i] = team;
    members[team].push(i);
  }
  // A team lacks a role while none of its members has it or means to take it.
  const lacks = (team, role) => !members[team].some((j) => (roles[j] ?? wanted(j)) === role);
  for (let i = 0; i < count; i++) {
    if (teams[i] !== null) continue;
    const want = wanted(i);
    let best = -1;
    for (let team = 0; team < teamCount; team++) {
      if (want !== null && !lacks(team, want)) continue;
      if (best < 0 || members[team].length < members[best].length) best = team;
    }
    if (best < 0) best = members.reduce((b, m, team) => (m.length < members[b].length ? team : b), 0);
    teams[i] = best;
    members[best].push(i);
  }
  for (let i = 0; i < count; i++) {
    const role = wanted(i);
    roles[i] = role !== null ? role : lacks(teams[i], RACER) ? RACER : BLOCKER;
  }
  return { teams, roles };
}

/** Whether a racer has finished: the race is then over, won by that racer's team (or the Racers' side). */
export const racerHome = (roles, trucks) => roles.some((role, i) => role === RACER && trucks[i]?.finished);

/**
 * The classic teams in order, best first: the team of the first racer home, then the others by their racer's race
 * (one home by its time, ahead of those still racing, those by race place); a team with no racer last.
 */
export function rnrTeamOrder(teams, roles, trucks) {
  const best = new Map();
  teams.forEach((team) => { if (!best.has(team)) best.set(team, [2, 0]); });
  roles.forEach((role, i) => {
    if (role !== RACER) return;
    const key = trucks[i]?.finished ? [0, trucks[i].raceTime] : [1, trucks[i]?.place ?? Infinity];
    const now = best.get(teams[i]);
    if (key[0] < now[0] || (key[0] === now[0] && key[1] < now[1])) best.set(teams[i], key);
  });
  return [...best.entries()].sort((a, b) => (a[1][0] - b[1][0]) || (a[1][1] - b[1][1]) || (a[0] - b[0])).map(([team]) => team);
}

/**
 * The winning team: timed, the Racers once one of them is home, else the Blockers; classic, the team first in
 * `rnrTeamOrder` (the first racer home's).
 */
export function rnrWinner(roles, trucks, teams = roles, variant = RNR_TIMED) {
  if (rnrVariant(variant) === RNR_TIMED) return racerHome(roles, trucks) ? RACER : BLOCKER;
  return rnrTeamOrder(teams, roles, trucks)[0] ?? 0;
}

/**
 * Each truck's place from the race (`race.trucks[i]` with `finished`, `raceTime` and `place`), the winning team first.
 * Timed: racers by their finish (a finished one by its time, ahead of those still racing, those by race place), blockers
 * by race place. Classic: the teams in `rnrTeamOrder`, in each its racer ahead of its blocker.
 */
export function rnrPlaces(teams, roles, trucks, variant = RNR_TIMED) {
  const classic = rnrVariant(variant) === RNR_CLASSIC;
  const winner = rnrWinner(roles, trucks, teams, variant);
  const teamRank = classic ? new Map(rnrTeamOrder(teams, roles, trucks).map((team, k) => [team, k])) : null;
  const done = (i) => roles[i] === RACER && trucks[i].finished;
  const key = (i) => (classic
    ? [teamRank.get(teams[i]), roles[i] === RACER ? 0 : 1, done(i) ? trucks[i].raceTime : trucks[i].place]
    : [roles[i] === winner ? 0 : 1, done(i) ? 0 : 1, done(i) ? trucks[i].raceTime : trucks[i].place]);
  const order = roles.map((_, i) => i).sort((i, j) => {
    const a = key(i), b = key(j);
    return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || (i - j);
  });
  const places = new Array(order.length);
  order.forEach((i, k) => { places[i] = k + 1; });
  return places;
}

/** The team places (1 the winner), by team, from `rnrPlaces`. */
export function rnrTeamPlaces(teams, places) {
  const best = new Map();
  teams.forEach((team, i) => best.set(team, Math.min(best.get(team) ?? Infinity, places[i])));
  const order = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([team]) => team);
  return new Map(order.map((team, k) => [team, k + 1]));
}

/**
 * The racer a blocker at `pos` goes for: the nearest one still racing, of `racers` (`{ index, team, pos, vel,
 * finished }`), not of its own team. Null with none.
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

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * What blocker `index` goes for, of `trucks` (`{ index, team, role, pos, vel, finished }` each): the nearest racer of
 * another team still racing, unless a blocker of another team is within `GUARD_FT` of its own racer and nearer to it
 * than that racer is: then it fights that blocker. With no racer left to stop, the nearest enemy blocker. Null with none.
 */
export function blockerTarget(index, trucks) {
  const me = trucks[index];
  const racer = blockTarget(me.team, me.pos, trucks.filter((t) => t.role === RACER));
  const own = trucks.find((t) => t.role === RACER && t.team === me.team && !t.finished) ?? null;
  let threat = null;
  if (own) {
    let near = GUARD_FT;
    for (const t of trucks) {
      if (t.role !== BLOCKER || t.team === me.team) continue;
      const d = flat(t.pos, own.pos);
      if (d < near) { near = d; threat = t; }
    }
  }
  if (threat && (!racer || flat(threat.pos, me.pos) < flat(racer.pos, me.pos))) return threat;
  if (racer) return racer;
  let best = null, bestD = Infinity;
  for (const t of trucks) {
    if (t.role !== BLOCKER || t.team === me.team) continue;
    const d = flat(t.pos, me.pos);
    if (d < bestD) { bestD = d; best = t; }
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
  return { teams: byVehicle(s.teams, vehicleOf), roles: byVehicle(s.roles, vehicleOf), over: !!s.over, variant: rnrVariant(s.variant) };
}

export function rnrFromWire(d, localOf, count) {
  return { teams: fromVehicles(d.teams, localOf, count, 0), roles: fromVehicles(d.roles, localOf, count, BLOCKER), over: !!d.over, variant: rnrVariant(d.variant) };
}
