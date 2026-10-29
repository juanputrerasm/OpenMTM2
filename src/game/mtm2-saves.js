/*
  The game's own drivers and Hall of Fame files to OpenMTM2's, and back (MONSTER_EXE_ANALYSIS.md 16; the formats are
  OpenPhotex's `parseMtmPlayerPro` and `parseMtmHighScores`). The port keeps both as JSON (game/profile.js,
  game/hall-of-fame.js); these turn one into the other with the catalogue's names. Pure, so it runs under Node.

  `player.pro`'s last four numbers are read as the Garage setup, tire cut, suspension and transfer, the order the race
  takes a driver's setup in; the analysis marks that a hypothesis. Its other fields have no counterpart here and are
  kept only when the port writes a driver the file had (`exportPlayerPro` takes them from `previous`).

  `MTM2 High Scores` keeps the track's and the truck's names, not their files: they are found in the catalogue by name.
  An entry whose track is not installed is left out.
*/
import { cleanGarage, cleanName, newDriver } from "./profile.js";
import { addEntry } from "./hall-of-fame.js";
import { newMtmDriver } from "../vendor/openphotex/mtm/player-pro.js";

const key = (s) => String(s ?? "").trim().toLowerCase();

/** A truck in the catalogue by its file (`BIGFOOT.TRK`, with or without the extension) or its name; null if none. */
export function findTruck(trucks, text) {
  const k = key(text);
  if (!k) return null;
  return trucks.find((t) => key(t.file) === k || key(t.file).replace(/\.trk$/, "") === k.replace(/\.trk$/, "") || key(t.name) === k) ?? null;
}

/** A track in the catalogue by its name or its file; null if none. */
export const findTrack = (tracks, text) => tracks.find((t) => key(t.name) === key(text) || key(t.file) === key(text)) ?? null;

/** The game's drivers as the port's: name, Garage setup and last truck. */
export function driversFromPlayerPro(pro, trucks = []) {
  return (pro?.drivers ?? []).filter((d) => cleanName(d.name)).map((d) => {
    const driver = newDriver(d.name);
    const [tireCut, suspension, transferSetting] = d.settings ?? [];
    driver.garage = cleanGarage({ ...driver.garage, tireCut, suspension, transferSetting });
    driver.lastTruck = findTruck(trucks, d.truck)?.file ?? null;
    return driver;
  });
}

/**
 * Add imported drivers to the profiles: a name the profiles have already keeps the port's driver. Returns
 * `{ added, kept }`, the names of each.
 */
export function mergeDrivers(profiles, drivers) {
  const added = [], kept = [];
  for (const d of drivers) {
    if (profiles.drivers.some((p) => key(p.name) === key(d.name))) { kept.push(d.name); continue; }
    profiles.drivers.push(d);
    added.push(d.name);
  }
  return { added, kept };
}

/** `MM/DD/YY` as `YYYY-MM-DD` (years from 90 in the 1900s), or today's date when it does not read. */
export function isoDate(date, today = new Date()) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(date ?? "").trim());
  if (!m) return today.toISOString().slice(0, 10);
  let year = Number(m[3]);
  if (year < 100) year += year >= 90 ? 1900 : 2000;
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
/** `YYYY-MM-DD` as the game's `MM/DD/YY`. */
export const gameDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : "01/01/98";
};

/**
 * Add the game's Hall of Fame to the port's, entry by entry, each as `addEntry` ranks it (a board keeps its best ten).
 * Returns `{ added, skipped }`: the entries that made a board, and the tracks not installed.
 */
export function mergeHighScores(hall, boards, catalog) {
  let added = 0;
  const skipped = new Set();
  for (const board of boards ?? []) {
    const track = findTrack(catalog.tracks ?? [], board.track);
    if (!track) { skipped.add(board.track); continue; }
    for (const e of board.entries) {
      const mode = e.summit ? "summit" : track.raceType === "rally" ? "rally" : track.raceType === "summit" ? "summit" : "circuit";
      const entry = {
        name: cleanName(e.driver) || "?", truck: findTruck(catalog.trucks ?? [], e.truck)?.file ?? e.truck, track: track.file, trackName: track.name,
        mode, difficulty: Math.max(0, Math.min(2, e.skill)), laps: mode === "summit" ? Math.round(e.time / 60) : 0,
        points: e.points, time: e.time, fastestLap: 0, date: isoDate(e.date),
      };
      const same = hall.entries.some((h) => h.track === entry.track && h.mode === entry.mode && h.name === entry.name && h.time === entry.time && h.points === entry.points);
      if (!same && addEntry(hall, entry)) added++;
    }
  }
  return { added, skipped: [...skipped] };
}

/** The port's Hall of Fame as the game's boards (`writeMtmHighScores`' input), by track name; tournaments are left out. */
export function highScoresFromHall(hall, catalog) {
  const boards = new Map();
  const truckName = (file) => findTruck(catalog.trucks ?? [], file)?.name ?? file;
  for (const e of hall.entries ?? []) {
    if (e.mode === "tournament") continue;
    const name = findTrack(catalog.tracks ?? [], e.track)?.name ?? e.trackName ?? e.track;
    if (!boards.has(name)) boards.set(name, []);
    boards.get(name).push({
      date: gameDate(e.date), driver: e.name, truck: truckName(e.truck), time: e.time, points: e.points,
      skill: e.difficulty ?? 0, summit: e.mode === "summit",
    });
  }
  return [...boards].map(([track, entries]) => ({ track, entries }));
}

/**
 * The port's drivers as the game's (`writeMtmPlayerPro`' input). A driver the file had before (`previous`, by name)
 * keeps the fields the port has no use for.
 */
export function playerProFromProfiles(profiles, catalog, previous = null) {
  const old = new Map((previous?.drivers ?? []).map((d) => [key(d.name), d]));
  const trackName = catalog.tracks?.[0]?.name ?? "";
  const drivers = profiles.drivers.map((d) => {
    const base = old.get(key(d.name)) ?? newMtmDriver(d.name, "", trackName);
    const truck = findTruck(catalog.trucks ?? [], d.lastTruck)?.file ?? base.truck ?? "";
    const g = cleanGarage(d.garage);
    return { ...base, name: d.name, truck, settings: [g.tireCut, g.suspension, g.transferSetting, base.settings?.[3] ?? 1] };
  });
  return { selected: (profiles.current ?? 0) + 1, drivers };
}
