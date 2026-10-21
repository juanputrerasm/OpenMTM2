/*
  What the sun's shadow cascades keep of what never moves, and how they are read (game/shadow-cache.js,
  render/sun-shadows.js; docs/VISUALS.md, "Shadows").
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PATCH_SHARE, REBUILDS_PER_FRAME, SHOWS_TEXELS, changeReaches, patchesToRestore, shadowPatch, softShadowReads } from "../src/game/shadow-cache.js";

// A light straight down: across its way is the scene's x and z.
const down = { toLight: (x, _y, z) => [x, z], worldFt: 8192, mapSize: 2048 };
/** A cascade 260 ft about (1000, 2000), its copy drawn with change 4: a texel is about a quarter of a foot. */
const near = { serial: 4, radius: 260, x: 1000, z: 2000, lx: 1000, ly: 2000 };
/** A far one, 10 000 ft about the same place: a texel is nearly ten feet. */
const far = { ...near, radius: 10000 };

test("a knocked object draws a cascade's copy again where its shadow, as it stood or as it stands, lies in its circle", () => {
  const moved = (spheres) => [{ serial: 5, spheres }];
  assert.equal(changeReaches(near, moved([[1100, 0, 2050, 3]]), 5, down), true, "inside the circle");
  assert.equal(changeReaches(near, moved([[1500, 0, 2000, 3]]), 5, down), false, "well outside it");
  assert.equal(changeReaches(near, moved([[1500, 0, 2000, 3], [1200, 0, 2000, 3]]), 5, down), true, "it stood outside, it stands inside");
  assert.equal(changeReaches(near, moved([[1262, 0, 2000, 3]]), 5, down), true, "its edge in the circle is enough");
  // The world repeats: an object a world away is the copy beside the cascade.
  assert.equal(changeReaches(near, moved([[1100 + 8192, 0, 2050 - 8192, 3]]), 5, down), true);
});

test("an object too small for a cascade's texels does not draw that cascade's copy again", () => {
  assert.equal(SHOWS_TEXELS, 1.5);
  const stone = [{ serial: 5, spheres: [[1100, 0, 2050, 3]] }];
  assert.equal(changeReaches(near, stone, 5, down), true);
  assert.equal(changeReaches(far, stone, 5, down), false, "6 ft across is under one and a half of the far cascade's 9.8 ft texels");
  const shed = [{ serial: 5, spheres: [[1100, 0, 2050, 12]] }];
  assert.equal(changeReaches(far, shed, 5, down), true);
});

test("a change of unknown place, or changes not all kept, draw every cascade's copy again", () => {
  assert.equal(changeReaches(near, [{ serial: 5, spheres: null }], 5, down), true);
  assert.equal(changeReaches(near, [], 5, down), true);
  assert.equal(changeReaches(near, undefined, 5, down), true);
  // The oldest kept is 7: changes 5 and 6 are gone, so what they were is not known.
  assert.equal(changeReaches(near, [{ serial: 7, spheres: [[5000, 0, 5000, 1]] }], 7, down), true);
  // Only changes after the cascade's own and up to the newest are looked at.
  const changes = [{ serial: 4, spheres: null }, { serial: 5, spheres: [[5000, 0, 5000, 1]] }, { serial: 9, spheres: null }];
  assert.equal(changeReaches(near, changes, 5, down), false);
});

test("what a truck covered is put back in a patch of texels round it, cut to the map", () => {
  // Middle of the map, a radius of 1% of its width: 20.48 texels and two to spare.
  assert.deepEqual(shadowPatch(0.5, 0.5, 0.01, 2048), [1001, 1001, 1047, 1047]);
  assert.deepEqual(shadowPatch(0, 0.5, 0.01, 2048), [0, 1001, 23, 1047], "cut at the edge");
  assert.equal(shadowPatch(1.5, 0.5, 0.01, 2048), null, "off the map");
});

test("patches covering more than a quarter of the map give way to putting back the whole map", () => {
  assert.equal(PATCH_SHARE, 0.25);
  const small = [[0, 0, 100, 100], [200, 200, 300, 300]];
  assert.equal(patchesToRestore(small, 2048), small);
  assert.equal(patchesToRestore([[0, 0, 1100, 1100]], 2048), null);
  assert.deepEqual(patchesToRestore([], 2048), []);
});

