/*
  Freestyle (docs/EXTENSIONS.md, "Shipped extension: Freestyle"), after the freestyle runs of monster truck shows such
  as Monster Jam: one truck alone on any track for a set time, judged on what it does with it. An addition, not in the
  game; every threshold here is OpenMTM2's own.

  The judge watches the truck step by step (the simulation worker feeds it, freestyle-session.js) and keeps seven
  categories, each worth a share of the 10 points a run can score, less the deductions:

    time used 1, speed and momentum 1.5, aggression 1.5, air 2, tricks 2, saves 1, spectacular moments 1;
    deductions for reversing without purpose and for crashes.

  A category's raw points fill it up to a ceiling that grows with the run's length (a longer run must show more), so
  the score reads like a judge's 0.0 to 10.0. Pure, so it runs under Node.

  Body axes: x right, y up, z forward; `matrix` row-major body to world, so the world y of the right, up and forward
  axes are matrix[3], matrix[4] and matrix[5]. Tires are FR, FL, RR, RL.
*/
import { msg } from "../strings.js";

export const DEFAULT_FREESTYLE_MINUTES = 2;
export const FREESTYLE_EXTENSION = Object.freeze({
  id: "freestyle",
  name: msg("Freestyle"),
  description: msg("One truck, any track, against the clock: big air, wheelies, donuts, flips, hits and saves are judged out of 10. Use all the time and keep moving; reversing without a reason costs points."),
  length: Object.freeze({ key: "minutes", label: msg("Minutes"), default: DEFAULT_FREESTYLE_MINUTES, min: 1, max: 10 }),
  settings: Object.freeze([
    Object.freeze({ key: "minutes", label: msg("Run length"), type: "number", min: 1, max: 10, default: DEFAULT_FREESTYLE_MINUTES, suffix: msg("minutes") }),
    Object.freeze({ key: "trickPhysics", label: msg("Trick physics (throttle and brake tilt the truck in the air)"), type: "boolean", default: true }),
  ]),
  acceptsTrack: () => true,
  trackLocked: false,
  // The truck drives alone: no computer opponents, no spectator mode, not offered in online rooms.
  maxEntrants: 1,
  weather: null,
  detailLevel: null,
});

/**
 * Trick physics (docs/EXTENSIONS.md, "Trick physics"): OpenPhotex's optional handling, under MTM2's physics model only.
 * In the air the pedals pitch the truck (rad/s² a full pedal) and spins are damped a quarter as hard; with the wheels
 * down the yaw is damped half as hard. Measured headless on KF2's Orlando Monster Show.
 */
export const TRICK_PHYSICS = Object.freeze({ airPitchControl: 5, airRotationDamping: 0.25, groundYawDamping: 0.5 });

/** The race's physics rules with Trick physics on them when the run asks for it and the model is MTM2's. */
export function freestyleRules(payload, rules) {
  if (payload?.trickPhysics === false || rules?.id !== "mtm2") return rules;
  return Object.freeze({ ...rules, ...TRICK_PHYSICS });
}

/** The categories in the order they are shown, with their share of the 10 points and their raw ceiling per minute. */
export const CATEGORIES = Object.freeze([
  Object.freeze({ key: "time", label: msg("Time used"), weight: 1, perMinute: null }),
  Object.freeze({ key: "momentum", label: msg("Speed and momentum"), weight: 1.5, perMinute: null }),
  Object.freeze({ key: "aggression", label: msg("Aggression"), weight: 1.5, perMinute: 12 }),
  Object.freeze({ key: "air", label: msg("Air"), weight: 2, perMinute: 40 }),
  Object.freeze({ key: "tricks", label: msg("Tricks"), weight: 2, perMinute: 40 }),
  Object.freeze({ key: "saves", label: msg("Saves"), weight: 1, perMinute: 1.5 }),
  Object.freeze({ key: "spectacular", label: msg("Spectacular moments"), weight: 1, perMinute: 1 }),
]);

