/*
  Combat's runtime in the simulation worker (docs/EXTENSIONS.md; the rules are combat.js). It measures each truck's hits
  from its change of velocity step by step, with who it met (`touch`), and applies them; takes a lost wheel off the
  ground (combat-ground.js) and throws it as a loose object every truck can hit; drags the bare axle ends; holds a hurt
  engine's throttle and a hurt gearbox's gears; drives the computer trucks' rams (combat-ai.js); and keeps the places.
  A wrecked truck stops where it is, out of the race.
*/
import * as S from "../../vendor/openphotex/sim/mtm2/index.js";
import {
  adoptRules, IMPACT, STUB_DRAG_FT_S2, TOUCH_MEMORY_S, applyHit, combatPlaces, combatTruckView, createCombat, creditDamage, creditProgress,
  CRAWL, closingSpeed, crawling, ENGAGE, engageShare, enginePower, rollCost, truckShare, gearboxStep, impactOf, lastStanding, quit, ramShares, repair, running, say, wheelsOn, wreck,
} from "./combat.js";
import { lostWheelGround } from "./combat-ground.js";
import { createCombatDriver, ramPoint, ramStep, wantsRepair } from "./combat-ai.js";
import { seeded } from "./combat-debris.js";
import { createRumbleDriver, driveToPoint } from "../rumble-ai.js";

/** A loose wheel's mass (slugs, about 400 lb), and the most kept; the oldest goes first. */
export const LOOSE_WHEEL_SLUGS = 12, MOST_LOOSE = 12;
/** The impacts kept for the drawing's debris. */
export const HITS_KEPT = 24;
/** A truck one stretch past its next checkpoint and this far from its gate has missed it (feet). */
const FAR_FROM_GATE_FT = 250;
/** A hit lasts at most this many steps before it is counted. */
const HIT_STEPS = 8;
/** How fast a truck's "fastest lately" eases down (ft/s a second), for the cost of a flip. */
const ROLL_EASE_FT_S2 = 40;

const toBody = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const toWorld = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const worldVelocity = (s) => toWorld(s.matrix, s.bvel);

