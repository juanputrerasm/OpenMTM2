/*
  Race & Rumble (docs/EXTENSIONS.md), an addition, not in the game. Tracks with checkpoints only (circuits and rallies); the race is the track's
  own circuit race (its checkpoints, laps, countdown and ending, game/race-end.js). Two ways to play it, chosen in
  Options (`variant`):

  - "classic", after the MTM community's rules (mtm2.com/~mtmg/rnr.php): teams of two, a Racer and a Blocker in
    each. The first racer home wins it for its team; a blocker frees its own racer from a truck blocking it, else
    goes for the leading racer of the other teams.
  - "timed", a block against the clock between two sides: the Racers and the Blockers (a truck's side is its role).
    The Racers win as soon as any racer finishes within the time limit; the Blockers win when the time runs out first.
  - "chase", Monster Truck Madness 64's chase (docs/EXTENSIONS.md): the timed block with one racer, the Suspect, and the
    rest Cops. A cop within 30 ft of the suspect scores a bust (`chaseBust`), none for 3 s after one.

  Blockers are not in the race: no checkpoints, no laps, no place while it runs (`racerPlaces`). Teams and roles
  come from the Computer Opponents dialog, or are filled in here. The final places put the winning team first.
  Pure, so it runs under Node.
*/
import { byVehicle, fromVehicles, localIndex, vehicleIndex } from "./net-wire.js";
import { TEAM_COLOURS, TEAM_NAMES } from "./teams.js";
import { COP_COLOUR, COP_NAME, ROBBER_COLOUR } from "./cops-robbers.js";
import { msg } from "../strings.js";
import { hasCheckpoints } from "./track-kinds.js";

export const DEFAULT_RNR_LAPS = 3;
export const DEFAULT_RNR_MINUTES = 5;
/** A truck's role; in the timed block it is also its side: 0 the Racers, 1 the Blockers. */
export const RACER = 0, BLOCKER = 1;
export const ROLE_NAMES = Object.freeze([msg("Racer"), msg("Blocker")]);
/** The timed block's two sides' names, by role. */
export const SIDE_NAMES = Object.freeze([msg("Racers"), msg("Blockers")]);
export const RNR_CLASSIC = "classic", RNR_TIMED = "timed", RNR_CHASE = "chase";
/** The chase's roles' names (a suspect races, a cop blocks) and colours. */
export const SUSPECT_NAME = msg("Suspect");
export const CHASE_ROLE_NAMES = Object.freeze([SUSPECT_NAME, COP_NAME]);
export const CHASE_COLOURS = Object.freeze([ROBBER_COLOUR, COP_COLOUR]);
/** A cop this near the suspect busts it, for this many busts; none for this long after one (feet, count, seconds). */
export const CHASE_BUST_FT = 30, CHASE_BUST_POINTS = 1, CHASE_COOLDOWN_S = 3;
/** A classic team is two trucks; there are as many teams as the field fills, four at most (the teams' colours). */
export const RNR_TEAM_SIZE = 2;
export const RNR_MAX_TEAMS = TEAM_NAMES.length;
/** A truck of another team this near a racer going this slowly, or this near whatever its speed, is blocking it, feet and ft/s. */
export const BLOCKING_FT = 45, HELD_FT_S = 25, PINNED_FT = 22;
/** The lead racer is too far past this distance, feet; a racer nearer than this share of the lead's distance is then the target. */
export const LEAD_FAR_FT = 700, CLOSER_SHARE = 0.5;
/** A hit on a racer counts as a block when it was doing at least this speed and is held under this one within the window, ft/s and s. */
export const BLOCK_FROM_FT_S = 30, BLOCK_TO_FT_S = 8, BLOCK_WINDOW_S = 2.5;
/** A racer whose up axis is under this has been rolled over; a blocker cheers at most once in this many seconds. */
export const ROLLED_UP = 0.3, CHEER_GAP_S = 6;

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
        Object.freeze({ value: RNR_CHASE, label: msg("Chase (MTM64): one suspect races, the cops bust it") }),
      ]),
    }),
    Object.freeze({ key: "laps", label: msg("Laps"), type: "number", min: 1, max: 99, default: DEFAULT_RNR_LAPS }),
    Object.freeze({ key: "minutes", label: msg("Time limit (timed block and chase)"), type: "number", min: 1, max: 99, default: DEFAULT_RNR_MINUTES, suffix: msg("minutes") }),
    Object.freeze({ key: "blocker", label: msg("Play as blocker or cop"), type: "boolean", default: false }),
  ]),
  /** A track raced through checkpoints: a circuit or a rally (not free roam, a Summit Rumble or a drag strip's lanes). */
  acceptsTrack: hasCheckpoints,
  trackLocked: false,
  keepsRace: true,
  minEntrants: 2,
  /**
   * The Computer Opponents dialog: classic, each truck's team and its role; the timed block, its role alone (the side,
   * in the Racers' and the Blockers' colours).
   */
  teamPicker: (settings) => {
    const variant = rnrVariant(settings?.variant);
    if (variant === RNR_CHASE) return { teams: 0, roles: CHASE_ROLE_NAMES, roleColours: CHASE_COLOURS };
    return variant === RNR_TIMED
      ? { teams: 0, roles: SIDE_NAMES, roleColours: TEAM_COLOURS.slice(0, 2) }
      : { teams: RNR_MAX_TEAMS, teamNames: TEAM_NAMES, teamColours: TEAM_COLOURS, roles: ROLE_NAMES };
  },
  weather: null,
  detailLevel: null,
});