/** What the judge looks for; feet, seconds, radians. */
export const JUDGE = Object.freeze({
  /** Momentum: at least this fast (or in the air) is flowing; slower than `stallFtS` for `stallS` is a stall. */
  flowFtS: 25, stallFtS: 5, stallS: 3, stallCost: 0.1,
  /** A jump: all four wheels off for at least this long. */
  jumpMinS: 0.5,
  /** Air points: per second aloft, per foot of height over the take-off, per foot of length, for nose up or down past 30 degrees. */
  airPerS: 4, airPerHeightFt: 0.15, airPerLengthFt: 0.05, airVertical: 12,
  /** Huge air: a spectacular moment. */
  hugeHeightFt: 40, hugeLengthFt: 150, hugeAirS: 3,
  /**
   * A wheelie: the front wheels up, a rear one down, the nose past `startY` up (forward axis' world y, about 10 degrees),
   * reaching `wheelieY` (about 20 degrees) and held `wheelieMinS`; a stoppie the other way. Sky: past `skyY` (about 50
   * degrees) for `skyMinS`. Measured on MTM2's physics (docs/EXTENSIONS.md, "Freestyle"): the engine cannot lift the
   * nose, so wheelies come from ramps and landings and the brake, not the throttle, makes them last.
   */
  wheelieY: 0.35, startY: 0.17, skyY: 0.77, skyMinS: 0.3, wheelieMinS: 0.75, stoppieMinS: 0.75,
  wheeliePoints: 3, wheeliePerS: 3, wheelieMost: 15, stoppiePoints: 4, stoppiePerS: 4, skyBonus: 6,
  /** A slap wheelie: a wheelie begun this soon after landing a jump. */
  slapS: 0.6, slapBonus: 3,
  /** A moonwalk: a wheelie going backwards at least this fast; its points count half again. */
  moonwalkFtS: 5, moonwalkFactor: 1.5,
  /**
   * A donut: a whole turn of yaw one way within `donutWindowS`, two wheels down, at `donutFtS` or more; each scores, at
   * most `donutMost` in a set. A set ends after `donutGapS` without wheels down and speed, or turning back the other way
   * (faster than `donutTurnBack`). Holding the throttle and a turn key does it; Trick physics makes it easier.
   */
  donutWindowS: 4.5, donutFtS: 8, donutGapS: 0.5, donutPoints: 4, donutMost: 5, donutTurnBack: 0.2,
  /** A flip or a roll: this share of a full turn about the pitch or roll axis, landed on its wheels within `landS`. */
  turnShare: 0.85, flipPoints: 25, rollPoints: 20, attemptPoints: 5, landS: 1.5, landedUp: 0.6,
  /** A save: the truck past this (up axis' world y) with two wheels or fewer down, back on four upright within `saveS`. */
  dangerUp: 0.35, uprightUp: 0.85, saveS: 4, bigSaveUp: 0.15,
  /** A hit: an object met at this closing speed at least; one object counts again only after `hitGapS`. */
  hitFtS: 10, hitMostFtS: 60, hitGapS: 1.5,
  /** Tricks one after another within this long build a combo; this many in one is a spectacular moment. */
  comboS: 2, comboMoment: 3,
  /** Reversing: backwards faster than this in reverse gear; forgiven when a jump or a hit follows within `reverseGraceS`. */
  reverseFtS: 4, reverseGraceS: 3, reversePerS: 0.05, reverseMost: 1,
  /** A crash: upside down (up below this) for `crashS`, or the helicopter called; each costs this much, up to `crashMost`. */
  crashUp: -0.2, crashS: 1, crashCost: 0.4, crashMost: 1.6,
});

/** The names a judged moment is announced by. */
export const MOMENT_NAMES = Object.freeze({
  jump: msg("Big air!"), hugeAir: msg("Huge air!"), wheelie: msg("Wheelie!"), skyWheelie: msg("Sky wheelie!"), slapWheelie: msg("Slap wheelie!"),
  stoppie: msg("Nose wheelie!"), moonwalk: msg("Moonwalk!"), donut: msg("Donut!"), donuts: msg("Donuts x<<1>>!"),
  backFlip: msg("Back flip!"), frontFlip: msg("Front flip!"), roll: msg("Barrel roll!"), flipAttempt: msg("Flip attempt"),
  save: msg("Save!"), bigSave: msg("What a save!"), hit: msg("Hit!"), combo: msg("Combo x<<1>>!"), crash: msg("Crash!"),
});

const FULL_TURN = Math.PI * 2;

/** A donut set: its turns, the yaw since it began, the yaw over the last `donutWindowS` and the way it turns. */
const newDonut = () => ({ angle: 0, turns: 0, idle: 0, sign: 0, trail: [] });

/** A run of `roundSeconds`. */
export function createFreestyle(roundSeconds) {
  return {
    roundSeconds,
    raw: { aggression: 0, air: 0, tricks: 0, saves: 0, spectacular: 0 },
    clock: 0, flowTime: 0, slowFor: 0, stalls: 0, stalled: false,
    jump: null, landedAt: -Infinity,
    wheelie: null, donut: newDonut(),
    spin: { pitch: 0, roll: 0, done: null, allDown: 0 },
    danger: null,
    reverse: { pending: 0, since: -Infinity, total: 0 },
    crash: { over: 0, counted: false, upright: 0 }, crashes: 0, heli: false,
    hits: new Map(),
    combo: { count: 0, at: -Infinity },
    moments: [], events: 0, used: 0, done: false,
  };
}

