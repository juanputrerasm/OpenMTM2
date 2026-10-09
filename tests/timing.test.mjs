import test from "node:test";
import assert from "node:assert/strict";
import { createCrossingLog, raceGap, recordCrossings } from "../src/game/timing.js";

const truck = (place, passed, raceTime = 0, splits = []) => ({ place, passed, raceTime, splits });

test("crossings are logged at the race time of the checkpoint, across a lap closing", () => {
  const logs = createCrossingLog(1);
  recordCrossings(logs, [truck(1, 1, 0, [4])]);
  recordCrossings(logs, [truck(1, 2, 0, [4, 5])]);
  recordCrossings(logs, [truck(1, 2, 0, [4, 5])]);
  recordCrossings(logs, [truck(1, 3, 12, [])]);
  assert.deepEqual(logs[0], [4, 9, 12]);
});

test("first place reads Lead against second; others read Back against the truck ahead", () => {
  const logs = [[10, 20, 30], [11, 22], [12]];
  const trucks = [truck(1, 3), truck(2, 2), truck(3, 1)];
  assert.deepEqual(raceGap(trucks, logs, 0), { kind: "lead", seconds: 2 });
  assert.deepEqual(raceGap(trucks, logs, 1), { kind: "back", seconds: 2 });
  assert.deepEqual(raceGap(trucks, logs, 2), { kind: "back", seconds: 1 });
});

test("the gap compares at the rear truck's checkpoint and is never negative", () => {
  const logs = [[5, 9], [4, 11, 15]];
  const trucks = [truck(2, 2), truck(1, 3)];
  assert.deepEqual(raceGap(trucks, logs, 0), { kind: "back", seconds: 2 });
});

test("no one to compare with, or no checkpoint yet, gives nothing or zero", () => {
  assert.equal(raceGap([truck(1, 0)], createCrossingLog(1), 0), null);
  assert.deepEqual(raceGap([truck(1, 0), truck(2, 0)], createCrossingLog(2), 0), { kind: "lead", seconds: 0 });
});
