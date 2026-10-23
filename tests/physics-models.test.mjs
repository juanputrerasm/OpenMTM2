// The physics models a race can run under (app/settings.js), and that the simulation knows each one's rules.

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, PHYSICS_MODELS, physicsModel, resolvePhysics } from "../src/app/settings.js";
import { cprSim as Cp, evoSim as E, mtm2Sim as S } from "../src/vendor/openphotex/index.js";
import { createSession } from "../src/worker/sim-worker.js";

test("the list: Auto (the default), MTM2, the 1996 game, 4x4 Evolution 2 and 1, CART Precision Racing; an unknown id is MTM2", () => {
  assert.deepEqual(PHYSICS_MODELS.map((m) => m.id), ["auto", "track", "mtm2", "mtm1", "evo2", "evo1", "cpr"]);
  assert.equal(DEFAULT_SETTINGS.physics, "auto");
  assert.equal(physicsModel("mtm1").label, "Monster Truck Madness");
  assert.equal(physicsModel("evo1").label, "4x4 Evolution");
  assert.equal(physicsModel("nothing").id, "mtm2");
  assert.equal(physicsModel(undefined).id, "mtm2");
  for (const m of PHYSICS_MODELS) {
    // Auto and Auto (by track) pick one of the others for each race.
    if (m.id === "auto" || m.id === "track") continue;
    const rules = E.isEvoRules(m.id) ? E.evoRules(m.id) : Cp.isCprRules(m.id) ? Cp.CPR_RULES : S.simRules(m.id);
    assert.equal(rules.id, m.id, `the simulation has rules for ${m.id}`);
  }
});

test("Auto picks the model of the player's vehicle's game; a set model stays", () => {
  assert.equal(resolvePhysics("auto", "EVO2:CBLS24.TRK"), "evo2");
  assert.equal(resolvePhysics("auto", "EVO1:CBLS24.TRK"), "evo1");
  assert.equal(resolvePhysics("auto", "MTM1:BIGFOOT.TRK"), "mtm1");
  assert.equal(resolvePhysics("auto", "CPR:DAVIS.CAR"), "cpr", "a CART Precision Racing car on its own game's model");
  assert.equal(resolvePhysics("auto", "BIGFOOT.TRK"), "mtm2");
  assert.equal(resolvePhysics("evo1", "BIGFOOT.TRK"), "evo1");
  assert.equal(resolvePhysics("mtm2", "EVO2:CBLS24.TRK"), "mtm2");
});

test("Auto by track picks the model of the track's game", () => {
  assert.equal(resolvePhysics("track", "BIGFOOT.TRK", "EVO2"), "evo2");
  assert.equal(resolvePhysics("track", "EVO2:CBLS24.TRK", "EVO1"), "evo1");
  assert.equal(resolvePhysics("track", "EVO2:CBLS24.TRK", "MTM1"), "mtm1");
  assert.equal(resolvePhysics("track", "EVO2:CBLS24.TRK", "MTM2"), "mtm2");
  assert.equal(resolvePhysics("track", "EVO2:CBLS24.TRK", null), "mtm2");
  assert.equal(resolvePhysics("track", "BIGFOOT.TRK", "CPR"), "cpr");
});

test("under 4x4 Evolution physics an MTM truck drives on MTM2's figures through Evo's model", () => {
  const session = createSession({
    heights: new Uint8Array(65536).fill(50).buffer, weather: 0, difficulty: 1, rules: "evo2",
    trucks: [{ truck: {}, start: { pos: [1000, 104, 1000], heading: 0 }, autopilot: false }],
  });
  assert.equal(session.ground.rules.id, "evo2");
  const t = session.trucks?.[0];
  if (t) {
    assert.ok(t.state.evo, "an Evo state");
    assert.equal(t.params.weightLb, 10000);
    assert.equal(t.params.evo.spec.game, 0);
  }
});

test("a session takes its rules from the race: rain cuts the grip under MTM2's, not under the 1996 game's", () => {
  const init = (rules) => ({
    heights: new Uint8Array(65536).fill(50).buffer, weather: S.WEATHER.RAIN, difficulty: 1, rules,
    trucks: [{ truck: {}, start: { pos: [1000, 100, 1000], heading: 0 }, autopilot: false }],
  });
  const grip = (rules) => {
    const session = createSession(init(rules));
    return S.groundWeatherGrip(session.ground);
  };
  assert.equal(grip(undefined), 0.8);
  assert.equal(grip("mtm2"), 0.8);
  assert.equal(grip("mtm1"), 1);
});
