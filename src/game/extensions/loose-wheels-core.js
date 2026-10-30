/*
  What Combat and Loose Wheels share in the simulation worker (docs/EXTENSIONS.md): measuring a truck's hit from its
  change of velocity step by step, throwing a lost wheel as a loose box every truck can hit, and the bare axle end
  that drags on the ground. The rules for what a hit does live in each mode (combat.js, loose-wheels.js).
*/
import * as S from "../../vendor/openphotex/sim/mtm2/index.js";
import { ENGAGE, IMPACT, STUB_DRAG_FT_S2, TOUCH_MEMORY_S, closingSpeed } from "./combat.js";

/** A loose wheel's mass (slugs, about 400 lb), and the most kept; the oldest goes first. */
export const LOOSE_WHEEL_SLUGS = 12, MOST_LOOSE = 12;
/** A hit lasts at most this many steps before it is counted. */
export const HIT_STEPS = 8;

export const toBody = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
export const toWorld = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const worldVelocity = (s) => toWorld(s.matrix, s.bvel);

/** Where a truck's wheel hub is in the world. */
export function hubPosition(truck, wheel) {
  const s = truck.state, w = toWorld(s.matrix, truck.params.hubs[wheel]);
  return [s.pos[0] + w[0], s.pos[1] + w[1], s.pos[2] + w[2]];
}

/**
 * The loose wheels on the ground: `throw(i, truck, wheel, rand)` makes one from truck `i`'s wheel, a box with the hub's
 * velocity kicked out and up; at most `MOST_LOOSE`, the oldest going first. `nextId()` numbers them (and anything else
 * the mode numbers in the same series, as Combat's hits).
 */
export function createLooseWheels(nextId) {
  const loose = [];
  return {
    loose,
    throw(i, truck, wheel, rand) {
      const s = truck.state, p = truck.params;
      const pos = hubPosition(truck, wheel);
      const side = wheel % 2 === 0 ? 1 : -1;
      const out = toWorld(s.matrix, [side * 14, 10, 0]);
      const v = worldVelocity(s);
      const box = S.createBox(pos, [p.tireWidthFt, p.tireRadiusFt * 2, p.tireRadiusFt * 2], LOOSE_WHEEL_SLUGS, [s.euler[0], s.euler[1], s.euler[2]]);
      box.extensionOwned = true;
      for (let k = 0; k < 3; k++) box.vel[k] = v[k] + out[k];
      box.bvel.set(toBody(box.matrix, box.vel));
      box.rates.set([(rand() - 0.5) * 6, side * 4, (rand() - 0.5) * 6]);
      const id = nextId();
      loose.push({ id, truck: i, wheel, box, seed: id * 7919 });
      if (loose.length > MOST_LOOSE) loose.shift();
    },
    boxes: () => loose.map((l) => l.box),
    view: () => loose.map((l) => ({ id: l.id, truck: l.truck, wheel: l.wheel, seed: l.seed, pos: [...l.box.pos], matrix: Array.from(l.box.matrix) })),
  };
}

/**
 * One step of a truck's hit under way: `rec` keeps `prevVel` and `hit` (`{ dv, excess, steps, start }`, body axes).
 * `v` is the truck's world velocity now. Returns the hit when it is over (and clears it), else null. `active` false
 * (in the helicopter, judged on another machine) drops any hit.
 */
export function hitStep(rec, s, v, now, active) {
  const before = rec.prevVel;
  rec.prevVel = v;
  if (!before || !active) { rec.hit = null; return null; }
  const d = [v[0] - before[0], v[1] - before[1], v[2] - before[2]];
  const size = Math.hypot(d[0], d[1], d[2]);
  if (size > IMPACT.stepFtS) {
    const h = rec.hit ?? (rec.hit = { dv: [0, 0, 0], excess: 0, steps: 0, start: now });
    const b = toBody(s.matrix, d);
    for (let k = 0; k < 3; k++) h.dv[k] += b[k];
    h.excess += size - IMPACT.stepFtS;
    if (++h.steps >= HIT_STEPS) { rec.hit = null; return h; }
  } else if (rec.hit) {
    const h = rec.hit;
    rec.hit = null;
    return h;
  }
  return null;
}

