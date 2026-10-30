import test from "node:test";
import assert from "node:assert/strict";
import { STOCK_CUES, checkpointSounds, createWorldAudio } from "../src/audio/world-audio.js";
import { createSilentAudio } from "../src/audio/audio-engine.js";

test("a level without a sound script has the stock checkpoint and lap sounds", () => {
  assert.deepEqual(checkpointSounds(null), { checkpoint: "airhorn.wav", lap: "check2.wav" });
  assert.deepEqual(checkpointSounds({ checkpointWav: "scream4.wav", finishLapWav: "" }), { checkpoint: "scream4.wav", lap: "check2.wav" });
});

test("a script's WAV the install lacks gives way to the stock one", async () => {
  const played = [];
  const audio = {
    ...createSilentAudio(),
    sample: async (name) => (/custom/i.test(name) ? null : { buffer: {} }),
    play: async (name) => { played.push(name); return null; },
  };
  const world = createWorldAudio(audio, { ambient: null, cues: { checkpointWav: "custom1.wav", finishLapWav: "custom2.wav", loops: [], shots: [] }, weather: 0, music: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  world.checkpoint();
  world.lapDone();
  assert.deepEqual(played, [STOCK_CUES.checkpoint, STOCK_CUES.lap]);
  world.dispose();
});