/** The variant a settings value names, classic unless it is the timed block. */
export const rnrVariant = (value) => (value === RNR_TIMED || value === RNR_CHASE ? value : RNR_CLASSIC);

/** Whether a variant plays two sides against a time limit (the timed block and the chase), not classic teams. */
export const rnrSided = (variant) => rnrVariant(variant) !== RNR_CLASSIC;

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
  if (rnrVariant(variant) === RNR_CHASE) {
    const roles = chaseRoles(count, playerBlocks, picks);
    return { teams: [...roles], roles };
  }
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

/**
 * The chase's roles for `count` trucks: exactly one suspect (RACER), the rest cops (BLOCKER). The first truck picked
 * Suspect is it; later Suspect picks become cops. With none picked, truck 0 unless `playerCops`, then the first computer
 * truck left on Auto (the first computer truck when every one is picked Cop).
 */
export function chaseRoles(count, playerCops = false, picks = []) {
  const roles = new Array(count).fill(BLOCKER);
  if (count <= 0) return roles;
  let suspect = picks?.findIndex?.((pick, i) => i < count && roleOf(pick) === RACER) ?? -1;
  if (suspect < 0 && !playerCops && roleOf(picks?.[0]) !== BLOCKER) suspect = 0;
  if (suspect < 0) {
    suspect = Array.from({ length: count }, (_, i) => i).find((i) => i > 0 && roleOf(picks?.[i]) === null) ?? -1;
    if (suspect < 0) suspect = count > 1 ? 1 : 0;
  }
  roles[suspect] = RACER;
  return roles;
}

/** A chase's bust state: each truck's busts, when the next may be scored, the last bust and the count of busts. */
export const createChase = (count) => ({ busts: new Array(count).fill(0), coolUntil: 0, event: null, events: 0 });

/**
 * One chase step at `clock` (seconds since the countdown): unless the cooldown runs or the suspect is home, the cop
 * nearest the suspect within `CHASE_BUST_FT` (ground distance; `positions[i]` `[x, y, z]`) busts it. Returns the bust
 * (`{ kind: "bust", by, racer }`), else null.
 */
export function chaseBust(chase, clock, roles, positions, suspectHome = false) {
  if (suspectHome || clock < chase.coolUntil) return null;
  const suspect = roles.indexOf(RACER);
  const at = positions?.[suspect];
  if (suspect < 0 || !at) return null;
  let by = -1, best = Infinity;
  roles.forEach((role, i) => {
    if (role !== BLOCKER || !positions[i]) return;
    const d = flat(positions[i], at);
    if (d < CHASE_BUST_FT && d < best) { best = d; by = i; }
  });
  if (by < 0) return null;
  chase.busts[by] += CHASE_BUST_POINTS;
  chase.coolUntil = clock + CHASE_COOLDOWN_S;
  chase.event = { kind: "bust", by, racer: suspect };
  chase.events++;
  return chase.event;
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
  if (rnrSided(variant)) return racerHome(roles, trucks) ? RACER : BLOCKER;
  return rnrTeamOrder(teams, roles, trucks)[0] ?? 0;
}

/**
 * Each truck's place from the race (`race.trucks[i]` with `finished`, `raceTime` and `place`), the winning team first.
 * Timed: racers by their finish (a finished one by its time, ahead of those still racing, those by race place), blockers
 * in entry order (they have no race place). Classic: the teams in `rnrTeamOrder`, in each its racer ahead of its blocker.
 */
