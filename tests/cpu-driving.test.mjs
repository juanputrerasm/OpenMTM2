/*
  Computer drivers keeping control and finding their way (pure rules): catching a slide and turning round after a
  spin (game/cpu-control.js), a Rumble's way onto a raised zone and its holding spots (game/rumble-ai.js), and a
  drag pass flat out to the finish (game/drag-race.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { CPU_CONTROL, cpuControlBefore, cpuControlStep, createCpuControl } from "../src/game/cpu-control.js";
import {
  BOX_STEP_FT, CLIMB_SPEED, FINISH_SPEED, buildRumbleField, createRumbleDriver, driveToPoint, fieldGuide, rumbleTarget,
} from "../src/game/rumble-ai.js";
import { DRAG_STRAIGHT, WHEELIE_PITCH, WHEELIE_THROTTLE, dragPedals } from "../src/game/drag-race.js";

const GEARS = { FIRST: 4, REVERSE: 2 };
const DT = 1 / 60;

/** A truck facing `heading` (0 along +z), moving `bvel` (body ft/s), all four wheels down. */
function truck(heading = 0, bvel = [0, 0, 0], { yaw = 0, pos = [0, 0, 0] } = {}) {
  return {
    pos: [...pos], euler: [0, 0, heading], bvel: [...bvel], rates: [0, 0, yaw],
    tires: [0, 1, 2, 3].map(() => ({ onGround: true })),
    controls: { steer: 0, rearSteer: 0, throttle: 1, brakeFront: 0, brakeRear: 0, gear: GEARS.FIRST },
  };
}

test("a computer truck sliding steers into the slide and eases the throttle, never braking it sideways", () => {
  const m = createCpuControl();
  // Travelling to the right of its nose (its tail stepped out left): the wheel turns right, toward the travel.
  const s = truck(0, [30, 0, 60]);
  s.controls.brakeFront = s.controls.brakeRear = 1;
  cpuControlStep(m, s, DT, null, GEARS);
  assert.ok(s.controls.steer > 0.2, `steer ${s.controls.steer}`);
  assert.ok(s.controls.throttle < 1 && s.controls.throttle >= 1 - CPU_CONTROL.slipEase);
  assert.ok(s.controls.brakeFront <= 0.2 && s.controls.brakeRear <= 0.2, "no brakes in a slide");
  // The other way round: left.
  const l = truck(0, [-30, 0, 60]);
  cpuControlStep(createCpuControl(), l, DT, null, GEARS);
  assert.ok(l.controls.steer < -0.2);
  // A truck running straight is left as the autopilot set it, but for the weave's damping.
  const straight = truck(0, [0, 0, 80], { yaw: 0 });
  straight.controls.steer = 0.1;
  cpuControlStep(createCpuControl(), straight, DT, null, GEARS);
  assert.equal(straight.controls.steer, 0.1);
});

test("the steering added is taken back before the autopilot steers again", () => {
  const m = createCpuControl();
  const s = truck(0, [30, 0, 60]);
  s.controls.steer = 0.05;
  cpuControlStep(m, s, DT, null, GEARS);
  assert.notEqual(s.controls.steer, 0.05);
  cpuControlBefore(m, s.controls);
  assert.ok(Math.abs(s.controls.steer - 0.05) < 1e-12);
});

test("in the air or slow, the truck is left to the autopilot", () => {
  const air = truck(0, [30, 0, 60]);
  air.tires.forEach((tire) => { tire.onGround = false; });
  cpuControlStep(createCpuControl(), air, DT, null, GEARS);
  assert.equal(air.controls.steer, 0);
  const slow = truck(0, [5, 0, 10]);
  cpuControlStep(createCpuControl(), slow, DT, null, GEARS);
  assert.equal(slow.controls.steer, 0);
});

test("a truck spun round to face back down the course backs round, then drives on", () => {
  const m = createCpuControl();
  // The course runs +z; the truck faces -z, stopped.
  const s = truck(Math.PI, [0, 0, 0]);
  assert.equal(cpuControlStep(m, s, DT, [0, 0, 300], GEARS), "turn");
  assert.equal(cpuControlStep(m, s, DT, [0, 0, 300], GEARS), "turn");
  assert.equal(s.controls.gear, GEARS.REVERSE);
  assert.equal(Math.abs(s.controls.steer), 0.45);
  // Turned round: forward again.
  s.euler[2] = 0.2;
  assert.equal(cpuControlStep(m, s, DT, [0, 0, 300], GEARS), null);
  assert.equal(s.controls.gear, GEARS.FIRST);
});

