/*
  A computer racer's own way out of trouble on a circuit (an addition, not the game's): the helicopter only as a
  last resort.

  - **A missed checkpoint** (`returns`, Professional, Sonic trucks too): instead of the helicopter the truck drives
    back round to the gate's approach side, then through it. Only after `RETURN_LIMIT_S` without getting through
    does it call the helicopter.
  - **Stuck** (`unsticks`, Race & Rumble's racers): a truck that wants to go and cannot (another truck in its way,
    a tree, a wall) first shoves a truck in front of it, then backs out turning, then drives round to one side and
    back onto the course, the other side on the next try. Only after `ESCAPE_TRIES` tries, or `ESCAPE_LIMIT_S`
    without getting clear, or once it has lain over for `OVER_S`, does it call the helicopter.
  - **Seeing a threat coming** (`threats`, Race & Rumble's enemy blockers): the racer steers off the line a blocker
    is closing on and keeps its foot down.

  The course autopilot writes the controls first; `racerRecoveryStep` then leaves them, nudges the steering, or
  writes its own. Pure, so it runs under Node.
*/
import { createRumbleDriver, driveToPoint } from "./rumble-ai.js";

/** A missed checkpoint: the approach point this far before the gate, the exit this far past it, and the time allowed. */
export const RETURN_BACK_FT = 70, RETURN_PAST_FT = 60, RETURN_LIMIT_S = 45;
/** Driving back: the speed to the approach point and through the gate, ft/s. */
export const RETURN_SPEED = 45, THROUGH_SPEED = 35;
/** Stuck: wanting to go (throttle over 0.3 in a forward gear) under this speed for this long. */
export const STUCK_FT_S = 4, STUCK_S = 1.2;
/** No headway: never leaving a circle this wide for this long counts as stuck too. */
export const STALL_FT = 12, STALL_S = 4;
/** The way out: shove a truck within this distance ahead, back out, go round; how long each lasts, seconds. */
export const PUSH_FT = 28, PUSH_S = 1.2, BACK_S = 1.5, ROUND_S = 2.6, ROUND_FT = 55, ROUND_TURN = 0.9;
/** Free again once this far from where it got stuck; the helicopter after this many tries or this long stuck. */
export const CLEAR_FT = 70, ESCAPE_TRIES = 6, ESCAPE_LIMIT_S = 30;
/** A threat: within this distance, closing at over this speed, passing within this miss distance in this time. */
export const EVADE_FT = 150, EVADE_CLOSING = 10, EVADE_MISS_FT = 24, EVADE_LOOK_S = 2.2;
/** The most the steering is turned off the autopilot's to dodge, of its ±0.45 lock. */
export const EVADE_STEER = 0.22;
/** Over (its up axis under this) for this long: no way out but the helicopter. */
export const OVER_UP = 0.3, OVER_S = 3;

const STEER_LOCK = 0.45;
const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * A racer's recovery memory. `returns`: it drives back through a missed checkpoint; `unsticks`: it gets itself out
 * when stuck.
 */
export function createRacerRecovery({ returns = false, unsticks = false } = {}) {
  return {
    returns, unsticks, mode: "course", timer: 0, phase: null, returnTime: 0, slow: 0, stall: null,
    tries: 0, stuckTime: 0, anchor: null, side: 1, bias: 0, over: 0, driver: createRumbleDriver(0.5),
  };
}

/** Whether the truck is in its own hands now (the course autopilot's stuck timer must not run). */
export const racerRecovering = (r) => r.mode !== "course";

/** Take back the last step's dodge from the steering before the autopilot runs (its steering is smoothed). */
export function racerRecoveryBefore(r, controls) {
  if (r.bias) controls.steer -= r.bias;
  r.bias = 0;
}

/**
 * One step, after the course autopilot. `ctx`:
 *   `state` the truck (pos, euler, bvel, controls), `dt`, `gears` ({ FIRST, REVERSE }),
 *   `missed` the gate it missed (`{ pos, psi, half }`) or null, `aim` a point down the course (its segment's end),
 *   `trucks` the other trucks' positions, `threats` those to dodge (`{ pos, vel }`, world ft/s).
 * Returns "course" (the autopilot's controls stand), "own" (written here) or "heli" (call the helicopter).
 */
