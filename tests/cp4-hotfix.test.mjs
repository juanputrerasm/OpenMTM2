/*
  Community Patch 4 beta 0.53 hotfixes 2 and 3 (docs/CP4_EXE_ANALYSIS.md 15): Normal-Water's generated detail normal and
  its loading, Always On Normal-Terrain's default mask, the strength sliders, and the sun below the horizon.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DETAIL_NORMAL_SEED, DETAIL_NORMAL_SIDE, buildDetailNormal, detailNoiseHeights, generatedDetailNormal } from "../src/shared/detail-normal.js";
import { averageColor, defaultMaskByte, defaultMaskStrength, defaultTerrainMask } from "../src/shared/terrain-mask.js";
import { DEFAULT_SETTINGS, SETTINGS_VERSION, cp4NormalsOf, migrateSettings } from "../src/app/settings.js";
import { lightRig, sunBelowHorizon } from "../src/game/lighting.js";
import { loadDetailImage, loadPlainImage } from "../src/worker/art-texture.js";
import { DETAIL_MAX_DIM, hdDimensionRefusal } from "../src/worker/image-decoder.js";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

/** The recipe's stream (15.2.2), kept apart from the module's: xorshift32 13, 17 (logical), 5, as 32-bit words. */
function draws(count) {
  let s = BigInt(DETAIL_NORMAL_SEED);
  const mask = 0xffffffffn, out = [];
  for (let i = 0; i < count; i++) {
    s ^= (s << 13n) & mask;
    s ^= s >> 17n;
    s ^= (s << 5n) & mask;
    out.push(Number(s & 0xffffn) / 65535);
  }
  return out;
}

test("the generated detail normal: 256 x 256, the seed's stream through five octaves, B and A 255", () => {
  assert.equal(DETAIL_NORMAL_SEED, 0x92d68ca2);
  const map = buildDetailNormal();
  assert.equal(map.width, DETAIL_NORMAL_SIDE);
  assert.equal(map.height, DETAIL_NORMAL_SIDE);
  assert.equal(map.rgba.length, 256 * 256 * 4);
  // At pixel (0, 0) every octave reads its first lattice value: draws 0, 16, 80, 336 and 1360 of the one stream, at
  // amplitudes 1, 1/2, 1/4, 1/8 and 1/16.
  const d = draws(1360 + 1);
  const expected = d[0] + d[16] / 2 + d[80] / 4 + d[336] / 8 + d[1360] / 16;
  const h = detailNoiseHeights();
  assert.ok(Math.abs(h[0] - expected) < 1e-5, `${h[0]} is not ${expected}`);
  // The normal from the slopes (x20), wrapping: at (0, 0) the neighbours are columns 1 and 255, rows 1 and 255.
  const dx = -(h[1] - h[255]) * 20, dy = -(h[256] - h[255 * 256]) * 20, len = Math.hypot(dx, dy, 1);
  assert.equal(map.rgba[0], Math.trunc((dx / len * 0.5 + 0.5) * 255 + 0.5));
  assert.equal(map.rgba[1], Math.trunc((dy / len * 0.5 + 0.5) * 255 + 0.5));
  for (let i = 0; i < map.rgba.length; i += 4) { assert.equal(map.rgba[i + 2], 255); assert.equal(map.rgba[i + 3], 255); }
  // Values as built (a change to the recipe shows here): (x, y) -> R, G.
  for (const [x, y, r, g] of [[0, 0, 104, 142], [1, 0, 103, 143], [0, 1, 108, 174], [100, 37, 146, 54], [255, 255, 78, 130], [128, 64, 122, 138]]) {
    const o = (y * 256 + x) * 4;
    assert.deepEqual([map.rgba[o], map.rgba[o + 1]], [r, g], `(${x}, ${y})`);
  }
  // Built once and kept, and the same every time.
  assert.equal(generatedDetailNormal(), generatedDetailNormal());
  assert.deepEqual(buildDetailNormal().rgba, map.rgba);
});

