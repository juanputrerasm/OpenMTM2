/*
  Driver profiles: who is playing, with their Garage setup (MONSTER_EXE_ANALYSIS.md 8.5) and
  a tally of races. The game keeps a `player.pro`; its layout is not traced, so profiles are
  stored as JSON in OPFS (`userdata/profiles.json`). Pure, so it runs under Node.
*/
import { msg } from "./strings.js";
import { cleanCprSetup } from "./cpr-garage.js";

export const MAX_NAME_LENGTH = 16;
/**
 * A 4x4 Evolution vehicle's Garage (EVO2_PHYSICS.md 2.2): the tread (0 Shallow to 3 Studded) and the game's sliders,
 * each 0..1 as the game's setters take them. `springs` and `torqueSplit` null keep the vehicle's own springs and split;
 * the axle ratio, brake balance and handling start at the game's defaults, 0.5.
 */
export const DEFAULT_EVO_GARAGE = Object.freeze({ tread: 1, springs: null, axleRatio: 0.5, brakeBalance: 0.5, torqueSplit: null, handling: 0.5 });
/** A new driver's Garage: Medium suspension and a Medium tire cut (MTM2's own start is Soft and Shallow). */
/** `cpr`: a CART Precision Racing car's setup (game/cpr-garage.js), null for the stock one. */
export const DEFAULT_GARAGE = Object.freeze({ suspension: 1, transferSetting: 1500, tireCut: 1, evo: DEFAULT_EVO_GARAGE, cpr: null });

/** An Evo Garage with out-of-range values brought back in. */
export function cleanEvoGarage(evo) {
  const unit = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, Math.round(v * 100) / 100)) : fallback);
  const tread = Number(evo?.tread);
  return {
    tread: Number.isInteger(tread) && tread >= 0 && tread <= 3 ? tread : DEFAULT_EVO_GARAGE.tread,
    springs: unit(evo?.springs, null),
    axleRatio: unit(evo?.axleRatio, DEFAULT_EVO_GARAGE.axleRatio),
    brakeBalance: unit(evo?.brakeBalance, DEFAULT_EVO_GARAGE.brakeBalance),
    torqueSplit: unit(evo?.torqueSplit, null),
    handling: unit(evo?.handling, DEFAULT_EVO_GARAGE.handling),
  };
}

/** A name trimmed to the limit, or "" when nothing is left. */
export function cleanName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/** The Garage setup with out-of-range values brought back in: slider 600 to 2000 in steps of 100. */
export function cleanGarage(garage) {
  const pick = (v, fallback) => (Number.isInteger(v) && v >= 0 && v <= 2 ? v : fallback);
  const transfer = Number(garage?.transferSetting);
  return {
    suspension: pick(garage?.suspension, DEFAULT_GARAGE.suspension),
    tireCut: pick(garage?.tireCut, DEFAULT_GARAGE.tireCut),
    transferSetting: Number.isFinite(transfer) && transfer >= 600 && transfer <= 2000
      ? Math.round(transfer / 100) * 100 : DEFAULT_GARAGE.transferSetting,
    evo: cleanEvoGarage(garage?.evo),
    cpr: cleanCprSetup(garage?.cpr),
  };
}

/** The name a new driver takes, as MTM2's Driver Check-in offers it. */
export const DEFAULT_DRIVER_NAME = "DriverX";

export function newDriver(name) {
  return { name: cleanName(name) || DEFAULT_DRIVER_NAME, garage: { ...DEFAULT_GARAGE, evo: { ...DEFAULT_EVO_GARAGE } }, lastTruck: null, races: 0, wins: 0 };
}

export function emptyProfiles() {
  return { version: 1, current: 0, drivers: [newDriver(DEFAULT_DRIVER_NAME)] };
}

/** Stored data brought into shape; anything unusable becomes the default profile. */
export function normalizeProfiles(raw) {
  const drivers = (Array.isArray(raw?.drivers) ? raw.drivers : [])
    .filter((d) => cleanName(d?.name))
    .map((d) => ({
      name: cleanName(d.name), garage: cleanGarage(d.garage), lastTruck: typeof d.lastTruck === "string" ? d.lastTruck : null,
      races: Math.max(0, Math.trunc(d.races) || 0), wins: Math.max(0, Math.trunc(d.wins) || 0),
    }));
  if (!drivers.length) return emptyProfiles();
  const current = Number.isInteger(raw.current) && raw.current >= 0 && raw.current < drivers.length ? raw.current : 0;
  return { version: 1, current, drivers };
}

export const currentDriver = (profiles) => profiles.drivers[profiles.current];

const indexOfName = (profiles, name) => profiles.drivers.findIndex((d) => d.name.toLowerCase() === name.toLowerCase());

/** Add a driver and make them current. Returns an error message, or null. */
export function addDriver(profiles, name) {
  const clean = cleanName(name);
  if (!clean) return msg("Enter a name.");
  if (indexOfName(profiles, clean) >= 0) return `There is already a driver called ${clean}.`;
  profiles.drivers.push(newDriver(clean));
  profiles.current = profiles.drivers.length - 1;
  return null;
}

/** Select an existing driver by name, or create and select a new one from the editable combo box. */
export function selectOrAddDriver(profiles, name) {
  const clean = cleanName(name);
  if (!clean) return msg("Enter a name.");
  const existing = indexOfName(profiles, clean);
  if (existing >= 0) {
    profiles.current = existing;
    return null;
  }
  return addDriver(profiles, clean);
}

export function renameDriver(profiles, index, name) {
  const clean = cleanName(name);
  if (!clean) return msg("Enter a name.");
  const other = indexOfName(profiles, clean);
  if (other >= 0 && other !== index) return `There is already a driver called ${clean}.`;
  profiles.drivers[index].name = clean;
  return null;
}

/** Remove a driver; the last one cannot be removed. */
export function removeDriver(profiles, index) {
  if (profiles.drivers.length < 2) return msg("At least one driver is needed.");
  profiles.drivers.splice(index, 1);
  profiles.current = Math.min(profiles.current > index ? profiles.current - 1 : profiles.current, profiles.drivers.length - 1);
  return null;
}

/** Count a finished race for a driver, a win when they placed first. */
export function recordRace(driver, place) {
  driver.races++;
  if (place === 1) driver.wins++;
}
