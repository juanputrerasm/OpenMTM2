/*
  Who races: the player's truck and the CPU trucks on the start grid (MONSTER_EXE_ANALYSIS.md
  section 9). Pure, so it runs under Node.

  The game's single-player setup (CRace::setupTrucks, 0x4198a0) makes the player driver 0 and
  adds a CPU driver for each catalogue truck flagged for it, other than the player's, at most
  eight drivers in all. Where that flag comes from is not traced yet, so the CPU trucks here are
  drawn at random from the rest of the catalogue, all different.
*/

/** The default CPU driver names (0x551f90). */
export const CPU_NAMES = Object.freeze(["Mark", "Greg", "Rich", "Brett", "Gaither", "Chuck", "Terry", "Joe"]);

/**
 * The race's entrants, the player first, one per grid slot (at most 8):
 * `[{ name, file, player }]`. `trucks` are catalogue trucks (`{ file, name, hidden }`).
 */
export function raceEntrants({ playerTruck, trucks, slots, playerName = "You", random = Math.random }) {
  const count = Math.min(8, slots);
  const pool = trucks.filter((t) => t.file !== playerTruck && !t.hidden).map((t) => t.file);
  // Fisher-Yates, then the first count - 1.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const entrants = [{ name: playerName, file: playerTruck, player: true }];
  for (let i = 0; entrants.length < count; i++) {
    // With fewer trucks than slots, trucks repeat.
    const file = pool.length ? pool[i % pool.length] : playerTruck;
    entrants.push({ name: CPU_NAMES[entrants.length - 1], file, player: false });
  }
  return entrants;
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