/** Announce a moment: kept for the HUD (the last few), counted for the combo when it is a trick. */
function moment(g, kind, extra = {}, trick = true) {
  const m = { kind, at: g.clock, ...extra };
  g.moments.push(m);
  if (g.moments.length > 8) g.moments.shift();
  g.events++;
  if (trick) {
    g.combo.count = g.clock - g.combo.at <= JUDGE.comboS ? g.combo.count + 1 : 1;
    g.combo.at = g.clock;
    if (g.combo.count === JUDGE.comboMoment) { g.raw.spectacular += 1; moment(g, "combo", { count: g.combo.count }, false); }
  }
  return m;
}

/** A spectacular moment, counted with the moment that made it (which is what is announced). */
function spectacular(g) {
  g.raw.spectacular += 1;
}

function forgiveReverse(g) { g.reverse.pending = 0; }

/**
 * One step of `dt` seconds. `t` is what the truck is doing:
 * `{ pos, up, forwardY, rightY, speed, forward (body z speed, ft/s), rates: [p, q, r], wheels: [4 booleans],
 *    reverse (in reverse gear), heli (the helicopter has it), hit: { id, force } | null (an object met) }`.
 */
export function freestyleStep(g, dt, t) {
  if (g.done) return;
  g.clock += dt;
  const down = t.wheels.filter(Boolean).length;
  const airborne = down === 0;
  const fronts = (t.wheels[0] ? 1 : 0) + (t.wheels[1] ? 1 : 0), rears = (t.wheels[2] ? 1 : 0) + (t.wheels[3] ? 1 : 0);

  // Crashes: upside down for a moment, or the helicopter called. The combo breaks and every trick in progress is lost.
  if (t.heli && !g.heli) crashed(g);
  g.heli = !!t.heli;
  if (t.heli) { g.jump = null; g.wheelie = null; g.danger = null; g.spin = { pitch: 0, roll: 0, done: null, allDown: 0 }; return; }
  if (t.up < JUDGE.crashUp) {
    g.crash.over += dt;
    g.crash.upright = 0;
    if (g.crash.over >= JUDGE.crashS && !g.crash.counted) { g.crash.counted = true; crashed(g); }
  } else {
    g.crash.over = 0;
    if (t.up > JUDGE.uprightUp) { g.crash.upright += dt; if (g.crash.upright > 2) g.crash.counted = false; }
  }

  // Speed and momentum.
  if (t.speed >= JUDGE.flowFtS || airborne) g.flowTime += dt;
  if (t.speed < JUDGE.stallFtS && !airborne) {
    g.slowFor += dt;
    if (g.slowFor >= JUDGE.stallS && !g.stalled) { g.stalled = true; g.stalls++; }
  } else { g.slowFor = 0; g.stalled = false; }

  // Aggression: objects met hard, each one again only after a while.
  if (t.hit && t.hit.force >= JUDGE.hitFtS) {
    const last = g.hits.get(t.hit.id) ?? -Infinity;
    if (g.clock - last >= JUDGE.hitGapS) {
      g.raw.aggression += Math.min(t.hit.force, JUDGE.hitMostFtS) / 10;
      moment(g, "hit", { force: t.hit.force }, false);
      // Backing into an obstacle, or over it backwards, is a reason to reverse.
      if (t.forward < 0) forgiveReverse(g);
    }
    g.hits.set(t.hit.id, g.clock);
  }

  // Jumps.
  if (airborne) {
    if (!g.jump) {
      g.jump = { start: g.clock, from: [...t.pos], peak: t.pos[1], vertical: 0 };
      // Reversing to gain room for a jump is fine.
      if (g.clock - g.reverse.since <= JUDGE.reverseGraceS || t.reverse) forgiveReverse(g);
    }
    g.jump.peak = Math.max(g.jump.peak, t.pos[1]);
    g.jump.vertical = Math.max(g.jump.vertical, Math.abs(t.forwardY));
  } else if (g.jump) {
    const j = g.jump, time = g.clock - j.start;
    g.jump = null;
    if (time >= JUDGE.jumpMinS) {
      const height = Math.max(0, j.peak - j.from[1]), length = Math.hypot(t.pos[0] - j.from[0], t.pos[2] - j.from[2]);
      const points = JUDGE.airPerS * time + JUDGE.airPerHeightFt * height + JUDGE.airPerLengthFt * length
        + JUDGE.airVertical * Math.max(0, j.vertical - 0.5);
      g.raw.air += points;
      g.landedAt = g.clock;
      const huge = height >= JUDGE.hugeHeightFt || length >= JUDGE.hugeLengthFt || time >= JUDGE.hugeAirS;
      moment(g, huge ? "hugeAir" : "jump", { time, height, length, points });
      if (huge) spectacular(g);
    }
  }

  // Wheelies, stoppies and moonwalks.
  const wheelieNow = fronts === 0 && rears > 0 && t.forwardY >= JUDGE.startY;
  const stoppieNow = rears === 0 && fronts > 0 && t.forwardY <= -JUDGE.startY;
  if (wheelieNow || stoppieNow) {
    const kind = wheelieNow ? "wheelie" : "stoppie";
    if (!g.wheelie || g.wheelie.kind !== kind) {
      endWheelie(g);
      g.wheelie = { kind, start: g.clock, slap: kind === "wheelie" && g.clock - g.landedAt <= JUDGE.slapS, sky: 0, back: 0, peak: 0 };
    }
    g.wheelie.peak = Math.max(g.wheelie.peak, Math.abs(t.forwardY));
    if (Math.abs(t.forwardY) >= JUDGE.skyY) g.wheelie.sky += dt;
    if (t.forward <= -JUDGE.moonwalkFtS) g.wheelie.back += dt;
  } else endWheelie(g);

  // Donuts: a whole turn of yaw one way within `donutWindowS`, wheels down and moving, whatever the rate step by step.
  const r = t.rates[2], d = g.donut;
  if (down >= 2 && t.speed >= JUDGE.donutFtS) {
    d.idle = 0;
    // Turning the other way starts a new set.
    if (d.sign && Math.abs(r) > JUDGE.donutTurnBack && Math.sign(r) !== d.sign) g.donut = newDonut();
    const e = g.donut;
    if (Math.abs(r) > JUDGE.donutTurnBack) e.sign = Math.sign(r);
    e.angle += r * dt;
    e.trail.push([g.clock, e.angle]);
    while (g.clock - e.trail[0][0] > JUDGE.donutWindowS) e.trail.shift();
    if (Math.abs(e.angle - e.trail[0][1]) >= FULL_TURN) {
      e.turns++;
      e.trail = [[g.clock, e.angle]];
      // Circling on cannot fill the category on its own.
      if (e.turns <= JUDGE.donutMost) {
        g.raw.tricks += JUDGE.donutPoints;
        moment(g, "donut", { turns: e.turns });
      }
    }
  } else if ((d.idle += dt) >= JUDGE.donutGapS) g.donut = newDonut();

  // Flips and barrel rolls: the turn about the pitch and roll axes while not on all four.
  const s = g.spin;
  if (down < 4) {
    s.allDown = 0;
    s.pitch += t.rates[1] * dt;
    s.roll += t.rates[0] * dt;
    // The way it turned names the flip (q < 0 is nose up: back). Not the way the nose went first: off a ramp lip the
    // nose always goes up first, front flip or back.
    if (!s.done && Math.abs(s.pitch) >= JUDGE.turnShare * FULL_TURN) s.done = { kind: s.pitch < 0 ? "backFlip" : "frontFlip", at: g.clock };
    else if (!s.done && Math.abs(s.roll) >= JUDGE.turnShare * FULL_TURN) s.done = { kind: "roll", at: g.clock };
  }
  if (s.done) {
    const landed = down >= 3 && t.up >= JUDGE.landedUp;
    if (landed) {
      g.raw.tricks += s.done.kind === "roll" ? JUDGE.rollPoints : JUDGE.flipPoints;
      moment(g, s.done.kind);
      spectacular(g);
      g.spin = { pitch: 0, roll: 0, done: null, allDown: 0 };
    } else if (g.clock - s.done.at > JUDGE.landS && down >= 2) {
      g.raw.tricks += JUDGE.attemptPoints;
      moment(g, "flipAttempt");
      g.spin = { pitch: 0, roll: 0, done: null, allDown: 0 };
    }
  } else if (down === 4 && (s.allDown += dt) >= 0.3) g.spin = { pitch: 0, roll: 0, done: null, allDown: s.allDown };

  // Saves: past the danger line on two wheels or fewer, back on four and upright without crashing.
  if (t.up < JUDGE.dangerUp && down <= 2 && t.up > JUDGE.crashUp) {
    if (!g.danger) g.danger = { start: g.clock, least: t.up };
    g.danger.least = Math.min(g.danger.least, t.up);
  } else if (g.danger) {
    if (t.up <= JUDGE.crashUp || g.clock - g.danger.start > JUDGE.saveS) g.danger = null;
    else if (down === 4 && t.up >= JUDGE.uprightUp) {
      const big = g.danger.least < JUDGE.bigSaveUp;
      g.raw.saves += big ? 1.5 : 1;
      moment(g, big ? "bigSave" : "save");
      if (big) spectacular(g);
      g.danger = null;
    }
  }

  // Reversing without purpose: counted once it is clear no jump or hit came of it.
  const backing = t.reverse && t.forward <= -JUDGE.reverseFtS && !(g.wheelie && g.wheelie.back > 0);
  if (backing) { g.reverse.pending += dt; g.reverse.since = g.clock; }
  else if (g.reverse.pending > 0 && g.clock - g.reverse.since > JUDGE.reverseGraceS) {
    g.reverse.total += g.reverse.pending;
    g.reverse.pending = 0;
  }
}

