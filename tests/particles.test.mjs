/*
  What the trucks throw up and leave behind (docs/VISUALS.md, "Particles" and "Tracks"), with
  "Rich particles".
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DUST, DUST_BY_TYPE, DUST_WEATHER, LANDING_AIR_S, PLOUGH, PLOUGH_MAP, PUDDLE_FOOTING_FT, SPARKS, SPARK_LIGHT, LANDING_MIN_FT_PER_S, LITE_SHARE, PUFF_KINDS, PUFF_POOL, RUT, SLIDE_SHOWS, SNOW_FOOTING_FT, SPIN_FULL_FT_S, SPIN_SHOWS_FT_S,
  STREAK_KINDS, STREAK_POOL, SUBMERGED_FT, TRACK_FADE_FT, TRACK_FADE_LITE_FT, TRACK_KINDS, TRACK_WIDTH_FT, TREAD_REPEAT_FT,
  OVER, overIsHeavy, puffCover,
  ROOSTER, SPRAY, dustColour, dustTone, puddleRut, footing, groundDust, landingThrows, muddyWater, roosterDrops, roosterVelocity, roosterWading, scrapePuff, sprayDrops, sprayVelocity, scrapeThrows, slideAmount, slideThrows, snowTrench, sparkFlight, sparkGlow, sparkShower, sparkVelocity,
  tireThrows, trackKind, BUBBLES, bubbleRiseFtS, bubbleSpiral, bubbleVelocity, bubbleWidth, MIST, mistSpacingFt,
} from "../src/game/particles.js";
import { SNOW_LINE, SNOW_MAX_FT, SNOW_TRACK_SHARE } from "../src/game/snow-cover.js";
import { skidAmount, surfaceFamily } from "../src/game/sound-model.js";
import { MPH_PER_FTS } from "../src/game/tire-effects.js";

const mph = (v) => v / MPH_PER_FTS;
const on = (type, more = {}) => footing({ family: surfaceFamily(type), type, ...more });
/** The `.TTY` ground types (MTM2_PHYSICS.md 2.3). */
const CEMENT = 1, DIRT = 2, MUD = 4, SAND = 5, GRASS = 6, GRAVEL = 7, ICE = 8, SNOW = 9, METAL = 10, ROCKS = 12;
const CLEAR = 0, RAIN = 4, SNOWING = 5;

test("what a wheel stands on follows the ground, the weather, the snow that lies and the water", () => {
  // Dry: soft ground is dust, hard ground hard.
  for (const type of [DIRT, MUD, SAND, GRASS, GRAVEL, ROCKS]) assert.equal(on(type), "dust", `type ${type}`);
  for (const type of [CEMENT, METAL]) assert.equal(on(type), "hard", `type ${type}`);
  // In Rain: mud and wet.
  assert.equal(on(DIRT, { weather: RAIN }), "mud");
  assert.equal(on(CEMENT, { weather: RAIN }), "wet");
  // Ground that is snow or ice is so in any weather.
  assert.equal(on(SNOW), "snow");
  assert.equal(on(ICE, { weather: RAIN }), "ice");
  // In Snow: snow where it lies deep enough, whatever is under it; ground it has not covered is frozen.
  assert.equal(SNOW_FOOTING_FT, 0.2);
  assert.equal(on(CEMENT, { weather: SNOWING, snowFt: 0.25 }), "snow");
  assert.equal(on(DIRT, { weather: SNOWING, snowFt: 0.5 }), "snow");
  assert.equal(on(DIRT, { weather: SNOWING, snowFt: 0.15 }), "hard");
  // Along the course the snow is kept to a share of the deepest: the road is bare to the eye and frozen under the tire.
  assert.ok(SNOW_MAX_FT * SNOW_TRACK_SHARE < SNOW_FOOTING_FT);
  // Snow a wheel stands in is snow that shows, wherever the snow line wanders.
  assert.ok(SNOW_FOOTING_FT > SNOW_LINE.showsFromFt && SNOW_FOOTING_FT < SNOW_LINE.showsToFt);
  // Snow that lay in another weather is not asked about.
  assert.equal(on(DIRT, { weather: CLEAR, snowFt: 0.5 }), "dust");
  // Under the wheel the level's water, which Snow freezes.
  assert.equal(on(DIRT, { inWater: true }), "water");
  assert.equal(on(DIRT, { weather: RAIN, inWater: true }), "water");
  assert.equal(on(DIRT, { weather: SNOWING, snowFt: 1, inWater: true }), "ice");
});

test("a puff is a cloud and a streak a small hard thing: what each is made of", () => {
  assert.deepEqual(Object.keys(PUFF_KINDS), ["dust", "smoke", "powder", "mist", "rubber"]);
  assert.deepEqual(Object.keys(STREAK_KINDS), ["spark", "drop", "chip", "clod", "bubble"]);
  for (const [name, kind] of Object.entries(PUFF_KINDS)) {
    assert.ok(kind.sizeFt[0] < kind.sizeFt[1] && kind.growFt > kind.sizeFt[1], `${name} swells to several times its size`);
    assert.ok(kind.lifeS[0] < kind.lifeS[1] && kind.opacity > 0 && kind.opacity <= 0.6 && kind.drag > 0, name);
    assert.ok(kind.squash > 0 && kind.squash <= 1, `${name} is a ball, or flatter`);
  }
  // What hangs by the ground spreads along it: dust is the flattest, smoke rises round.
  assert.equal(PUFF_KINDS.dust.squash, 0.75);
  assert.equal(PUFF_KINDS.smoke.squash, 1);
  // Dust takes half the level's ground colour; snow's powder and water's mist are brighter than a matt white face.
  assert.equal(PUFF_KINDS.dust.ground, 0.5);
  assert.ok(Math.min(...PUFF_KINDS.powder.tone) > 1);
  assert.ok(PUFF_KINDS.mist.opacity < PUFF_KINDS.dust.opacity, "mist is thin");
  // Dust and smoke rise, powder sinks back.
  assert.ok(PUFF_KINDS.dust.riseFtPerS > 0 && PUFF_KINDS.smoke.riseFtPerS > PUFF_KINDS.dust.riseFtPerS && PUFF_KINDS.powder.riseFtPerS < 0);
  // A sliding tire's smoke is pale and thinner than a crash's.
  assert.ok(Math.min(...PUFF_KINDS.rubber.tone) > Math.max(...PUFF_KINDS.smoke.tone) && PUFF_KINDS.rubber.opacity < PUFF_KINDS.smoke.opacity);
  // A spark is its own light, far brighter than white, and cools to red; nothing else glows.
  assert.equal(STREAK_KINDS.spark.glow, 1);
  assert.ok(STREAK_KINDS.spark.tone[0] > 5 && STREAK_KINDS.spark.cool[0] > STREAK_KINDS.spark.cool[1] * 4);
  assert.deepEqual(STREAK_KINDS.spark.tone, SPARKS.hot);
  for (const name of ["drop", "chip", "clod", "bubble"]) assert.equal(STREAK_KINDS[name].glow, 0, name);
  // A bubble rises, and is gone at the surface (`BUBBLES`); the others fall as thrown things do.
  assert.ok(STREAK_KINDS.bubble.rises && STREAK_KINDS.bubble.bounce === 0);
  for (const name of ["spark", "drop", "chip", "clod"]) assert.ok(!STREAK_KINDS[name].rises, name);
  // A spark is a glowing dot; a drop is drawn out longest. A drop ends where it falls, the others skip on.
  assert.equal(STREAK_KINDS.spark.trailS, 0);
  assert.ok(STREAK_KINDS.drop.trailS > STREAK_KINDS.chip.trailS && STREAK_KINDS.chip.trailS > STREAK_KINDS.clod.trailS);
  assert.equal(STREAK_KINDS.drop.bounce, 0);
  for (const name of ["spark", "chip", "clod"]) assert.ok(STREAK_KINDS[name].bounce > 0, name);
  assert.ok(PUFF_POOL >= 1000 && STREAK_POOL >= 2000);
  assert.equal(LITE_SHARE, 0.5);
});

