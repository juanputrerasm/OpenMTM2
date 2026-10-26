import test from "node:test";
import assert from "node:assert/strict";
import { REPLAY_RING_RECORDS, parseMtmReplay, parseMtmSit, writeMtmReplay } from "../src/vendor/openphotex/index.js";
import { openStockPod, skipWithoutStock } from "./helpers/stock.mjs";
import { FRAME_SECONDS, RATES, REPLAY_KEEP_SECONDS, createPlayback, createReplayRecorder, damageZones, levelPath, ringReplay } from "../src/game/replay.js";

const snap = (x, psi = 0, extra = {}) => ({
  pos: [x, 10, 100], euler: [0, 0, psi], bvel: [0, 0, 20], rates: [0, 0, 0], steer: 0.1, rearSteer: 0,
  tires: [{ angle: x }, { angle: x }, { angle: x }, { angle: x }], throttle: 1, brakeFront: 0, brakeRear: 0, gear: 5, course: 2, ...extra,
});

function record(seconds = 3) {
  const rec = createReplayRecorder({ level: "tpark.sit", weather: 0, detailLevel: 2, vehicles: [{ truck: "DIGGER.TRK", driver: "You" }], originals: [[1, 2, 3, 0, 0, 0], [4, 5, 6, 0, 0, 0]] });
  for (let t = 0; t <= seconds + 1e-9; t += 1 / 60) {
    rec.update(t, [snap(t * 10)], t > 1 && t < 1.2 ? [{ sitIndex: 1, pos: [4, 5 + t, 6], euler: [0, 0, t] }] : [], () => (t > 2 ? 21 : 0));
  }
  return rec;
}

test("the recorder takes a frame every quarter second: a record per truck, and per object that moved", () => {
  const replay = record(3).build();
  const trucks = replay.records.filter((r) => r.type === 0), objects = replay.records.filter((r) => r.type === 1);
  assert.equal(trucks.length, 12, "four a second for three seconds");
  assert.equal(trucks[0].time, 0x4000);
  assert.equal(trucks[1].time - trucks[0].time, 0x4000);
  assert.ok(objects.length >= 1 && objects.length <= 2, "only frames that came after the object moved");
  assert.equal(objects[0].number, 1);
  assert.equal(replay.records.at(-1).type === 0 ? replay.records.at(-1).damageCode : 21, 21);
  assert.deepEqual(replay.objects[1], [4, 5, 6, 0, 0, 0]);
});

test("the recorder keeps the last hour; cut to the game's ring, a replay keeps its newest 2240 records", () => {
  const rec = createReplayRecorder({ level: "x.sit", vehicles: [{ truck: "A.TRK", driver: "A" }, { truck: "B.TRK", driver: "B" }], originals: [] });
  for (let f = 1; f <= 2000; f++) rec.update(f * FRAME_SECONDS, [snap(f), snap(f)], [], () => 0);
  const whole = rec.build();
  assert.equal(whole.records.length, 4000, "500 s is well inside the hour");
  const r = ringReplay(whole);
  assert.equal(r.records.length, REPLAY_RING_RECORDS);
  assert.equal(r.records.at(-1).time, Math.round(2000 * 0x4000));
  assert.equal(r.records[0].time, Math.round((2000 - 1119) * 0x4000));
});

test("past the hour the oldest frames go, and an hour of eight trucks plays back", () => {
  assert.equal(REPLAY_KEEP_SECONDS, 3600);
  const rec = createReplayRecorder({ level: "x.sit", vehicles: Array.from({ length: 8 }, () => ({ truck: "A.TRK", driver: "A" })), originals: [] });
  const frames = 3600 * 4 + 40;
  const eight = Array.from({ length: 8 }, () => snap(1));
  for (let f = 1; f <= frames; f++) rec.update(f * FRAME_SECONDS, eight, [], () => 0);
  const r = rec.build();
  assert.equal(r.records.length, (3600 * 4 + 1) * 8);
  const playback = createPlayback(r);
  assert.ok(Math.abs(playback.duration - 3600) < 1e-6);
});