export function racerRecoveryStep(r, ctx) {
  const s = ctx.state, c = s.controls, dt = ctx.dt;
  // Lying over: nothing to drive with.
  r.over = s.matrix && s.matrix[4] < OVER_UP ? r.over + dt : 0;
  if (r.over > OVER_S && (r.unsticks || (r.returns && ctx.missed))) { r.over = 0; return giveUp(r, c, ctx.gears); }
  if (r.returns && ctx.missed) return returnStep(r, ctx);
  if (r.mode === "return") leave(r, c, ctx.gears);
  if (!r.unsticks) return "course";

  if (r.mode !== "course") {
    r.stuckTime += dt;
    if (r.anchor && flat(s.pos, r.anchor) > CLEAR_FT) { leave(r, c, ctx.gears); r.tries = 0; return "course"; }
    if (r.stuckTime > ESCAPE_LIMIT_S) return giveUp(r, c, ctx.gears);
    r.timer -= dt;
    if (r.timer <= 0) {
      // Each manoeuvre leads to the next: a shove, then backing out, then round; round ends back on the course.
      if (r.mode === "push") startBack(r);
      else if (r.mode === "back") { r.mode = "round"; r.timer = ROUND_S; r.heading = s.euler[2] + r.side * ROUND_TURN; }
      else { r.mode = "course"; r.slow = 0; r.stall = null; c.gear = ctx.gears.FIRST; return "course"; }
    }
    if (r.mode === "push") {
      // Full throttle at the truck in the way, aimed past its side toward the open road.
      const target = r.pushAt;
      const heading = Math.atan2(target[0] - s.pos[0], target[2] - s.pos[2]);
      c.gear = ctx.gears.FIRST;
      c.throttle = 1;
      c.brakeFront = c.brakeRear = 0;
      steer(c, wrapPi(heading - s.euler[2]) * 1.4, dt);
    } else if (r.mode === "back") {
      c.gear = ctx.gears.REVERSE;
      c.throttle = 0.8;
      c.brakeFront = c.brakeRear = 0;
      steer(c, -r.side * STEER_LOCK, dt);
    } else {
      const point = [s.pos[0] + Math.sin(r.heading) * ROUND_FT, s.pos[1], s.pos[2] + Math.cos(r.heading) * ROUND_FT];
      c.gear = ctx.gears.FIRST;
      driveToPoint(s, r.driver, point, 30, 0, ctx.gears, dt);
    }
    return "own";
  }

  // On the course: watch for being stuck.
  const forward = s.bvel[2];
  const wants = c.throttle > 0.3 && c.gear !== ctx.gears.REVERSE;
  r.slow = wants && Math.abs(forward) < STUCK_FT_S ? r.slow + dt : 0;
  const w = r.stall ?? (r.stall = { pos: [s.pos[0], s.pos[2]], time: 0 });
  if (Math.hypot(s.pos[0] - w.pos[0], s.pos[2] - w.pos[1]) > STALL_FT) { w.pos = [s.pos[0], s.pos[2]]; w.time = 0; }
  else w.time += dt;
  if (r.anchor && flat(s.pos, r.anchor) > CLEAR_FT) { r.tries = 0; r.anchor = null; r.stuckTime = 0; }
  if (r.slow > STUCK_S || w.time > STALL_S) return startEscape(r, ctx);

  dodge(r, ctx);
  return "course";
}

function steer(c, cmd, dt) {
  c.steer += (clamp(cmd, -STEER_LOCK, STEER_LOCK) - c.steer) * Math.min(1, 6.66 * dt);
  c.steer = clamp(c.steer, -STEER_LOCK, STEER_LOCK);
  c.rearSteer = -c.steer * 0.33;
}

function leave(r, c, gears) {
  r.mode = "course";
  r.phase = null;
  r.slow = 0;
  r.stall = null;
  r.driver = createRumbleDriver(0.5);
  if (c.gear === gears.REVERSE) c.gear = gears.FIRST;
}

function giveUp(r, c, gears) {
  leave(r, c, gears);
  r.tries = 0;
  r.anchor = null;
  r.stuckTime = 0;
  return "heli";
}

function startBack(r) {
  r.mode = "back";
  r.timer = BACK_S;
}