test("dust is the colour of its ground: sand pale, mud dark, gravel grey", () => {
  const brightness = (c) => c[0] + c[1] + c[2];
  assert.ok(brightness(dustTone("dirt", SAND)) > brightness(dustTone("dirt", DIRT)));
  assert.ok(brightness(dustTone("dirt", MUD)) < brightness(dustTone("dirt", DIRT)));
  const gravel = dustTone("gravel", GRAVEL);
  assert.ok(gravel[0] - gravel[2] < 0.06, "grey");
  assert.deepEqual(dustTone("dirt", DIRT), PUFF_KINDS.dust.tone);
});

test("what a wheel throws each tick follows what it stands on and how fast it goes", () => {
  const always = () => 0, never = () => 0.999;
  // Hard ground gives nothing; nothing is thrown at a crawl.
  assert.deepEqual(tireThrows("hard", mph(80), always), { puff: null, streak: null, streaks: 0 });
  for (const stood of ["dust", "mud", "wet", "snow", "ice", "water"]) {
    const thrown = tireThrows(stood, mph(2), always);
    assert.equal(thrown.puff, null, stood);
    assert.equal(thrown.streaks, 0, stood);
  }
  // Dust's own puffs are the game's rule, not this one's: here only a clod now and then at speed.
  assert.equal(tireThrows("dust", mph(40), always).puff, null);
  assert.deepEqual(tireThrows("dust", mph(40), always), { puff: null, streak: "clod", streaks: 1 });
  assert.equal(tireThrows("dust", mph(40), never).streaks, 0);
  assert.equal(tireThrows("dust", mph(20), always).streaks, 0);
  // Mud throws clods from 8 mph, and neither dust nor spray.
  assert.deepEqual(tireThrows("mud", mph(10), always), { puff: null, streak: "clod", streaks: 2 });
  assert.equal(tireThrows("mud", mph(10), never).streaks, 1);
  assert.equal(tireThrows("mud", mph(60), always).puff, null);
  // Wet hard ground: drops above 22 mph; its mist is laid along the way the tire rolls (`mistSpacingFt`), not thrown each tick.
  assert.equal(tireThrows("wet", mph(18), always).puff, null);
  assert.equal(tireThrows("wet", mph(18), always).streaks, 0);
  assert.equal(tireThrows("wet", mph(30), never).streaks, 1);
  // Snow: powder and chips, a chip for every 24 mph.
  assert.deepEqual(tireThrows("snow", mph(50), always), { puff: "powder", streak: "chip", streaks: 3 });
  assert.equal(tireThrows("snow", mph(50), never).streaks, 2);
  assert.equal(tireThrows("snow", mph(50), never).puff, null);
  // Ice: chips at times above 10 mph, powder only at speed.
  assert.equal(tireThrows("ice", mph(20), always).streak, "chip");
  assert.equal(tireThrows("ice", mph(20), always).puff, null);
  assert.equal(tireThrows("ice", mph(40), always).puff, "powder");
  // Water: thrown aside in sheets of spray (`SPRAY`, below); the mist it is beaten to at speed is laid along the way, as on
  // wet ground.
  assert.equal(tireThrows("water", mph(90), always).streaks, 0);
  assert.equal(tireThrows("water", mph(30), always).puff, null);
});

test("a wet tread's mist is laid low behind it along the way it rolls, closer the faster, and the air stops it at once", () => {
  const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);
  // None at a crawl; from 14 mph on wet ground (12 wading), a puff every 6 ft, closing to every 1.8 ft from 50 mph.
  assert.equal(mistSpacingFt(mph(13), "wet"), Infinity);
  assert.ok(Number.isFinite(mistSpacingFt(mph(13), "water")));
  near(mistSpacingFt(mph(14.0001), "wet"), MIST.spacingFt[0], 1e-3);
  near(mistSpacingFt(mph(50), "wet"), MIST.spacingFt[1]);
  near(mistSpacingFt(mph(90), "water"), MIST.spacingFt[1]);
  for (let v = 15; v < 60; v += 5) assert.ok(mistSpacingFt(mph(v + 5), "wet") <= mistSpacingFt(mph(v), "wet"), `${v} mph`);
  // Only off a film of water or wading: mud is flung in clods, a puddle in sheets, and dry ground has none.
  for (const stood of ["mud", "puddle", "dust", "hard", "snow", "under"]) assert.equal(mistSpacingFt(mph(40), stood), Infinity, stood);
  // A veil, not a cloud: low and flat, under nine feet across when it has spread, thin, and so fine that what it was
  // thrown with is gone within a fifth of a second.
  const mist = PUFF_KINDS.mist;
  assert.ok(mist.squash <= 0.6, "flat");
  assert.ok(mist.sizeFt[1] + mist.growFt <= 4.5, `${mist.sizeFt[1] + mist.growFt} ft at the most`);
  assert.ok(mist.opacity <= 0.15 && mist.drag >= 5 && Math.exp(-mist.drag * 0.2) < 0.4);
  assert.ok(MIST.carried < 0.5 && MIST.upFtS[1] < 4);
});

