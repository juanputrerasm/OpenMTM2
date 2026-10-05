import test from "node:test";
import assert from "node:assert/strict";
import { addDriver, cleanGarage, currentDriver, emptyProfiles, normalizeProfiles, recordRace, removeDriver, renameDriver } from "../src/game/profile.js";
import { addEntry, emptyHall, normalizeHall, topFor } from "../src/game/hall-of-fame.js";

test("profiles: add, rename and remove drivers; names are unique and the last driver stays", () => {
  const p = emptyProfiles();
  assert.equal(currentDriver(p).name, "Player");
  assert.equal(addDriver(p, "  Ana   Maria  "), null);
  assert.equal(currentDriver(p).name, "Ana Maria");
  assert.match(addDriver(p, "ana maria"), /already/);
  assert.match(addDriver(p, "   "), /name/);
  assert.equal(renameDriver(p, 1, "Ana"), null);
  assert.match(renameDriver(p, 1, "player"), /already/);
  assert.equal(removeDriver(p, 1), null);
  assert.equal(p.current, 0);
  assert.match(removeDriver(p, 0), /At least one/);
});

test("profiles: stored data is repaired, the garage kept in range, races counted", () => {
  assert.deepEqual(normalizeProfiles(null), emptyProfiles());
  const p = normalizeProfiles({ current: 9, drivers: [{ name: "Bo", garage: { suspension: 7, transferSetting: 1234, tireCut: 2 }, races: 3.9, wins: -1 }, { name: "" }] });
  assert.equal(p.drivers.length, 1);
  assert.equal(p.current, 0);
  assert.deepEqual(p.drivers[0].garage, { suspension: 0, transferSetting: 1200, tireCut: 2 });
  assert.equal(p.drivers[0].races, 3);
  assert.equal(p.drivers[0].wins, 0);
  recordRace(p.drivers[0], 1);
  recordRace(p.drivers[0], 4);
  assert.deepEqual([p.drivers[0].races, p.drivers[0].wins], [5, 1]);
  assert.equal(cleanGarage({ transferSetting: 5000 }).transferSetting, 1500);
});

const entry = (over) => ({ name: "A", truck: "BIGFOOT.TRK", track: "TPARK.SIT", trackName: "Farm Road 29", mode: "circuit", difficulty: 1, laps: 3, points: 0, time: 100, fastestLap: 30, date: "2026-10-04", ...over });

test("hall of fame: races rank by lowest time, ties keep the earlier, ten per track", () => {
  const hall = emptyHall();
  assert.equal(addEntry(hall, entry({ time: 100 })), 1);
  assert.equal(addEntry(hall, entry({ name: "B", time: 90 })), 1);
  assert.equal(addEntry(hall, entry({ name: "C", time: 100 })), 3);
  assert.deepEqual(topFor(hall, "TPARK.SIT", "circuit").map((e) => e.name), ["B", "A", "C"]);
  for (let i = 0; i < 10; i++) addEntry(hall, entry({ name: `X${i}`, time: 50 + i }));
  assert.equal(topFor(hall, "TPARK.SIT", "circuit").length, 10);
  assert.equal(addEntry(hall, entry({ time: 500 })), null);
  assert.equal(addEntry(hall, entry({ track: "OTHER.SIT", time: 500 })), 1);
});

test("hall of fame: Rumbles rank by most points, apart from races on the same track", () => {
  const hall = emptyHall();
  addEntry(hall, entry({ mode: "summit", points: 120, time: 300 }));
  assert.equal(addEntry(hall, entry({ mode: "summit", name: "B", points: 200, time: 300 })), 1);
  assert.equal(addEntry(hall, entry({ mode: "circuit", time: 10 })), 1);
  assert.deepEqual(topFor(hall, "TPARK.SIT", "summit").map((e) => e.points), [200, 120]);
  assert.deepEqual(normalizeHall({ entries: [{ nope: 1 }, entry({})] }).entries.length, 1);
});
