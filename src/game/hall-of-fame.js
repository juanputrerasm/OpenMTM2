/*
  The Hall of Fame: the best results per track and mode. The game's `highscor.mtr` (one line
  `%d,%s,%d,%s,%d,%f,%f`, MONSTER_EXE_ANALYSIS.md 6.6) is not fully traced, so this keeps JSON
  in OPFS (`userdata/hall.json`). Circuit and Rally entries rank by race time, lowest first;
  Summit Rumbles by points, highest first. Pure, so it runs under Node.
*/
export const ENTRIES_PER_TRACK = 10;

/**
 * @typedef {{ name: string, truck: string, track: string, trackName: string, mode: string,
 *   difficulty: number, laps: number, points: number, time: number, fastestLap: number,
 *   date: string }} HallEntry
 */

export function emptyHall() {
  return { version: 1, entries: [] };
}

export function normalizeHall(raw) {
  const entries = (Array.isArray(raw?.entries) ? raw.entries : []).filter((e) =>
    typeof e?.track === "string" && typeof e?.name === "string" && Number.isFinite(e.time) && Number.isFinite(e.points));
  return { version: 1, entries };
}

/** Whether `a` beats `b`: lower time in a race, more points in a Rumble. */
export function beats(a, b) {
  return a.mode === "summit" ? a.points > b.points : a.time < b.time;
}

/** The entries of one track and mode, best first. */
export function topFor(hall, track, mode) {
  return hall.entries
    .filter((e) => e.track === track && e.mode === mode)
    .sort((a, b) => (beats(a, b) ? -1 : beats(b, a) ? 1 : 0));
}

/**
 * Add a result. Returns its rank (1 is best) among the track's kept entries, or null when it
 * did not make the top ten (and is not stored).
 */
export function addEntry(hall, entry) {
  const board = [...topFor(hall, entry.track, entry.mode)];
  // A new result goes after any it only ties, so the earlier one keeps its place.
  let rank = board.findIndex((e) => beats(entry, e)) + 1;
  if (rank === 0) rank = board.length + 1;
  if (rank > ENTRIES_PER_TRACK) return null;
  board.splice(rank - 1, 0, entry);
  const kept = board.slice(0, ENTRIES_PER_TRACK);
  hall.entries = [...hall.entries.filter((e) => !(e.track === entry.track && e.mode === entry.mode)), ...kept];
  return rank;
}