test("detail art: MaskArt first, PNG then TGA; up to 2048 and any shape, refused above (the generated map stands in)", async () => {
  const tga = (w, h, rgb) => {
    const out = new Uint8Array(18 + w * h * 3);
    out[2] = 2; out[12] = w & 255; out[13] = w >> 8; out[14] = h & 255; out[15] = h >> 8; out[16] = 24;
    for (let i = 0; i < w * h; i++) out.set([rgb[2], rgb[1], rgb[0]], 18 + i * 3);
    return out;
  };
  const vfs = (files) => ({ read: async (path) => files[path] ?? null });
  const none = async () => null;
  // An odd size loads (the engine warns that it mips less cleanly).
  const odd = await loadDetailImage(vfs({ "ART\\TPARK_WDTL.TGA": tga(48, 40, [1, 2, 3]) }), "TPARK_WDTL", { maskArt: none });
  assert.equal(odd.width, 48);
  assert.match(odd.odd, /not square/);
  // An archive's MaskArt entry wins over ART, and the install's loose MaskArt folder too.
  const both = { "ART\\TPARK_DTL.TGA": tga(32, 32, [9, 9, 9]), "MASKART\\TPARK_DTL.TGA": tga(32, 32, [7, 7, 7]) };
  assert.equal((await loadDetailImage(vfs(both), "TPARK_DTL", { maskArt: none })).rgba[0], 7);
  const loose = async (name) => (name === "TPARK_MASK.TGA" ? tga(4, 4, [200, 0, 0]) : null);
  assert.equal((await loadPlainImage(vfs({ "ART\\TPARK_MASK.TGA": tga(4, 4, [10, 0, 0]) }), "TPARK_MASK", { maskArt: loose })).rgba[0], 200);
  // Other art is not looked for in MaskArt.
  assert.equal(await loadPlainImage(vfs({ "MASKART\\ROCK.TGA": tga(4, 4, [1, 1, 1]) }), "ROCK", { maskArt: none }), null);
  // The cap is 2048 (CP3's HD art keeps 1024): a refusal names the cap it was held to.
  assert.equal(DETAIL_MAX_DIM, 2048);
  assert.equal(hdDimensionRefusal("A", 2048, 2048, DETAIL_MAX_DIM), null);
  assert.equal(hdDimensionRefusal("A", 2048, 2048), null, "HD art up to 2048 (CP4 2.0.52.4)");
  assert.match(hdDimensionRefusal("A", 4096, 4096, DETAIL_MAX_DIM), /outside 32\.\.2048/);
});

test("Always On Normal-Terrain's default mask: per tile from its texture's luma, 2x dark down to 1x past about 130", () => {
  assert.equal(defaultMaskStrength(0), 2);
  assert.equal(defaultMaskStrength(75), 2);
  assert.ok(Math.abs(defaultMaskStrength(92) - (2 - (17 * 0.58) / 34)) < 1e-12);
  assert.ok(Math.abs(defaultMaskStrength(109) - 1.42) < 1e-12);
  assert.equal(defaultMaskStrength(130), 1);
  assert.equal(defaultMaskStrength(255), 1);
  // Byte = int((v - 1) * 0.25 * 255 + 0.5), so the shader's 1 + 4 * mask is v.
  assert.equal(defaultMaskByte(2), 64);
  assert.equal(defaultMaskByte(1.42), 27);
  assert.equal(defaultMaskByte(1), 0);
  assert.deepEqual(averageColor({ rgba: new Uint8Array([10, 20, 30, 255, 30, 40, 50, 255]) }), [20, 30, 40]);
  // One texel a tile, row = tile z, by the .CLR word's slot (bits 0-11); grey.
  const clr = new Uint16Array(256 * 256).fill(1);
  clr[3 * 256 + 5] = 0x2000;
  const mask = defaultTerrainMask(clr, [[20, 20, 20], [250, 250, 250]]);
  assert.equal(mask.width, 256);
  assert.equal(mask.rgba[0], 0);
  assert.deepEqual([...mask.rgba.slice((3 * 256 + 5) * 4, (3 * 256 + 5) * 4 + 4)], [64, 64, 64, 255]);
});

test("the hotfix options: defaults as the engine's, the strengths 0 to 300 %", () => {
  assert.equal(SETTINGS_VERSION, 16);
  assert.equal(DEFAULT_SETTINGS.cp4TerrainNormalAlways, false);
  assert.equal(DEFAULT_SETTINGS.cp4WaterNormalAlways, false);
  assert.equal(DEFAULT_SETTINGS.cp4TerrainNormalStrength, 100);
  assert.equal(DEFAULT_SETTINGS.cp4WaterNormalStrength, 100);
  // CP4's shore foam is not ported (OpenMTM2's Reflective water keeps its own): no option for its style.
  assert.equal("cp4FoamStyle" in DEFAULT_SETTINGS, false);
  // A save from before them takes the defaults.
  const old = migrateSettings({ version: 16 });
  assert.equal(old.cp4WaterNormalStrength, 100);
  const odd = migrateSettings({ version: 16, cp4WaterNormalStrength: 900, cp4TerrainNormalStrength: "x" });
  assert.equal(odd.cp4WaterNormalStrength, 300);
  assert.equal(odd.cp4TerrainNormalStrength, 100);
  assert.deepEqual(cp4NormalsOf({ cp4WaterNormalAlways: true, cp4WaterNormalStrength: -5, cp4TerrainNormalStrength: 250 }),
    { terrainAlways: false, terrainStrength: 250, waterAlways: true, waterStrength: 0 });
});

