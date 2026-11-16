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

test("the checkpoint and lap sounds play at the game's gains: 1.7, and 8 for a name beginning \"screa\"", async () => {
  const { CUE_GAIN, SCREAM_CUE_GAIN, cueGain } = await import("../src/audio/world-audio.js");
  assert.equal(CUE_GAIN, 1.7);
  assert.equal(SCREAM_CUE_GAIN, 8);
  assert.equal(cueGain("airhorn.wav"), 1.7);
  assert.equal(cueGain("mm1waypt.wav"), 1.7);
  assert.equal(cueGain("SCREAM4.WAV"), 8);
  assert.equal(cueGain("Screamer.wav"), 8);
  assert.equal(cueGain("scre.wav"), 1.7);
  const played = [];
  const audio = { ...createSilentAudio(), sample: async () => ({ buffer: {} }), play: async (name, { gain }) => { played.push([name, gain]); return null; } };
  const world = createWorldAudio(audio, { ambient: null, cues: { checkpointWav: "scream4.wav", finishLapWav: "check2.wav" }, weather: 0, music: null });
  world.checkpoint();
  world.lapDone();
  assert.deepEqual(played, [["scream4.wav", 8], ["check2.wav", 1.7]]);
  world.dispose();
});
