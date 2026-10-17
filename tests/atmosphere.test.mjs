/*
  The air by weather (docs/VISUALS.md, "Weather"): the fog as a volume, made from the game's own
  fog distances (MONSTER_EXE_ANALYSIS.md section 13), and how the rain and the snow fall.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKDROP_DARK, BACKDROP_DISTANCE_FT, BACKDROP_FOOT, CLEAR_FADE, CLEAR_HALF, FOG_BANKS, FOG_FADE_FROM, FOG_REACH, ICE_SNOW_SHARE, POOL_LOOK, PRECIPITATION, SNOW_SETTLE_SECONDS, SNOW_START, WET,
  FOG_TOP, backdropHides, fogAtHeight, fogBank, fogColumn, fogLight, fogProfile, fogTopLit, fogHides, fogSliceEnd, fogVolume, groundWetness, poolMurk, precipitationOf, puddlesFilled, snowDown, snowSettled,
} from "../src/game/atmosphere.js";
import { WEATHER_LOOK } from "../src/game/weather.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test("the game's fogs hide half at half the game's distance, and nothing comes out of an edge", () => {
  // Foggy ends at 320 ft, Dense Fog at 128, Snow at 512 (section 13). The game's ramp hides half at half that.
  assert.equal(FOG_REACH, 2.5);
  assert.equal(FOG_FADE_FROM, 1.9);
  for (const [weather, endFt] of [[2, 320], [3, 128], [5, 512]]) {
    const volume = fogVolume(weather);
    assert.equal(WEATHER_LOOK[weather].fogEndFt, endFt);
    near(fogHides(volume, endFt / 2), 0.5);
    assert.equal(fogHides(volume, 0), 0);
    // Thinner than the game's ramp at its end.
    assert.ok(fogHides(volume, endFt) > 0.74 && fogHides(volume, endFt) < 0.76);
    // The banks are told apart out to the reach; by there the fog by itself hides nineteen parts in twenty.
    assert.equal(volume.reachFt, endFt * FOG_REACH);
    assert.ok(1 - Math.exp(-volume.densityPerFt * volume.reachFt) > 0.95);
  }
  // Dense Fog and Snow close at the reach, faded in from where the fog by itself already hides nine parts in ten.
  for (const [weather, endFt] of [[3, 128], [5, 512]]) {
    const volume = fogVolume(weather);
    assert.equal(volume.open, false);
    near(volume.fadeStartFt, endFt * FOG_FADE_FROM);
    assert.equal(volume.farFt, volume.reachFt);
    assert.equal(fogHides(volume, volume.farFt), 1);
    assert.ok(1 - Math.exp(-volume.densityPerFt * volume.fadeStartFt) > 0.9);
  }
  // Foggy has a top: from over it the land is seen as far as on a clear day, and the fog along each line of sight hides the rest.
  const foggy = fogVolume(2, { startFt: 2500, endFt: 7000 });
  assert.equal(foggy.open, true);
  assert.equal(foggy.farFt, 7000);
  assert.equal(foggy.fadeStartFt, 7000 * CLEAR_FADE);
  for (const weather of [0, 1, 3, 4, 5]) assert.equal(fogVolume(weather).open, false, `weather ${weather}`);
});

test("Rain's haze ends where the game cuts the view; the dark weathers keep their own darkness", () => {
  // Rain, Dusk, Night and Pitch Black have no fog in the game: the view is cut at 1024 ft.
  const rain = fogVolume(4);
  assert.equal(rain.farFt, 1024);
  near(fogHides(rain, (WEATHER_LOOK[4].fogStartFt + 1024) / 2), 0.5);
  assert.equal(fogHides(rain, 1024), 1);
  for (const weather of [6, 7, 8]) assert.equal(fogVolume(weather), null, `weather ${weather}`);
  assert.equal(fogVolume(99), null);
  assert.equal(fogHides(null, 500), 0);
});

test("a clear day has a haze that gives the distance depth and ends where the picture does", () => {
  const clear = fogVolume(0, { startFt: 2500, endFt: 7000 });
  assert.equal(clear.farFt, 7000);
  // Half is hidden at six tenths of the way, and from half way the ground is faded out: the next copy of the
  // wrapped world, 8192 ft on, is never seen.
  assert.equal(CLEAR_HALF, 0.6);
  assert.equal(CLEAR_FADE, 0.5);
  near(fogHides(clear, 7000 * CLEAR_HALF), 0.5, 1e-9);
  assert.equal(clear.fadeStartFt, 3500);
  assert.equal(fogHides(clear, 7000), 1);
  assert.ok(fogHides(clear, 300) < 0.05, "the trucks around the player stand clear");
  assert.ok(fogHides(clear, 1000) > 0.1 && fogHides(clear, 1000) < 0.2, "a hill a thousand feet off is touched by it");
  assert.ok(fogHides(clear, 2500) > 0.3, "and the far ground is plainly far");
  // A shorter draw distance draws it in.
  assert.equal(fogVolume(0, { startFt: 350, endFt: 900 }).farFt, 900);
  assert.ok(fogVolume(1).skyDepth > clear.skyDepth, "Cloudy veils more of the sky");
  // Under a stadium's roof there is no day's haze: the far stands are as clear as the near ones, give or take.
  const hall = fogVolume(0, { startFt: 2500, endFt: 7000 }, { indoor: true });
  assert.ok(fogHides(hall, 1000) < 0.02 && fogHides(clear, 1000) > fogHides(hall, 1000) * 5);
  assert.equal(hall.farFt, clear.farFt);
  // The haze of a clear day is deep: an eye a few hundred feet up still looks through most of it.
  assert.ok(clear.scaleHeightFt >= 1000 && fogVolume(1).scaleHeightFt >= 1000);
});

test("a track's backdrop: its foot in the haze the ground fades into, the rest clear but in fog proper, Rain and Snow", () => {
  const clear = fogVolume(0, { startFt: 2500, endFt: 7000 });
  assert.ok(BACKDROP_DISTANCE_FT > 8192, "it stands beyond the next copy of the wrapped world");
  // At the horizon the ground's own far fade has closed, and the backdrop's foot is in the same haze.
  assert.equal(backdropHides(clear, 0, 0), 1);
  assert.equal(backdropHides(clear, -0.1, 0), 1);
  // Above its foot, on a clear day (or Cloudy, or a dark weather) it stands clear: the day's haze is the ground's distance.
  for (const weather of [0, 1, 6, 7, 8]) assert.equal(backdropHides(fogVolume(weather), BACKDROP_FOOT * 1.01, weather), 0, `weather ${weather}`);
  // Fog proper, Snow and Rain hide what stands at the horizon; the low fogs let a very high peak through, as they let the sky.
  for (const weather of [2, 3, 4, 5]) assert.ok(backdropHides(fogVolume(weather), 0.05, weather) > 0.99, `weather ${weather}`);
  assert.ok(backdropHides(fogVolume(2), 0.5, 2) < 0.7 && backdropHides(fogVolume(5), 0.5, 5) > 0.85, "Foggy lies low; Snow fills the air");
  assert.equal(backdropHides(null, 0.1), 0);
  // The dark weathers have no fog to do it: their darkness takes the backdrop by a share, all of it in Pitch Black.
  assert.ok(BACKDROP_DARK[6] > 0.4 && BACKDROP_DARK[6] < BACKDROP_DARK[7] && BACKDROP_DARK[7] < 1);
  assert.equal(BACKDROP_DARK[8], 1);
  for (const weather of [0, 1, 2, 3, 4, 5]) assert.equal(BACKDROP_DARK[weather], undefined);
});

test("fog hides more the further off, never less; it lies low, and the weather's haze is deep", () => {
  for (const weather of [0, 1, 2, 3, 4, 5]) {
    const volume = fogVolume(weather);
    let last = 0;
    for (let d = 0; d <= volume.farFt * 1.2; d += volume.farFt / 60) {
      const hidden = fogHides(volume, d);
      assert.ok(hidden >= last - 1e-12 && hidden <= 1, `weather ${weather} at ${d}`);
      last = hidden;
    }
    assert.ok(volume.drift >= 0 && volume.drift <= 1 && volume.skyDepth > 0 && volume.glow >= 0);
  }
  // Foggy is a low layer with a top: a truck a hundred feet over its floor is coming out of it, at two hundred it is clear.
  const foggy = fogVolume(2), dense = fogVolume(3);
  assert.ok(fogAtHeight(foggy, 0) >= 1 && fogAtHeight(foggy, 0) < 1.1, "on its floor, the game's own fog");
  near(fogAtHeight(foggy, foggy.deckFt), 1 + FOG_TOP.cap);
  assert.ok(fogAtHeight(foggy, 100) > 0.05 && fogAtHeight(foggy, 100) < 0.2);
  assert.ok(fogAtHeight(foggy, 200) < 0.025);
  // Dense Fog has no top to come out of: it thins somewhat with height and no more, and is thicker overhead.
  assert.ok(fogAtHeight(dense, 300) > 0.5);
  assert.ok(dense.skyDepth > foggy.skyDepth);
  // Rain and snow fill the air.
  assert.ok(fogVolume(5).scaleHeightFt >= 400 && fogVolume(4).scaleHeightFt > fogVolume(5).scaleHeightFt);
  assert.equal(fogAtHeight(null, 0), 0);
});

test("a line of sight passes all of the fog under the layer's top and less and less of it above", () => {
  // Level: under the top it is all fog, above it thinned by the scale height.
  assert.equal(fogColumn(-10, 0, 100, 40), 100);
  near(fogColumn(20, 0, 100, 40), 100 * Math.exp(-0.5));
  // Climbing or falling, the same as the sum taken in small steps, whichever way the line runs.
  for (const [over, climb] of [[-30, 0.4], [10, 0.2], [60, -0.5], [-5, -0.1]]) {
    let sum = 0;
    for (let d = 0.005; d < 200; d += 0.01) sum += 0.01 * Math.exp(-Math.max(0, over + climb * d) / 40);
    near(fogColumn(over, climb, 200, 40), sum, 1e-3);
    near(fogColumn(over, climb, 200, 40), fogColumn(over + climb * 200, -climb, 200, 40), 1e-9);
  }
});

test("Foggy has a top as a cloud has: thickest just under it, ending over a few feet, with wisps above, heaped in billows", () => {
  const foggy = fogVolume(2);
  assert.equal(foggy.shape.cap, FOG_TOP.cap);
  // Thicker just under the top than in the deck, and as thick as the deck again a few tens of feet down.
  assert.ok(fogProfile(-1, foggy.shape, 40) > 2 && fogProfile(-45, foggy.shape, 40) < 1.1);
  // It ends over ten feet or so; a fifth of it lingers above as wisps, which thin by the weather's scale height.
  assert.ok(fogProfile(20, foggy.shape, 40) < 0.4 * fogProfile(0, foggy.shape, 40));
  near(fogProfile(400, foggy.shape, 40) / fogProfile(440, foggy.shape, 40), Math.E, 1e-6);
  // The top is heaped in billows a few tens of feet high and a few hundred across.
  assert.ok(foggy.billowFt >= 20 && foggy.billowFt <= 50 && foggy.billowSizeFt > 100 && foggy.billowSizeFt < 600);
  // No other weather has a top: theirs is the old layer, full below its deck, thinning by the scale height.
  for (const weather of [0, 1, 3, 4, 5]) {
    const volume = fogVolume(weather);
    assert.equal(volume.billowFt, 0);
    near(fogProfile(100, volume.shape, volume.scaleHeightFt), Math.exp(-100 / volume.scaleHeightFt));
    assert.equal(fogProfile(-10, volume.shape, volume.scaleHeightFt), 1);
    assert.equal(volume.lit, 0);
  }
  // The column sums the same shape, whichever way the line runs.
  for (const [over, climb] of [[-30, 0.4], [10, 0.2], [60, -0.5], [-5, -0.1], [-60, 0.05]]) {
    let sum = 0;
    for (let d = 0.005; d < 200; d += 0.01) sum += 0.01 * fogProfile(over + climb * d, foggy.shape, 40);
    near(fogColumn(over, climb, 200, foggy.shape), sum, 2e-3);
    near(fogColumn(over, climb, 200, foggy.shape), fogColumn(over + climb * 200, -climb, 200, foggy.shape), 1e-9);
  }
});

test("Foggy's top is lit by the day: brighter than the fog inside it, and the deeper in, the more the fog's own colour", () => {
  const foggy = fogVolume(2);
  const lit = fogTopLit(foggy, 0.6);
  assert.ok(lit > 0.5 && lit < FOG_TOP.lit, `under Foggy's sun: ${lit}`);
  assert.ok(fogTopLit(foggy, 1) > lit && fogTopLit(foggy, 0) > 0, "brighter in a stronger sun, and lit by the sky without one");
  assert.equal(fogTopLit(fogVolume(3), 0.6), 0);
  near(fogLight(10, lit), 1 + lit);
  near(fogLight(0, lit), 1 + lit);
  assert.ok(fogLight(-20, lit) < 1 + lit && fogLight(-20, lit) > 1);
  assert.ok(fogLight(-200, lit) < 1.01, "deep in its deck it is the game's own fog colour");
});

test("the fog's banks stand in the world: the line of sight is cut in slices, shortest near the eye, each as thick as the banks are there", () => {
  // Five slices on the flat screen, two in a headset; they end by the square of their number, the last at the fog's reach.
  assert.equal(FOG_BANKS.slices, 5);
  assert.equal(FOG_BANKS.liteSlices, 2);
  const reach = fogVolume(2).reachFt;
  assert.equal(reach, 800);
  const ends = [0, 1, 2, 3, 4].map((i) => fogSliceEnd(i, FOG_BANKS.slices, reach));
  near(ends[0], reach / 25);
  near(ends[1], (reach * 4) / 25);
  assert.equal(ends[4], reach);
  for (let i = 1; i < 5; i++) assert.ok(ends[i] - ends[i - 1] > ends[i - 1] - (ends[i - 2] ?? 0), "each slice is longer than the one before");
  // In Foggy a truck 25 ft off and one 100 ft off are in different slices, so a bank can stand between them.
  assert.ok(ends[0] > 25 && ends[0] < 100 && ends[1] > 100);
  assert.equal(fogSliceEnd(1, FOG_BANKS.liteSlices, reach), reach);
  // Nothing in the banks is finer than a couple of hundred feet, so a truck at speed does not run through their grain.
  assert.ok(FOG_BANKS.broadFt > FOG_BANKS.midFt * 2 && FOG_BANKS.midFt >= 1000 && FOG_BANKS.midBlur >= 1);
  // They move with the wind and nothing else, a few feet a second.
  for (const weather of [0, 1, 2, 3, 4, 5]) assert.ok(fogVolume(weather).windFtPerS > 0 && fogVolume(weather).windFtPerS <= 10, `weather ${weather}`);
  // Over a bank the layer's top stands higher.
  assert.ok(FOG_BANKS.topSwell > 0 && FOG_BANKS.topSwell < 1);
});

test("a bank thins the fog or thickens it, most in Foggy, less in a haze, and is an even fog on the whole", () => {
  const foggy = fogVolume(2).drift, clear = fogVolume(0).drift;
  // Where the noise reads low there is a clearing; where it reads high, a bank; about its middle, the fog the table says.
  near(fogBank(0.5, foggy), 1);
  assert.equal(fogBank(0.2, foggy), Math.max(0, 1 - foggy * FOG_BANKS.reach));
  near(fogBank(0.8, foggy), 1 + foggy * FOG_BANKS.reach);
  assert.equal(FOG_BANKS.reach, 1);
  assert.equal(fogBank(0.2, 1), 0);
  assert.equal(fogBank(0.8, 1), 2);
  assert.ok(fogBank(0.2, foggy) < 0.5 && fogBank(0.8, foggy) > 1.5, "Foggy: from under half to over one and a half");
  assert.ok(fogBank(0.2, clear) > 0.7 && fogBank(0.8, clear) < 1.3, "a clear day's haze is nearly even");
  // As much thinner below the middle as thicker above it, so the fog is as thick on the whole as the weather says.
  for (const noise of [0.38, 0.42, 0.47]) near(fogBank(noise, foggy) + fogBank(1 - noise, foggy), 2);
  // Never less than no fog; without drift an even fog.
  for (let noise = 0; noise <= 1; noise += 0.05) {
    assert.ok(fogBank(noise, 1) >= 0);
    assert.equal(fogBank(noise, 0), 1);
  }
  // Fog proper has the most of it, and every weather with a volume some.
  for (const weather of [0, 1, 3, 4, 5]) assert.ok(fogVolume(weather).drift > 0 && fogVolume(weather).drift < foggy, `weather ${weather}`);
  // Fog twice as thick as even is seen an eighth brighter.
  assert.equal(FOG_BANKS.shade, 0.12);
});

test("rain and snow fall as fields: a near one seen drop by drop and a far one that fills the distance", () => {
  assert.equal(precipitationOf(4), PRECIPITATION.rain);
  assert.equal(precipitationOf(5), PRECIPITATION.snow);
  for (const weather of [0, 1, 2, 3, 6, 7, 8]) assert.equal(precipitationOf(weather), null);
  // The port's speeds, as before: rain at 70 ft/s on a 12 ft/s wind, snow at 9.
  assert.equal(PRECIPITATION.rain.fallFtPerS, 70);
  assert.equal(PRECIPITATION.rain.windFtPerS[0], 12);
  assert.equal(PRECIPITATION.snow.fallFtPerS, 9);
  for (const kind of [PRECIPITATION.rain, PRECIPITATION.snow]) {
    assert.ok(kind.far.boxFt > kind.near.boxFt * 2 && kind.far.sizeFt > kind.near.sizeFt && kind.far.opacity < kind.near.opacity);
    assert.ok(kind.near.count >= 5000 && kind.near.count + kind.far.count <= 20000);
  }
  // Rain is a streak and leaves splashes; a flake is a point and leaves none.
  assert.ok(PRECIPITATION.rain.near.lengthFt > 1 && PRECIPITATION.rain.splashes > 0);
  assert.equal(PRECIPITATION.snow.near.lengthFt, 0);
  assert.equal(PRECIPITATION.snow.splashes, 0);
});

test("snow settles at the game's pace, over 100 seconds, and leaves most of the ice bare; a race in Snow begins with some down", () => {
  // The game's ice gains 1/200 of full a second and stops at 0x7fff of 0xffff: half, after 100 s (section 13).
  assert.equal(SNOW_SETTLE_SECONDS, 100);
  near(0x7fff / 0xffff, 0.5, 1e-4);
  // The port's snow keeps the clock and ends over a seventh of the ice, in drifts, so that the ice is seen.
  assert.equal(ICE_SNOW_SHARE, 0.14);
  assert.equal(snowSettled(0), 0);
  near(snowSettled(50), 0.5);
  assert.equal(snowSettled(100), 1);
  assert.equal(snowSettled(1000), 1);
  assert.equal(snowSettled(-5), 0);
  // It has been snowing when the race begins: three tenths are down, and the rest settles over the same 100 s.
  assert.equal(SNOW_START, 0.3);
  assert.equal(snowDown(0), SNOW_START);
  near(snowDown(50), 0.65);
  assert.equal(snowDown(100), 1);
  assert.equal(snowDown(500), 1);
  // Snow that begins during a race comes from nothing, as the game's does.
  assert.equal(snowDown(0, 0), 0);
  near(snowDown(25, 0), 0.25);
  assert.equal(snowDown(100, 0), 1);
});

test("wet ground is darker and deeper in colour, with a slight sheen: standing water is the mirror, the ground is not", () => {
  assert.ok(WET.darker > 0.6 && WET.darker < 0.9 && WET.deeper > 0);
  // Looking down it mirrors next to nothing; along the ground some of the sky, never as much as a puddle.
  assert.ok(WET.sheen < 0.05 && WET.sheenLow > WET.sheen && WET.sheenMost >= WET.sheenLow && WET.sheenMost <= 0.25);
});

test("rain standing on dirt is muddy: a film shows the ground, an inch of it hides most of it, and stirred up it hides it all", () => {
  assert.equal(poolMurk(0), 0);
  assert.ok(poolMurk(0.01) < 0.25, `a film: ${poolMurk(0.01)}`);
  assert.ok(poolMurk(0.08) > 0.55, `an inch: ${poolMurk(0.08)}`);
  for (let d = 0; d < 0.3; d += 0.01) assert.ok(poolMurk(d + 0.01) > poolMurk(d));
  assert.ok(poolMurk(10) <= POOL_LOOK.murkMost && POOL_LOOK.murkMost < 0.95, "however deep, some of the bed's light comes through");
  // Its colour is the ground's own, a little darker; stirred up, a shade paler, and froth never hides the water whole.
  assert.ok(POOL_LOOK.mud > 0.3 && POOL_LOOK.mud < 1 && POOL_LOOK.mud + POOL_LOOK.stirredPaler <= 1);
  assert.ok(POOL_LOOK.froth > 0 && POOL_LOOK.froth < 1);
  // The bank a puddle has soaked is darker than wet ground, and keeps a film of its water.
  assert.ok(POOL_LOOK.soaked > 0 && POOL_LOOK.soaked < 0.5 && POOL_LOOK.film > 0 && POOL_LOOK.film < 1);
});

test("the ground is wet within seconds of Rain and its puddles fill over a minute", () => {
  assert.equal(groundWetness(0), 0);
  assert.equal(groundWetness(8), 1);
  assert.ok(puddlesFilled(0) > 0.3 && puddlesFilled(0) < 0.4, "low places hold water as soon as it rains");
  assert.ok(puddlesFilled(20) < 1);
  assert.equal(puddlesFilled(60), 1);
});

test("the Volumetric weather slider thins the fog by its share and keeps where the picture fades out", async () => {
  const { FOG_AMOUNTS } = await import("../src/game/atmosphere.js");
  assert.deepEqual([...FOG_AMOUNTS].map((a, i) => (i === 0 ? a : a > FOG_AMOUNTS[i - 1])), [0, true, true, true]);
  assert.equal(FOG_AMOUNTS[3], 1);
  for (const weather of [0, 2, 3, 4, 5]) {
    const max = fogVolume(weather), some = fogVolume(weather, undefined, { amount: FOG_AMOUNTS[2] });
    assert.ok(Math.abs(some.densityPerFt - max.densityPerFt * FOG_AMOUNTS[2]) < 1e-12, `weather ${weather}`);
    assert.ok(some.skyDepth < max.skyDepth);
    assert.equal(some.farFt, max.farFt);
  }
});
