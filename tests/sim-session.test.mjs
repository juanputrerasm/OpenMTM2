/*
  The simulation worker's session (src/worker/sim-worker.js) on a stock track, in Node.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createSession, STEP } from "../src/worker/sim-worker.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("drive the first grid truck on Farm Road 29", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const truck = build.truckModels[build.sim.start.file];
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos: build.sim.start.pos, heading: build.sim.start.heading },
  });
  assert.equal(truck.scrapePoints.length, 12);
  // Settle, then drive for five seconds of fixed steps through `advance`.
  let r = session.advance(3, {});
  assert.equal(r.steps, Math.floor(0.25 / STEP), "catch-up is capped at 0.25 s");
  for (let t = 3.25; t < 6; t += 0.25) r = session.advance(t, {});
  const startPos = r.current.pos;
  for (let t = 6; t < 11; t += 1 / 60) r = session.advance(t, { accelerate: true });
  const moved = Math.hypot(r.current.pos[0] - startPos[0], r.current.pos[2] - startPos[2]);
  assert.ok(moved > 100, `moved ${moved} ft`);
  assert.ok([...r.current.pos, ...r.current.matrix].every(Number.isFinite));
  assert.ok(r.alpha >= 0 && r.alpha <= 1);
});

test("a joystick drives the same truck, overriding the keyboard", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const truck = build.truckModels[build.sim.start.file];
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos: build.sim.start.pos, heading: build.sim.start.heading },
  });
  let r;
  for (let t = 0.25; t < 3; t += 0.25) r = session.advance(t, {});
  const startPos = r.current.pos;
  // Brake key held, but the stick is full throttle and a little right.
  for (let t = 3; t < 7; t += 1 / 60) r = session.advance(t, { brake: true, joystick: { x: 0.3, y: -1, deadZone: 0.1 } });
  const moved = Math.hypot(r.current.pos[0] - startPos[0], r.current.pos[2] - startPos[2]);
  assert.ok(moved > 60, `moved ${moved} ft`);
  assert.ok(session.state.controls.steer > 0);
});
