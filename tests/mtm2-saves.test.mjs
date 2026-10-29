// The game's drivers and Hall of Fame to OpenMTM2's, and back (game/mtm2-saves.js, MONSTER_EXE_ANALYSIS.md 16).
import { test } from "node:test";
import assert from "node:assert/strict";
import { driversFromPlayerPro, gameDate, highScoresFromHall, isoDate, mergeDrivers, mergeHighScores, playerProFromProfiles } from "../src/game/mtm2-saves.js";
import { emptyProfiles } from "../src/game/profile.js";
import { emptyHall, topFor } from "../src/game/hall-of-fame.js";
import { newMtmDriver, parseMtmPlayerPro, writeMtmPlayerPro } from "../src/vendor/openphotex/mtm/player-pro.js";
import { parseMtmHighScores, writeMtmHighScores } from "../src/vendor/openphotex/mtm/high-scores.js";

const catalog = {
  trucks: [{ file: "BIGFOOT.TRK", name: "Bigfoot" }, { file: "GRAVEDIG.TRK", name: "Grave Digger" }],
  tracks: [{ file: "WORLD\\CIRC1.SIT", name: "Farm Road 29", raceType: "circuit" }, { file: "WORLD\\SUMMIT1.SIT", name: "Summit Rumble 1", raceType: "summit" }],
};

test("saves: the game's drivers come in with their Garage and truck; a name already here keeps the port's", () => {
  const pro = parseMtmPlayerPro(writeMtmPlayerPro({ drivers: [
    { ...newMtmDriver("Juan", "BIGFOOT.TRK", "Farm Road 29"), settings: [2, 0, 1700, 1] },
    { ...newMtmDriver("DriverX", "Grave Digger", ""), settings: [1, 1, 600, 1] },
  ] }));
  const drivers = driversFromPlayerPro(pro, catalog.trucks);
  assert.deepEqual([drivers[0].name, drivers[0].garage.tireCut, drivers[0].garage.suspension, drivers[0].garage.transferSetting, drivers[0].lastTruck],
    ["Juan", 2, 0, 1700, "BIGFOOT.TRK"]);
  assert.equal(drivers[1].lastTruck, "GRAVEDIG.TRK");
  const profiles = emptyProfiles();
  assert.deepEqual(mergeDrivers(profiles, drivers), { added: ["Juan"], kept: ["DriverX"] });
  assert.equal(profiles.drivers.length, 2);
});

test("saves: the Hall of Fame goes to its tracks by name and back, the date turned round", () => {
  const boards = parseMtmHighScores(writeMtmHighScores([
    { track: "Farm Road 29", entries: [{ date: "04/07/98", driver: "Juan", truck: "Bigfoot", time: 95.5, points: 900, skill: 1, summit: false }] },
    { track: "Summit Rumble 1", entries: [{ date: "10/28/26", driver: "Ana", truck: "Grave Digger", time: 300, points: 420, skill: 2, summit: true }] },
    { track: "Not Installed", entries: [{ date: "01/01/98", driver: "X", truck: "Y", time: 1, points: 1, skill: 0, summit: false }] },
  ]));
  const hall = emptyHall();
  assert.deepEqual(mergeHighScores(hall, boards, catalog), { added: 2, skipped: ["Not Installed"] });
  const [race] = topFor(hall, "WORLD\\CIRC1.SIT", "circuit");
  assert.deepEqual([race.name, race.truck, race.time, race.points, race.difficulty, race.date], ["Juan", "BIGFOOT.TRK", 95.5, 900, 1, "1998-04-07"]);
  assert.equal(topFor(hall, "WORLD\\SUMMIT1.SIT", "summit")[0].laps, 5);
  // The same file again adds nothing.
  assert.equal(mergeHighScores(hall, boards, catalog).added, 0);
  const out = highScoresFromHall(hall, catalog);
  assert.deepEqual(out.map((b) => [b.track, b.entries[0].truck, b.entries[0].date]), [["Farm Road 29", "Bigfoot", "04/07/98"], ["Summit Rumble 1", "Grave Digger", "10/28/26"]]);
  assert.equal(isoDate("12/31/26"), "2026-12-31");
  assert.equal(gameDate("1998-04-07"), "04/07/98");
});

test("saves: the port's drivers written as the game's keep what the game's file had", () => {
  const profiles = emptyProfiles();
  profiles.drivers[0].garage = { ...profiles.drivers[0].garage, tireCut: 2, suspension: 0, transferSetting: 1200 };
  profiles.drivers[0].lastTruck = "BIGFOOT.TRK";
  const previous = { drivers: [{ ...newMtmDriver("DriverX", "x", "y"), texts: ["a", "b", "c", "d", "e", "f", "g"] }] };
  const pro = playerProFromProfiles(profiles, catalog, previous);
  assert.deepEqual([pro.selected, pro.drivers[0].truck, pro.drivers[0].settings, pro.drivers[0].texts[0]], [1, "BIGFOOT.TRK", [2, 0, 1200, 1], "a"]);
});
