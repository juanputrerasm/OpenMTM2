import test from "node:test";
import assert from "node:assert/strict";
import {
  hornSample, objectHitSound, impactSound, engineVoices, gearSound, loopRegion, nextDelay, skidAmount, surfaceFamily,
  skidSurface, cornerSample, spinSample, variantPicker, tireSliding, spinAction, splashGain, wadeGain, bridgeVoice,
} from "../src/game/sound-model.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("engine: idle alone below 1000 revs, fading to the running loops by 3000", () => {
  const idle = engineVoices({ rpm: 800, throttle: 0 });
  near(idle.idle.gain, 0.97);
  near(idle.mid.gain, 0);
  near(idle.accel.gain, 0);
  const mid = engineVoices({ rpm: 2000, throttle: 0 });
  near(mid.idle.gain, 0.97 * 0.5);
  const running = engineVoices({ rpm: 3500, throttle: 0 });
  near(running.idle.gain, 0);
  assert.ok(running.mid.gain > 0.5 && running.accel.gain > 0.1);
});

test("engine: pitch halves the excursion of revs over 3700, within 0.625 to 1.6", () => {
  near(engineVoices({ rpm: 3700, throttle: 0 }).mid.rate, 1);
  near(engineVoices({ rpm: 5550, throttle: 0 }).mid.rate, 1.25);
  near(engineVoices({ rpm: 40000, throttle: 0 }).mid.rate, 1.6);
  near(engineVoices({ rpm: 1850, throttle: 0 }).mid.rate, 1 / 1.5);
  near(engineVoices({ rpm: 100, throttle: 0 }).mid.rate, 0.625);
  // Airborne wheels free-rev 2% each; the accel loop plays at 0.65 of the mid one's rate.
  near(engineVoices({ rpm: 3700, throttle: 0, airborne: 4 }).mid.rate, 1 + 0.5 * 0.08);
  near(engineVoices({ rpm: 5550, throttle: 0 }).accel.rate, 1.25 * 0.65);
  // The wobble is plus or minus 0.07.
  near(engineVoices({ rpm: 3700, throttle: 0, random: 1 }).mid.rate, 1.07);
  near(engineVoices({ rpm: 3700, throttle: 0, random: 0 }).mid.rate, 0.93);
});

test("engine: the throttle crossfades the mid loop into the accel loop, and the countdown holds the revs back", () => {
  const coast = engineVoices({ rpm: 6500, throttle: 0 });
  const floor = engineVoices({ rpm: 6500, throttle: 1 });
  assert.ok(floor.accel.gain > coast.accel.gain);
  assert.ok(floor.mid.gain < coast.mid.gain);
  // Through the first 1.5 s of the countdown only the idle loop plays, whatever the revs.
  const held = engineVoices({ rpm: 4000, throttle: 1, raceClock: 1 });
  near(held.idle.gain, 0.97);
  near(held.mid.gain, 0);
  const go = engineVoices({ rpm: 4000, throttle: 1, raceClock: 3 });
  near(go.idle.gain, 0);
  // Other trucks are quieter.
  near(engineVoices({ rpm: 800, throttle: 0, player: false }).idle.gain, 0.85);
});

test("skids: the families follow the game's ground types; a tire's slip measure", () => {
  assert.deepEqual([1, 2, 3, 7, 10, 12].map(surfaceFamily), ["cement", "dirt", "ice", "gravel", "rock", "gravel"]);
  const gripping = { onGround: true, grip: 1000, force: [300, 0, 300] };
  const sliding = { onGround: true, grip: 1000, force: [900, 0, 700] };
  assert.equal(skidAmount(gripping), 0);
  assert.ok(skidAmount(sliding) > 0.3);
  assert.equal(skidAmount({ onGround: false, grip: 1000, force: [9999, 0, 0] }), 0);
});

test("skid samples are MTM2's own by surface (0x41db00, 0x41d2b0), never MTM1's", () => {
  const one = () => 1;
  assert.deepEqual(cornerSample(100, one), { name: "SKID-C2", gain: 0.7 });
  assert.deepEqual(cornerSample(0, one), { name: "SKID-C2", gain: 0.7 });
  assert.deepEqual(cornerSample(500, () => 2), { name: "SKID-D2", gain: 1.1 });
  assert.deepEqual(cornerSample(1200, () => 3), { name: "SKID-G3", gain: 1.3 });
  assert.deepEqual(cornerSample(1300, one), { name: "SNWSKID5", gain: 0.35 });
  assert.equal(cornerSample(1100, one).name, "CORNROC1");
  assert.equal(cornerSample(-1, one), null);
  assert.deepEqual(spinSample(900, one), { name: "SPINICE", gain: 1 });
  assert.deepEqual(spinSample(1400, () => 2), { name: "SPINROC2", gain: 1 });
  assert.deepEqual(spinSample(600, one), { name: "SKID-D1", gain: 1.1 });
  assert.deepEqual(spinSample(100, one), { name: "SKID-C2", gain: 0.7 });
  const mtm1 = /^(CORN(CEM|DIR|ICE)|SPIN(CEM|DIR)|SKID(CEM|DIR|ICE|ROC))/;
  for (let code = 0; code <= 1400; code += 100) {
    for (const pick of [() => 1, () => 2, () => 3]) {
      assert.doesNotMatch(cornerSample(code, pick).name, mtm1);
      assert.doesNotMatch(spinSample(code, pick).name, mtm1);
    }
  }
});

