/*
  The water as a body of water (docs/VISUALS.md, "Water" and "Under water"), with "Reflective
  water": light passes through its depth, and what it sends back is the daylight in it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SNELL_WINDOW, UNDERWATER, WATER_BED, WATER_GLINT, WATER_INDEX, WATER_REFLECTION, WATER_RIPPLES, WATER_SCATTER, WATER_SILT, WATER_TAKES, WHEEL_CHURN, landingStir, waterHides, waterPasses, waterPathFt,
  PUDDLE_FILL_DROP_FT, PUDDLE_PARTING, foamAfter, highestGround, landTones, puddleStir, reflectionRow, reflectionSine, rippleQuietS, waveAfter, waveSpeed, wheelStir,
  UNDERWATER_LOOK, lightAtDepth, sunUnderWater,
} from "../src/game/water.js";
import { SUBMERGED_FT } from "../src/game/particles.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test("water takes the red out of light first and the blue last", () => {
  assert.ok(WATER_TAKES[0] > WATER_TAKES[1] && WATER_TAKES[1] > WATER_TAKES[2]);
  const [r, g, b] = waterPasses(4);
  assert.ok(r < g && g < b);
  assert.deepEqual(waterPasses(0), [1, 1, 1]);
  assert.deepEqual(waterPasses(-3), [1, 1, 1]);
  near(waterPasses(1)[0], Math.exp(-WATER_TAKES[0]));
});

test("a little water shows what is under it, a truck's depth mostly hides it, deep water hides it all", () => {
  assert.equal(waterHides(0), 0);
  assert.ok(waterHides(1) < 0.2, `a foot: ${waterHides(1)}`);
  assert.ok(waterHides(6) > 0.5, `a truck's depth: ${waterHides(6)}`);
  assert.ok(waterHides(30) > 0.95, `deep: ${waterHides(30)}`);
  for (let d = 0; d < 40; d += 0.5) assert.ok(waterHides(d + 0.5) > waterHides(d), `at ${d}`);
});

test("the surface bends a line of sight toward the upright: a glancing look runs through about one and a half times the depth", () => {
  assert.equal(WATER_INDEX, 1.333);
  near(waterPathFt(5, 1), 5);
  const glancing = waterPathFt(5, 0);
  assert.ok(glancing > 7.4 && glancing < 7.6, `glancing ${glancing}`);
  assert.ok(waterPathFt(5, 0.5) > 5 && waterPathFt(5, 0.5) < glancing);
  assert.equal(waterPathFt(-2, 1), 0);
});

test("what water sends back is the daylight in it, in the water's own blue green, and duller when Rain silts it", () => {
  const [r, g, b] = WATER_SCATTER;
  assert.ok(r < g / 5 && g > 0 && b > 0 && Math.max(r, g, b) < 0.2, "dark and blue green: the scene's light scales it");
  // A few hundredths, as lake and coastal water send back: deep water is dark, and what it mirrors shows in it.
  assert.ok(g > 0.02 && g < 0.06 && b > 0.02 && b < 0.06, `${g} ${b}`);
  assert.ok(WATER_SILT > 0 && WATER_SILT < 1);
});

test("the sun's glint is held to a few times the sun's own light, and the eye's slant to the water to no flatter than a set sine", () => {
  assert.ok(WATER_GLINT.most > 1 && WATER_GLINT.most < 4);
  assert.ok(WATER_GLINT.grazing > 0 && WATER_GLINT.grazing < 0.3);
});

test("the land in the water is a map of directions from the eye under the water, finest at the horizon", () => {
  for (const sine of [0, 0.001, 0.02, 0.3, 1]) assert.ok(Math.abs(reflectionSine(reflectionRow(sine)) - sine) < 1e-12);
  assert.equal(reflectionRow(-1), 0);
  assert.equal(reflectionRow(2), 1);
  // Within five degrees of the horizon, where the land in the water lies, a quarter of the rows or more.
  assert.ok(reflectionRow(Math.sin((5 * Math.PI) / 180)) > 0.25);
  const { columns, rows, cellFt, levels, reads } = WATER_REFLECTION;
  assert.ok(columns >= 512 && rows >= 64 && columns * rows <= 256 * 1024, "the same size on any screen, and small");
  assert.equal(cellFt, 32);
  assert.ok(levels >= 3 && reads >= 32);
});

test("the highest ground in a cell is over every point of the ground in it, at each size of cell", () => {
  const side = 64, heights = new Float32Array(side * side);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) heights[j * side + i] = 40 * Math.sin(i * 0.31) * Math.cos(j * 0.17) + (i === 9 && j === 50 ? 300 : 0);
  // A world 8192 ft across, a sample every 128 ft: cells of 512 ft hold four samples a side.
  const { levels, sides, topFt } = highestGround(heights, side, { worldFt: 8192, cellFt: 512, levels: 8 });
  assert.deepEqual(sides, [16, 8, 4, 2, 1]);
  assert.equal(topFt, Math.max(...heights));
  levels.forEach((cells, level) => {
    const n = sides[level], per = side / n;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        // A sample, and the cells whose ground it shapes: its own, and one next to it when it lies on the cell's edge.
        for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ci = (Math.floor((i + di + side) % side / per)), cj = (Math.floor((j + dj + side) % side / per));
          assert.ok(cells[cj * n + ci] >= heights[j * side + i], `level ${level} cell ${ci},${cj} under the sample at ${i},${j}`);
        }
      }
    }
  });
  // A wider cell is as high as the highest of the four in it.
  for (let level = 1; level < levels.length; level++) {
    const n = sides[level];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const under = levels[level - 1], m = sides[level - 1];
      assert.equal(levels[level][j * n + i], Math.max(under[2 * j * m + 2 * i], under[2 * j * m + 2 * i + 1], under[(2 * j + 1) * m + 2 * i], under[(2 * j + 1) * m + 2 * i + 1]));
    }
  }
  // A level drawn once has no samples past its edges: its corner cell is the highest of its own and its row inward.
  const once = highestGround(heights, side, { worldFt: 8192, cellFt: 512, levels: 1, wraps: false });
  let most = -Infinity;
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) most = Math.max(most, heights[j * side + i]);
  assert.equal(once.levels[0][0], most);
});

test("the land in the water takes each cell's colour from the texture it wears, by the low twelve bits of its word", () => {
  const clr = new Uint16Array(4);
  clr[0] = 0x1001; clr[1] = 0; clr[2] = 7; clr[3] = 1;
  const tones = [[0, 0, 0], [1, 0.5, 0.2]];
  const out = landTones(clr, tones, [0.2, 0.2, 0.2], 2);
  assert.deepEqual([...out.slice(0, 4)], [255, 188, 124, 255], "slot 1, its flags dropped, as sRGB bytes");
  assert.deepEqual([...out.slice(4, 8)], [0, 0, 0, 255]);
  assert.deepEqual([...out.slice(8, 11)], [124, 124, 124], "no such texture: the fallback");
  assert.deepEqual([...landTones(null, null, [1, 1, 1], 2).slice(0, 3)], [255, 255, 255]);
});

test("from under water the sky is seen through a window of 48.6 degrees about straight up", () => {
  near(Math.acos(SNELL_WINDOW), Math.asin(1 / WATER_INDEX));
  assert.ok(Math.abs((Math.asin(1 / WATER_INDEX) * 180) / Math.PI - 48.6) < 0.05);
});

test("under water the eye sees less far than the game's own fog, and daylight has lost its red; the picture does not sway", () => {
  // The game's underwater fog ends at 320 ft (game/weather.js); the port's water is murkier.
  assert.ok(UNDERWATER.sightFt > 100 && UNDERWATER.sightFt < 320);
  assert.equal(UNDERWATER.sway, undefined);
  const [r, g, b] = UNDERWATER.tint;
  assert.ok(r < g && r < b && Math.max(r, g, b) <= 1);
  assert.ok(UNDERWATER.corners > 0 && UNDERWATER.corners < 1);
});

test("light dances on a shallow bed, and the shore just over the water is wet", () => {
  assert.ok(WATER_BED.caustics > 0 && WATER_BED.caustics <= 0.5 && WATER_BED.causticsToFt > 3);
  assert.ok(WATER_BED.wetShoreFt > 0 && WATER_BED.wetShoreFt < 2 && WATER_BED.wetShore > 0 && WATER_BED.wetShore < 0.5);
});

test("waves on the water run as on shallow water, slower in the shallows, and the field keeps them steady", () => {
  // sqrt(g d): a foot of water runs them at under 6 ft/s; deep water at the fastest.
  near(waveSpeed(1), Math.sqrt(32.17));
  assert.equal(waveSpeed(0), 0);
  assert.equal(waveSpeed(-3), 0);
  assert.equal(waveSpeed(100), WATER_RIPPLES.fastestFtPerS);
  // A wave crosses less than a point of the field in a step, as the wave equation needs to stay steady (under 1 / sqrt 2).
  assert.ok((WATER_RIPPLES.fastestFtPerS * WATER_RIPPLES.stepS) / WATER_RIPPLES.texelFt < Math.SQRT1_2);
  // A truck at speed outruns them, so its wake is a V behind it.
  assert.ok(WATER_RIPPLES.fastestFtPerS < 30);
  // The field is some three hundred feet across round the eye, a point every few inches.
  assert.ok(WATER_RIPPLES.windowTexels * WATER_RIPPLES.texelFt > 250 && WATER_RIPPLES.texelFt <= 1);
});

test("a wheel at the surface pushes the water down, more the faster it goes; one clear of it or deep under it does not", () => {
  const level = 100, r = 2.75;
  const rolling = (hubFt, speedFtS) => wheelStir({ hubFt, radiusFt: r, levelFt: level, speedFtS });
  // Half in the water.
  assert.ok(rolling(level, 0).depthFt > 0.1);
  assert.ok(rolling(level, 40).depthFt > rolling(level, 10).depthFt);
  assert.ok(rolling(level, 200).depthFt <= 0.9);
  // Clear of it, and wholly under it by more than a foot and a half past where a wheel counts as under (SUBMERGED_FT).
  assert.equal(rolling(level + r + 0.5, 40).depthFt, 0);
  assert.equal(rolling(level - r - 2.5, 40).depthFt, 0);
  assert.ok(rolling(level - r - SUBMERGED_FT, 40).depthFt > 0, "just under, it still stirs the surface a little");
  assert.ok(rolling(level - r - SUBMERGED_FT, 40).depthFt < rolling(level, 40).depthFt);
});

test("a turning tire beats the water white, from a walking pace and all it can by about 17 mph, wider than it holds the water down", () => {
  const level = 100, r = 2.75;
  const rolling = (hubFt, speedFtS, treadFtS = speedFtS) => wheelStir({ hubFt, radiusFt: r, levelFt: level, speedFtS, treadFtS });
  assert.equal(rolling(level, WHEEL_CHURN.fromFtS).foam, 0);
  assert.ok(rolling(level, 5).foam > 0 && rolling(level, 5).foam < 0.2, `${rolling(level, 5).foam}`);
  assert.ok(Math.abs(rolling(level, WHEEL_CHURN.fullFtS).foam - 1) < 1e-9);
  assert.ok(WHEEL_CHURN.fullFtS * 3600 / 5280 < 20, "all it can at under 20 mph");
  for (let v = 4; v < 30; v += 2) assert.ok(rolling(level, v + 2).foam >= rolling(level, v).foam);
  // The tread beats it, not the hub: a wheel that turns faster than it moves (one the engine spins in the air, coming
  // down into the water) churns as fast as its tread runs.
  assert.ok(rolling(level, 4, 30).foam > 0.9 && rolling(level, 4, 30).foam > rolling(level, 4).foam);
  assert.ok(rolling(level, 30, 0).foam > 0.9, "and never less than it moves");
  // Over the tire's width and the white water off it: wider than it holds the water down.
  assert.ok(rolling(level, 30).foamFt > rolling(level, 30).radiusFt && rolling(level, 30).foamFt >= r);
  // Clear of the water, or wholly under it, it beats nothing white.
  assert.equal(rolling(level + r + 0.5, 40).foam, 0);
  assert.equal(rolling(level - r - 2.5, 40).foam, 0);
});

test("a wheel in the water stirs the bed's silt up into it, deep under or not, and more the faster it turns", () => {
  const level = 100, r = 2.75;
  const rolling = (hubFt, speedFtS) => wheelStir({ hubFt, radiusFt: r, levelFt: level, speedFtS });
  assert.equal(rolling(level + r + 0.5, 30).silt, 0, "clear of the water");
  assert.ok(rolling(level - r - 6, 30).silt > 0.9, "deep under it");
  assert.ok(rolling(level, 30).silt > 0.9);
  assert.ok(rolling(level, 5).silt < rolling(level, 12).silt);
  assert.equal(rolling(level, 0).silt, 0, "standing still");
});

test("foam fresh and thick collapses within seconds; the thin lace it leaves lingers, and silt settles slower still", () => {
  const { foamCollapseS, foamLingerS, foamThick, siltHalfLifeS } = WATER_RIPPLES;
  assert.ok(foamCollapseS < 2 && foamLingerS > 4 * foamCollapseS && siltHalfLifeS > foamLingerS);
  assert.ok(foamThick[0] < foamThick[1] && foamThick[1] < 1);
  // Thick foam halves as fast as it collapses.
  assert.ok(Math.abs(foamAfter(1, foamCollapseS) - 0.5) < 0.05, `${foamAfter(1, foamCollapseS)}`);
  // Thin lace, as slowly as it lingers.
  assert.ok(Math.abs(foamAfter(0.08, foamLingerS) - 0.04) < 0.002);
  // A wake: white for a second or two, then lace for many more.
  assert.ok(foamAfter(1, 3) < foamThick[1], "no longer thick after three seconds");
  assert.ok(foamAfter(1, 10) > 0.05, "still lace after ten");
});

test("the wave field rests until a wheel stirs it, and again once its waves, foam and silt have run down to nothing", () => {
  const { calmS, foamLingerS, siltHalfLifeS } = WATER_RIPPLES;
  const quiet = rippleQuietS();
  // The slowest to go is the silt, halving every 14 s: eight halvings to under 1/256.
  assert.equal(quiet, siltHalfLifeS * 8);
  assert.ok(quiet >= foamLingerS * 8 && quiet >= calmS * Math.log(3 / 0.001));
  assert.ok(0.5 ** (quiet / siltHalfLifeS) <= 1 / 256, "the silt is under a shade by then");
  assert.ok(foamAfter(1, quiet) < 1 / 256, "and so is the thickest foam");
  assert.ok(3 * Math.exp(-quiet / calmS) < 0.001, "and the highest wave the field holds");
  // A slower silt would rest the field later.
  assert.equal(rippleQuietS({ ...WATER_RIPPLES, siltHalfLifeS: 20 }), 160);
  const ripples = readFileSync(new URL("../src/render/water-ripples.js", import.meta.url), "utf8");
  assert.match(ripples, /let sinceStir = Infinity;/, "none has stirred it at first");
  assert.match(ripples, /sinceStir = stirs\.length \? 0 : sinceStir \+ dt;/);
  assert.match(ripples, /if \(!running\(\) \|\| sinceStir > QUIET_S\) \{ corner = null;/);
  // Its step's shader is built with the rest, ahead of the first wheel that stirs it (render/scenery.js).
  assert.match(ripples, /warm\(\) \{ if \(!corner\) stepOnce\(\); \}/);
  assert.match(readFileSync(new URL("../src/render/scenery.js", import.meta.url), "utf8"), /ripples\?\.warm\(\);/);
});

test("a wheel that comes down into the water throws a ring out from where it struck, the harder the bigger", () => {
  assert.equal(landingStir(3), null);
  assert.ok(landingStir(30).depthFt > landingStir(8).depthFt);
  assert.ok(landingStir(1000).depthFt <= 2.5);
  assert.ok(landingStir(30).foam >= 1 && landingStir(8).foam < 1);
  // It beats the water white wider than a rolling wheel does, and throws up the bed's silt.
  assert.ok(landingStir(30).foamFt > wheelStir({ hubFt: 100, radiusFt: 2.75, levelFt: 100, speedFtS: 30 }).foamFt);
  assert.ok(landingStir(30).silt > 0.9 && landingStir(8).silt < landingStir(30).silt);
});

test("a tire stands on a puddle's bed: it holds the water down to the ground about itself, and the water runs back in", () => {
  // Too shallow to hold a wave: nothing.
  assert.equal(puddleStir({ depthFt: 0.005, speedFtS: 30 }).depthFt, 0);
  // In a puddle deep enough to hold one, the field's first step (three fifths of the way) already bares the bed under the
  // tread, at any speed: the tire stands on the ground, not in the water.
  for (const depthFt of [0.1, 0.2, 0.25]) {
    for (const speedFtS of [0, 10, 30, 90]) {
      const held = puddleStir({ depthFt, speedFtS });
      assert.ok(0.6 * held.depthFt > depthFt, `${depthFt} ft deep at ${speedFtS} ft/s: held ${held.depthFt}`);
    }
  }
  assert.ok(PUDDLE_PARTING.bedShare * 0.6 > 1);
  // About a tire's half width: a monster truck's tire is three and a half to four feet across.
  assert.ok(PUDDLE_PARTING.radiusFt >= 1.5 && PUDDLE_PARTING.radiusFt <= 2.5);
  // The faster, the harder it pushes the water aside, though never more than a lake's wheel does.
  const deep = puddleStir({ depthFt: 0.1, speedFtS: 30 });
  assert.ok(puddleStir({ depthFt: 0.1, speedFtS: 60 }).depthFt >= deep.depthFt);
  assert.ok(puddleStir({ depthFt: 0.1, speedFtS: 0 }).depthFt < deep.depthFt);
  assert.ok(deep.depthFt < wheelStir({ hubFt: 100, radiusFt: 2.75, levelFt: 100, speedFtS: 30 }).depthFt);
  // The stirred water churns only at speed.
  assert.equal(puddleStir({ depthFt: 0.2, speedFtS: 3 }).foam, 0);
  assert.ok(deep.foam > 0.9);
  // A puddle's churned water is drawn as its silt and froth both (render/ground-surface.js): it stirs no silt of its own.
  assert.equal(deep.silt, 0);
  // Its waves run at a puddle's pace: a tenth of a foot of water carries them under two feet a second.
  assert.ok(waveSpeed(0.1) < 2);
  // A puddle still filling stands a tenth of a foot under its full level.
  assert.equal(PUDDLE_FILL_DROP_FT, 0.1);
});

test("shallow water cannot hold a crest higher than it is deep: it breaks, and a trough goes no lower than the bed", () => {
  const { calmS, bareBelow } = WATER_RIPPLES;
  // A crest as high as a puddle is deep breaks down to what such water holds (a wave about four fifths as high, crest to
  // trough, as the water is deep) within a fifth of a second.
  assert.ok(waveAfter(0.15, 0.15, 0.2) < 0.15 * 0.45, `${waveAfter(0.15, 0.15, 0.2)}`);
  assert.ok(waveAfter(0.15, 0.15, 0.2) > 0.15 * 0.3, "and breaks no further than that so soon");
  // A ripple well under the depth lasts as long as on deep water.
  near(waveAfter(0.02, 0.15, 1), 0.02 * Math.exp(-1 / calmS), 1e-4);
  // Deep water: nothing breaks, whatever a truck does to it.
  near(waveAfter(0.9, 8, 1), 0.9 * Math.exp(-1 / calmS), 1e-4);
  // A trough bares the bed and goes no lower; held there, it is not broken as a crest is, and the water running back
  // (the waves themselves) is what fills it.
  assert.equal(waveAfter(-1, 0.15, 1 / 60), -bareBelow * 0.15);
  assert.ok(bareBelow > 1 && bareBelow < 1.5);
  assert.ok(waveAfter(-0.15, 0.15, 0.2) < -0.13);
});

test("under the water the light dims and loses its red with the eye's depth, and the sun comes down in shafts bent toward straight down", () => {
  // At the surface all of it; a few feet down the red is half gone; ten feet down the water about the eye is lit at about
  // half its surface light in green and blue, and hardly at all in red.
  assert.deepEqual(lightAtDepth(0), [1, 1, 1]);
  assert.deepEqual(lightAtDepth(-4), [1, 1, 1]);
  const [r3] = lightAtDepth(3), [r10, g10, b10] = lightAtDepth(10);
  assert.ok(r3 > 0.3 && r3 < 0.6, `red at 3 ft: ${r3}`);
  assert.ok(r10 < 0.15 && g10 > 0.35 && g10 < 0.65 && b10 > g10, `${[r10, g10, b10]}`);
  // The sun overhead comes straight down; at the horizon it is bent to 48.6 degrees from straight down, Snell's window.
  near(sunUnderWater([0, 1, 0])[1], -1);
  const low = sunUnderWater([1, 0, 0]);
  near(Math.hypot(low[0], low[2]), 1 / 1.333, 1e-9);
  near(Math.hypot(...low), 1, 1e-9);
  assert.ok(low[0] < 0, "away from the sun, as its light runs");
  // Motes enough to see the water move past, a fraction of an inch each; shafts each a sliver of the sun's light, fading
  // within a truck's depth or two.
  assert.ok(UNDERWATER_LOOK.motes >= 1000 && UNDERWATER_LOOK.moteFt[1] < 0.15);
  assert.ok(UNDERWATER_LOOK.moteGoneFt <= UNDERWATER_LOOK.moteBoxFt / 2, "they fade before the edge of their box");
  assert.ok(UNDERWATER_LOOK.shaftShare > 0 && UNDERWATER_LOOK.shaftShare < 0.1 && UNDERWATER_LOOK.shaftFadeFt > 8 && UNDERWATER_LOOK.shaftFadeFt < 25);
});