function endWheelie(g) {
  const w = g.wheelie;
  if (!w) return;
  g.wheelie = null;
  const held = g.clock - w.start;
  // Too shallow at its steepest is no wheelie, however long.
  if (w.peak < JUDGE.wheelieY) return;
  if (w.kind === "wheelie" && held >= JUDGE.wheelieMinS) {
    const moon = w.back >= held * 0.5, sky = w.sky >= JUDGE.skyMinS;
    let points = Math.min(JUDGE.wheelieMost, JUDGE.wheeliePoints + JUDGE.wheeliePerS * held);
    if (moon) points *= JUDGE.moonwalkFactor;
    if (w.slap) points += JUDGE.slapBonus;
    if (sky) points += JUDGE.skyBonus;
    g.raw.tricks += points;
    moment(g, moon ? "moonwalk" : sky ? "skyWheelie" : w.slap ? "slapWheelie" : "wheelie", { held });
  } else if (w.kind === "stoppie" && held >= JUDGE.stoppieMinS) {
    g.raw.tricks += Math.min(JUDGE.wheelieMost, JUDGE.stoppiePoints + JUDGE.stoppiePerS * held);
    moment(g, "stoppie", { held });
  }
}

function crashed(g) {
  g.crashes++;
  g.combo = { count: 0, at: -Infinity };
  g.wheelie = null;
  moment(g, "crash", {}, false);
}

