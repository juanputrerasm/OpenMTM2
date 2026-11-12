import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIC_SPARK_MIN_SPEED, CLASSIC_TRACK_POOL, SPARK_HIT_SPEED, SPARK_MIN_SPEED, TRACK_FADE_PIECES, TRACK_FADE_S, TRACK_LIFE_S, TRACK_FADE_SHARE, TRACK_LEDGE_FT, TRACK_LONGEST_FT, TRACK_ORDER, TRACK_POOL, TRACK_PRESS_SAME, TRACK_STEP_FT, TRACK_TRUE_FT,
  dustPuffs, dustShare, edgeHolds, greyDustOn, keepsTread, puffFrame, puffHalfSize, puffProgress, puffLife, puffSize, raisesDust, scrapeSparks, sparksForHit, sparkLevel, sparkRules, manySparksForHit, dustLevel, CLASSIC_DUST, RICH_DUST, trackLevel, trackOpacity, trackShown,
} from "../src/game/tire-effects.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test("a puff lives 1.5 to 3.5 s, starts 1.5 to 2.5 ft across and runs through twelve frames", () => {
  assert.equal(puffLife(0), 1.5);
  assert.equal(puffLife(1), 3.5);
  assert.equal(puffSize(0), 1.5);
  assert.equal(puffSize(1), 2.5);
  assert.equal(puffFrame(0, 2), 0);
  assert.equal(puffFrame(1.99, 2), 11);
  assert.equal(puffFrame(2, 2), -1);
  // Quick at first, slow at the end: the last frame holds for much longer than the first.
  assert.ok(puffFrame(0.5, 2) > 3);
  assert.equal(puffFrame(1.8, 2), 11);
  assert.ok(puffProgress(0.1) > 0.15 && puffProgress(1) === 1);
  assert.equal(puffHalfSize(2, 1, 2), 2.5);
  assert.equal(puffHalfSize(2, 9, 2), 3);
});

test("dust: only dusty ground, above 10 mph, a second puff above 20 mph with even odds", () => {
  const onGround = [true, true, false, true];
  assert.deepEqual(dustPuffs({ speedFtS: 20, onGround, dusty: false, random: () => 0 }), []);
  assert.deepEqual(dustPuffs({ speedFtS: 10, onGround, dusty: true, random: () => 0 }), []);
  assert.deepEqual(dustPuffs({ speedFtS: 20, onGround, dusty: true, random: () => 0 }), [0, 1, 3]);
  assert.deepEqual(dustPuffs({ speedFtS: 40, onGround, dusty: true, random: () => 0 }), [0, 0, 1, 1, 3, 3]);
  assert.deepEqual(dustPuffs({ speedFtS: 40, onGround, dusty: true, random: () => 0.9 }), [0, 1, 3]);
});

test("which surfaces raise dust and keep a tread: the game's surface flags (0x4de180)", () => {
  // Flag 8, dust: Cement, Dirt, Sand.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter(raisesDust), [1, 2, 5]);
  // Flag 4, tracks: Dirt, Mud, Grass, Gravel, Snow.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter(keepsTread), [2, 4, 6, 7, 9]);
  // Cement's dust is grey (concrete, asphalt).
  assert.equal(greyDustOn(1), true);
  assert.equal(greyDustOn(2), false);
  // Off Cement three quarters of a third of the puffs, elsewhere all.
  assert.equal(dustShare(1), 0.225);
  assert.equal(dustShare(2), 1);
  let n = 0;
  const r = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const count = (share) => { let c = 0; for (let i = 0; i < 2000; i++) c += dustPuffs({ speedFtS: 20, onGround: [true, true, true, true], dusty: true, random: r, share }).length; return c; };
  const full = count(1), cement = count(dustShare(1));
  assert.ok(Math.abs(cement / full - 0.225) < 0.03, `${cement} of ${full}`);
});