test("playback interpolates positions, takes the short way round for angles, and holds gear and damage", () => {
  const rec = createReplayRecorder({ level: "x.sit", vehicles: [{ truck: "A.TRK", driver: "A" }] });
  rec.update(0.25, [snap(0, 3.0, { gear: 4 })], [], () => 0);
  rec.update(0.5, [snap(10, -3.0, { gear: 5 })], [], () => 21);
  const play = createPlayback(rec.build());
  assert.ok(Math.abs(play.duration - 0.25) < 1e-9);
  const mid = play.at(0.125);
  assert.ok(Math.abs(mid.trucks[0].pos[0] - 5) < 1e-9);
  // 3.0 to -3.0 is 0.28 radians the short way round, through pi, not 6 back through zero.
  assert.ok(Math.abs(Math.abs(mid.trucks[0].euler[2]) - Math.PI) < 0.01);
  assert.equal(mid.trucks[0].gear, 4);
  assert.equal(mid.damage[0], 0);
  assert.equal(play.at(0.25).damage[0], 21);
  assert.equal(play.at(99).trucks[0].pos[0], 10, "after the end it stays at the last frame");
  assert.equal(play.at(-5).trucks[0].pos[0], 0, "and before the start at the first");
  assert.equal(mid.trucks[0].matrix.length, 9);
});

test("objects appear once moved, move smoothly while recorded, and hold when they stop", () => {
  const rec = createReplayRecorder({ level: "x.sit", vehicles: [{ truck: "A.TRK", driver: "A" }] });
  const box = (x) => [{ sitIndex: 7, pos: [x, 0, 0], euler: [0, 0, 0] }];
  rec.update(0.25, [snap(0)], [], () => 0);
  rec.update(0.5, [snap(0)], box(10), () => 0);
  rec.update(0.75, [snap(0)], box(20), () => 0);
  rec.update(5, [snap(0)], [], () => 0);
  rec.update(5.25, [snap(0)], box(100), () => 0);
  const play = createPlayback(rec.build());
  assert.equal(play.at(0.1).objects.length, 0, "not moved yet");
  const mid = play.at(0.375).objects[0];
  assert.equal(mid.sitIndex, 7);
  assert.ok(Math.abs(mid.pos[0] - 15) < 1e-9);
  assert.ok(Math.abs(play.at(3).objects[0].pos[0] - 20) < 1e-9, "held while nothing was recorded");
  assert.ok(play.at(5.25 - 0.01).objects[0].pos[0] > 90, "and moves over the last frame before the next record");
});

test("what the recorder builds is a valid .rpl: it writes and reads back", () => {
  const replay = record(2).build();
  const back = parseMtmReplay(writeMtmReplay(replay));
  assert.equal(back.records.length, replay.records.length);
  assert.equal(back.vehicles[0].driver, "You");
  assert.equal(createPlayback(back).vehicleCount, 1);
});

test("a damage code lists its zones and levels; a replay's level names its track", () => {
  const code = (3 << 2) | (1 << 8) | (2 << 24);
  assert.deepEqual(damageZones(code), [[1, 3], [4, 1], [12, 2]]);
  assert.deepEqual(damageZones(0), []);
  assert.equal(levelPath("tpark.sit"), "WORLD\\TPARK.SIT");
  assert.equal(levelPath("WORLD/JUNK.SIT"), "WORLD\\JUNK.SIT");
  assert.equal(levelPath("WORLD\\junk.sit"), "WORLD\\JUNK.SIT");
  assert.deepEqual([...RATES], [0.25, 0.5, 1, 2, 4, 8]);
});

test("a truck recorded either side of the world's seam is played back across it, not back round the world", () => {
  const rec = createReplayRecorder({ level: "x.sit", vehicles: [{ truck: "A.TRK", driver: "A" }] });
  rec.update(0.25, [snap(8190)], [], () => 0);
  rec.update(0.5, [snap(6)], [], () => 0);
  const play = createPlayback(rec.build());
  // From 8190 to 6 is 8 ft through the seam: halfway it is 2 ft over the edge, drawn from the copy beside where it is going.
  const mid = play.at(0.125).trucks[0].pos[0];
  assert.ok(Math.abs(mid - 2) < 1e-6, `halfway at x ${mid}`);
  assert.ok(Math.abs(play.at(0.25).trucks[0].pos[0] - 6) < 1e-9);
});

