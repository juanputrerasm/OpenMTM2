/*
  Combat (docs/EXTENSIONS.md), an addition, not in the game: a circuit or rally race where the trucks wreck each other, after
  Carmageddon's combat racing but with no power-ups. The race is the track's own (its checkpoints, laps and ending).

  - **Hit points.** Each truck has a pool for the whole truck (`global`), one for the engine, one for the gearbox and
    one for each wheel (FR, FL, RR, RL). Every hit takes from the whole truck and shares some out by where it came
    from: a head-on mostly hurts the engine (less power), a hit from the side the wheels on that side. The gearbox is
    under the truck, out of the way: a hit from behind or a hard landing wears it a little, until a wheel is gone and
    every hit reaches it (`GEARBOX_EXPOSED`); a worn one misses gears.
  - **Never out for a part.** A dead engine or gearbox does not end the race: the truck crawls (`CRAWL`), on to the
    checkpoints whose credits repair it. A truck goes on on any wheels it has left.
  - **Wheels come off last.** A wheel takes at most `WHEEL_CAP` of its pool in one hit, and comes off only once its pool
    is empty, the truck has lost half its hit points or more, and that corner is hit again.
  - **Out.** A truck is wrecked when its hit points run out, or when its last wheel comes off and it has not the
    credits to put one back (it waits for a repair otherwise). A wrecked player watches on.
  - **Credits** for each checkpoint and lap, for each hit point taken off another truck and for each wreck; the Crash
    Damage key (X) spends them on repairs.
  - **The winner** is the first truck home, or the last truck still running.

  Impacts are measured by how much a truck's velocity changes in a step, beyond gravity (`impactOf`); a race of computer
  trucks changes it by under 10 ft/s over four steps, a jump's landing by about 28, a crash by 30 to 60. Trucks are
  built for knocks: a hit with no other truck in it (a fence, a wall, a roll) counts only past `aloneFreeFtS`, and a
  landing only past `landingFreeFtS` (a big jump), harder from there; hits between trucks count from the first ft/s.
  Pure, so it runs under Node.
*/
import { msg } from "../strings.js";
import { fromVehicles, localIndex, vehicleIndex } from "./net-wire.js";

export const DEFAULT_COMBAT_LAPS = 3;
/** The pools at Normal toughness. */
export const COMBAT_HP = Object.freeze({ global: 1000, engine: 300, gearbox: 300, wheel: 250 });
/** Toughness: every pool times this. */
export const TOUGHNESS = Object.freeze({ soft: 0.7, normal: 1, tough: 1.5 });
/** What a truck out of the fight is called under its name: wrecked, or left. */
export const WRECKED_LABEL = msg("Wrecked"), OUT_LABEL = msg("Out");
/** Wheel order, as the simulation's tires: front right, front left, rear right, rear left. */
export const WHEEL_NAMES = Object.freeze([msg("front right"), msg("front left"), msg("rear right"), msg("rear left")]);
/**
 * The impact figures:
 * - `stepFtS`: a step's change of velocity (ft/s, gravity taken out) past which it is part of a hit;
 * - `perFtS`: hit points a hit takes off the whole truck per ft/s of change past `stepFtS`, step by step;
 * - `landing`, `landingFreeFtS`: a landing (a change mostly upward) counts for this, against a hit between trucks, on its
 *   change of velocity past `landingFreeFtS` (only a big jump's);
 * - `least`: a hit taking less than this off the whole truck does nothing to the parts (a scrape);
 * - `alone`, `aloneFreeFtS`: a hit with no other truck in it (an object, a wall, a roll) counts for this, on its change
 *   of velocity past `aloneFreeFtS`;
 * - `cap`: the most of the whole truck's hit points one hit takes, a share of the full pool;
 * - `truckFreeFtS`, `truckFullFtS`: a hit between trucks counts by how fast they closed on each other (`closingSpeed`):
 *   nothing under `truckFreeFtS` (trucks leaning on each other, tangled, or going the same way at the same speed), all
 *   of it from `truckFullFtS`, in between in proportion.
 */