test("the cascades draw a copy afresh once a frame at most, put back patches, and ask the card about a copy once", () => {
  assert.equal(REBUILDS_PER_FRAME, 1);
  const shadows = readFileSync(new URL("../src/render/sun-shadows.js", import.meta.url), "utf8");
  // A cascade not yet drawn never waits; one that has waits its turn.
  assert.match(shadows, /if \(this\._caching && !unbuilt && \(stale \|\| serialStale\)\) \{\n\s*if \(rebuilds >= REBUILDS_PER_FRAME\)/);
  assert.match(shadows, /this\._blit\(this\._cache\[i\], light\.shadow\.map, this\._drawn\[i\]\)/);
  assert.match(shadows, /const check = !this\._blitChecked;/);
  // Knocked objects say where they were and are (render/track-scene.js).
  const scene = readFileSync(new URL("../src/render/track-scene.js", import.meta.url), "utf8");
  assert.match(scene, /if \(touched\.size\) bumpShadowStatic\(world, spheres\);/);
});

/** A square map of depths, `size` texels a side, from a seeded generator: patches and sharp edges, as shadows have. */
function depthMap(size, seed) {
  let s = seed;
  const random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const map = new Float64Array(size * size);
  for (let i = 0; i < map.length; i++) map[i] = random() < 0.5 ? 0.2 + 0.1 * random() : 0.7 + 0.2 * random();
  return { size, map };
}

/** The depth test at texel (x, y), the map's edge repeated past it, as three.js's: lit where the depth is not nearer. */
function compare({ size, map }, x, y, z) {
  const cx = Math.min(size - 1, Math.max(0, x)), cy = Math.min(size - 1, Math.max(0, y));
  return map[cy * size + cx] >= z ? 1 : 0;
}

const mix = (a, b, f) => a * (1 - f) + b * f;

/** three.js r169's PCFSoftShadowMap at (u, v), 0 to 1 across the map, written out as its shader writes it. */
function threeSoft(depths, u, v, z) {
  const { size } = depths;
  const fx = (u * size + 0.5) % 1, fy = (v * size + 0.5) % 1;
  // The texel whose middle the shader moves the point to: the one below and left of it.
  const x = Math.floor(u * size + 0.5) - 1, y = Math.floor(v * size + 0.5) - 1;
  const c = (i, j) => compare(depths, x + i, y + j, z);
  return (c(0, 0) + c(1, 0) + c(0, 1) + c(1, 1)
    + mix(c(-1, 0), c(2, 0), fx) + mix(c(-1, 1), c(2, 1), fx)
    + mix(c(0, -1), c(0, 2), fy) + mix(c(1, -1), c(1, 2), fy)
    + mix(mix(c(-1, -1), c(2, -1), fx), mix(c(-1, 2), c(2, 2), fx), fy)) / 9;
}

/** A graphics card's compared bilinear read at (x, y) in texels: the four tests about the point, weighed by where it lies. */
function cardRead(depths, x, y, z) {
  const i = Math.floor(x - 0.5), j = Math.floor(y - 0.5), fx = x - 0.5 - i, fy = y - 0.5 - j;
  return mix(mix(compare(depths, i, j, z), compare(depths, i + 1, j, z), fx), mix(compare(depths, i, j + 1, z), compare(depths, i + 1, j + 1, z), fx), fy);
}

function fourReads(depths, u, v, z) {
  const { size } = depths;
  let sum = 0;
  for (const across of softShadowReads(u * size)) {
    for (const down of softShadowReads(v * size)) sum += across.weight * down.weight * cardRead(depths, across.at, down.at, z);
  }
  return sum;
}

test("four compared bilinear reads give three.js's sixteen-tap soft shadow, at every point and by the map's edge", () => {
  for (const seed of [1, 7, 42]) {
    const depths = depthMap(16, seed);
    let s = seed * 31;
    const random = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 2 ** 32; };
    for (let n = 0; n < 4000; n++) {
      // Points over the whole map, its edges among them, and depths between the near and far patches.
      const u = random() * 1.1 - 0.05, v = random() * 1.1 - 0.05, z = 0.25 + random() * 0.6;
      const want = threeSoft(depths, u, v, z), got = fourReads(depths, u, v, z);
      assert.ok(Math.abs(want - got) < 1e-9, `seed ${seed} at (${u}, ${v}) depth ${z}: ${got} for ${want}`);
    }
  }
});

test("each axis's two reads lie between their pair of texels and weigh three texels' worth", () => {
  for (const t of [0, 0.25, 0.5, 0.75, 0.999, 5.5, 5.51, 1023.49]) {
    const [first, second] = softShadowReads(t);
    const n = Math.floor(t + 0.5);
    assert.ok(Math.abs(first.weight + second.weight - 1) < 1e-12);
    // The first between texels n - 2 and n - 1, the second between n and n + 1 (middles at k + 0.5).
    assert.ok(first.at >= n - 1.5 && first.at <= n - 0.5, `${t}: ${first.at}`);
    assert.ok(second.at >= n + 0.5 && second.at <= n + 1.5, `${t}: ${second.at}`);
  }
});

test("the cascades' maps keep a depth the card compares, read four times in the first cascade and once past it", () => {
  const shadows = readFileSync(new URL("../src/render/sun-shadows.js", import.meta.url), "utf8");
  assert.match(shadows, /compareFunction = THREE\.LessEqualCompare/);
  assert.match(shadows, /uniform sampler2DShadow mtmShadowDepth\[ NUM_DIR_LIGHT_SHADOWS \];/);
  const from = shadows.indexOf("if ( soft ) {"), to = shadows.indexOf("} else {", from), done = shadows.indexOf("}", to + 8);
  assert.ok(from > 0 && to > from && done > to);
  const soft = shadows.slice(from, to), firm = shadows.slice(to, done);
  // The soft shadow places its four reads as softShadowReads does.
  assert.match(soft, /vec2 first = 2\.0 - f, second = 1\.0 \+ f;/);
  assert.match(soft, /vec2 a = \( n - 1\.5 \+ 1\.0 \/ first \) \/ size, b = \( n \+ 0\.5 \+ f \/ second \) \/ size;/);
  assert.equal((soft.match(/texture\( map, vec3\(/g) ?? []).length, 4);
  // Past it, one read, the card weighing the four texels about the point.
  assert.equal((firm.match(/texture\(/g) ?? []).length, 1);
  assert.match(firm, /shadow = texture\( map, coord\.xyz \);/);
  // Soft in the first cascade only, known when the shader is built: three.js writes CSM's loop out once per cascade,
  // UNROLLED_LOOP_INDEX becoming its number, so no pixel tests which cascade it is in.
  assert.match(shadows, /vDirectionalShadowCoord\[ i \], UNROLLED_LOOP_INDEX \)";/);
  const compared = shadows.match(/^#define MTM_CASCADE_SHADOW\( packed, compared, caster, coord, nth \) .*mtmShadowCompared\(.*$/gm) ?? [];
  assert.equal(compared.length, 2);
  for (const line of compared) assert.match(line, /, coord, \( nth \) == 0 \)/);
});
