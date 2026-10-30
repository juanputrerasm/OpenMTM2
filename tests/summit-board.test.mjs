import test from "node:test";
import assert from "node:assert/strict";
import { summitBoard } from "../src/game/race-setup.js";

test("the player's own row in a Summit Rumble's standings is written in dark red", () => {
  const rows = summitBoard([{ score: 10 }, { score: 30 }], ["You", "Sam"], 0);
  assert.deepEqual(rows, [["Sam", "30"], [[{ text: "You", color: "#800000" }], "10"]]);
});

test("with no player (a spectator) every row is plain", () => {
  const rows = summitBoard([{ score: 10 }, { score: 30 }], ["You", "Sam"]);
  assert.deepEqual(rows, [["Sam", "30"], ["You", "10"]]);
});
