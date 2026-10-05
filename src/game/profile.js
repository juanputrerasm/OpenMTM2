/*
  Driver profiles: who is playing, with their Garage setup (MONSTER_EXE_ANALYSIS.md 8.5) and
  a tally of races. The game keeps a `player.pro`; its layout is not traced, so profiles are
  stored as JSON in OPFS (`userdata/profiles.json`). Pure, so it runs under Node.
*/
export const MAX_NAME_LENGTH = 16;
export const DEFAULT_GARAGE = Object.freeze({ suspension: 0, transferSetting: 1500, tireCut: 0 });

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
  };
}

export function newDriver(name) {
  return { name: cleanName(name) || "Player", garage: { ...DEFAULT_GARAGE }, lastTruck: null, races: 0, wins: 0 };
}

export function emptyProfiles() {
  return { version: 1, current: 0, drivers: [newDriver("Player")] };
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
  if (!clean) return "Enter a name.";
  if (indexOfName(profiles, clean) >= 0) return `There is already a driver called ${clean}.`;
  profiles.drivers.push(newDriver(clean));
  profiles.current = profiles.drivers.length - 1;
  return null;
}

/** Select an existing driver by name, or create and select a new one from the editable combo box. */
export function selectOrAddDriver(profiles, name) {
  const clean = cleanName(name);
  if (!clean) return "Enter a name.";
  const existing = indexOfName(profiles, clean);
  if (existing >= 0) {
    profiles.current = existing;
    return null;
  }
  return addDriver(profiles, clean);
}

export function renameDriver(profiles, index, name) {
  const clean = cleanName(name);
  if (!clean) return "Enter a name.";
  const other = indexOfName(profiles, clean);
  if (other >= 0 && other !== index) return `There is already a driver called ${clean}.`;
  profiles.drivers[index].name = clean;
  return null;
}

/** Remove a driver; the last one cannot be removed. */
export function removeDriver(profiles, index) {
  if (profiles.drivers.length < 2) return "At least one driver is needed.";
  profiles.drivers.splice(index, 1);
  profiles.current = Math.min(profiles.current > index ? profiles.current - 1 : profiles.current, profiles.drivers.length - 1);
  return null;
}

/** Count a finished race for a driver, a win when they placed first. */
export function recordRace(driver, place) {
  driver.races++;
  if (place === 1) driver.wins++;
}