test("a skid's surface is the rear tire's type, -1 in the air, and snow in Snow but for 1400", () => {
  assert.equal(skidSurface(214), 200);
  assert.equal(skidSurface(214, false), -1);
  assert.equal(skidSurface(100, true, 5), 900);
  assert.equal(skidSurface(1300, true, 5), 800);
  assert.equal(skidSurface(1400, true, 5), 1400);
});

test("a variant is never the one played last", () => {
  const values = [0.1, 0.1, 0.1, 0.9];
  const pick = variantPicker(() => values.shift() ?? 0.5);
  assert.equal(pick("d", 2), 1);
  assert.equal(pick("d", 2), 2);
});

test("a tire slides past 0.975 of the curve, stops below 0.95, and only above 29.34 ft/s", () => {
  assert.equal(tireSliding(false, { onGround: true, lateral: 0.98 }, 40), true);
  assert.equal(tireSliding(false, { onGround: true, lateral: -0.96 }, 40), false);
  assert.equal(tireSliding(true, { onGround: true, lateral: -0.96 }, 40), true);
  assert.equal(tireSliding(true, { onGround: true, lateral: 0.9 }, 40), false);
  assert.equal(tireSliding(true, { onGround: true, lateral: 1 }, 20), false);
  assert.equal(tireSliding(true, { onGround: false, lateral: 1 }, 40), false);
});

test("wheelspin: full throttle on dust between 1 and 58.68 ft/s starts it; letting go stops every skid; braking has none", () => {
  const dirt = [{ onGround: true, surface: 200 }], grass = [{ onGround: true, surface: 600 }];
  assert.equal(spinAction({ throttle: 1, wasThrottle: 1, forward: 20, tires: dirt }), "start");
  assert.equal(spinAction({ throttle: 1, wasThrottle: 1, forward: 20, tires: grass }), null);
  assert.equal(spinAction({ throttle: 0.9, wasThrottle: 0.9, forward: 20, tires: dirt }), null);
  assert.equal(spinAction({ throttle: 0, wasThrottle: 1, forward: 20, tires: dirt }), "stop");
  assert.equal(spinAction({ throttle: 1, wasThrottle: 1, forward: 0.5, tires: dirt }), "stop");
  assert.equal(spinAction({ throttle: 1, wasThrottle: 1, forward: 80, tires: dirt }), null);
  assert.equal(spinAction({ throttle: 1, wasThrottle: 1, forward: 110, tires: dirt }), "stop");
});

test("water: the splash by how fast the truck comes down, the wading loop by its speed; bridges by speed", () => {
  near(splashGain(-9), 1.1);
  assert.equal(splashGain(-30), 1.7);
  assert.equal(splashGain(2), null);
  near(wadeGain(5), 0.6);
  assert.equal(wadeGain(50), 1.2);
  assert.equal(bridgeVoice(1), null);
  near(bridgeVoice(30).gain, 0.5);
  near(bridgeVoice(18).rate, 0.3);
  assert.equal(bridgeVoice(200).gain, 1.4);
});

test("crashes, landings, gears, ambience timers and loop points", () => {
  assert.equal(impactSound(300), null);
  assert.deepEqual([impactSound(5000, false, () => 1).name, impactSound(5000, false, () => 2).name], ["SUSPEN5", "SUSPEN6"]);
  assert.deepEqual([impactSound(5000, true, () => 1).name, impactSound(5000, true, () => 2).name], ["SUSPEN1", "SUSPEN3"]);
  assert.equal(impactSound(60000).gain, 1.8);
  assert.equal(gearSound(4, 5), "2NDGEAR");
  assert.equal(gearSound(5, 6), "3RDGEAR");
  assert.equal(gearSound(6, 5), null);
  near(nextDelay(1, 80, () => 0.5), 40.5);
  assert.deepEqual(loopRegion({ loops: [{ start: 86339, end: null }] }, 100000), { start: 86339, end: 100000 });
  assert.equal(loopRegion({ loops: [{ start: 500, end: 100 }] }, 1000), null);
  assert.equal(loopRegion(null, 1000), null);
});

test("objects: their own hit sound, or by type, louder or softer by what they are (0x428bc0)", () => {
  assert.deepEqual(objectHitSound({ hitSound: "fenceht7.wav", type: 2 }), { name: "fenceht7", gain: 1 });
  assert.deepEqual(objectHitSound({ hitSound: null, type: 4 }), { name: "pylon", gain: 1 });
  assert.deepEqual(objectHitSound({ hitSound: null, type: 1 }), { name: "hitPost1", gain: 1 });
  assert.deepEqual(objectHitSound({ hitSound: "cowpain.wav", type: 2 }), { name: "cowpain", gain: 4 });
  assert.deepEqual(objectHitSound({ hitSound: "strike1.wav", type: 2 }), { name: "strike1", gain: 3 });
  assert.deepEqual(objectHitSound({ hitSound: "hay.wav", type: 3 }), { name: "hay", gain: 0.6 });
  assert.equal(objectHitSound({ hitSound: null, type: 7 }), null);
});

