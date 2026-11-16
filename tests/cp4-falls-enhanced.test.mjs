/*
  Community Patch 4's waterfalls in the enhanced look OpenMTM2 draws under "Reflective water" (docs/CP4_EXE_ANALYSIS.md
  16.7, 16.10): the look's choice, the per-fall roughFrom as its uniform takes it, and the shader's text (the engine's
  whitewater rules and constants, the back face, Normal-Water read as the lakes read it). The GLSL itself is compiled
  only by a browser.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FALL_LOOK_ENHANCED, FALL_LOOK_ICE, FALL_LOOK_ORIGINAL, FALL_WHITEWATER, waterfallLook, waterfallRough,
} from "../src/game/waterfalls.js";
import { FALL_WATER_FRAGMENT, FALL_WATER_UNIFORMS } from "../src/render/waterfall-water.js";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const FREEZE = 1, SPLASH = 2, SNOW = 5;

test("roughFrom as the enhanced look's uniform: 0 is 25 ft/s, 1..250 kept, 255 off, 251..254 as 0", () => {
  assert.deepEqual(waterfallRough(0), [25, 1]);
  assert.deepEqual(waterfallRough(undefined), [25, 1]);
  assert.deepEqual(waterfallRough(1), [1, 1]);
  assert.deepEqual(waterfallRough(40), [40, 1]);
  assert.deepEqual(waterfallRough(250), [250, 1]);
  assert.deepEqual(waterfallRough(255), [25, 0], "255 turns the drop and speed whitewater off");
  // The loader makes these 0 (OpenPhotex readFallFile); here they read as 0 does, as the DLL's test has it.
  for (const r of [251, 252, 253, 254]) assert.deepEqual(waterfallRough(r), [25, 1], String(r));
  assert.equal(FALL_WHITEWATER.roughFrom, 25);
});

test("the look: Enhanced under Reflective water, Ice still in Snow on a FREEZE fall, Original without it (12.8.3)", () => {
  assert.equal(waterfallLook(0, SPLASH, true), FALL_LOOK_ENHANCED);
  assert.equal(waterfallLook(SNOW, SPLASH, true), FALL_LOOK_ENHANCED, "a fall without FREEZE runs in Snow");
  assert.equal(waterfallLook(SNOW, FREEZE, true), FALL_LOOK_ICE);
  assert.equal(waterfallLook(0, SPLASH, false), FALL_LOOK_ORIGINAL);
  assert.equal(waterfallLook(0, SPLASH), FALL_LOOK_ORIGINAL);
});

test("the enhanced shader: hotfix 3's W with roughFrom, the lip, the froth's constants and the foam's light (16.7.2)", () => {
  const fs = FALL_WATER_FRAGMENT;
  // W: the drop past 27 ft over 30 in free fall, the speed past roughFrom over 20, both off with it; the impact; the lip.
  assert.match(fs, /uRough\.y \* max\( wfSat\( \( drop - 27\.0 \) \/ 30\.0 \) \* air, wfSat\( \( v - uRough\.x \) \/ 20\.0 \) \) \* 0\.9/);
  assert.match(fs, /\( 1\.0 - smoothstep\( 0\.0, 0\.5, end \) \) \* 0\.85 \) \* 1\.0 \) \* lip;/);
  assert.match(fs, /float lip = wfSat\( path \/ 4\.0 \);/);
  // Cells: streaks 1 x 3.5 ft, churn 0.8 ft, walls 0.22, mean 0.577; density 1.2 x cells + 1.3 x the (3.5, 8) ft fbm.
  assert.match(fs, /vec2 sizeA = vec2\( 1\.0, 3\.5 \);/);
  assert.match(fs, /wfCells\( q \/ 0\.8 \+ vec2\( 7\.31, 2\.17 \) \)/);
  assert.match(fs, /1\.0 - smoothstep\( 0\.0, 0\.22, F\.y - F\.x \)/);
  assert.match(fs, /vec2 densityFt = vec2\( 3\.5, 8\.0 \);/);
  assert.match(fs, /0\.5 \+ 1\.2 \* \( cells - 0\.577 \) \+ 1\.3 \* \( broad - 0\.5 \)/);
  // Feature points in 0.1 .. 0.9 of their cell from the full 32-bit hash.
  assert.match(fs, /vec2\( float\( h & 0xffffu \), float\( h >> 16u \) \) \* \( 0\.8 \/ 65535\.0 \) \+ 0\.1 - f/);
  assert.match(fs, /0x8da6b343u \^ uint\( c\.y \) \* 0xd8163841u/);
  // Erosion through 0.22 either side, the foam light 0.65 + 0.35 hl^2, gaps 0.25 milky and 0.25 clearer, dense foam 0.95.
  assert.match(fs, /float soft = 0\.22 \* \( back \? 1\.6 : 1\.0 \);/);
  assert.match(fs, /smoothstep\( 1\.0 - W - soft, 1\.0 - W \+ soft, density \) \* wfSat\( W \* 4\.0 \) \* wfSat\( sideK \* 1\.5 \)/);
  assert.match(fs, /vec3\( 0\.86, 0\.9, 0\.94 \) \* uDaylight \* \( 0\.65 \+ 0\.35 \* halfLambert \* halfLambert \)/);
  assert.match(fs, /0\.25 \* aer/);
  assert.match(fs, /mix\( waterAlpha \* \( 1\.0 - 0\.25 \* aer \), max\( waterAlpha, 0\.95 \), froth \)/);
  // The veil and the break-up.
  assert.match(fs, /alpha \*= 1\.0 - 0\.4 \* brk \* \( 1\.0 - 0\.75 \* froth \);/);
  assert.match(fs, /smoothstep\( 15\.0, 100\.0, drop \)/);
});

test("the enhanced shader: the back face (16.7.3) and Normal-Water on the sheet as the lakes read it (16.7.5)", () => {
  const fs = FALL_WATER_FRAGMENT;
  // Back: no cells, 1.6x softer, froth x 0.7, gaps x 0.5, its plain body (the reflection and glint only in front), x air.
  assert.match(fs, /float cells = back \? 0\.0 : 1\.0;/);
  assert.match(fs, /\* \( back \? 0\.7 : 1\.0 \);/);
  assert.match(fs, /wfSat\( W \* 1\.25 \) \* wfSat\( sideK \* 1\.5 \) \* \( back \? 0\.5 : 1\.0 \)/);
  assert.match(fs, /if \( ! back \) \{/);
  assert.match(fs, /float backAlpha = back \? air : 1\.0;/);
  // The detail: two layers in the sheet's own feet with snapped clocks, 0.02 x (1 + 4 mask), faded 1.5 to 5 ft.
  assert.match(fs, /floor\( 600\.0 \* spd \/ 48\.0 \+ 0\.5 \) \* \( 48\.0 \/ 600\.0 \)/);
  assert.match(fs, /vec2\( u \/ 64\.0, \( tau \* spd - t \* sA \) \/ 48\.0 \)/);
  assert.match(fs, /vec2\( u \/ 118\.72 \+ 0\.37, \( tau \* spd - t \* sB \) \/ 89\.0 \+ 0\.61 \)/);
  assert.match(fs, /0\.02 \* \( 1\.0 \+ 4\.0 \* mk \) \* detailLod \* detailSeen \* uWaterDetailAt\.y/);
  assert.match(fs, /1\.0 - smoothstep\( 1\.5, 5\.0, ftPerPixel \)/);
  assert.match(fs, /clamp\( 1\.0 \+ 2\.4 \* dot\( detail, vec2\( 0\.6, 0\.8 \) \), 0\.7, 1\.3 \)/);
  // The mask at the point's place over the world, its period the lakes' own (render/water-surface.js).
  assert.match(fs, /textureGrad\( uWaterMask, at \/ uWaterDetailAt\.w,/);
  assert.match(source("render/water-surface.js"), /textureGrad\( uWaterMask, at \/ uWaterDetailAt\.w,/);
});

test("the enhanced shader is well formed: its uniforms, its varyings from the falls' vertex shader, no reversed smoothstep", () => {
  const fs = FALL_WATER_FRAGMENT;
  const count = (text, ch) => text.split(ch).length - 1;
  assert.equal(count(fs, "("), count(fs, ")"));
  assert.equal(count(fs, "{"), count(fs, "}"));
  assert.doesNotMatch(fs, /\$\{|undefined|NaN/);
  // GLSL leaves smoothstep with edge0 >= edge1 undefined: every literal pair rises.
  for (const [, a, b] of fs.matchAll(/smoothstep\(\s*(-?[\d.]+),\s*(-?[\d.]+),/g)) assert.ok(Number(a) < Number(b), `smoothstep( ${a}, ${b} )`);
  // Every Reflective water uniform it reads is declared, and is one the water has.
  const water = source("render/water-surface.js");
  for (const name of FALL_WATER_UNIFORMS) {
    assert.match(fs, new RegExp(`uniform [^;]*\\b${name}\\b`), name);
    assert.match(water, new RegExp(`\\b${name}: \\{ value:`), `the water has ${name}`);
  }
  assert.match(water, /\n {4}uniforms,\n/, "the water hands its uniforms on");
  // The varyings it reads are the vertex shader's, and the drop and path come from vertex floats 11 and 15.
  const falls = source("render/waterfalls.js");
  const vertex = falls.slice(falls.indexOf("const VERTEX"), falls.indexOf("const FRAGMENT"));
  for (const name of ["vFlow", "vSheet", "vNormal", "vWorld", "vAnchored", "vDropPath"]) {
    assert.match(fs, new RegExp(`varying [^;]*\\b${name}\\b`), name);
    assert.match(vertex, new RegExp(`varying [^;]*\\b${name}\\b`), `the vertex shader has ${name}`);
    assert.match(vertex, new RegExp(`\\b${name} = `), `the vertex shader writes ${name}`);
  }
  assert.match(falls, /aDrop: new THREE\.InterleavedBufferAttribute\(buffer, 1, 11\)/);
  assert.match(falls, /aPath: new THREE\.InterleavedBufferAttribute\(buffer, 1, 15\)/);
  // The scenery hands the falls the water while it is there.
  const scenery = source("render/scenery.js");
  assert.match(scenery, /if \(water\) setWaterfallWater\(world, water\);/);
  assert.match(scenery, /if \(water\) setWaterfallWater\(world, null\);/);
});