/** A zone on a platform 40 ft up, 160 ft square, reached by a ramp from the south; `box` makes the platform a box. */
function platform(box) {
  return (x, z) => {
    if (Math.abs(x) < 80 && Math.abs(z) < 80) { const out = [40]; out.box = [box]; return out; }
    if (Math.abs(x) < 24 && z <= -80 && z > -280) return [40 + (z + 80) * 0.2];
    // A step of 6 ft beside the platform's east side: a slope's worth, but a face if it is a box.
    if (x >= 80 && x < 96 && Math.abs(z) < 80) { const out = [34]; out.box = [box]; return out; }
    return [0];
  };
}
const HIGH_ZONE = { pos: [0, 54, 0], half: [80, 12, 80] };

test("a box's edge is a face: only a step under a wheel's hub is climbed onto it", () => {
  assert.equal(BOX_STEP_FT, 3);
  // The same step up from the 34 ft ledge onto the 40 ft top: terrain is climbed, a box's face is not.
  const slope = buildRumbleField(HIGH_ZONE, platform(false), { extent: 400 });
  const boxes = buildRumbleField(HIGH_ZONE, platform(true), { extent: 400 });
  const fromLedge = [92, 38, 0];
  assert.ok(fieldGuide(slope, fromLedge).dist < 40, "terrain: straight up");
  const guided = fieldGuide(boxes, fromLedge);
  assert.ok(!guided || guided.dist > 100, "a box: round by the ramp, or no way at all");
});

test("a truck against a wall is not taken to be on top of it", () => {
  const field = buildRumbleField(HIGH_ZONE, platform(true), { extent: 400 });
  // At the platform's foot, its cell rounding onto the platform's top.
  const foot = fieldGuide(field, [0, 4, -86]);
  assert.ok(foot && foot.dist > 0, "still on the ground, with the way round to go");
});

test("a Rumble truck keeps its momentum up a ramp, and drives up the last feet into the zone", () => {
  const field = buildRumbleField(HIGH_ZONE, platform(false), { extent: 400 });
  const onRamp = rumbleTarget([0, 20, -180], HIGH_ZONE, [], 0.5, field);
  assert.ok(onRamp.speed >= CLIMB_SPEED, `speed ${onRamp.speed}`);
  const zone = { pos: [0, 54, 0], half: [80, 10, 80] };
  const lip = rumbleTarget([0, 40, -84], zone, [], 0.5, buildRumbleField(zone, platform(false), { extent: 400 }));
  assert.ok(lip.speed >= FINISH_SPEED || lip.speed === 0);
});

test("a big zone has holding spots inside its sides, and a truck stops on one; a small zone keeps its centre", () => {
  // The zone's floor at the platform's top: a truck on it rides well inside.
  const zone = { pos: [0, 50, 0], half: [80, 10, 80] };
  const field = buildRumbleField(zone, platform(false), { extent: 400 });
  assert.ok(field.hold, "a 160 ft zone: holding spots");
  assert.ok(field.holds.every((hold) => Math.abs(hold.pos[0]) <= 60 && Math.abs(hold.pos[2]) <= 60), "20 ft or more inside its sides");
  const on = field.holds.find((hold) => hold.rough === 0);
  assert.equal(rumbleTarget([on.pos[0], 46, on.pos[2]], zone, [], 0, field).speed, 0, "on a spot: stopped");
  const small = { pos: [0, 50, 0], half: [32, 10, 32] };
  assert.equal(buildRumbleField(small, platform(false), { extent: 400 }).hold, null);
});

test("a truck backing into something gives backing up for a while and comes round forward", () => {
  const s = truck(0, [0, 0, 0], { pos: [0, 0, 0] });
  const driver = createRumbleDriver(0.5);
  // A target close behind: it backs, gets nowhere, then goes forward.
  let backed = false;
  for (let t = 0; t < 2.5; t += DT) {
    driveToPoint(s, driver, [0, 0, -30], 20, 0, GEARS, DT);
    if (s.controls.gear === GEARS.REVERSE) backed = true;
    s.bvel[2] = 0;
  }
  assert.ok(backed, "it backed first");
  assert.equal(s.controls.gear, GEARS.FIRST, "then gave it up");
  assert.ok(driver.noBackUntil > driver.clock);
});

test("a computer drag truck is flat out on the straight, eased in a wheelie, and left to the autopilot in a bend", () => {
  const c = { throttle: 0.3, brakeFront: 0.2, brakeRear: 0.2, steer: 0 };
  dragPedals(c, 0.1, 0);
  assert.deepEqual([c.throttle, c.brakeFront, c.brakeRear], [1, 0, 0]);
  dragPedals(c, WHEELIE_PITCH + 0.05, 0);
  assert.equal(c.throttle, WHEELIE_THROTTLE);
  const bend = { throttle: 0.3, brakeFront: 0.2, brakeRear: 0.2, steer: DRAG_STRAIGHT + 0.05 };
  dragPedals(bend, 0, 0);
  assert.equal(bend.throttle, 0.3);
  const sliding = { throttle: 0.3, brakeFront: 0, brakeRear: 0, steer: 0 };
  dragPedals(sliding, 0, 0.3);
  assert.equal(sliding.throttle, 0.3);
});
