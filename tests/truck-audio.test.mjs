import test from "node:test";
import assert from "node:assert/strict";
import { createTruckAudio } from "../src/audio/truck-audio.js";

/** An audio stand-in that records what is started. */
function recorder() {
  const plays = [];
  const voice = () => ({ stopped: false, done: Promise.resolve(), setGain() {}, setRate() {}, setPosition() {}, stop() { this.stopped = true; } });
  return { plays, preload() {}, play: async (name, options) => { plays.push({ name, ...options }); return voice(); } };
}

const tire = (more = {}) => ({ onGround: true, grip: 1000, force: [0, 0, 0], spin: 0, surface: 200, lateral: 0, ...more });
const sound = (more = {}) => ({
  rpm: 2000, throttle: 0, brake: 0, gear: 4, airborne: 0, forward: 30, speed: 30, impact: 0, hit: null, clearance: 0,
  splash: false, tires: [tire(), tire(), tire(), tire()], surface: 2, heli: false, weather: 0, inWater: false, vy: 0, ...more,
});
const pose = (s) => ({ current: { pos: [0, 0, 0] }, sound: s });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("going into water splashes with SPLASH1, never the menu song SPLASH", async () => {
  const audio = recorder();
  const trucks = createTruckAudio(audio, { count: 1, random: () => 0.5 });
  trucks.update(1 / 60, [pose(sound())], [0, 0, 0], 10);
  trucks.update(1 / 60, [pose(sound({ inWater: true, vy: -20, splash: true }))], [0, 0, 0], 10);
  await settle();
  const names = audio.plays.map((p) => p.name);
  assert.ok(names.includes("SPLASH1"));
  assert.ok(names.includes("WTR-ABV1"));
  assert.ok(!names.includes("SPLASH"));
});

test("a truck that goes into water while heard from under water has no wading loop, and the frame does not throw", async () => {
  const audio = recorder();
  const trucks = createTruckAudio(audio, { count: 1, random: () => 0.5 });
  const under = { listenerUnder: true };
  trucks.update(1 / 60, [pose(sound())], [0, 0, 0], 10, [], under);
  // The chase camera under the water as the truck wades in (Voodoo Island): this threw on the missing loop.
  assert.doesNotThrow(() => trucks.update(1 / 60, [pose(sound({ inWater: true, vy: -20 }))], [0, 0, 0], 10, [], under));
  assert.doesNotThrow(() => trucks.update(1 / 60, [pose(sound({ inWater: true }))], [0, 0, 0], 10, [], under));
  await settle();
  assert.ok(!audio.plays.some((p) => p.name === "WTR-ABV1"));
  // Back above the water, it starts.
  trucks.update(1 / 60, [pose(sound({ inWater: true }))], [0, 0, 0], 10);
  await settle();
  assert.ok(audio.plays.some((p) => p.name === "WTR-ABV1"));
});

test("braking hard makes no skid sound; a sliding tire starts the rear corner loops", async () => {
  const audio = recorder();
  const trucks = createTruckAudio(audio, { count: 1, random: () => 0.5 });
  for (let k = 0; k < 10; k++) trucks.update(1 / 60, [pose(sound({ brake: 1, speed: 40, forward: 40, tires: [tire({ force: [0, 0, -2000] }), tire(), tire(), tire()] }))], [0, 0, 0], 10);
  await settle();
  assert.deepEqual(audio.plays.filter((p) => p.loop && /SKID|SPIN/.test(p.name)), []);
  trucks.update(1 / 60, [pose(sound({ speed: 40, forward: 40, tires: [tire({ lateral: 0.99 }), tire(), tire(), tire()] }))], [0, 0, 0], 10);
  await settle();
  assert.equal(audio.plays.filter((p) => p.loop && /^SKID-D/.test(p.name)).length, 2);
});

test("with MTM1 sounds braking hard skids once a rear tire, and a slide plays MTM1's corner from the RL tire alone", async () => {
  const audio = recorder();
  const trucks = createTruckAudio(audio, { count: 1, random: () => 0.5, mtm1Sounds: true });
  trucks.update(1 / 60, [pose(sound({ speed: 40, forward: 40 }))], [0, 0, 0], 10);
  trucks.update(1 / 60, [pose(sound({ speed: 40, forward: 40, brake: 1 }))], [0, 0, 0], 10);
  trucks.update(1 / 60, [pose(sound({ speed: 40, forward: 40, brake: 1 }))], [0, 0, 0], 10);
  await settle();
  assert.deepEqual(audio.plays.filter((p) => /^SKIDDIR/.test(p.name)).map((p) => p.name), ["SKIDDIR2", "SKIDDIR2"]);
  trucks.update(1 / 60, [pose(sound({ speed: 40, forward: 40, tires: [tire({ lateral: 0.99 }), tire(), tire(), tire()] }))], [0, 0, 0], 10);
  await settle();
  assert.deepEqual(audio.plays.filter((p) => p.loop && /^CORN/.test(p.name)).map((p) => p.name), ["CORNDIR1"]);
});