test("a track lasts until the ring of 65536 pieces comes round to it, fading over its oldest eighth: no clock wipes it", () => {
  assert.equal(TRACK_POOL, 65536);
  assert.equal(TRACK_FADE_SHARE, 0.125);
  assert.equal(TRACK_FADE_PIECES, 8192);
  assert.equal(trackShown(0), 1, "the newest");
  assert.equal(trackShown(TRACK_POOL - 1 - TRACK_FADE_PIECES), 1, "whole until the oldest eighth");
  near(trackShown(TRACK_POOL - 1 - TRACK_FADE_PIECES / 2), 0.5);
  assert.equal(trackShown(TRACK_POOL - 1), 0, "the piece whose place is taken next shows nothing");
  // It fades evenly, never coming back.
  let last = 1;
  for (let behind = TRACK_POOL - 1 - TRACK_FADE_PIECES; behind < TRACK_POOL; behind += 512) {
    assert.ok(trackShown(behind) <= last, `at ${behind}`);
    last = trackShown(behind);
  }
});

test("tracks are drawn after the water, whose ice a rut can lie on, and before the shade under a truck and what is thrown", () => {
  // The water is drawn at three.js's render order 0, the contact shade at 1, dust, sparks and drops at 3.
  assert.ok(TRACK_ORDER > 0 && TRACK_ORDER < 1);
});

test("a tire running straight over even ground draws on the piece it is laying, up to 15 ft, instead of beginning another", () => {
  assert.equal(TRACK_LONGEST_FT, 15);
  assert.ok(TRACK_LONGEST_FT > TRACK_STEP_FT * 4);
  assert.equal(TRACK_TRUE_FT, 0.03);
  assert.equal(TRACK_PRESS_SAME, 0.05);
  // Two points across a track running along z, [x, height, z, snow depth] each.
  const edge = (x, z, y = 0, deep = 0, lean = 0) => [[x - 1, y, z, deep], [x + 1, y + lean, z, deep]];
  // Straight and level: the place passed lies on the longer piece.
  assert.ok(edgeHolds(edge(0, 0), edge(0, 12), edge(0, 6)));
  // So it does up an even slope, and with the ground leaning across it, and in snow that deepens evenly.
  assert.ok(edgeHolds(edge(0, 0, 0), edge(0, 12, 1.2), edge(0, 6, 0.6)));
  assert.ok(edgeHolds(edge(0, 0, 0, 0, 0.3), edge(0, 12, 0, 0, 0.3), edge(0, 6, 0, 0, 0.3)));
  assert.ok(edgeHolds(edge(0, 0, 0, 0.2), edge(0, 12, 0, 0.6), edge(0, 6, 0, 0.4)));
  // A bend, a bump, a hollow, or snow that does not deepen evenly: a new piece.
  assert.equal(edgeHolds(edge(0, 0), edge(0, 12), edge(0.1, 6)), false);
  assert.equal(edgeHolds(edge(0, 0), edge(0, 12), edge(0, 6, 0.05)), false);
  assert.equal(edgeHolds(edge(0, 0), edge(0, 12), edge(0, 6, -0.05)), false);
  assert.equal(edgeHolds(edge(0, 0, 0, 0.2), edge(0, 12, 0, 0.2), edge(0, 6, 0, 0.3)), false);
  // Within a hair of the line it holds.
  assert.ok(edgeHolds(edge(0, 0), edge(0, 12), edge(0.02, 6, 0.02)));
  // A piece with no length holds nothing.
  assert.equal(edgeHolds(edge(0, 0), edge(0, 0), edge(0, 0)), false);
});

test("a track never hangs off a bridge's deck or bridges a ledge: every point within 2 ft of the ground under the tire", () => {
  assert.equal(TRACK_LEDGE_FT, 2);
  // Across a slope, or on the deck: laid.
  assert.ok(trackLevel([[0, 101.2, 0], [2.7, 98.8, 0]], 100));
  assert.ok(trackLevel([[0, 110, 0], [2.7, 110, 0]], 110));
  // One edge off the deck, down in the gully under it: not.
  assert.equal(trackLevel([[0, 110, 0], [2.7, 72, 0]], 110), false);
  assert.equal(trackLevel([[0, 102.5, 0], [2.7, 100, 0]], 100), false);
});