test("dust is laid as an even trail, as thick as the ground there is dusty", () => {
  // A puff every 6 ft a tire rolls for each of the game's puffs; far from the eye half as many, larger.
  assert.equal(DUST.spacingFt, 6);
  assert.equal(DUST.farFt, 400);
  assert.equal(DUST.farSpacing, 2);
  assert.equal(DUST.farScale, 1.3);
  assert.equal(DUST.least, 0.1);
  // A puff is born wider than the trail's spacing is half of, so the trail has no gaps.
  assert.ok(PUFF_KINDS.dust.sizeFt[0] * 2 > DUST.spacingFt / 2);
  // By type, where the ground's colour says it is dry and bare: dirt and sand the most, mud a little; hard ground none.
  assert.deepEqual({ ...DUST_BY_TYPE }, { 2: 1, 4: 0.3, 5: 1, 6: 0.35, 7: 0.6, 12: 0.45 });
  for (const type of [CEMENT, ICE, SNOW, METAL, 0]) assert.equal(groundDust(null, type), 0, `type ${type}`);
  assert.equal(groundDust(null, DIRT), 1);
  // By colour: tan earth gives all its type gives; dark earth, damp or rich, little; green ground, grown over, almost none.
  const tan = [0.3, 0.19, 0.09], dark = [0.02, 0.015, 0.01], green = [0.08, 0.155, 0.03], straw = [0.22, 0.205, 0.06], grey = [0.2, 0.2, 0.2];
  assert.ok(groundDust(tan, DIRT) > 0.99);
  assert.ok(groundDust(tan, SAND) > 0.99);
  assert.ok(groundDust(dark, DIRT) < 0.05);
  // The game's ground is dark on the whole: its dark dirt (a luminance of 0.04) still gives some.
  const darkDirt = [0.05, 0.037, 0.031];
  assert.ok(groundDust(darkDirt, DIRT) > 0.3 && groundDust(darkDirt, DIRT) < 0.6);
  assert.ok(groundDust(green, GRASS) < DUST.least, "grass that is green raises none");
  assert.ok(groundDust(green, DIRT) < 0.15, "nor does earth grown green");
  assert.ok(groundDust(straw, GRASS) > 0.2, "dry grass raises some");
  // Grey is stone: about half of what warm earth gives.
  assert.ok(Math.abs(groundDust(grey, DIRT) - 0.55) < 0.01);
  assert.ok(groundDust(grey, GRAVEL) < groundDust(tan, GRAVEL));
  assert.equal(groundDust([0, 0, 0], DIRT), 0);
  // The weather: none in Rain or Snow, half in fog, a little less on a dewy night.
  assert.equal(DUST_WEATHER.length, 10);
  assert.deepEqual([...DUST_WEATHER], [1, 1, 0.5, 0.35, 0, 0, 1, 0.8, 0.8, 1]);
  // Its colour: half the type's own, half the ground's made paler.
  const brightness = (c) => c[0] + c[1] + c[2];
  assert.deepEqual(dustColour(null, "dirt", DIRT), dustTone("dirt", DIRT));
  assert.ok(brightness(dustColour(dark, "dirt", DIRT)) < brightness(dustColour(tan, "dirt", DIRT)));
  const red = dustColour([0.35, 0.12, 0.06], "dirt", DIRT), plain = dustTone("dirt", DIRT);
  assert.ok(red[0] - red[2] > plain[0] - plain[2], "red earth raises red dust");
  assert.ok(Math.abs(dustColour(tan, "dirt", DIRT)[0] - (plain[0] + (tan[0] * DUST.paler + 0.02 - plain[0]) * 0.5)) < 1e-9);
});

test("a hull scraping along the ground raises what the ground gives", () => {
  assert.equal(scrapePuff("dust"), "dust");
  assert.equal(scrapePuff("snow"), "powder");
  assert.equal(scrapePuff("ice"), "powder");
  assert.equal(scrapePuff("hard"), "smoke");
  for (const stood of ["mud", "wet", "puddle", "water", "under"]) assert.equal(scrapePuff(stood), null, stood);
});

test("a wheel that lands throws a ring of puffs and a burst of streaks, more the harder it lands", () => {
  assert.equal(LANDING_AIR_S, 0.18);
  assert.equal(LANDING_MIN_FT_PER_S, 6);
  assert.equal(landingThrows("dust", 5.9), null, "a touch throws nothing");
  assert.equal(landingThrows("hard", 30), null, "hard ground gives nothing");
  assert.deepEqual(landingThrows("dust", 6), { puff: "dust", puffs: 3, streak: "clod", streaks: 5 });
  assert.deepEqual(landingThrows("dust", 40), { puff: "dust", puffs: 9, streak: "clod", streaks: 18 });
  assert.deepEqual(landingThrows("dust", 400), landingThrows("dust", 40), "a fall from twenty five feet throws all there is");
  assert.deepEqual(landingThrows("snow", 40), { puff: "powder", puffs: 10, streak: "chip", streaks: 20 });
  assert.deepEqual(landingThrows("water", 40), { puff: "mist", puffs: 9, streak: "drop", streaks: 34 });
  assert.deepEqual(landingThrows("ice", 6), { puff: "powder", puffs: 1, streak: "chip", streaks: 8 });
  assert.equal(landingThrows("mud", 20).streak, "clod");
  assert.equal(landingThrows("mud", 40).puffs, 0, "mud raises no spray");
  assert.equal(landingThrows("wet", 20).streak, "drop");
  for (const stood of ["dust", "mud", "wet", "snow", "ice", "water"]) {
    let last = landingThrows(stood, 6);
    for (let fall = 8; fall <= 40; fall += 4) {
      const thrown = landingThrows(stood, fall);
      assert.ok(thrown.puffs >= last.puffs && thrown.streaks >= last.streaks, `${stood} at ${fall}`);
      last = thrown;
    }
  }
});

test("every tire leaves a track on what gives under it, and rubber where it slides on hard ground", () => {
  assert.equal(trackKind("dust"), TRACK_KINDS.dust);
  assert.equal(trackKind("snow"), TRACK_KINDS.snow);
  assert.equal(trackKind("mud"), TRACK_KINDS.mud);
  assert.equal(trackKind("ice"), TRACK_KINDS.ice);
  for (const stood of ["hard", "wet", "water", null]) assert.equal(trackKind(stood), null, String(stood));
  assert.equal(trackKind("hard", 0.3), TRACK_KINDS.rubber);
  assert.equal(trackKind("wet", 1), null, "water on the road takes no rubber");
  assert.equal(trackKind("dust", 1), TRACK_KINDS.dust);
  assert.equal(new Set(Object.values(TRACK_KINDS)).size, 5);
  assert.equal(TRACK_WIDTH_FT, 2.7);
  assert.equal(TREAD_REPEAT_FT, 4);
});

