/*
  The tournament in progress (`context.tournament`) and the tournaments on offer. It hosts the rules
  (game/events/tournament.js): it builds the field, runs each event through the ordinary race, or
  through a drag weekend for a drag strip, and hands the event's points back. The run is stored with
  the player's data (the asset worker's `tournamentRun`), so it survives a reload.

  The tournaments: the stock ones are the mounted `TOURNEY\*.TRN` (Monster Truck Triathlon and the
  like; both games ship them), the player's own are kept with the player's data (`tournaments`).
*/
import { parseTrn, writeTrn } from "../vendor/openphotex/mtm/trn.js";
import { SERIES_MAGIC, parseSeries, writeSeries } from "../vendor/openphotex/mtm/series.js";
import { seriesPlacePoints } from "../game/race-points.js";
import { cpuNames } from "../game/race-setup.js";
import {
  MAX_TOURNAMENTS, currentEvent, dragEventPoints, gotoEvent, recordEvent, seriesOf, standings, startTournament, tournamentFromSeries, tournamentFromTrn, trnOf,
} from "../game/events/tournament.js";
import { finalOrder } from "../game/events/drag-event.js";
import { startDragWeekend } from "./drag-weekend.js";
import { currentDriver, getHall, getProfiles, saveHall } from "./profile-store.js";
import { TOURNAMENT_MODE, addEntry, tournamentKey } from "../game/hall-of-fame.js";

const load = (context, key) => context.assets.call("userData", { key }).catch(() => null);
const store = (context, key, value) => context.assets.call("saveUserData", { key, value }).catch(() => {});

/** Every tournament on offer: the stock ones first, then the player's own (`stock: false`, with their `description`). */
export async function listTournaments(context, tracks) {
  const stock = (await context.assets.call("tournaments").catch(() => []))
    .map(({ path, trn, description }) => ({ ...tournamentFromTrn(trn, tracks, { source: path, stock: true }), description: description ?? "" }));
  const own = ((await load(context, "tournaments")) ?? [])
    .map((saved) => ({ ...tournamentFromTrn(saved, tracks, { source: null, stock: false }), description: saved.description ?? "" }));
  return [...stock, ...own];
}

/** Keep the player's own tournaments (those not stock), at most the game's sixteen with the stock ones. */
export async function saveOwnTournaments(context, tournaments) {
  const own = tournaments.filter((t) => !t.stock).slice(0, Math.max(0, MAX_TOURNAMENTS - tournaments.filter((t) => t.stock).length));
  await store(context, "tournaments", own.map((t) => ({ ...trnOf(t), description: t.description ?? "", ...(t.series ? { series: t.series } : {}) })));
}

/**
 * A tournament as the text of its file, and one read from such a text (null when it is not one): MTM1's `.TRN`, or a
 * Community Patch 4 series (`MTM2 Series 1.0`, its `.trn`) for a tournament made from one.
 */
export const tournamentText = (tournament) => (tournament.series ? writeSeries(seriesOf(tournament)) : writeTrn(trnOf(tournament)));
export function tournamentFromText(text, tracks) {
  const head = typeof text === "string" ? text : new TextDecoder("latin1").decode(text.subarray(0, 64));
  if (head.trimStart().startsWith(SERIES_MAGIC)) {
    try {
      return tournamentFromSeries(parseSeries(text), tracks, { source: null, stock: false });
    } catch {
      return null;
    }
  }
  const trn = parseTrn(text);
  return trn ? { ...tournamentFromTrn(trn, tracks, { source: null, stock: false }), description: "" } : null;
}

/**
 * Start `tournament` with `size` drivers: the player in their truck and computer drivers in trucks drawn from `trucks`.
 * Throws when it cannot start (game/events/tournament.js `startProblem`).
 */
export async function beginTournament(context, tournament, { tracks, trucks, size, difficulty, weather = 0, aiSpeed = null, random = Math.random }) {
  const driver = currentDriver(await getProfiles(context));
  const mine = (trucks.find((t) => t.file === driver.lastTruck) ?? trucks[0]).file;
  const others = trucks.filter((t) => t.file !== mine);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  const field = [{ name: driver.name, truck: mine, player: true }];
  const names = cpuNames(context.settings?.aiNames);
  for (let i = 0; i < size - 1; i++) field.push({ name: names[i % names.length], truck: (others[i % Math.max(1, others.length)] ?? trucks[0]).file, player: false });
  // AI Speed (game/ai-speed.js): the tournament keeps the value it started with, as CP3's tournaments do (`AISPEED=`).
  // A series' AISPEED, when it gives one, is the tournament's (CP4_ENGINE_UPDATES.md 9.4).
  const seriesSpeed = tournament.series?.aiSpeed ?? null;
  context.tournament = { run: startTournament(tournament, field), difficulty, weather, aiSpeed: seriesSpeed ?? aiSpeed, description: tournament.description ?? "", tracks, trucks };
  await keep(context);
  return context.tournament;
}

/** Store the run, or forget it when there is none. */
export async function keep(context) {
  const t = context.tournament;
  await store(context, "tournamentRun", t ? { run: t.run, difficulty: t.difficulty, weather: t.weather, aiSpeed: t.aiSpeed ?? null, description: t.description } : null);
}

/** The run a reload left behind, tied to the catalogue again; null when there is none. */
export async function restoreTournament(context, { tracks, trucks }) {
  if (context.tournament) return context.tournament;
  const saved = await load(context, "tournamentRun");
  if (!saved?.run?.events?.length) return null;
  context.tournament = { ...saved, tracks, trucks };
  return context.tournament;
}

