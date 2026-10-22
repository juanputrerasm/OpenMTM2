/*
  Remote trucks in the simulation (src/worker/sim-worker.js, MONSTER_EXE_ANALYSIS.md 14.4): driven by
  another machine's updates, with the game's once-a-second position snap or the smoothed policy.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createSession, REMOTE_SNAP_FT } from "../src/worker/sim-worker.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

async function twoTrucks(policy) {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const truck = build.truckModels[build.sim.start.file];
  const model = { anchors: truck.anchors, scrapePoints: truck.scrapePoints };
  const start = { pos: build.sim.start.pos, heading: build.sim.start.heading };
  const other = { pos: [start.pos[0] + 30, start.pos[1], start.pos[2]], heading: start.heading };
  return createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1, net: { policy },
    trucks: [{ truck: model, start }, { truck: model, start: other, remote: true }],
  });
}

test("legacy: controls and velocity every update, the position at most once a second", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await twoTrucks("legacy");
  const t = session.trucks[1];
  const at = [...t.state.pos];
  const update = (dx) => ({ truck: 1, pos: [at[0] + dx, at[1], at[2]], bvel: [0, 0, 5], euler: [0, 0, 0.5], steer: 0.2, throttle: 0.7, brakeRear: 0, gear: 5 });
  session.command("remote", [update(10)]);
  assert.equal(t.state.pos[0], at[0] + 10, "the first update snaps");
  assert.equal(t.state.controls.throttle, 0.7);
  assert.equal(t.state.controls.gear, 5);
  session.step({});
  session.command("remote", [update(20)]);
  assert.notEqual(t.state.pos[0], at[0] + 20, "not again within a second");
  assert.equal(t.state.bvel[2], 5);
  for (let i = 0; i < 70; i++) session.step({});
  session.command("remote", [update(30)]);
  assert.equal(t.state.pos[0], at[0] + 30);
  assert.equal(session.trucks[0].remote, false);
  assert.equal(session.command("remote", [{ ...update(0), truck: 0 }])[0], false, "the local truck is never driven remotely");
});

test("smooth: a small error is eased out, a large one snaps, stale updates are dropped", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await twoTrucks("smooth");
  const t = session.trucks[1];
  const at = [...t.state.pos];
  session.command("remote", [{ truck: 1, seq: 1, pos: [at[0] + 4, at[1], at[2]], euler: [...t.state.euler], bvel: [0, 0, 0] }]);
  assert.ok(Math.abs(t.state.pos[0] - at[0]) < 1, "not at once");
  assert.equal(session.command("remote", [{ truck: 1, seq: 1, pos: at }])[0], false, "the same sequence again is stale");
  session.command("remote", [{ truck: 1, seq: 2, pos: [at[0] + REMOTE_SNAP_FT + 50, at[1], at[2]], euler: [0, 0, 0] }]);
  assert.equal(t.state.pos[0], at[0] + REMOTE_SNAP_FT + 50);
});

test("a leaver's truck goes to the autopilot; the reply lists only owned trucks", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await twoTrucks("legacy");
  const r = session.advance(0.1, {});
  assert.deepEqual(r.net.map((s) => s.truck), [0]);
  assert.equal(session.command("handOver", 1), true);
  assert.equal(session.trucks[1].remote, false);
});
