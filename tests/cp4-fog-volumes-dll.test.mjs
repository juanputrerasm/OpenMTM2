/*
  Community Patch 4's fog volumes as beta 0.53 hotfix 3's renderer DLL draws them (docs/CP4_EXE_ANALYSIS.md 15.11): the
  wisps' noise volume and drift, the ground under a volume that ends its lines of sight in OpenMTM2, and the shader's
  rules by text (the GLSL itself is compiled only by a browser). With them, the object highlight rule (15.12) and the
  waterfalls' enhanced look outside Reflective water.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FOG_GROUND_SIDE, FOG_NOISE_SIDE, fogDriftPhase, fogNoiseVolume, fogVolumeGround, fogVolumeOf, withFogGround,
} from "../src/game/fog-volumes.js";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const FOG = { w: 40, l: 60, h: 20, base: 0, vis: 60, color: [0.75, 0.78, 0.82], half: 10, edge: 20, top: 5, bot: 0, maxOp: 1, wmask: 0x1ff, round: 1, wisp: 0.6, wsize: 25, wspd: 2 };

test("the wisps' noise: 64 cubed bytes stretched over 0..255, the same each time, and it tiles", () => {
  const v = fogNoiseVolume();
  assert.equal(FOG_NOISE_SIDE, 64);
  assert.equal(v.length, 64 * 64 * 64);
  assert.equal(fogNoiseVolume(), v, "made once");
  let lo = 255, hi = 0, sum = 0;
  for (const b of v) { lo = Math.min(lo, b); hi = Math.max(hi, b); sum += b; }
  assert.equal(lo, 0);
  assert.equal(hi, 255);
  const mean = sum / v.length;
  assert.ok(mean > 90 && mean < 165, `mean ${mean}`);
  // Across the wrap a step is no bigger than steps inside the volume: the last column meets the first.
  const at = (x, y, z) => v[(z * 64 + y) * 64 + x];
  let seam = 0, inside = 0;
  for (let z = 0; z < 64; z += 7) for (let y = 0; y < 64; y += 5) {
    seam = Math.max(seam, Math.abs(at(63, y, z) - at(0, y, z)));
    inside = Math.max(inside, Math.abs(at(31, y, z) - at(32, y, z)));
  }
  assert.ok(seam <= inside + 8, `seam ${seam}, inside ${inside}`);
});

test("a volume's wisp inputs: the noise tile wsize x 8 ft (wsize at least 1), the drift wspd ft/s, the phase in 0..1", () => {
  const v = fogVolumeOf({ fog: FOG, positionFt: [100, 50, 200], sizeFt: [60, 40, 20], psi: 0 });
  assert.equal(v.noiseTileFt, 200);
  assert.equal(v.driftFtPerS, 2);
  assert.equal(v.extinction, 3 / 60);
  assert.equal(fogDriftPhase(v, 50), 0.5);
  assert.equal(fogDriftPhase(v, 100), 0);
  assert.ok(Math.abs(fogDriftPhase(v, 175) - 0.75) < 1e-12);
  assert.equal(fogVolumeOf({ fog: { ...FOG, wsize: 0 }, positionFt: [0, 0, 0], sizeFt: [1, 1, 1] }).noiseTileFt, 8);
});

test("the ground under a volume: up its height from the floor (0) to the top (255), in the box's own turned frame", () => {
  const v = fogVolumeOf({ fog: FOG, positionFt: [1000, 100, 2000], sizeFt: [60, 40, 20], psi: 0 });
  // Floor at 100, top at 120.
  assert.deepEqual(v.half, [20, 10, 30]);
  const flat = fogVolumeGround(v, () => 110);
  assert.equal(flat.length, FOG_GROUND_SIDE * FOG_GROUND_SIDE);
  assert.ok(flat.every((b) => b === 128), "halfway up");
  assert.ok(fogVolumeGround(v, () => 50).every((b) => b === 0), "under the floor");
  assert.ok(fogVolumeGround(v, () => 500).every((b) => b === 255), "over the top");
  // Heading 0: the map's x runs along the game's +x, its rows along the game's -z.
  const slopeX = fogVolumeGround(v, (x) => 100 + (x - 980) / 2);
  assert.ok(slopeX[31] > slopeX[0] && slopeX[31 * 32] === slopeX[0]);
  const slopeZ = fogVolumeGround(v, (x, z) => 100 + (2030 - z) / 3);
  assert.ok(slopeZ[31 * 32] > slopeZ[0] && slopeZ[31] === slopeZ[0]);
  // A quarter turn puts the box's x along the game's -z.
  const turned = fogVolumeGround({ ...v, heading: Math.PI / 2 }, (x, z) => 100 + (2030 - z) / 3);
  assert.ok(turned[31] > turned[0]);
  const withGround = withFogGround([v], () => 110);
  assert.equal(withGround[0].ground.length, 1024);
  assert.equal(withGround[0].centre, v.centre);
});

test("the fog volume shader: the DLL's 12 steps, wisps, superellipse, smootherstep fades; the line ends at the ground", () => {
  const fs = source("render/fog-volumes.js");
  assert.match(fs, /const STEPS = 12;/);
  assert.match(fs, /dens \*= mix\( 1\.0, smoothstep\( 0\.25, 0\.75, nz \) \* 1\.6, uWisp\.x \);/);
  assert.match(fs, /nz = 0\.65 \* n1 \+ 0\.35 \* n2;/);
  assert.match(fs, /q \* 2\.7 - vec3\( 1\.0, 0\.0, 2\.0 \) \* uWisp\.z/);
  assert.match(fs, /float ne = mix\( 16\.0, 2\.0, uShape\.w \);/);
  assert.match(fs, /sd = min\( sd, sd \+ \( nz - 0\.5 \) \* edge \* uWisp\.x \* 1\.5 \);/);
  assert.match(fs, /x \* x \* x \* \( x \* \( x \* 6\.0 - 15\.0 \) \+ 10\.0 \)/);
  assert.match(fs, /if \( uWisp\.w > 0\.5 && p\.y < vfGround\( p\.xz \) \) break;/);
  assert.match(fs, /min\( uShape\.z, 1\.0 - exp\( - depth \* uShape\.x \* dt \) \)/);
  assert.match(source("worker/track-build.js"), /fogVolumes: withFogGround\(trackFalls\.fogVolumes, drawnGround\.heightAt\)/);
  assert.match(source("render/track-scene.js"), /parts\.fogVolumes\?\.update\(camera, dt\);/);
});

test("objects: only a shiny (Gouraud) face has the sun's highlight; other lit materials, leaves among them, have none", () => {
  const ts = source("render/track-scene.js");
  assert.match(ts, /const shiny = !!mesh\.shiny && look !== "classic";/);
  assert.match(ts, /specular: shiny \? new THREE\.Color\(CP3_SHINE, CP3_SHINE, CP3_SHINE\) : new THREE\.Color\(0, 0, 0\),/);
});

test("waterfalls: the enhanced look in the enhanced picture, on the falls' own water without Reflective water", () => {
  const wf = source("render/waterfalls.js");
  assert.match(wf, /const ownWater = look === "enhanced" \?/);
  assert.match(wf, /if \(ownWater\) setWater\(null, true\);/);
  assert.match(wf, /if \(!water && ownWater\) fillOwnWater\(lightRoot\);/);
  assert.match(wf, /const waterUniforms = \(\) => water\?\.uniforms \?\? ownWater;/);
});