/** Before a truck's step: a lost wheel has no grip and never touches; each stub on the ground drags the truck. */
export function stubStep(state, lost, step) {
  let stubs = 0;
  for (let w = 0; w < 4; w++) {
    if (!lost[w]) continue;
    const tire = state.tires[w];
    if (tire.penetration > -0.1) stubs++;
    tire.onGround = false;
    tire.grip = 0;
  }
  if (stubs) {
    const speed = Math.hypot(state.bvel[0], state.bvel[2]);
    if (speed > 0) {
      const keep = Math.max(0, speed - STUB_DRAG_FT_S2 * stubs * step) / speed;
      state.bvel[0] *= keep;
      state.bvel[2] *= keep;
    }
  }
  return stubs;
}

/** The bare axle ends on the ground, for the drawing's sparks: `lostOf(i)` is truck `i`'s lost wheels. */
export function stubsOf(trucks, lostOf) {
  const stubs = [];
  trucks.forEach((t, i) => {
    lostOf(i).forEach((lost, w) => {
      if (!lost || t.state.tires[w].penetration <= -0.1) return;
      stubs.push({ truck: i, wheel: w, pos: hubPosition(t, w), speed: Math.hypot(t.state.bvel[0], t.state.bvel[2]) });
    });
  });
  return stubs;
}

/**
 * Trucks `a` and `b` (states `sa`, `sb`) touched at `now`: each one's record (`pa`, `pb`) gets `met`, who it met, how
 * fast each closed on the other, where the other was (body axes and world) and when their fight began. The pair's fight
 * (combat.js ENGAGE) goes on while they touch or stay apart for less than `apartS`; a hard new blow after a short gap
 * starts a new one. A blow keeps the closing speeds of its first step for `TOUCH_MEMORY_S`; trucks still touching after
 * that are tangled or leaning on each other, and go by their closing speeds now (small). `fights` is kept by the mode.
 */
export function recordTouch(fights, sa, sb, pa, pb, a, b, now) {
  const va = worldVelocity(sa), vb = worldVelocity(sb);
  const d = [sb.pos[0] - sa.pos[0], sb.pos[1] - sa.pos[1], sb.pos[2] - sa.pos[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const u = d.map((x) => x / len);
  // How fast each was going into the other, along the line between them.
  const closeA = va[0] * u[0] + va[1] * u[1] + va[2] * u[2], closeB = -(vb[0] * u[0] + vb[1] * u[1] + vb[2] * u[2]);
  const key = a < b ? `${a},${b}` : `${b},${a}`;
  const was = fights.get(key);
  const gap = was ? now - was.at : Infinity;
  const fresh = gap > ENGAGE.apartS || (gap >= ENGAGE.rehitGapS && closingSpeed(closeA, closeB) >= IMPACT.truckFullFtS);
  const fight = fresh ? { since: now, at: now } : was;
  fight.at = now;
  fights.set(key, fight);
  const first = now - fight.since <= TOUCH_MEMORY_S;
  const fa = first && pa.met?.other === b && pa.met.since === fight.since ? pa.met : null;
  const fb = first && pb.met?.other === a && pb.met.since === fight.since ? pb.met : null;
  pa.met = { other: b, at: now, since: fight.since, close: fa?.close ?? closeA, theirs: fa?.theirs ?? closeB, toward: toBody(sa.matrix, d), towardWorld: d };
  pb.met = { other: a, at: now, since: fight.since, close: fb?.close ?? closeB, theirs: fb?.theirs ?? closeA, toward: toBody(sb.matrix, d.map((x) => -x)), towardWorld: d.map((x) => -x) };
}
