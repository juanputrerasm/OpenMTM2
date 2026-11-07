/*
  4x4 Evolution 2's computer drivers (EVO2_EXE_ANALYSIS.md 12, aitruck.cpp), for "Computer trucks drive as: EVO"
  (Advanced): each truck follows the track's recorded AI line at the line's own speeds, with the game's look-ahead,
  steering, pedals, rubber band and getting unstuck. Pure, so it runs under Node.

  Where the analysis left a rule untraced the port says so here:
  - the difficulty level is held at the race's skill (Rookie 1, Intermediate 2, Professional 3) instead of the game's
    own two-second adjustment from the trucks near the player;
  - a level's highest and lowest rubber band factors are spread evenly over the traced ranges (1.25 to 1.4, 0.8 to 0.5);
  - a "bend" ahead is a line point turning 5 degrees or more (the look-ahead's own cap);
  - the warp back to the line waits until no human is within WARP_UNSEEN_FT, standing in for the game's view test;
  - the avoidance, passing and ramming states are not traced and not reproduced.

  Units: feet, seconds, radians; positions in the simulation's world, headings with forward (sin psi, cos psi).
*/

/** The figures of aitruck.cpp. */
export const EVO_AI = Object.freeze({
  dropLast: 5,
  lookFactor: 0.7, lookMinShare: 0.4, lookTurnDeg: 5, lookMinFt: 20, lookEase: 6, lookPointsAhead: 2,
  steerDeg: 15, steerAngle: 0.45, handbrakeFtS: 60,
  minTargetFtS: 25, rain: 0.9, snow: 0.8,
  bendS: 2.5, throttleDrop: 10, throttleRate: 10, brakeRate: 20, brakeHard: 0.75, brakeSoft: 0.5, hardOver: 1.5, softOver: 1.25,
  bands: Object.freeze([0.9, 1.0, 1.1, 1.2]), highest: Object.freeze([1.25, 1.4]), lowest: Object.freeze([0.8, 0.5]),
  nearLengths: 5, aheadLengths: 20, behindLengths: 10, behindBoost: 1.1, pairLengths: 2, pairAhead: 1.05, pairBehind: 0.95, bandRate: 0.1,
  stuckThrottle: 0.9, stuckFt: 7, stuckCheckS: 1, reverseS: 4,
  lostS: 10, lostFt: 256, warpUpFt: 10,
});
/** No human within this many feet: the warp back to the line goes unseen. */
export const WARP_UNSEEN_FT = 300;

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/** The line the drivers follow: points without the last five, each with its speed and the turn there, degrees. */
export function evoAiLine({ points, speeds }) {
  const n = Math.max(0, points.length - EVO_AI.dropLast);
  const pts = points.slice(0, n);
  const spd = pts.map((_, i) => (Number.isFinite(speeds?.[i]) ? speeds[i] : NaN));
  // A point without a speed takes its neighbour's.
  for (let i = 0; i < n; i++) if (!Number.isFinite(spd[i])) spd[i] = i > 0 ? spd[i - 1] : 60;
  const turn = pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const h1 = Math.atan2(p[0] - a[0], p[2] - a[2]), h2 = Math.atan2(b[0] - p[0], b[2] - p[2]);
    return Math.abs(wrap(h2 - h1)) / DEG;
  });
  return { points: pts, speeds: spd, turn };
}

/** The rubber band's level figures for a skill level 1 to 4. */
export function bandLevel(level) {
  const i = clamp(Math.round(level), 1, 4) - 1, f = i / 3;
  return {
    base: EVO_AI.bands[i],
    highest: EVO_AI.highest[0] + (EVO_AI.highest[1] - EVO_AI.highest[0]) * f,
    lowest: EVO_AI.lowest[0] + (EVO_AI.lowest[1] - EVO_AI.lowest[0]) * f,
  };
}

/**
 * The rubber band's wanted factor for a truck `aheadFt` ahead of the nearest human along the line (negative: behind),
 * `lengthFt` its length.
 */
