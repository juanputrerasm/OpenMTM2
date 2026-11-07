/*
  Two trucks meeting (MONSTER_EXE_ANALYSIS.md, sounds: 0x429cb0 from the pair test 0x4894a0): `crash1` at x1.3, a random
  pitch from 0.9 to 1.1, from the player's truck when it is one of them, else the second's, under the world one-shots'
  water mix. The port starts one a meeting, not every step the trucks push on each other.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { CRASH_APART_S, CRASH_MIN_FT_S, TRUCK_CRASH_GAIN, truckCrashSound } from "../src/game/sound-model.js";
import { closingSpeedOf } from "../src/worker/sim-worker.js";
import { createWorldAudio } from "../src/audio/world-audio.js";
import { createTruckAudio } from "../src/audio/truck-audio.js";
import { createSilentAudio } from "../src/audio/audio-engine.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("the crash: crash1 at x1.3, its pitch at random from 0.9 to 1.1", () => {
  assert.deepEqual(truckCrashSound(() => 0), { name: "CRASH1", gain: 1.3, rate: 0.9 });
  assert.ok(Math.abs(truckCrashSound(() => 0.999999).rate - 1.1) < 1e-5);
  assert.equal(TRUCK_CRASH_GAIN, 1.3);
  assert.ok(CRASH_APART_S > 0 && CRASH_MIN_FT_S > 0);
});

test("the closing speed: along the line between the trucks, going apart negative", () => {
  const still = (pos, bvel = [0, 0, 0]) => ({ pos, bvel, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
  assert.equal(closingSpeedOf(still([0, 0, 0], [0, 0, 30]), still([0, 0, 10])), 30);
  assert.equal(closingSpeedOf(still([0, 0, 0], [0, 0, -30]), still([0, 0, 10])), -30);
  assert.equal(closingSpeedOf(still([0, 0, 0], [30, 0, 0]), still([0, 0, 10])), 0, "passing side by side");
  assert.equal(closingSpeedOf(still([0, 0, 0], [0, 0, 30]), still([0, 0, 10], [0, 0, 30])), 0, "the same way at the same speed");
});

test("the world plays it at the under-water mix; the truck audio passes a crash on, from its truck", async () => {
  const plays = [];
  const audio = { ...createSilentAudio(), play: async (name, options) => { plays.push({ name, ...options }); return null; } };
  const world = createWorldAudio(audio, { ambient: null, weather: 0, music: null, random: () => 0.5 });
  world.crash([1, 2, 3]);
  assert.deepEqual(plays.at(-1), { name: "CRASH1", gain: 1.3, rate: 1, position: [1, 2, 3] });
  world.setListener({ underwater: true });
  world.crash(null);
  assert.ok(Math.abs(plays.at(-1).gain - 1.3 * 0.2) < 1e-9, "heard from under water, the source in the air");
  assert.ok(plays.at(-1).rate < 1);
  world.dispose();
  const crashes = [];
  const trucks = createTruckAudio({ ...createSilentAudio(), play: async () => null }, { count: 2, random: () => 0.5, onCrash: (pos, own, speed) => crashes.push({ own, speed }) });
  const s = { rpm: 2000, throttle: 0, brake: 0, gear: 4, airborne: 0, forward: 0, speed: 0, impact: 0, hit: null, clearance: 0, splash: false, tires: [], surface: 2, heli: false, weather: 0, inWater: false, vy: 0 };
  trucks.update(1 / 60, [{ current: { pos: [0, 0, 0] }, sound: { ...s, crash: 25 } }, { current: { pos: [5, 0, 0] }, sound: { ...s } }], [0, 0, 0], 10);
  assert.deepEqual(crashes, [{ own: true, speed: 25 }]);
  trucks.dispose();
});

test("a ram in the worker: one crash from the player's truck a meeting; none for a nudge", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const { createSession } = await import("../src/worker/sim-worker.js");
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const files = Object.keys(build.truckModels);
  const g = build.sim.grid[0];
  const fwd = [Math.sin(g.heading), Math.cos(g.heading)];
  const ram = (speed) => {
    const session = createSession({
      heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
      ra0: build.sim.ra0?.buffer, ra1: build.sim.ra1?.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
      waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1, course: build.sim.course,
      trucks: [0, 1].map((i) => ({
        truck: { anchors: build.truckModels[files[i]].anchors, scrapePoints: build.truckModels[files[i]].scrapePoints },
        start: { pos: [g.pos[0] + fwd[0] * 40 * i, g.pos[1], g.pos[2] + fwd[1] * 40 * i], heading: g.heading }, autopilot: false,
      })),
      race: null,
    });
    for (let k = 0; k < 120; k++) session.step({});
    session.trucks[0].state.bvel[2] = speed;
    const crashes = [[], []];
    for (let k = 0; k < 120; k++) {
      session.step({});
      session.trucks.forEach((t, i) => { if (t.snd.crash > 0) crashes[i].push(t.snd.crash); t.snd.crash = 0; });
    }
    return crashes;
  };
  const hard = ram(40);
  assert.equal(hard[0].length, 1, `one crash: ${hard[0]}`);
  assert.ok(hard[0][0] >= 20, `closing at ${hard[0][0]} ft/s`);
  assert.equal(hard[1].length, 0, "sent from the player's truck only");
  const nudge = ram(4);
  assert.equal(nudge[0].length, 0);
});
