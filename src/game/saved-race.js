/*
  Save race and Load race: Monster Truck Madness 2's saved game (`*.mtm`, MONSTER_EXE_ANALYSIS.md 16, "Saved games";
  the format is OpenPhotex's, mtm/saved-game.js). A race in progress: who races in which truck and Garage setup, the
  weather, and the whole situation as a SIT, the level's own with its trucks as they are now and the race clock.

  `savedGameBytes` makes the file from the simulation's `savedRace` (worker/sim-worker.js), the level's SIT text and
  the race's entrants; `readSavedGame` turns a file back into a race to start and the state to put back into it. The
  port keeps the checkpoint times of the lap being run only, and leaves the level's objects where its own SIT has them.
  Pure, so it runs under Node.
*/
import { parseMtm2SavedGame, writeMtm2SavedGame } from "../vendor/openphotex/mtm/saved-game.js";
import { replaceSitVehicles } from "../vendor/openphotex/mtm/write.js";
import { parseMtmSit } from "../vendor/openphotex/mtm/sit.js";
import { msg } from "./strings.js";

/** A computer truck's Garage setup, which the race does not change (profile.js DEFAULT_GARAGE's figures). */
const CPU_SETUP = Object.freeze({ tireCut: 1, suspension: 1, transfer: 1500 });
const bare = (file) => String(file ?? "").replace(/^.*[\\/]/, "").toUpperCase();

/**
 * The race's index as the game numbers it: its place among the Monster Truck Madness 2 tracks in the catalog's order,
 * the order the archives were found in, Torture Pit left out unless unlocked (MONSTER_EXE_ANALYSIS.md 3). 0 when the
 * track is not one of them (another game's).
 */
export function raceIndexOf(track, tracks) {
  const own = tracks.filter((t) => (t.game ?? "MTM2") === "MTM2" && bare(t.file) !== "WAR.SIT");
  return Math.max(0, own.findIndex((t) => t.path === track.path || bare(t.file) === bare(track.file)));
}

/**
 * The saved game's bytes. `saved`: the simulation's `savedRace`; `entrants`: `{ file, player }` in race order;
 * `setup`: the player's Garage setup (`tireCut`, `suspension`, `transferSetting`); `damage[i]`: truck i's crash code;
 * `sitText`: the level's own SIT.
 */
export function savedGameBytes({ track, tracks, laps, weather, entrants, setup = null, saved, damage = [], sitText }) {
  const own = parseMtmSit(sitText, track.file);
  const grid = own.trucks.filter((t) => !t.playerSlot);
  const vehicles = saved.trucks.map((v, i) => ({
    truckFile: bare(entrants[i]?.file) || "POWERBIG.TRK",
    position: v.pos.map(Number), orient: v.euler.map(Number),
    courseToFollow: grid[i]?.courseToFollow ?? grid[0]?.courseToFollow ?? 2,
    state: {
      bvel: v.bvel, rates: v.rates, gear: v.gear, autopilot: v.autopilot, cnumber: v.cnumber,
      damageCode: (damage[i] ?? 0) >>> 0,
      segments: v.progress, laps: v.laps, staged: v.passCount, finished: v.finished, nextCheckpoint: v.checkpoint,
      totalRaceTime: v.raceTime, fastestLap: v.fastestLap, lapTimes: v.lapTimes,
      checkpointTimes: Array.from({ length: 20 }, (_, lap) => (lap === v.laps ? v.splits : [])),
    },
  }));
  const sit = replaceSitVehicles(sitText, vehicles, { raceTimes: [saved.clock, saved.startTime, 0] });
  const mine = setup ?? {};
  return writeMtm2SavedGame({
    playerTruck: bare(entrants.find((e) => e.player)?.file ?? entrants[0]?.file),
    raceIndex: raceIndexOf(track, tracks), laps, weather, sit,
    trucks: entrants.map((e) => (e.player
      ? { file: bare(e.file), tireCut: mine.tireCut ?? CPU_SETUP.tireCut, suspension: mine.suspension ?? CPU_SETUP.suspension, transfer: mine.transferSetting ?? CPU_SETUP.transfer }
      : { file: bare(e.file), ...CPU_SETUP })),
  });
}

/**
 * A saved game read for the port: `{ track, truck, opponents, laps, weather, setup, saved, damage }`, where `saved` is
 * the simulation's `restoreRace` value and `damage[i]` each truck's crash code, in the race's order (the player first,
 * then each opponent once, as the race's entrants are made). Throws with a message the player can read when the file
 * is not a saved game, or names a track or truck the install does not have.
 */
export function readSavedGame(bytes, { tracks, trucks }) {
  const game = parseMtm2SavedGame(bytes);
  const sit = parseMtmSit(game.sit);
  // The SIT's level line and track name settle the track; the game's index is only a fallback (catalogs differ).
  const own = tracks.filter((t) => (t.game ?? "MTM2") === "MTM2");
  const named = (sit.trackName && own.find((t) => t.name?.toUpperCase() === sit.trackName.toUpperCase() && t.level?.toUpperCase() === sit.lvlName?.toUpperCase()))
    ?? (sit.trackName && own.find((t) => t.name?.toUpperCase() === sit.trackName.toUpperCase()))
    ?? own.find((t) => sit.lvlName && t.level?.toUpperCase() === sit.lvlName.toUpperCase())
    ?? own.filter((t) => bare(t.file) !== "WAR.SIT")[game.raceIndex];
  if (!named) throw new Error(msg("The saved race's track is not installed."));
  const byFile = new Map(trucks.map((t) => [bare(t.file), t.file]));
  const player = byFile.get(bare(game.playerTruck));
  if (!player) throw new Error(msg("The saved race's truck is not installed."));
  const vehicles = sit.trucks.filter((t) => !t.playerSlot);
  // The race's entrants: the player, then each other truck once (game/race-setup.js `raceDrivers`).
  const order = [], used = new Set();
  const take = (file) => {
    const i = game.trucks.findIndex((t, k) => !used.has(k) && bare(t.file) === bare(file));
    if (i < 0) return;
    used.add(i);
    order.push(i);
  };
  take(game.playerTruck);
  const opponents = [];
  for (const t of game.trucks) {
    const file = byFile.get(bare(t.file));
    if (!file || file === player || opponents.includes(file) || opponents.length >= 7) continue;
    opponents.push(file);
    take(t.file);
  }
  const mine = game.trucks[order[0]] ?? null;
  const saved = {
    clock: sit.raceTimes?.[0], startTime: sit.raceTimes?.[1],
    trucks: order.map((k) => {
      const v = vehicles[k], s = v?.state;
      if (!v || !s) return null;
      return {
        pos: v.positionFt ?? v.position, bvel: s.bvel, euler: [v.theta, v.phi, v.psi], rates: s.rates, gear: s.gear,
        autopilot: s.autopilot, cnumber: s.cnumber, progress: s.segments, laps: s.laps, passCount: s.staged,
        finished: s.finished, checkpoint: s.nextCheckpoint, raceTime: s.totalRaceTime, fastestLap: s.fastestLap,
        lapTimes: s.lapTimes.slice(0, Math.max(1, s.laps)), splits: s.checkpointTimes[s.laps] ?? [],
      };
    }),
  };
  return {
    track: named, truck: player, opponents, laps: game.laps, weather: game.weather,
    setup: mine ? { tireCut: mine.tireCut, suspension: mine.suspension, transferSetting: mine.transfer } : null,
    saved, damage: order.map((k) => vehicles[k]?.state?.damageCode ?? 0),
  };
}
