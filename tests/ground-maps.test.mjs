/*
  The ground map and the puddle map (docs/VISUALS.md, "Rain"): rain stands where the ground
  has a low point, and nowhere else. The cover and shelter maps ("Under cover"): under a bridge
  neither rain nor snow falls.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  COURSE_PUDDLES, COVER_CLEAR_FT, COVER_MIN_WIDTH_FT, NO_COVER_FT, PUDDLE_RANGE_FT, PUDDLE_WATERLINE,
  basinDepthFt, buildCoverMap, buildGroundMap, buildPuddleMap, buildShelterMap, drivenMap, holdAt, potholeFt, puddleDepthAt, shelterAt, unevennessFt,
} from "../src/game/ground-maps.js";

// The real map's size: the unevenness that seeds the puddles is finer than a coarser map could show.
const SIDE = 1024, STEP = 8192 / SIDE;
const mapOf = (heightAt) => buildGroundMap(heightAt, SIDE);
const at = (x, z) => Math.floor(z / STEP) * SIDE + Math.floor(x / STEP);
const wet = (byte) => byte > PUDDLE_WATERLINE;
/** The share of samples under water in a square of the map. */
function wetShare(puddles, x0, z0, x1, z1) {
  let under = 0, all = 0;
  for (let z = z0; z < z1; z += STEP) for (let x = x0; x < x1; x += STEP) { all++; if (wet(puddles[at(x, z)])) under++; }
  return under / all;
}

test("the ground map samples the middle of each square", () => {
  const map = buildGroundMap((x, z) => x + 10 * z, 4);
  assert.equal(map.length, 16);
  assert.equal(map[0], 1024 + 10 * 1024);
  assert.equal(map[1 * 4 + 2], 5120 + 10 * 3072);
});

test("a hollow gathers a pond at its foot; the slopes around it hold nothing", () => {
  // A bowl 600 ft across and 40 ft deep in a plain, its floor nearly level.
  const bowl = (x, z) => 100 - 40 * Math.max(0, 1 - (Math.hypot(x - 4000, z - 4000) / 300) ** 2);
  const puddles = buildPuddleMap(mapOf(bowl));
  // At the foot of the bowl stands a pond, some forty feet across and deeper than a dimple on a flat ever is.
  let pond = 0, deepest = 0;
  for (let z = 3900; z < 4100; z += STEP) {
    for (let x = 3900; x < 4100; x += STEP) {
      if (wet(puddles[at(x, z)])) pond += STEP * STEP;
      deepest = Math.max(deepest, puddles[at(x, z)]);
    }
  }
  assert.ok(pond > 600 && pond < 4000, `the pond covers ${pond} square feet`);
  assert.ok(deepest > 190, `two inches or so at its deepest: ${deepest}`);
  // Half way up its side, ground that slopes at one in five.
  let onSlope = 0;
  for (let a = 0; a < 64; a++) onSlope += wet(puddles[at(4000 + Math.cos(a) * 200, 4000 + Math.sin(a) * 200)]) ? 1 : 0;
  assert.equal(onSlope, 0);
});

test("a steady slope holds no water at all", () => {
  // One in ten along x, rising to a ridge and falling again so the world still wraps.
  const ridge = (x) => 60 + 0.1 * (4096 - Math.abs(x - 4096));
  const puddles = buildPuddleMap(mapOf(ridge));
  assert.equal(wetShare(puddles, 600, 0, 3400, 8192), 0);
  assert.equal(wetShare(puddles, 4800, 0, 7600, 8192), 0);
});

test("level ground has puddles here and there, never a sheet of water", () => {
  const puddles = buildPuddleMap(mapOf(() => 50));
  const share = wetShare(puddles, 0, 0, 8192, 8192);
  assert.ok(share > 0.02 && share < 0.14, `wet share ${share}`);
  // Shallow: an inch or two at the most, not a pond.
  let deepest = 0;
  for (const byte of puddles) if (byte > deepest) deepest = byte;
  const deepestFt = ((deepest - PUDDLE_WATERLINE) / 127) * PUDDLE_RANGE_FT;
  assert.ok(deepestFt > 0.02 && deepestFt < 0.22, `deepest ${deepestFt} ft`);
  // In patches a few hundred feet across: the wettest tenth of the ground holds several times what the driest does.
  const shares = [];
  for (let z = 0; z < 8192; z += 256) for (let x = 0; x < 8192; x += 256) shares.push(wetShare(puddles, x, z, x + 256, z + 256));
  shares.sort((a, b) => a - b);
  const tenth = shares[Math.floor(shares.length * 0.1)], ninth = shares[Math.floor(shares.length * 0.9)];
  assert.ok(ninth > 0.07 && ninth > 3 * tenth, `${tenth} to ${ninth}`);
});