test("a rut darkens the ground it is in, more under the lugs and in mud; thin snow is cut through, deep snow packed", () => {
  // One truck's rut leaves the ground four fifths as bright and the lug prints three fifths.
  assert.deepEqual([...RUT.earth], [0.2, 0.42]);
  // Under standing water a rut is seen through the water's face: nearly half hidden at the waterline, nearly all of it
  // where the water is an inch and a half deep.
  assert.deepEqual([...RUT.underWater], [0.6, 0.97]);
  assert.equal(RUT.underWaterFt, 0.08);
  // Deep snow is drawn from one map of it about the eye, 512 ft square, a point every quarter foot; a rut's wall is never
  // narrower than the tire's shoulder; the map is drawn again when a rut is laid, the eye has gone 16 ft, or 0.25 s on.
  assert.equal(PLOUGH_MAP.side * PLOUGH_MAP.texelFt, 512);
  assert.equal(PLOUGH_MAP.texelFt, 0.25);
  assert.equal(PLOUGH_MAP.shoulderFt, 0.4);
  assert.ok(PLOUGH_MAP.shoulderFt > PLOUGH_MAP.texelFt, "a wall spans more than one of the map's points");
  assert.deepEqual([PLOUGH_MAP.redrawFt, PLOUGH_MAP.redrawS], [16, 0.25]);
  assert.deepEqual([PLOUGH_MAP.steps, PLOUGH_MAP.refine], [14, 5]);
  // In the map a ridge is heaped in clumps about its height, the highest no more than two fifths over it.
  assert.ok(PLOUGH_MAP.clumps[1] < 1.4);
  // Beyond the map a rut's wall is lit as the map's slope would have it: leaning 0.7 up for each foot across.
  assert.equal(PLOUGH_MAP.wallLit, 0.7);
  // Coming to a puddle a rut runs out: pressed less as the water under the tire deepens, not at all in the puddle.
  assert.equal(puddleRut(0), 1);
  assert.equal(puddleRut(PUDDLE_FOOTING_FT / 2), 0.5);
  assert.equal(puddleRut(PUDDLE_FOOTING_FT), 0);
  assert.equal(puddleRut(1), 0);
  assert.ok(RUT.mud[0] > RUT.earth[0] && RUT.mud[1] > RUT.earth[1]);
  assert.ok(RUT.wall > 0 && RUT.earth[1] + 2 * RUT.wall < 0.9, "never black from one truck");
  // Eight trucks on one line wear it darker, not black.
  assert.ok((1 - RUT.earth[0]) ** 8 > 0.1);
  assert.deepEqual([...RUT.thinSnowFt], [0.12, 0.34]);
  // Rubber at a full slide takes half the ground's light; a tire sliding on soft ground digs its rut up to half again darker.
  assert.equal(RUT.rubber, 0.5);
  assert.equal(RUT.slideDeeper, 0.5);
  // Tracks are gone before the ground's fine level ends: 2400 ft on the flat screen, 800 in a headset.
  assert.ok(TRACK_FADE_FT[0] < TRACK_FADE_FT[1] && TRACK_FADE_FT[1] <= 2400);
  assert.ok(TRACK_FADE_LITE_FT[0] < TRACK_FADE_LITE_FT[1] && TRACK_FADE_LITE_FT[1] <= 800);
});

test("a tire slides when it asks the ground for more than it gives sideways, and spins when its tread outruns the ground", () => {
  const tire = (force, spin = 0, grip = 3000) => ({ onGround: true, grip, force, spin });
  // Pushing forward past the game's skid measure is the engine's work, and the wheel turns with the ground: no slide.
  assert.equal(skidAmount(tire([0, 2500, 3600])), 1);
  assert.equal(slideAmount({ tire: tire([0, 2500, 3600], 12.7), radiusFt: 2.75, forwardFtS: 35 }), 0);
  // Sideways past the measure, it slides: from `SLIDE_SHOWS` of it, in full at the measure's full.
  assert.equal(SLIDE_SHOWS, 0.25);
  assert.equal(slideAmount({ tire: tire([3000 * 0.85, 2500, 0]) }), 0);
  assert.equal(slideAmount({ tire: tire([3000 * 1.2, 2500, 0]) }), 1);
  const some = slideAmount({ tire: tire([-3000 * 1.05, 2500, 0]) });
  assert.ok(some > 0.3 && some < 0.6, `some ${some}`);
  // Spinning: the tread 7 ft/s past the ground shows, and 28 more is all of it.
  assert.equal(SPIN_SHOWS_FT_S, 7);
  assert.equal(SPIN_FULL_FT_S, 28);
  assert.equal(slideAmount({ tire: tire([0, 2500, 0], 10 / 2.75), radiusFt: 2.75, forwardFtS: 3 }), 0);
  assert.ok(Math.abs(slideAmount({ tire: tire([0, 2500, 0], 24 / 2.75), radiusFt: 2.75, forwardFtS: 3 }) - 0.5) < 1e-9);
  assert.equal(slideAmount({ tire: tire([0, 2500, 0], 60 / 2.75), radiusFt: 2.75, forwardFtS: 0 }), 1);
  // Off the ground nothing slides; a replay, which records no tires, goes by how fast the truck slips sideways.
  assert.equal(slideAmount({ tire: { ...tire([5000, 0, 0], 30), onGround: false } }), 0);
  assert.equal(slideAmount({ sidewaysFtS: 5 }), 0);
  assert.equal(slideAmount({ sidewaysFtS: -27 }), 1);
});

test("a sliding tire smokes on hard ground and digs out what is soft", () => {
  const always = () => 0, never = () => 0.999;
  assert.deepEqual(slideThrows("dust", 0, always), { puff: null, streak: null, streaks: 0 });
  assert.deepEqual(slideThrows("hard", 1, always), { puff: "rubber", streak: null, streaks: 0 });
  assert.equal(slideThrows("hard", 1, never).puff, null);
  assert.deepEqual(slideThrows("dust", 1, always), { puff: "dust", streak: "clod", streaks: 3 });
  assert.equal(slideThrows("mud", 1, always).streaks, 5);
  assert.equal(slideThrows("snow", 1, always).puff, "powder");
  assert.equal(slideThrows("water", 0.5, always).streak, "drop");
  // The harder it slides, the more it throws.
  for (const stood of ["dust", "mud", "snow", "water"]) assert.ok(slideThrows(stood, 1, never).streaks > slideThrows(stood, 0.1, never).streaks, stood);
});