test("the strengths scale only the default masks: a track's own mask draws at 1", () => {
  const build = source("worker/track-build.js");
  assert.match(build, /strength: maskImage \? 1 : normalStrength\(normals\.terrainStrength\)/);
  assert.match(build, /strength: maskImage \? 1 : normalStrength\(normals\.waterStrength\)/);
  // Without a _WMSK and without Always On, no water detail: the mask is the switch.
  assert.match(build, /if \(!maskImage && normals\.waterAlways !== true\) return null;/);
});

test("Normal-Water on the Reflective water only, and OpenMTM2's own shore foam kept", () => {
  const water = source("render/water-surface.js");
  const open = water.slice(water.indexOf("const WATER_FRAGMENT"), water.indexOf("const BED_VERTEX_PARS"));
  const ice = water.slice(water.indexOf("const ICE_FRAGMENT"), water.indexOf("const WATER_FRAGMENT"));
  // Two layers, 64 ft and 69 to a world, the mask over the world, 1 + 4 * mask, the footprint fade 1.5 to 5 ft.
  assert.match(open, /at \/ 64\.0 \+ uWaterDetailAt\.z \* vec2\( 0\.020, 0\.010 \)/);
  assert.match(open, /uWaterDetailAt\.z \* vec2\( - 0\.010, 0\.015 \)/);
  // The mask covers the world once: its width in feet is the uniform's w (8192, or a version 6 world's own).
  assert.match(open, /textureGrad\( uWaterMask, at \/ uWaterDetailAt\.w, detailDx \/ uWaterDetailAt\.w, detailDy \/ uWaterDetailAt\.w \)/);
  assert.match(water, /worldFt: detail\.worldFt > 0 \? detail\.worldFt : TERRAIN_MASK_FT/);
  assert.match(open, /0\.02 \* \( 1\.0 \+ 4\.0 \* mk \)/);
  assert.match(open, /smoothstep\( 1\.5, 5\.0,/);
  // The mirror wobbles 2.5x, the brightness 2.4x.
  assert.match(open, /slope\.x \+ 1\.5 \* detail\.x/);
  assert.match(open, /1\.0 \+ 2\.4 \* dot\( detail, vec2\( 0\.6, 0\.8 \) \), 0\.7, 1\.3/);
  // The shore's foam is the Reflective water's own depth band, as before the hotfixes; CP4's shore field is not ported.
  assert.match(open, /float reach = 0\.3 \+ 0\.22 \* sin\( uTime \* 0\.7 \+ cloud\.r \* 9\.0 \);/);
  assert.doesNotMatch(water, /uShore|shoreField/);
  // The ice never has it (the engine skips the snow ice), nor does the game's ripple water.
  assert.doesNotMatch(ice, /uWaterDetail|uShore/);
  assert.doesNotMatch(source("render/water-effects.js"), /uWaterDetail|uShore/);
});

test("a sun below the horizon lights nothing: no sun light in the rig, no cascades, no glint, no flare", () => {
  assert.equal(sunBelowHorizon([0, 1, 0]), false);
  assert.equal(sunBelowHorizon([1, 0, 0]), true);
  assert.equal(sunBelowHorizon([0.6, -0.8, 0]), true);
  assert.equal(lightRig(0, { toSun: [0.6, -0.8, 0] }).sun.strength, 0);
  assert.ok(lightRig(0, { toSun: [0.6, 0.8, 0] }).sun.strength > 0);
  // Dusk puts the sun at its own height whatever the level's: it is always up.
  assert.ok(lightRig(6, { toSun: [0.6, -0.8, 0] }).sun.strength > 0);
  assert.match(source("render/sun-shadows.js"), /if \(!this\._enabled \|\| this\._sunDown\) return false;/);
  assert.match(source("render/water-surface.js"), /if \(uniforms\.uSun\.value\.y <= 0\) \{ uniforms\.uSunColor\.value\.setScalar\(0\); uniforms\.uSunGlint\.value\.setScalar\(0\); \}/);
  assert.match(source("render/sun-flare.js"), /if \(toSun\.y <= 0\) return;/);
});
