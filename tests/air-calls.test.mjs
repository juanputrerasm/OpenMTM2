import test from "node:test";
import assert from "node:assert/strict";
import { airCall, airCallRange, airCallSwitches } from "../src/game/air-calls.js";

test("a computer truck sounds off only over 10 ft, by the game's chance", () => {
  const on = airCallSwitches({});
  assert.equal(airCall(9.9, 0, 1, on, () => 0), null);
  // 20 ft for a 30th of a second: 1.5 x 20 in 5000.
  assert.equal(airCall(20, 0, 1 / 30, on, () => 0.0059), "horn");
  assert.equal(airCall(20, 0, 1 / 30, on, () => 0.0061), null);
});

test("CP3's switches: both on picks either, one off always the other, both off nothing; Reduce is 6 to 10 times rarer", () => {
  const draws = [0, 0.7];
  assert.equal(airCall(50, 0, 1, { horn: true, yeehaw: true, reduce: false }, () => draws.shift()), "yeehaw");
  assert.equal(airCall(50, 0, 1, { horn: false, yeehaw: true, reduce: false }, () => 0), "yeehaw");
  assert.equal(airCall(50, 0, 1, { horn: true, yeehaw: false, reduce: false }, () => 0), "horn");
  assert.equal(airCall(50, 0, 1, { horn: false, yeehaw: false, reduce: false }, () => 0), null);
  assert.equal(airCallRange(0, false), 5000);
  const ranges = [0, 1, 2, 3, 4].map((slot) => airCallRange(slot, true));
  assert.deepEqual([...ranges].sort((a, b) => a - b), [30000, 35000, 40000, 45000, 50000]);
  assert.deepEqual(airCallSwitches({ aiHorn: false, aiSfxReduce: true }), { horn: false, yeehaw: true, reduce: true });
});
