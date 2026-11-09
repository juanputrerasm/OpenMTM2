import test from "node:test";
import assert from "node:assert/strict";
import { choosePad, createGamepadInput, motorLevel, RUMBLE_TIMING, padPedalAxis } from "../src/game/input/gamepad.js";
import { PAD, pickInDirection } from "../src/ui/gamepad-nav.js";
import { bindPadButton, mergePadBindings, padConflictFor, padKeyButtons, newPress } from "../src/game/input/pad-bindings.js";
import { applyJoystick } from "../src/vendor/openphotex/sim/mtm2/truck/controls.js";

const pad = ({ mapping = "standard", stickY = 0, rt = 0, lt = 0 } = {}) => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  buttons[6] = { pressed: lt > 0, value: lt };
  buttons[7] = { pressed: rt > 0, value: rt };
  return { connected: true, mapping, axes: [0, stickY, 0, 0], buttons };
};

test("gamepad pedals: triggers only by default, the stick steers alone", () => {
  assert.equal(padPedalAxis(pad({ stickY: -0.6 })), 0);
  assert.equal(padPedalAxis(pad({ stickY: 0.6, rt: 0.8 })), -0.8);
  assert.equal(padPedalAxis(pad({ lt: 0.5 }), "triggers"), 0.5);
});

test("gamepad pedals: the stick, and both", () => {
  assert.equal(padPedalAxis(pad({ stickY: -0.6, rt: 1 }), "stick"), -0.6);
  assert.equal(padPedalAxis(pad({ stickY: -0.6 }), "both"), -0.6);
  assert.equal(padPedalAxis(pad({ stickY: -0.6, lt: 0.3 }), "both"), 0.3);
});

test("gamepad pedals: a pad without the standard mapping drives with its stick", () => {
  assert.equal(padPedalAxis(pad({ mapping: "", stickY: -0.7, rt: 1 }), "triggers"), -0.7);
});

test("gamepad: the standard pad is preferred and the choice is read at each sample", () => {
  let choice = "triggers";
  const pads = [pad({ mapping: "", stickY: 0.4 }), pad({ stickY: -0.5, rt: 0.2 })];
  const input = createGamepadInput({ getGamepads: () => pads }, () => choice);
  assert.equal(input.sample().y, -0.2);
  choice = "stick";
  assert.equal(input.sample().y, -0.5);
  assert.equal(createGamepadInput({ getGamepads: () => [] }).sample(), null);
});

test("steering response: the stick's curve is x ^ (1 + 2r), r a tenth of MONSTER.INI steeringResponse", () => {
  const steerAt = (r) => {
    const c = { gear: 2 };
    applyJoystick(c, { x: 0.5 / 1.11, y: 0, deadZone: 0 }, { forwardSpeed: 0, steeringResponse: r, autoShift: true });
    return c.steer / 0.45;
  };
  assert.ok(Math.abs(steerAt(1) - 0.5 ** 3) < 1e-9);
  assert.ok(Math.abs(steerAt(0.5) - 0.5 ** 2) < 1e-9);
  assert.ok(Math.abs(steerAt(0) - 0.5) < 1e-9);
});

test("gamepad: the standard pad is chosen over another, and none is null", () => {
  const odd = pad({ mapping: "" }), standard = pad();
  assert.equal(choosePad([null, odd, standard]), standard);
  assert.equal(choosePad([odd]), odd);
  assert.equal(choosePad([{ connected: false }]), null);
});

test("gamepad: the Evo handbrake is the D-pad's down, held", () => {
  const p = pad();
  p.buttons[13] = { pressed: true, value: 1 };
  assert.equal(createGamepadInput({ getGamepads: () => [p] }).sample().handbrake, true);
  assert.equal(createGamepadInput({ getGamepads: () => [pad()] }).sample().handbrake, false);
});

test("gamepad menus: the nearest control that way, across counting double", () => {
  const box = (left, top) => ({ left, top, width: 100, height: 40 });
  const from = box(0, 0);
  const rects = [box(0, 100), box(300, 60), box(200, 0), box(-200, 0)];
  assert.equal(pickInDirection(from, rects, "down"), 0);
  assert.equal(pickInDirection(from, rects, "right"), 2);
  assert.equal(pickInDirection(from, rects, "left"), 3);
  assert.equal(pickInDirection(from, rects, "up"), -1);
});

