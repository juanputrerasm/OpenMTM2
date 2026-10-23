/*
  CART Precision Racing's autopilot (CART.EXE 0x468620; CPR_PHYSICS.md 14.2 and 14.3), for CPR cars under CPR physics.

  It drives the SIT course the track already has (straights with MTM2's arcs built between them, as CART.EXE builds
  them, 0x412cd0): the corner speed of each arc from the car's own grip, wings and weight at 75% of its limit, a braking
  curve to the next arc and a check of the arc after it, the game's throttle and brake law, and its steering gains on
  straights and arcs. A car behind another holds to a speed it can stop from, and moves aside by 0.75 of the room to
  pass. The same driver gives the player's aids (`assist`): Auto-Brake, Auto-Throttle, Stay on track and Stay on Line.

  The port's parts (14.2): the road's width at the car comes from the .TRK centreline (`widthAt`) in place of 0x4b5920;
  the arc's understeer term (car word 0x555) is left out; a pass shifts the whole line rather than refitting each
  corner's circle (0x467f00); the pits are not driven. Pure: the worker runs it every step; Node runs the tests.
*/

const G_FT = 32.174;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** The corner speed is this share of v^2 at the car's limit (0x5b1a98: 0.75 of the speed). */
export const CPR_AP_CORNER_SHARE = 0.5625;
/** The slowest corner speed squared, (ft/s)^2 (0x44610000: 30 ft/s). */
export const CPR_AP_MIN_V2 = 900;
/** The aerodynamic share d of the corner speed law is held to this (0x5b1a80). */
const AERO_SHARE_MAX = 0.95;
/** Next segment when this many seconds of speed from a straight's end (0x5ec5a0; the player's 0x5b1a28). */
const ADVANCE_S = 0.1, ADVANCE_S_PLAYER = 0.2;
/** Throttle law (0x5b1b30, 0x5b1b38, 0x5b1b40, 0x5b1b48). */
const SPEED_GAIN = 0.1, ACCEL_GAIN = 0.005, PEDAL_EASE = 12, PEDAL_EASE_MAX = 0.8;
/** Straight steering: the line gain (0x5ec5a8; the player's 0x5b1bc0), its hold (0x5b1bd0) and fade (0x5b1bf0). */
const LINE_DIV = 100, LINE_DIV_PLAYER = 300, LINE_HOLD = 0.1745, FADE_FT_S = 250;
/** The heading gain on a straight (0x5ec5b4, 0x5ec5ac, 0x5ec5b0). */
const HEAD_FT = 20, HEAD_CAP = 2, HEAD_MIN = 0.75;
/** Arc steering: the radius gain (0x5ec590; the player's 0x5b1a58 as a multiplier) and heading gain (0x5ec59c, 0x5ec594, 0x5ec598). */
const ARC_DIV = 80, ARC_MUL_PLAYER = 0.01, ARC_HEAD_FT = 20, ARC_HEAD_CAP = 1.5, ARC_HEAD_FLOOR = -0.5, ARC_HEAD_MIN = 0.5;
/** The wheel eases to its target by min(10 dt, 0.75) a step (0x5b1b28, 0x5ec5b8, 0x5ec5a4). */
const STEER_EASE = 10, STEER_EASE_MAX = 0.75;
/** Outside an arc's line the target drops by min(e, 15) x 1.75, or 26.25 past 15 ft (0x5b1b08, 0x5b1b18, 0x5b1b10). */
const WIDE_FT = 15, WIDE_PER_FT = 1.75, WIDE_MAX = 26.25;
/** Behind a car: the gap kept, feet (0x5b1860), and the least deceleration assumed (0x5b1890). */
const FOLLOW_GAP_FT = 26.2, FOLLOW_DECEL_MIN = -0.05;
/** A pass: the lane fraction (0x5b1948) toward the side away from the car ahead. */
const PASS_LANE = 0.75;
/** The aids' window (14.3): its width toward the line, the edge gains on a straight and an arc, Stay on Line's room. */
const AID_WINDOW = 0.1, AID_EDGE_STRAIGHT = 1 / 300, AID_EDGE_ARC = 1 / 75, AID_ARC_HEAD = 1.5, LINE_ROOM_FT = 6;
/** Spin Correction: a car this far off the course's heading with its velocity against it is turned round (0x5b1b70). */
export const CPR_SPIN_CORRECTION_RAD = 1.2566370616;

/** The port's: the road's width when the track gives none, feet. */
const DEFAULT_WIDTH_FT = 40;
/** The port's: how fast the line moves across to pass, feet a second. */
const LANE_RATE_FT_S = 10;
/** The port's: a car ahead counts for following within this, feet ahead and across. */
const AHEAD_FT = 200, AHEAD_ACROSS_FT = 7;

