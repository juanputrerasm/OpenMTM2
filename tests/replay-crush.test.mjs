// Top-crush cars in replays (MONSTER_EXE_ANALYSIS.md 11, "Top-crush records"; OpenPhotex's crush block).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlayback, createReplayRecorder, ringReplay } from "../src/game/replay.js";
import { parseMtmReplay, writeMtmReplay } from "../src/vendor/openphotex/mtm/replay.js";

const pose = (x) => ({ pos: [x, 0, 0], euler: [0, 0, 0], bvel: [0, 0, 10], rates: [0, 0, 0], tires: [] });

test("replay: each car's crush is kept as it grows, saved after the counted records and played back", () => {
  const rec = createReplayRecorder({ level: "circ5.sit", vehicles: [{ truck: "BIGFOOT.TRK", driver: "You" }] });
  const crushAt = [[0, 0], [0, 0], [0.3, 0], [0.305, 0], [0.6, 1], [0.6, 1]];
  crushAt.forEach((crush, n) => rec.update(n * 0.25, [pose(n)], [], () => 0, crush));
  const replay = rec.build();
  // The change under a hundredth (0.3 to 0.305) is not kept.
  assert.deepEqual(replay.crush.map((c) => [c.car, c.share]), [[0, 0.3], [0, 0.6], [1, 1]]);
  const back = parseMtmReplay(writeMtmReplay(replay));
  assert.deepEqual(back.crush.map((c) => [c.car, c.share]), [[0, 0.3], [0, 0.6], [1, 1]]);
  const play = createPlayback(back);
  assert.deepEqual(play.at(0).crush, [0, 0]);
  assert.deepEqual(play.at(0.5).crush, [0.3, 0]);
  assert.deepEqual(play.at(1.25).crush, [0.6, 1]);
});

test("replay: cut to the game's ring, a car keeps the crush it had before the cut; a game's file has none", () => {
  const replay = {
    level: "x.sit", weather: 0, detailLevel: 2, vehicles: [], objects: [],
    records: [0, 0x4000, 0x8000].map((time) => ({ type: 0, time, number: 0, ipos: [0, 0, 0], bvel: [0, 0, 0], angles: [0, 0, 0], rates: [0, 0, 0] })),
    crush: [{ time: 0, car: 2, share: 0.5 }],
  };
  const cut = ringReplay({ ...replay, records: replay.records.slice(1) });
  assert.deepEqual(cut.crush, [{ time: 0x4000, car: 2, share: 0.5 }]);
  assert.equal(createPlayback({ ...replay, crush: undefined }).at(0).crush, null);
});