test("sparks: uneven while scraping at speed, none when slow, a burst for a hard hit, far fewer from tires", () => {
  const always = () => 0, never = () => 0.99;
  assert.deepEqual(scrapeSparks(0, 0.1, 30, always), { timer: 0.1, sparks: 0 });
  const r = scrapeSparks(0.1, 0.05, 30, always);
  assert.equal(r.sparks, 1, "one at most for an interval of contact");
  assert.ok(r.timer < 0.03);
  assert.equal(scrapeSparks(0.1, 0.05, 30, never).sparks, 0, "and often none");
  assert.deepEqual(scrapeSparks(0.1, 0.5, 4, always), { timer: 0, sparks: 0 });
  assert.equal(sparksForHit(500, always), 0);
  assert.equal(sparksForHit(1000, always), 2);
  assert.equal(sparksForHit(1e6, always), 10, "never a shower");
  assert.equal(sparksForHit(1e6, never), 0);
  // Over ten seconds of scraping: a few a second from bodywork, about a fifth of that from tires.
  const count = (share) => {
    let n = 0, seed = 1, t = 0;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 600; i++) { const step = scrapeSparks(t, 1 / 60, 30, random, share); t = step.timer; n += step.sparks; }
    return n;
  };
  const hull = count(1), tires = count(0.2);
  assert.ok(hull >= 25 && hull <= 55, `${hull} sparks in 10 s of bodywork`);
  assert.ok(tires >= 2 && tires <= 16 && tires < hull / 2, `${tires} sparks in 10 s of tires`);
});

test("steel strikes sparks only at a fair speed: leaning on a wall or creeping after a crash throws none", () => {
  // A scrape needs 12 ft/s of slide (about 8 mph); a hit 9 ft/s as well as its force.
  assert.equal(SPARK_MIN_SPEED, 12);
  assert.equal(SPARK_HIT_SPEED, 9);
  const always = () => 0;
  assert.equal(scrapeSparks(0.1, 0.5, 11, always).sparks, 0);
  assert.ok(scrapeSparks(0.1, 0.5, 13, always).sparks > 0);
  assert.equal(sparksForHit(5000, 8), 0, "pressed hard against a wall, barely moving");
  // The slower the hit, the fewer; from 30 ft/s on, all there are.
  assert.ok(sparksForHit(3000, 10) < sparksForHit(3000, 20) && sparksForHit(3000, 20) < sparksForHit(3000, 30));
  assert.equal(sparksForHit(3000, 30), sparksForHit(3000));
  assert.equal(sparksForHit(1e6), 28);
});

test("with Rich particles off, tracks and sparks are as the port first had them", () => {
  // A ring of 30000 pieces, each kept 70 s and fading over the last 25.
  assert.equal(CLASSIC_TRACK_POOL, 30000);
  assert.equal(TRACK_LIFE_S, 70);
  assert.equal(TRACK_FADE_S, 25);
  assert.equal(trackOpacity(0), 1);
  assert.equal(trackOpacity(45), 1);
  near(trackOpacity(57.5), 0.5);
  assert.equal(trackOpacity(70), 0);
  // A scrape throws sparks from 6 ft/s of slide.
  assert.equal(CLASSIC_SPARK_MIN_SPEED, 6);
  const always = () => 0;
  assert.ok(scrapeSparks(0.1, 0.5, 7, always, 1, CLASSIC_SPARK_MIN_SPEED).sparks > 0);
  assert.equal(scrapeSparks(0.1, 0.5, 5, always, 1, CLASSIC_SPARK_MIN_SPEED).sparks, 0);
});

