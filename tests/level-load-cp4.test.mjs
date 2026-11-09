/*
  Community Patch 4 tracks through the level loader (src/worker/level-load.js, docs/CP4_EXE_ANALYSIS.md): the terrain
  grid the .TXV and the height file pick, lakes and vegetation. The track is Fila's vegetation and fog sandbox
  (~/games/cp4sandbox/fog_test.pod, opt-in with OPENMTM2_STOCK=1), with its height file and .TXV swapped for each case.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry } from "../src/vendor/openphotex/index.js";
import { createVfs } from "../src/worker/vfs.js";
import { loadLevel } from "../src/worker/level-load.js";
import { GAMES, skipLocal } from "./helpers/stock.mjs";

const SANDBOX = join(GAMES, "cp4sandbox", "fog_test.pod");

/** The sandbox, with `swap` (path to bytes) laid over it. */
function sandboxVfs(swap = {}) {
  const bytes = new Uint8Array(readFileSync(SANDBOX));
  const base = { name: "FOG_TEST.POD", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) };
  const vfs = createVfs([base]);
  const read = vfs.read.bind(vfs);
  return Object.assign(Object.create(vfs), { read: async (path) => swap[path.toUpperCase()] ?? read(path) });
}

const txv = (text) => new TextEncoder().encode(`formatVersion=5\r\n${text}\r\n`);

test("the sandbox loads as a classic 8-bit track, with its two lakes and its vegetation", { skip: skipLocal(SANDBOX) }, async () => {
  const level = await loadLevel(sandboxVfs(), "WORLD\\FOGTEST.SI2");
  assert.equal(level.terrainMode, "classic8");
  assert.equal(level.heights.length, 65536);
  assert.equal(level.fineFt, null);
  assert.equal(level.lakes.lakes.length, 2);
  assert.equal(level.vegetation.trees.count, 12394);
  assert.equal(level.txv.fogVolumes, 2);
});

test("a 16-bit height file is 1/128 ft a step (not CPR's 1/16), a Spline track gets the 8 ft grid", { skip: skipLocal(SANDBOX) }, async () => {
  const raw = new Uint8Array(131072);
  new DataView(raw.buffer).setUint16(0, 1291, true);
  const classic16 = await loadLevel(sandboxVfs({ "DATA\\FOGTEST.RAW": raw }), "WORLD\\FOGTEST.SI2");
  assert.equal(classic16.terrainMode, "classic16");
  assert.equal(classic16.heights, null);
  assert.equal(classic16.heightsFt[0], (1291 >> 1) / 64, "the engine keeps v >> 1, 1/64 ft");
  const spline = await loadLevel(sandboxVfs({ "DATA\\FOGTEST.RAW": raw, "DATA\\FOGTEST.TXV": txv("terrainGrid=spline") }), "WORLD\\FOGTEST.SI2");
  assert.equal(spline.terrainMode, "spline");
  assert.equal(spline.fineFt.length, 1024 * 1024);
  assert.equal(spline.fineFt[0], spline.heightsFt[0]);
});

test("a Full Map (2 MB height file) loads as the fine grid with its coarse corners", { skip: skipLocal(SANDBOX) }, async () => {
  const raw = new Uint8Array(2097152);
  new DataView(raw.buffer).setUint16((4 * 2 * 1024 + 4 * 3) * 2, 6400, true);
  const level = await loadLevel(sandboxVfs({ "DATA\\FOGTEST.RAW": raw }), "WORLD\\FOGTEST.SI2");
  assert.equal(level.terrainMode, "fine");
  assert.equal(level.heightsFt[2 * 256 + 3], 50);
  assert.equal(level.fineFt.length, 1024 * 1024);
});
