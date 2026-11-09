/*
  The drag weekend's host (src/app/drag-weekend.js): the field, who takes the strip for each pass, and the results
  handed back to the event.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { LEFT, RIGHT, passEntrants, rosterSlot, startDragWeekend, takePass } from "../src/app/drag-weekend.js";
import { PERSONALITIES, chooseLane, currentPairing } from "../src/game/events/drag-event.js";

const trucks = Array.from({ length: 20 }, (_, i) => ({ file: `T${i}.TRK`, name: `Truck ${i}` }));
const start = (size) => startDragWeekend({}, {
  track: { file: "DRAG3.SIT", name: "B.C. Place" }, trucks, playerTruck: "T0.TRK", playerName: "You", size, difficulty: 1, weather: 0,
});
const MID = () => 0.5;

test("the field: the player first, computer drivers in other trucks, each with a personality and a name of its own", () => {
  const { event } = start(16);
  assert.equal(event.drivers.length, 16);
  assert.ok(event.drivers[0].player && event.drivers[0].truck === "T0.TRK" && event.drivers[0].personality === null);
  assert.equal(new Set(event.drivers.map((d) => d.truck)).size, 16);
  assert.equal(new Set(event.drivers.map((d) => d.name)).size, 16);
  assert.ok(event.drivers.slice(1).every((d) => d.personality in PERSONALITIES));
});

test("the roster: named places keep their name and truck, blank ones take the Computer drivers' name and a truck nobody picked", () => {
  const roster = [{ name: "  Penda  ", truck: "T5.TRK" }, { name: "", truck: "" }, { name: "Snake Bite", truck: "NOPE.TRK" }];
  const { event } = startDragWeekend({ settings: { aiNames: ["", "Greg2"] } }, {
    track: { file: "DRAG3.SIT", name: "B.C. Place" }, trucks, playerTruck: "T0.TRK", playerName: "You", size: 4, difficulty: 1, weather: 0, roster,
  });
  assert.deepEqual(event.drivers.map((d) => d.name), ["You", "Penda", "Greg2", "Snake Bite"]);
  assert.equal(event.drivers[1].truck, "T5.TRK");
  const drawn = [event.drivers[2].truck, event.drivers[3].truck];
  assert.ok(drawn.every((f) => f !== "T5.TRK" && f !== "T0.TRK" && trucks.some((t) => t.file === f)));
  assert.notEqual(drawn[0], drawn[1]);
  assert.deepEqual(rosterSlot({ name: "x".repeat(40), truck: 3 }), { name: "x".repeat(16), truck: "" });
  assert.deepEqual(rosterSlot(undefined), { name: "", truck: "" });
});

test("qualifying: the player in their lane, the measurement truck beside them leaving on the green; its time is the baseline", () => {
  const weekend = start(4);
  const entrants = passEntrants(weekend, RIGHT);
  assert.deepEqual(entrants.map((e) => [e.driver, e.slot, e.player, e.launch]), [[0, RIGHT, true, undefined], [null, LEFT, false, 0]]);
  const pass = { kind: "qualify", results: [{ driver: 0, lane: RIGHT, et: 5, code: null }, { driver: null, lane: LEFT, et: 4.4, code: null }] };
  assert.equal(takePass(weekend, pass, MID), "qualified");
  assert.equal(weekend.event.baseline, 4.4);
  assert.equal(weekend.event.drivers[0].lanePace[RIGHT], 5);
  assert.equal(takePass(weekend, pass), null, "a pass is taken once");
});

test("a pairing: the player first, in the event's lanes, the computer driver with its launch and stage depth", () => {
  const weekend = start(2);
  takePass(weekend, { kind: "qualify", results: [{ driver: 0, lane: LEFT, et: 3.5, code: null }, { driver: null, lane: RIGHT, et: 4, code: null }] }, MID);
  chooseLane(weekend.event, RIGHT);
  const entrants = passEntrants(weekend);
  assert.deepEqual(entrants.map((e) => [e.driver, e.slot]), [[0, RIGHT], [1, LEFT]]);
  assert.equal(entrants[0].launch, undefined);
  assert.equal(entrants[1].launch, currentPairing(weekend.event).launch[currentPairing(weekend.event).drivers.indexOf(1)]);
  assert.ok(entrants[1].stageDepth > 0);
  const outcome = takePass(weekend, { kind: "pairing", results: [{ driver: 1, et: 4.2, code: null }, { driver: 0, et: 3.6, code: null }] }, MID);
  assert.equal(outcome, "settled");
  assert.equal(weekend.event.winner, 0);
});

test("a truck missing from the results is out", () => {
  const weekend = start(2);
  takePass(weekend, { kind: "qualify", results: [{ driver: 0, lane: LEFT, et: 3.5, code: null }] }, MID);
  assert.equal(weekend.event.baseline, 3.5, "no measurement: the player's time stands in");
  chooseLane(weekend.event, LEFT);
  assert.equal(takePass(weekend, { kind: "pairing", results: [{ driver: 0, et: 3.6, code: null }] }, MID), "settled");
  assert.equal(weekend.event.winner, 0);
});