export const IMPACT = Object.freeze({
  stepFtS: 4, perFtS: 4.5, least: 12, cap: 0.2, alone: 0.35, aloneFreeFtS: 30, landing: 1.5, landingFreeFtS: 45,
  truckFreeFtS: 15, truckFullFtS: 40,
});
/** The share of a hit between trucks that counts, by their closing speed (ft/s). */
export const truckShare = (closingFtS, T = IMPACT) => Math.max(0, Math.min(1, (closingFtS - T.truckFreeFtS) / (T.truckFullFtS - T.truckFreeFtS)));
/**
 * How fast two trucks closed on each other (ft/s): each one's speed toward the other, along the line between them, a
 * truck going away counting against. Two trucks at the same speed the same way close at nothing, however fast.
 */
export const closingSpeed = (closeA, closeB) => Math.max(0, closeA + closeB);
/**
 * Two trucks in one fight (touching, or apart for less than `apartS`): the first blow counts in full, later ones only
 * for `fullS` seconds after the first contact, then less, down to nothing at `goneS`. Pushing on cannot grind a truck
 * down: its attacker must back off and come again. A new contact after `rehitGapS` apart, closing at
 * `IMPACT.truckFullFtS` or more, is a new blow and starts a new fight.
 */
export const ENGAGE = Object.freeze({ fullS: 0.5, goneS: 1.5, apartS: 0.75, rehitGapS: 0.2 });
/** The share of a hit between trucks that counts, `heldS` seconds into their fight. */
export const engageShare = (heldS, T = ENGAGE) => Math.max(0, Math.min(1, (T.goneS - heldS) / (T.goneS - T.fullS)));
/**
 * A truck flipped over at speed: past `freeFtS` (its fastest in the last second), `perFtS` hit points per ft/s, at
 * most `most`, off the whole truck only. Small: a roll at full speed costs a few percent.
 */
export const ROLL = Object.freeze({ freeFtS: 30, perFtS: 0.8, most: 50 });
/** What a flip at `speedFtS` costs. */
export const rollCost = (speedFtS, T = ROLL) => Math.min(T.most, Math.max(0, speedFtS - T.freeFtS) * T.perFtS);
/** The share of a hit that each part takes, by where it came from. */
export const SHARES = Object.freeze({
  front: { engine: 0.6, near: 0.6, far: 0.2 },
  rear: { gearbox: 0.2, near: 0.6, far: 0.2 },
  side: { near: 0.8, far: 0.4 },
  landing: { gearbox: 0.15, each: 0.1 },
});
/** With a wheel gone the gearbox is open to the blows: every hit takes this share of its amount from it too. */
export const GEARBOX_EXPOSED = 0.35;
/** A wheel loses at most this share of its pool in one hit; it comes off only with the truck at or under `WHEEL_OFF_AT` of its hit points. */
export const WHEEL_CAP = 0.3, WHEEL_OFF_AT = 0.5;
/** A truck that rams another (its closing speed this much over the other's) takes this share of the damage. */
export const RAMMER_EDGE = 1.3, RAMMER_SHARE = 0.25;
/** A truck touched another this recently (seconds): the hit is theirs. */
export const TOUCH_MEMORY_S = 0.25;
/** A hurt engine still gives this share of its power, down to its last hit point; the gearbox under this share misses gears. */
export const ENGINE_FLOOR = 0.4, GEARBOX_MISS = 0.5, MISS_S = 0.5;
/**
 * A dead engine or gearbox: the truck crawls, at most `throttle` and in first gear, and is held under `topFtS` (about
 * 8 mph), enough to reach a checkpoint and the credits that repair it.
 */
export const CRAWL = Object.freeze({ throttle: 0.2, topFtS: 12 });
/** The most an upshift misses, with the gearbox at no hit points. */
export const MISS_MOST = 0.6;
/** Credits: per checkpoint, per lap, per hit point dealt, per wreck. */
export const CREDITS = Object.freeze({ checkpoint: 50, lap: 200, perHp: 1, wreck: 1000 });
/**
 * A repair: per wheel put back on (it comes back with `wheelBack` of its pool), per hit point given back; repairs at
 * least this far apart (seconds).
 */
export const REPAIR = Object.freeze({ wheel: 200, wheelBack: 0.3, perHp: 2, coolS: 3 });
/** A stub dragging on the ground slows its truck by this (ft/s per second). */
export const STUB_DRAG_FT_S2 = 5;

