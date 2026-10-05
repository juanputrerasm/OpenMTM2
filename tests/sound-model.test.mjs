import test from "node:test";
import assert from "node:assert/strict";
import { hornSample, objectHitSound, crashSound, engineVoices, gearSound, landingSound, loopRegion, nextDelay, skidAmount, skidSample, surfaceFamily } from "../src/game/sound-model.js";

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

test("skids: the families follow the game's ground types and choose their samples", () => {
  assert.deepEqual([1, 2, 3, 7, 10, 12].map(surfaceFamily), ["cement", "dirt", "ice", "gravel", "rock", "gravel"]);
  assert.equal(skidSample({ type: 1, spinning: false, speed: 20 }), "SKID-C2");
  assert.equal(skidSample({ type: 1, spinning: false, speed: 60 }), "CORNCEM1");
  assert.equal(skidSample({ type: 2, spinning: true, speed: 5, pick: () => 2 }), "SPINDIR2");
  assert.equal(skidSample({ type: 9, spinning: false, speed: 20, pick: () => 1 }), "SNWSKID5");
  assert.equal(skidSample({ type: 7, spinning: false, speed: 20, pick: () => 3 }), "SKID-G3");
  const gripping = { onGround: true, grip: 1000, force: [300, 0, 300] };
  const sliding = { onGround: true, grip: 1000, force: [900, 0, 700] };
  assert.equal(skidAmount(gripping), 0);
  assert.ok(skidAmount(sliding) > 0.3);
  assert.equal(skidAmount({ onGround: false, grip: 1000, force: [9999, 0, 0] }), 0);
});

test("crashes, landings, gears, ambience timers and loop points", () => {
  assert.equal(crashSound(300), null);
  assert.equal(crashSound(1000).name, "THUNKIT");
  assert.equal(crashSound(5000).name, "CRUNCHX");
  assert.match(crashSound(30000, () => 2).name, /^CRASH_/);
  assert.equal(crashSound(60000).gain, 1);
  assert.equal(landingSound(5), null);
  assert.match(landingSound(30).name, /^SUSPEN/);
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
