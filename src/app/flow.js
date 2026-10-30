/*
  Starting a race from the menus: the race that was last chosen on the Races screen
  (`context.raceConfig`), the current driver's truck and Garage setup. The classic skin's GO
  button runs this from any screen, as in the game.
*/
import { currentDriver, getProfiles } from "./profile-store.js";
import { entrantsShortfall, extensionById, opponentsFor, soloExtension } from "../game/extensions/loader.js";
import { createStrings, msg } from "../game/strings.js";
import { pickDemoRace } from "../game/demo-pick.js";
import { showAlert, showConfirm } from "../ui/dialogs.js";

/**
 * Remember what the Races screen chose.
 * @param {object} context
 * @param {{ mode: string, track: string, laps: number, difficulty: number, opponents: number }} config
 */
export function setRaceConfig(context, config) {
  context.raceConfig = { ...config };
}

/**
 * Monster Demo: a Circuit or a Rally at random, in the default mode, with the player's number of computer opponents
 * (game/demo-pick.js), every truck driving itself, watched from the RaceCam. Any key leaves it; when the race is over
 * the next demo picks another track (ui/screens/race.js, `demo`). `avoid`: the track just shown.
 */
export async function goDemo(context, { avoid = null, replace = false } = {}) {
  const catalog = await context.assets.call("catalog");
  const driver = currentDriver(await getProfiles(context));
  const pick = pickDemoRace({ tracks: catalog.tracks, trucks: catalog.trucks, settings: context.settings, playerTruck: driver.lastTruck, avoid });
  if (!pick) return undefined;
  const trucks = catalog.trucks.filter((t) => !t.hidden);
  return context.router.go("race", {
    track: pick.track, mode: pick.track.raceType, laps: pick.track.defaultLaps, difficulty: 1, opponents: pick.opponents, weather: 0,
    truck: pick.truck, trucks, setup: undefined, demo: true,
  }, replace ? { replace: true } : undefined);
}

/**
 * An extension mode that may run on `track`. Null for a core or unavailable mode.
 */
export function resolveGameMode(gameMode, track) {
  const extension = extensionById(gameMode);
  return extension?.acceptsTrack(track) ? extension.id : null;
}

export const SPECTATOR_WARNING = msg("Spectator mode is on: the computer trucks race and you watch. You will not drive.\n\nStart the race?");

/**
 * The trucks of a race to be watched, or null when the race is one to drive: spectator mode is asked for, the track has
 * a race (or a party mode is played on it), and at least one computer truck is picked (`config.opponents` as a list of files that are installed).
 */
export function spectatorField(config, track, trucks) {
  // A free roam track has no race to watch, unless a party mode makes one on it.
  if (!config?.spectator || config.freeRoam || (track?.freeRoamOnly && !extensionById(config.gameMode)) || !Array.isArray(config.opponents)) return null;
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
  const gameMode = resolveGameMode(config.gameMode, track);
  // A party mode the track cannot take (Combat on a drag strip) is not started as some other race: back to the choice.
  if (config.playable === false || (extensionById(config.gameMode) && !gameMode)) {
    return context.router.go("race-select", { mode: config.mode }, { replace: true });
  }
  // A mode that needs more trucks than were picked (Tag, Hockey: two at least) is not started.
  const extension = extensionById(gameMode);
  // A mode driven alone (Freestyle): no opponents and nothing to watch, whatever an older choice kept.
  const solo = soloExtension(extension);
  const watching = solo ? null : spectatorField(config, track, trucks);
  const short = entrantsShortfall(extension, watching ?? (Array.isArray(config.opponents) ? config.opponents : []), !!watching);
  if (short !== null) {
    const t = context.t ?? createStrings();
    await showAlert(t, t("<<1>> needs <<2>> trucks at least. Pick computer opponents on the Races screen.", t(extension.name), short));
    return context.router.go("race-select", { mode: config.mode }, { replace: true });
  }
  // Spectator mode: the computer's trucks alone, watched. Not in free roam, which has no race to watch.
  const watched = watching;
  if (watched) {
    const ct = context.t ?? createStrings();
    // `context.confirm` stands in for the dialog where there is no DOM (tests).
    if (!await (context.confirm ?? showConfirm)(ct, ct(SPECTATOR_WARNING))) return undefined;
    return context.router.go("race", {
      track, mode: config.mode, laps: config.laps, difficulty: config.difficulty, opponents: watched.slice(1), weather: config.weather,
      gameMode, freeRoam: false, truck: watched[0], trucks, setup: undefined, spectator: true,
    });
  }
  // An extension uses `laps` as its declared length and never runs as free roam.
  return context.router.go("race", {
    track, mode: config.mode, laps: config.laps, difficulty: config.difficulty, opponents: solo ? opponentsFor(extension, config.opponents) : config.opponents,
    weather: config.weather, gameMode,
    // Free Roam (the Races screen's mode, or a track that has no checkpoints): the player alone, no race.
    freeRoam: !gameMode && (!!config.freeRoam || !!track.freeRoamOnly),
    truck: truck.file, trucks, setup: { ...driver.garage },
  });
}