test("a hull strikes sparks from what is hard, digs clods and chips from what is not, and under water only bubbles", () => {
  assert.equal(scrapeThrows({}), "spark", "a wall, a fence, another truck");
  assert.equal(scrapeThrows({ onGround: true, family: "cement", type: CEMENT }), "spark");
  assert.equal(scrapeThrows({ onGround: true, family: "gravel", type: GRAVEL }), "spark");
  assert.equal(scrapeThrows({ onGround: true, family: "dirt", type: DIRT }), "clod");
  assert.equal(scrapeThrows({ onGround: true, family: "dirt", type: DIRT, weather: RAIN }), "clod");
  assert.equal(scrapeThrows({ onGround: true, family: "cement", type: CEMENT, weather: RAIN }), "spark");
  assert.equal(scrapeThrows({ onGround: true, family: "dirt", type: DIRT, weather: SNOWING, snowFt: 0.5 }), "chip");
  assert.equal(scrapeThrows({ onGround: true, family: "ice", type: ICE }), "chip");
  // A body dragged over the frozen water of Snow chips the ice and raises powder off it, whatever the bed under it is:
  // not sparks and smoke, as off a wall.
  assert.equal(scrapeThrows({ onGround: true, onIce: true, family: "cement", type: CEMENT, weather: SNOWING }), "chip");
  assert.equal(scrapePuff(on(CEMENT, { weather: SNOWING, inWater: true })), "powder");
  // A spark struck under water is quenched as it is struck: what is seen is the air shaken out of the gap.
  assert.equal(scrapeThrows({ underWater: true }), "bubble");
  assert.equal(scrapeThrows({ onGround: true, underWater: true, family: "cement", type: CEMENT }), "bubble");
});

test("a bubble rises as fast as its size lets it, to the surface; the water takes at once whatever it was thrown with", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  const [small, large] = BUBBLES.widthFt;
  // A third of an inch to nearly two inches, most of them small.
  assert.ok(small > 0.01 && small < 0.04 && large > 0.1 && large < 0.2);
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const widths = Array.from({ length: 2000 }, () => bubbleWidth(random)).sort((a, b) => a - b);
  assert.ok(widths[0] >= small && widths.at(-1) <= large);
  assert.ok(widths[1000] < (small + large) / 2, `median ${widths[1000]}`);
  // Under a foot a second for the smallest, a foot and a half for the largest, as real bubbles of those sizes rise.
  near(bubbleRiseFtS(small), 0.75);
  near(bubbleRiseFtS(large), 1.5);
  for (let w = small; w < large; w += 0.01) assert.ok(bubbleRiseFtS(w + 0.01) >= bubbleRiseFtS(w));
  // The smallest go straight up; middling ones spiral fast and close, large ones slower and wider.
  assert.equal(bubbleSpiral(small).radiusFt, 0);
  assert.ok(bubbleSpiral(0.08).radiusFt > 0 && bubbleSpiral(large).radiusFt > bubbleSpiral(0.08).radiusFt);
  assert.ok(bubbleSpiral(0.08).turnsPerS > bubbleSpiral(large).turnsPerS);
  assert.ok(bubbleSpiral(large).radiusFt < 2 * large, "a wobble about its own size");
  // Thrown at 30 ft/s, it has given it up within half a second, and rises at its own pace.
  let v = [30, -10, 0];
  for (let t = 0; t < 0.5; t += 1 / 60) v = bubbleVelocity(v, 1 / 60, 1.2);
  assert.ok(Math.hypot(v[0], v[2]) < 1 && Math.abs(v[1] - 1.2) < 0.4, `${v}`);
  // It lasts long enough to rise from ten feet down at the slowest.
  assert.ok(STREAK_KINDS.bubble.lifeS[0] * BUBBLES.riseFtS[0] > 10);
  // A tire lets them go in little clouds, more often the faster: a bubble or two a tick at speed, a few a second slow.
  const perTick = (speedMph) => { let n = 0; for (let k = 0; k < 4000; k++) n += tireThrows("under", speedMph / MPH_PER_FTS, random).streaks; return n / 4000; };
  assert.ok(perTick(40) > 1 && perTick(40) < 1.8, `${perTick(40)}`);
  assert.ok(perTick(5) > 0.1 && perTick(5) < perTick(40) / 2, `${perTick(5)}`);
  assert.ok(BUBBLES.carried < 0.5, "the water the tire drags along carries them only a little way");
});

test("a wheel wholly under the water throws nothing out of it, only bubbles, and leaves no track", () => {
  assert.equal(SUBMERGED_FT, 0.3);
  assert.equal(on(DIRT, { inWater: true, submerged: true }), "under");
  // Snow freezes the water: nothing is under it.
  assert.equal(on(DIRT, { weather: SNOWING, inWater: true, submerged: true }), "ice");
  const always = () => 0;
  for (const v of [5, 20, 60]) {
    const thrown = tireThrows("under", mph(v), always);
    assert.equal(thrown.puff, null, `${v} mph`);
    assert.equal(thrown.streak, "bubble");
    assert.ok(thrown.streaks >= 1);
  }
  assert.deepEqual(tireThrows("under", mph(2), always), { puff: null, streak: null, streaks: 0 });
  const landed = landingThrows("under", 30);
  assert.equal(landed.puffs, 0);
  assert.equal(landed.streak, "bubble");
  assert.ok(landed.streaks > landingThrows("under", 8).streaks);
  assert.deepEqual(slideThrows("under", 1, always), { puff: null, streak: "bubble", streaks: 4 });
  assert.equal(trackKind("under", 1), null);
});

test("a tire ploughs deep snow: it packs a floor, pushes ridges up either side, and leaves a trench between them", () => {
  // In the deepest snow: the floor packed to a few inches, ridges near half a foot, a trench most of a foot deep.
  const deep = snowTrench(SNOW_MAX_FT);
  assert.ok(deep.floorFt > 0.05 && deep.floorFt < 0.25, `floor ${deep.floorFt}`);
  assert.ok(deep.bermFt > 0.3 && deep.bermFt < SNOW_MAX_FT, `ridges ${deep.bermFt}`);
  assert.ok(Math.abs(deep.deepFt - (SNOW_MAX_FT + deep.bermFt - deep.floorFt)) < 1e-9);
  // The ridges are what the tire moved, less what it packed and what flew.
  assert.ok(deep.bermFt < SNOW_MAX_FT - deep.floorFt);
  // Thin snow is pressed flat: no ridges to speak of. None at all, none of it.
  assert.ok(snowTrench(0.05).bermFt < 0.01);
  assert.deepEqual(snowTrench(0), { floorFt: 0, bermFt: 0, deepFt: 0 });
  // A tire that presses less heaps less.
  assert.ok(snowTrench(0.6, 0.5).bermFt < snowTrench(0.6, 1).bermFt);
  // The ridges are under a foot wide either side of a track 2.7 ft wide, and its walls lean out a third of a foot for each foot up.
  assert.ok(PLOUGH.bermFt > 0.5 && PLOUGH.bermFt < 1.2);
  assert.ok(PLOUGH.wallLean > 0 && PLOUGH.wallLean < 1);
  // A ridge's crest stands at the trench's rim, and its inner face comes down to the snow 0.2 ft in from there. The lid
  // over the trench lies on the snow between the two inner faces: narrower than the rut, and wider than the trench's
  // floor however ragged its rim.
  assert.equal(PLOUGH.lipFt, 0.2);
  const lidFt = TRACK_WIDTH_FT / 2 - PLOUGH_MAP.rimFt - PLOUGH.lipFt;
  assert.ok(Math.abs(lidFt - 1.05) < 1e-9);
  assert.ok(lidFt < TRACK_WIDTH_FT / 2 && lidFt - PLOUGH_MAP.raggedFt - PLOUGH_MAP.shoulderFt > 0);
});

