/*
  Loose Wheels (docs/EXTENSIONS.md, "Mutator: Loose Wheels"), an OpenMTM2 addition: Combat's wheels in every race. It is
  a mutator, not a mode: it rides on whatever race is run (circuit, rally, summit, drag, free roam, and a mode that asks
  for it), and changes nothing but the wheels.

  - Wear: every wheel has Combat's pool (250 hit points). A hit, measured as Combat measures it (impactOf), wears the
    wheels at the struck corner by Combat's shares, each at most WHEEL_CAP of its pool in one hit; a roll at speed wears
    all four by Combat's roll cost. A wheel struck again once its pool is empty comes off.
  - Hard hits: a hit of `popAt` or more takes the struck wheel off at once; one of `axleAt` or more tears the struck
    end's axle away, both wheels with it (Combat's `wreckShed`).
  - A lost wheel is thrown as a loose object, and the truck limps on the bare axle end (loose-wheels-core.js).
  - Getting them back: `repairS` seconds after the last wheel came off every wheel and axle is restored (the computer
    trucks always, at `repairS` or, when the player's is off, at `cpuRepairS`); or the pit crew (the Crash Damage key,
    X): the truck is held still for `pitS` seconds, then restored, worn wheels and the body's dents too. Another wheel
    lost while waiting starts the wait (or the pit crew's hold) again.
  - The body: a hit that counts dents the struck corner's hull zones (`dentsOf`), on top of the game's own crash damage.
  There are no hit points for the truck, no engine or gearbox wear, no wrecks and no credits.

  The rules are pure, so they run under Node; the simulation worker's side is loose-wheels-session.js.
*/
import { msg } from "../strings.js";
import { COMBAT_HP, IMPACT, SHARES, WHEEL_CAP, wheelAt, wreckShed } from "./combat.js";

export const LOOSE_WHEELS = Object.freeze({
  /** A wheel's pool. */
  wheel: COMBAT_HP.wheel,
  /** A hit this big takes the struck wheel off at once; this big, the struck end's axle. */
  popAt: 150, axleAt: 260,
  /** The pit crew's hold, and the computer trucks' wait when the player's auto-repair is off, seconds. */
  pitS: 2, cpuRepairS: 8,
});
/** The Auto-repair choices (Options, Game), seconds; 0 is never (the pit crew only). */
export const REPAIR_CHOICES = Object.freeze([5, 8, 12, 0]);
export const DEFAULT_REPAIR_S = 8;

/** The messages the race shows the player. */
export const LOOSE_WHEEL_TEXT = Object.freeze({
  off: msg("Wheel off! X for the pit crew"),
  offAuto: msg("Wheel off! X for the pit crew, or it is back on in <<1>> s"),
  axle: msg("Axle gone! X for the pit crew"),
  pit: msg("Pit crew: wheels back on in <<1>> s"),
  back: msg("Wheels back on"),
  nothing: msg("Nothing to fix"),
});

/** A truck's wheels: pools, which are off, which axles are gone, and its repair under way. */
export function createWheelState(full = LOOSE_WHEELS.wheel) {
  return { wheels: [full, full, full, full], lost: [false, false, false, false], axles: [false, false], downSince: null, pitUntil: null, repairs: 0, pits: 0 };
}

/** Whether a truck has anything for the pit crew: a wheel off or worn. */
export const needsRepair = (t, full = LOOSE_WHEELS.wheel) => t.lost.some(Boolean) || t.wheels.some((w) => w < full);

/**
 * A hit `impact` (`impactOf`, its `amount` already scaled for a hit between trucks) on truck wheels `t`. Returns the
 * wheels that came off, and `axle` the axle torn away (0 front, 1 rear) or -1. `now` starts the auto-repair's clock.
 */
export function wheelHit(t, impact, now = 0, T = LOOSE_WHEELS) {
  const out = { off: [], axle: -1 };
  const amount = impact.amount;
  if (!(amount >= IMPACT.least)) return out;
  const cap = T.wheel * WHEEL_CAP;
  const knock = (w) => { if (!t.lost[w]) { t.lost[w] = true; t.wheels[w] = 0; out.off.push(w); } };
  if (impact.kind === "roll") {
    // A roll wears every wheel, never takes one off.
    for (let w = 0; w < 4; w++) if (!t.lost[w]) t.wheels[w] = Math.max(0, t.wheels[w] - Math.min(amount, cap));
  } else if (amount >= T.axleAt) {
    // The struck end's axle (the other one when that is already gone), both its wheels with it.
    const end = impact.end ?? 1;
    const before = [...t.lost];
    for (const w of wreckShed(t, end)) { t.wheels[w] = 0; if (!before[w]) out.off.push(w); }
    if (out.off.length) out.axle = out.off[0] < 2 ? 0 : 1;
    if (out.axle >= 0) t.axles[out.axle] = true;
  } else {
    const near = wheelAt(impact.end, impact.side);
    if (amount >= T.popAt) knock(near);
    const wear = (w, share) => {
      if (t.lost[w] || !(share > 0)) return;
      const before = t.wheels[w];
      t.wheels[w] = Math.max(0, before - Math.min(amount * share, cap));
      if (before <= 0) knock(w);
    };
    const shares = SHARES[impact.kind];
    if (impact.kind === "front" || impact.kind === "rear") { wear(near, shares.near); wear(near ^ 1, shares.far); }
    else if (impact.kind === "side") { wear(near, shares.near); wear(near ^ 2, shares.far); }
    else if (impact.kind === "landing") {
      // A landing wears all four; only a hard one (`popAt`) takes the low corner's wheel off.
      for (let w = 0; w < 4; w++) if (!t.lost[w]) t.wheels[w] = Math.max(0, t.wheels[w] - Math.min(amount * shares.each, cap));
    }
  }
  // Every wheel lost starts the wait again, and the pit crew's hold when it is at work.
  if (out.off.length) {
    t.downSince = now;
    if (t.pitUntil !== null) t.pitUntil = now + T.pitS;
  }
  return out;
}

