/*
  Loose Wheels in the simulation worker (the rules are loose-wheels.js; docs/EXTENSIONS.md, "Mutator: Loose Wheels").
  It measures each truck's hits as Combat does (loose-wheels-core.js), wears and throws the wheels, lets a truck limp on
  its stubs, and puts everything back after the wait or the pit crew's hold.
*/
import { IMPACT, TOUCH_MEMORY_S, closingSpeed, engageShare, impactOf, ramShares, rollCost, truckShare } from "./combat.js";
import { createLooseWheels, hitStep, recordTouch, stubStep, stubsOf, worldVelocity } from "./loose-wheels-core.js";
import { seeded } from "./combat-debris.js";
import { lostWheelGround } from "./combat-ground.js";
import { DEFAULT_REPAIR_S, LOOSE_WHEELS, callPit, createWheelState, dentsOf, repairDue, restoreWheels, wheelHit, wheelView } from "./loose-wheels.js";

/** The impacts kept for the drawing's debris. */
const HITS_KEPT = 24;
/** How fast a truck's "fastest lately" eases down (ft/s a second), for the cost of a flip (as Combat). */
const ROLL_EASE_FT_S2 = 40;

/**
 * The simulation worker's side. `payload`: `{ mode: "loose-wheels", repairS }`. `env`: the worker's trucks, race and
 * step (as an extension's). Each truck is judged by the machine that drives it; online, that machine sends its trucks'
 * wheels (`netOwn`, the room protocol's `wheels` event) and the others show them (`applyNetOwn`).
 */
