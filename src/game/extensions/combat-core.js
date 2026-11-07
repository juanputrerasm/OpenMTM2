/*
  Combat's damage in the simulation worker, shared by the modes that fight with it (Combat, Deathmatch; docs/EXTENSIONS.md).
  It measures each truck's hits from its change of velocity step by step, with who it met (`touch`), and applies them
  (combat.js); takes a lost wheel off the ground (combat-ground.js) and throws it as a loose object every truck can hit;
  drags the bare axle ends; holds a hurt engine's throttle and a hurt gearbox's gears; credits the trucks that dealt the
  damage; and carries each machine's trucks over the network. What a wreck does to the race is the mode's (`onWrecked`).
*/
import * as S from "../../vendor/openphotex/sim/mtm2/index.js";
import {
  IMPACT, TOUCH_MEMORY_S, applyHit, closingSpeed, combatTruckView, createCombat, creditDamage, CRAWL, crawling, engageShare,
  enginePower, gearboxStep, impactOf, quit, ramShares, repair, rollCost, running, say, truckShare, wreck,
} from "./combat.js";
import { lostWheelGround } from "./combat-ground.js";
import { seeded } from "./combat-debris.js";
import { createLooseWheels, hitStep, recordTouch, stubStep, stubsOf, toWorld, worldVelocity } from "./loose-wheels-core.js";

/** The impacts kept for the drawing's debris. */
export const HITS_KEPT = 24;
/** How fast a truck's "fastest lately" eases down (ft/s a second), for the cost of a flip. */
export const ROLL_EASE_FT_S2 = 40;

/**
 * The damage of a fight among `env.trucks`. `options` is Combat's (`toughness`, `credits`, `startCredits`, `rewards`);
 * `hooks`:
 * - `onWrecked(i, by, remote)`: truck `i` was wrecked by truck `by` (-1 none), here or (`remote`) on its own machine;
 * - `onQuit(i)`: truck `i` left the fight;
 * - `canDamage(i)`: false while truck `i` can neither take nor deal damage (Deathmatch's protection after a respawn);
 * - `ownExtra(i)`, `markExtra(i)` and `adoptExtra(i, e)`: the mode's own fields in a truck's network state, the part of
 *   them that must be sent at once, and taking them from another machine.
 */
