/*
  Starting a race from the menus: the race that was last chosen on the Races screen
  (`context.raceConfig`), the current driver's truck and Garage setup. The classic skin's GO
  button runs this from any screen, as in the game.
*/
import { currentDriver, getProfiles } from "./profile-store.js";
import { isHockeyTrack } from "../game/hockey.js";

/**
 * Remember what the Races screen chose.
 * @param {object} context
 * @param {{ mode: string, track: string, laps: number, difficulty: number, opponents: number }} config
 */
export function setRaceConfig(context, config) {
  context.raceConfig = { ...config };
}

/**
 * Monster Demo: Farm Road 29 (or the first Circuit the install has) with eight computer trucks, the player's among them,
 * watched from the RaceCam. Any key leaves it (ui/screens/race.js, `demo`).
 */
export async function goDemo(context) {
  const catalog = await context.assets.call("catalog");
  const track = catalog.tracks.find((t) => t.file === "TPARK.SIT") ?? catalog.tracks.find((t) => t.raceType === "circuit");
  const trucks = catalog.trucks.filter((t) => !t.hidden);
  if (!track || !trucks.length) return undefined;
  return context.router.go("race", {
    track, mode: track.raceType, laps: track.defaultLaps, difficulty: 1, opponents: trucks.slice(1, 8).map((t) => t.file), weather: 0,
    truck: trucks[0].file, trucks, setup: undefined, demo: true,
  });
}

/**
 * A party mode that may run on `track` (docs/PLAN.md, "Party modes"): Hockey only on Breakneck
 * Ridge, Tag anywhere. Null for the track's own race. Pure, so it runs under Node.
 */
export function resolveGameMode(gameMode, track) {
  if (gameMode === "hockey") return isHockeyTrack(track) ? "hockey" : null;
  if (gameMode === "tag") return "tag";
  return null;
}

export const SPECTATOR_WARNING = "Spectator mode is on: the computer trucks race and you watch. You will not drive.\n\nStart the race?";

/**
 * The trucks of a race to be watched, or null when the race is one to drive: spectator mode is asked for, the track has
 * a race, and at least one computer truck is picked (`config.opponents` as a list of files that are installed).
 */
export function spectatorField(config, track, trucks) {
  if (!config?.spectator || config.freeRoam || track?.freeRoamOnly || !Array.isArray(config.opponents)) return null;
  const installed = new Set(trucks.map((t) => t.file));
  const field = config.opponents.filter((file) => installed.has(file));
  return field.length ? field : null;
}

/** Start the chosen race, or open the Races screen when nothing is chosen yet. */
export async function goRace(context) {
  const config = context.raceConfig;
  if (!config) return context.router.go("race-select", { mode: "circuit" }, { replace: true });
  const catalog = await context.assets.call("catalog");
  const track = catalog.tracks.find((t) => t.file === config.track);
  // Fly-by (the Races screen's Mode list): the track with no truck on it, not a race.
  if (config.gameMode === "flyby") {
    if (!track) return context.router.go("race-select", { mode: config.mode }, { replace: true });
    return context.router.go("fly-by", { track, weather: config.weather }, { replace: true });
  }
  const trucks = catalog.trucks.filter((t) => !t.hidden);
  const driver = currentDriver(await getProfiles(context));
  const truck = trucks.find((t) => t.file === driver.lastTruck) ?? trucks[0];
  if (!track || !truck) return context.router.go("race-select", { mode: config.mode }, { replace: true });
  // Spectator mode: the computer's trucks alone, watched. Not in free roam, which has no race to watch.
  const watched = spectatorField(config, track, trucks);
  if (watched) {
    if (!window.confirm(SPECTATOR_WARNING)) return undefined;
    return context.router.go("race", {
      track, mode: config.mode, laps: config.laps, difficulty: config.difficulty, opponents: watched.slice(1), weather: config.weather,
      freeRoam: false, truck: watched[0], trucks, setup: undefined, spectator: true,
    });
  }
  // A party game (docs/PLAN.md, "Party modes"): Hockey or Tag, `laps` its goals or minutes; never free roam.
  // Hockey only runs on Breakneck Ridge: without it the track runs its own race instead.
  const gameMode = resolveGameMode(config.gameMode, track);
  return context.router.go("race", {
    track, mode: config.mode, laps: config.laps, difficulty: config.difficulty, opponents: config.opponents, weather: config.weather, gameMode,
    // Free Roam (the Races screen's mode, or a track that has no checkpoints): the player alone, no race.
    freeRoam: !gameMode && (!!config.freeRoam || !!track.freeRoamOnly),
    truck: truck.file, trucks, setup: { ...driver.garage },
  });
}
