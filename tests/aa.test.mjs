/*
  Anti-aliasing choices (docs/VISUALS.md, "Anti-aliasing"): what each one asks of the picture.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AA_HINT, AA_MODES, DEFAULT_AA, MSAA_MANY_POINTS, TAA_DEPTH_FT, TAA_DEPTH_SHARE, TAA_HISTORY, TAA_RESET_FT, TAA_RESET_TURN,
  aaChoice, aaPost, aaResets, aaSamples, screenSampled, taaJitter,
} from "../src/game/aa.js";

test("MSAA is the default, and the optional passes stay off until one of them is chosen", () => {
  assert.equal(DEFAULT_AA, "msaa");
  assert.deepEqual(AA_MODES.map((mode) => mode.id), ["off", "msaa", "fxaa", "smaa", "taa"]);
  assert.deepEqual(AA_MODES.map((mode) => mode.label), ["Off", "MSAA", "FXAA", "SMAA", "TAA"]);
  assert.equal(aaPost("msaa"), null);
  assert.equal(aaPost("off"), null);
  assert.equal(aaPost("fxaa"), "fxaa");
  assert.equal(aaPost("smaa"), "smaa");
  assert.equal(aaPost("taa"), "taa");
  // A stored value that is not a choice draws the default, not a pass.
  assert.equal(aaChoice("nope"), "msaa");
  assert.equal(aaChoice(undefined), "msaa");
  assert.equal(aaPost("nope"), null);
  assert.ok(AA_HINT.includes("optional") && AA_HINT.includes("headset"));
});

test("MSAA takes four samples a point, two above five million points, and every other choice takes one", () => {
  assert.equal(MSAA_MANY_POINTS, 5e6);
  assert.equal(aaSamples("msaa", 1920, 1080), 4, "1920 x 1080 is under five million");
  assert.equal(aaSamples("msaa", 2560, 1440), 4);
  assert.equal(aaSamples("msaa", 1, MSAA_MANY_POINTS), 4, "five million points is still four");
  assert.equal(aaSamples("msaa", 3840, 2160), 2);
  assert.equal(aaSamples("msaa", 1, MSAA_MANY_POINTS + 1), 2);
  for (const id of ["off", "fxaa", "smaa", "taa"]) assert.equal(aaSamples(id, 3840, 2160), 0, id);
  assert.equal(aaSamples("nope", 1920, 1080), 4, "an unknown choice is MSAA");
  assert.equal(aaSamples("nope", 3840, 2160), 2);
});

test("TAA's sample stays inside half a pixel, and a camera cut drops the frame it kept", () => {
  assert.equal(TAA_HISTORY, 0.9);
  assert.equal(TAA_RESET_FT, 40);
  assert.equal(TAA_RESET_TURN, 0.2);
  assert.equal(TAA_DEPTH_FT, 0.5);
  assert.equal(TAA_DEPTH_SHARE, 0.02);
  // Frame 1 is the first point of the sequence: base 2 gives 0.5, base 3 gives 1/3.
  assert.deepEqual(taaJitter(1), [0, 1 / 3 - 0.5]);
  assert.deepEqual(taaJitter(0), taaJitter(1), "a frame before the first is the first");
  for (let frame = 1; frame <= 64; frame++) {
    const [x, y] = taaJitter(frame);
    assert.ok(x >= -0.5 && x < 0.5 && y >= -0.5 && y < 0.5, `frame ${frame}: ${x}, ${y}`);
  }
  // The points are not all the same, so the samples fill the pixel.
  const xs = new Set(Array.from({ length: 16 }, (_, i) => taaJitter(i + 1)[0]));
  assert.ok(xs.size > 4);
  assert.equal(aaResets(0, 0), false);
  assert.equal(aaResets(TAA_RESET_FT, 0), false, "the limit itself is still the same view");
  assert.equal(aaResets(TAA_RESET_FT + 0.01, 0), true);
  assert.equal(aaResets(0, TAA_RESET_TURN), false);
  assert.equal(aaResets(0, TAA_RESET_TURN + 0.001), true);
});

test("the choice is a setting, MSAA until the player picks, and Options lists every one", async () => {
  const { DEFAULT_SETTINGS, loadSettings } = await import("../src/app/settings.js");
  assert.equal(DEFAULT_SETTINGS.aa, "msaa");
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  assert.equal(loadSettings().aa, "msaa", "a setting saved before the choice existed");
  store.set("openmtm2.settings", JSON.stringify({ version: 6, aa: "taa", look: "classic" }));
  assert.equal(loadSettings().aa, "taa");
  assert.equal(loadSettings().look, "classic");
  store.set("openmtm2.settings", JSON.stringify({ version: 6, aa: "dlss" }));
  assert.equal(loadSettings().aa, "msaa", "a value that is not a choice");
  delete globalThis.localStorage;
  const panel = readFileSync(new URL("../src/ui/options-panel.js", import.meta.url), "utf8");
  assert.match(panel, /AA_MODES\.map\(\(mode\) => el\("option"/);
  assert.match(panel, /title: AA_HINT/);
});

test("the race and the replay take the choice, and the lens draws as many samples as it asks", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const scenery = read("../src/render/scenery.js");
  assert.match(scenery, /mode !== "msaa"/);
  assert.match(scenery, /createAntiAlias\(\{ renderer, mode \}\)/);
  assert.match(scenery, /renderFlat\(scene, view/);
  const lens = read("../src/render/lens.js");
  assert.match(lens, /uManual/);
  assert.match(lens, /aa\.samples\(w, h\)/);
  // TAA is handed the scene's picture raw, with what is over it, and cleans it as it reads it: no pass of its own.
  assert.match(lens, /settle\(target, target\.depthTexture, camera, \{ raw: true, over: laid \}\)/);
  assert.doesNotMatch(lens, /CLEAN/);
  for (const screen of ["../src/ui/screens/race.js", "../src/ui/screens/replay.js"]) {
    assert.match(read(screen), /scenery\.setSize\(canvas\.width, canvas\.height\)/);
  }
});

test("TAA keeps its frame and the distance in one pass, and hands on the steady picture where it left it", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const aa = read("../src/render/aa.js");
  // One picture out of one pass, kept for the next frame: the steady picture, the distance in its fourth number, read back
  // at the nearest point. No second picture for the distance.
  assert.match(aa, /layout\(location = 0\) out highp vec4 outSteady;/);
  assert.doesNotMatch(aa, /outDistance|count: 2/);
  assert.match(aa, /outSteady = vec4\(current, distance\);/);
  assert.match(aa, /float zHist = texelFetch\(tHistory, clamp\(ivec2\(floor\(prevUv \* vec2\(kept\)\)\), ivec2\(0\), kept - 1\), 0\)\.a;/);
  // No copy of the steady picture back into the scene's, and no pass for the distance.
  assert.doesNotMatch(aa, /DEPTH_COPY|const COPY/);
  assert.match(aa, /return write\.textures\[0\];/);
  // The screen and the glow read the steady picture where TAA left it.
  assert.match(aa, /grade\.uniforms\.tDiffuse\.value = steady \?\? flat\.texture;/);
  const lens = read("../src/render/lens.js");
  assert.match(lens, /drawBloom\(steady \?\? target\.texture\);/);
  assert.match(lens, /material\.uniforms\.tDiffuse\.value = steady \?\? target\.texture;/);
  // The final pass adds the glow whether or not it cleaned the picture.
  assert.match(lens, /color \+= texture2D\( tBloom, vUv \)\.rgb;/);
});

test("the screen's own picture has samples only where MSAA draws the scene straight onto it, without the lens", () => {
  assert.equal(screenSampled({}), true, "the defaults: MSAA, no lens");
  assert.equal(screenSampled({ aa: "msaa" }), true);
  assert.equal(screenSampled({ aa: "msaa", lensEffects: true }), false, "through the lens the scene has a picture of its own");
  for (const aa of ["off", "fxaa", "smaa", "taa"]) assert.equal(screenSampled({ aa }), false, aa);
  assert.equal(screenSampled({ aa: "nope" }), true, "an unknown choice is MSAA");
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const host = read("../src/render/xr/xr-host.js");
  assert.match(host, /antialias: screenSampled\(context\.settings\)/);
  // three.js is told the context has samples, so a headset's pictures keep theirs, and no alpha, as three.js had it.
  assert.match(host, /gl\.getContextAttributes = \(\) => \(\{ \.\.\.attributes\(\), alpha: false, antialias: true \}\);/);
  assert.match(host, /new THREE\.WebGLRenderer\(\{ canvas, context: gl \?\? null \}\)/);
  // A race that wants MSAA without the lens on a screen made without samples draws it into a picture that has them.
  const scenery = read("../src/render/scenery.js");
  assert.match(scenery, /mode !== "msaa" \|\| \(!on\.lens && !screenSamples\(renderer\)\)/);
  const aa = read("../src/render/aa.js");
  assert.match(aa, /const samples = aaSamples\(mode, width, height\);/);
  assert.match(aa, /flat = halfFloat\(width, height, \{ depth: true, samples \}\);/);
});
