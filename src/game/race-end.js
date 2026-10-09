/*
  How a race ends (MONSTER_EXE_ANALYSIS.md 5, "End of race"; 0x52ee50 on each lap, 0x52fb40 in
  the race loop). Finishing does not stop the race:

  - The first truck to complete the race's laps ends it for the others, who only have to finish
    the lap they are on (`finishLap`). The simulation goes on at full speed.
  - When the player finishes, its truck drives on by autopilot and the camera becomes the RaceCam
    on it. When another truck finishes after that, the camera moves to the best-placed truck
    still racing.
  - When every truck has finished, a cooldown of 5 seconds (0x50000) runs, the race still
    going, and then the results come. (A player who quits early with Escape gets the remaining
    trucks fast-simulated instead.)
  - A Summit Rumble ends with its round timer, with no cooldown.

  The port adds one guard the game does not have: a CPU truck that is stuck must not keep the
  results from coming, so after the player has finished it waits at most `WAIT_LIMIT_SECONDS` (10 s); the trucks still racing are then run on fast for their times.
*/

export const END_COOLDOWN_SECONDS = 5;
export const WAIT_LIMIT_SECONDS = 10;

/**
 * `update(race)` takes the race view (`clock`, `trucks[]` with `finished` and `place`) and returns
 * `{ done, playerFinished, justFinished, target }`: `done` when the results should come, `justFinished`
 * the one tick the player finishes (the camera goes to the RaceCam), `target` the truck the camera
 * follows (0 until the player has finished).
 */
export function createRaceEnd({ summit = false } = {}) {
  let playerAt = null, allAt = null, target = 0;
  const finished = new Set();
  return {
    get target() { return target; },
    update(race) {
      const trucks = race?.trucks ?? [];
      const me = trucks[0];
      if (!me) return { done: false, playerFinished: false, justFinished: false, target };
      if (summit) return { done: !!me.finished, playerFinished: !!me.finished, justFinished: false, target };
      let justFinished = false, other = false;
      trucks.forEach((t, i) => {
        if (t.finished && !finished.has(i)) { finished.add(i); if (i === 0) justFinished = true; else other = true; }
      });
      if (justFinished) playerAt = race.clock;
      if (playerAt === null) return { done: false, playerFinished: false, justFinished: false, target: 0 };
      // After the player finishes the camera follows the best-placed truck still racing, when another truck finishes.
      if (justFinished) target = 0;
      else if (other) {
        const racing = trucks.map((t, i) => ({ t, i })).filter(({ t }) => !t.finished).sort((a, b) => a.t.place - b.t.place);
        if (racing.length) target = racing[0].i;
      }
      if (allAt === null && trucks.every((t) => t.finished)) allAt = race.clock;
      const done = (allAt !== null && race.clock - allAt >= END_COOLDOWN_SECONDS) || race.clock - playerAt >= WAIT_LIMIT_SECONDS;
      return { done, playerFinished: true, justFinished, target };
    },
  };
}