test("in Rain a wheel in a puddle throws a sheet of spray, less than open water and more than wet ground", () => {
  assert.equal(PUDDLE_FOOTING_FT, 0.03);
  assert.equal(on(CEMENT, { weather: RAIN, puddleFt: 0.1 }), "puddle");
  assert.equal(on(DIRT, { weather: RAIN, puddleFt: 0.1 }), "puddle");
  assert.equal(on(DIRT, { weather: RAIN, puddleFt: 0.01 }), "mud");
  // Puddles are Rain's: none in another weather; and the level's water is the water.
  assert.equal(on(DIRT, { weather: CLEAR, puddleFt: 0.1 }), "dust");
  assert.equal(on(DIRT, { weather: RAIN, puddleFt: 0.1, inWater: true }), "water");
  const always = () => 0;
  // A puddle is thrown aside in sheets of spray (below), and raises no mist, rolling, sliding or landing.
  for (const v of [3, 8, 30, 60]) assert.deepEqual(tireThrows("puddle", mph(v), always), { puff: null, streak: null, streaks: 0 });
  assert.equal(landingThrows("puddle", 30).puff, null);
  assert.equal(slideThrows("puddle", 1, always).puff, null);
  assert.ok(landingThrows("puddle", 30).streaks > landingThrows("wet", 30).streaks);
  assert.ok(landingThrows("puddle", 30).streaks < landingThrows("water", 30).streaks);
  assert.equal(slideThrows("puddle", 1, always).streak, "drop");
  // It leaves no track: the puddle closes over it.
  assert.equal(trackKind("puddle", 1), null);
});

test("standing water is thrown aside in two sheets from each tire, trailing back in a V, and puddle water is muddy", () => {
  const half = () => 0.5, none = () => 0;
  // None at a crawl; from 4 mph more the faster, all of them from 45 mph, in water 0.15 ft deep.
  assert.deepEqual(sprayDrops(mph(4), 0.15, half), { sheet: 0, tread: 0 });
  assert.deepEqual(sprayDrops(mph(45), 0.15, none), { sheet: SPRAY.sheet[1], tread: SPRAY.tread[1] });
  assert.deepEqual(sprayDrops(mph(90), 0.15, none), sprayDrops(mph(45), 0.15, none));
  let last = 0;
  for (let v = 6; v <= 45; v += 3) { const { sheet } = sprayDrops(mph(v), 0.15, half); assert.ok(sheet >= last, `${v} mph`); last = sheet; }
  // Shallower water throws fewer, down to a little over a third; deeper more, up to 1.4 times.
  assert.ok(sprayDrops(mph(45), 0.03, none).sheet < sprayDrops(mph(45), 0.15, none).sheet);
  assert.deepEqual(sprayDrops(mph(45), 0.001, none), sprayDrops(mph(45), SPRAY.deepFt * SPRAY.shallowest, none));
  assert.equal(sprayDrops(mph(45), 5, none).sheet, Math.floor(SPRAY.sheet[1] * SPRAY.most));
  // The sheets: slower than the truck along its way, out to either side, low; the tread's drops up behind, not out.
  const vel = [0, 0, 60], forward = [0, 1];
  const mean = (side) => {
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const sum = [0, 0, 0];
    for (let i = 0; i < 4000; i++) sprayVelocity({ vel, forward, side, random }).forEach((c, k) => { sum[k] += c / 4000; });
    return sum;
  };
  const right = mean(1), left = mean(-1), tread = mean(0);
  const mid = ([a, b]) => (a + b) / 2;
  assert.ok(Math.abs(right[2] - 60 * mid(SPRAY.ahead)) < 0.5, "along: the mean of `ahead` of the truck's speed");
  // A fan: the further out a drop flies, the higher and the slower along the way.
  let seed = 3;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const drops = Array.from({ length: 2000 }, () => sprayVelocity({ vel, forward, side: 1, random }));
  const corr = (a, b) => {
    const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length;
    let ab = 0, aa = 0, bb = 0;
    a.forEach((x, i) => { ab += (x - ma) * (b[i] - mb); aa += (x - ma) ** 2; bb += (b[i] - mb) ** 2; });
    return ab / Math.sqrt(aa * bb);
  };
  assert.ok(corr(drops.map((d) => d[0]), drops.map((d) => d[1])) > 0.7, "out and up together");
  assert.ok(corr(drops.map((d) => d[0]), drops.map((d) => d[2])) < -0.9, "out and slower together");
  assert.ok(right[2] < 60 && right[2] > 0, "slower than the truck: the sheets trail back from the wheel");
  // Heading +z, the truck's right is +x (game axes).
  assert.ok(Math.abs(right[0] - 60 * mid(SPRAY.outward)) < 0.5 && Math.abs(left[0] + 60 * mid(SPRAY.outward)) < 0.5);
  assert.ok(Math.abs(right[1] - 60 * mid(SPRAY.rise)) < 0.5, "low");
  assert.ok(Math.abs(tread[0]) < 0.2 && tread[1] > right[1] && tread[2] < right[2]);
  // Puddle water takes some of the ground's colour; without one it is water.
  assert.deepEqual(muddyWater(null), STREAK_KINDS.drop.tone);
  const brown = muddyWater([0.2, 0.12, 0.06]);
  assert.ok(brown[0] - brown[2] > STREAK_KINDS.drop.tone[0] - STREAK_KINDS.drop.tone[2], "browner");
  assert.ok(Math.abs(brown[0] - (0.72 + (0.2 * 1.6 + 0.04 - 0.72) * SPRAY.muddy)) < 1e-9);
  // The air brakes a drop as it does a spark, the larger the less.
  assert.deepEqual(STREAK_KINDS.drop.terminalFtS, [18, 30]);
});