export function createCombatCore(env, options = {}, hooks = {}) {
  const { trucks, race, step } = env;
  const c = createCombat(trucks.length, options);
  const clock = () => race.clock - race.startTime;
  const canDamage = (i) => hooks.canDamage?.(i) ?? true;
  /** Each truck's lost wheels (the ground wrapper reads them), its hit under way, its last meeting with another truck. */
  const per = trucks.map((t, i) => ({
    lost: [false, false, false, false], hit: null, met: null, prevVel: null, gearbox: { last: S.GEAR.FIRST, missUntil: 0, target: null },
    rand: seeded(0x9e3779b9 ^ (i * 7919 + 1)), progress: 0, laps: 0,
    // Its fastest lately (ft/s, easing down), and whether it is over on its back or side now.
    fast: 0, over: false,
  }));
  const hits = [];
  /** Each pair of trucks' fight (ENGAGE): when it began, when they last touched; by "a,b". */
  const fights = new Map();
  let nextId = 1;
  const wheelsLoose = createLooseWheels(() => nextId++);

  /*
    Online (docs/EXTENSIONS.md, "Over the network"): only the machine that drives a truck sees its own crashes, so each
    machine judges the trucks it drives (its player's; the owner's also its computer trucks and any left by a player)
    and sends their state (`netOwn`); the others take it (`applyNetOwn`). Credits for damage dealt to a truck judged
    elsewhere are owed to it and sent with the state, as running totals.
  */
  const net = env.net ?? null;
  const following = () => net?.authority === "follower";
  const remoteAtStart = trucks.map((t) => !!t.remote);
  const judgedHere = (i) => !!trucks[i] && !trucks[i].remote && (!remoteAtStart[i] || !following());
  /** Credits this machine owes other machines' trucks: running totals of hit points dealt and wrecks, by truck. */
  const owed = trucks.map(() => ({ hp: 0, wrecks: 0 }));
  /** What each other machine has owed this machine's trucks so far, by its sender truck. */
  const owedSeen = new Map();
  /** Who wrecked each truck last (-1 nobody). */
  const wreckedBy = trucks.map(() => -1);
  /** Credit `by` for a hit: here when it is judged here, else owed to its machine. */
  const credit = (by, hp, wrecked) => {
    if (by < 0 || !trucks[by]) return;
    if (judgedHere(by)) { creditDamage(c, by, hp, wrecked); return; }
    owed[by].hp += hp;
    if (wrecked) owed[by].wrecks++;
  };
  /** Truck `i` is wrecked, by truck `by` or by nothing (-1). */
  const wrecked = (i, by, remote = false) => {
    wreckedBy[i] = by;
    wreck(c, i, by);
    hooks.onWrecked?.(i, by, remote);
  };

  /** Where a corner of truck `i` is in the world, and the way out from it. */
  const cornerOf = (i, side, end) => {
    const s = trucks[i].state;
    const body = [side * 3.5, 0.5, end * 6];
    const w = toWorld(s.matrix, body);
    return { pos: [s.pos[0] + w[0], s.pos[1] + w[1], s.pos[2] + w[2]], normal: w };
  };
  /** Throw truck `i`'s wheel off: a loose box with the hub's velocity, kicked out and up (loose-wheels-core.js). */
  function throwWheel(i, wheel) {
    per[i].lost[wheel] = true;
    wheelsLoose.throw(i, trucks[i], wheel, per[i].rand);
  }
  const keepHit = (h) => {
    hits.push({ id: nextId++, ...h });
    if (hits.length > HITS_KEPT) hits.shift();
  };

  /** Count truck `i`'s hit `h` now that it is over. */
  function settle(i, h) {
    if (!h || !running(c.trucks[i]) || !canDamage(i)) return;
    const met = per[i].met && clock() - per[i].met.at <= TOUCH_MEMORY_S ? per[i].met : null;
    // A truck that cannot deal damage (just set down) does none.
    if (met && !canDamage(met.other)) return;
    const impact = impactOf(h.dv, h.excess, met?.toward ?? null);
    let creditTo = -1;
    if (met) {
      const shares = ramShares(met.close, met.theirs);
      // Trucks leaning on each other or tangled cost little; a hit at speed all of it.
      // and a fight pushed on past its first blow less and less (ENGAGE).
      impact.amount *= shares.a * truckShare(closingSpeed(met.close, met.theirs)) * engageShare(h.start - met.since);
      if (shares.creditB) creditTo = met.other;
    }
    if (impact.amount <= 0) return;
    const result = applyHit(c, i, impact);
    if (!result.taken) return;
    const where = met
      ? (() => { const s = trucks[i].state, d = Math.hypot(...met.towardWorld) || 1; return { pos: [s.pos[0] + met.towardWorld[0] / d * 4, s.pos[1] + 1, s.pos[2] + met.towardWorld[2] / d * 4], normal: met.towardWorld.map((v) => -v) }; })()
      : cornerOf(i, impact.side, impact.end);
    keepHit({ truck: i, kind: impact.kind, by: met ? met.other : -1, pos: where.pos, normal: met ? met.towardWorld : where.normal, force: result.taken, vel: worldVelocity(trucks[i].state) });
    for (const wheel of result.wheelsOff) {
      throwWheel(i, wheel);
      say(c, { kind: "wheel", truck: i, wheel, by: creditTo });
    }
    credit(creditTo, result.taken, result.wrecked);
    if (result.wrecked) wrecked(i, creditTo);
  }

  /** A truck going over at speed: a small cost, once a flip. */
  function rolled(i, speed) {
    const p = per[i], s = trucks[i].state;
    p.fast = Math.max(speed, p.fast - ROLL_EASE_FT_S2 * step);
    // The body's up past level (row-major: its y is element 4).
    const over = s.matrix[4] < 0;
    if (over && !p.over && running(c.trucks[i]) && judgedHere(i) && canDamage(i)) {
      const amount = rollCost(p.fast);
      if (amount > 0) {
        const result = applyHit(c, i, { kind: "roll", amount, side: 1, end: 1 });
        for (const wheel of result.wheelsOff) {
          throwWheel(i, wheel);
          say(c, { kind: "wheel", truck: i, wheel, by: -1 });
        }
        if (result.wrecked) wrecked(i, -1);
      }
    }
    p.over = over;
  }

  /** Each step: how much each truck's velocity changed, and the hits that are over. */
  function measure() {
    trucks.forEach((t, i) => {
      const s = t.state, v = worldVelocity(s), p = per[i];
      rolled(i, Math.hypot(v[0], v[1], v[2]));
      // Another machine's truck is judged there: its copy here only follows it.
      const done = hitStep(p, s, v, clock(), !(s.heliTimer > 0 || t.flight || !judgedHere(i)));
      if (done) settle(i, done);
    });
  }

  /** Truck `j`'s state as its own machine judged it: its pools, wheels, credits, and what changed, told and shown here. */
  function adopt(j, e) {
    const t = c.trucks[j], full = c.full, s = trucks[j].state;
    const before = { global: t.global, lost: [...t.lost], repairs: t.repairs };
    // The mode's own fields first: a respawn there brings the truck back here before its pools are read.
    hooks.adoptExtra?.(j, e);
    const share = (x, max) => Math.max(0, Math.min(1, Number(x) || 0)) * max;
    t.global = share(e.g, full.global);
    t.engine = share(e.e, full.engine);
    t.gearbox = share(e.b, full.gearbox);
    t.wheels = [0, 1, 2, 3].map((w) => share(e.w?.[w], full.wheel));
    t.credits = Number(e.cr) || 0;
    t.dealt = Number(e.d) || 0;
    t.wrecks = Number(e.wk) || 0;
    t.repairs = Number(e.rp) || 0;
    const taken = before.global - t.global;
    if (taken >= IMPACT.least && running(t)) {
      keepHit({ truck: j, kind: "remote", by: -1, pos: [s.pos[0], s.pos[1] + 2, s.pos[2]], normal: [0, 1, 0], force: taken, vel: worldVelocity(s) });
    }
    for (let w = 0; w < 4; w++) {
      const lost = !!e.l?.[w];
      if (lost && !t.lost[w]) { t.lost[w] = true; throwWheel(j, w); say(c, { kind: "wheel", truck: j, wheel: w, by: -1 }); }
      else if (!lost) { t.lost[w] = false; per[j].lost[w] = false; }
    }
    if (t.repairs > before.repairs) say(c, { kind: "repair", truck: j, spent: 0, wheelsBack: [] });
    if (e.wr && !t.wrecked) wrecked(j, e.by ?? -1, true);
    if (e.q && !t.quit && quit(c, j)) hooks.onQuit?.(j);
  }

  /** The computer trucks judged here repair when `wants` says so. */
  function cpuRepairs(wants) {
    const now = clock();
    trucks.forEach((t, i) => {
      if (!t.autopilot || !judgedHere(i) || !c.credits) return;
      if (wants(combatTruckView(c, i))) {
        const done = repair(c, i, now);
        for (const wheel of done.wheelsBack ?? []) per[i].lost[wheel] = false;
      }
    });
  }

  /** Truck `i` whole again (`revive` in combat.js): its wheels back under it and its fights forgotten. */
  function restore(i) {
    per[i].lost.fill(false);
    per[i].hit = null; per[i].met = null; per[i].prevVel = null; per[i].fast = 0; per[i].over = false;
    for (const key of [...fights.keys()]) if (key.split(",").map(Number).includes(i)) fights.delete(key);
  }

  return {
    c, per, hits, wheelsLoose, loose: wheelsLoose.loose, clock, judgedHere, following, wreckedBy, restore,
    measure, cpuRepairs,
    /** A truck that has lost a wheel drives on the ground that hides it (combat-ground.js); MTM2's model only. */
    groundFor(i, ground) {
      const p = trucks[i].params;
      if (!p?.hubs || !(p.tireRadiusFt > 0) || trucks[i].cprCar || trucks[i].state.evo) return null;
      return lostWheelGround(ground, () => trucks[i].state, p, per[i].lost);
    },
    movableBoxes: () => wheelsLoose.boxes(),
    touch(a, b) {
      recordTouch(fights, trucks[a].state, trucks[b].state, per[a], per[b], a, b, clock());
    },
    /** Before each truck's step: a lost wheel has no grip, a stub drags, a hurt engine and gearbox hold the truck back. */
    afterTruckStep(truck) {
      const i = trucks.indexOf(truck);
      if (i < 0 || truck.remote) return;
      const s = truck.state, ctl = s.controls, p = per[i];
      if (!running(c.trucks[i])) {
        ctl.throttle = 0;
        ctl.brakeFront = ctl.brakeRear = 1;
        // A wreck stays where it lies: no helicopter, no turning it back over.
        truck.recovery.autopilot = false;
        truck.recovery.player = false;
        truck.recovery.racing = false;
        return;
      }
      stubStep(s, p.lost, step);
      ctl.throttle = Math.min(ctl.throttle, enginePower(c, i));
      gearboxStep(c, i, ctl, S.GEAR, p.gearbox, clock(), p.rand());
      // A dead engine or gearbox: a crawl, held under its top speed.
      if (crawling(c, i)) {
        ctl.throttle = Math.min(ctl.throttle, CRAWL.throttle);
        if (Math.hypot(s.bvel[0], s.bvel[2]) > CRAWL.topFtS) ctl.throttle = 0;
      }
    },
    /** The repair key: as far as the credits go. */
    repair(i) {
      const done = repair(c, i, clock());
      for (const wheel of done.wheelsBack ?? []) per[i].lost[wheel] = false;
      return done;
    },
    /** Leaving the fight. */
    quit(i) {
      if (!quit(c, i)) return false;
      hooks.onQuit?.(i);
      return true;
    },
    /** The state of the trucks judged here, for the others; `mark` changes when something they must hear at once does. */
    netOwn() {
      const list = trucks.map((_, i) => {
        if (!judgedHere(i)) return null;
        const t = c.trucks[i], full = c.full;
        return {
          g: t.global / full.global, e: t.engine / full.engine, b: t.gearbox / full.gearbox, w: t.wheels.map((x) => x / full.wheel),
          l: [...t.lost], cr: Math.floor(t.credits), d: Math.round(t.dealt), wk: t.wrecks, rp: t.repairs, wr: t.wrecked, q: t.quit, by: wreckedBy[i],
          ...(hooks.ownExtra?.(i) ?? {}),
        };
      });
      const mark = list.map((x, i) => (x ? `${x.l.map(Number).join("")}${+x.wr}${+x.q}${x.rp}${hooks.markExtra?.(i) ?? ""}` : "-")).join(",")
        + owed.map((o) => o.wrecks).join("");
      return { mark, trucks: list, owed: owed.map((o) => ({ ...o })) };
    },
    /** Another machine's trucks (`trucks[i]`, null for the others), and what it owes this machine's (`owed`); `from` its truck. */
    applyNetOwn({ from = -1, trucks: list = [], owed: theirs = [] } = {}) {
      list.forEach((e, j) => { if (e && !judgedHere(j)) adopt(j, e); });
      const seen = owedSeen.get(from) ?? new Map();
      owedSeen.set(from, seen);
      theirs.forEach((o, j) => {
        if (!o || !judgedHere(j)) return;
        const before = seen.get(j) ?? { hp: 0, wrecks: 0 };
        const hp = o.hp - before.hp, wrecks = o.wrecks - before.wrecks;
        if (hp > 0) creditDamage(c, j, hp, false);
        for (let k = 0; k < wrecks; k++) creditDamage(c, j, 0, true);
        seen.set(j, { hp: Math.max(before.hp, o.hp), wrecks: Math.max(before.wrecks, o.wrecks) });
      });
    },
    /** What every fighting mode's view has: the trucks' pools, the lost wheels, the events, the debris, the stubs. */
    view() {
      return {
        credits: c.credits,
        trucks: trucks.map((_, i) => combatTruckView(c, i)),
        lost: per.map((p) => [...p.lost]),
        log: c.log.map((e) => ({ ...e })), events: c.events,
        hits: hits.map((h) => ({ ...h })),
        loose: wheelsLoose.view(),
        stubs: stubsOf(trucks, (i) => per[i].lost),
        out: c.trucks.map((t) => !running(t)),
      };
    },
  };
}
