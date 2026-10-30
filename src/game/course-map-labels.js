/*
  What the course map writes beside each truck (MONSTER_EXE_ANALYSIS.md 11, course map). The Map key cycles
  off, place numbers, then the truck's name and place, as the game does; OpenMTM2 adds a fourth mode with the
  driver's name and place. In a Summit Rumble the numbers mode writes nothing and the name modes the name alone.
  The player's own truck is written in dark red (palette colour 1), the rest in light grey (colour 7).
*/
export const MAP_OFF = 0, MAP_PLACES = 1, MAP_TRUCKS = 2, MAP_DRIVERS = 3;
export const MAP_MODES = 4;

/** Dark red, the stock palettes' colour 1: the player's label. */
export const MAP_PLAYER_COLOR = "#800000";
/** Light grey, colour 7: everyone else's. */
export const MAP_OTHER_COLOR = "#c0c0c0";

export const nextMapMode = (mode) => (mapMode(mode) + 1) % MAP_MODES;

/** A stored setting as a mode: older versions kept true or false (true showed the numbers). */
export function mapMode(value) {
  if (value === true) return MAP_PLACES;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < MAP_MODES ? n : MAP_OFF;
}

/**
 * The label for one truck: `truck` and `driver` its names, `place` its place (null for a truck with none, a Race &
 * Rumble blocker), `summit` a Summit Rumble. An empty string writes nothing.
 */
export function mapLabel(mode, { truck = "", driver = "", place = null, summit = false } = {}) {
  const name = mode === MAP_TRUCKS ? truck : mode === MAP_DRIVERS ? driver || truck : "";
  const placed = !summit && place !== null && place !== undefined;
  if (mode === MAP_PLACES) return placed ? String(place) : "";
  if (mode === MAP_TRUCKS || mode === MAP_DRIVERS) return name ? (placed ? `${name} (${place})` : name) : placed ? String(place) : "";
  return "";
}

/** The label's colour: only the player's own truck is dark red, whichever truck the map follows. */
export const mapLabelColor = (index, player) => (index === player ? MAP_PLAYER_COLOR : MAP_OTHER_COLOR);
