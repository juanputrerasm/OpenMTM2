import test from "node:test";
import assert from "node:assert/strict";
import { TOUCH_MODES, stickVector, touchControlsShown, touchJoystick, touchOnlyDevice } from "../src/game/input/touch.js";
import { DEFAULT_SETTINGS } from "../src/app/settings.js";
import { applyJoystick } from "../src/vendor/openphotex/sim/mtm2/truck/controls.js";

test("touch controls: Auto by default", () => {
  assert.equal(DEFAULT_SETTINGS.touchControls, "auto");
  assert.equal(TOUCH_MODES[0], "auto");
});

test("touch controls: a touch-only device is a finger with no fine pointer", () => {
  // A phone.
  assert.equal(touchOnlyDevice({ coarse: true, anyFine: false, maxTouchPoints: 5 }), true);
  // A tablet with a trackpad, a laptop with a touchscreen: a fine pointer as well.
  assert.equal(touchOnlyDevice({ coarse: true, anyFine: true, maxTouchPoints: 5 }), false);
  assert.equal(touchOnlyDevice({ coarse: false, anyFine: true, maxTouchPoints: 10 }), false);
  // A desktop.
  assert.equal(touchOnlyDevice({ coarse: false, anyFine: true, maxTouchPoints: 0 }), false);
  assert.equal(touchOnlyDevice(), false);
});

test("touch controls: On always, Off never, Auto on a touch-only device with no pad and no key", () => {
  assert.equal(touchControlsShown("on", {}), true);
  assert.equal(touchControlsShown("off", { touchOnly: true }), false);
  assert.equal(touchControlsShown("auto", { touchOnly: true }), true);
  assert.equal(touchControlsShown("auto", { touchOnly: false }), false);
  assert.equal(touchControlsShown("auto", { touchOnly: true, padConnected: true }), false);
  assert.equal(touchControlsShown("auto", { touchOnly: true, keyUsed: true }), false);
  // An unknown choice is Auto.
  assert.equal(touchControlsShown(undefined, { touchOnly: true }), true);
});

test("touch controls: the stick is held to its circle", () => {
  assert.deepEqual(stickVector(25, 0, 50), { x: 0.5, y: 0 });
  const far = stickVector(300, 400, 50);
  assert.ok(Math.abs(far.x - 0.6) < 1e-9 && Math.abs(far.y - 0.8) < 1e-9);
  assert.deepEqual(stickVector(10, 10, 0), { x: 0, y: 0 });
});

test("touch controls: the pedals are the pad's pedal axis and the stick steers through the stick curve", () => {
  assert.equal(touchJoystick({ gas: 1 }).y, -1);
  assert.equal(touchJoystick({ brake: 1 }).y, 1);
  assert.equal(touchJoystick({ gas: 1, brake: 1 }).y, 0);
  const ctx = { forwardSpeed: 0, steeringResponse: 1, autoShift: true };
  const left = { steer: 0, throttle: 0, gear: 1 }, right = { steer: 0, throttle: 0, gear: 1 };
  applyJoystick(left, touchJoystick({ steer: -1, gas: 1 }), ctx);
  applyJoystick(right, touchJoystick({ steer: 1, gas: 1 }), ctx);
  assert.ok(left.steer < 0 && right.steer > 0);
  assert.equal(left.throttle, 1);
  // The centre rests in the pad's dead zone.
  const centre = { steer: 0, throttle: 0, gear: 1 };
  applyJoystick(centre, touchJoystick({ steer: 0.05 }), ctx);
  assert.equal(centre.steer, 0);
});
