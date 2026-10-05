import test from "node:test";
import assert from "node:assert/strict";
import { winnerCells } from "../src/ui/screens/results.js";

test("Winner's Circle rows follow the artwork's seven columns", () => {
  assert.deepEqual(winnerCells({
    place: 1, name: "Player", truckName: "Bear Foot", score: 0,
    finished: true, raceTime: 65.25, laps: 3, best: 21.5,
  }, { laps: 3, difficulty: 2 }), ["1st", "Player", "Bear Foot", "Professional", "", "01:05.25", "00:21.50"]);

  assert.deepEqual(winnerCells({
    place: 2, name: "Mark", truckName: "Bigfoot", score: 12, finished: true, raceTime: 0, laps: 0, best: 0,
  }, { summit: true, laps: 5, difficulty: 0 }), ["2nd", "Mark", "Bigfoot", "Rookie", "12", "05:00.00", ""]);
});
