/*
  Deathmatch's computer drivers (docs/EXTENSIONS.md): there is no race to drive, so they hunt. Each picks its prey (the
  weakest and the leader first, nearer better, never a truck just set down), keeps it a while, chases it as Tag's It
  does (routes round objects, ramps), rams it from close in at speed, and backs off after a hit to come again, since a
  fight pushed on counts less and less (Combat's ENGAGE). Hurt, it runs from the nearest truck unless its aggression
  is High. Pure, so it runs under Node.
*/

/**
 * The figures, by aggression where they differ:
 * - `reachFt`: how far a prey may be; past it the nearest is hunted all the same;
 * - `keepS`: how long a prey is kept (at least, at most); `switchBy`: how much better another must score to take over;
 * - `ramFt`, `ramFtS`: from how near a chase becomes a ram, and how fast a ram is driven;
 * - `backS`, `backFt`: how long, and how far, a truck backs off after a hit;
 * - `fleeHp`: under this share of its hit points a truck runs (none at High), until it has `calmHp` again or is cornered
 *   within `corneredFt`.
 */
export const DM_AI = Object.freeze({
  reachFt: Object.freeze({ low: 500, normal: 900, high: 1600 }),
  keepS: Object.freeze([6, 10]), switchBy: 1,
  ramFt: 150, ramFtS: 110, chaseFtS: 90,
  backS: Object.freeze({ low: 3, normal: 2, high: 1.2 }), backFt: 60,
  fleeHp: Object.freeze({ low: 0.45, normal: 0.3, high: 0 }), calmHp: 0.6, corneredFt: 40,
});

const pick = (table, aggression) => table[aggression] ?? table.normal;

/** A driver's memory: its prey and until when, when it backs off till, whether it is running. */
export function createHunter() {
  return { prey: -1, until: 0, backUntil: 0, fleeing: false };
}

/**
 * How much truck `self` (`{ pos }`) wants prey `o` (`{ pos, hp, wheels, leader }`): the weakest (fewest wheels, fewest
 * hit points) and the leader first, nearer better.
 */
export function preyScore(self, o, reachFt) {
  const d = Math.hypot(o.pos[0] - self.pos[0], o.pos[2] - self.pos[2]);
  return (4 - o.wheels) * 2 + (1 - o.hp) * 3 + (o.leader ? 1 : 0) - d / reachFt;
}

/**
 * The prey for `self` among `others` (`{ index, pos, hp, wheels, leader, running, protected }`): the best within reach,
 * else the nearest. Only a running truck that is not protected. -1 with none.
 */
export function pickPrey(self, others, { aggression = "normal", T = DM_AI } = {}) {
  const reach = pick(T.reachFt, aggression);
  let best = -1, bestScore = -Infinity, nearest = -1, nearestD = Infinity;
  for (const o of others) {
    if (!o.running || o.protected) continue;
    const d = Math.hypot(o.pos[0] - self.pos[0], o.pos[2] - self.pos[2]);
    if (d < nearestD) { nearestD = d; nearest = o.index; }
    if (d > reach) continue;
    const score = preyScore(self, o, reach);
    if (score > bestScore) { bestScore = score; best = o.index; }
  }
  return best >= 0 ? best : nearest;
}

/**
 * One step of a hunter: what it does now and to whom. `self` is `{ pos, hp }`, `others` as `pickPrey`'s; `roll` a
 * random number in [0, 1) (the prey's keep). Returns `{ mode, target }`: "flee" from `target` (the nearest truck),
 * "back" off from it, "ram" it, "chase" it, or "wander" with none.
 */
export function hunterStep(memory, self, others, { now, roll = 0.5, aggression = "normal", T = DM_AI }) {
  const alive = others.filter((o) => o.running);
  const dist = (o) => Math.hypot(o.pos[0] - self.pos[0], o.pos[2] - self.pos[2]);
  let nearest = null;
  for (const o of alive) if (!nearest || dist(o) < dist(nearest)) nearest = o;
  // Hurt: run from the nearest truck, unless cornered (it then fights).
  const fleeAt = pick(T.fleeHp, aggression);
  if (self.hp < fleeAt) memory.fleeing = true;
  else if (self.hp >= T.calmHp) memory.fleeing = false;
  if (memory.fleeing && nearest && dist(nearest) > T.corneredFt) return { mode: "flee", target: nearest.index };
  const reach = pick(T.reachFt, aggression);
  const current = others.find((o) => o.index === memory.prey);
  const keep = current && current.running && !current.protected && now < memory.until;
  const best = pickPrey(self, others, { aggression, T });
  if (!keep) {
    memory.prey = best;
    memory.until = now + T.keepS[0] + (T.keepS[1] - T.keepS[0]) * roll;
  } else if (best >= 0 && best !== memory.prey) {
    // A much better prey takes over.
    const other = others.find((o) => o.index === best);
    if (preyScore(self, other, reach) > preyScore(self, current, reach) + T.switchBy) {
      memory.prey = best;
      memory.until = now + T.keepS[0] + (T.keepS[1] - T.keepS[0]) * roll;
    }
  }
  if (memory.prey < 0) return { mode: "wander", target: -1 };
  const prey = others.find((o) => o.index === memory.prey);
  if (now < memory.backUntil) return { mode: "back", target: prey.index };
  return { mode: dist(prey) <= T.ramFt ? "ram" : "chase", target: prey.index };
}

/** A hit landed on its prey: the hunter backs off before it comes again. */
export function hunterHit(memory, now, { aggression = "normal", T = DM_AI } = {}) {
  if (now >= memory.backUntil) memory.backUntil = now + pick(T.backS, aggression);
}

/** Where a truck backing off from `from` drives: `T.backFt` straight away from it. */
export function backPoint(pos, from, T = DM_AI) {
  const dx = pos[0] - from[0], dz = pos[2] - from[2], d = Math.hypot(dx, dz) || 1;
  return [pos[0] + (dx / d) * T.backFt, pos[1], pos[2] + (dz / d) * T.backFt];
}