export function createLooseWheelsRuntime(payload, env) {
  const { trucks, race, step } = env;
  const T = LOOSE_WHEELS;
  const repairS = Number.isFinite(payload?.repairS) ? Math.max(0, payload.repairS) : DEFAULT_REPAIR_S;
  const clock = () => (race ? race.clock - race.startTime : env.now?.() ?? 0);
  const wheels = trucks.map(() => createWheelState(T.wheel));
  const per = trucks.map((_, i) => ({ prevVel: null, hit: null, met: null, rand: seeded(0x51ed27 ^ (i * 7919 + 3)), fast: 0, over: false }));
  const fights = new Map();
  const hits = [];
  const log = [];
  /** The body's dents from counted hits (`dentsOf`), for the race screen's crash damage: `{ id, truck, zone, steps, force }`. */
  const dents = [];
  let nextId = 1;
  const loose = createLooseWheels(() => nextId++);
  const judged = (i) => !!trucks[i] && !trucks[i].remote;
  const waitOf = (i) => (trucks[i].autopilot && repairS === 0 ? T.cpuRepairS : repairS);

  const lose = (i, result) => {
    for (const w of result.off) {
      loose.throw(i, trucks[i], w, per[i].rand);
      log.push({ id: nextId++, kind: "wheel", truck: i, wheel: w, axle: result.axle });
    }
    if (log.length > HITS_KEPT) log.splice(0, log.length - HITS_KEPT);
  };

  function settle(i, h) {
    const p = per[i];
    const met = p.met && clock() - p.met.at <= TOUCH_MEMORY_S ? p.met : null;
    const impact = impactOf(h.dv, h.excess, met?.toward ?? null);
    if (met) impact.amount *= ramShares(met.close, met.theirs).a * truckShare(closingSpeed(met.close, met.theirs)) * engageShare(h.start - met.since);
    if (!(impact.amount >= IMPACT.least)) return;
    const result = wheelHit(wheels[i], impact, clock(), T);
    for (const d of dentsOf(trucks[i].params.scrapePoints, impact)) dents.push({ id: nextId++, truck: i, ...d });
    if (dents.length > HITS_KEPT * 2) dents.splice(0, dents.length - HITS_KEPT * 2);
    if (result.off.length) {
      const s = trucks[i].state;
      hits.push({ id: nextId++, truck: i, kind: impact.kind, by: met ? met.other : -1, pos: [s.pos[0], s.pos[1] + 1, s.pos[2]], normal: [0, 1, 0], force: impact.amount, vel: worldVelocity(s) });
      if (hits.length > HITS_KEPT) hits.shift();
    }
    lose(i, result);
  }

  function rolled(i, speed) {
    const p = per[i], s = trucks[i].state;
    p.fast = Math.max(speed, p.fast - ROLL_EASE_FT_S2 * step);
    const over = s.matrix[4] < 0;
    if (over && !p.over && judged(i)) lose(i, wheelHit(wheels[i], { kind: "roll", amount: rollCost(p.fast), side: 1, end: 1 }, clock(), T));
    p.over = over;
  }

  return {
    id: "loose-wheels",
    debug: { wheels, per, loose: loose.loose },
    /** A truck that has lost a wheel drives on the ground that hides it (combat-ground.js); MTM2's model only. */
    groundFor(i, ground) {
      const p = trucks[i].params;
      if (!p?.hubs || !(p.tireRadiusFt > 0) || trucks[i].cprCar || trucks[i].state.evo) return null;
      return lostWheelGround(ground, () => trucks[i].state, p, wheels[i].lost);
    },
    movableBoxes: () => loose.boxes(),
    touch(a, b) { recordTouch(fights, trucks[a].state, trucks[b].state, per[a], per[b], a, b, clock()); },
    tick() {
      const now = clock();
      trucks.forEach((t, i) => {
        const s = t.state, v = worldVelocity(s);
        rolled(i, Math.hypot(v[0], v[1], v[2]));
        const done = hitStep(per[i], s, v, now, !(s.heliTimer > 0 || t.flight || !judged(i)));
        if (done) settle(i, done);
        if (judged(i) && repairDue(wheels[i], now, waitOf(i))) restoreWheels(wheels[i], T.wheel, { pit: wheels[i].pitUntil !== null });
      });
    },
    /** Before each truck's step: a lost wheel has no grip and a stub drags; the pit crew holds the truck still. */
    afterTruckStep(truck) {
      const i = trucks.indexOf(truck);
      if (i < 0 || truck.remote) return;
      const s = truck.state;
      if (wheels[i].pitUntil !== null) {
        s.controls.throttle = 0;
        s.controls.brakeFront = s.controls.brakeRear = 1;
      }
      stubStep(s, wheels[i].lost, step);
    },
    /**
     * Online: the wheels of the trucks this machine judges, `[{ truck, lost, axles, wear, repairs, pits }]` (`lost` and
     * `axles` bit masks, `wear` each wheel's share left).
     */
    netOwn() {
      const out = [];
      trucks.forEach((_, i) => {
        if (!judged(i)) return;
        const w = wheels[i];
        out.push({
          truck: i, lost: w.lost.reduce((m, on, k) => m | (on ? 1 << k : 0), 0), axles: w.axles.reduce((m, on, k) => m | (on ? 1 << k : 0), 0),
          wear: w.wheels.map((v) => Math.round(Math.max(0, Math.min(1, v / T.wheel)) * 100) / 100), repairs: w.repairs, pits: w.pits,
        });
      });
      return out;
    },
    /** Online: another machine's trucks' wheels (`netOwn`'s shape): a wheel it lost is thrown here too, a repair puts them back. */
    applyNetOwn(list) {
      for (const u of list ?? []) {
        const i = u?.truck;
        if (!Number.isInteger(i) || !trucks[i] || judged(i)) continue;
        const w = wheels[i];
        if (Number.isInteger(u.repairs) && u.repairs > w.repairs) {
          restoreWheels(w, T.wheel, { pit: Number.isInteger(u.pits) && u.pits > w.pits });
          w.repairs = u.repairs;
        }
        if (Number.isInteger(u.pits)) w.pits = u.pits;
        const off = [];
        for (let k = 0; k < 4; k++) {
          const lost = !!(u.lost & (1 << k));
          if (lost && !w.lost[k]) off.push(k);
          w.lost[k] = lost;
        }
        for (let k = 0; k < 2; k++) w.axles[k] = !!(u.axles & (1 << k));
        if (Array.isArray(u.wear)) u.wear.forEach((share, k) => { if (k < 4 && Number.isFinite(share)) w.wheels[k] = share * T.wheel; });
        if (off.length) {
          if (w.downSince === null) w.downSince = clock();
          lose(i, { off, axle: -1 });
        }
        if (!w.lost.some(Boolean)) w.downSince = null;
      }
      return true;
    },
    /** The pit crew (the Crash Damage key): `{ pit: seconds }`, or `{ nothing: true }`. */
    action(name, i = 0) {
      if (name !== "pit" || !judged(i)) return null;
      return callPit(wheels[i], clock(), T) ? { pit: T.pitS } : { nothing: true };
    },
    view() {
      const now = clock();
      return {
        mode: "loose-wheels",
        trucks: trucks.map((_, i) => wheelView(wheels[i], now, waitOf(i), T.wheel)),
        log: log.map((e) => ({ ...e })),
        hits: hits.map((h) => ({ ...h })),
        dents: dents.map((d) => ({ ...d })),
        loose: loose.view(),
        stubs: stubsOf(trucks, (i) => wheels[i].lost),
      };
    },
  };
}