/** The game's angle wrap to [-pi, pi]. */
export function wrapAngle(a) {
  let w = a - Math.trunc(a / TWO_PI) * TWO_PI;
  if (w > Math.PI) w -= TWO_PI;
  if (w < -Math.PI) w += TWO_PI;
  return w;
}

/** The skill levels (0x5e7024) and the aids each turns on in the port (14.3; the game leaves them to the dialog). */
export const CPR_SKILL_LEVELS = Object.freeze(["rookie", "intermediate", "professional"]);
export function cprAids(level) {
  const i = Math.max(0, CPR_SKILL_LEVELS.indexOf(level));
  return Object.freeze({
    skill: i,
    /** 0 none, 1 Auto-Brake, 2 Auto-Throttle too (controlflag). */
    control: i === 0 ? 1 : 0,
    /** 0 none, 1 Stay on track, 2 Stay on Line (steeringHelp). */
    steeringHelp: i < 2 ? 1 : 0,
    abs: i < 2,
    tractionControl: i < 2,
    spinCorrection: i < 2,
    /** The player's grip (0x5e7334) and off-road grip on Professional (6.2). */
    gripScale: i === 0 ? 1 : 0.8,
    offroadGrip: i === 2 ? 0.4 : null,
  });
}

/**
 * The course in the shape the driver reads: each segment of OpenPhotex `buildCourse` with its heading, direction and
 * length (a straight) or sweep and length (an arc), as CART.EXE's records hold them (0x412cd0).
 */
export function cprCourse(course) {
  const list = course ?? [];
  const straight = (start, end) => {
    const dx = end[0] - start[0], dz = end[2] - start[2];
    const length = Math.hypot(dx, dz) || 1;
    return { arc: false, start, end, heading: Math.atan2(dx, dz), dir: [dx / length, dz / length], length, rise: end[1] - start[1] };
  };
  return list.map((s, i) => {
    // An arc between parallel straights has no centre (the line crossing fails, as in the game): the port drives it as
    // a straight from the one before to the one after.
    if (s.ctype === 2 && !(Number.isFinite(s.radius) && Number.isFinite(s.centre?.[0]) && Number.isFinite(s.centre?.[2]))) {
      const before = list[(i - 1 + list.length) % list.length], after = list[(i + 1) % list.length];
      return straight(before?.end ?? s.centre, after?.start ?? s.centre);
    }
    if (s.ctype === 2) {
      const sweep = wrapAngle(s.exitAngle - s.entryAngle);
      return { arc: true, centre: s.centre, entry: s.entryAngle, exit: s.exitAngle, radius: s.radius, sweep, length: Math.abs(sweep) * s.radius };
    }
    return straight(s.start, s.end);
  });
}

/** A width lookup from the .TRK centreline (`{ pos, left, right }[]`): the road's full width nearest a point. */
export function createWidthLookup(points) {
  const pts = (points ?? []).filter((p) => p?.pos && Number.isFinite(p.left) && Number.isFinite(p.right));
  if (!pts.length) return () => DEFAULT_WIDTH_FT;
  return (pos) => {
    let best = null, bestD = Infinity;
    for (const p of pts) {
      const d = (p.pos[0] - pos[0]) ** 2 + (p.pos[2] - pos[2]) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    const w = best.left + best.right;
    return w > 4 ? w : DEFAULT_WIDTH_FT;
  };
}

/** The car's figures the autopilot reads, from its CPR params (OpenPhotex `cprSim`) and the aero law. */
export function cprCarFigures(params, aero, refArea, airDensity) {
  const anchors = params.cpr?.spec?.wheelAnchors ?? [];
  const halfWidth = anchors.length ? Math.max(...anchors.map((a) => Math.abs(a[0]))) + 0.5 : 3.5;
  return {
    weight: params.weightLb, mass: params.weightLb / G_FT, cl: aero.cl, cd: aero.cd, area: refArea, rho: airDensity,
    steerLock: params.cpr?.spec?.setup?.steeringLock ?? 0.31, wheelbase: Math.abs(params.frontAxleZ - params.rearAxleZ) || 9.8,
    halfWidth,
  };
}

/** The distance squared from p to the segment a-b in x and z (0x466fe0). */
function segmentDistance2(p, a, b) {
  const ux = b[0] - a[0], uz = b[2] - a[2], len2 = ux * ux + uz * uz;
  const wx = p[0] - a[0], wz = p[2] - a[2];
  const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * ux + wz * uz) / len2)) : 0;
  return (wx - ux * t) ** 2 + (wz - uz * t) ** 2;
}

