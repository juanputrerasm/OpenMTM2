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
