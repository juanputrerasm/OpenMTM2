/*
  An object's hit sound (src/audio/world-audio.js `hit`; MONSTER_EXE_ANALYSIS.md 12, "Object sounds").
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createWorldAudio, HIT_MIN_SPEED } from "../src/audio/world-audio.js";

test("an object sounds again only once its last hit sound has finished, however long a truck stays against it", async () => {
  const played = [];
  let finish = null;
  const audio = {
    play: (name) => {
      played.push(name);
      const done = new Promise((resolve) => { finish = resolve; });
      return Promise.resolve({ done, stop() {}, setPosition() {} });
    },
  };
  const world = createWorldAudio(audio, { ambient: null, weather: 0, music: null, hitInfo: new Map([[52, { hitSound: "SCREAMX.WAV", type: 3 }]]) });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  world.hit(52, 20, [0, 0, 0]);
  await settle();
  // Pushed against the stand frame after frame, seconds on: one scream.
  for (let frame = 0; frame < 300; frame++) { world.update(1 / 60, [0, 0, 0]); world.hit(52, 20, [0, 0, 0]); }
  await settle();
  assert.deepEqual(played, ["SCREAMX"]);
  finish();
  await settle();
  world.hit(52, 20, [0, 0, 0]);
  assert.deepEqual(played, ["SCREAMX", "SCREAMX"], "after it ends, a new hit sounds");
  world.hit(53, 20, [0, 0, 0]);
  assert.equal(played.length, 2, "an object with no sound of its own plays nothing");
  world.dispose();
});

test("a truck that only rests against an object does not set its sound off", async () => {
  const played = [];
  const audio = { play: (name) => { played.push(name); return Promise.resolve({ done: Promise.resolve(), stop() {}, setPosition() {} }); } };
  const world = createWorldAudio(audio, { ambient: null, weather: 0, music: null, hitInfo: new Map([[52, { hitSound: "SCREAMX.WAV", type: 3 }]]) });
  world.hit(52, 0, [0, 0, 0]);
  world.hit(52, HIT_MIN_SPEED / 2, [0, 0, 0]);
  assert.deepEqual(played, []);
  world.hit(52, HIT_MIN_SPEED, [0, 0, 0]);
  assert.deepEqual(played, ["SCREAMX"]);
  world.dispose();
});
