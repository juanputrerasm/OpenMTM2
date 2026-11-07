/*
  Combat's runtime in the simulation worker (docs/EXTENSIONS.md; the rules are combat.js). The damage is the shared
  combat core's (combat-core.js: hits, wheels, stubs, engine and gearbox, credits, the network); this adds the race:
  credits for checkpoints and laps, the lift back to a missed checkpoint, the computer trucks' rams (combat-ai.js), the
  places and the last truck standing. A wrecked truck stops where it is, out of the race.
*/
import * as S from "../../vendor/openphotex/sim/mtm2/index.js";
import { adoptRules, combatPlaces, creditProgress, lastStanding, running, wheelsOn } from "./combat.js";
import { createCombatCore } from "./combat-core.js";
import { createCombatDriver, ramPoint, ramStep, wantsRepair } from "./combat-ai.js";
import { createRumbleDriver, driveToPoint } from "../rumble-ai.js";
import { worldVelocity } from "./loose-wheels-core.js";

export { LOOSE_WHEEL_SLUGS, MOST_LOOSE } from "./loose-wheels-core.js";
export { HITS_KEPT, ROLL_EASE_FT_S2 } from "./combat-core.js";
/** A truck one stretch past its next checkpoint and this far from its gate has missed it (feet). */
const FAR_FROM_GATE_FT = 250;

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

/**
 * Whether a truck has driven through checkpoint stretch `next` (of `count`) since it took its last checkpoint or
 * started: it was on segment `from` then and has passed `passed` segments since. A truck that starts behind the
 * stretch (the grid on segment 0, the first checkpoint on the course's last stretch, as on Castle Nugget) is short of
 * it, not past it.
 */
export const droveThrough = (from, passed, next, count) => passed > ((((next - from) % count) + count) % count);

export function createCombatRuntime(payload, env) {
  const { trucks, race, step, watchHeadway } = env;
  const aggression = payload.aggression ?? "normal";
  let decided = null, winner = -1, rulesTaken = false;
  const core = createCombatCore(env, { toughness: payload.toughness, credits: payload.credits !== false, startCredits: payload.startCredits }, {
    onWrecked: (i) => takeOut(i),
    onQuit: (i) => takeOut(i),
  });
  const { c, per, clock, judgedHere, following } = core;
  const drivers = trucks.map(() => createCombatDriver());
  trucks.forEach((t) => { t.extensionDriver = createRumbleDriver(0.6); });

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
   * past it, or one and far from the gate, the helicopter sets it down back on the checkpoint's stretch. Only a truck
   * that has driven through that stretch since its last checkpoint (`droveThrough`): never one at the start.
   */
  // Where each truck was when it took its last checkpoint (or when the race started), and its segment count then.
  const marks = trucks.map(() => null);
  const backToCheckpoint = () => {
    if (course.length < 2 || !env.liftTo) return;
    race.trucks.forEach((rt, i) => {
      const t = trucks[i], s = t.state;
      if (!s.ap) return;
      if (!marks[i] || marks[i].checkpoint !== rt.checkpoint) marks[i] = { checkpoint: rt.checkpoint, segment: s.ap.segment, passed: s.ap.segmentsPassed ?? 0 };
      if (rt.finished || !t.autopilot || t.remote || s.heliTimer > 0 || !running(c.trucks[i])) return;
      const next = checkpointSegments[rt.checkpoint], gate = race.checkpoints[rt.checkpoint]?.gate?.pos;
      if (next === undefined || !pastCheckpoint(s.ap.segment, next, segments)) return;
      if (!droveThrough(marks[i].segment, (s.ap.segmentsPassed ?? 0) - marks[i].passed, next, segments)) return;
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
    debug: { combat: c, per, loose: core.loose },
    groundFor: core.groundFor,
    movableBoxes: core.movableBoxes,
    heliAllowed: (i) => running(c.trucks[i]),
    /** A computer truck gets itself out of a jam (game/racer-recovery.js); the helicopter is its last resort. */
    selfRecovery: () => true,
    touch: core.touch,
    tick() {
      if (decided) { decided.forEach((place, i) => { race.trucks[i].place = place; }); return; }
      core.measure();
      progress();
      backToCheckpoint();
      // The computer trucks repair when they need to and can, unless the settings say not.
      if (payload.cpuRepairs !== false) core.cpuRepairs(wantsRepair);
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
    netOwn: core.netOwn,
    applyNetOwn: core.applyNetOwn,
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
      const target = ramStep(drivers[i], self, others(i), { now: clock(), dt: step, roll: per[i].rand(), aggression });
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
    afterTruckStep: core.afterTruckStep,
    /** The repair key and leaving the fight (the player's, truck 0, unless told). */
    action(name, i = 0) {
      if (name === "repair") return core.repair(i);
      if (name === "quit" && core.quit(i)) return { quit: true };
      return null;
    },
    view() {
      return {
        mode: payload.mode, ...core.view(),
        over: !!decided, winner: decided ? winner : -1, places: decided ? [...decided] : null,
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