/** The straight nearest to `pos`, as a course index. */
export function nearestStraight(segs, pos) {
  let best = 0, bestD = Infinity;
  segs.forEach((s, i) => {
    if (s.arc) return;
    const d = segmentDistance2(pos, s.start, s.end);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/**
 * One car's autopilot. `step(state, ctx)` sets `state.controls` (or, with `ctx.dryRun`, only works them out) and
 * returns what the aids need. `ctx`: `{ car, dt, mu(load, front), others: [{ pos, speed }], player }`, `car` from
 * `cprCarFigures`, `mu` the load table (OpenPhotex `cprMu`, x1.1875 already).
 */
export function createCprDriver(segs, widthAt = () => DEFAULT_WIDTH_FT) {
  const n = segs.length;
  let index = -1, v2corner = CPR_AP_MIN_V2, accel = 0, lastForward = null, steer = 0, pedal = 0, lane = 0, grade = 0;
  const next = (i, k = 1) => (i + k) % n;

  return {
    get index() { return index; },
    step(state, ctx) {
      const { car, dt = 1 / 60, mu: muOf, others = [], player = false } = ctx;
      if (!n || !car) return null;
      const pos = state.pos;
      if (index < 0) index = nearestStraight(segs, pos);
      const heading = state.euler[2];
      const v = state.bvel[2];
      const draft = state.cpr?.draft ?? 1;
      // The forward acceleration, smoothed by a quarter a step (word 0x396).
      if (lastForward !== null) accel += ((v - lastForward) / dt - accel) * 0.25;
      lastForward = v;
      const width = widthAt(pos);
      const room = Math.max(0, width * 0.5 - car.halfWidth);

      // The segment: past a straight's end (less 0.1 s of speed), past an arc onto the next straight.
      for (let guard = 0; guard < 4; guard++) {
        const s = segs[index];
        if (!s.arc) {
          const left = (s.end[0] - pos[0]) * s.dir[0] + (s.end[2] - pos[2]) * s.dir[1];
          if (left < Math.max(0, v) * (player ? ADVANCE_S_PLAYER : ADVANCE_S)) index = next(index); else break;
        } else {
          const t = segs[next(index)];
          if (t.arc) { index = next(index); continue; }
          const left = (t.start[0] - pos[0]) * t.dir[0] + (t.start[2] - pos[2]) * t.dir[1];
          if (left < 0) index = next(index); else break;
        }
      }

      // The car ahead (the one being drafted): nearest on the line in front.
      const hx = Math.sin(heading), hz = Math.cos(heading);
      let leader = null;
      for (const o of others) {
        const dx = o.pos[0] - pos[0], dz = o.pos[2] - pos[2];
        const along = dx * hx + dz * hz, across = dx * hz - dz * hx;
        if (along > 0 && along < AHEAD_FT && Math.abs(across) < AHEAD_ACROSS_FT && (!leader || along < leader.along)) leader = { along, across, speed: o.speed };
      }

      // The grip of each axle at this speed (14.2), and the two axles' mean.
      const q = 0.5 * car.rho * car.area * draft;
      const load = (car.weight + q * car.cl * v * v) * 0.25;
      const tires = state.tires ?? [];
      const onFront = tires.length ? ((tires[0]?.onGround ? 1 : 0) + (tires[1]?.onGround ? 1 : 0)) / 2 : 1;
      const onRear = tires.length ? ((tires[2]?.onGround ? 1 : 0) + (tires[3]?.onGround ? 1 : 0)) / 2 : 1;
      const muF = muOf(load, true) * onFront, muR = muOf(load, false) * onRear;
      const muSum = muF + muR, mu = muSum * 0.5;
      const cornerV2 = (R) => {
        const d = Math.min(AERO_SHARE_MAX, (mu * car.cl * q * R) / car.mass);
        return d >= 1 ? 4e6 : ((mu * R * G_FT) / (1 - d)) * CPR_AP_CORNER_SHARE;
      };
      const decelAt = (u2) => (-(muSum) * (q * car.cl * u2 + car.weight) * 0.5 + grade - car.cd * q * u2) / car.mass;
      // The braking deceleration: at the corner speed, three quarters of the way to the one at this speed if that is less.
      const aCorner = decelAt(v2corner);
      const aNow = (-(muSum) * (car.weight + q * car.cl * v * v) * 0.5 + grade - car.cd * q * v * v) / car.mass;
      const aBrake = aCorner + 0.75 * Math.max(0, aNow - aCorner);

      const s = segs[index];
      let target2, e, steerTarget, aidCentre, aidEdge;
      if (!s.arc) {
        grade = -(s.rise / s.length) * car.weight;
        const along = (s.end[0] - pos[0]) * s.dir[0] + (s.end[2] - pos[2]) * s.dir[1];
        const nextArc = segs[next(index)];
        v2corner = Math.max(CPR_AP_MIN_V2, nextArc.arc ? cornerV2(nextArc.radius + (nextArc.sweep >= 0 ? lane * room : -lane * room)) : 4e6);
        let cap2 = 4e6;
        // The arc after it (course 2 in the game: the same line).
        const after = segs[next(index, 3)];
        if (after?.arc) {
          const v2after = cornerV2(after.radius);
          if (v2after < v2corner) {
            const a = decelAt(v2after);
            const need = (v2after - v * v) / (a * 2);
            const roomFt = Math.max(0, segs[next(index, 2)].length) + nextArc.length + Math.max(0, along);
            if (roomFt < need) cap2 = roomFt * a * -2 + v2after;
          }
        }
        target2 = Math.min(cap2, aBrake * Math.max(0, along) * -2 + v2corner);
        // The line: the car's distance left of it, less the pass's shift.
        e = (pos[0] - s.start[0]) * -Math.cos(s.heading) + (pos[2] - s.start[2]) * Math.sin(s.heading) - lane * room;
        const headingErr = wrapAngle(s.heading - heading);
        const k = Math.max(HEAD_MIN, (HEAD_CAP - Math.min(Math.abs(e) / HEAD_FT, HEAD_CAP)) * 0.5);
        const lineTerm = Math.max(-LINE_HOLD, Math.min(LINE_HOLD, e / (player ? LINE_DIV_PLAYER : LINE_DIV)));
        steerTarget = (FADE_FT_S / Math.max(v, FADE_FT_S)) * lineTerm + headingErr * k;
        aidCentre = headingErr;
        aidEdge = AID_EDGE_STRAIGHT;
      } else {
        const sign = s.sweep >= 0 ? 1 : -1;
        const R = s.radius + sign * lane * room;
        v2corner = Math.max(CPR_AP_MIN_V2, cornerV2(R));
        target2 = v2corner;
        const dx = pos[0] - s.centre[0], dz = pos[2] - s.centre[2];
        const phi = Math.atan2(dx, dz);
        // The angle left to the arc's exit (word 0x515), and the next arc's check.
        let leftAngle = wrapAngle(s.exit - phi);
        if (leftAngle * s.sweep < 0 && Math.abs(leftAngle) > Math.abs(s.sweep) * 0.5) leftAngle = s.sweep * 1.01;
        const following = segs[next(index, 2)];
        if (following?.arc) {
          const v2n = cornerV2(following.radius);
          if (v2n < target2) {
            const a = decelAt(v2n);
            const need = (v2n - target2) / (a * 2);
            const roomFt = Math.max(0, segs[next(index)].length) + Math.abs(leftAngle) * R;
            if (roomFt < need) target2 = Math.min(target2, roomFt * a * -2 + v2n);
          }
        }
        target2 = Math.max(CPR_AP_MIN_V2, target2);
        const radial = Math.hypot(dx, dz) - R;
        // Wide of the line through the arc: slower.
        const progress = 1 - leftAngle / (s.sweep || 1);
        let target = Math.sqrt(target2);
        if (progress > 0 && radial > 0) target -= radial <= WIDE_FT ? radial * WIDE_PER_FT : WIDE_MAX;
        target2 = Math.max(0, target) ** 2;
        const tangent = wrapAngle(phi + sign * HALF_PI);
        const headingErr = wrapAngle(tangent - heading);
        let x = player ? radial * 0.1 : radial / ARC_HEAD_FT;
        x = Math.min(x, ARC_HEAD_CAP);
        if (x < ARC_HEAD_FLOOR) x = ARC_HEAD_FLOOR;
        const k = Math.max(ARC_HEAD_MIN, ARC_HEAD_CAP - Math.abs(x));
        const radiusTerm = (player ? radial * ARC_MUL_PLAYER : radial / ARC_DIV) * sign;
        const own = (car.wheelbase / Math.max(1, R)) * sign;
        steerTarget = headingErr * k + radiusTerm + own;
        // e as the distance left of the line: outside is left on a right-hand arc.
        e = radial * sign;
        aidCentre = own + headingErr * AID_ARC_HEAD;
        aidEdge = AID_EDGE_ARC;
      }

      // A car more than twice the road's width off the line picks the straight nearest to it next step.
      if (Math.abs(e) > width * 2) index = nearestStraight(segs, pos);
      let target = Math.sqrt(Math.max(0, target2));
      // Behind a car: no faster than it can stop from (0x4661a0).
      if (leader) {
        const a = Math.min(FOLLOW_DECEL_MIN, aBrake);
        const allowed2 = leader.speed * leader.speed - a * (leader.along - FOLLOW_GAP_FT) * 2;
        target = Math.min(target, allowed2 > 0 ? Math.sqrt(allowed2) : 0);
      }
      // Passing: a faster car moves 0.75 of the room toward the side away from the one ahead, back once clear.
      const want = leader && leader.along < 80 && Math.sqrt(Math.max(0, target2)) > leader.speed + 3 ? (leader.across >= 0 ? -PASS_LANE : PASS_LANE) : 0;
      const step = room > 0 ? (LANE_RATE_FT_S * dt) / room : 1;
      lane += Math.sign(want - lane) * Math.min(Math.abs(want - lane), step);

      // Throttle and brakes.
      const command = SPEED_GAIN * (target - v) - ACCEL_GAIN * Math.max(0, accel);
      pedal += (command - pedal) * Math.min(PEDAL_EASE * dt, PEDAL_EASE_MAX);
      pedal = Math.max(-1, Math.min(1, pedal));
      // The wheel.
      const ease = player ? STEER_EASE_MAX : Math.min(STEER_EASE * dt, STEER_EASE_MAX);
      steer += (steerTarget - steer) * ease;
      steer = Math.max(-car.steerLock, Math.min(car.steerLock, steer));

      const out = {
        index, target, pedal, steer, e, room, aidCentre, aidEdge,
        courseHeading: s.arc ? wrapAngle(Math.atan2(pos[0] - s.centre[0], pos[2] - s.centre[2]) + (s.sweep >= 0 ? HALF_PI : -HALF_PI)) : s.heading,
        passing: lane !== 0,
      };
      if (!ctx.dryRun) {
        const c = state.controls;
        c.steer = steer;
        c.throttle = pedal > 0 ? pedal : 0;
        c.brakeFront = c.brakeRear = pedal < 0 ? -pedal : 0;
      }
      return out;
    },
  };
}

/**
 * The player's aids on their own controls (14.3), from the autopilot's dry run `ap` (the player's step of the driver):
 * Auto-Brake and Auto-Throttle on the pedals, Stay on track and Stay on Line as a window on the wheel.
 */
export function applyCprAids(controls, ap, aids) {
  if (!ap || !aids) return;
  if (aids.control >= 2) {
    controls.throttle = ap.pedal > 0 ? ap.pedal : 0;
    controls.brakeFront = controls.brakeRear = ap.pedal < 0 ? -ap.pedal : 0;
  } else if (aids.control === 1 && ap.pedal < 0) {
    const brake = Math.max(controls.brakeFront ?? 0, controls.brakeRear ?? 0);
    if (brake < -ap.pedal) {
      controls.throttle = 0;
      controls.brakeFront = controls.brakeRear = -ap.pedal;
    }
  }
  if (aids.steeringHelp) {
    const room = aids.steeringHelp === 2 && !ap.passing ? LINE_ROOM_FT : ap.room;
    const usable = Math.max(0.5, room - 1);
    const share = Math.min(1, Math.abs(ap.e) / usable);
    const past = Math.abs(ap.e) >= usable ? (ap.e > 0 ? ap.e - usable : ap.e + usable) * ap.aidEdge : 0;
    const centre = ap.aidCentre + past;
    const near = (1 - share) * AID_WINDOW;
    // The window opens 0.1 rad toward the line and closes toward the near edge (e > 0: the car is left of the line).
    const lo = ap.e > 0 ? centre - near : centre - AID_WINDOW;
    const hi = ap.e > 0 ? centre + AID_WINDOW : centre + near;
    if (controls.steer < lo) controls.steer = lo;
    else if (controls.steer > hi) controls.steer = hi;
  }
}

/** Spin Correction (14.3): the heading to turn the player's car to, or null. */
export function spinCorrection(state, ap) {
  if (!ap) return null;
  const heading = state.euler[2];
  const off = wrapAngle(ap.courseHeading - heading);
  if (Math.abs(off) <= CPR_SPIN_CORRECTION_RAD) return null;
  // The world velocity: the body's turned by the body-to-world matrix.
  const m = state.matrix, b = state.bvel;
  const vx = m[0] * b[0] + m[1] * b[1] + m[2] * b[2], vz = m[6] * b[0] + m[7] * b[1] + m[8] * b[2];
  return vx * Math.sin(ap.courseHeading) + vz * Math.cos(ap.courseHeading) < 0 ? ap.courseHeading : null;
}