/**
 * Everything back: every wheel on with a full pool, every axle, no repair under way; `pit` when the pit crew did it
 * (the body's dents go too). The arrays are kept and refilled: the lost-wheel ground (combat-ground.js) holds `lost`.
 */
export function restoreWheels(t, full = LOOSE_WHEELS.wheel, { pit = false } = {}) {
  t.wheels.fill(full);
  t.lost.fill(false);
  t.axles.fill(false);
  t.downSince = null;
  t.pitUntil = null;
  t.repairs++;
  if (pit) t.pits++;
}

/**
 * The hull zones (1 to 12, the truck's scrape points) a hit at a corner dents: the points on the struck end and side,
 * the outermost two; a landing or a roll dents none (the hull's own contacts do). `force` is for the game's levels
 * (crash-damage.js: 1 to 10000 lb, 2 to 30000, 3 above), `steps` how many pushes.
 */
export function dentsOf(scrapePoints, impact) {
  if (!scrapePoints?.length || impact.kind === "landing" || impact.kind === "roll" || !(impact.amount >= IMPACT.least)) return [];
  const side = impact.side >= 0 ? 1 : -1, end = impact.end >= 0 ? 1 : -1;
  const picked = scrapePoints.map((p, k) => ({ zone: k + 1, p }))
    .filter(({ p }) => Math.sign(p[0]) === side && Math.sign(p[2]) === end)
    .sort((a, b) => Math.abs(b.p[2]) - Math.abs(a.p[2])).slice(0, 2);
  const force = impact.amount * 200, steps = Math.min(4, 1 + Math.floor(impact.amount / 60));
  return picked.map(({ zone }) => ({ zone, steps, force }));
}

/** The pit crew called at `now`: the truck is held for `pitS`. False when there is nothing to fix or it is already on it. */
export function callPit(t, now, T = LOOSE_WHEELS) {
  if (t.pitUntil !== null || !needsRepair(t, T.wheel)) return false;
  t.pitUntil = now + T.pitS;
  return true;
}

/** Whether a truck's repair is due at `now`: the pit crew done, or its auto-repair's wait (`repairS`, 0 never) over. */
export function repairDue(t, now, repairS) {
  if (t.pitUntil !== null) return now >= t.pitUntil;
  return repairS > 0 && t.downSince !== null && now - t.downSince >= repairS;
}

/** A truck's wheels for the drawing and the HUD, in Combat's shape (`combatTruckView`): a lost wheel's share is -1. */
export function wheelView(t, now, repairS, full = LOOSE_WHEELS.wheel) {
  return {
    wheels: t.wheels.map((w, n) => (t.lost[n] ? -1 : w / full)), axles: [...t.axles], engine: 1, wrecked: false,
    pit: t.pitUntil === null ? null : Math.max(0, t.pitUntil - now),
    back: t.pitUntil === null && repairS > 0 && t.downSince !== null ? Math.max(0, t.downSince + repairS - now) : null,
    repairs: t.repairs, pits: t.pits,
  };
}

/**
 * The damage figure on the timing board and over the names (a whole percent): how much of its weakest wheel's pool a
 * truck has left before a wheel comes off and the wait starts. 0 only with a wheel off; a wheel worn to nothing but
 * still on shows 1. `view` is the truck's `wheelView` (a lost wheel's share is -1).
 */
export function damagePercent(view) {
  if (!view?.wheels?.length) return 100;
  if (view.wheels.some((w) => w < 0)) return 0;
  return Math.max(1, Math.min(100, Math.round(Math.min(...view.wheels) * 100)));
}

/** The board's damage line: the percent, and with a wheel off the pit crew's or the wait's seconds left. */
export function damageText(view) {
  const p = damagePercent(view);
  if (view?.pit !== null && view?.pit !== undefined) return { percent: p, extra: Math.ceil(view.pit), pit: true };
  if (p === 0 && view?.back !== null && view?.back !== undefined) return { percent: p, extra: Math.ceil(view.back), pit: false };
  return { percent: p, extra: null, pit: false };
}