/** The course's stretch nearest a point (x and z), by its index; `course` is the oriented course (straights and arcs). */
export function courseSegmentOf(course, pos) {
  let best = 0, bestD = Infinity;
  course.forEach((seg, i) => {
    let x, z;
    if (seg.ctype === 2) {
      const span = Math.atan2(Math.sin(seg.exitAngle - seg.entryAngle), Math.cos(seg.exitAngle - seg.entryAngle));
      const rel = Math.atan2(pos[0] - seg.centre[0], pos[2] - seg.centre[2]) - seg.entryAngle;
      const u = Math.abs(span) < 1e-6 ? 0 : Math.min(1, Math.max(0, Math.atan2(Math.sin(rel), Math.cos(rel)) / span));
      const angle = seg.entryAngle + span * u;
      x = seg.centre[0] + Math.sin(angle) * seg.radius; z = seg.centre[2] + Math.cos(angle) * seg.radius;
    } else {
      const dx = seg.end[0] - seg.start[0], dz = seg.end[2] - seg.start[2], length2 = dx * dx + dz * dz || 1;
      const u = Math.min(1, Math.max(0, ((pos[0] - seg.start[0]) * dx + (pos[2] - seg.start[2]) * dz) / length2));
      x = seg.start[0] + dx * u; z = seg.start[2] + dz * u;
    }
    const d = Math.hypot(x - pos[0], z - pos[2]);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/**
 * Whether a truck on stretch `segment` has run past stretch `next` (where its next checkpoint is) on a course of `count`
 * stretches: within the half of the course ahead of it.
 */
export const pastCheckpoint = (segment, next, count) => {
  const ahead = (((segment - next) % count) + count) % count;
  return ahead > 0 && ahead <= count / 2;
};

export function createCombatRuntime(payload, env) {
  const { trucks, race, step, watchHeadway } = env;
  const c = createCombat(trucks.length, { toughness: payload.toughness, credits: payload.credits !== false, startCredits: payload.startCredits });
  const aggression = payload.aggression ?? "normal";
  const clock = () => race.clock - race.startTime;
  /** Each truck's lost wheels (the ground wrapper reads them), its hit under way, its last meeting with another truck. */
  const per = trucks.map((t, i) => ({
    lost: [false, false, false, false], hit: null, met: null, prevVel: null, gearbox: { last: S.GEAR.FIRST, missUntil: 0, target: null },
    rand: seeded(0x9e3779b9 ^ (i * 7919 + 1)), driver: createCombatDriver(), progress: 0, laps: 0,
    // Its fastest lately (ft/s, easing down), and whether it is over on its back or side now.
    fast: 0, over: false,
  }));
  trucks.forEach((t) => { t.extensionDriver = createRumbleDriver(0.6); });
  const loose = [];
  const hits = [];
  /** Each pair of trucks' fight (ENGAGE): when it began, when they last touched; by "a,b". */
  const fights = new Map();
  let nextId = 1, decided = null, winner = -1;

  /*
    Online (docs/EXTENSIONS.md, "Over the network"): only the machine that drives a truck sees its own crashes, so each
    machine judges the trucks it drives (its player's; the owner's also its computer trucks and any left by a player)
    and sends their state (`netOwn`); the others take it (`applyNetOwn`). Credits for damage dealt to a truck judged
    elsewhere are owed to it and sent with the state, as running totals. The owner alone decides the end (`netState`).
  */
  const net = env.net ?? null;
  const following = () => net?.authority === "follower";
  const remoteAtStart = trucks.map((t) => !!t.remote);
  const judgedHere = (i) => !!trucks[i] && !trucks[i].remote && (!remoteAtStart[i] || !following());
  /** Credits this machine owes other machines' trucks: running totals of hit points dealt and wrecks, by truck. */
  const owed = trucks.map(() => ({ hp: 0, wrecks: 0 }));
  /** What each other machine has owed this machine's trucks so far, by its sender truck. */
  const owedSeen = new Map();
  let rulesTaken = false;
  /** Who wrecked each truck (-1 nobody). */
  const wreckedBy = trucks.map(() => -1);
  /** Credit `by` for a hit: here when it is judged here, else owed to its machine. */
  const credit = (by, hp, wrecked) => {
    if (by < 0 || !trucks[by]) return;
    if (judgedHere(by)) { creditDamage(c, by, hp, wrecked); return; }
    owed[by].hp += hp;
    if (wrecked) owed[by].wrecks++;
  };

  /** Where a corner of truck `i` is in the world, and the way out from it. */
  const cornerOf = (i, side, end) => {
    const s = trucks[i].state;
    const body = [side * 3.5, 0.5, end * 6];
    const w = toWorld(s.matrix, body);
    return { pos: [s.pos[0] + w[0], s.pos[1] + w[1], s.pos[2] + w[2]], normal: w };
  };
  const hubOf = (i, wheel) => {
    const t = trucks[i], s = t.state, w = toWorld(s.matrix, t.params.hubs[wheel]);
    return [s.pos[0] + w[0], s.pos[1] + w[1], s.pos[2] + w[2]];
  };

  /** Throw truck `i`'s wheel off: a loose box with the hub's velocity, kicked out and up. */
  function throwWheel(i, wheel) {
    const t = trucks[i], s = t.state, p = t.params;
    per[i].lost[wheel] = true;
    const pos = hubOf(i, wheel);
    const side = wheel % 2 === 0 ? 1 : -1;
    const out = toWorld(s.matrix, [side * 14, 10, 0]);
    const v = worldVelocity(s);
    const box = S.createBox(pos, [p.tireWidthFt, p.tireRadiusFt * 2, p.tireRadiusFt * 2], LOOSE_WHEEL_SLUGS, [s.euler[0], s.euler[1], s.euler[2]]);
    box.extensionOwned = true;
    for (let k = 0; k < 3; k++) box.vel[k] = v[k] + out[k];
    box.bvel.set(toBody(box.matrix, box.vel));
    box.rates.set([(per[i].rand() - 0.5) * 6, side * 4, (per[i].rand() - 0.5) * 6]);
    const id = nextId++;
    loose.push({ id, truck: i, wheel, box, seed: id * 7919 });
    if (loose.length > MOST_LOOSE) loose.shift();
  }

  /** Truck `i` is out: it stops where it is and leaves the race. */
  function takeOut(i) {
    const rt = race.trucks[i];
    rt.outOfRace = true;
    rt.checkpoint = race.checkpoints.length;
    rt.finished = true;
    const t = trucks[i];
    t.recovery.autopilot = false;
    t.recovery.player = false;
  }

  /** Count truck `i`'s hit now that it is over. */
  function settle(i) {
    const h = per[i].hit;
    per[i].hit = null;
    if (!h || !running(c.trucks[i])) return;
    const met = per[i].met && clock() - per[i].met.at <= TOUCH_MEMORY_S ? per[i].met : null;
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
    hits.push({ id: nextId++, truck: i, kind: impact.kind, by: met ? met.other : -1, pos: where.pos, normal: met ? met.towardWorld : where.normal, force: result.taken, vel: worldVelocity(trucks[i].state) });
    if (hits.length > HITS_KEPT) hits.shift();
    for (const wheel of result.wheelsOff) {
      throwWheel(i, wheel);
      say(c, { kind: "wheel", truck: i, wheel, by: creditTo });
    }
    credit(creditTo, result.taken, result.wrecked);
    if (result.wrecked) {
      wreckedBy[i] = creditTo;
      wreck(c, i, creditTo);
      takeOut(i);
    }
  }

  /** A truck going over at speed: a small cost, once a flip. */
  function rolled(i, speed) {
    const p = per[i], s = trucks[i].state;
    p.fast = Math.max(speed, p.fast - ROLL_EASE_FT_S2 * step);
    // The body's up past level (row-major: its y is element 4).
    const over = s.matrix[4] < 0;
    if (over && !p.over && running(c.trucks[i]) && judgedHere(i)) {
      const amount = rollCost(p.fast);
      if (amount > 0) {
        const result = applyHit(c, i, { kind: "roll", amount, side: 1, end: 1 });
        if (result.wrecked) { wreck(c, i, -1); takeOut(i); }
      }
    }
    p.over = over;
  }

  /** Each step: how much each truck's velocity changed, and the hits that are over. */
  function measure() {
    trucks.forEach((t, i) => {
      const s = t.state, v = worldVelocity(s), p = per[i];
      rolled(i, Math.hypot(v[0], v[1], v[2]));
      const before = p.prevVel;
      p.prevVel = v;
      // Another machine's truck is judged there: its copy here only follows it.
      if (!before || s.heliTimer > 0 || t.flight || !judgedHere(i)) { p.hit = null; return; }
      const d = [v[0] - before[0], v[1] - before[1], v[2] - before[2]];
      const size = Math.hypot(d[0], d[1], d[2]);
      if (size > IMPACT.stepFtS) {
        const h = p.hit ?? (p.hit = { dv: [0, 0, 0], excess: 0, steps: 0, start: clock() });
        const b = toBody(s.matrix, d);
        for (let k = 0; k < 3; k++) h.dv[k] += b[k];
        h.excess += size - IMPACT.stepFtS;
        if (++h.steps >= HIT_STEPS) settle(i);
      } else if (p.hit) settle(i);
    });
  }

  /** Credits for the checkpoints and laps made since the last step. */
  function progress() {
    const n = race.checkpoints.length;
    race.trucks.forEach((rt, i) => {
      if (!running(c.trucks[i]) || !judgedHere(i)) return;
      const now = rt.laps * n + rt.checkpoint;
      const p = per[i];
      if (now > p.progress) creditProgress(c, i, now - p.progress - (rt.laps - p.laps), rt.laps - p.laps);
      p.progress = Math.max(p.progress, now);
      p.laps = rt.laps;
    });
  }

  /** Truck `j`'s state as its own machine judged it: its pools, wheels, credits, and what changed, told and shown here. */
  function adopt(j, e) {
    const t = c.trucks[j], full = c.full, s = trucks[j].state;
    const before = { global: t.global, lost: [...t.lost], repairs: t.repairs };
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
    if (taken >= IMPACT.least) {
      hits.push({ id: nextId++, truck: j, kind: "remote", by: -1, pos: [s.pos[0], s.pos[1] + 2, s.pos[2]], normal: [0, 1, 0], force: taken, vel: worldVelocity(s) });
      if (hits.length > HITS_KEPT) hits.shift();
    }
    for (let w = 0; w < 4; w++) {
      const lost = !!e.l?.[w];
      t.lost[w] = lost;
      if (lost && !before.lost[w]) { throwWheel(j, w); say(c, { kind: "wheel", truck: j, wheel: w, by: -1 }); }
      else if (!lost) per[j].lost[w] = false;
    }
    if (t.repairs > before.repairs) say(c, { kind: "repair", truck: j, spent: 0, wheelsBack: [] });
    if (e.wr && !t.wrecked) { wreckedBy[j] = e.by ?? -1; wreck(c, j, wreckedBy[j]); takeOut(j); }
    if (e.q && !t.quit && quit(c, j)) takeOut(j);
  }

  /** The race is over: the places are fixed and every truck is done. */
  const end = () => {
    if (!decided) decide();
    for (const rt of race.trucks) rt.finished = true;
    race.over = true;
  };

  const decide = () => {
    decided = combatPlaces(c, race.trucks);
    decided.forEach((place, i) => { race.trucks[i].place = place; });
    winner = decided.indexOf(1);
  };
  const course = race.course?.length ? race.course : env.course ?? [];
  const segments = Math.max(1, course.length);
  /** The stretch of course each checkpoint stands on. */
  const checkpointSegments = race.checkpoints.map((cp) => courseSegmentOf(course, cp.gate?.pos ?? cp.detector?.pos ?? [0, 0, 0]));
  /**
   * A truck shoved off its line, or one that drove by its next checkpoint's gate without going through, can be on a
   * stretch past that checkpoint, where it never passes it (the race rules see a miss only at the gate). Two stretches
   * past it, or one and far from the gate, the helicopter sets it down back on the checkpoint's stretch.
   */
  const backToCheckpoint = () => {
    if (course.length < 2 || !env.liftTo) return;
    race.trucks.forEach((rt, i) => {
      const t = trucks[i], s = t.state;
      if (rt.finished || !s.ap || !t.autopilot || t.remote || s.heliTimer > 0 || !running(c.trucks[i])) return;
      const next = checkpointSegments[rt.checkpoint], gate = race.checkpoints[rt.checkpoint]?.gate?.pos;
      if (next === undefined || !pastCheckpoint(s.ap.segment, next, segments)) return;
      const ahead = (((s.ap.segment - next) % segments) + segments) % segments;
      if (ahead >= 2 || (gate && Math.hypot(s.pos[0] - gate[0], s.pos[2] - gate[2]) > FAR_FROM_GATE_FT)) env.liftTo(t, next);
    });
  };
  /** Whether truck `j` is on truck `i`'s stretch of the course or the next one. */
  const onLine = (i, j) => {
    const a = trucks[i].state.ap?.segment ?? 0, b = trucks[j].state.ap?.segment ?? 0;
    const ahead = (((b - a) % segments) + segments) % segments;
    return ahead <= 1;
  };
  const others = (i) => trucks.map((o, j) => ({
    index: j, pos: o.state.pos, hp: c.trucks[j].global / c.full.global, wheels: wheelsOn(c.trucks[j]), place: race.trucks[j].place,
    running: j !== i && running(c.trucks[j]) && o.state.heliTimer <= 0 && !race.trucks[j].finished, onLine: onLine(i, j),
  }));

  return {
    id: payload.mode,
    keepsRace: true,
    held: () => false,
    debug: { combat: c, per, loose },
    /** A truck that has lost a wheel drives on the ground that hides it (combat-ground.js); MTM2's model only. */
    groundFor(i, ground) {
      const p = trucks[i].params;
      if (!p?.hubs || !(p.tireRadiusFt > 0) || trucks[i].cprCar || trucks[i].state.evo) return null;
      return lostWheelGround(ground, () => trucks[i].state, p, per[i].lost);
    },
    movableBoxes: () => loose.map((l) => l.box),
    heliAllowed: (i) => running(c.trucks[i]),
    /** A computer truck gets itself out of a jam (game/racer-recovery.js); the helicopter is its last resort. */
    selfRecovery: () => true,
    touch(a, b) {
      const now = clock();
      const sa = trucks[a].state, sb = trucks[b].state;
      const va = worldVelocity(sa), vb = worldVelocity(sb);
      const d = [sb.pos[0] - sa.pos[0], sb.pos[1] - sa.pos[1], sb.pos[2] - sa.pos[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const u = d.map((x) => x / len);
      // How fast each was going into the other, along the line between them.
      const closeA = va[0] * u[0] + va[1] * u[1] + va[2] * u[2], closeB = -(vb[0] * u[0] + vb[1] * u[1] + vb[2] * u[2]);
      // The pair's fight (ENGAGE): it goes on while they touch or stay apart for less than `apartS`; a hard new blow
      // after a short gap starts a new one.
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const was = fights.get(key);
      const gap = was ? now - was.at : Infinity;
      const fresh = gap > ENGAGE.apartS || (gap >= ENGAGE.rehitGapS && closingSpeed(closeA, closeB) >= IMPACT.truckFullFtS);
      const fight = fresh ? { since: now, at: now } : was;
      fight.at = now;
      fights.set(key, fight);
      // A blow keeps the closing speeds of its first step for `TOUCH_MEMORY_S`; trucks still touching after that are
      // tangled or leaning on each other, and go by their closing speeds now (small).
      const first = now - fight.since <= TOUCH_MEMORY_S;
      const pa = per[a], pb = per[b];
      const fa = first && pa.met?.other === b && pa.met.since === fight.since ? pa.met : null;
      const fb = first && pb.met?.other === a && pb.met.since === fight.since ? pb.met : null;
      pa.met = { other: b, at: now, since: fight.since, close: fa?.close ?? closeA, theirs: fa?.theirs ?? closeB, toward: toBody(sa.matrix, d), towardWorld: d };
      pb.met = { other: a, at: now, since: fight.since, close: fb?.close ?? closeB, theirs: fb?.theirs ?? closeA, toward: toBody(sb.matrix, d.map((x) => -x)), towardWorld: d.map((x) => -x) };
    },
    tick() {
      if (decided) { decided.forEach((place, i) => { race.trucks[i].place = place; }); return; }
      measure();
      progress();
      backToCheckpoint();
      const now = clock();
      // The computer trucks repair when they need to and can, unless the settings say not.
      trucks.forEach((t, i) => {
        if (!t.autopilot || !judgedHere(i) || !c.credits || payload.cpuRepairs === false) return;
        if (wantsRepair(combatTruckView(c, i))) {
          const done = repair(c, i, now);
          for (const wheel of done.wheelsBack ?? []) per[i].lost[wheel] = false;
        }
      });
      combatPlaces(c, race.trucks).forEach((place, i) => { race.trucks[i].place = place; });
      // Online, the owner decides the end; the others take it (`applyNet`).
      const last = following() ? -1 : lastStanding(c, race.trucks);
      if (last >= 0) end();
    },
    /** The owner's word: the end, the winner, the order the trucks went out in. */
    netState: () => ({
      over: !!decided, winner: decided ? winner : -1, order: [...c.order], events: c.order.length,
      rules: { toughness: payload.toughness ?? "normal", credits: c.credits, startCredits: payload.startCredits ?? 500 },
    }),
    applyNet(d) {
      if (!d) return;
      // The owner's rules, once: everyone plays by the same.
      if (d.rules && !rulesTaken) { rulesTaken = true; adoptRules(c, d.rules); }
      const known = (d.order ?? []).filter((i) => i >= 0 && i < trucks.length);
      c.order = [...known, ...c.order.filter((i) => !known.includes(i))];
      if (d.over && !decided) {
        end();
        if (d.winner >= 0) winner = d.winner;
      }
    },
    /** The state of the trucks judged here, for the others; `mark` changes when something they must hear at once does. */
    netOwn() {
      const list = trucks.map((_, i) => {
        if (!judgedHere(i)) return null;
        const t = c.trucks[i], full = c.full;
        return {
          g: t.global / full.global, e: t.engine / full.engine, b: t.gearbox / full.gearbox, w: t.wheels.map((x) => x / full.wheel),
          l: [...t.lost], cr: Math.floor(t.credits), d: Math.round(t.dealt), wk: t.wrecks, rp: t.repairs, wr: t.wrecked, q: t.quit, by: wreckedBy[i],
        };
      });
      const mark = list.map((x) => (x ? `${x.l.map(Number).join("")}${+x.wr}${+x.q}${x.rp}` : "-")).join(",")
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
    /** A wrecked truck stops; a computer truck races, or rams one ahead when it pays (combat-ai.js). */
    drive(truck, i) {
      const s = truck.state;
      if (!running(c.trucks[i])) {
        s.controls.throttle = 0;
        s.controls.brakeFront = s.controls.brakeRear = 1;
        return true;
      }
      if (race.trucks[i].finished) return false;
      const self = {
        pos: s.pos, heading: s.euler[2], hp: c.trucks[i].global / c.full.global, engine: c.trucks[i].engine / c.full.engine,
      };
      const target = ramStep(per[i].driver, self, others(i), { now: clock(), dt: step, roll: per[i].rand(), aggression });
      if (target < 0) return false;
      const o = trucks[target].state;
      const point = ramPoint(s.pos, { pos: o.pos, vel: worldVelocity(o), heading: o.euler[2] });
      // What the course's own driving added to the wheel is not carried into a ram (cpu-control.js, racer-recovery.js).
      if (truck.cpuControl) truck.cpuControl.bias = 0;
      if (truck.racerRecovery) truck.racerRecovery.bias = 0;
      driveToPoint(s, truck.extensionDriver, point, 110, 0, S.GEAR, step, { detour: true });
      watchHeadway?.(truck);
      return true;
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
      let stubs = 0;
      for (let w = 0; w < 4; w++) {
        if (!p.lost[w]) continue;
        const tire = s.tires[w];
        if (tire.penetration > -0.1) stubs++;
        tire.onGround = false;
        tire.grip = 0;
      }
      if (stubs) {
        const speed = Math.hypot(s.bvel[0], s.bvel[2]);
        if (speed > 0) {
          const keep = Math.max(0, speed - STUB_DRAG_FT_S2 * stubs * step) / speed;
          s.bvel[0] *= keep;
          s.bvel[2] *= keep;
        }
      }
      ctl.throttle = Math.min(ctl.throttle, enginePower(c, i));
      gearboxStep(c, i, ctl, S.GEAR, p.gearbox, clock(), p.rand());
      // A dead engine or gearbox: a crawl, held under its top speed.
      if (crawling(c, i)) {
        ctl.throttle = Math.min(ctl.throttle, CRAWL.throttle);
        if (Math.hypot(s.bvel[0], s.bvel[2]) > CRAWL.topFtS) ctl.throttle = 0;
      }
    },
    /** The repair key and leaving the fight (the player's, truck 0, unless told). */
    action(name, i = 0) {
      if (name === "repair") {
        const done = repair(c, i, clock());
        for (const wheel of done.wheelsBack ?? []) per[i].lost[wheel] = false;
        return done;
      }
      if (name === "quit" && quit(c, i)) { takeOut(i); return { quit: true }; }
      return null;
    },
    view() {
      const stubs = [];
      trucks.forEach((t, i) => {
        per[i].lost.forEach((lost, w) => {
          if (!lost || t.state.tires[w].penetration <= -0.1) return;
          stubs.push({ truck: i, wheel: w, pos: hubOf(i, w), speed: Math.hypot(t.state.bvel[0], t.state.bvel[2]) });
        });
      });
      return {
        mode: payload.mode, credits: c.credits,
        trucks: trucks.map((_, i) => combatTruckView(c, i)),
        lost: per.map((p) => [...p.lost]),
        log: c.log.map((e) => ({ ...e })), events: c.events,
        hits: hits.map((h) => ({ ...h })),
        loose: loose.map((l) => ({ id: l.id, truck: l.truck, wheel: l.wheel, seed: l.seed, pos: [...l.box.pos], matrix: Array.from(l.box.matrix) })),
        stubs,
        over: !!decided, winner: decided ? winner : -1, places: decided ? [...decided] : null,
        out: c.trucks.map((t) => !running(t)),
      };
    },
    /** The Points column: hit points dealt by tens, and 50 a wreck. */
    score: (i) => Math.round(c.trucks[i].dealt / 10) + c.trucks[i].wrecks * 50,
    finish() {
      if (!decided) decide();
      for (const rt of race.trucks) rt.finished = true;
      race.over = true;
    },
  };
}