test("puddles are small: a few strides across, and none a pond, on level ground", () => {
  const puddles = buildPuddleMap(mapOf(() => 50));
  // Each connected stretch of water, in samples of 64 square feet.
  const seen = new Uint8Array(puddles.length), sizes = [];
  for (let start = 0; start < puddles.length; start++) {
    if (!wet(puddles[start]) || seen[start]) continue;
    let count = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % SIDE, y = (k - x) / SIDE;
      count++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = ((y + dy + SIDE) % SIDE) * SIDE + ((x + dx + SIDE) % SIDE);
        if (wet(puddles[j]) && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    sizes.push(Math.sqrt(count * STEP * STEP));
  }
  sizes.sort((a, b) => a - b);
  assert.ok(sizes.length > 2000, `${sizes.length} puddles`);
  assert.ok(sizes[Math.floor(sizes.length * 0.9)] < 30, `nine in ten under 30 ft across: ${sizes[Math.floor(sizes.length * 0.9)]}`);
  assert.ok(sizes.at(-1) < 130, `the largest: ${sizes.at(-1)} ft`);
});

test("ground under the level's water holds no puddle, and the shore drains into it", () => {
  // A lake in a wide basin: the water stands at 40 ft.
  const basin = (x, z) => 20 + Math.hypot(x - 4000, z - 4000) * 0.05;
  const puddles = buildPuddleMap(mapOf(basin), { waterLevelFt: 40 });
  // Under the water (within 400 ft of the middle): no puddle, the byte is 0.
  for (let z = 3800; z < 4200; z += STEP) for (let x = 3800; x < 4200; x += STEP) assert.equal(puddles[at(x, z)], 0);
  // The slope above the shore runs off into the lake.
  let shore = 0;
  for (let a = 0; a < 64; a++) shore += wet(puddles[at(4000 + Math.cos(a) * 700, 4000 + Math.sin(a) * 700)]) ? 1 : 0;
  assert.equal(shore, 0);
});

test("a basin holds more the more ground drains into it", () => {
  assert.ok(Math.abs(basinDepthFt(100) - 0.049) < 1e-12, "a dimple where the ground holds water well: over half an inch");
  assert.ok(basinDepthFt(100, 0) < basinDepthFt(100, 1), "less where the ground does not hold it");
  assert.equal(basinDepthFt(30000), basinDepthFt(100), "a dimple's own ground adds nothing");
  assert.ok(basinDepthFt(60000) < basinDepthFt(250000));
  assert.equal(basinDepthFt(1e12), 0.8);
});

test("the unevenness is inches, repeats with the world and is the same every time", () => {
  let most = 0;
  for (let i = 0; i < 2000; i++) {
    most = Math.max(most, Math.abs(unevennessFt(i * 37.7, i * 91.3)));
    const hold = holdAt(i * 37.7, i * 91.3);
    assert.ok(hold >= 0 && hold <= 1);
  }
  assert.ok(most > 0.1 && most < 0.4, `most ${most}`);
  assert.equal(unevennessFt(100, 200), unevennessFt(100 + 8192, 200 - 8192));
  const flat = buildGroundMap(() => 50, 256);
  assert.deepEqual(buildPuddleMap(flat), buildPuddleMap(flat));
});

/** A course of one straight along z = 4096 from x = 1000 to 7000, 32 ft wide, over ground of height `heightAt`. */
const straightCourse = (heightAt) => [[{ startFt: [1000, heightAt(1000, 4096), 4096], endFt: [7000, heightAt(7000, 4096), 4096], trackWidthFt: 32 }]];
/** Depth under the waterline (feet; negative over it) of each sample in the band `fromFt` to `toFt` off the straight. */
function band(puddles, fromFt, toFt) {
  const depths = [];
  for (let x = 1200; x < 6800; x += STEP) {
    for (let off = fromFt; off < toFt; off += STEP) {
      for (const side of [-1, 1]) depths.push(((puddles[at(x, 4096 + side * off)] - PUDDLE_WATERLINE) / 127) * PUDDLE_RANGE_FT);
    }
  }
  return depths;
}

test("the driven line holds the deepest puddles: the trucks have churned it into potholes and packed it", () => {
  const level = () => 50;
  const plain = buildPuddleMap(mapOf(level)), raced = buildPuddleMap(mapOf(level), { courses: straightCourse(level) });
  const on = band(raced, 0, 16), before = band(plain, 0, 16);
  const share = (depths, least = 0) => depths.filter((d) => d > least).length / depths.length;
  // Where a wheel counts as standing in a puddle (game/particles.js `PUDDLE_FOOTING_FT`, 0.03 ft): a fifth to a half of
  // the driven line on level ground, against a few in a hundred before.
  assert.ok(share(on, 0.03) > 0.2 && share(on, 0.03) < 0.5, `driven line: ${share(on, 0.03)}`);
  assert.ok(share(before, 0.03) < 0.05, `the same ground without the course: ${share(before, 0.03)}`);
  // An inch or two at the middle of a puddle, three inches at the most.
  const wet = on.filter((d) => d > 0).sort((a, b) => a - b);
  const middle = wet[wet.length >> 1];
  assert.ok(middle > 0.05 && middle < 0.15, `middle ${middle}`);
  assert.ok(wet.at(-1) > 0.2, `deepest ${wet.at(-1)}`);
  // Puddles one after another along the line, each some ten to forty feet long.
  let runs = 0, inRun = false, wetFt = 0;
  for (let x = 1200; x < 6800; x += 2) {
    const d = puddleDepthAt({ depth: raced, side: SIDE }, x, 4096);
    if (d > 0.03) { wetFt += 2; if (!inRun) runs++; inRun = true; } else inRun = false;
  }
  assert.ok(runs > 40, `${runs} puddles in 5600 ft`);
  assert.ok(wetFt / runs > 10 && wetFt / runs < 40, `${wetFt / runs} ft long`);
  // A pool on the course that fills past a low saddle runs over into the ground beside it; well off the course the
  // ground is as it was.
  const far = (map) => band(map, 150, 600);
  assert.deepEqual(far(raced), far(plain));
});

test("a course that slopes holds no more water than any slope does", () => {
  // One in twenty along the course, rising to a ridge and falling again so the world still wraps.
  const ridge = (x) => 60 + 0.05 * (4096 - Math.abs(x - 4096));
  const puddles = buildPuddleMap(mapOf(ridge), { courses: straightCourse(ridge) });
  assert.ok(band(puddles, 0, 16).filter((d) => d > 0).length === 0);
});

test("the driven line is a course's width and a little more, fading out beyond, and the turns between straights are driven too", () => {
  const { edgeFt, blendFt } = COURSE_PUDDLES;
  // Two straights at right angles, joined by the line from one's end to the other's start (and back).
  const course = [{ startFt: [1000, 0, 1000], endFt: [3000, 0, 1000], trackWidthFt: 32 }, { startFt: [3100, 0, 1100], endFt: [3100, 0, 3000], trackWidthFt: 32 }];
  const driven = drivenMap([course], SIDE);
  const near = (x, z) => driven[at(x, z)];
  assert.equal(near(2000, 1000), 1);
  assert.equal(near(2000, 1000 + 16 + edgeFt - STEP), 1);
  assert.equal(near(2000, 1000 + 16 + edgeFt + blendFt + STEP), 0);
  const fading = near(2000, 1000 + 16 + edgeFt + blendFt / 2);
  assert.ok(fading > 0.2 && fading < 0.8, `fading ${fading}`);
  // The turn from the first straight's end to the second's start.
  assert.equal(near(3050, 1050), 1);
  assert.equal(near(5000, 5000), 0);
  // No course, nothing driven: the map is as it was.
  const flat = buildGroundMap(() => 50, 256);
  assert.deepEqual(buildPuddleMap(flat, { courses: [] }), buildPuddleMap(flat));
});

test("potholes are inches deep, cover about half the driven ground and repeat with the world", () => {
  let holed = 0, most = 0;
  for (let i = 0; i < 4000; i++) {
    const depth = potholeFt(i * 37.7, i * 91.3);
    assert.ok(depth >= 0 && depth <= COURSE_PUDDLES.potholeFt);
    if (depth > 0) holed++;
    most = Math.max(most, depth);
  }
  assert.ok(holed / 4000 > 0.3 && holed / 4000 < 0.7, `holed ${holed / 4000}`);
  assert.ok(most > 0.8 * COURSE_PUDDLES.potholeFt);
  assert.ok(COURSE_PUDDLES.potholeFt >= 0.2 && COURSE_PUDDLES.potholeFt <= 0.4);
  assert.equal(potholeFt(100, 200), potholeFt(100 + 8192, 200 - 8192));
});

test("a stadium's edge drains away", () => {
  const puddles = buildPuddleMap(buildGroundMap(() => 50, 256), { wraps: false });
  for (let i = 0; i < 256; i++) assert.equal(puddles[i], 0);
});

test("the cover map holds the highest thing over each sample, and never misses one between samples", () => {
  // A sloping triangle from (100, 30) to (300, 30) to (100, 230), 40 ft up at its first corner and 70 at the others; the scene's z is the game's mirrored.
  const shape = { positions: new Float32Array([100, 40, -30, 300, 70, -30, 100, 70, -230]) };
  const cover = buildCoverMap([shape], SIDE);
  assert.equal(cover[at(150, 80)], 70, "a triangle's highest point");
  assert.equal(cover[at(1000, 1000)], NO_COVER_FT);
  // The sample whose square the corner only clips is under it too.
  assert.equal(cover[at(97, 27)], 70);
  // Placed by a matrix (moved 1000 ft along x), and under two things, the higher.
  const moved = { ...shape, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1000, 0, 0, 1] };
  const roof = { positions: new Float32Array([1100, 90, -60, 1200, 90, -60, 1100, 90, -160]) };
  const both = buildCoverMap([moved, roof], SIDE);
  assert.equal(both[at(1150, 80)], 90);
  assert.equal(both[at(1250, 50)], 70);
  // A triangle on edge as seen from above covers nothing.
  assert.ok(buildCoverMap([{ positions: new Float32Array([0, 0, -10, 0, 50, -10, 0, 50, -200]) }], SIDE).every((v) => v === NO_COVER_FT));
  // Too narrow a thing shelters nothing (worker/track-build.js leaves it out): a pole, a sign, a gantry's bar.
  assert.ok(COVER_MIN_WIDTH_FT > 8 && COVER_MIN_WIDTH_FT < 20);
});