/** The run is over after `used` seconds (the whole run when it ran out of time). */
export function freestyleEnd(g, used) {
  if (g.done) return;
  endWheelie(g);
  g.reverse.total += g.reverse.pending;
  g.reverse.pending = 0;
  g.used = Math.max(0, Math.min(g.roundSeconds, used));
  g.done = true;
}

/**
 * The score: `{ total, categories: [{ key, label, score, weight }], deductions: { reverse, crashes } }`, the total and
 * each category's score in points out of 10, to one decimal. While the run is on, `used` is the time so far: the
 * ceilings then follow the time gone, so the live score reads fairly.
 */
export function freestyleScore(g, used = g.done ? g.used : g.clock) {
  const minutes = Math.max(used, 1) / 60;
  const share = {
    time: g.roundSeconds > 0 ? Math.min(1, used / g.roundSeconds) : 0,
    momentum: Math.max(0, Math.min(1, used > 0 ? g.flowTime / used : 0) - g.stalls * JUDGE.stallCost),
  };
  // Time used only counts at the end: while the run is on, it is on track.
  if (!g.done) share.time = 1;
  const categories = CATEGORIES.map((c) => {
    const s = c.perMinute === null ? share[c.key] : Math.min(1, g.raw[c.key] / (c.perMinute * minutes));
    return { key: c.key, label: c.label, weight: c.weight, score: round1(s * c.weight) };
  });
  const reverse = round1(Math.min(JUDGE.reverseMost, g.reverse.total * JUDGE.reversePerS));
  const crashes = round1(Math.min(JUDGE.crashMost, g.crashes * JUDGE.crashCost));
  const sum = categories.reduce((total, c) => total + c.score, 0);
  return { total: round1(Math.max(0, Math.min(10, sum - reverse - crashes))), categories, deductions: { reverse, crashes } };
}

const round1 = (x) => Math.round(x * 10) / 10;

/** The text of a moment for the HUD. */
export function momentText(t, m) {
  if (m.kind === "donut" && m.turns > 1) return t(MOMENT_NAMES.donuts, m.turns);
  if (m.kind === "combo") return t(MOMENT_NAMES.combo, m.count);
  return MOMENT_NAMES[m.kind] ? t(MOMENT_NAMES[m.kind]) : null;
}
