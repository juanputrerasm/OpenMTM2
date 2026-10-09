/*
  Rumble driving for computer trucks (src/game/rumble-ai.js): the flow field to a raised zone and
  the controls it gives.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { buildRumbleField, createRumbleDriver, fieldGuide, rumbleControls, rumbleTarget } from "../src/game/rumble-ai.js";

const GEARS = { FIRST: 4, REVERSE: 2 };
const ZONE = { pos: [0, 54, 0], half: [32, 10, 32] };

/** A 50 ft high plateau 160 ft square around the origin, with one ramp up its south side. */
function plateau(x, z) {
  if (Math.abs(x) < 80 && Math.abs(z) < 80) return [50];
  if (Math.abs(x) < 24 && z <= -80 && z > -330) return [50 + (z + 80) * 0.2];
  return [0];
}

function walk(field, from, steps = 200) {
  const pos = [...from];
  const path = [];
  for (let i = 0; i < steps; i++) {
    const g = fieldGuide(field, pos);
    if (!g || g.dist === 0) break;
    pos[0] = g.point[0];
    pos[1] = g.point[1] + 4;
    pos[2] = g.point[2];
    path.push([...pos]);
  }
  return path;
}

test("the field climbs a plateau by its ramp, not its walls", () => {
  const field = buildRumbleField(ZONE, plateau, { extent: 512 });
  // From the north, the way up goes round to the ramp on the south side.
  const path = walk(field, [0, 4, 300]);
  assert.ok(path.length > 0);
  assert.ok(path.some((p) => p[2] < -150 && Math.abs(p[0]) < 30), "passes the foot of the ramp");
  const end = path.at(-1);
  assert.ok(Math.abs(end[0]) < 40 && Math.abs(end[2]) < 40, `ends in the zone: ${end}`);
});

test("a table's top is a second layer: under it is not on it", () => {
  // A 20 ft table top (from 14 ft up) over the zone, reached by a jump off a kicker to its south.
  const layers = (x, z) => {
    if (Math.abs(x) < 64 && Math.abs(z) < 64) return [0, 20];
    if (Math.abs(x) < 24 && z <= -64 && z > -110) return [Math.max(0, 16 - (-64 - z) * 0.35)];
    return [0];
  };
  const field = buildRumbleField({ pos: [0, 24, 0], half: [32, 8, 32] }, layers, { extent: 400 });
  const under = fieldGuide(field, [0, 4, 0]);
  const on = fieldGuide(field, [0, 24, 0]);
  assert.equal(on.dist, 0);
  assert.ok(under === null || under.dist > 0, "a truck under the table is not in the zone");
  // From well south, the field calls for a jump.
  const south = fieldGuide(field, [0, 4, -150]);
  assert.ok(south, "a path exists");
  const path = walk(field, [0, 4, -200]);
  assert.ok(path.length > 0);
});

test("the zone target: hold the centre, push a rival in the zone, approach from outside", () => {
  assert.equal(rumbleTarget([0, 54, 0], ZONE, [], 0.5).speed, 0);
  const push = rumbleTarget([20, 54, 0], ZONE, [[0, 54, 10]], 0.8);
  assert.equal(push.push, true);
  assert.deepEqual(push.point, [0, 54, 10]);
  // A rival outside the zone is left alone.
  assert.equal(rumbleTarget([20, 54, 0], ZONE, [[200, 54, 0]], 0.8).push, false);
  const far = rumbleTarget([0, 54, 400], ZONE, [], 0.5);
  assert.ok(far.speed > 50);
});

test("controls: steer toward the zone, back out when pinned", () => {
  const s = {
    pos: [100, 54, 0], euler: [0, 0, 0], bvel: new Float64Array(3),
    controls: { throttle: 0, brakeFront: 0, brakeRear: 0, steer: 0, rearSteer: 0, gear: GEARS.FIRST },
  };
  const driver = createRumbleDriver(0.5);
  // Facing +z with the zone to the -x side: steer that way, throttle open.
  for (let i = 0; i < 10; i++) rumbleControls(s, driver, ZONE, [], GEARS, 1 / 30);
  assert.ok(s.controls.steer < 0, `steer ${s.controls.steer}`);
  assert.ok(s.controls.throttle > 0);
  // Not moving with the throttle down: after a while, reverse.
  s.euler[2] = -Math.PI / 2;
  for (let i = 0; i < 60; i++) rumbleControls(s, driver, ZONE, [], GEARS, 1 / 30);
  assert.equal(driver.mode, "reverse");
  assert.equal(s.controls.gear, GEARS.REVERSE);
});