export async function abandonTournament(context) {
  context.tournament = null;
  if (context.dragWeekend?.tournament) context.dragWeekend = null;
  await keep(context);
}

const trackOf = (t, event) => t.tracks.find((item) => item.file.toUpperCase() === event.file.toUpperCase())
  ?? t.tracks.find((item) => item.file.toUpperCase().replace(/\.SI[T23]$/, "") === event.file.toUpperCase().replace(/\.SI[T23]$/, ""));

/**
 * Run the tournament's current event: a circuit or a rally on the race screen with the field's trucks, a drag strip as
 * a drag weekend of the same drivers (ui/screens/drag-event.js), whose points come back when it is over.
 */
export async function runEvent(context) {
  const t = context.tournament, event = currentEvent(t.run);
  if (!event) return context.router.go("tournament", {}, { replace: true });
  const track = trackOf(t, event);
  if (!track) throw new Error(`${event.file} is not installed.`);
  const [me, ...others] = t.run.drivers;
  // A series round's own weather (0 random: the tournament's); its laps for a drag round's bracket passes.
  const weather = event.weather ? event.weather : t.weather;
  if (event.raceType === "drag") {
    if (!context.dragWeekend?.tournament) {
      startDragWeekend(context, {
        track, trucks: t.trucks, playerTruck: me.truck, playerName: me.name, size: t.run.drivers.length, difficulty: t.difficulty, weather,
        aiSpeed: t.aiSpeed ?? null, laps: event.laps || 1,
        field: t.run.drivers.map((d) => ({ name: d.name, truck: d.truck, player: d.player })),
      });
      context.dragWeekend.tournament = true;
    }
    return context.router.go("drag-event", {}, { replace: true });
  }
  const driver = currentDriver(await getProfiles(context));
  return context.router.go("race", {
    track, mode: track.raceType, laps: event.raceType === "circuit" ? event.laps : 1, difficulty: t.difficulty, weather,
    opponents: others.map((d) => d.truck), truck: me.truck, trucks: t.trucks, setup: { ...driver.garage }, tournament: true,
    aiSpeed: t.aiSpeed ?? null,
  }, { replace: true });
}

/**
 * A tournament race was run: `points[i]` for the race's truck `i`, the player first and the computer drivers in the
 * field's order (a truck the grid had no room for scores nothing). Counted once for `rows`.
 */
export async function takeRace(context, rows, points) {
  const t = context.tournament;
  if (!t || t.seen === rows || !currentEvent(t.run)) return false;
  t.seen = rows;
  // A Community Patch 4 series on championship scoring scores by place (CP4_ENGINE_UPDATES.md 9.4); a truck that did
  // not finish keeps its place.
  const scored = t.run.scoring === 1 ? rows.map((r) => seriesPlacePoints(r.place, { scoring: 1 })) : points;
  recordEvent(t.run, t.run.drivers.map((_, i) => scored[i] ?? 0));
  await keep(context);
  return true;
}

/** The tournament's drag weekend is over: its points by MTM1's rule, and the weekend put away. */
export async function takeDragWeekend(context) {
  const t = context.tournament, weekend = context.dragWeekend;
  if (!t || !weekend?.tournament || weekend.event.phase !== "done") return false;
  // A series scores a drag round by the weekend's final order: classic on the 16-place table, championship on its own
  // (16-truck drags on theirs). MTM1's tournaments keep MTM1's drag points.
  if (t.run.scoring === 0 || t.run.scoring === 1) {
    const order = finalOrder(weekend.event), points = new Array(weekend.event.drivers.length).fill(0);
    order.forEach((driver, k) => { points[driver] = seriesPlacePoints(k + 1, { scoring: t.run.scoring, drags16: t.run.format === 1 || order.length > 8 }); });
    recordEvent(t.run, points);
  } else recordEvent(t.run, dragEventPoints(weekend.event));
  context.dragWeekend = null;
  await keep(context);
  return true;
}

/** The console's `tourney next`, `prev` and `goto`: another event becomes the current one. */
export async function moveToEvent(context, index) {
  const t = context.tournament;
  if (context.dragWeekend?.tournament) context.dragWeekend = null;
  gotoEvent(t.run, index);
  await keep(context);
  return currentEvent(t.run);
}

/**
 * A finished tournament's total for the player goes to the Hall of Fame, once (MTM1's tournament category). Returns
 * the rank it took, 0 when it made no place, or null when there is nothing to enter.
 */
export async function enterHall(context) {
  const run = context.tournament?.run;
  if (!run?.done) return null;
  if (run.hall !== undefined) return run.hall;
  const driver = run.drivers.findIndex((d) => d.player);
  const total = standings(run).find((row) => row.driver === driver);
  if (!total) return null;
  const hall = await getHall(context);
  run.hall = addEntry(hall, {
    name: run.drivers[driver].name, truck: run.drivers[driver].truck ?? "", track: tournamentKey(run.name), trackName: run.name,
    mode: TOURNAMENT_MODE, difficulty: context.tournament.difficulty ?? 1, laps: run.events.length, points: total.points, time: 0, fastestLap: 0,
    date: new Date().toISOString().slice(0, 10),
  }) ?? 0;
  if (run.hall) await saveHall(context);
  await keep(context);
  return run.hall;
}
