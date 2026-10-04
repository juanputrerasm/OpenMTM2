/*
  Who races and where they start (MONSTER_EXE_ANALYSIS.md section 9, "Who races" and "The
  grid"). Pure, so it runs under Node.

  The game flags `defaultOpponents` random catalogue trucks for the CPU, makes the player
  driver 0, adds a CPU driver for each flagged truck other than the player's (in catalogue
  order), and shuffles the first start slots among the drivers.
*/

/** The default CPU driver names (0x551f90). */
export const CPU_NAMES = Object.freeze(["Mark", "Greg", "Rich", "Brett", "Gaither", "Chuck", "Terry", "Joe"]);
/** The built-in `defaultOpponents` (MONSTER.INI). */
export const DEFAULT_OPPONENTS = 3;

/**
 * The race's entrants, the player first: `[{ name, file, player, slot }]`, `slot` the start-grid
 * slot. `trucks` are catalogue trucks (`{ file, hidden }`), `slots` the grid's size.
 */
export function raceEntrants({ playerTruck, trucks, slots, opponents = DEFAULT_OPPONENTS, playerName = "You", random = Math.random }) {
  const catalogue = trucks.filter((t) => !t.hidden);
  // The CPU flags: up to 5 * opponents draws, each flagging a truck not yet flagged.
  const flagged = new Set();
  for (let tries = opponents * 5; tries > 0 && flagged.size < opponents; tries--) {
    flagged.add(Math.min(catalogue.length - 1, Math.floor(random() * catalogue.length)));
  }
  const drivers = [{ name: playerName, file: playerTruck, player: true }];
  catalogue.forEach((t, i) => {
    if (flagged.has(i) && t.file !== playerTruck && drivers.length < Math.min(8, slots)) {
      drivers.push({ name: CPU_NAMES[drivers.length - 1], file: t.file, player: false });
    }
  });
  // The start slots, shuffled among the drivers.
  const order = drivers.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return drivers.map((d, i) => ({ ...d, slot: order[i] }));
}

/** A race time as the HUD prints it, `%02d:%05.2f` (minutes, seconds). */
export function formatRaceTime(seconds) {
  const s = Math.max(0, seconds);
  const minutes = Math.trunc(s / 60);
  return `${String(minutes).padStart(2, "0")}:${(s - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/** "1st", "2nd", ... as the standings list prints places. */
export function ordinal(place) {
  return ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"][place - 1] ?? `${place}th`;
}
