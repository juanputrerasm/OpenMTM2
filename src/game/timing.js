/*
  The race HUD's Lead and Back gap (MONSTER_EXE_ANALYSIS.md 11, HUD routine 0x52d8f0).

  In first place the row reads "Lead:" and compares the player with the truck in second; in any
  other place it reads "Back:" and compares the player with the truck one place ahead. The gap
  is the two trucks' elapsed times at the rear truck's last checkpoint (the game sums the
  segment times of the laps behind it and of the current lap up to that checkpoint), shown
  without a sign as `%02d:%05.2f`.
*/

/** One truck's crossing log: `log[k]` is the race time at which it passed its (k + 1)th checkpoint. */
export function createCrossingLog(count) {
  return Array.from({ length: count }, () => []);
}

/**
 * Append the crossings made since the last look. `raceTrucks` are the race's trucks (`passed`
 * checkpoints in all, `raceTime` of the closed laps, `splits` of the open one).
 */
export function recordCrossings(logs, raceTrucks) {
  raceTrucks.forEach((rt, i) => {
    const log = logs[i];
    if (log.length >= rt.passed) return;
    const now = rt.raceTime + rt.splits.reduce((a, x) => a + x, 0);
    while (log.length < rt.passed) log.push(now);
  });
}

/**
 * The gap shown for `me`: `{ kind: "lead" | "back", seconds }`, or null when there is no one to
 * compare with. `trucks` carry `place` and `passed`; `logs` are the crossing logs.
 */
export function raceGap(trucks, logs, me = 0) {
  const mine = trucks[me];
  if (!mine) return null;
  const lead = mine.place === 1;
  const other = trucks.findIndex((t) => t.place === (lead ? 2 : mine.place - 1));
  if (other < 0) return null;
  const [ahead, behind] = lead ? [me, other] : [other, me];
  const n = trucks[behind].passed;
  const a = logs[ahead][n - 1], b = logs[behind][n - 1];
  if (n < 1 || a === undefined || b === undefined) return { kind: lead ? "lead" : "back", seconds: 0 };
  return { kind: lead ? "lead" : "back", seconds: Math.abs(b - a) };
}
