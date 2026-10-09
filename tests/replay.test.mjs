import test from "node:test";
import assert from "node:assert/strict";
import { REPLAY_RING_RECORDS, parseMtmReplay, writeMtmReplay } from "../src/vendor/openphotex/index.js";
import { FRAME_SECONDS, RATES, createPlayback, createReplayRecorder, damageZones, levelPath } from "../src/game/replay.js";

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

test("the ring keeps the newest 2240 records", () => {
  const rec = createReplayRecorder({ level: "x.sit", vehicles: [{ truck: "A.TRK", driver: "A" }, { truck: "B.TRK", driver: "B" }], originals: [] });
  for (let f = 1; f <= 2000; f++) rec.update(f * FRAME_SECONDS, [snap(f), snap(f)], [], () => 0);
  const r = rec.build();
  assert.equal(r.records.length, REPLAY_RING_RECORDS);
  assert.equal(r.records.at(-1).time, Math.round(2000 * 0x4000));
  assert.equal(r.records[0].time, Math.round((2000 - 1119) * 0x4000));
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
