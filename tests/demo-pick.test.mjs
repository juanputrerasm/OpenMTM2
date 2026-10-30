import test from "node:test";
import assert from "node:assert/strict";
import { pickDemoRace } from "../src/game/demo-pick.js";

const tracks = [
  { file: "A.SIT", raceType: "circuit" }, { file: "B.SIT", raceType: "rally" }, { file: "C.SIT", raceType: "summit" },
  { file: "D.SIT", raceType: "drag" }, { file: "WAR.SIT", raceType: "circuit", hidden: true }, { file: "M.SIT", raceType: "rally", freeRoamOnly: true },
];
const trucks = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"].map((file) => ({ file, game: "MTM" }));

test("the demo races a Circuit or a Rally, never a hidden one or one with no race", () => {
  const seen = new Set();
  for (let k = 0; k < 40; k++) seen.add(pickDemoRace({ tracks, trucks, random: () => (k % 10) / 10 }).track.file);
  assert.deepEqual([...seen].sort(), ["A.SIT", "B.SIT"]);
});

test("the demo takes the player's number of computer opponents, and not the player's truck among them", () => {
  for (const n of [0, 2, 5]) {
    const pick = pickDemoRace({ tracks, trucks, settings: { defaultOpponents: n }, playerTruck: "T3" });
    assert.equal(pick.opponents.length, n);
    assert.equal(pick.truck, "T3");
    assert.ok(!pick.opponents.includes("T3"));
    assert.equal(new Set(pick.opponents).size, n);
  }
  assert.equal(pickDemoRace({ tracks, trucks, settings: {} }).opponents.length, 3);
});

test("the player's own opponent list is taken when there is one", () => {
  const pick = pickDemoRace({ tracks, trucks, settings: { defaultOpponents: 3, opponentTrucks: ["T5", "T6"] }, playerTruck: "T1" });
  assert.deepEqual(pick.opponents, ["T5", "T6"]);
});

test("the next demo is on another track when there is one", () => {
  for (let k = 0; k < 10; k++) assert.equal(pickDemoRace({ tracks, trucks, avoid: "A.SIT", random: () => k / 10 }).track.file, "B.SIT");
});
