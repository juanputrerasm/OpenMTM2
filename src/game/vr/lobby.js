/*
  Setting up a race in the headset (docs/VR.md, "Between races"): the Races screen's choices on
  one board, so a race can be picked and started without taking the headset off. Pure: it is
  given the catalogue, what was chosen last and what to do when the player starts; app/vr-lobby.js
  joins it to the app.

  The choices are the Races screen's own (ui/screens/race-select.js) and are stored the same way,
  so either picks up where the other left off.
*/
import { RACE_TYPE_NAMES, raceLengthLabel } from "../menu-data.js";
import { WEATHER_NAMES, allowedWeathers } from "../weather.js";
import { createMenu, cycle } from "./menu.js";

/** The races the port runs. */
export const LOBBY_RACE_TYPES = Object.freeze(["circuit", "rally", "summit"]);
/** A field is at most eight trucks, the player's among them. */
export const MAX_OPPONENTS = 7;
const MAX_LENGTH = 99;

const clampInt = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.trunc(Number(v)))) : fallback);

/**
 * `count` opponents for a player in `playerTruck`: the stored ones first, as far as they go and
 * as far as they are still in the catalogue, then the catalogue's own order.
 */
export function opponentFiles(trucks, playerTruck, stored, count) {
  const available = trucks.map((t) => t.file).filter((file) => file !== playerTruck);
  const picked = [];
  for (const file of [...(Array.isArray(stored) ? stored : []), ...available]) {
    if (picked.length >= count) break;
    if (available.includes(file) && !picked.includes(file)) picked.push(file);
  }
  return picked;
}

/**
 * @param {{
 *   tracks: { file: string, name: string, raceType: string, defaultLaps: number, weatherMask?: number }[],
 *   trucks: { file: string, name: string }[],
 *   choices?: { track?: string, truck?: string, opponents?: string[] | number, weather?: number | "random" },
 *   onStart: (chosen: { track: object, truck: object, laps: number, opponents: string[], weather: number | "random" }) => void,
 *   onLeave?: () => void, translate?: (text: string) => string,
 * }} setup `tracks` and `trucks` are the catalogue's, already without the hidden ones; `choices` what was chosen last
 * @returns the menu (menu.js), or null when there is nothing to race on or in
 */
export function createLobby({ tracks, trucks, choices = {}, onStart, onLeave, translate = (text) => text }) {
  const raceable = tracks.filter((t) => LOBBY_RACE_TYPES.includes(t.raceType));
  if (!raceable.length || !trucks.length) return null;
  let track = raceable.find((t) => t.file === choices.track) ?? raceable[0];
  let truck = trucks.find((t) => t.file === choices.truck) ?? trucks[0];
  let laps = track.defaultLaps;
  const most = Math.min(MAX_OPPONENTS, trucks.length - 1);
  let opponents = clampInt(Array.isArray(choices.opponents) ? choices.opponents.length : choices.opponents, 0, most, Math.min(3, most));
  let weather = choices.weather === "random" ? "random" : clampInt(choices.weather, 0, WEATHER_NAMES.length - 1, 0);

  /** What the weather item steps through: the weathers the track allows, and a draw among them when there are several. */
  const weathers = () => {
    const allowed = allowedWeathers(track.weatherMask);
    return allowed.length > 1 ? [...allowed, "random"] : allowed;
  };
  /** The stored weather, as far as this track allows it. */
  const fitWeather = () => { if (!weathers().includes(weather)) weather = weathers()[0]; };
  fitWeather();
  const lines = [translate(RACE_TYPE_NAMES[track.raceType])];

  return createMenu({
    title: translate("Race"),
    lines,
    items: [
      {
        label: translate("Track"), value: () => track.name,
        change(direction) {
          track = cycle(raceable, track, direction);
          // As on the Races screen: a track brings its own length, and only the weather it allows.
          laps = track.defaultLaps;
          lines[0] = translate(RACE_TYPE_NAMES[track.raceType]);
          fitWeather();
        },
      },
      {
        get label() { return translate(raceLengthLabel(track.raceType)); },
        value: () => laps,
        change(direction) { laps = clampInt(laps + direction, 1, MAX_LENGTH, track.defaultLaps); },
      },
      { label: translate("Truck"), value: () => truck.name, change(direction) { truck = cycle(trucks, truck, direction); } },
      { label: translate("Opponents"), value: () => opponents, change(direction) { opponents = clampInt(opponents + direction, 0, most, opponents); }, disabled: most === 0 },
      {
        label: translate("Weather"), value: () => (weather === "random" ? translate("Random") : translate(WEATHER_NAMES[weather])),
        change(direction) { weather = cycle(weathers(), weather, direction); },
      },
      {
        label: translate("Start race"),
        action: () => onStart({ track, truck, laps, opponents: opponentFiles(trucks, truck.file, choices.opponents, opponents), weather }),
      },
      ...(onLeave ? [{ label: translate("Leave VR"), action: onLeave }] : []),
    ],
    back: onLeave,
  });
}
