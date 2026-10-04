/*
  The simulation worker's session (src/worker/sim-worker.js) on a stock track, in Node.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createSession, STEP } from "../src/worker/sim-worker.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";
import { mtm2Sim } from "../src/vendor/openphotex/index.js";
const GEAR_FIRST = mtm2Sim.GEAR.FIRST;

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

test("TPARK's moving objects (its train) run along their bvel and are reported for drawing (14.18)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const moving = build.sim.boxes.filter((b) => b.type === 10);
  assert.ok(moving.length > 0 && moving.every((b) => b.bvel), "every moving object carries a bvel");
  const truck = build.truckModels[build.sim.start.file];
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos: [100, 0, 100], heading: 0 },
  });
  const r = session.advance(0.25, {});
  const first = moving[0];
  const pose = r.boxes.find((b) => b.sitIndex === first.sitIndex);
  assert.ok(pose, "the first moving object was reported");
  const dx = pose.pos[0] - first.positionFt[0], dz = pose.pos[2] - first.positionFt[2];
  const expected = Math.hypot(first.bvel[0], first.bvel[2]) * r.steps / 60;
  assert.ok(Math.abs(Math.hypot(dx, dz) - expected) < 1e-6, `moved ${Math.hypot(dx, dz)} of ${expected}`);
});

test("a SNAKE ramp's top carries the truck (14.19)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\SNAKE.SIT");
  const { mtm2Sim: S } = await import("../src/vendor/openphotex/index.js");
  assert.equal(build.sim.ramps.length, 8);
  const ramp = S.createRamp(build.sim.ramps[0], build.sim.ramps[0].bounds);
  const top = S.rampHeightAt(ramp, ramp.pos[0], ramp.pos[2]);
  const terrain = S.createTerrain(build.heights);
  const below = S.terrainHeightAt(terrain, ramp.pos[0], ramp.pos[2]);
  assert.ok(top - below > 3, `ramp top ${top} over terrain ${below}`);
  const truck = build.truckModels[build.sim.start.file];
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos: [ramp.pos[0], top + 6, ramp.pos[2]], heading: build.sim.ramps[0].psi },
  });
  let r;
  for (let t = 0; t < 1; t += 0.25) r = session.advance(t, {});
  const y = r.current.pos[1];
  assert.ok(y - top > 3 && y - top < 7, `truck ${y - top} ft above the ramp top`);
});

test("a CPU truck on autopilot laps every stock Circuit track (14.22, 14.23)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const vfs = stockVfs();
  const { tracks } = await buildCatalog(vfs);
  const circuits = tracks.filter((t) => t.raceType === "circuit");
  assert.equal(circuits.length, 8);
  for (const t of circuits) {
    const build = await buildTrackRender(vfs, t.path);
    const truck = build.truckModels[build.sim.start.file];
    const session = createSession({
      heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
      ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
      course: build.sim.course, sonicTrack: build.sim.sonicTrack, autopilot: true,
      waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
      truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
      start: { pos: build.sim.start.pos, heading: build.sim.start.heading },
    });
    const segments = session.course.length;
    let i = 0;
    while (session.state.ap.segmentsPassed < segments && i < 240 / STEP) { session.step({}); i++; }
    assert.ok(session.state.ap.segmentsPassed >= segments, `${t.name}: ${session.state.ap.segmentsPassed} of ${segments} segments in 240 s`);
    assert.ok([...session.state.pos].every(Number.isFinite), t.name);
  }
});

/** An 8-truck, 2-lap headless race on a stock Circuit track: everyone finishes (14.24). */
async function headlessRace(t) {
  const vfs = stockVfs();
  {
    const build = await buildTrackRender(vfs, t.path);
    const trucks = build.sim.grid.map((g) => ({ truck: build.truckModels[g.file], start: { pos: g.pos, heading: g.heading }, autopilot: true }));
    assert.equal(trucks.length, 8, t.name);
    const session = createSession({
      heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
      ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
      course: build.sim.course, sonicTrack: build.sim.sonicTrack, waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
      trucks, race: { checkpoints: build.sim.checkpoints, laps: 2 },
    });
    const race = session.race;
    let i = 0;
    while (!race.trucks.every((x) => x.finished) && i < 600 / STEP) { session.step({}); i++; }
    assert.ok(race.over, `${t.name}: nobody finished`);
    assert.ok(race.trucks.every((x) => x.finished), `${t.name}: ${race.trucks.filter((x) => !x.finished).length} trucks still racing after 600 s`);
    assert.deepEqual(race.trucks.map((x) => x.place).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], t.name);
    const winner = race.trucks.find((x) => x.place === 1);
    assert.equal(winner.laps, 2, t.name);
    assert.ok(race.trucks.every((x) => [...x.s.pos].every(Number.isFinite)), t.name);
  }
}

// Torture Pit is listed apart: one CPU truck can be pinned on its side against the ramp (physics
// "Still open", "Pinned against a ramp"), to be compared with the running game.
const PINNED = "WAR.SIT";

test("headless races finish on every stock Circuit track: 8 CPU trucks, 2 laps (14.24)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const { tracks } = await buildCatalog(stockVfs());
  for (const t of tracks.filter((x) => x.raceType === "circuit" && x.file !== PINNED)) await headlessRace(t);
});

test("headless race on Torture Pit: everyone finishes", { skip: skipWithoutStock("POD.INI"), todo: "a CPU truck pinned against the ramp, physics 13" }, async () => {
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const { tracks } = await buildCatalog(stockVfs());
  await headlessRace(tracks.find((x) => x.file === PINNED));
});

