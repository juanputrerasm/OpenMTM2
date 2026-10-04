import { test } from "node:test";
import assert from "node:assert/strict";
import { CPU_NAMES, formatRaceTime, ordinal, raceEntrants } from "../src/game/race-setup.js";

const trucks = ["A.TRK", "B.TRK", "C.TRK", "D.TRK", "E.TRK", "F.TRK", "G.TRK", "H.TRK", "I.TRK"].map((file) => ({ file, name: file, hidden: false }));

test("entrants: the player first, then CPU trucks named Mark to Terry, all different from each other and the player's", () => {
  const e = raceEntrants({ playerTruck: "C.TRK", trucks: [...trucks, { file: "CHUCK.TRK", hidden: true }], slots: 8 });
  assert.equal(e.length, 8);
  assert.deepEqual(e[0], { name: "You", file: "C.TRK", player: true });
  assert.deepEqual(e.slice(1).map((x) => x.name), CPU_NAMES.slice(0, 7));
  const files = e.map((x) => x.file);
  assert.equal(new Set(files).size, 8);
  assert.ok(!files.includes("CHUCK.TRK"));
});

test("entrants: no more than the grid holds", () => {
  assert.equal(raceEntrants({ playerTruck: "A.TRK", trucks, slots: 4 }).length, 4);
});

test("race times print as %02d:%05.2f", () => {
  assert.equal(formatRaceTime(0), "00:00.00");
  assert.equal(formatRaceTime(65.256), "01:05.26");
  assert.equal(formatRaceTime(600.5), "10:00.50");
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(8), "8th");
});
