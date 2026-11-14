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

test("entrants: the Races dialog's selected trucks become the exact CPU field", () => {
  const e = raceEntrants({
    playerTruck: "A.TRK", trucks, slots: 8,
    opponents: ["D.TRK", "B.TRK", "D.TRK", "A.TRK", "missing.trk"], random: seeded(2),
  });
  assert.deepEqual(e.map((x) => x.file), ["A.TRK", "D.TRK", "B.TRK"]);
  assert.deepEqual(e.slice(1).map((x) => x.name), ["Mark", "Greg"]);
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

test("the computer drivers take the player's names where there are any, the game's elsewhere", async () => {
  const { CPU_NAMES, CPU_NAME_MAX, cpuNames, raceEntrants } = await import("../src/game/race-setup.js");
  assert.deepEqual(cpuNames(undefined), [...CPU_NAMES]);
  const names = cpuNames(["  Zed ", "", 7, "x".repeat(40)]);
  assert.deepEqual(names.slice(0, 4), ["Zed", "Greg", "Rich", "x".repeat(CPU_NAME_MAX)]);
  assert.deepEqual(names.slice(4), CPU_NAMES.slice(4));
  const trucks = [{ file: "A.TRK" }, { file: "B.TRK" }];
  const field = raceEntrants({ playerTruck: "A.TRK", trucks, slots: 4, opponents: ["B.TRK"], names });
  assert.equal(field.find((d) => !d.player).name, "Zed");
});

test("Start position: the player's truck on the grid place picked, the others shuffled round it", async () => {
  const { seatDrivers } = await import("../src/game/race-setup.js");
  const drivers = [{ name: "Me", file: "ME.TRK", player: true }, ...[1, 2, 3, 4].map((i) => ({ name: `C${i}`, file: `C${i}.TRK`, player: false }))];
  for (let place = 1; place <= 5; place++) {
    const seated = seatDrivers(drivers, 8, Math.random, place);
    assert.equal(seated[0].slot, place - 1, `place ${place}`);
    assert.deepEqual(seated.map((d) => d.slot).sort(), [0, 1, 2, 3, 4], "every truck its own slot");
  }
  // Past the last truck's place: the last.
  assert.equal(seatDrivers(drivers, 8, Math.random, 8)[0].slot, 4);
  // 0 (Random) is the game's shuffle, unchanged.
  const fixed = () => 0.5;
  assert.deepEqual(seatDrivers(drivers, 8, fixed, 0), seatDrivers(drivers, 8, fixed));
  // No player (spectator mode): nothing moved.
  const watched = drivers.map((d) => ({ ...d, player: false }));
  assert.deepEqual(seatDrivers(watched, 8, fixed, 1), seatDrivers(watched, 8, fixed));
});
