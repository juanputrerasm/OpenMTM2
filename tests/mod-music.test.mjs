import test from "node:test";
import assert from "node:assert/strict";
import { parseMod, renderMod } from "../src/vendor/openphotex/index.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("the stock SEX.MOD: a 6-channel module that renders to a few minutes of music and loops back", { skip: skipWithoutStock("POD.INI") }, async () => {
  const song = parseMod(await stockVfs().read("MUSIC\\SEX.MOD"));
  assert.ok(song);
  assert.equal(song.channels, 6);
  assert.equal(song.title, "(C) Terminal Reality");
  const t0 = Date.now();
  const out = renderMod(song, { sampleRate: 22050 });
  const seconds = out.left.length / out.sampleRate;
  console.log(`SEX.MOD: ${seconds.toFixed(1)} s, loop at ${(out.loopStartFrame / out.sampleRate).toFixed(1)} s, rendered in ${Date.now() - t0} ms`);
  assert.ok(seconds > 20 && seconds < 600, `${seconds} s`);
  const peakOf = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const peak = Math.max(peakOf(out.left), peakOf(out.right));
  assert.ok(peak > 0.1 && peak <= 1, `peak ${peak}`);
  assert.ok(out.loopStartFrame < out.left.length);
});

test("SEX.MOD renders within a few dB of MTM2's WAV music (-10 to -15 dBFS RMS), not some 12 dB under it", { skip: skipWithoutStock("POD.INI") }, async () => {
  const song = parseMod(await stockVfs().read("MUSIC\\SEX.MOD"));
  const out = renderMod(song, { sampleRate: 22050 });
  let sum = 0, peak = 0;
  for (const channel of [out.left, out.right]) for (const v of channel) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  const rms = 10 * Math.log10(sum / (out.left.length * 2));
  assert.ok(rms > -19 && rms < -12, `${rms.toFixed(1)} dBFS RMS`);
  assert.ok(peak <= 1);
});

test("a module plays some 6 to 8 dB over a WAV loop, to the engine's level", async () => {
  const { MOD_MUSIC_GAIN } = await import("../src/audio/world-audio.js");
  const db = 20 * Math.log10(MOD_MUSIC_GAIN);
  assert.ok(db > 6 && db < 8, `${db.toFixed(1)} dB`);
});
