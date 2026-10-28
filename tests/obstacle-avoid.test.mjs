/*
  Computer racers steering clear of solid objects and ground-box walls (game/obstacle-avoid.js, game/cpu-control.js),
  and the helicopter setting a truck down on the part of the course it has reached (game/heli-flight.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { avoidObstacles, boxObstacles, groundBoxWalls } from "../src/game/obstacle-avoid.js";
import { cpuAvoidStep, cpuControlBefore, createCpuControl } from "../src/game/cpu-control.js";
import { courseWindow, nearestCourseSpot } from "../src/game/heli-flight.js";

/** A truck at `pos` heading `heading` (0 along +z) at `speed` ft/s, nose first. */
function truck(pos, heading = 0, speed = 60) {
  const c = Math.cos(heading), s = Math.sin(heading);
  return {
    pos: [...pos], euler: [0, 0, heading], bvel: [0, 0, speed], matrix: [c, 0, s, 0, 1, 0, -s, 0, c],
    controls: { steer: 0, rearSteer: 0, throttle: 1, brakeFront: 0, brakeRear: 0, gear: 4 },
  };
}

test("a thing in the way turns the wheel away from it; one beside the way or behind does nothing", () => {
  const s = truck([0, 0, 0]);
  const right = avoidObstacles(s, [{ pos: [4, 0, 60], radius: 4 }]);
  assert.ok(right.steer < 0, "a thing right of the way: steer left");
  assert.ok(avoidObstacles(s, [{ pos: [-4, 0, 60], radius: 4 }]).steer > 0, "left of the way: steer right");
  assert.equal(avoidObstacles(s, [{ pos: [60, 0, 60], radius: 4 }]).steer, 0, "well beside the way");
  assert.equal(avoidObstacles(s, [{ pos: [0, 0, -40], radius: 4 }]).steer, 0, "behind");
  assert.ok(Math.abs(avoidObstacles(s, [{ pos: [1, 0, 30], radius: 6 }]).steer) > Math.abs(avoidObstacles(s, [{ pos: [1, 0, 90], radius: 6 }]).steer), "the nearer, the harder");
  assert.ok(avoidObstacles(s, [{ pos: [0.5, 0, 25], radius: 6 }]).ease < 1, "close and square in the way: off the throttle");
  // Dead ahead: toward the course.
  assert.ok(avoidObstacles(s, [{ pos: [0, 0, 60], radius: 4 }], [100, 0, 200]).steer > 0);
});

test("the steering added is taken back before the next autopilot step", () => {
  const m = createCpuControl();
  const s = truck([0, 0, 0]);
  cpuAvoidStep(m, s, [{ pos: [3, 0, 50], radius: 5 }]);
  assert.ok(s.controls.steer < 0);
  cpuControlBefore(m, s.controls);
  assert.ok(Math.abs(s.controls.steer) < 1e-12);
});

test("a long wall is a row of circles, so the room beside it stays open", () => {
  const wall = { pos: [0, 0, 0], half: [100, 5, 2], matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const parts = boxObstacles(wall);
  assert.ok(parts.length > 5);
  assert.ok(parts.every((p) => p.radius < 5));
  assert.equal(avoidObstacles(truck([-150, 0, -15], Math.PI / 2), parts).steer, 0, "driving along beside it");
  assert.notEqual(avoidObstacles(truck([20, 0, -40]), parts).steer, 0, "driving at it");
});

test("a ground box standing up is a wall, unless the course runs over it or the truck is on it or under it", () => {
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536);
  // A raised block 20 ft high three cells ahead of a truck at (16, 6, 16): cells are 32 ft.
  const cell = (c, r) => r * 256 + c;
  ra0[cell(0, 3)] = 0; ra1[cell(0, 3)] = 10;
  const walls = groundBoxWalls([16, 6, 16], 0, 200, { ra0, ra1 });
  assert.equal(walls.length, 1);
  assert.deepEqual(walls[0].pos, [16, 20, 112]);
  assert.equal(groundBoxWalls([16, 6, 16], 0, 200, { ra0, ra1, onCourse: () => true }).length, 0, "the course's own way");
  assert.equal(groundBoxWalls([16, 25, 16], 0, 200, { ra0, ra1 }).length, 0, "level with its top");
  ra0[cell(0, 3)] = 12; ra1[cell(0, 3)] = 14;
  assert.equal(groundBoxWalls([16, 6, 16], 0, 200, { ra0, ra1 }).length, 0, "a bridge overhead");
});

test("the helicopter searches the part of the course round the truck's segment", () => {
  assert.deepEqual(courseWindow(20, 0, 2, 3), [18, 19, 0, 1, 2, 3]);
  assert.equal(courseWindow(6, 0, 2, 6).length, 6, "a short course: all of it");
  // A figure of eight: segment 0 runs north along x = 0, segment 4 runs east along z = 500 and crosses it at (0, 500).
  const course = [
    { ctype: 1, start: [0, 0, 0], end: [0, 0, 1000] },
    { ctype: 1, start: [0, 0, 1000], end: [500, 0, 1000] },
    { ctype: 1, start: [500, 0, 1000], end: [500, 0, 500] },
    { ctype: 1, start: [500, 0, 500], end: [400, 0, 500] },
    { ctype: 1, start: [400, 0, 500], end: [-500, 0, 500] },
    { ctype: 1, start: [-500, 0, 500], end: [-500, 0, 0] },
    { ctype: 1, start: [-500, 0, 0], end: [-200, 0, 0] },
    { ctype: 1, start: [-200, 0, 0], end: [-100, 0, 0] },
    { ctype: 1, start: [-100, 0, 0], end: [-50, 0, 0] },
    { ctype: 1, start: [-50, 0, 0], end: [0, 0, 0] },
  ];
  const height = () => 0;
  // At the crossing, slightly nearer the east-west leg, while on segment 0.
  const at = [3, 0, 499.5];
  assert.equal(nearestCourseSpot(course, at, height).segment, 4, "the whole course: the other leg");
  const spot = nearestCourseSpot(course, at, height, { around: 0, back: 1, ahead: 2 });
  assert.equal(spot.segment, 0, "on segment 0: segment 0");
  assert.ok(Math.abs(spot.heading) < 1e-9, "facing along it");
});
