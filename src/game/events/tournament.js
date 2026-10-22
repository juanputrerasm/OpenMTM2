/*
  A tournament, as Monster Truck Madness 1 runs one (MTM1_MONSTER_EXE_ANALYSIS.md 6): a list of
  events on different tracks, the same drivers in each, the points of every event added up, and
  the order by the total. There is no elimination between events and no time carried over.

  State and points only: it runs no races. A host (app/tournament.js) gives it its field, runs
  each event (a race, or a drag weekend for a drag strip) and hands back the points. The state is
  plain data, so the host can store it. Pure, so it runs under Node.

  The file is OpenPhotex's `.TRN` (`parseTrn`, `writeTrn`). The game's limits: 16 events, 1 to 20
  laps for a circuit, and 2, 4 or 8 trucks when an event is a drag race.
*/
import { msg } from "../strings.js";

export const MAX_EVENTS = 16;
export const MAX_LAPS = 20;
export const MAX_TOURNAMENTS = 16;
/** The field a tournament with a drag event takes (the bracket's sizes). */
export const DRAG_FIELDS = Object.freeze([2, 4, 8]);

/** MTM1's drag points (0x4bbd60, 0x4bb6d0, 0x4bf100): by qualifying place, per pairing won, to a loser, for the fastest pass. */
export const DRAG_QUALIFY_POINTS = Object.freeze([100, 90, 80, 70]);
export const DRAG_QUALIFY_REST = 60;
export const DRAG_WIN_POINTS = 250;
export const DRAG_LOSS_POINTS = 200;
export const DRAG_FASTEST_POINTS = 50;
/** The final's winner: 250 with one round, and 50 more for every round before it (350 from 8 trucks, 300 from 4). */
export const dragFinalPoints = (rounds) => 250 + 50 * (rounds - 1);

const stemOf = (file) => String(file).toUpperCase().replace(/\.SI[T2]$/, "");

/**
 * A tournament read from a `.TRN` (`{ name, descriptionFile, hasDrag, events: [{ file, laps }] }`), each event tied to
 * the catalogue's track by its SIT's name. An event is given a `problem` when its track is not there or has no race
 * (a free roam track cannot be in a tournament); such a tournament is shown but not started.
 */
export function tournamentFromTrn(trn, tracks, { source = null, stock = false } = {}) {
  const events = trn.events.slice(0, MAX_EVENTS).map((event) => {
    const track = tracks.find((t) => stemOf(t.file) === stemOf(event.file)) ?? null;
    const laps = track?.raceType === "circuit" ? Math.max(1, Math.min(MAX_LAPS, event.laps || track.defaultLaps || 1)) : 0;
    const problem = !track ? `${event.file} is not installed` : track.freeRoamOnly || track.raceType === "freeroam" ? `${track.name} has no race on it`
      : !["circuit", "rally", "drag"].includes(track.raceType) ? `${track.name} is not a circuit, a rally or a drag strip` : null;
    return { file: event.file, laps, name: track?.name ?? event.file, raceType: track?.raceType ?? null, problem };
  });
  return {
    name: trn.name, descriptionFile: trn.descriptionFile ?? "", source, stock,
    hasDrag: events.some((e) => e.raceType === "drag") || (!!trn.hasDrag && events.some((e) => e.raceType === null)),
    events,
  };
}

/** The `.TRN` of a tournament, for OpenPhotex's `writeTrn`. */
export function trnOf(tournament) {
  return {
    name: tournament.name, descriptionFile: tournament.descriptionFile ?? "", hasDrag: tournament.events.some((e) => e.raceType === "drag"),
    events: tournament.events.map((e) => ({ file: e.file, laps: e.raceType === "circuit" ? e.laps : 0 })),
  };
}