test("a spark leaves at the average of the two things' velocities, scattered a little off the surface it was struck from", () => {
  // Averaged over many: half the truck's own velocity against the ground, which stands still.
  const mean = (args, n = 4000) => {
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const sum = [0, 0, 0];
    for (let i = 0; i < n; i++) sparkVelocity({ ...args, random }).forEach((c, k) => { sum[k] += c / n; });
    return sum;
  };
  const ground = mean({ vel: [0, 0, 50], normal: [0, 1, 0] });
  assert.ok(Math.abs(ground[2] - 25) < 1, `forward ${ground[2]}`);
  assert.ok(Math.abs(ground[0]) < 1, `aside ${ground[0]}`);
  assert.ok(ground[1] > 2, "off the ground, never into it, on the whole");
  // Between two trucks, the mean of the two.
  const trucks = mean({ vel: [0, 0, 40], other: [0, 0, 20], normal: [1, 0, 0] });
  assert.ok(Math.abs(trucks[2] - 30) < 1 && trucks[0] > 2);
  // Each one: never thrown into the surface, and scattered more the harder the two meet.
  const spread = (args) => {
    let seed = 7, most = 0;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 500; i++) {
      const v = sparkVelocity({ ...args, random });
      assert.ok(v[1] >= -1e-9, "off the ground");
      most = Math.max(most, Math.hypot(v[0], v[1], v[2] - args.vel[2] / 2));
    }
    return most;
  };
  assert.ok(spread({ vel: [0, 0, 60] }) > spread({ vel: [0, 0, 15] }));
  assert.ok(spread({ vel: [0, 0, 30], hit: true }) > spread({ vel: [0, 0, 30] }));
  assert.ok(spread({ vel: [0, 0, 60] }) < 30, "a little, not a fountain");
  // A glowing dot, not a streak.
  assert.equal(STREAK_KINDS.spark.trailS, 0);
});

test("the air brakes a spark a little, toward its terminal speed; it cools from white through orange to dull red", () => {
  // Thrown flat at 60 ft/s: within half a second the air has taken some of it, and it is falling.
  let v = [0, 0, 60];
  for (let i = 0; i < 30; i++) v = sparkFlight(v, 1 / 60, 40);
  assert.ok(v[2] < 50 && v[1] < -5, `${v}`);
  // Left to fall, it falls no faster than its terminal speed.
  v = [0, 0, 0];
  for (let i = 0; i < 600; i++) v = sparkFlight(v, 1 / 60, 24);
  assert.ok(Math.abs(Math.hypot(...v) - 24) < 0.5);
  // Steady however long the step.
  const long = sparkFlight([0, 0, 200], 1, 14);
  assert.ok(Number.isFinite(long[2]) && long[2] > 0 && long[2] < 200);
  // Its light: white hot as it leaves, its blue and green going first as it cools, and nothing when it is out.
  const [hot, warm, dull] = [sparkGlow(1), sparkGlow(0.5), sparkGlow(0.15)];
  assert.ok(hot[0] > 5 && hot[2] / hot[0] > 0.2, "white hot, far brighter than white");
  assert.ok(warm[2] / warm[0] < hot[2] / hot[0] && warm[1] / warm[0] < hot[1] / hot[0], "orange");
  assert.ok(dull[1] / dull[0] < 0.1 && dull[0] < warm[0], "dull red");
  assert.deepEqual(sparkGlow(0), [0, 0, 0]);
  // Smaller flecks are braked harder.
  assert.ok(SPARKS.terminalFtS[0] < SPARKS.terminalFtS[1] && SPARKS.terminalFtS[1] <= 50);
  assert.deepEqual(STREAK_KINDS.spark.terminalFtS, SPARKS.terminalFtS);
});

test("a scrape at speed throws a few more, and in the dark they light what is about them", () => {
  const middle = () => 0.5;
  assert.ok(sparkShower(60, middle) > sparkShower(15, middle));
  assert.equal(sparkShower(0, middle), SPARKS.shower[0]);
  assert.ok(sparkShower(1000, () => 0.999) <= SPARKS.shower[1] * 1.4);
  // Its light: a flash that dies within a tenth of a second, as strong as how many have just flown, near the eye.
  assert.ok(SPARK_LIGHT.fadeS > 0 && SPARK_LIGHT.fadeS < 0.2 && SPARK_LIGHT.most * SPARK_LIGHT.strength > 0);
  assert.ok(SPARK_LIGHT.reachFt >= 20 && SPARK_LIGHT.withinFt > SPARK_LIGHT.reachFt);
});

test("thick dust is heavy from six pictures' worth of squares, and until it is back under four", () => {
  // docs/VISUALS.md, "Where the puffs are drawn".
  assert.deepEqual([OVER.heavyFrom, OVER.heavyUntil, OVER.shrink], [6, 4, 4]);
  assert.equal(overIsHeavy(false, 5.9), false);
  assert.equal(overIsHeavy(false, 6), true);
  // Once heavy it stays so through the band between, so a cloud at the edge of it does not flicker from one way to the other.
  assert.equal(overIsHeavy(true, 5), true);
  assert.equal(overIsHeavy(false, 5), false);
  assert.equal(overIsHeavy(true, 4), true);
  assert.equal(overIsHeavy(true, 3.9), false);
});

test("a puff's square covers as much of the picture as the puff looks wide from the eye, and all of it when the eye is in the puff", () => {
  // A view 46.8 degrees tall and 16 by 9, the chase view's.
  const focal = 1 / Math.tan((46.8 * Math.PI) / 360), aspect = 16 / 9, near = 0.5;
  const cover = (x, y, depth, radius) => puffCover(x, y, depth, radius, focal, aspect, near);
  // Straight ahead, 7 ft across at 25 ft: its square stands at its near side, 1.02 times as wide as the puff looks from there.
  const half = (7 / Math.sqrt(25 * 25 - 7 * 7)) * 1.02 * focal;
  assert.ok(Math.abs(cover(0, 0, 25, 7) - (half * half) / aspect) < 1e-9);
  assert.ok(Math.abs(cover(0, 0, 25, 7) - 0.266) < 0.002, "about a quarter of the picture");
  // Twice as far, about a quarter as much; and never more than the picture.
  assert.ok(Math.abs(cover(0, 0, 50, 7) / cover(0, 0, 25, 7) - 0.24) < 0.02);
  assert.equal(cover(0, 0, 7.6, 7), 1);
  // The eye in it, or within three near planes of it: the whole picture, wherever its middle is.
  assert.equal(cover(2, -1, 3, 7), 1);
  assert.equal(cover(0, 0, -4, 7), 1);
  assert.equal(cover(0, 0, 8.4, 7), 1);
  // Behind the eye, and off to the side of the view, none of it.
  assert.equal(cover(0, 0, -30, 7), 0);
  assert.equal(cover(200, 0, 25, 7), 0);
  // Half off the picture's edge, half as much: the view's edge is at depth times the aspect over the focal length.
  const edge = (25 * aspect) / focal;
  assert.ok(Math.abs(cover(edge, 0, 25, 2) / cover(0, 0, 25, 2) - 0.5) < 0.05);
});

