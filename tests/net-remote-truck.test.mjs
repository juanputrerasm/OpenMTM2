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

// ---- A Community Patch 4 room (docs/CP4_EXE_ANALYSIS.md 18): "cp4" ----

async function cp4Trucks({ race = false, gap = 30 } = {}) {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const truck = build.truckModels[build.sim.start.file];
  const model = { anchors: truck.anchors, scrapePoints: truck.scrapePoints };
  const start = { pos: build.sim.start.pos, heading: build.sim.start.heading };
  const other = { pos: [start.pos[0] + gap, start.pos[1], start.pos[2]], heading: start.heading };
  return createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1, net: { policy: "cp4" },
    trucks: [{ truck: model, start }, { truck: model, start: other, remote: true }],
    ...(race ? { race: { checkpoints: build.sim.checkpoints, laps: 3, mode: "circuit" } } : {}),
  });
}
const T = 0xa3d / 65536;

test("cp4: a remote truck is played back from its sender's ticks and pinned there; a state goes once a tick", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await cp4Trucks();
  const t = session.trucks[1];
  const at = [...t.state.pos];
  const pkt = (k, wallMs) => ({ truck: 1, sender: 9, tick: k, at: wallMs, pos: [at[0] + 2 * k, at[1], at[2]], euler: [...t.state.euler], bvel: [0, 0, 50], throttle: 1, brakeRear: 0, steer: 0, gear: 3 });
  let wall = 1000, sim = 0;
  for (let k = 1; k <= 30; k++) {
    session.command("remote", [pkt(k, wall + 30)]);
    wall += T * 1000; sim += T;
    session.advance(sim, {}, wall / 1000);
  }
  assert.equal(t.state.controls.throttle, 1, "the latest packet's controls");
  // Pinned near the newest ticks, never ahead of the buffer by more than its extrapolation.
  assert.ok(t.state.pos[0] > at[0] + 2 * 20 && t.state.pos[0] <= at[0] + 2 * 30 + 1, `${t.state.pos[0] - at[0]}`);
  const r = session.advance(sim, {}, (wall + 1) / 1000);
  assert.deepEqual(r.net, [], "no new tick: no state");
  const drawn = r.poses[1].current.pos[0] - at[0];
  assert.ok(drawn > 2 * 20 && drawn < 2 * 31, "drawn at the playback time");
  const next = session.advance(sim + T, {}, (wall + T * 1000) / 1000);
  assert.equal(next.net.length, 1);
  assert.equal(next.net[0].tick, Math.floor(next.time / T) + 1, "the tick its pose belongs to");
});

test("cp4: progress (0x26) is set, never added; only the owner counts a pass", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await cp4Trucks({ race: true });
  const rt = session.race.trucks[1];
  assert.equal(rt.passesFromOwner, true);
  assert.equal(session.race.trucks[0].passesFromOwner, undefined);
  assert.equal(session.command("progress", { truck: 1, segments: 7, total: 0 }), true);
  assert.equal(rt.passCount, 7);
  assert.equal(rt.raceTime, 0, "a total of 0 is not taken");
  session.command("progress", { truck: 1, segments: 8, total: 61.5 });
  assert.deepEqual([rt.passCount, rt.raceTime], [8, 61.5]);
  assert.equal(session.command("progress", { truck: 0, segments: 99, total: 1 }), false, "never for our own truck");
});

test("cp4: our truck's progress goes at each pass with the total before the lap it closed", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await cp4Trucks({ race: true });
  const me = session.race.trucks[0];
  let sim = 0, wall = 5;
  const tick = () => { sim += 0.1; wall += 0.1; return session.advance(sim, {}, wall); };
  for (let i = 0; i < 60 && !session.race.started; i++) tick();
  tick();
  // A pass that closes lap 1 (as the race rules leave the row).
  Object.assign(me, { passCount: 6, laps: 1, lapTimes: [40.5], raceTime: 40.5 });
  const r = tick();
  assert.deepEqual(r.netProgress, [{ truck: 0, segments: 6, total: 0 }], "lap 1's own time is left out");
  assert.equal(tick().netProgress, null, "once");
  Object.assign(me, { passCount: 7 });
  assert.deepEqual(tick().netProgress, [{ truck: 0, segments: 7, total: 40.5 }]);
});

test("cp4: a hit on our truck passes the mirror rule and the hit check, and is fed in over 0.12 s", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await cp4Trucks({ gap: 24 });
  const t = session.trucks[1], me = session.trucks[0];
  const at = [...t.state.pos];
  let wall = 1000, sim = 0;
  for (let k = 1; k <= 20; k++) {
    session.command("remote", [{ truck: 1, sender: 9, tick: k, at: wall + 30, pos: [...at], euler: [...t.state.euler], bvel: [0, 0, 0], throttle: 0, brakeRear: 1, steer: 0, gear: 1 }]);
    wall += T * 1000; sim += T;
    session.advance(sim, {}, wall / 1000);
  }
  // Just beyond touching (both radii), so no contact here for the mirror rule, and within 3 ft: taken whole.
  const radii = me.radius + t.radius;
  assert.ok(24 > radii && 24 - radii < 3, `radii ${radii}`);
  const before = [...me.state.bvel];
  const mass = 10000 * 0.031081;
  assert.equal(session.command("collision", { target: 0, source: 1, linear: [0, 0, -mass * 5], angular: [0, 0, 0] }), true);
  for (let i = 0; i < 20; i++) { wall += 16; sim += 0.016; session.advance(sim, {}, wall / 1000); }
  assert.ok(me.state.bvel[2] < before[2] - 2, `pushed: ${me.state.bvel[2] - before[2]}`);
  assert.equal(session.command("collision", { target: 1, source: 0, linear: [0, 0, 1], angular: [0, 0, 0] }), false, "only our trucks take hits");
  // Over 8 ft of gap all the way: rejected.
  const far = await cp4Trucks({ gap: 60 });
  for (let k = 1; k <= 20; k++) far.command("remote", [{ truck: 1, sender: 9, tick: k, at: 1000 + k * 40 + 30, pos: [...far.trucks[1].state.pos], euler: [...far.trucks[1].state.euler], bvel: [0, 0, 0] }]);
  far.advance(1, {}, 2);
  assert.equal(far.command("collision", { target: 0, source: 1, linear: [0, 0, -mass * 5], angular: [0, 0, 0] }), false);
});

test("cp4: our truck pushing a remote copy sends the copy's impulse (0x27), at most once in 0.4 s a victim", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await cp4Trucks({ gap: 9 });
  let sim = 0, wall = 50;
  const sent = [];
  for (let i = 0; i < 60; i++) {
    sim += 1 / 60; wall += 1 / 60;
    const r = session.advance(sim, {}, wall);
    for (const h of r.netHits ?? []) sent.push({ ...h, wall });
  }
  assert.ok(sent.length >= 1, "the overlap pushes the copy");
  assert.ok(sent.every((h) => h.target === 1 && h.source === 0));
  for (let k = 1; k < sent.length; k++) assert.ok(sent[k].wall - sent[k - 1].wall >= 0.4 - 1e-9);
  assert.ok(Math.hypot(...sent[0].linear) > 0);
});