export const COMBAT_EXTENSION = Object.freeze({
  id: "combat",
  name: msg("Combat"),
  description: msg("Race and wreck the others: hits wear down the engine, the gearbox and the wheels, and a truck is out when it is wrecked. Earn credits and press X to repair. The first truck home, or the last one running, wins."),
  length: Object.freeze({ key: "laps", label: msg("Laps"), default: DEFAULT_COMBAT_LAPS, min: 1, max: 99 }),
  settings: Object.freeze([
    Object.freeze({ key: "laps", label: msg("Laps"), type: "number", min: 1, max: 99, default: DEFAULT_COMBAT_LAPS }),
    Object.freeze({
      key: "toughness", label: msg("Truck toughness"), type: "select", default: "normal",
      options: Object.freeze([
        Object.freeze({ value: "soft", label: msg("Soft: short fights") }),
        Object.freeze({ value: "normal", label: msg("Normal") }),
        Object.freeze({ value: "tough", label: msg("Tough: long fights") }),
      ]),
    }),
    Object.freeze({ key: "credits", label: msg("Earn credits and repair with X"), type: "boolean", default: true }),
    Object.freeze({ key: "startCredits", label: msg("Credits at the start"), type: "number", min: 0, max: 99999, default: 500 }),
    Object.freeze({ key: "cpuRepairs", label: msg("Computer trucks repair themselves"), type: "boolean", default: true }),
    Object.freeze({
      key: "aggression", label: msg("Computer trucks' aggression"), type: "select", default: "normal",
      options: Object.freeze([
        Object.freeze({ value: "low", label: msg("Low: they mostly race") }),
        Object.freeze({ value: "normal", label: msg("Normal") }),
        Object.freeze({ value: "high", label: msg("High: they hunt") }),
      ]),
    }),
  ]),
  /** A track raced through checkpoints: a circuit or a rally (not free roam, a Summit Rumble or a drag strip's lanes). */
  acceptsTrack: (track) => !!track && !track.freeRoamOnly && ["circuit", "rally"].includes(track.raceType ?? "circuit"),
  trackLocked: false,
  keepsRace: true,
  minEntrants: 2,
  teamPicker: null,
  /** The Crash Damage key repairs instead of switching damage, which is always on. */
  damageKey: "repair",
  /** A player who is wrecked, or quits, watches the race on. */
  watchWhenOut: true,
});

/** The pools' full values at a toughness. */
export function combatPools(toughness = "normal") {
  const k = TOUGHNESS[toughness] ?? 1;
  return { global: COMBAT_HP.global * k, engine: COMBAT_HP.engine * k, gearbox: COMBAT_HP.gearbox * k, wheel: COMBAT_HP.wheel * k };
}

/**
 * Play by another machine's rules (an online room's owner's): its toughness, every pool kept at the same share of its
 * new size, its credits switch, and its credits at the start for trucks that have not spent or earned any yet.
 */
export function adoptRules(c, { toughness = "normal", credits = true, startCredits = 500 } = {}) {
  const full = combatPools(toughness), old = c.full;
  for (const t of c.trucks) {
    t.global *= full.global / old.global;
    t.engine *= full.engine / old.engine;
    t.gearbox *= full.gearbox / old.gearbox;
    t.wheels = t.wheels.map((w) => w * (full.wheel / old.wheel));
    if (!credits) t.credits = 0;
    else if (!c.credits || (t.credits === c.start && !t.repairs && !t.dealt)) t.credits = Math.max(0, Number(startCredits) || 0);
  }
  c.full = full;
  c.credits = !!credits;
  c.start = credits ? Math.max(0, Number(startCredits) || 0) : 0;
}

/** One truck's state. */
function freshTruck(full, credits) {
  return {
    global: full.global, engine: full.engine, gearbox: full.gearbox, wheels: [full.wheel, full.wheel, full.wheel, full.wheel],
    lost: [false, false, false, false], wrecked: false, quit: false, credits, dealt: 0, wrecks: 0, repairedAt: -Infinity, repairs: 0,
  };
}

/** A Combat's state for `count` trucks. */
export function createCombat(count, { toughness = "normal", credits = true, startCredits = 500 } = {}) {
  const full = combatPools(toughness);
  return {
    full, credits: !!credits, start: credits ? Math.max(0, Number(startCredits) || 0) : 0,
    trucks: Array.from({ length: count }, () => freshTruck(full, credits ? Math.max(0, Number(startCredits) || 0) : 0)),
    /** Wrecked trucks in order. */
    order: [],
    /**
     * The recent events, each `{ id, kind: "wheel" | "wreck" | "repair" | "quit", truck, by?, wheel?, spent? }`, the last
     * `LOG_SIZE` of them, and the count so far (the last one's id).
     */
    log: [], events: 0,
  };
}