export function bandFactor(level, aheadFt, lengthFt) {
  const b = bandLevel(level), L = Math.max(1, lengthFt), d = aheadFt / L;
  if (Math.abs(d) <= EVO_AI.nearLengths) return d < 0 ? b.base * EVO_AI.behindBoost : b.base;
  if (d > 0) return b.base + (b.lowest - b.base) * clamp((d - EVO_AI.nearLengths) / (EVO_AI.aheadLengths - EVO_AI.nearLengths), 0, 1);
  return b.base + (b.highest - b.base) * clamp((-d - EVO_AI.nearLengths) / (EVO_AI.behindLengths - EVO_AI.nearLengths), 0, 1);
}

/** A driver: `line` from `evoAiLine`, `level` 1 to 4. */
export function createEvoDriver(line, level = 2) {
  return { line, level, index: 0, look: EVO_AI.lookMinFt, factor: bandLevel(level).base, throttle: 0, brake: 0,
    progressAt: 0, clock: 0, checkAt: 0, checkPos: null, reverseLeft: 0, travelled: 0 };
}

/** The nearest line point to `pos`, searched from the driver's index a little back and well ahead. */
function nearestPoint(d, pos) {
  const { points } = d.line, n = points.length;
  let best = d.index, bestD = Infinity;
  for (let k = -20; k <= 200; k++) {
    const i = (d.index + k + n) % n, p = points[i];
    const dd = (p[0] - pos[0]) ** 2 + (p[2] - pos[2]) ** 2;
    if (dd < bestD) { bestD = dd; best = i; }
  }
  return { index: best, distance: Math.sqrt(bestD) };
}

/** Distance along the line from point `a` forward to point `b`, feet. */
export function alongLine(line, a, b) {
  const { points } = line, n = points.length;
  let sum = 0;
  for (let i = a, k = 0; i !== b && k < n; i = (i + 1) % n, k++) {
    const p = points[i], q = points[(i + 1) % n];
    sum += Math.hypot(q[0] - p[0], q[2] - p[2]);
  }
  return sum;
}

/**
 * One step of a computer driver. `truck`: `{ pos, heading, speed (forward ft/s), allDown (every tire on the ground) }`;
 * `world`: `{ weather: "rain" | "snow" | null, humans: [{ pos, index }] (their line points), others: [{ index }] (the other
 * computer trucks' line points), lengthFt, rearSteerFactor }`. Returns the controls `{ steer, rearSteer, throttle, brake,
 * reverse, handbrake }` and, when the driver goes back to its line, `warp: { pos, heading, speed }`.
 */
