import { test } from "node:test";
import assert from "node:assert/strict";
import { CPU_NAMES, DEFAULT_OPPONENTS, formatRaceTime, ordinal, raceEntrants } from "../src/game/race-setup.js";

const trucks = ["A.TRK", "B.TRK", "C.TRK", "D.TRK", "E.TRK", "F.TRK", "G.TRK", "H.TRK", "I.TRK"].map((file) => ({ file, hidden: false }));
/** A seeded generator, so the draws repeat. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("entrants: the player, then a CPU driver per flagged truck in catalogue order, named Mark onward", () => {
  const e = raceEntrants({ playerTruck: "I.TRK", trucks: [...trucks, { file: "CHUCK.TRK", hidden: true }], slots: 8, opponents: 7, random: seeded(1) });
  assert.equal(e.length, 8);
  assert.deepEqual([e[0].name, e[0].file, e[0].player], ["You", "I.TRK", true]);
  assert.deepEqual(e.slice(1).map((x) => x.name), CPU_NAMES.slice(0, 7));
  const files = e.slice(1).map((x) => x.file);
  assert.deepEqual(files, [...files].sort(), "catalogue order");
  assert.equal(new Set(e.map((x) => x.file)).size, 8);
  assert.ok(!files.includes("CHUCK.TRK"));
});

test("entrants: drawing the player's truck leaves one opponent fewer; the built-in default is 3", () => {
  assert.equal(DEFAULT_OPPONENTS, 3);
  // A generator that always draws the first truck, then the next ones.
  const draws = [0, 0.15, 0.3];
  let k = 0;
  const e = raceEntrants({ playerTruck: "A.TRK", trucks, slots: 8, random: () => draws[k++] ?? 0 });
  assert.deepEqual(e.map((x) => x.file), ["A.TRK", "B.TRK", "C.TRK"]);
});

test("the grid: every driver gets a different one of the first slots", () => {
  for (let seed = 1; seed < 20; seed++) {
    const e = raceEntrants({ playerTruck: "A.TRK", trucks, slots: 8, opponents: 5, random: seeded(seed) });
    assert.deepEqual(e.map((x) => x.slot).sort(), e.map((_, i) => i));
  }
});

test("race times print as %02d:%05.2f", () => {
  assert.equal(formatRaceTime(0), "00:00.00");
  assert.equal(formatRaceTime(65.256), "01:05.26");
  assert.equal(formatRaceTime(600.5), "10:00.50");
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(8), "8th");
});