/** Events kept for the HUD. */
export const LOG_SIZE = 16;
export function say(c, event) {
  c.log.push({ id: ++c.events, ...event });
  if (c.log.length > LOG_SIZE) c.log.shift();
}
/** A truck's wheels still on. */
export const wheelsOn = (t) => t.lost.filter((x) => !x).length;
/** Whether a truck is still running. */
export const running = (t) => !t.wrecked && !t.quit;
/** No wheels left and no credits to put one back on: the truck is done. */
export const stranded = (c, t) => wheelsOn(t) === 0 && (!c.credits || t.credits < REPAIR.wheel);

/**
 * Where a hit came from and how hard it was. `dv` is the change of velocity over the hit in body axes (x right, y up,
 * z forward; the truck was pushed that way) and `excess` the change past `IMPACT.stepFtS`, summed step by step. `toward`
 * is where the other truck was, body axes, when there was one. Returns `{ kind, amount, side, end }`: `side` +1 right
 * or -1 left, `end` +1 front or -1 rear (the corner nearest the hit).
 */
export function impactOf(dv, excess, toward = null, T = IMPACT) {
  const [x, y, z] = dv;
  let kind, side, end;
  if (toward) {
    // Against another truck, where it was says which part was struck.
    const [tx, , tz] = toward;
    kind = Math.abs(tz) >= Math.abs(tx) ? (tz > 0 ? "front" : "rear") : "side";
    side = tx >= 0 ? 1 : -1;
    end = tz >= 0 ? 1 : -1;
  } else if (y > 0 && y >= Math.hypot(x, z)) {
    kind = "landing"; side = x >= 0 ? -1 : 1; end = z >= 0 ? -1 : 1;
  } else if (Math.abs(z) >= Math.abs(x)) {
    // Pushed back: struck in front; pushed forward: struck from behind. The corner is on the side it was pushed from.
    kind = z < 0 ? "front" : "rear"; end = z < 0 ? 1 : -1; side = x > 0 ? -1 : 1;
  } else {
    kind = "side"; side = x > 0 ? -1 : 1; end = z > 0 ? -1 : 1;
  }
  const size = Math.hypot(x, y, z);
  const amount = toward ? Math.max(0, excess) * T.perFtS
    : kind === "landing" ? Math.max(0, size - T.landingFreeFtS) * T.perFtS * T.landing
    : Math.max(0, size - T.aloneFreeFtS) * T.perFtS * T.alone;
  return { kind, amount, side, end };
}

/** The wheel at a corner: `end` +1 front, `side` +1 right. */
export const wheelAt = (end, side) => (end > 0 ? 0 : 2) + (side > 0 ? 0 : 1);

/**
 * Apply a hit of `amount` from `impact` (`impactOf`) to truck `i`. Returns `{ taken, wheelsOff: [wheel], wrecked }`;
 * `taken` is what came off the whole truck. A wrecked truck takes nothing.
 */
