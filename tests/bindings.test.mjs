import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, DEFAULT_BINDINGS, codeLabel, conflictFor, mergeBindings } from "../src/game/input/bindings.js";
import { createKeyboardInput } from "../src/game/input/keyboard.js";

test("bindings: defaults, overrides, and bad saved data falls back", () => {
  assert.deepEqual(mergeBindings({}).accelerate, ["ArrowUp", "KeyW"]);
  assert.deepEqual(mergeBindings({}).horn, ["Space"]);
  assert.deepEqual(mergeBindings({}).camera, ["KeyV"]);
  assert.deepEqual(mergeBindings({ accelerate: ["KeyI"] }).accelerate, ["KeyI"]);
  assert.deepEqual(mergeBindings({ accelerate: [] }).accelerate, [...DEFAULT_BINDINGS.accelerate]);
  assert.deepEqual(mergeBindings({ brake: "x", bogus: ["KeyZ"] }).brake, [...DEFAULT_BINDINGS.brake]);
  assert.equal(Object.keys(mergeBindings(null)).length, ACTIONS.length);
});

test("bindings: conflicts and labels", () => {
  const b = mergeBindings({});
  assert.equal(conflictFor(b, "KeyW", "brake"), "accelerate");
  assert.equal(conflictFor(b, "KeyW", "accelerate"), null);
  assert.equal(codeLabel("KeyW"), "W");
  assert.equal(codeLabel("ArrowUp"), "Up Arrow");
  assert.equal(codeLabel("PageUp"), "Page Up");
});

test("the keyboard follows rebinding", () => {
  const listeners = {};
  const target = { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {} };
  const input = createKeyboardInput(target, { accelerate: ["KeyI"], helicopter: ["KeyJ"] });
  listeners.keydown({ code: "KeyI", repeat: false, preventDefault() {} });
  listeners.keydown({ code: "KeyW", repeat: false, preventDefault() {} });
  listeners.keydown({ code: "KeyJ", repeat: false, preventDefault() {} });
  const held = input.sample();
  assert.equal(held.accelerate, true);
  assert.equal(held.helicopter, true);
  listeners.keyup({ code: "KeyI" });
  assert.equal(input.sample().accelerate, false);
});
