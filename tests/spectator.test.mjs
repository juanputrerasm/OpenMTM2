// Spectator mode (the port's): the computer's trucks race and nobody drives.

import test from "node:test";
import assert from "node:assert/strict";
import { CPU_NAMES, raceEntrants } from "../src/game/race-setup.js";
import { END_COOLDOWN_SECONDS, SPECTATOR_WAIT_SECONDS, createRaceEnd } from "../src/game/race-end.js";
import { goRace, spectatorField } from "../src/app/flow.js";

const trucks = "ABCDEFGHIJ".split("").map((c) => ({ file: `${c}.TRK` }));

test("the field to watch: spectator mode with trucks picked, on a track with a race", () => {
  const config = { spectator: true, opponents: ["A.TRK", "B.TRK", "GONE.TRK"], freeRoam: false };
  assert.deepEqual(spectatorField(config, { raceType: "circuit" }, trucks), ["A.TRK", "B.TRK"]);
  assert.equal(spectatorField({ ...config, spectator: false }, {}, trucks), null);
  assert.equal(spectatorField({ ...config, freeRoam: true }, {}, trucks), null, "free roam has no race to watch");
  assert.equal(spectatorField(config, { freeRoamOnly: true }, trucks), null);
  assert.equal(spectatorField({ ...config, opponents: [] }, {}, trucks), null, "nobody to watch: the player drives");
  assert.equal(spectatorField({ ...config, opponents: 3 }, {}, trucks), null);
});

test("a watched extension race keeps the selected extension", async () => {
  const track = { file: "TPARK.SIT", raceType: "circuit" };
  const went = [];
  const context = {
    raceConfig: {
      track: track.file, mode: track.raceType, laps: 5, difficulty: 1, opponents: ["A.TRK", "B.TRK"], weather: 0,
      gameMode: "tag", spectator: true,
    },
    profiles: { current: 0, drivers: [{ name: "Player", lastTruck: "A.TRK", garage: {}, races: 0, wins: 0 }] },
    assets: { call: async () => ({ tracks: [track], trucks }) },
    router: { go: (screen, params) => { went.push({ screen, params }); return params; } },
    // The spectator warning, accepted (the game's own dialog needs the DOM).
    confirm: async () => true,
  };
  await goRace(context);
  assert.equal(went[0].screen, "race");
  assert.equal(went[0].params.gameMode, "tag");
  assert.equal(went[0].params.spectator, true);
});

test("a watched race has no player: up to eight computer trucks, the player's own truck allowed among them", () => {
  const field = "ABCDEFGH".split("").map((c) => `${c}.TRK`);
  const entrants = raceEntrants({ playerTruck: field[0], trucks, slots: 8, opponents: field.slice(1), spectator: true });
  assert.equal(entrants.length, 8);
  assert.ok(entrants.every((e) => !e.player));
  assert.deepEqual(entrants.map((e) => e.file).sort(), field);
  assert.equal(new Set(entrants.map((e) => e.name)).size, 8, "eight different names");
  assert.ok(entrants.every((e) => CPU_NAMES.includes(e.name)));
  assert.deepEqual(entrants.map((e) => e.slot).sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  // Driving, the player is one of the eight.
  const driven = raceEntrants({ playerTruck: "A.TRK", trucks, slots: 8, opponents: field.slice(1) });
  assert.equal(driven.filter((e) => e.player).length, 1);
});

test("a watched race ends when every truck has finished, or long after the winner", () => {
  const end = createRaceEnd({ spectator: true });
  const race = (clock, done) => ({ clock, trucks: done.map((finished, i) => ({ finished, place: i + 1 })) });
  assert.equal(end.update(race(10, [false, false])).done, false);
  // The first truck in is not the player: nothing moves the camera, and the race goes on.
  const first = end.update(race(60, [true, false]));
  assert.deepEqual([first.done, first.justFinished, first.playerFinished], [false, false, false]);
  assert.equal(end.update(race(75, [true, false])).done, false, "no ten second limit");
  assert.equal(end.update(race(80, [true, true])).done, false);
  assert.equal(end.update(race(80 + END_COOLDOWN_SECONDS, [true, true])).done, true);
  const stuck = createRaceEnd({ spectator: true });
  stuck.update(race(60, [true, false]));
  assert.equal(stuck.update(race(60 + SPECTATOR_WAIT_SECONDS - 1, [true, false])).done, false);
  assert.equal(stuck.update(race(60 + SPECTATOR_WAIT_SECONDS, [true, false])).done, true);
});

test("a Summit Rumble's overlay lists every driver with their score, the leader first", async () => {
  const { summitBoard } = await import("../src/game/race-setup.js");
  const rows = summitBoard([{ score: 120.4 }, { score: 300 }, { score: 120.4 }, {}], ["You", "Sam", "Tex"]);
  assert.deepEqual(rows, [["Sam", "300"], ["You", "120"], ["Tex", "120"], ["Driver 4", "0"]]);
});