test("ground lies under cover where something stands clear over it, with a soft edge; null where nothing does", () => {
  const ground = (x) => (x < 2000 ? 20 : 100);
  // A deck at 60 ft: 40 ft over the ground to the west, buried in the hill to the east.
  const deck = { positions: new Float32Array([1600, 60, -1600, 2400, 60, -1600, 2400, 60, -2400, 1600, 60, -2400]), indices: [0, 1, 2, 0, 2, 3] };
  const shelter = buildShelterMap(buildCoverMap([deck], SIDE), ground, SIDE);
  assert.equal(shelterAt(shelter, 1800, 2000, SIDE), 1);
  assert.equal(shelterAt(shelter, 2200, 2000, SIDE), 0, "a thing in the ground is no roof");
  assert.equal(shelterAt(shelter, 1000, 1000, SIDE), 0);
  // At the deck's edge, part: rain and snow blow in a little under it.
  const edge = shelterAt(shelter, 1600, 2000, SIDE);
  assert.ok(edge > 0.2 && edge < 0.8, `edge ${edge}`);
  // Something under the clearance stands on the ground: no shelter anywhere, and no map.
  const low = { ...deck, positions: deck.positions.map((v, i) => (i % 3 === 1 ? 20 + COVER_CLEAR_FT - 1 : v)) };
  assert.equal(buildShelterMap(buildCoverMap([low], SIDE), ground, SIDE), null);
  assert.equal(shelterAt(null, 0, 0), 0);
});