/** Stuck: a new try, the side alternating; a truck right in front is shoved first. */
function startEscape(r, ctx) {
  const s = ctx.state;
  r.slow = 0;
  r.stall = null;
  if (!r.anchor) { r.anchor = [...s.pos]; r.stuckTime = 0; }
  r.tries++;
  if (r.tries > ESCAPE_TRIES) return giveUp(r, s.controls, ctx.gears);
  // The side toward the course first, then the other.
  const toAim = ctx.aim ? wrapPi(Math.atan2(ctx.aim[0] - s.pos[0], ctx.aim[2] - s.pos[2]) - s.euler[2]) : 0;
  r.side = r.tries === 1 ? (toAim >= 0 ? 1 : -1) : -r.side;
  const heading = s.euler[2];
  const blocker = (ctx.trucks ?? []).find((p) => {
    const dx = p[0] - s.pos[0], dz = p[2] - s.pos[2];
    return Math.hypot(dx, dz) < PUSH_FT && (dx * Math.sin(heading) + dz * Math.cos(heading)) > 0;
  });
  if (blocker && r.tries % 2 === 1) {
    // Fight back: drive at the side of the truck in the way, toward the course.
    const px = Math.cos(heading), pz = -Math.sin(heading);
    r.pushAt = [blocker[0] + px * r.side * 12, blocker[1], blocker[2] + pz * r.side * 12];
    r.mode = "push";
    r.timer = PUSH_S;
  } else startBack(r);
  return "own";
}

/** Steer off the line of a threat closing in, the dodge kept to be taken back next step. */
function dodge(r, ctx) {
  const s = ctx.state, c = s.controls;
  const mine = worldVel(s);
  let best = 0, bestUrgency = 0;
  for (const t of ctx.threats ?? []) {
    const rx = t.pos[0] - s.pos[0], rz = t.pos[2] - s.pos[2];
    const d = Math.hypot(rx, rz);
    if (d > EVADE_FT || d < 1) continue;
    const vx = t.vel[0] - mine[0], vz = t.vel[2] - mine[2];
    const closing = -(rx * vx + rz * vz) / d;
    if (closing < EVADE_CLOSING) continue;
    // Its nearest pass, if both hold their course.
    const v2 = vx * vx + vz * vz;
    const when = clamp(-(rx * vx + rz * vz) / (v2 || 1), 0, EVADE_LOOK_S);
    const miss = Math.hypot(rx + vx * when, rz + vz * when);
    if (miss > EVADE_MISS_FT) continue;
    const urgency = 1 - when / EVADE_LOOK_S;
    if (urgency <= bestUrgency) continue;
    bestUrgency = urgency;
    // Away from the side it comes from.
    const bearing = wrapPi(Math.atan2(rx, rz) - s.euler[2]);
    best = -(bearing >= 0 ? 1 : -1) * EVADE_STEER * (0.4 + 0.6 * urgency);
  }
  if (!best) return;
  const before = c.steer;
  c.steer = clamp(c.steer + best, -STEER_LOCK, STEER_LOCK);
  c.rearSteer = -c.steer * 0.33;
  r.bias = c.steer - before;
  // Foot down: a racer outruns a blocker rather than braking into it.
  c.throttle = Math.max(c.throttle, 0.9);
  c.brakeFront = c.brakeRear = 0;
}

function worldVel(s) {
  const m = s.matrix, [x, y, z] = s.bvel;
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** Driving back through a missed gate: round to its approach side, then through it. */
function returnStep(r, ctx) {
  const s = ctx.state, c = s.controls, dt = ctx.dt, gate = ctx.missed;
  if (r.mode !== "return") {
    leave(r, c, ctx.gears);
    r.mode = "return";
    r.phase = "approach";
    r.returnTime = 0;
  }
  r.returnTime += dt;
  if (r.returnTime > RETURN_LIMIT_S) return giveUp(r, c, ctx.gears);
  const dir = [Math.sin(gate.psi), Math.cos(gate.psi)];
  const rel = [s.pos[0] - gate.pos[0], s.pos[2] - gate.pos[2]];
  const along = rel[0] * dir[0] + rel[1] * dir[1];
  const across = Math.abs(rel[0] * dir[1] - rel[1] * dir[0]);
  const approach = [gate.pos[0] - dir[0] * RETURN_BACK_FT, gate.pos[1], gate.pos[2] - dir[1] * RETURN_BACK_FT];
  const width = Math.max(15, gate.half?.[0] ?? 15);
  if (r.phase === "approach" && (flat(s.pos, approach) < 25 || (along < -30 && across < width))) r.phase = "through";
  // Past the gate and still not through it: round again.
  else if (r.phase === "through" && along > 30) r.phase = "approach";
  const point = r.phase === "approach" ? approach : [gate.pos[0] + dir[0] * RETURN_PAST_FT, gate.pos[1], gate.pos[2] + dir[1] * RETURN_PAST_FT];
  driveToPoint(s, r.driver, point, r.phase === "approach" ? RETURN_SPEED : THROUGH_SPEED, 0, ctx.gears, dt, { detour: true });
  return "own";
}
