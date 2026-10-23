/*
  CART.EXE's autopilot and driving aids as the port runs them (docs/CPR_PHYSICS.md 14.2, 14.3; game/cpr-driver.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { CPR_AP_CORNER_SHARE, CPR_AP_MIN_V2, applyCprAids, cprAids, cprCourse, createCprDriver, spinCorrection, wrapAngle } from "../src/game/cpr-driver.js";
import * as S from "../src/vendor/openphotex/sim/mtm2/index.js";
import * as Cp from "../src/vendor/openphotex/sim/cpr/index.js";

/**
 * A rectangle course, left-hand corners: straights of 1,000 ft up +z and back, joined by short ones across, built
 * into straight, arc, straight, arc as the game builds a SIT's (arcs of 150 ft radius at each corner).
 */
function stadium() {
  const straights = [
    { startFt: [150, 0, 0], endFt: [150, 0, 1000] },
    { startFt: [0, 0, 1150], endFt: [-1, 0, 1150] },
    { startFt: [-150, 0, 1000], endFt: [-150, 0, 0] },
    { startFt: [0, 0, -150], endFt: [1, 0, -150] },
  ].map((s) => ({ ...s, ctype: 1, cspeedType: 0, cdecPoint: 30, cspeed: 0, speedLimit: 0, trackWidthFt: 0 }));
  return cprCourse(S.buildCourse(straights, () => 0));
}
const FIGURES = { weight: 1911.25, mass: 1911.25 / 32.174, cl: 2.5, cd: 0.9, area: 15, rho: 0.002377, steerLock: 0.31, wheelbase: 10, halfWidth: 3.5 };
const car = (pos, heading, speed) => {
  const m = new Float64Array(9);
  S.eulerToMatrix?.(0, 0, heading, m);
  return {
    pos, euler: [0, 0, heading], bvel: [0, 0, speed], matrix: m, tires: [0, 1, 2, 3].map(() => ({ onGround: true })),
    controls: { steer: 0, throttle: 0, brakeFront: 0, brakeRear: 0 },
  };
};
const ctx = (extra = {}) => ({ car: FIGURES, dt: 1 / 60, mu: Cp.cprMu, ...extra });

test("the course: CART.EXE's records, arcs between the straights with their sweep and length", () => {
  const segs = stadium();
  assert.equal(segs.length, 8);
  assert.equal(segs[0].arc, false);
  assert.equal(segs[1].arc, true);
  assert.ok(Math.abs(segs[0].heading) < 1e-9, "the first straight runs +z");
  assert.ok(Math.abs(segs[1].radius - 150) < 1e-6);
  assert.ok(Math.abs(segs[1].sweep + Math.PI / 2) < 1e-6, "a left-hand corner sweeps negative");
  assert.ok(Math.abs(segs[1].length - (Math.PI / 2) * 150) < 1e-3);
});

test("the corner speed is 75% of the car's limit with its downforce (0x5b1a98), braking before it", () => {
  const segs = stadium();
  // On the arc: the target is its corner speed.
  const onArc = car([150 * Math.SQRT1_2, 0, 1000 + 150 * Math.SQRT1_2], -Math.PI / 4, 100);
  const out = createCprDriver(segs).step(onArc, ctx({ dryRun: true }));
  assert.equal(out.index, 1);
  const muFlat = Cp.cprMu((FIGURES.weight + 0.5 * FIGURES.rho * FIGURES.area * FIGURES.cl * 100 * 100) / 4, true) * 0.5
    + Cp.cprMu((FIGURES.weight + 0.5 * FIGURES.rho * FIGURES.area * FIGURES.cl * 100 * 100) / 4, false) * 0.5;
  const d = (muFlat * FIGURES.cl * 0.5 * FIGURES.rho * FIGURES.area * 150) / FIGURES.mass;
  const expected = Math.sqrt(Math.max(CPR_AP_MIN_V2, ((muFlat * 150 * 32.174) / (1 - d)) * CPR_AP_CORNER_SHARE));
  assert.ok(Math.abs(out.target - expected) < 0.5, `${out.target} vs ${expected}`);
  // Down the straight: faster far from the bend than close to it.
  const far = createCprDriver(segs).step(car([150, 0, 200], 0, 150), ctx({ dryRun: true }));
  const near = createCprDriver(segs).step(car([150, 0, 950], 0, 150), ctx({ dryRun: true }));
  assert.ok(far.target > near.target, `${far.target} then ${near.target}`);
  assert.ok(near.target > expected * 0.9, "no slower than the corner speed at the end");
});