/** Why a tournament cannot start with `fieldSize` drivers, or null when it can. */
export function startProblem(tournament, fieldSize) {
  if (!tournament.events.length) return msg("The tournament has no events.");
  const bad = tournament.events.find((e) => e.problem);
  if (bad) return `${bad.problem}.`;
  if (tournament.hasDrag && !DRAG_FIELDS.includes(fieldSize)) return msg("Because of pairing requirements, a tournament with a drag race takes 2, 4 or 8 trucks.");
  if (fieldSize < 1 || fieldSize > 8) return msg("A tournament takes 1 to 8 trucks.");
  return null;
}

/** A tournament under way: `field` is `[{ name, truck, player }]`, the same in every event. */
export function startTournament(tournament, field) {
  const problem = startProblem(tournament, field.length);
  if (problem) throw new Error(problem);
  return {
    name: tournament.name, descriptionFile: tournament.descriptionFile, source: tournament.source ?? null,
    drivers: field.map((d) => ({ name: d.name, truck: d.truck, player: !!d.player })),
    /** `points[driver]` once the event is run; `skipped` when it was passed over (it scores nothing). */
    events: tournament.events.map((e) => ({ file: e.file, laps: e.laps, name: e.name, raceType: e.raceType, points: null, skipped: false })),
    current: 0, done: false,
  };
}

/** The event to run next, or null when the tournament is over. */
export function currentEvent(run) {
  return run.done ? null : run.events[run.current];
}

const settle = (run) => {
  const next = run.events.findIndex((e, i) => i >= run.current && e.points === null && !e.skipped);
  run.current = next < 0 ? run.events.length : next;
  run.done = next < 0;
  return run;
};

/** The current event was run: `points[driver]`, in the field's order. The next event becomes the current one. */
export function recordEvent(run, points) {
  const event = currentEvent(run);
  if (!event) throw new Error(msg("The tournament is over."));
  event.points = run.drivers.map((_, i) => Math.max(0, Math.trunc(points[i] ?? 0)));
  run.current += 1;
  return settle(run);
}

/**
 * Move to another event (the console's `tourney next`, `prev` and `goto`): going forward passes over the events in
 * between, which then score nothing; going back opens them again, their points dropped, to be run once more.
 */
export function gotoEvent(run, index) {
  const to = Math.max(0, Math.min(run.events.length, Math.trunc(index)));
  run.events.forEach((event, i) => {
    if (i >= to) { event.points = null; event.skipped = false; } else if (event.points === null) event.skipped = true;
  });
  run.current = to;
  run.done = to >= run.events.length;
  return run;
}

/** The standings: `[{ driver, points }]`, the most points first; a tie keeps the field's order. */
export function standings(run) {
  return run.drivers.map((_, driver) => ({ driver, points: run.events.reduce((sum, e) => sum + (e.points?.[driver] ?? 0), 0) }))
    .sort((a, b) => b.points - a.points || a.driver - b.driver);
}

/**
 * MTM1's points for a finished drag event (game/events/drag-event.js), per driver: for the qualifying place (none
 * without a qualifying time), 250 for each pairing won before the final, the final's bonus to its winner, 200 to each
 * driver who lost a pairing, and 50 for the fastest pass of the event.
 */
export function dragEventPoints(event) {
  const rounds = event.bracket.length;
  const points = event.drivers.map((d, i) => {
    let p = d.qualify === null || d.qualify === undefined ? 0 : DRAG_QUALIFY_POINTS[(d.seed ?? 99) - 1] ?? DRAG_QUALIFY_REST;
    if (i === event.winner) p += DRAG_WIN_POINTS * (rounds - 1) + dragFinalPoints(rounds);
    else if (d.out !== null && d.out !== undefined) p += DRAG_WIN_POINTS * d.out + DRAG_LOSS_POINTS;
    return p;
  });
  let fastest = -1;
  event.drivers.forEach((d, i) => { if (d.best !== null && d.best !== undefined && (fastest < 0 || d.best < event.drivers[fastest].best)) fastest = i; });
  if (fastest >= 0) points[fastest] += DRAG_FASTEST_POINTS;
  return points;
}