export function evoDriveStep(d, truck, world, dt) {
  const A = EVO_AI, line = d.line, n = line.points.length;
  d.clock += dt;
  const near = nearestPoint(d, truck.pos);
  if (near.index !== d.index) { d.index = near.index; d.progressAt = d.clock; }
  const speed = truck.speed;

  // Lost: no progress along the line for 10 s, or 256 ft off it, unseen: back on the line 10 ft up at half its speed.
  if ((d.clock - d.progressAt > A.lostS || near.distance > A.lostFt) && !world.humans.some((h) => Math.hypot(h.pos[0] - truck.pos[0], h.pos[2] - truck.pos[2]) < WARP_UNSEEN_FT)) {
    const p = line.points[d.index], q = line.points[(d.index + 1) % n];
    d.progressAt = d.clock;
    d.reverseLeft = 0;
    return { steer: 0, rearSteer: 0, throttle: 0, brake: 0, reverse: false, handbrake: false,
      warp: { pos: [p[0], p[1] + A.warpUpFt, p[2]], heading: Math.atan2(q[0] - p[0], q[2] - p[2]), speed: line.speeds[d.index] * 0.5 } };
  }

  // The look-ahead: speed x 0.7 x the turn's share, at least 20 ft, eased at 6 a second.
  const turnHere = line.turn[d.index];
  const wantLook = Math.max(A.lookMinFt, speed * A.lookFactor * Math.max(A.lookMinShare, Math.min(turnHere, A.lookTurnDeg) / A.lookTurnDeg));
  d.look += (wantLook - d.look) * Math.min(1, A.lookEase * dt);
  let target = (d.index + A.lookPointsAhead) % n;
  for (let k = A.lookPointsAhead, run = 0; k < n; k++) {
    const i = (d.index + k) % n, p = line.points[i];
    run = Math.hypot(p[0] - truck.pos[0], p[2] - truck.pos[2]);
    target = i;
    if (run > d.look) break;
  }
  const tp = line.points[target];
  const err = wrap(Math.atan2(tp[0] - truck.pos[0], tp[2] - truck.pos[2]) - truck.heading);
  const raw = err / (A.steerDeg * DEG);
  const steerShare = clamp(raw, -1, 1);
  const steer = A.steerAngle * steerShare;
  const handbrake = Math.abs(raw) >= 1 && speed > A.handbrakeFtS;

  // The rubber band against the nearest human, and the computer trucks close by.
  if (world.humans.length) {
    let ahead = Infinity;
    for (const h of world.humans) {
      const fwd = alongLine(line, h.index, d.index), back = alongLine(line, d.index, h.index);
      const gap = fwd <= back ? fwd : -back;
      if (Math.abs(gap) < Math.abs(ahead)) ahead = gap;
    }
    let want = bandFactor(d.level, ahead, world.lengthFt);
    for (const o of world.others ?? []) {
      const fwd = alongLine(line, o.index, d.index), back = alongLine(line, d.index, o.index);
      if (fwd < A.pairLengths * world.lengthFt) want *= A.pairAhead;
      else if (back < A.pairLengths * world.lengthFt) want *= A.pairBehind;
    }
    d.factor += clamp(want - d.factor, -A.bandRate * dt, A.bandRate * dt);
  }

  const weather = world.weather === "rain" ? A.rain : world.weather === "snow" ? A.snow : 1;
  const next = (d.index + 1) % n;
  const targetSpeed = Math.max(A.minTargetFtS, line.speeds[next] * weather * d.factor);
  // Time to the next bend at this speed.
  let bendS = Infinity;
  for (let k = 1, run = 0; k < Math.min(n, 400); k++) {
    const i = (d.index + k) % n, p = line.points[(i + n - 1) % n], q = line.points[i];
    run += Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (line.turn[i] >= A.lookTurnDeg) { bendS = speed > 1 ? run / speed : Infinity; break; }
  }
  let wantThrottle = 1, wantBrake = 0;
  if (!(speed <= targetSpeed || bendS > A.bendS)) {
    wantThrottle = Math.max(0, d.throttle - A.throttleDrop * dt);
    if (truck.allDown) wantBrake = speed > A.hardOver * targetSpeed ? A.brakeHard : speed > A.softOver * targetSpeed ? A.brakeSoft : 0;
  }

  // Stuck: flat out but under 7 ft in a second: four seconds in reverse, the wheel the other way.
  if (!d.checkPos) { d.checkPos = [...truck.pos]; d.checkAt = d.clock; }
  if (d.clock - d.checkAt >= A.stuckCheckS) {
    const moved = Math.hypot(truck.pos[0] - d.checkPos[0], truck.pos[2] - d.checkPos[2]);
    if (d.reverseLeft <= 0 && d.throttle > A.stuckThrottle && moved < A.stuckFt) d.reverseLeft = A.reverseS;
    d.checkPos = [...truck.pos]; d.checkAt = d.clock;
  }
  const reverse = d.reverseLeft > 0;
  if (reverse) { d.reverseLeft -= dt; wantThrottle = 1; wantBrake = 0; }

  d.throttle += clamp(wantThrottle - d.throttle, -A.throttleRate * dt, A.throttleRate * dt);
  d.brake += clamp(wantBrake - d.brake, -A.brakeRate * dt, A.brakeRate * dt);
  const s = reverse ? -steer : steer;
  return { steer: s, rearSteer: -s * (world.rearSteerFactor ?? 0), throttle: d.throttle, brake: d.brake, reverse, handbrake: handbrake && !reverse, warp: null };
}