test("the horn: horn1 alone, or the kooky horn's three without a repeat", () => {
  assert.equal(hornSample(false).name, "HORN1");
  assert.equal(hornSample(true, -1, () => 0.5).name, "HORN-A");
  const seq = [0.5, 0.1];
  assert.equal(hornSample(true, 1, () => seq.shift()).name, "HORN1");
  assert.equal(hornSample(true, -1, () => 0.9).gain, 1.5);
});

import { INAUDIBLE_GAIN, MAX_VOICES, attenuation, cullVoices, soundRange } from "../src/game/sound-model.js";

test("a positioned sound fades like 1 - sqrt(d / range) and is silent at the range", () => {
  assert.equal(attenuation(0, 1000), 1);
  assert.ok(Math.abs(attenuation(250, 1000) - 0.5) < 1e-9);
  assert.equal(attenuation(1000, 1000), 0);
  assert.equal(attenuation(4000, 1000), 0);
});

test("the weather sets the audible range", () => {
  assert.deepEqual([0, 2, 3, 4, 5, 7].map(soundRange), [1000, 500, 300, 800, 700, 1000]);
});

test("only the loudest sixteen audible sounds are kept", () => {
  const levels = Array.from({ length: 20 }, (_, i) => (i + 1) / 40);
  const keep = cullVoices(levels);
  assert.equal(keep.filter(Boolean).length, MAX_VOICES);
  assert.equal(keep[19], true);
  assert.equal(keep[0], false);
  const faint = cullVoices([INAUDIBLE_GAIN / 2, 0.5]);
  assert.deepEqual(faint, [false, true]);
});

import { lenientKlp } from "../src/game/sound-model.js";
test("ACCEL3B.KLP, which promises five loops and lists four, loops its tail from sample 11828", () => {
  const bytes = new TextEncoder().encode("3\r\n5\r\n0 11828\r\n0 11828\r\n13631 11828\r\n0 11828\r\n");
  const klp = lenientKlp(bytes);
  assert.deepEqual(klp, { loops: [{ start: 11828, end: null }] });
  assert.deepEqual(loopRegion(klp, 18686), { start: 11828, end: 18686 });
  assert.equal(lenientKlp(new TextEncoder().encode("1 5")), null);
});

test("a sound that was mixed keeps its place against one only a little louder", () => {
  const levels = Array.from({ length: 17 }, () => 0.5);
  levels[16] = 0.55;
  const held = levels.map((_, i) => i < 16);
  assert.equal(cullVoices(levels, 16, held)[16], false);
  levels[16] = 0.9;
  assert.equal(cullVoices(levels, 16, held)[16], true);
});

test("the echo under cover (MONSTER_EXE_ANALYSIS.md 12, 0x41cd50): nine points 10 ft apart, the middle twice", async () => {
  const { echoTaps, coverFor, NO_ECHO } = await import("../src/game/sound-model.js");
  // Under a roof all round: n = 10, 0.1 s at 1.1 (the mixer holds it to 1) and 0.225 s at 0.7.
  const all = echoTaps({ pos: [100, 5, 100], covered: () => true });
  assert.equal(all.length, 2);
  near(all[0].delayS, 0.1); near(all[0].gain, 1.1);
  near(all[1].delayS, 0.225); near(all[1].gain, 0.7);
  // Only the middle covered counts two; only one corner, one.
  near(echoTaps({ pos: [100, 5, 100], covered: (x, y, z) => x === 100 && z === 100 })[0].gain, 0.22);
  near(echoTaps({ pos: [100, 5, 100], covered: (x, y, z) => x === 110 && z === 110 })[1].gain, 0.07);
  // The points are at the source's height.
  echoTaps({ pos: [0, 7.5, 0], covered: (x, y) => { assert.equal(y, 7.5); return false; } });
  assert.equal(echoTaps({ pos: [0, 0, 0], covered: () => false }), NO_ECHO);
  // Under water: one tap only when both the source and the listener are under; none for either alone, cover or not.
  assert.deepEqual(echoTaps({ pos: [0, 0, 0], covered: () => true, sourceUnder: true, listenerUnder: true }), [{ delayS: 0.4, gain: 0.4 }]);
  assert.equal(echoTaps({ pos: [0, 0, 0], covered: () => true, sourceUnder: true }), NO_ECHO);
  assert.equal(echoTaps({ pos: [0, 0, 0], covered: () => true, listenerUnder: true }), NO_ECHO);
  // OpenMTM2's models count only where the source itself is under one.
  assert.equal(coverFor([0, 0, 0], { meshAbove: (x) => x !== 0 }), null);
  assert.equal(coverFor([0, 0, 0], { meshAbove: () => true })(10, 0, 10), true);
});