export function applyHit(c, i, impact) {
  const t = c.trucks[i], full = c.full;
  const out = { taken: 0, wheelsOff: [], wrecked: false };
  if (!running(t) || !(impact.amount > 0)) return out;
  const amount = Math.min(impact.amount, t.global, full.global * IMPACT.cap);
  t.global -= amount;
  out.taken = amount;
  if (amount >= IMPACT.least) {
    const near = wheelAt(impact.end, impact.side);
    const shares = SHARES[impact.kind];
    const wheel = (w, share) => {
      if (t.lost[w]) return;
      const before = t.wheels[w];
      t.wheels[w] = Math.max(0, before - Math.min(amount * share, full.wheel * WHEEL_CAP));
      // Off: its pool was already empty, the truck is half gone, and this corner is struck.
      if (before <= 0 && t.global <= full.global * WHEEL_OFF_AT) {
        t.lost[w] = true;
        out.wheelsOff.push(w);
      }
    };
    if (impact.kind === "front") {
      t.engine = Math.max(0, t.engine - amount * shares.engine);
      wheel(near, shares.near);
      wheel(near ^ 1, shares.far);
    } else if (impact.kind === "rear") {
      t.gearbox = Math.max(0, t.gearbox - amount * shares.gearbox);
      wheel(near, shares.near);
      wheel(near ^ 1, shares.far);
    } else if (impact.kind === "side") {
      wheel(near, shares.near);
      wheel(near ^ 2, shares.far);
    } else if (impact.kind === "roll") {
      // A roll scuffs the body: only the whole truck.
    } else {
      t.gearbox = Math.max(0, t.gearbox - amount * shares.gearbox);
      // A landing never takes a wheel off: it only wears them.
      for (let w = 0; w < 4; w++) if (!t.lost[w]) t.wheels[w] = Math.max(0, t.wheels[w] - Math.min(amount * shares.each, full.wheel * WHEEL_CAP));
    }
  }
  // A wheel gone bares the gearbox (this hit's own wheel included).
  if (amount >= IMPACT.least && impact.kind !== "roll" && wheelsOn(t) < 4) t.gearbox = Math.max(0, t.gearbox - amount * GEARBOX_EXPOSED);
  if (t.global <= 0 || stranded(c, t)) {
    t.global = Math.max(0, t.global);
    t.wrecked = true;
    out.wrecked = true;
  }
  return out;
}

/**
 * Who rammed whom when two trucks met: each truck's closing speed toward the other (ft/s). Returns each truck's share
 * of its own damage, and whether the other is credited with it: a truck much faster into the other takes `RAMMER_SHARE`;
 * when they are close, both take it all and each is credited with the other's.
 */
export function ramShares(closeA, closeB) {
  const a = Math.max(0, closeA), b = Math.max(0, closeB);
  if (a > b * RAMMER_EDGE && a > 5) return { a: RAMMER_SHARE, b: 1, creditA: true, creditB: false };
  if (b > a * RAMMER_EDGE && b > 5) return { a: 1, b: RAMMER_SHARE, creditA: false, creditB: true };
  return { a: 1, b: 1, creditA: true, creditB: true };
}

/** Credit truck `by` for `hp` taken off another truck, and for a wreck. */
export function creditDamage(c, by, hp, wrecked = false) {
  if (by === null || by === undefined || by < 0 || !c.trucks[by]) return;
  const t = c.trucks[by];
  t.dealt += hp;
  if (c.credits) t.credits += Math.round(hp * CREDITS.perHp);
  if (wrecked) {
    t.wrecks++;
    if (c.credits) t.credits += CREDITS.wreck;
  }
}

/** Credit truck `i` for checkpoints and laps it has just made. */
export function creditProgress(c, i, checkpoints, laps) {
  if (!c.credits) return;
  c.trucks[i].credits += Math.max(0, checkpoints) * CREDITS.checkpoint + Math.max(0, laps) * CREDITS.lap;
}

/** Mark truck `i` wrecked (its event and its place in the wreck order); `by` the truck that did it, or -1. */
export function wreck(c, i, by = -1) {
  const t = c.trucks[i];
  t.wrecked = true;
  if (!c.order.includes(i)) c.order.push(i);
  say(c, { kind: "wreck", truck: i, by });
}

/** A truck leaves the fight of its own will (the player's Quit to watch): it counts as wrecked. */
export function quit(c, i) {
  const t = c.trucks[i];
  if (!running(t)) return false;
  t.quit = true;
  if (!c.order.includes(i)) c.order.push(i);
  say(c, { kind: "quit", truck: i });
  return true;
}

/** What a full repair of truck `i` would cost. */
export function repairCost(c, i) {
  const t = c.trucks[i], full = c.full;
  const wheels = t.wheels.reduce((s, w, n) => s + full.wheel - (t.lost[n] ? full.wheel * REPAIR.wheelBack : w), 0);
  const missing = full.global - t.global + full.engine - t.engine + full.gearbox - t.gearbox + wheels;
  return t.lost.filter(Boolean).length * REPAIR.wheel + Math.ceil(missing * REPAIR.perHp);
}

/**
 * The repair key: as much as the credits buy, however few. A lost wheel is put back first; what is left is spread
 * evenly over the damage, every pool (the whole truck, the engine, the gearbox, each wheel) mended by the same share of
 * what it lacks. Not when wrecked, nor within `REPAIR.coolS` of the last. Returns `{ spent, wheelsBack }` or a reason it
 * did nothing: "wrecked", "cooling", "whole", "credits".
 */
