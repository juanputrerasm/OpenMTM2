/*
  The Garage's CART Precision Racing setup (src/game/cpr-garage.js; docs/CPR_PHYSICS.md 14.1).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { CPR_GARAGE_SLIDERS, cleanCprSetup, cprSetupFromGar, cprSetupToGar, stockCprSetup } from "../src/game/cpr-garage.js";

const slider = (id) => CPR_GARAGE_SLIDERS.find((s) => s.id === id);

test("a slider for an axle sets both of its corners; the dampers set all four settings of the axle", () => {
  const setup = stockCprSetup();
  slider("frontSprings").set(setup, 18000);
  assert.deepEqual(setup.springRate.slice(0, 2), [18000, 18000], "FL and FR");
  slider("rearDampers").set(setup, 7);
  for (const key of ["dampingFastBump", "dampingSlowBump", "dampingFastRebound", "dampingSlowRebound"]) assert.deepEqual(setup[key].slice(2), [7, 7]);
  assert.equal(slider("brakes").show(0.6), "F60/40R");
});

test("every stock value lies within its slider", () => {
  const stock = stockCprSetup();
  for (const s of CPR_GARAGE_SLIDERS) {
    const v = s.get(stock);
    assert.ok(v >= s.min - 1e-9 && v <= s.max + 1e-9, `${s.id} ${v}`);
  }
});

test("a stored setup is brought into shape; none stays none (the stock setup)", () => {
  assert.equal(cleanCprSetup(null), null);
  const cleaned = cleanCprSetup({ wingAngle: [99, "x"], fuelAmount: 3, differentialType: 9, tireCompound: [4, 4, 7, 4] });
  assert.equal(cleaned.wingAngle[0], 30, "held to the slider's range");
  assert.equal(cleaned.wingAngle[1], stockCprSetup().wingAngle[1], "a value that is not a number is the stock one");
  assert.equal(cleaned.fuelAmount, 5);
  assert.equal(cleaned.differentialType, 1);
  assert.deepEqual(cleaned.tireCompound, [4, 4, 0, 4]);
});

test("the game's .gar files load, and a setup saves as one", () => {
  const setup = stockCprSetup();
  slider("frontWing").set(setup, 23);
  const back = cprSetupFromGar(cprSetupToGar(setup));
  assert.equal(back.wingAngle[0], 23);
  assert.equal(cprSetupFromGar("not a setup"), null);
});
