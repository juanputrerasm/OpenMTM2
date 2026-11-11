// The physics models a race can run under (app/settings.js), and that the simulation knows each one's rules.

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, PHYSICS_MODELS, physicsModel, resolveAiBehaviour, resolvePhysics } from "../src/app/settings.js";
import { cp4Sim as C4, cprSim as Cp, evoSim as E, mtm2Sim as S } from "../src/vendor/openphotex/index.js";
import { createSession } from "../src/worker/sim-worker.js";

test("the list: Auto (the default), OpenMTM2, MTM2, CommPatch4, the 1996 game, 4x4 Evolution 2 and 1, CART Precision Racing; an unknown id is MTM2", () => {
  assert.deepEqual(PHYSICS_MODELS.map((m) => m.id), ["auto", "track", "omtm2", "mtm2", "cp4", "mtm1", "evo2", "evo1", "cpr"]);
  assert.equal(physicsModel("cp4").label, "CommPatch4");
  assert.equal(DEFAULT_SETTINGS.physics, "auto");
  assert.equal(physicsModel("mtm1").label, "Monster Truck Madness");
  assert.equal(physicsModel("evo1").label, "4x4 Evolution");
  assert.equal(physicsModel("nothing").id, "mtm2");
  assert.equal(physicsModel(undefined).id, "mtm2");
  for (const m of PHYSICS_MODELS) {
    // Auto and Auto (by track) pick one of the others for each race.
    if (m.id === "auto" || m.id === "track") continue;
    const rules = E.isEvoRules(m.id) ? E.evoRules(m.id) : Cp.isCprRules(m.id) ? Cp.CPR_RULES : C4.isCp4Rules(m.id) ? C4.CP4_RULES : S.simRules(m.id);
    // OpenMTM2 is MTM2's model (with a CP4 track's triangles, sim-worker.js `trackTriangles`), so MTM2's rules.
    assert.equal(rules.id, m.id === "omtm2" ? "mtm2" : m.id, `the simulation has rules for ${m.id}`);
  }
});

test("Auto picks the model of the player's vehicle's game, OpenMTM2 for MTM2's on an MTM2 track; a set model stays", () => {
  assert.equal(resolvePhysics("auto", "EVO2:CBLS24.TRK"), "evo2");
  assert.equal(resolvePhysics("auto", "EVO1:CBLS24.TRK"), "evo1");
  assert.equal(resolvePhysics("auto", "MTM1:BIGFOOT.TRK"), "mtm1");
  assert.equal(resolvePhysics("auto", "CPR:DAVIS.CAR"), "cpr", "a CART Precision Racing car on its own game's model");
  assert.equal(resolvePhysics("auto", "BIGFOOT.TRK"), "omtm2", "an MTM2 truck on an MTM2 track: OpenMTM2");
  assert.equal(resolvePhysics("auto", "BIGFOOT.TRK", "MTM1"), "mtm2", "on another game's track: MTM2");
  assert.equal(resolvePhysics("auto", "BIGFOOT.TRK", "CPR"), "mtm2");
  assert.equal(resolvePhysics("evo1", "BIGFOOT.TRK"), "evo1");
  assert.equal(resolvePhysics("mtm2", "EVO2:CBLS24.TRK"), "mtm2");
});

test("a 4x4 Evolution track always runs its own game's model, whatever the setting or the vehicle", () => {
  for (const id of ["auto", "track", "mtm2", "cp4", "mtm1", "cpr", "evo1", "evo2"]) {
    assert.equal(resolvePhysics(id, "BIGFOOT.TRK", "EVO2"), "evo2", id);
    assert.equal(resolvePhysics(id, "EVO2:CBLS24.TRK", "EVO1"), "evo1", id);
  }
  assert.equal(resolvePhysics("cp4", "EVO2:CBLS24.TRK", "MTM2"), "cp4", "elsewhere a set model stays");
});

test("Auto by track picks the model of the track's game", () => {
  assert.equal(resolvePhysics("track", "BIGFOOT.TRK", "EVO2"), "evo2");
  assert.equal(resolvePhysics("track", "EVO2:CBLS24.TRK", "EVO1"), "evo1");
  assert.equal(resolvePhysics("track", "EVO2:CBLS24.TRK", "MTM1"), "mtm1");
  assert.equal(resolvePhysics("track", "EVO2:CBLS24.TRK", "MTM2"), "omtm2");
  assert.equal(resolvePhysics("track", "EVO2:CBLS24.TRK", null), "omtm2");
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

test("CommPatch4: never picked by Auto, and its computer trucks drive as MTM2's", () => {
  assert.equal(resolvePhysics("auto", "BIGFOOT.TRK", "MTM2"), "omtm2");
  assert.equal(resolvePhysics("track", "BIGFOOT.TRK", "MTM2"), "omtm2");
  assert.equal(resolveAiBehaviour("physics", "omtm2"), "omtm2");
  assert.equal(resolvePhysics("cp4", "EVO2:CBLS24.TRK"), "cp4");
  assert.equal(resolveAiBehaviour("physics", "cp4"), "mtm2");
  assert.equal(DEFAULT_SETTINGS.cp4Collision, "triangles");
  assert.equal(DEFAULT_SETTINGS.cp4SubstepsOffline, false);
});

// A flat world at 100 ft with one 40 x 10 x 40 ft deck, its model's triangles given as the track build gives them.
function deckInit(extra = {}) {
  const [x, y, z] = [20, 5, 20];
  const v = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
  const tris = [];
  for (const [a, b, c, d] of quads) for (const t of [[a, b, c], [a, c, d]]) for (const k of t) tris.push(...v[k]);
  return {
    heights: new Uint8Array(65536).fill(50).buffer, weather: 0, difficulty: 1, rules: "cp4",
    boxes: [{ positionFt: [1000, 105, 1000], theta: 0, phi: 0, psi: 0, mass: 0, type: 0, priority: 0, modelName: "DECK.BIN",
      bounds: { min: [-x, -y, -z], max: [x, y, z] }, sitIndex: 0 }],
    collisionSoups: { "DECK.BIN": { positions: new Float32Array(tris), surfaceTypes: null } },
    trucks: [{ truck: {}, start: { pos: [1000, 122, 1000], heading: 0 }, autopilot: false }],
    ...extra,
  };
}

test("CommPatch4: a session steps on CP4's 40 ms tick, in 10 ms steps online or when asked", () => {
  const tick = 0xa3d / 65536;
  const off = createSession(deckInit());
  assert.equal(off.ground.rules.id, "cp4");
  const r = off.advance(1);
  // A second's catch-up is capped at CP4's 160 ms: four ticks.
  assert.equal(r.steps, 4);
  assert.ok(Math.abs(r.time - 4 * tick) < 1e-9, `${r.time}`);
  const split = createSession(deckInit({ cp4SubstepsOffline: true }));
  assert.equal(split.advance(tick * 1.01).steps, 4, "one tick, four substeps");
});

test("CommPatch4: a truck rests on a prop's triangles, and with classic boxes on its box", () => {
  const settle = (cp4Collision) => {
    const session = createSession(deckInit({ cp4Collision }));
    for (let i = 0; i < 100; i++) session.advance((i + 1) * 0.16);
    return session.trucks[0].state;
  };
  const tri = settle("triangles"), box = settle("classic");
  assert.equal(tri.tires[0].supportSource, 3, "held up by the triangles");
  assert.equal(box.tires[0].supportSource, 2, "held up by the box");
  assert.ok(tri.pos[1] > 110 && Math.abs(tri.pos[1] - box.pos[1]) < 0.05, `${tri.pos[1]} vs ${box.pos[1]}`);
});