test("the recorder takes the trucks at 16 Hz: the game's records every quarter second, samples between them", async () => {
  const { REPLAY_SAMPLE_TICKS } = await import("../src/game/replay.js");
  assert.equal(REPLAY_SAMPLE_TICKS, 0x1000);
  const replay = record(2).build();
  assert.equal(replay.records.filter((r) => r.type === 0).length, 8, "the records are the game's, four a second");
  assert.equal(replay.samples.length, 24, "three samples between each two records");
  assert.ok(replay.samples.every((p) => p.time % 0x4000 !== 0));
  // Written and read back: the records counted as the games read them, the samples after them.
  const back = parseMtmReplay(writeMtmReplay(replay));
  assert.equal(back.records.length, replay.records.length);
  assert.equal(back.samples.length, 24);
  // The ring keeps the samples of the frames it keeps.
  const ring = ringReplay(replay);
  assert.ok(ring.samples.every((p) => p.time >= ring.records[0].time));
});

test("playback runs a curve through the frames: a jump is an arc, not straight chords", () => {
  const rec = createReplayRecorder({ level: "x.sit", vehicles: [{ truck: "A.TRK", driver: "A" }] });
  // A truck thrown up at 32 ft/s: y = 32 t - 16 t^2, recorded at the game's 4 Hz only.
  for (const t of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]) rec.update(t, [{ ...snap(t * 20), pos: [t * 20, 32 * t - 16 * t * t, 100] }], [], () => 0);
  const play = createPlayback(rec.build());
  const t = 0.625, truth = 32 * (t + 0.25) - 16 * (t + 0.25) ** 2;
  const y = play.at(t).trucks[0].pos[1];
  const chord = (32 * 0.75 - 16 * 0.75 ** 2 + 32 * 1 - 16 * 1) / 2;
  assert.ok(Math.abs(y - truth) < Math.abs(chord - truth) / 4, `on the arc: ${y} against ${truth} (a chord gives ${chord})`);
  assert.ok(Math.abs(play.at(0.5).trucks[0].pos[1] - (32 * 0.75 - 16 * 0.75 ** 2)) < 1e-9, "and through every frame");
});

test("a wheel's angle turns the short way between frames, as the game blends it", () => {
  const rec = createReplayRecorder({ level: "x.sit", vehicles: [{ truck: "A.TRK", driver: "A" }] });
  const wheel = (angle) => ({ ...snap(0), tires: [0, 1, 2, 3].map(() => ({ angle })) });
  rec.update(0.25, [wheel(3.0)], [], () => 0);
  rec.update(0.5, [wheel(-3.0)], [], () => 0);
  const mid = createPlayback(rec.build()).at(0.125).trucks[0].tires[0].angle;
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.01, `through pi, not back through zero: ${mid}`);
});

test("object numbers count the game's box table, not the SIT's boxes: recorded and played through `boxes`", () => {
  // SIT boxes 0 and 1 are ramps (out of the table): box 2 is object 0, box 5 object 3.
  const boxes = [2, 3, 4, 5];
  const rec = createReplayRecorder({ level: "circ5.sit", vehicles: [{ truck: "A.TRK", driver: "A" }], boxes });
  for (let t = 0; t <= 1 + 1e-9; t += 1 / 60) {
    rec.update(t, [snap(t)], t > 0.3 && t < 0.6 ? [{ sitIndex: 5, pos: [1, 2, 3], euler: [0, 0, 0] }, { sitIndex: 0, pos: [9, 9, 9] }] : []);
  }
  const replay = rec.build();
  const numbers = [...new Set(replay.records.filter((r) => r.type === 1).map((r) => r.number))];
  assert.deepEqual(numbers, [3], "box 5 is object 3; a ramp is not recorded");
  assert.deepEqual(createPlayback(replay, { boxes }).at(1).objects.map((o) => o.sitIndex), [5]);
  assert.deepEqual(createPlayback(replay).at(1).objects.map((o) => o.sitIndex), [3], "without the table a number is a SIT index");
});

test("stock Mud Pie: the game's box table leaves out the six ramps that open the SIT", { skip: skipWithoutStock("GAME.POD") }, async () => {
  const { replayBoxOrder } = await import("../src/worker/track-build.js");
  const pod = openStockPod("GAME.POD");
  const sit = parseMtmSit(pod.read(pod.archive.entries.find((e) => e.normalizedName.toUpperCase() === "WORLD/CIRC5.SIT")));
  const order = replayBoxOrder(sit.boxes);
  assert.deepEqual(sit.boxes.slice(0, 6).map((b) => b.type), [99, 99, 99, 99, 99, 99]);
  assert.equal(order.length, sit.boxes.length - 6);
  assert.equal(order[0], 6, "object 0 is SIT box 6, as Community Patch 3's replays of Mud Pie say");
});
