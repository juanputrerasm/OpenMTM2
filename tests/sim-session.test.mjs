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

test("the Helicopter key lifts the truck and sets it back down", { skip: skipWithoutStock("POD.INI") }, async () => {
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
  const groundY = r.current.pos[1];
  r = session.advance(3.25, { helicopter: true });
  assert.ok(r.current.heliTimer > 14, `timer ${r.current.heliTimer}`);
  let top = 0;
  for (let t = 3.5; t < 22; t += 0.25) {
    r = session.advance(t, {});
    top = Math.max(top, r.current.pos[1] - groundY);
  }
  assert.ok(top > 20, `lifted ${top} ft`);
  assert.equal(r.current.heliTimer, 0);
  assert.ok(Math.abs(r.current.pos[1] - groundY) < 3, `down at ${r.current.pos[1] - groundY}`);
});

/** A session on a stock track with its collision boxes, the truck dropped at `pos`. */
async function sessionAt(sitPath, pos, heading = 0) {
  const build = await buildTrackRender(stockVfs(), sitPath);
  const truck = build.truckModels[build.sim.start.file];
  return createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos, heading },
  });
}

/** Settle for `seconds`; the ride height above `floor` and whether every wheel is down. */
function settle(session, floor, seconds = 4) {
  let r;
  for (let t = 0; t < seconds; t += 0.25) r = session.advance(t, {});
  return { ride: r.current.pos[1] - floor, down: r.current.tires.every((t) => t.onGround), pose: r.current };
}

test("ground boxes carry the wheels: parked on the TPARK bridge deck (MTM2_PHYSICS.md 14.14)", { skip: skipWithoutStock("POD.INI") }, async () => {
  // Flat open ground first, for the ride height.
  const flat = await sessionAt("WORLD\\TPARK.SIT", [0, 0, 0]);
  const g = flat.ground.height(flat.state.pos[0], flat.state.pos[2]);
  flat.state.pos[1] = g + 8;
  const onGround = settle(flat, g);
  // TPARK's bridge: cells 52-53 by 101-104, deck from 184 to 190 ft over 162-175 ft of terrain.
  const deck = await sessionAt("WORLD\\TPARK.SIT", [53 * 32, 196, 102.5 * 32 + 16]);
  const onDeck = settle(deck, 190);
  assert.ok(onDeck.down, "all wheels on the deck");
  assert.ok(Math.abs(onDeck.ride - onGround.ride) < 0.5, `ride ${onDeck.ride} on the deck vs ${onGround.ride}`);
});

test("an immovable level box carries the truck: JUNK's 38 x 39 ft platform (14.15)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\JUNK.SIT");
  const { mtm2Sim: S } = await import("../src/vendor/openphotex/index.js");
  const boxes = build.sim.boxes.map((b) => S.createLevelBox(b, b.bounds));
  const platform = boxes.find((b) => b.mass === 0 && Math.round(b.half[0] * 2) === 38 && Math.round(b.half[2] * 2) === 39);
  assert.ok(platform, "the platform is a solid box");
  assert.ok(build.sim.boxes.every((b) => ![6, 7, 8].includes(b.type)), "no checkpoint, type 7 or billboard collides");
  const top = platform.pos[1] + platform.half[1];
  const session = await sessionAt("WORLD\\JUNK.SIT", [platform.pos[0], top + 6, platform.pos[2]]);
  const r = settle(session, top);
  assert.ok(r.down, "all wheels on the platform");
  assert.ok(r.ride > 2 && r.ride < 6, `ride ${r.ride} ft above the top`);
});

test("driving into a pushable box moves it, and the session reports it for drawing (14.17)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const { mtm2Sim: S } = await import("../src/vendor/openphotex/index.js");
  // A light box standing on open ground (hay bales and fence parts on Farm Road 29).
  const terrain = S.createTerrain(build.heights);
  const pick = build.sim.boxes.find((b) => {
    if (!(b.mass > 1 && b.mass < 100) || !b.bounds) return false;
    const box = S.createLevelBox(b, b.bounds);
    const g = S.terrainHeightAt(terrain, box.pos[0], box.pos[2]);
    return Math.abs(box.pos[1] - box.half[1] - g) < 1 && box.half[0] < 6 && box.half[2] < 6;
  });
  assert.ok(pick, "a light box on the ground");
  const [bx, , bz] = pick.positionFt;
  const truck = build.truckModels[build.sim.start.file];
  const start = [bx, S.terrainHeightAt(terrain, bx, bz - 40) + 6, bz - 40];
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos: start, heading: 0 },
  });
  let r;
  for (let t = 0; t < 2; t += 0.25) r = session.advance(t, {});
  const seen = new Map();
  for (let t = 2; t < 8; t += 1 / 30) {
    r = session.advance(t, { accelerate: true });
    for (const b of r.boxes) seen.set(b.sitIndex, b);
  }
  const moved = seen.get(pick.sitIndex);
  assert.ok(moved, "the box was reported");
  assert.ok(Math.hypot(moved.pos[0] - bx, moved.pos[2] - bz) > 2, `box at ${moved.pos}`);
  assert.ok([...r.current.pos, ...moved.pos].every(Number.isFinite));
});

test("TPARK's train runs along its bvel and is reported for drawing (14.18)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const cars = build.sim.boxes.filter((b) => b.type === 10);
  assert.ok(cars.length > 0 && cars.every((b) => b.bvel), "the train's cars carry a bvel");
  const truck = build.truckModels[build.sim.start.file];
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos: [100, 0, 100], heading: 0 },
  });
  const r = session.advance(0.25, {});
  const first = cars[0];
  const pose = r.boxes.find((b) => b.sitIndex === first.sitIndex);
  assert.ok(pose, "the first car was reported");
  const dx = pose.pos[0] - first.positionFt[0], dz = pose.pos[2] - first.positionFt[2];
  const expected = Math.hypot(first.bvel[0], first.bvel[2]) * r.steps / 60;
  assert.ok(Math.abs(Math.hypot(dx, dz) - expected) < 1e-6, `moved ${Math.hypot(dx, dz)} of ${expected}`);
});
