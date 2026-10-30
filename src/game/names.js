/*
  The Names key (N) cycles what is written above each truck in the world: nothing, the trucks' names, the drivers'
  names, then both (the driver, and under it the truck). The course map has its own modes, on the Map key
  (game/course-map-labels.js).
*/
export const NAMES_OFF = 0, NAMES_TRUCKS = 1, NAMES_DRIVERS = 2, NAMES_BOTH = 3;

export const nextNamesMode = (mode) => (mode + 1) % 4;

/**
 * The label for an entrant in `mode`: `{ file, name }` per entrant, `truckName(file)` the catalog's name. A string, or
 * for both names `[driver, truck]`, two lines; null for none.
 */
export function nameLabel(mode, entrant, truckName) {
  if (!entrant) return null;
  if (mode === NAMES_TRUCKS) return truckName(entrant.file);
  if (mode === NAMES_DRIVERS) return entrant.name || null;
  if (mode === NAMES_BOTH) return entrant.name ? [entrant.name, truckName(entrant.file)] : truckName(entrant.file);
  return null;
}

/** A label as one line, for where there is room for one (the course map): the first of two. */
export const nameLine = (label) => (Array.isArray(label) ? label[0] : label);