test("the puffs are drawn over the scene, and what draws them is told how much of the picture they cover", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  // render/particles.js counts the squares each frame; render/over-scene.js draws the heavy way by that count.
  assert.match(read("../src/render/particles.js"), /cover \+= puffCover\(/);
  assert.match(read("../src/render/particles.js"), /if \(over\) over\.load = cover;/);
  const over = read("../src/render/over-scene.js");
  assert.match(over, /heavy = any\(\) && overIsHeavy\(heavy, load\)/);
  assert.match(over, /Math\.ceil\(width \/ OVER\.shrink\), Math\.ceil\(height \/ OVER\.shrink\)/);
  // On the plain screen the scene's depth is the screen's own, copied; the puffs' small picture has a depth filled from it.
  assert.match(over, /gl\.blitFramebuffer\(0, 0, w, h, 0, 0, w, h, gl\.DEPTH_BUFFER_BIT, gl\.NEAREST\)/);
  assert.match(over, /this\.lay\(this\.draw\(camera, mainScene\.fog, screenDepth\.depthTexture, w, h\)\)/);
  assert.match(over, /gl_FragDepth = texture2D\( tDepth, vUv \)\.r/);
  // The plain screen's frame is the over-scene's to draw; the lens and the anti-aliasing hand it their own depth.
  const scenery = read("../src/render/scenery.js");
  assert.match(scenery, /createOverScene\(\{ renderer, plainScreen: !\(on\.lens \|\| aa\), soft: on\.lens \}\)/);
  assert.match(scenery, /over\.present\(scene, view\)/);
  assert.match(read("../src/render/lens.js"), /over\.draw\(camera, scene\.fog, target\.depthTexture, target\.width, target\.height\)/);
  assert.match(read("../src/render/aa.js"), /over\.lay\(over\.draw\(camera, scene\.fog, flat\.depthTexture, flat\.width, flat\.height\)\)/);
});

test("the tracks' shader draws a triangle from the first frame, before any rut is laid", () => {
  // docs/VISUALS.md, "Tracks": a driver may finish building a shader at its first draw, which must not be the first rut.
  const tracks = readFileSync(new URL("../src/render/tire-tracks.js", import.meta.url), "utf8");
  assert.match(tracks, /geometry\.addGroup\(0, 6, 0\);\n  const mesh = new THREE\.Mesh\(geometry, \[material\]\);/);
  assert.match(tracks, /geometry\.addGroup\(0, Math\.max\(1, pieces\) \* 6, 0\);/);
});

test("the tracks work the fog out once a point, for three.js's fog line and for what they give the picture alike", () => {
  // docs/VISUALS.md, "Tracks": each working it out for itself held the fog's loops in the shader two and three times over.
  const tracks = readFileSync(new URL("../src/render/tire-tracks.js", import.meta.url), "utf8");
  assert.equal((tracks.match(/mtmFogOver\(/g) ?? []).length, 1);
  assert.match(tracks, /if \( mtmFog\[ 0 \]\.x > 0\.5 \) fog = trackFogged;/);
  assert.match(tracks, /const ALBEDO = \/\* glsl \*\/ `\n  trackFog\(\);/);
  assert.match(tracks, /const PATCH_ALBEDO = \/\* glsl \*\/ `\n  trackFog\(\);/);
  // Both materials lay three.js's fog line on with what was worked out.
  assert.equal((tracks.match(/\.replace\("#include <fog_fragment>", FOG_ONCE\(\)\)/g) ?? []).length, 2);
  assert.match(tracks, /fog_fragment\.replace\("mtmFogApply\( gl_FragColor\.rgb, fogColor, vFogView \)", "gl_FragColor\.rgb \* \( 1\.0 - trackFogged\.a \) \+ trackFogged\.rgb"\)/);
});

test("the ground is drawn after the rest of what is opaque, before the sky and 4x4 Evolution's forest", () => {
  // docs/VISUALS.md, "Cost": the trucks, objects and trees in front of it write their depth first, and the ground behind
  // them is not shaded.
  const scene = readFileSync(new URL("../src/render/track-scene.js", import.meta.url), "utf8");
  const [, ground, forest] = scene.match(/const GROUND_ORDER = ([\d.]+), FOREST_ORDER = ([\d.]+);/).map(Number);
  assert.ok(ground > 0 && forest > ground && forest < 1, "after what is drawn at 0, before the sky's cap at 1 and its dome at 2");
  assert.equal((scene.match(/mesh\.renderOrder = GROUND_ORDER;/g) ?? []).length, 2);
  assert.ok(scene.includes('mesh.matrixAutoUpdate = false;'), "terrain meshes are static");
  assert.match(scene, /mesh\.renderOrder = FOREST_ORDER;/);
  assert.match(scene, /cap\.renderOrder = 1;/);
  assert.match(scene, /dome\.renderOrder = 2;/);
});

test("a tire wading in the water flings a rooster tail up behind it, higher the faster its tread runs, most from a tire half under", () => {
  const r = 2.75, none = () => 0, half = () => 0.5;
  // Barely wet, it throws its sheets alone; half under, the most; wholly under, nothing out of the water.
  assert.equal(roosterWading(0.2, r), 0);
  assert.ok(Math.abs(roosterWading(r, r) - 1) < 1e-9);
  assert.equal(roosterWading(2.2 * r, r), 0);
  assert.ok(roosterWading(0.5 * r, r) < roosterWading(r, r));
  // From `fromFtS` of tread, more the faster, all of them from `fullFtS`.
  assert.equal(roosterDrops(ROOSTER.fromFtS, 1, half), 0);
  assert.equal(roosterDrops(ROOSTER.fullFtS, 1, none), ROOSTER.drops[1]);
  assert.equal(roosterDrops(80, 1, none), ROOSTER.drops[1]);
  assert.equal(roosterDrops(30, 0, half), 0);
  let last = 0;
  for (let v = 6; v <= 45; v += 3) { const n = roosterDrops(v, 1, half); assert.ok(n >= last, `${v} ft/s`); last = n; }
  // Up behind the wheel: as fast up as a share of the tread's speed, slower than the truck along its way, the higher the
  // slower, so the tail leans back from the wheel.
  const vel = [0, 0, 40], forward = [0, 1];
  let seed = 11;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const drops = Array.from({ length: 2000 }, () => roosterVelocity({ vel, forward, treadFtS: 40, random }));
  const mean = (k) => drops.reduce((sum, d) => sum + d[k], 0) / drops.length;
  assert.ok(Math.abs(mean(1) - 40 * (ROOSTER.rise[0] + ROOSTER.rise[1]) / 2) < 1, "up at the mean of `rise` of the tread");
  assert.ok(mean(2) < 40 && mean(2) > 0, "slower than the truck: the tail trails behind");
  assert.ok(Math.abs(mean(0)) < 0.3, "not out to either side");
  const ma = mean(1), mb = mean(2);
  const corr = drops.reduce((sum, d) => sum + (d[1] - ma) * (d[2] - mb), 0);
  assert.ok(corr < 0, "the higher the slower");
  // Mostly a faint plume.
  assert.ok(ROOSTER.veil > 0.5 && ROOSTER.veilOpacity < 0.2 && ROOSTER.veilWidthFt[1] > SPRAY.widthFt[1]);
});