test("the Sparks slider: None, Few, Normal and Many; Many is the rate before 0.5.0", () => {
  assert.equal(sparkLevel({}), 2);
  assert.equal(sparkLevel({ sparks: false, sparkAmount: 3 }), 0);
  assert.equal(sparkLevel({ sparkAmount: 1 }), 1);
  assert.equal(sparkLevel({ sparkAmount: 9 }), 2);
  assert.deepEqual(sparkRules(0), { share: 0, many: false });
  assert.deepEqual(sparkRules(1), { share: 0.5, many: false });
  assert.deepEqual(sparkRules(2), { share: 1, many: false });
  assert.deepEqual(sparkRules(3), { share: 1, many: true });
  // Before 0.5.0: two sparks every eighth of a second of scrape, and bursts of 6 + force / 250, 28 at most, from 600.
  assert.equal(scrapeSparks(0, 0.5, 30, () => 0.99, 1, 6, true).sparks, 8);
  assert.equal(manySparksForHit(500), 0);
  assert.equal(manySparksForHit(1000), 10);
  assert.equal(manySparksForHit(99999), 28);
});

test("the Dust slider: Few is the game's own puffs, Normal the port's, Many larger and longer", () => {
  assert.equal(dustLevel({}), 2);
  assert.equal(dustLevel({ dustEffects: false, dustAmount: 3 }), 0);
  assert.equal(dustLevel({ dustAmount: 1 }), 1);
  // The game: its own size, a foot of growth, its own life, a pool of 96 (MONSTER_EXE_ANALYSIS.md "Dust puffs").
  assert.deepEqual(CLASSIC_DUST[1].dust, { scale: 1, growth: 1, life: 1 });
  assert.equal(CLASSIC_DUST[1].pool, 96);
  assert.deepEqual(CLASSIC_DUST[2].dust, { scale: 2.8, growth: 14, life: 2.2 });
  for (const key of ["scale", "growth", "life"]) assert.ok(CLASSIC_DUST[3].dust[key] > CLASSIC_DUST[2].dust[key]);
  for (const key of ["scale", "life", "count"]) assert.ok(RICH_DUST[1][key] < RICH_DUST[2][key] && RICH_DUST[3][key] > RICH_DUST[2][key]);
});

test("pavement gives its dust only to a tire that asks more than the road holds; other ground always", async () => {
  const { slidingDust, DUST_COUNT } = await import("../src/game/tire-effects.js");
  const { gripDemand } = await import("../src/game/particles.js");
  assert.equal(slidingDust(1, 0), 0);
  assert.equal(slidingDust(1, 0.4), 0.4);
  assert.equal(slidingDust(1, 3), 1);
  assert.equal(slidingDust(2, 0), 1);
  assert.equal(DUST_COUNT, 0.476);
  assert.equal(RICH_DUST[2].count, 0.476);
  assert.equal(CLASSIC_DUST[1].count, 0.476);
  assert.equal(CLASSIC_DUST[2].count, 0.476);
  // A tire rolling straight within its grip asks nothing; one pushed sideways past it does.
  const rolling = { onGround: true, grip: 1000, force: [0, 0, 300], spin: 20 / 2.75 };
  assert.equal(gripDemand({ tire: rolling, forwardFtS: 20 }), 0);
  assert.ok(gripDemand({ tire: { ...rolling, force: [1200, 0, 0] }, forwardFtS: 60 }) > 0.9);
  // Its whole push forward counts while pulling away, and not at speed.
  const pushing = { onGround: true, grip: 1000, force: [0, 0, 1200], spin: 5 / 2.75 };
  assert.ok(gripDemand({ tire: pushing, forwardFtS: 5 }) > 0.9);
  assert.equal(gripDemand({ tire: { ...pushing, spin: 80 / 2.75 }, forwardFtS: 80 }), 0);
  assert.equal(gripDemand({ tire: { ...pushing, onGround: false }, forwardFtS: 5 }), 0);
  // A wheel rolling true on the simulation's 3 ft radius is not spinning, whatever size its tire is drawn.
  const { slideAmount } = await import("../src/game/particles.js");
  const fast = { onGround: true, grip: 1000, force: [0, 0, 100], spin: 30, rolls: 3 };
  assert.equal(slideAmount({ tire: fast, radiusFt: 3.6, forwardFtS: 90 }), 0);
  assert.ok(slideAmount({ tire: { ...fast, rolls: undefined }, radiusFt: 3.6, forwardFtS: 90 }) > 0);
  assert.ok(slideAmount({ tire: { ...fast, spin: 45 }, radiusFt: 3.6, forwardFtS: 90 }) > 0.9);
});
