/*
  The points a race gives (MONSTER_EXE_ANALYSIS.md 6.6, `0x4192c0`): a base for the place, 900, 700, 500, 400,
  300, 200, 150 and 100, and in a race of more than one lap 100 more for the one fastest lap (a tie gives none)
  and the winner's share of 100 over the laps (`floor(100 / laps)`). A single lap race has the base only.
*/
export const PLACE_POINTS = Object.freeze([900, 700, 500, 400, 300, 200, 150, 100]);

/** The points for each row, `rows[i] = { place, best, ... }` (`best` the fastest lap in seconds, 0 for none). Returns a list in row order. */
export function racePoints(rows, laps) {
  const times = rows.map((r) => (r.best > 0 ? r.best : Infinity));
  const fastest = Math.min(...times);
  const fastestCount = times.filter((t) => t === fastest).length;
  return rows.map((row, i) => {
    let points = PLACE_POINTS[row.place - 1] ?? 0;
    if (laps > 1) {
      if (Number.isFinite(fastest) && fastestCount === 1 && times[i] === fastest) points += 100;
      if (row.place === 1) points += Math.floor(100 / laps);
    }
    return points;
  });
}
