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
import { GAMES, skipLocal, skipWithoutStock, stockVfs } from "./helpers/stock.mjs";
import * as C4 from "../src/vendor/openphotex/sim/cp4/index.js";

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

// The CommPatch4 physics' triangles (docs/CP4_EXE_ANALYSIS.md 11.2): one soup per collidable model, in the game frame,
// and from them shapes the session's boxes collide by.
function checkSoups(build) {
  const names = new Set(build.sim.boxes.map((b) => b.modelName).filter(Boolean));
  assert.ok(names.size > 0);
  for (const name of names) {
    const soup = build.sim.collisionSoups[name];
    if (!soup) continue; // a keyframed model with no frames of its own
    assert.equal(soup.positions.length % 9, 0, name);
    assert.ok(soup.positions.every(Number.isFinite), name);
    const box = build.sim.boxes.find((b) => b.modelName === name);
    // The soup lies within the model's bounds, which size the classic box.
    if (box.bounds) for (let k = 0; k < soup.positions.length; k++) {
      const a = k % 3;
      assert.ok(soup.positions[k] >= box.bounds.min[a] - 1e-3 && soup.positions[k] <= box.bounds.max[a] + 1e-3, `${name} axis ${a}`);
    }
  }
  const shapes = [...names].map((n) => build.sim.collisionSoups[n]).filter(Boolean).map((s) => C4.buildCollShape(s.positions));
  assert.ok(shapes.some((s) => C4.shapeUsable(s)), "some props collide by their triangles");
  return shapes;
}

test("the sandbox has no props to meet, so no triangles: its fog boxes are not collision boxes", { skip: skipLocal(SANDBOX) }, async () => {
  const bytes = new Uint8Array(readFileSync(SANDBOX));
  const vfs = createVfs([{ name: "FOG_TEST.POD", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) }]);
  assert.deepEqual((await buildTrackRender(vfs, "WORLD\\FOGTEST.SI2", {})).sim.collisionSoups, {});
});

test("Thunder Park's props carry their triangles for the CommPatch4 physics", { skip: skipWithoutStock() }, async () => {
  checkSoups(await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT", {}));
});
