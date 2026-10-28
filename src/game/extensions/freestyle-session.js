/*
  Freestyle's runtime in the simulation worker (docs/EXTENSIONS.md; the judge is freestyle.js). One truck, the player's,
  judged every step from its own state: wheels down, its axes, its turn rates, its gear, the objects it met and the
  helicopter. The clock runs from the end of the countdown; when it runs out the run is over. A run left early (the
  pause menu) is judged on the time it used.
*/
import * as S from "../../vendor/openphotex/sim/mtm2/index.js";
import { createFreestyle, freestyleEnd, freestyleScore, freestyleStep } from "./freestyle.js";

/** What the judge needs from a truck this step (freestyle.js `freestyleStep`); `hit` is the object met, if any. */
export function freestyleSample(truck, hit) {
  const s = truck.state, m = s.matrix;
  return {
    pos: s.pos, up: m[4], forwardY: m[5], rightY: m[3],
    speed: Math.hypot(s.bvel[0], s.bvel[1], s.bvel[2]), forward: s.bvel[2], rates: s.rates,
    wheels: s.tires.map((tire) => !!tire.onGround),
    reverse: s.controls.gear === S.GEAR.REVERSE,
    heli: s.heliTimer > 0 || !!truck.flight,
    hit,
  };
}

export function createFreestyleRuntime(payload, env) {
  const { trucks, race, step } = env;
  race.roundSeconds = Math.max(1, Number(payload.minutes) || 2) * 60;
  const game = createFreestyle(race.roundSeconds);
  const sinceStart = () => race.clock - race.startTime;
  // The worker keeps the hardest object contact of a reply in `snd.hit` (sim-worker.js `noteObjectHit`): a new record is
  // a new contact.
  let seenHit = null;
  const end = () => {
    freestyleEnd(game, sinceStart());
    race.over = true;
    for (const truck of race.trucks) truck.finished = true;
  };
  return {
    id: payload.mode,
    debug: { game },
    held: () => false,
    drive: () => false,
    tick() {
      if (game.done) return;
      const truck = trucks[0];
      const record = truck.snd.hit;
      const hit = record && record !== seenHit ? { id: record.sitIndex, force: record.force } : null;
      seenHit = record;
      freestyleStep(game, step, freestyleSample(truck, hit));
      race.trucks[0].place = 1;
      if (sinceStart() >= race.roundSeconds) end();
    },
    view(since) {
      const score = freestyleScore(game);
      return {
        mode: payload.mode, left: Math.max(0, race.roundSeconds - Math.max(0, since)), done: game.done,
        score: score.total, categories: score.categories, deductions: score.deductions,
        moments: game.moments.slice(-4), events: game.events,
      };
    },
    score: (index) => (index === 0 ? freestyleScore(game).total : 0),
    finish: end,
  };
}
