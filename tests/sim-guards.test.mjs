/*
  The simulation worker's guards against broken numbers (worker/sim-worker.js), found on F.S.R., a Summit Rumble track
  played in Tag: its course of two straights in line builds an arc of no finite size, and two flat camper sides that
  overlap give the box pair test a contact of no direction. Either spread NaN into the trucks' controls and wheels.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { MIN_BOX_FT, keepBoxSane, solidBounds, usableCourse } from "../src/worker/sim-worker.js";
import { mtm2Sim as S } from "../src/vendor/openphotex/index.js";

const straight = (start, end) => ({ startFt: start, endFt: end, ctype: 1, cspeedType: 0, cdecPoint: 30, cspeed: 0, speedLimit: 0, trackWidthFt: 16 });

test("a course of two straights in line is no course; a real one is kept", () => {
  const inLine = S.buildCourse([straight([4002, 10, 3776], [4022, 10, 3776]), straight([4032, 10, 3776], [4052, 10, 3776])], () => 0);
  assert.deepEqual(usableCourse(inLine), []);
  const square = S.buildCourse([
    straight([0, 0, 0], [0, 0, 500]), straight([100, 0, 600], [600, 0, 600]),
    straight([700, 0, 500], [700, 0, 0]), straight([600, 0, -100], [100, 0, -100]),
  ], () => 0);
  assert.equal(usableCourse(square), square);
});

test("a flat model's box gets a least thickness about its middle", () => {
  const out = solidBounds({ min: [2, -2, -3], max: [2, 2, 3] });
  assert.deepEqual(out.min, [2 - MIN_BOX_FT / 2, -2, -3]);
  assert.deepEqual(out.max, [2 + MIN_BOX_FT / 2, 2, 3]);
  assert.equal(solidBounds(null), null);
});

test("a box whose numbers break is put back where it last stood, at rest", () => {
  const box = S.createBox([10, 5, 20], [2, 2, 2], 3);
  assert.equal(keepBoxSane(box), false, "a sane box is kept as it is");
  box.pos[0] = NaN;
  box.bvel[1] = NaN;
  assert.equal(keepBoxSane(box), true);
  assert.deepEqual(box.pos, [10, 5, 20]);
  assert.deepEqual([...box.bvel], [0, 0, 0]);
});
