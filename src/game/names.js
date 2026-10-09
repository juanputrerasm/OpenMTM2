/*
  The Names key (N) cycles what is written beside the trucks, on the course map and above each truck in
  the world: nothing, the trucks' names, the drivers' names. A port addition for the world labels; the
  course map's driver names are the game's.
*/
export const NAMES_OFF = 0, NAMES_TRUCKS = 1, NAMES_DRIVERS = 2;

export const nextNamesMode = (mode) => (mode + 1) % 3;

/** The label for entrant `i` in `mode`: `{ file, name }` per entrant, `truckName(file)` the catalog's name. */
export function nameLabel(mode, entrant, truckName) {
  if (!entrant) return null;
  if (mode === NAMES_TRUCKS) return truckName(entrant.file);
  if (mode === NAMES_DRIVERS) return entrant.name || null;
  return null;
}
