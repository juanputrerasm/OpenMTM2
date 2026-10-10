/*
  Starting a race from the menus: the race that was last chosen on the Races screen
  (`context.raceConfig`), the current driver's truck and Garage setup. The classic skin's GO
  button runs this from any screen, as in the game.
*/
import { currentDriver, getProfiles } from "./profile-store.js";

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

/** Start the chosen race, or open the Races screen when nothing is chosen yet. */
export async function goRace(context) {
  const config = context.raceConfig;
  if (!config) return context.router.go("race-select", { mode: "circuit" }, { replace: true });
  const catalog = await context.assets.call("catalog");
  const track = catalog.tracks.find((t) => t.file === config.track);
  const trucks = catalog.trucks.filter((t) => !t.hidden);
  const driver = currentDriver(await getProfiles(context));
  const truck = trucks.find((t) => t.file === driver.lastTruck) ?? trucks[0];
  if (!track || !truck) return context.router.go("race-select", { mode: config.mode }, { replace: true });
  return context.router.go("race", {
    track, mode: config.mode, laps: config.laps, difficulty: config.difficulty, opponents: config.opponents, weather: config.weather,
    // Free roam (the Races screen's box, or a track that has no checkpoints): the player alone, no race.
    freeRoam: !!config.freeRoam || !!track.freeRoamOnly,
    truck: truck.file, trucks, setup: { ...driver.garage },
  });
}
