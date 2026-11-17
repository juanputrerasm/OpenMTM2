/*
  Community Patch 4's light on a Spline or Full Map track's 8 ft grid (docs/CP4_EXE_ANALYSIS.md 1.8) and its foliage
  translucency (15.12). The render files import three.js, which node does not resolve here, so they are checked by text.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FINE_SIDE, cp4FineShade, cp4GroundLight, cp4LambertByte } from "../src/game/cp4-fine-shade.js";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const UP = [0, 65535, 0];

test("the ground light: the level's sun and ambient, Dusk, Night and Pitch Black as the engine sets them", () => {
  assert.deepEqual(cp4GroundLight(0, [35771, -33876, -31057], 28111), { sun: [35771, -33876, -31057], ambient: 28111 });
  assert.deepEqual(cp4GroundLight(6, [35771, -33876, -31057], 28111), { sun: [17885, -16938, -15528], ambient: 0x8000 });
  assert.deepEqual(cp4GroundLight(7, [35771, -33876, -31057], 28111), { sun: [8942, -8469, -7764], ambient: 0x4000 });
  assert.deepEqual(cp4GroundLight(8, [35771, -33876, -31057], 28111), { sun: [4471, -4234, -3882], ambient: 0 });
  assert.equal(cp4LambertByte({ sun: [0, -65536, 0], ambient: 0 }, UP), 255);
  assert.equal(cp4LambertByte({ sun: [0, 65536, 0], ambient: 0x8000 }, UP), 128, "the sun from below leaves the ambient");
});

test("fine shading: flat ground takes the sun's light, or the .LTE between its corners; a slope is lit by its own normal", () => {
  const light = { sun: [0, -46341, 46341], ambient: 0x4000 };
  const flat = new Float32Array(FINE_SIDE * FINE_SIDE).fill(100);
  const own = cp4LambertByte(light, UP);
  assert.ok(cp4FineShade({ fineFt: flat, light }).every((v) => v === own), "no .LTE: the engine's own light everywhere");
  const lte = new Uint8Array(256 * 256 * 7);
  for (let i = 0; i < 256 * 256; i++) lte[i * 7] = i % 2 ? 200 : 100;
  const lit = cp4FineShade({ fineFt: flat, lte, light });
  assert.equal(lit[0], 100);
  assert.equal(lit[4], 200);
  assert.equal(lit[2], 150, "halfway between the corners");
  // A ramp rising toward +z faces -z, where the sun (travelling toward +z) comes from: brighter than flat ground.
  const ramp = Float32Array.from({ length: FINE_SIDE * FINE_SIDE }, (_, i) => Math.floor(i / FINE_SIDE) % 64);
  assert.ok(cp4FineShade({ fineFt: ramp, light })[10 * FINE_SIDE + 10] > own);
  assert.equal(cp4FineShade({ fineFt: new Float32Array(16), light }), null);
});

test("the fine light reaches the mesh on a CP4 Spline or Full Map track, not on a track format version 6 world", () => {
  const build = source("worker/track-build.js");
  assert.match(build, /const fineShade = level\.v6 \? null : cp4FineShade\(\{ fineFt: level\.fineFt, lte: level\.lte, light: cp4GroundLight\(weather, level\.lvl\.sunVector, level\.lvl\.shadowIntensity\) \}\);/);
  assert.match(source("worker/terrain-mesh.js"), /if \(ownShade\) shade\[v\] = ownShade\[\(r & mask\) \* side \+ \(c & mask\)\] \/ 255;/);
});

test("foliage: a translucent material lights a face by mix(max(n.l, 0), |n.l|, t)", () => {
  const ts = source("render/track-scene.js");
  assert.match(ts, /const translucency = clamp01\(\(record\.translucency \?\? 0\) \/ 65536\);\n  if \(translucency > 0\) foliage\(material, translucency\);/);
  assert.match(ts, /float dotNL = mix\( saturate\( cp4Nl \), abs\( cp4Nl \), \$\{t\} \);/);
});
