/*
  Save race and Load race (src/game/saved-race.js; MONSTER_EXE_ANALYSIS.md 16, "Saved games"): a race written as
  Monster Truck Madness 2's saved game and read back.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { raceIndexOf, readSavedGame, savedGameBytes } from "../src/game/saved-race.js";
import { parseMtm2SavedGame } from "../src/vendor/openphotex/mtm/saved-game.js";
import { writeMtm2Sit } from "../src/vendor/openphotex/mtm/write.js";

const levelSit = new TextDecoder("latin1").decode(writeMtm2Sit({
  lvlName: "TPARK.LVL", trackName: "Farm Road 29", localeName: "Bubba's Backyard", pictureBmp: "UI\\A.BMP", iconBmp: "UI\\B.BMP",
  descriptionTxt: "TPARK.TXT", yourTruck: { position: [0, 0, 0], orient: [0, 0, 0] },
  vehicles: [0, 1, 2].map((i) => ({ position: [100 + i, 0, 100], orient: [0, 0, 0] })),
  boxes: [], course: [{ start: [0, 0, 0], end: [100, 0, 0] }], extendedCourses: [],
}));
const tracks = [
  { path: "WORLD\\ALPINE.SIT", file: "ALPINE.SIT", name: "Alpine", game: "MTM2", level: "ALPINE.LVL" },
  { path: "WORLD\\WAR.SIT", file: "WAR.SIT", name: "Torture Pit", game: "MTM2", level: "SNAKE.LVL" },
  { path: "WORLD\\EVO.SIT", file: "EVO.SIT", name: "Somewhere", game: "MTM1", level: "EVO.LVL" },
  { path: "WORLD\\TPARK.SIT", file: "TPARK.SIT", name: "Farm Road 29", game: "MTM2", level: "TPARK.LVL" },
];
const trucks = ["BIGFOOT.TRK", "GRAVEDIG.TRK", "SNAKEBIT.TRK"].map((file) => ({ file }));
const saved = {
  clock: 47.25, startTime: 3,
  trucks: [0, 1, 2].map((i) => ({
    pos: [500 + i, 20, 600], bvel: [0, 0, 40 + i], euler: [0, 0, 1 + i], rates: [0, 0.1, 0], gear: 5, autopilot: i ? 1 : 0, cnumber: 4,
    progress: 12, laps: 1, passCount: 7, finished: 0, checkpoint: 2, raceTime: 40, fastestLap: 40, lapTimes: [40], splits: [10, 11],
  })),
};

test("the race's index is its place among the MTM2 tracks, Torture Pit left out", () => {
  assert.equal(raceIndexOf(tracks[3], tracks), 1);
  assert.equal(raceIndexOf(tracks[2], tracks), 0, "another game's track");
});

test("a race saved as MTM2's saved game reads back as the same race, the player first", () => {
  const bytes = savedGameBytes({
    track: tracks[3], tracks, laps: 3, weather: 2, saved, damage: [0, 0x40000000, 0],
    entrants: [{ file: "BIGFOOT.TRK", player: true }, { file: "GRAVEDIG.TRK" }, { file: "SNAKEBIT.TRK" }],
    setup: { tireCut: 2, suspension: 0, transferSetting: 1800 }, sitText: levelSit,
  });
  const head = parseMtm2SavedGame(bytes);
  assert.equal(head.playerTruck, "BIGFOOT.TRK");
  assert.equal(head.raceIndex, 1);
  assert.deepEqual(head.trucks[0], { file: "BIGFOOT.TRK", tireCut: 2, suspension: 0, transfer: 1800 });

  const race = readSavedGame(bytes, { tracks, trucks });
  assert.equal(race.track, tracks[3]);
  assert.equal(race.truck, "BIGFOOT.TRK");
  assert.deepEqual(race.opponents, ["GRAVEDIG.TRK", "SNAKEBIT.TRK"]);
  assert.equal(race.laps, 3);
  assert.equal(race.weather, 2);
  assert.deepEqual(race.setup, { tireCut: 2, suspension: 0, transferSetting: 1800 });
  assert.deepEqual(race.damage, [0, 0x40000000, 0]);
  assert.equal(race.saved.clock, 47.25);
  assert.equal(race.saved.startTime, 3);
  const t = race.saved.trucks[2];
  assert.deepEqual(t.pos, [502, 20, 600]);
  assert.deepEqual(t.bvel, [0, 0, 42]);
  assert.deepEqual(t.euler, [0, 0, 3]);
  assert.equal(t.laps, 1);
  assert.equal(t.checkpoint, 2);
  assert.deepEqual(t.lapTimes, [40]);
  assert.deepEqual(t.splits.slice(0, 2), [10, 11]);
});

test("a file that is not a saved game, or names a track not installed, is refused with a reason", () => {
  assert.throws(() => readSavedGame(new TextEncoder().encode("hello\r\n"), { tracks, trucks }), /Invalid saved game/);
  const bytes = savedGameBytes({ track: tracks[3], tracks, laps: 3, weather: 0, saved, entrants: [{ file: "BIGFOOT.TRK", player: true }, { file: "GRAVEDIG.TRK" }, { file: "SNAKEBIT.TRK" }], sitText: levelSit });
  assert.throws(() => readSavedGame(bytes, { tracks: tracks.slice(0, 3), trucks }), /track is not installed/);
});