test("Farm Road 29: the player's truck goes on autopilot once it finishes, and the rest are fast-simulated to the finish", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const vfs = stockVfs();
  const { tracks } = await buildCatalog(vfs);
  const t = tracks.find((x) => x.file === "TPARK.SIT");
  assert.equal(t.defaultLaps, 3);
  const build = await buildTrackRender(vfs, t.path);
  // The player's truck drives itself here, as the autopilot would; the others are CPU trucks.
  const trucks = build.sim.grid.map((g, i) => ({ truck: build.truckModels[g.file], start: { pos: g.pos, heading: g.heading }, autopilot: i > 0 }));
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
    course: build.sim.course, sonicTrack: build.sim.sonicTrack, waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    trucks, race: { checkpoints: build.sim.checkpoints, laps: 1 },
  });
  const view = session.raceView();
  assert.equal(view.started, false);
  assert.ok(Math.abs(view.countdown - 3) < 1e-9);
  assert.equal(session.trucks[0].autopilot, false);
  // Mark the player's truck finished: the next step hands it to the autopilot.
  session.race.trucks[0].finished = true;
  session.step({});
  assert.equal(session.trucks[0].autopilot, true);
  const done = session.finishRace();
  assert.ok(done.over, "nobody finished");
  assert.ok(done.trucks.every((x) => x.finished), `${done.trucks.filter((x) => !x.finished).length} still racing after the fast simulation`);
  assert.deepEqual(done.trucks.map((x) => x.place).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("the countdown: every truck sits in Park, so the player's held throttle moves nobody; at the start all go into gear (6.1)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const vfs = stockVfs();
  const build = await buildTrackRender(vfs, "WORLD\\TPARK.SIT");
  const trucks = build.sim.grid.map((g, i) => ({ truck: build.truckModels[g.file], start: { pos: g.pos, heading: g.heading }, autopilot: i > 0 }));
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
    course: build.sim.course, sonicTrack: build.sim.sonicTrack, waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    trucks, race: { checkpoints: build.sim.checkpoints, laps: 1 },
  });
  const start = session.trucks.map((t) => [...t.state.pos]);
  const moved = () => Math.max(...session.trucks.map((t, k) => Math.hypot(t.state.pos[0] - start[k][0], t.state.pos[2] - start[k][2])));
  while (!session.raceView().started) session.step({ accelerate: true });
  assert.ok(moved() < 0.5, `moved ${moved()} ft before the start`);
  // In first, or already shifted up from it: the player's revved engine is past the upshift rpm.
  assert.ok(session.trucks.every((t) => t.state.controls.gear >= GEAR_FIRST), session.trucks.map((t) => t.state.controls.gear).join());
  for (let i = 0; i < 120; i++) session.step({ accelerate: true });
  assert.ok(Math.hypot(session.trucks[0].state.pos[0] - start[0][0], session.trucks[0].state.pos[2] - start[0][2]) > 5, "the player goes after the start");
});

test("a CPU truck does not bring in a model-less or type 11 box, and drives through it; the player's truck does not (14.15)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const vfs = stockVfs();
  const build = await buildTrackRender(vfs, "WORLD\\WAR.SIT");
  // Torture Pit's sitIndex 41: an invisible 2 x 2 x 26 ft type 11 post.
  const post = build.sim.boxes.find((b) => b.sitIndex === 41);
  assert.equal(post.type, 11);
  assert.equal(post.hasModel, false);
  const file = build.sim.start.file;
  const run = (player) => {
    const session = createSession({
      heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
      ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
      waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
      trucks: [{ truck: build.truckModels[file], start: { pos: [post.positionFt[0] - 30, post.positionFt[1], post.positionFt[2]], heading: Math.PI / 2 }, autopilot: false, player }],
    });
    const s = session.trucks[0].state;
    for (let i = 0; i < 60; i++) session.step({});
    s.bvel[2] = 30;
    for (let i = 0; i < 120; i++) session.step({});
    return s.pos[0] - post.positionFt[0];
  };
  assert.ok(run(false) > 10, "the CPU truck drove through the post");
  assert.ok(run(true) < 0, "the player's truck is stopped by it");
});

test("a top-crush car in the session: a truck dropped on it crushes the cab, and the reply reports it (14.27)", { skip: skipWithoutStock("POD.INI") }, async () => {
  const vfs = stockVfs();
  const build = await buildTrackRender(vfs, "WORLD\\TPARK.SIT");
  const start = build.sim.start;
  const truck = build.truckModels[start.file];
  // A synthetic car (no stock SIT has one) where the truck starts, on the ground.
  const groundY = start.pos[1] - 6;
  const car = {
    positionFt: [start.pos[0], groundY + 1.5, start.pos[2]], position2Ft: [start.pos[0], 0, start.pos[2]],
    theta: 0, phi: 0, psi: start.heading, sizeFt: [30, 14, 3], size2Ft: [26, 12, 6], mass: 0,
    bvel: [0, 0, 0], rates: [0, 0, 0], bodyBounds: null, cabBounds: null,
  };
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0.buffer, ra1: build.sim.ra1.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps, topCrush: [car],
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos: [start.pos[0], groundY + 18, start.pos[2]], heading: start.heading },
  });
  for (let i = 0; i < 240; i++) session.step({});
  const reply = session.advance(session.now(), {});
  assert.ok(session.cars[0].crush > 0, "the cab is crushed");
  assert.ok(reply.crush.length === 1 && reply.crush[0].index === 0);
  assert.ok([...session.state.pos].every(Number.isFinite));
});