test("throttle and brakes by the speed error, the wheel onto the line (positive turns right)", () => {
  const segs = stadium();
  const slow = car([150, 0, 300], 0, 20);
  const d1 = createCprDriver(segs);
  for (let i = 0; i < 30; i++) d1.step(slow, ctx());
  assert.ok(slow.controls.throttle > 0.7 && slow.controls.brakeFront === 0, `throttle ${slow.controls.throttle}`);
  const late = car([150, 0, 980], 0, 300);
  const d2 = createCprDriver(segs);
  for (let i = 0; i < 30; i++) d2.step(late, ctx());
  assert.ok(late.controls.brakeFront > 0.5 && late.controls.throttle === 0, `brake ${late.controls.brakeFront}`);
  // Left of the line (x is to the right of a car heading +z): it steers right.
  const left = car([140, 0, 300], 0, 100);
  const d3 = createCprDriver(segs);
  for (let i = 0; i < 10; i++) d3.step(left, ctx());
  assert.ok(left.controls.steer > 0, `steer ${left.controls.steer}`);
  // Through the left-hand bend the wheel is turned left, within the lock.
  const bend = car([150 * Math.SQRT1_2, 0, 1000 + 150 * Math.SQRT1_2], wrapAngle(-Math.PI / 4), 80);
  const d4 = createCprDriver(segs);
  for (let i = 0; i < 30; i++) d4.step(bend, ctx());
  assert.ok(bend.controls.steer < 0 && bend.controls.steer >= -FIGURES.steerLock - 1e-9, `steer ${bend.controls.steer}`);
});

test("behind a slower car: no faster than it can stop from, and aside to pass", () => {
  const segs = stadium();
  const alone = createCprDriver(segs).step(car([150, 0, 200], 0, 150), ctx({ dryRun: true }));
  const d = createCprDriver(segs);
  let out;
  for (let i = 0; i < 120; i++) out = d.step(car([150, 0, 200], 0, 150), ctx({ dryRun: true, others: [{ pos: [150, 0, 240], speed: 60 }] }));
  assert.ok(out.target < alone.target, `${out.target} behind, ${alone.target} alone`);
  assert.ok(out.passing, "moves across to pass");
});

test("the Skill Level's aids (14.3): Rookie, Intermediate, Professional", () => {
  assert.deepEqual([cprAids("rookie").control, cprAids("intermediate").control, cprAids("professional").control], [1, 0, 0]);
  assert.deepEqual([cprAids("rookie").gripScale, cprAids("intermediate").gripScale, cprAids("professional").gripScale], [1, 0.8, 0.8]);
  assert.equal(cprAids("professional").offroadGrip, 0.4);
  assert.equal(cprAids("professional").steeringHelp, 0);
  assert.equal(cprAids("intermediate").abs, true);
  // Auto-Brake: the autopilot's harder brake replaces the player's and shuts the throttle.
  const c = { steer: 0, throttle: 1, brakeFront: 0, brakeRear: 0 };
  applyCprAids(c, { pedal: -0.6, e: 0, room: 15, aidCentre: 0, aidEdge: 1 / 300 }, cprAids("rookie"));
  assert.deepEqual([c.throttle, c.brakeFront, c.brakeRear], [0, 0.6, 0.6]);
  // Stay on track: near the left edge the wheel cannot turn further left, toward the line it can.
  const edge = { pedal: 0, e: 13.5, room: 15, aidCentre: 0, aidEdge: 1 / 300 };
  const leftTurn = { steer: -0.3, throttle: 0, brakeFront: 0, brakeRear: 0 };
  applyCprAids(leftTurn, edge, cprAids("intermediate"));
  assert.ok(leftTurn.steer > -0.02, `held to ${leftTurn.steer}`);
  const rightTurn = { steer: 0.08, throttle: 0, brakeFront: 0, brakeRear: 0 };
  applyCprAids(rightTurn, edge, cprAids("intermediate"));
  assert.equal(rightTurn.steer, 0.08);
  // Professional: nothing touched.
  const pro = { steer: -0.3, throttle: 1, brakeFront: 0, brakeRear: 0 };
  applyCprAids(pro, { ...edge, pedal: -1 }, cprAids("professional"));
  assert.deepEqual(pro, { steer: -0.3, throttle: 1, brakeFront: 0, brakeRear: 0 });
});

test("Spin Correction turns a car facing back along the course round (0x5b1b70)", () => {
  const m = new Float64Array(9);
  const backwards = { euler: [0, 0, Math.PI], bvel: [0, 0, 30], matrix: m };
  // Body to world for a heading of pi: forward is -z.
  m.set([-1, 0, 0, 0, 1, 0, 0, 0, -1]);
  assert.equal(spinCorrection(backwards, { courseHeading: 0 }), 0);
  const fine = { euler: [0, 0, 0.2], bvel: [0, 0, 30], matrix: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
  assert.equal(spinCorrection(fine, { courseHeading: 0 }), null);
});

test("name tags: one font pixel a screen pixel up to about 1,600 pixels tall, then two", async () => {
  const { nameTagScale } = await import("../src/render/name-tag-style.js");
  assert.deepEqual([720, 1080, 1440, 1800, 2160].map(nameTagScale), [1, 1, 1, 2, 2]);
});
