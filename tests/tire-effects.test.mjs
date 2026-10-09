import test from "node:test";
import assert from "node:assert/strict";
import { dustPuffs, keepsTread, puffFrame, puffHalfSize, puffProgress, puffLife, puffSize, raisesDust, scrapeSparks, sparksForHit, trackOpacity } from "../src/game/tire-effects.js";

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

test("which surfaces raise dust and keep a tread", () => {
  assert.equal(raisesDust("dirt"), true);
  assert.equal(raisesDust("cement"), false);
  assert.equal(keepsTread("ice", 9), true);
  assert.equal(keepsTread("ice", 3), false);
  assert.equal(keepsTread("gravel", 7), true);
});

test("tracks fade over their last 25 s", () => {
  assert.equal(trackOpacity(0), 1);
  assert.equal(trackOpacity(45), 1);
  assert.ok(Math.abs(trackOpacity(57.5) - 0.5) < 1e-9);
  assert.equal(trackOpacity(70), 0);
});

test("sparks: two every eighth of a second of scraping at speed, none when slow, more for a harder hit", () => {
  assert.deepEqual(scrapeSparks(0, 0.1, 30), { timer: 0.1, sparks: 0 });
  let r = scrapeSparks(0.1, 0.05, 30);
  assert.equal(r.sparks, 2);
  assert.ok(r.timer < 0.03);
  assert.deepEqual(scrapeSparks(0.1, 0.5, 2), { timer: 0, sparks: 0 });
  assert.equal(sparksForHit(300), 0);
  assert.ok(sparksForHit(3000) > sparksForHit(700));
});
