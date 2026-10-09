import test from "node:test";
import assert from "node:assert/strict";
import { MAX_STEPS_PER_FRAME, crashDamageMessage, createCrashDamage } from "../src/game/crash-damage.js";

test("a frame's hull contacts raise the zone's level to the force's and dent once per step", () => {
  const d = createCrashDamage(2);
  const dents = [];
  const made = d.contacts(0, [{ zone: 3, steps: 2, force: 5000 }, { zone: 12, steps: 1, force: 40000 }], (zone, level) => dents.push([zone, level]));
  assert.equal(made, 3);
  assert.deepEqual(dents, [[3, 1], [3, 1], [12, 3]]);
  assert.equal(d.damaged(0), true);
  assert.equal(d.damaged(1), false);
});

test("a long stall dents at most six steps per zone, and a gentler hit does not lower the level", () => {
  const d = createCrashDamage(1);
  const dents = [];
  d.contacts(0, [{ zone: 1, steps: 100, force: 40000 }], (z, l) => dents.push(l));
  assert.equal(dents.length, MAX_STEPS_PER_FRAME);
  const code = d.code(0);
  d.contacts(0, [{ zone: 1, steps: 1, force: 10 }], (z, l) => dents.push(l));
  assert.equal(d.code(0), code);
});

test("with the switch off nothing is dented; switching off repairs every truck and says so", () => {
  const d = createCrashDamage(3);
  d.contacts(1, [{ zone: 2, steps: 1, force: 100 }], () => {});
  const repaired = [];
  assert.equal(d.toggle((i) => repaired.push(i)), false);
  assert.deepEqual(repaired, [0, 1, 2]);
  assert.equal(d.damaged(1), false);
  assert.equal(d.contacts(1, [{ zone: 2, steps: 1, force: 100 }], () => assert.fail("no dent while off")), 0);
  assert.equal(d.toggle(() => {}), true);
  assert.deepEqual([crashDamageMessage(true, 8), crashDamageMessage(false, 8), crashDamageMessage(false, 1)],
    ["Crash damage on", "Crash damage off, trucks repaired", "Crash damage off, truck repaired"]);
});