test("gamepad race buttons: Y helicopter, X camera, A dashboard, B map, Start pause by default", () => {
  const keys = padKeyButtons(mergePadBindings(null));
  assert.equal(keys.get(PAD.Y), "helicopter");
  assert.equal(keys.get(PAD.X), "camera");
  assert.equal(keys.get(PAD.A), "dashboard");
  assert.equal(keys.get(PAD.B), "map");
  assert.equal(keys.get(PAD.START), "pause");
  // The shifts, the Emergency Brake and the zoom are read by the driving input, not pressed as keys.
  assert.equal(keys.get(PAD.RB), undefined);
});

test("gamepad bindings: a button given to an action leaves the action that had it", () => {
  const saved = bindPadButton(null, "handbrake", PAD.B);
  const b = mergePadBindings(saved);
  assert.deepEqual(b.handbrake, [PAD.B]);
  assert.deepEqual(b.map, []);
  assert.equal(padConflictFor(b, PAD.B, "map"), "handbrake");
  assert.equal(padKeyButtons(b).get(PAD.B), undefined);
  // The shift goes on the bound button.
  const pads = [{ connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === PAD.A, value: i === PAD.A ? 1 : 0 })) }];
  const input = createGamepadInput({ getGamepads: () => pads }, () => "triggers", () => bindPadButton(null, "shiftUp", PAD.A));
  assert.equal(input.sample().shiftUp, true);
  assert.equal(newPress([false, false], [false, true]), 1);
  assert.equal(newPress([true], [true]), -1);
});

test("gamepad rumble: a level starts where the motor turns, and a steady one is not sent again every frame", () => {
  assert.equal(motorLevel(0), 0);
  assert.ok(Math.abs(motorLevel(0.05) - (0.12 + 0.88 * 0.05)) < 1e-12);
  assert.equal(motorLevel(2), 1);
  const played = [];
  const p = pad();
  p.vibrationActuator = { playEffect: (type, params) => { played.push(params); return Promise.resolve("complete"); }, reset: () => { played.push("reset"); return Promise.resolve(); } };
  const input = createGamepadInput({ getGamepads: () => [p] });
  input.rumble(0.5, 0, 0);
  input.rumble(0.51, 0, 16);
  input.rumble(0.51, 0, 33);
  assert.equal(played.length, 1);
  // A level that moves is sent again, but never sooner than MIN_GAP_MS after the last.
  input.rumble(0.9, 0, 50);
  assert.equal(played.length, 1);
  input.rumble(0.9, 0, 130);
  assert.equal(played.length, 2);
  // A steady one is sent again before the effect runs out.
  input.rumble(0.9, 0, 300);
  assert.equal(played.length, 2);
  input.rumble(0.9, 0, 440);
  assert.equal(played.length, 3);
  assert.ok(played.every((e) => e === "reset" || e.duration > RUMBLE_TIMING.RESEND_MS + RUMBLE_TIMING.MIN_GAP_MS));
  input.rumble(0, 0, 450);
  assert.equal(played.at(-1), "reset");
});

test("gamepad rumble: a level that moves every frame is sent at most every MIN_GAP_MS", () => {
  const played = [];
  const p = pad();
  p.vibrationActuator = { playEffect: (type, params) => { played.push(params); return Promise.resolve("complete"); } };
  const input = createGamepadInput({ getGamepads: () => [p] });
  for (let f = 0; f < 60; f++) input.rumble(f % 2 ? 0.2 : 0.9, f % 2 ? 0.9 : 0.2, f * (1000 / 60));
  assert.ok(played.length <= Math.ceil(1000 / RUMBLE_TIMING.MIN_GAP_MS), `${played.length} sends in a second`);
});

test("the Gamepad dead zone option: percent of the throw, 0 to 25, 12 % when unset, and the sample carries it", async () => {
  const { padDeadZone } = await import("../src/game/input/gamepad.js");
  assert.equal(padDeadZone(12), 0.12);
  assert.equal(padDeadZone(40), 0.25);
  assert.equal(padDeadZone(-3), 0);
  assert.equal(padDeadZone(undefined), 0.12);
  const input = createGamepadInput({ getGamepads: () => [pad()] }, undefined, undefined, () => 0.2);
  assert.equal(input.sample().deadZone, 0.2);
});