export function repair(c, i, now) {
  const t = c.trucks[i], full = c.full;
  if (!running(t)) return { reason: "wrecked" };
  if (now - t.repairedAt < REPAIR.coolS) return { reason: "cooling" };
  if (repairCost(c, i) <= 0) return { reason: "whole" };
  let left = t.credits, spent = 0;
  const wheelsBack = [];
  for (let w = 0; w < 4; w++) {
    if (!t.lost[w] || left < REPAIR.wheel) continue;
    t.lost[w] = false;
    t.wheels[w] = full.wheel * REPAIR.wheelBack;
    left -= REPAIR.wheel; spent += REPAIR.wheel;
    wheelsBack.push(w);
  }
  // The same share of every pool's damage, as far as the credits go.
  const on = [0, 1, 2, 3].filter((w) => !t.lost[w]);
  const missing = full.global - t.global + full.engine - t.engine + full.gearbox - t.gearbox
    + on.reduce((s, w) => s + full.wheel - t.wheels[w], 0);
  const buys = Math.floor(left / REPAIR.perHp);
  if (missing > 0 && buys > 0) {
    const share = Math.min(1, buys / missing);
    const mend = (now, max) => now + (max - now) * share;
    t.global = mend(t.global, full.global);
    t.engine = mend(t.engine, full.engine);
    t.gearbox = mend(t.gearbox, full.gearbox);
    for (const w of on) t.wheels[w] = mend(t.wheels[w], full.wheel);
    const cost = Math.ceil(Math.min(buys, missing) * REPAIR.perHp);
    left -= cost; spent += cost;
  }
  if (spent <= 0) return { reason: "credits" };
  t.credits -= spent;
  t.repairedAt = now;
  t.repairs++;
  say(c, { kind: "repair", truck: i, spent, wheelsBack });
  return { spent, wheelsBack };
}

/** The engine's share of its power: `ENGINE_FLOOR` on its last hit point, `CRAWL.throttle` at none. */
export const enginePower = (c, i) => (c.trucks[i].engine <= 0 ? CRAWL.throttle : ENGINE_FLOOR + (1 - ENGINE_FLOOR) * (c.trucks[i].engine / c.full.engine));
/** Whether truck `i` only crawls: its engine or its gearbox dead. */
export const crawling = (c, i) => c.trucks[i].engine <= 0 || c.trucks[i].gearbox <= 0;
/** The gearbox's share of its hit points. */
export const gearboxHealth = (c, i) => c.trucks[i].gearbox / c.full.gearbox;

/**
 * The gearbox's step on truck `i`'s controls (`{ gear }`), with `gears` ({ NEUTRAL, FIRST, SECOND, THIRD }), `memory`
 * its own (`{ last, missUntil, target }`), the clock `now` and a random number in [0, 1). At no hit points it is
 * stuck in first; under `GEARBOX_MISS` an upshift may miss, out of gear for `MISS_S`.
 */
export function gearboxStep(c, i, controls, gears, memory, now, roll) {
  const health = gearboxHealth(c, i);
  if (memory.missUntil > now) { controls.gear = gears.NEUTRAL; return; }
  if (memory.target !== null && memory.target !== undefined) {
    // The missed gear goes in at last; it is not another shift.
    controls.gear = memory.target;
    memory.last = memory.target;
    memory.target = null;
  }
  if (health <= 0 && controls.gear > gears.FIRST) controls.gear = gears.FIRST;
  const up = memory.last >= gears.FIRST && controls.gear > memory.last;
  if (up && health < GEARBOX_MISS && roll < MISS_MOST * (GEARBOX_MISS - health) / GEARBOX_MISS) {
    memory.target = controls.gear;
    memory.missUntil = now + MISS_S;
    controls.gear = gears.NEUTRAL;
  }
  memory.last = controls.gear === gears.NEUTRAL ? memory.last : controls.gear;
}

/**
 * The places: trucks still running by the race's places (those home first, by their places), then the wrecked, the
 * last wrecked first. `raceTrucks` are the race's (`place`, `finished`).
 */
