import { test } from "node:test";
import assert from "node:assert/strict";
import { SOUND_EXTENSIONS, findSound, soundStem } from "../src/worker/sound-file.js";
import { loopSeconds } from "../src/game/sound-model.js";

const text = (s) => [...s].map((c) => c.charCodeAt(0));
const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const WAV = new Uint8Array([...text("RIFF"), ...le32(36), ...text("WAVE"), ...text("fmt "), ...le32(16), 1, 0, 1, 0, ...le32(22050), ...le32(44100), 2, 0, 16, 0]);
const OGG = new Uint8Array([...text("OggS"), 0, 2, ...new Array(20).fill(0), 1, 30, 1, ...text("vorbis"), 0, 0, 0, 0, 2, ...le32(44100), ...new Array(15).fill(0)]);
const MP3 = new Uint8Array([0xff, 0xfb, 0x94, 0x64, 0, 0, 0, 0]);

/** A mounted install holding the given SOUND\ files. */
const vfsOf = (files) => ({ read: async (path) => files[path] ?? null });

test("sound lookup: the order is OGG, then MP3, then the game's WAV", () => {
  assert.deepEqual([...SOUND_EXTENSIONS], ["OGG", "MP3", "WAV"]);
});

test("sound lookup: a name as the game writes it is one stem whatever its extension", () => {
  assert.equal(soundStem("farm.wav"), "FARM");
  assert.equal(soundStem("Farm.OGG"), "FARM");
  assert.equal(soundStem("horn.mp3"), "HORN");
  assert.equal(soundStem("SPLASH"), "SPLASH");
});

test("sound lookup: an OGG replaces the WAV, an MP3 too, and the WAV alone still plays", async () => {
  const all = vfsOf({ "SOUND\\FARM.OGG": OGG, "SOUND\\FARM.MP3": MP3, "SOUND\\FARM.WAV": WAV });
  assert.equal((await findSound(all, "FARM")).format, "ogg");
  assert.equal((await findSound(all, "FARM")).sourceRate, 44100);
  const mp3 = await findSound(vfsOf({ "SOUND\\FARM.MP3": MP3, "SOUND\\FARM.WAV": WAV }), "FARM");
  assert.equal(mp3.format, "mp3");
  assert.equal(mp3.sourceRate, 48000);
  const wav = await findSound(vfsOf({ "SOUND\\FARM.WAV": WAV }), "FARM");
  assert.deepEqual([wav.format, wav.extension, wav.sourceRate], ["wav", "WAV", 22050]);
  assert.equal(await findSound(vfsOf({}), "FARM"), null);
});

test("sound lookup: only WAV skips the replacements (a browser that cannot decode them)", async () => {
  const all = vfsOf({ "SOUND\\FARM.OGG": OGG, "SOUND\\FARM.WAV": WAV });
  assert.equal((await findSound(all, "FARM", { only: "WAV" })).format, "wav");
});

test("sound lookup: a file that is not what its name says is passed over", async () => {
  const fake = vfsOf({ "SOUND\\FARM.OGG": WAV, "SOUND\\FARM.MP3": new Uint8Array([1, 2, 3, 4]), "SOUND\\FARM.WAV": WAV });
  assert.equal((await findSound(fake, "FARM")).extension, "WAV");
});

test("sound lookup: KLP loop points count the file's own samples, whatever rate the browser decoded at", () => {
  const klp = { loops: [{ start: 11025, end: 22050 }] };
  // A 22050 Hz file of 2 s decoded at 48000 Hz: the loop is 0.5 s to 1 s, not 0.23 s to 0.46 s.
  assert.deepEqual(loopSeconds(klp, 2, 22050, 48000), { start: 0.5, end: 1 });
  // No known source rate: the decoded one stands in, as before.
  assert.deepEqual(loopSeconds(klp, 2, null, 22050), { start: 0.5, end: 1 });
  // An open end loops to the end; no loop, or one past the end, is the whole sample.
  assert.deepEqual(loopSeconds({ loops: [{ start: 22050, end: null }] }, 2, 22050, 44100), { start: 1, end: 2 });
  assert.equal(loopSeconds(null, 2, 22050, 44100), null);
  assert.equal(loopSeconds({ loops: [{ start: 0, end: 90000 }] }, 2, 22050, 44100), null);
});
