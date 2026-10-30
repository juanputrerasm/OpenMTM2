/*
  AI Speed, from Community Patch 3 (docs/CP3_EXE_ANALYSIS.md 5; game/ai-speed.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { AI_SPEED, aiSpeedFactor, aiSpeedPercent, effectiveAiSpeed } from "../src/game/ai-speed.js";
import { DEFAULT_SETTINGS } from "../src/app/settings.js";

test("AI Speed is a whole percent, 70 to 130, default 100", () => {
  assert.equal(AI_SPEED.default, 100);
  assert.equal(DEFAULT_SETTINGS.aiSpeed, 100);
  assert.equal(aiSpeedPercent(50), 70);
  assert.equal(aiSpeedPercent(200), 130);
  assert.equal(aiSpeedPercent(114.6), 115);
  assert.equal(aiSpeedPercent(undefined), 100);
  assert.equal(aiSpeedPercent("x"), 100);
});

test("the simulation scales only when the factor is not 1", () => {
  assert.equal(aiSpeedFactor(100), null);
  assert.equal(aiSpeedFactor(70), 0.7);
  assert.equal(aiSpeedFactor(130), 1.3);
  assert.equal(aiSpeedFactor(10), 0.7);
});

test("a running tournament's AI Speed comes first and is shown locked", () => {
  assert.deepEqual(effectiveAiSpeed({ setting: 90 }), { percent: 90, locked: false });
  assert.deepEqual(effectiveAiSpeed({ setting: 90, tournament: 120 }), { percent: 120, locked: true });
  assert.deepEqual(effectiveAiSpeed({ setting: 90, tournament: null }), { percent: 90, locked: false });
  assert.deepEqual(effectiveAiSpeed({ setting: 90, room: 75 }), { percent: 75, locked: true });
});
