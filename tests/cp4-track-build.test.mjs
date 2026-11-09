/*
  A Community Patch 4 track through the track builder (src/worker/track-build.js): its lakes' sheets, its fog volumes
  (type 14 boxes, neither drawn as models nor met) and its vegetation. The track is Fila's vegetation and fog sandbox
  (~/games/cp4sandbox/fog_test.pod, opt-in with OPENMTM2_STOCK=1).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { createVfs } from "../src/worker/vfs.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { GAMES, skipLocal } from "./helpers/stock.mjs";

const SANDBOX = join(GAMES, "cp4sandbox", "fog_test.pod");

test("the sandbox's two lakes, two fog volumes and vegetation reach the build", { skip: skipLocal(SANDBOX) }, async () => {
  const bytes = new Uint8Array(readFileSync(SANDBOX));
  const vfs = createVfs([{ name: "FOG_TEST.POD", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) }]);
  const build = await buildTrackRender(vfs, "WORLD\\FOGTEST.SI2", {});
  assert.deepEqual(build.lakes.bodies.map((b) => b.id), [1, 2]);
  assert.ok(build.lakes.bodies.every((b) => b.sheet.indices.length > 0));
  assert.equal(build.fogVolumes.length, 2);
  assert.ok(!build.objects.some((o) => o.type === 14), "a fog box is not drawn as its model");
  assert.ok(!build.sim.boxes.some((b) => b.type === 14), "nor met");
  assert.ok(build.vegetation.species.length > 0);
  assert.ok(build.vegetation.species.every((s) => s.model in build.models));
  assert.equal(build.terrain.hasLte, true);
});
