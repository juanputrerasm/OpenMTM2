import test from "node:test";
import assert from "node:assert/strict";
import { APPROACH_S, CARRY_S, SET_DOWN_S, createFlight, departVisual, flightVisual, nearestCourseSpot, stepFlight, timerVisual, wrapPi } from "../src/game/heli-flight.js";

const flat = () => 0;
const straight = { ctype: 1, start: [0, 0, 0], end: [0, 0, 100] };

test("the nearest spot on a straight is the foot of the perpendicular and runs along the straight", () => {
  const spot = nearestCourseSpot([straight], [30, 5, 40], flat);
  assert.deepEqual(spot.pos, [0, 0, 40]);
  assert.equal(spot.heading, 0);
  assert.equal(Math.round(spot.distance), 30);
});

test("past the end of a straight the spot is its end; the nearest of several wins", () => {
  const other = { ctype: 1, start: [200, 0, 0], end: [300, 0, 0] };
  assert.deepEqual(nearestCourseSpot([straight], [0, 0, 150], flat).pos, [0, 0, 100]);
  assert.equal(nearestCourseSpot([straight, other], [190, 0, 10], flat).pos[0], 200);
  assert.equal(nearestCourseSpot([], [0, 0, 0], flat), null);
});

test("on an arc the spot lies on the circle and the heading is the tangent in the travel direction", () => {
  const arc = { ctype: 2, centre: [0, 0, 0], radius: 50, entryAngle: 0, exitAngle: Math.PI / 2 };
  const spot = nearestCourseSpot([arc], [100, 0, 100], flat);
  assert.ok(Math.abs(spot.pos[0] - 50 * Math.sin(Math.PI / 4)) < 1e-9);
  assert.ok(Math.abs(wrapPi(spot.heading - (Math.PI / 4 + Math.PI / 2))) < 1e-9);
  const back = { ...arc, entryAngle: Math.PI / 2, exitAngle: 0 };
  assert.ok(Math.abs(wrapPi(nearestCourseSpot([back], [100, 0, 100], flat).heading - (Math.PI / 4 - Math.PI / 2))) < 1e-9);
});

test("the flight holds the truck for the approach, then carries it to the spot, level and facing along the course", () => {
  const s = { pos: [30, 3, 40], euler: [0.8, -0.6, 2] };
  const flight = createFlight(s, { pos: [0, 0, 100], heading: 0 }, { height: flat });
  let done = false, steps = 0;
  while (!done && steps < 2000) {
    done = stepFlight(flight, s, 1 / 60);
    steps++;
    if (flight.t < APPROACH_S - 0.05) assert.deepEqual(s.pos, [30, 3, 40]);
  }
  assert.ok(done);
  assert.ok(Math.abs(steps / 60 - (APPROACH_S + CARRY_S + SET_DOWN_S)) < 0.05);
  assert.ok(Math.abs(s.pos[0]) < 1e-6 && Math.abs(s.pos[2] - 100) < 1e-6);
  assert.ok(s.pos[1] > 0);
  assert.ok(Math.abs(s.euler[0]) < 1e-9 && Math.abs(s.euler[1]) < 1e-9 && Math.abs(wrapPi(s.euler[2])) < 1e-9);
});

test("the truck never dips below the ground on the way", () => {
  const hill = (x) => Math.max(0, 60 - Math.abs(x - 15) * 4);
  const s = { pos: [0, 2, 0], euler: [0, 0, 0] };
  const flight = createFlight(s, { pos: [30, hill(30), 0], heading: 1 }, { height: hill });
  while (!stepFlight(flight, s, 1 / 60)) if (flight.t > APPROACH_S) assert.ok(s.pos[1] >= hill(s.pos[0]) + 7.9);
});

test("helicopter placement: spiralling in, hanging over the truck, leaving", () => {
  const s = { pos: [0, 0, 0], euler: [0, 0, 1] };
  const flight = createFlight(s, { pos: [10, 0, 10], heading: 0 }, { height: flat, teryl: true });
  const start = flightVisual(flight, s);
  assert.ok(start.pos[1] > 60);
  assert.equal(start.teryl, true);
  flight.t = APPROACH_S + 1;
  assert.deepEqual(flightVisual(flight, s).pos, [0, 12, 0]);
  assert.equal(departVisual({ t: 4, pos: [0, 0, 0], heading: 0 }), null);
  assert.ok(departVisual({ t: 1, pos: [0, 0, 0], heading: 0 }).pos[1] > 12);
  assert.equal(timerVisual(0, [0, 0, 0], 0), null);
  assert.deepEqual(timerVisual(5, [1, 2, 3], 0.5).pos, [1, 14, 3]);
  assert.ok(timerVisual(11, [0, 0, 0], 0).pos[1] > 12);
});
