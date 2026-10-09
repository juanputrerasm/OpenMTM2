import test from "node:test";
import assert from "node:assert/strict";
import { NAMES_DRIVERS, NAMES_OFF, NAMES_TRUCKS, nameLabel, nextNamesMode } from "../src/game/names.js";

test("the Names key goes round off, trucks, drivers", () => {
  assert.equal(nextNamesMode(NAMES_OFF), NAMES_TRUCKS);
  assert.equal(nextNamesMode(NAMES_TRUCKS), NAMES_DRIVERS);
  assert.equal(nextNamesMode(NAMES_DRIVERS), NAMES_OFF);
});

test("a label is the truck's or the driver's name, or nothing", () => {
  const entrant = { file: "bigfoot.trk", name: "Ann" };
  const truckName = (f) => `Truck ${f}`;
  assert.equal(nameLabel(NAMES_OFF, entrant, truckName), null);
  assert.equal(nameLabel(NAMES_TRUCKS, entrant, truckName), "Truck bigfoot.trk");
  assert.equal(nameLabel(NAMES_DRIVERS, entrant, truckName), "Ann");
  assert.equal(nameLabel(NAMES_DRIVERS, undefined, truckName), null);
});
