/*
  Which ground the trucks drive on (docs/VISUALS.md "Two surfaces"). A 4x4 Evolution track is always on its game's
  smoothed 8 ft grid, drawn and driven (docs/EVO2_EXE_ANALYSIS.md 5a), and races under its game's physics
  (tests/physics-models.test.mjs). A Community Patch 4 track is on the 8 ft spline grid only when its .TXV asks for it
  (docs/CP4_EXE_ANALYSIS.md 1.5). Smooth terrain is a look for the rest: MTM1, MTM2 classic and CART Precision Racing.
  The track tests read local game files and are opt-in (OPENMTM2_STOCK=1, tests/helpers/stock.mjs).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry } from "../src/vendor/openphotex/index.js";
import * as evoSim from "../src/vendor/openphotex/sim/evo/index.js";
import { createVfs } from "../src/worker/vfs.js";
import { loadLevel } from "../src/worker/level-load.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { EVO_SMOOTH_SIT_VERSION } from "../src/worker/evo-track-build.js";
import { GAMES, skipLocal, skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("both Evo games smooth the ground from .SIT version 3; a header-less situation (version 2) keeps flat triangles", () => {
  assert.equal(EVO_SMOOTH_SIT_VERSION, 3);
});

const EVO2_ASPEN = join(GAMES, "evo2", "ASPEN.POD");

test("an Evo 2 track is on the game's smoothed grid whatever the graphics switches", { skip: skipLocal(EVO2_ASPEN) }, async () => {
  const bytes = new Uint8Array(readFileSync(EVO2_ASPEN));
  const vfs = createVfs([{ name: "ASPEN.POD", family: "EVO2", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) }]);
  const raw = await vfs.read("DATA\\ASPEN.RAW");
  const corners = Uint16Array.from({ length: 65536 }, (_, i) => raw[i * 2] | (raw[i * 2 + 1] << 8));
  const expected = Float32Array.from(evoSim.evoSmoothHeights(corners), (v) => v / 32);
  for (const smoothing of [false, true]) {
    const build = await buildTrackRender(vfs, "WORLD\\ASPEN.SIT", { visuals: { smoothing } });
    assert.equal(build.game, "EVO2");
    assert.deepEqual(build.fineFt, expected, `Smooth terrain ${smoothing ? "on" : "off"}`);
    assert.ok(!build.relief, "Smooth terrain is not built over Evo's ground");
  }
});

test("a retail MTM2 track keeps its 32 ft triangles under the trucks, and Smooth terrain is drawn over them", { skip: skipWithoutStock("POD.INI") }, async () => {
  const level = await loadLevel(stockVfs(), "WORLD\\TPARK.SIT");
  assert.equal(level.terrainMode, "classic8");
  assert.equal(level.fineFt, null);
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT", { visuals: { smoothing: true } });
  assert.equal(build.fineFt, null);
  assert.ok(build.relief, "the drawn ground is Smooth terrain's");
});

const SANDBOX = join(GAMES, "cp4sandbox", "fog_test.pod");

test("a CP4 track whose .TXV asks for the spline is drawn and driven on it, with no Smooth terrain over it", { skip: skipLocal(SANDBOX) }, async () => {
  const bytes = new Uint8Array(readFileSync(SANDBOX));
  const vfs = createVfs([{ name: "FOG_TEST.POD", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) }]);
  const read = vfs.read.bind(vfs);
  const txv = new TextEncoder().encode("formatVersion=5\r\nterrainGrid=spline\r\n");
  const spline = Object.assign(Object.create(vfs), { read: async (path) => (path.toUpperCase() === "DATA\\FOGTEST.TXV" ? txv : read(path)) });
  const asked = await buildTrackRender(spline, "WORLD\\FOGTEST.SI2", { visuals: { smoothing: true } });
  assert.equal(asked.terrainMode, "spline");
  assert.equal(asked.fineFt.length, 1024 * 1024);
  assert.ok(!asked.relief);
  // The same track without the key stays on the 32 ft grid, with Smooth terrain drawn over it.
  const classic = await buildTrackRender(vfs, "WORLD\\FOGTEST.SI2", { visuals: { smoothing: true } });
  assert.equal(classic.terrainMode, "classic8");
  assert.equal(classic.fineFt, null);
  assert.ok(classic.relief);
});
