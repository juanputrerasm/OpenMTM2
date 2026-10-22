/*
  The race setup board of the headset (docs/VR.md, "Between races"), joined to the app: the
  catalogue, what the Races screen chose last, the driver's truck, and starting the race. The
  board itself is game/vr/lobby.js.
*/
import { goRace, setRaceConfig } from "./flow.js";
import { currentDriver, getProfiles, saveProfiles } from "./profile-store.js";
import { saveSettings } from "./settings.js";
import { createLobby } from "../game/vr/lobby.js";
import { createMenu } from "../game/vr/menu.js";

/**
 * The board for the game as it is now installed and set up, or null when there is nothing to
 * race (no install). Rejects when the catalogue cannot be read.
 * @param {object} context the app's context
 */
export async function lobbyMenu(context) {
  const { settings } = context;
  const catalog = await context.assets.call("catalog");
  // There is an install: the boards can have the game's own lettering.
  gameFonts(context).catch(() => {});
  const driver = currentDriver(await getProfiles(context));
  const stored = Array.isArray(settings.opponentTrucks) && settings.opponentTrucks.length ? settings.opponentTrucks : settings.opponents;
  return createLobby({
    tracks: catalog.tracks.filter((track) => settings.showHiddenTracks || !track.hidden),
    trucks: catalog.trucks.filter((truck) => settings.showHiddenTrucks || !truck.hidden),
    choices: { track: context.raceConfig?.track ?? settings.lastTrack, truck: driver.lastTruck, opponents: stored, weather: settings.weather },
    translate: context.t,
    onStart({ track, truck, laps, opponents, weather }) {
      // Stored as the Races and Driver Check-in screens store them.
      Object.assign(settings, { lastTrack: track.file, weather, opponentTrucks: [...opponents], opponents: opponents.length });
      saveSettings(settings);
      driver.lastTruck = truck.file;
      saveProfiles(context);
      setRaceConfig(context, { mode: track.raceType, track: track.file, laps, difficulty: settings.difficulty, opponents: [...opponents], weather });
      raceFromBoard(context);
    },
    onLeave: () => context.xr.exit(),
  });
}

/**
 * Start the chosen race from a board in the headset. A race that cannot be loaded must not leave
 * the player before a board that says "Loading" for ever, with the flat screens out of sight: the
 * headset then says what went wrong, and the flat screens go back to Start.
 */
export function raceFromBoard(context) {
  return goRace(context).catch((error) => {
    console.error("The race did not start:", error);
    const toLobby = () => context.xr.setBoard(null);
    const { t } = context;
    context.xr.setBoard(createMenu({
      title: t("The race did not start"),
      lines: [String(error?.message ?? error).slice(0, 70)],
      items: [{ label: t("Back"), action: toLobby }, { label: t("Leave VR"), action: () => context.xr.exit() }],
      back: toLobby,
    }));
    return context.router.go("start", {}, { replace: true }).catch(() => {});
  });
}

/**
 * The game's fonts for the headset's boards (the race screen sets the same two). They are asked
 * for only once there is an install to read them from: a font asked for earlier stays missing.
 */
async function gameFonts(context) {
  const [host, { loadFont }] = await Promise.all([context.xr.host(), import("../render/bitmap-text.js")]);
  const [text, title] = await Promise.all([loadFont(context.assets, "FNT1_480"), loadFont(context.assets, "FNT2_480")]);
  if (title || text) host.menu.setFonts(title, text);
}
