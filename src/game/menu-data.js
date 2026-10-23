/*
  Pure labels and stock UI artwork names used by the classic menu screens. Add-on tracks may
  omit a preview, in which case the Races screen shows the track's facts in the preview opening.
*/
import { WEATHER_NAMES, allowedWeathers } from "./weather.js";
import { msg } from "./strings.js";

export const RACE_TYPE_NAMES = Object.freeze({
  circuit: msg("Circuit Race"),
  rally: msg("Rally Race"),
  summit: msg("Summit Rumble"),
  drag: msg("Drag Race"),
  freeroam: msg("Free Roam"),
  unsupported: msg("Unsupported"),
});

export function raceTypeName(type) {
  return RACE_TYPE_NAMES[type] ?? RACE_TYPE_NAMES.unsupported;
}

/** Each game a track can come from, in full, by the catalog's `game`. */
export const TRACK_GAME_NAMES = Object.freeze({
  MTM2: "Monster Truck Madness 2", MTM1: "Monster Truck Madness", CPR: "CART Precision Racing",
  EVO1: "4x4 Evolution", EVO2: "4x4 Evolution 2", TV: "Terminal Velocity / Fury3", HB: "Hellbender",
});

/**
 * What the Races screen shows of a track that has no preview picture: what its SIT (or level) says of it, as
 * [label, value] rows, the ones it does not say left out. `type` is the type as the track list shows it. The labels
 * are tags for the caller to translate; `t` translates the values that are words (Yes, the weathers).
 */
export function trackInfoRows(track, { type = raceTypeName(track?.raceType), units = "mph", t = (text) => text } = {}) {
  if (!track) return [];
  const rows = [[msg("Type"), type], [msg("Game"), TRACK_GAME_NAMES[track.game] ?? track.game], [msg("Location"), (track.locale ?? "").trim()], [msg("Author"), track.author]];
  if (track.trackLength > 0) {
    const miles = track.trackLength / 5280;
    rows.push([msg("Length"), `${Math.round(track.trackLength).toLocaleString("en-US")} ft (${units === "kph" ? `${(miles * 1.609344).toFixed(2)} km` : `${miles.toFixed(2)} mi`})`]);
  }
  if (track.checkpoints > 0) rows.push([msg("Checkpoints"), String(track.checkpoints)]);
  if (track.raceType === "circuit" && !track.freeRoamOnly && track.defaultLaps > 0) rows.push([msg("Laps"), String(track.defaultLaps)]);
  if (track.dragParTime > 0) rows.push([msg("Par time"), `${track.dragParTime.toFixed(2)} s`]);
  if (track.sonic) rows.push([msg("Sonic"), t("Yes")]);
  if (Number.isInteger(track.weatherMask)) rows.push([msg("Weather"), allowedWeathers(track.weatherMask).map((w) => t(WEATHER_NAMES[w])).join(", ")]);
  rows.push([msg("Level"), track.level], [msg("File"), track.pod ? `${track.file} (${track.pod})` : track.file]);
  return rows.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
}

/** The Races screen's core modes. Optional modes are supplied by the extension loader. */
export const GAME_MODES = Object.freeze([
  Object.freeze({ id: "default", name: msg("Default") }),
  Object.freeze({ id: "freeroam", name: msg("Free Roam") }),
  Object.freeze({ id: "flyby", name: msg("Fly-by") }),
]);

/** What the core length box counts: a Rumble's minutes or a race's laps. */
export function raceLengthLabel(type) {
  return type === "summit" ? msg("Minutes") : msg("Laps");
}

/**
 * A track's preview picture: the `UI\\<name>.BMP` its SIT names after "Track Logo .BMP file" (the catalog's `logoBmp`),
 * or null when it names none. Nothing is guessed from the track's file name: the SIT is what says it. (The SIT's
 * "Track Map .BMP file" is the small icon in MTM2, and in MTM1 the zoom map.)
 */
export function trackPreviewBmp(track) {
  return track?.logoBmp || null;
}

/** The 4x4 Evolution tire cuts (EVO2_PHYSICS.md 11; the game's Tire Type). */
export const EVO_TREADS = Object.freeze([msg("Shallow"), msg("Medium"), msg("Deep"), msg("Studded")]);

/**
 * The 4x4 Evolution Garage's sliders (EVO2_PHYSICS.md 2.2), in the game's order, each 0..1: the words at its two ends,
 * and `show(value, t)` its reading as the game's garage shows it. `stock` sliders read the vehicle's own figure at null.
 */
export const EVO_GARAGE_SLIDERS = Object.freeze([
  Object.freeze({ key: "springs", label: msg("Suspension"), ends: [msg("Stiff"), msg("Soft")], stock: true,
    help: msg("How stiff the springs and dampers are. Soft rides over bumps and keeps the tires down; stiff answers the steering sooner."),
    show: (v, t) => (v === null ? t("Stock") : String(Math.round(v * 100))) }),
  Object.freeze({ key: "axleRatio", label: msg("Axle Ratio"), ends: [msg("Acceleration"), msg("Top speed")], stock: false,
    help: msg("The final drive. Left for acceleration on tight, twisty tracks; right for top speed on fast ones."),
    show: (v) => `x${((1 - v) * 1.5 + 0.25).toFixed(2)}` }),
  Object.freeze({ key: "brakeBalance", label: msg("Brake Balance"), ends: [msg("Front"), msg("Rear")], stock: false,
    help: msg("More front braking is stable but hard to turn while braking; more rear braking turns easily but is unstable."),
    show: (v) => `F${Math.round((1 - v) * 100)}/${Math.round(v * 100)}R` }),
  Object.freeze({ key: "torqueSplit", label: msg("Torque Split"), ends: [msg("Front"), msg("Rear")], stock: true,
    help: msg("How the engine's torque is shared between the axles in four-wheel drive. Front helps steering; rear accelerates harder but spins sooner."),
    show: (v, t) => (v === null ? t("Stock") : `F${Math.round((1 - v) * 100)}/${Math.round(v * 100)}R`) }),
  Object.freeze({ key: "handling", label: msg("Handling Balance"), ends: [msg("Understeer"), msg("Oversteer")], stock: false,
    help: msg("Toward understeer the vehicle is easy to control but hard to turn; toward oversteer it turns quickly but can get sideways."),
    show: (v) => String(Math.round(v * 100)) }),
]);

export function garageSummary(setup) {
  const tire = ["s", "m", "d"][setup?.tireCut] ?? "s";
  const suspension = ["s", "m", "h"][setup?.suspension] ?? "s";
  return `${setup?.transferSetting ?? 1500} ${tire}/${suspension}`;
}
