import test from "node:test";
import assert from "node:assert/strict";
import { raceLinePoints } from "../src/game/race-line.js";

test("the racing line cuts a straight into 24 ft pieces (at most 64), 0.35 ft over the ground", () => {
  const pts = raceLinePoints([{ startFt: [0, 0, 0], endFt: [100, 0, 0] }], () => 10);
  assert.equal(pts.length, 2 * 5);
  assert.deepEqual(pts[0], [0, 10.35, 0]);
  assert.deepEqual(pts.at(-1), [100, 10.35, 0]);
  assert.equal(raceLinePoints([{ startFt: [0, 0, 0], endFt: [10000, 0, 0] }], () => 0).length, 2 * 64);
});