export function rnrPlaces(teams, roles, trucks, variant = RNR_TIMED, busts = null) {
  const classic = rnrVariant(variant) === RNR_CLASSIC;
  const chase = rnrVariant(variant) === RNR_CHASE;
  const winner = rnrWinner(roles, trucks, teams, variant);
  const teamRank = classic ? new Map(rnrTeamOrder(teams, roles, trucks).map((team, k) => [team, k])) : null;
  const done = (i) => roles[i] === RACER && trucks[i].finished;
  // A chase's cops go by their busts, most first; a racer or a timed blocker by its race.
  const key = (i) => (classic
    ? [teamRank.get(teams[i]), roles[i] === RACER ? 0 : 1, done(i) ? trucks[i].raceTime : trucks[i].place]
    : chase && roles[i] === BLOCKER ? [roles[i] === winner ? 0 : 1, 0, -(busts?.[i] ?? 0)]
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
 * The places shown while the race runs: the racers alone, 1 to their count, in the order of the race's own places
 * (`racePlaces`); a blocker has none (null).
 */
export function racerPlaces(roles, racePlaces) {
  const racers = roles.map((role, i) => i).filter((i) => roles[i] === RACER)
    .sort((i, j) => ((racePlaces[i] ?? Infinity) - (racePlaces[j] ?? Infinity)) || (i - j));
  const places = roles.map(() => null);
  racers.forEach((i, k) => { places[i] = k + 1; });
  return places;
}

/** The truck whose times a truck's HUD shows: its own, or a classic blocker's its team's racer's. */
export function timingTruck(index, teams, roles, variant = RNR_CLASSIC) {
  if (roles[index] === RACER || rnrSided(variant)) return index;
  const racer = roles.findIndex((role, i) => role === RACER && teams[i] === teams[index]);
  return racer >= 0 ? racer : index;
}

/**
 * The truck of another team blocking racer `racer` (of `trucks`, `{ index, team, pos, speed }` each): the nearest
 * within `PINNED_FT`, or within `BLOCKING_FT` while the racer is held under `HELD_FT_S`. Null with none.
 */
export function blockingTruck(racer, trucks) {
  let best = null, bestD = Infinity;
  for (const t of trucks) {
    if (t.index === racer.index || t.team === racer.team) continue;
    const d = flat(t.pos, racer.pos);
    const blocking = d < PINNED_FT || (d < BLOCKING_FT && (racer.speed ?? 0) < HELD_FT_S);
    if (blocking && d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * What blocker `index` goes for, of `trucks` (`{ index, team, role, pos, vel, speed, place, finished }` each, `place`
 * a racer's place among the racers):
 * - its own team's racer being blocked (classic): the truck blocking it, first of all;
 * - else the leading racer of another team still racing; when that one is past `LEAD_FAR_FT` and another is nearer
 *   than `CLOSER_SHARE` of its distance, that nearer one.
 * A blocker never goes for a blocker otherwise. Null with no racer to go for.
 */
export function blockerTarget(index, trucks) {
  const me = trucks[index];
  const own = trucks.find((t) => t.role === RACER && t.team === me.team && !t.finished) ?? null;
  if (own) {
    const pest = blockingTruck(own, trucks);
    if (pest && pest.index !== index) return pest;
  }
  const racers = trucks.filter((t) => t.role === RACER && t.team !== me.team && !t.finished);
  if (!racers.length) return null;
  const lead = racers.reduce((a, b) => ((b.place ?? Infinity) < (a.place ?? Infinity) ? b : a));
  const near = blockTarget(me.team, me.pos, racers);
  const leadD = flat(lead.pos, me.pos);
  if (near && near !== lead && leadD > LEAD_FAR_FT && flat(near.pos, me.pos) < leadD * CLOSER_SHARE) return near;
  return lead;
}

/**
 * Whether a blocker's hit on a racer came off: `hit` is `{ at, speed }` (when they touched, and the racer's speed
 * then), `racer` `{ speed, up }` now. "roll" when the racer is over, "block" when a racer doing `BLOCK_FROM_FT_S` is
 * held under `BLOCK_TO_FT_S`, "expired" past the window, else null (still to tell).
 */
export function blockOutcome(hit, racer, now) {
  if (racer.up < ROLLED_UP) return "roll";
  if (hit.speed >= BLOCK_FROM_FT_S && racer.speed < BLOCK_TO_FT_S) return "block";
  if (now - hit.at > BLOCK_WINDOW_S) return "expired";
  return null;
}

/** Whether truck `a` blocking truck `b` counts: a blocker on a racer it races against. */
export const blocksRacer = (a, b, teams, roles) => roles[a] === BLOCKER && roles[b] === RACER && teams[a] !== teams[b];

/** Where a blocker meets its target: ahead of it by the distance over 90 ft/s, at most 2 s. */
export function interceptPoint(pos, target) {
  const d = Math.hypot(target.pos[0] - pos[0], target.pos[2] - pos[2]);
  const lead = Math.min(2, d / 90);
  return [target.pos[0] + target.vel[0] * lead, target.pos[1], target.pos[2] + target.vel[2] * lead];
}

// ---- Over the network (docs/EXTENSIONS.md) ----

export function rnrToWire(s, vehicleOf) {
  const v = (i) => vehicleIndex(i, vehicleOf);
  return {
    teams: byVehicle(s.teams, vehicleOf), roles: byVehicle(s.roles, vehicleOf), over: !!s.over, variant: rnrVariant(s.variant),
    events: s.events | 0, event: s.event ? { ...s.event, by: v(s.event.by), racer: v(s.event.racer) } : null,
    ...(s.busts ? { busts: byVehicle(s.busts, vehicleOf), coolUntil: Number(s.coolUntil) || 0 } : {}),
  };
}

export function rnrFromWire(d, localOf, count) {
  const i = (vehicle) => localIndex(vehicle, localOf);
  return {
    teams: fromVehicles(d.teams, localOf, count, 0), roles: fromVehicles(d.roles, localOf, count, BLOCKER), over: !!d.over, variant: rnrVariant(d.variant),
    events: d.events | 0, event: d.event ? { ...d.event, by: i(d.event.by), racer: i(d.event.racer) } : null,
    ...(d.busts ? { busts: fromVehicles(d.busts, localOf, count, 0), coolUntil: Number(d.coolUntil) || 0 } : {}),
  };
}