test("how deep a puddle is where a wheel stands is read off the puddle map as the ground's shader reads it", () => {
  // A map four samples square, 2048 ft apart: one sample a full puddle (255), one dry ground over its pool (0), the rest at the waterline.
  const side = 4, depth = new Uint8Array(side * side).fill(PUDDLE_WATERLINE);
  depth[1 * side + 1] = 255;
  depth[2 * side + 2] = 0;
  const puddles = { depth, side }, step = 8192 / side;
  // At a sample's middle, the sample.
  assert.ok(Math.abs(puddleDepthAt(puddles, 1.5 * step, 1.5 * step) - PUDDLE_RANGE_FT) < 1e-9);
  assert.ok(Math.abs(puddleDepthAt(puddles, 2.5 * step, 2.5 * step) + (128 / 127) * PUDDLE_RANGE_FT) < 1e-9);
  assert.equal(puddleDepthAt(puddles, 0.5 * step, 3.5 * step), 0);
  // Half way between the puddle and the waterline, half as deep; and the map repeats with the world.
  assert.ok(Math.abs(puddleDepthAt(puddles, 2 * step, 1.5 * step) - PUDDLE_RANGE_FT / 2) < 1e-9);
  assert.equal(puddleDepthAt(puddles, 1.5 * step + 8192, 1.5 * step - 8192), puddleDepthAt(puddles, 1.5 * step, 1.5 * step));
  // No map, no puddle.
  assert.ok(puddleDepthAt(null, 0, 0) < 0);
});
