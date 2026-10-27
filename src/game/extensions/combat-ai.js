/*
  Combat's computer drivers (docs/EXTENSIONS.md): they race the course (the course's autopilot), and break off to ram a
  truck ahead of them when it pays: when they are in good shape, the target is near and ahead,
  and the dice of their aggression allow it; never off the grid, in the race's first seconds. The weakest truck is the favourite target, then the leader. A ram is
  aimed where the target will be, at its rear corner (the wheels and the gearbox), and broken off after `RAM_S`
  or when the target is behind. They repair when they have lost a wheel or are hurt and the credits allow it.
  Pure, so it runs under Node.
*/

import { REPAIR } from "./combat.js";

/**
 * The figures:
 * - `reachFt`, `coneRad`: a target must be within this distance, and this far off the nose;
 * - `courseFt`: and no further than this from the course's line, nor the attacker;
 * - `fitHp`, `fitEngine`: an attacker's least share of its hit points and of its engine;
 * - `ramS`, `restS`: the longest ram, and the pause after one before the next; `startS` none in the race's first seconds
 *   (the pack off the grid);
 * - `chance`: the odds per second of starting a ram on a fit target, by aggression;
 * - `speedFtS`: how fast a ram is driven; `rearFt`: how far behind the target's middle it is aimed.
 */
export const COMBAT_AI = Object.freeze({
  reachFt: 220, coneRad: 0.9, fitHp: 0.4, fitEngine: 0.3, ramS: 4, restS: 10, startS: 15,
  chance: Object.freeze({ low: 0.04, normal: 0.12, high: 0.35 }), speedFtS: 110, rearFt: 5,
});
/** A computer truck repairs with a wheel gone, or under these shares of its hit points or its engine. */
export const REPAIR_AT = Object.freeze({ hp: 0.35, engine: 0.3 });

const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};

/** A driver's memory. */
export function createCombatDriver() {
  return { target: -1, until: 0, restUntil: 0 };
}

/**
 * Whether truck `me` starts a ram now, and on whom: `self` is `{ pos, heading, hp, engine }`, `others` the trucks
 * `{ index, pos, hp, wheels, place, running, onLine }` (`onLine`: on the attacker's stretch of the course or the next, so a
 * ram keeps to the racing line), `roll` a random number in [0, 1) for this step. Returns
 * the target's index or -1.
 */
export function pickTarget(self, others, { aggression = "normal", dt, roll, T = COMBAT_AI } = {}) {
  if (self.hp < T.fitHp || self.engine < T.fitEngine) return -1;
  let best = -1, bestScore = -Infinity;
  for (const o of others) {
    if (!o.running || o.onLine === false) continue;
    const dx = o.pos[0] - self.pos[0], dz = o.pos[2] - self.pos[2];
    const d = Math.hypot(dx, dz);
    if (d > T.reachFt || d < 8) continue;
    if (Math.abs(wrapPi(Math.atan2(dx, dz) - self.heading)) > T.coneRad) continue;
    // The weakest first (fewest wheels, fewest hit points), then the leader; nearer is better.
    const score = (4 - o.wheels) * 2 + (1 - o.hp) * 3 + (o.place === 1 ? 1 : 0) - d / T.reachFt;
    if (score > bestScore) { bestScore = score; best = o.index; }
  }
  if (best < 0) return -1;
  const chance = (T.chance[aggression] ?? T.chance.normal) * dt;
  return roll < chance ? best : -1;
}

/** Where a ram is aimed: where the target will be, behind its middle (its rear corner). `target` is `{ pos, vel, heading }`. */
export function ramPoint(pos, target, T = COMBAT_AI) {
  const d = Math.hypot(target.pos[0] - pos[0], target.pos[2] - pos[2]);
  const lead = Math.min(1.5, d / T.speedFtS);
  const back = d > 30 ? T.rearFt : 0;
  return [
    target.pos[0] + target.vel[0] * lead - Math.sin(target.heading) * back,
    target.pos[1],
    target.pos[2] + target.vel[2] * lead - Math.cos(target.heading) * back,
  ];
}

/**
 * One step of a driver's ram: starts one (`pickTarget`) or keeps it while the target is ahead, within reach and the
 * time lasts. Returns the target's index, or -1 to race on.
 */
export function ramStep(memory, self, others, { now, dt, roll, aggression, T = COMBAT_AI }) {
  if (memory.target >= 0) {
    const o = others.find((x) => x.index === memory.target);
    const behind = o && (o.onLine === false || Math.abs(wrapPi(Math.atan2(o.pos[0] - self.pos[0], o.pos[2] - self.pos[2]) - self.heading)) > 1.75);
    const far = o && Math.hypot(o.pos[0] - self.pos[0], o.pos[2] - self.pos[2]) > T.reachFt * 1.3;
    if (!o || !o.running || behind || far || now > memory.until || self.hp < T.fitHp * 0.75) {
      memory.target = -1;
      memory.restUntil = now + T.restS;
    }
    return memory.target;
  }
  if (now < memory.restUntil || now < T.startS) return -1;
  const target = pickTarget(self, others, { aggression, dt, roll, T });
  if (target >= 0) { memory.target = target; memory.until = now + T.ramS; }
  return target;
}

/** Whether a computer truck should repair now: `view` is its `combatTruckView`. */
export function wantsRepair(view) {
  if (view.wrecked || view.quit || view.cost <= 0) return false;
  const wheelGone = view.wheels.some((w) => w < 0);
  if (wheelGone) return view.credits >= REPAIR.wheel;
  return (view.hp < REPAIR_AT.hp || view.engine < REPAIR_AT.engine) && view.credits >= Math.min(view.cost, 400);
}
