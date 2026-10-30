import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_DRIVERS, MAP_OFF, MAP_OTHER_COLOR, MAP_PLACES, MAP_PLAYER_COLOR, MAP_TRUCKS,
  mapLabel, mapLabelColor, mapMode, nextMapMode,
} from "../src/game/course-map-labels.js";

test("the Map key cycles off, places, truck names, driver names, then off", () => {
  assert.deepEqual([0, 1, 2, 3].map(nextMapMode), [MAP_PLACES, MAP_TRUCKS, MAP_DRIVERS, MAP_OFF]);
});

test("an older true or false setting still reads as a mode", () => {
  assert.equal(mapMode(true), MAP_PLACES);
  assert.equal(mapMode(false), MAP_OFF);
  assert.equal(mapMode(2), MAP_TRUCKS);
  assert.equal(mapMode(9), MAP_OFF);
});

test("the numbers mode writes the place, the name modes the name and the place, as the game's %s (%d)", () => {
  const t = { truck: "Bigfoot", driver: "Sam", place: 3 };
  assert.equal(mapLabel(MAP_OFF, t), "");
  assert.equal(mapLabel(MAP_PLACES, t), "3");
  assert.equal(mapLabel(MAP_TRUCKS, t), "Bigfoot (3)");
  assert.equal(mapLabel(MAP_DRIVERS, t), "Sam (3)");
});

test("in a Summit Rumble the numbers mode writes nothing and the name modes the name alone", () => {
  const t = { truck: "Bigfoot", driver: "Sam", place: 1, summit: true };
  assert.equal(mapLabel(MAP_PLACES, t), "");
  assert.equal(mapLabel(MAP_TRUCKS, t), "Bigfoot");
  assert.equal(mapLabel(MAP_DRIVERS, t), "Sam");
});

test("a truck with no place shows its name alone", () => {
  assert.equal(mapLabel(MAP_TRUCKS, { truck: "Blocker", place: null }), "Blocker");
  assert.equal(mapLabel(MAP_PLACES, { truck: "Blocker", place: null }), "");
});

test("only the player's own truck is dark red", () => {
  assert.equal(mapLabelColor(0, 0), MAP_PLAYER_COLOR);
  assert.equal(MAP_PLAYER_COLOR, "#800000");
  assert.equal(mapLabelColor(2, 0), MAP_OTHER_COLOR);
  assert.equal(mapLabelColor(0, -1), MAP_OTHER_COLOR);
});