export function combatPlaces(c, raceTrucks) {
  const alive = raceTrucks.map((rt, i) => i).filter((i) => running(c.trucks[i]));
  alive.sort((a, b) => (raceTrucks[a].place ?? 99) - (raceTrucks[b].place ?? 99));
  const out = [...alive.filter((i) => raceTrucks[i].finished), ...alive.filter((i) => !raceTrucks[i].finished), ...[...c.order].reverse()];
  for (let i = 0; i < raceTrucks.length; i++) if (!out.includes(i)) out.push(i);
  const places = new Array(raceTrucks.length);
  out.forEach((i, n) => { places[i] = n + 1; });
  return places;
}

/** The last truck running, when only one is left of two or more and none still running is home yet; else -1. */
export function lastStanding(c, raceTrucks) {
  const alive = c.trucks.map((t, i) => i).filter((i) => running(c.trucks[i]));
  if (c.trucks.length < 2 || alive.length !== 1 || raceTrucks.some((rt, i) => rt.finished && running(c.trucks[i]))) return -1;
  return alive[0];
}

/** A truck's state for the view and the HUD: shares of its pools (0 to 1), its wheels, credits and standing. */
export function combatTruckView(c, i) {
  const t = c.trucks[i], full = c.full;
  return {
    hp: t.global / full.global, engine: t.engine / full.engine, gearbox: t.gearbox / full.gearbox,
    wheels: t.wheels.map((w, n) => (t.lost[n] ? -1 : w / full.wheel)), credits: Math.floor(t.credits), dealt: Math.round(t.dealt),
    wrecks: t.wrecks, wrecked: t.wrecked, quit: t.quit, cost: repairCost(c, i),
  };
}

/*
  Online (docs/EXTENSIONS.md, "Over the network"). Truck indexes travel as vehicle numbers (net-wire.js). The owner's
  state: the end, the winner and the order the trucks went out in. Each machine's own: the trucks it judges (pools as
  shares, so a machine set to another toughness reads them in its own), and the credits it owes the others' trucks.
*/
const shareOf = (x) => Math.max(0, Math.min(1, Number(x) || 0));

export function combatToWire(s, vehicleOf) {
  return {
    over: !!s.over, winner: vehicleIndex(s.winner ?? -1, vehicleOf), order: (s.order ?? []).map((i) => vehicleOf(i) ?? 0), events: s.events | 0,
    rules: s.rules ? { toughness: String(s.rules.toughness), credits: !!s.rules.credits, startCredits: Number(s.rules.startCredits) || 0 } : null,
  };
}
export function combatFromWire(d, localOf) {
  const rules = d.rules && typeof d.rules === "object" && TOUGHNESS[d.rules.toughness]
    ? { toughness: d.rules.toughness, credits: !!d.rules.credits, startCredits: Math.max(0, Number(d.rules.startCredits) || 0) } : null;
  return {
    over: !!d.over, winner: localIndex(d.winner, localOf), events: d.events | 0, rules,
    order: (Array.isArray(d.order) ? d.order : []).map((v) => localIndex(v, localOf)).filter((i) => i >= 0),
  };
}

export function combatOwnToWire(s, vehicleOf) {
  const trucks = {}, owed = {};
  (s.trucks ?? []).forEach((e, i) => {
    if (e) trucks[vehicleOf(i)] = { ...e, by: vehicleIndex(e.by ?? -1, vehicleOf) };
  });
  (s.owed ?? []).forEach((o, i) => { if (o && (o.hp > 0 || o.wrecks > 0)) owed[vehicleOf(i)] = { hp: o.hp, wrecks: o.wrecks }; });
  return { trucks, owed };
}
export function combatOwnFromWire(d, localOf, count) {
  const trucks = fromVehicles(d.trucks, localOf, count, null).map((e) => (e && typeof e === "object" ? {
    g: shareOf(e.g), e: shareOf(e.e), b: shareOf(e.b), w: [0, 1, 2, 3].map((w) => shareOf(e.w?.[w])), l: [0, 1, 2, 3].map((w) => !!e.l?.[w]),
    cr: Math.max(0, Number(e.cr) || 0), d: Math.max(0, Number(e.d) || 0), wk: e.wk | 0, rp: e.rp | 0, wr: !!e.wr, q: !!e.q, by: localIndex(e.by, localOf),
  } : null));
  const owed = fromVehicles(d.owed, localOf, count, null).map((o) => (o && typeof o === "object" ? { hp: Math.max(0, Number(o.hp) || 0), wrecks: Math.max(0, o.wrecks | 0) } : null));
  return { trucks, owed };
}
