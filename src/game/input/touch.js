/*
  Touch controls (the port's own, for phones and tablets with no keyboard, mouse or gamepad): the rules behind the
  on-screen overlay (ui/touch-controls.js). The thumb stick and the pedals make the same joystick input a gamepad does
  (game/input/gamepad.js `sample()`): x steers through the game's stick curve, y is the pedal axis, negative throttle.

  The Touch controls option: "auto" shows them on a device whose only pointer is a finger, while no gamepad is
  connected and no key has been pressed since the last touch; "on" always; "off" never.
*/

/** The Touch controls choices, the first the default. */
export const TOUCH_MODES = Object.freeze(["auto", "on", "off"]);

/** The pad's own dead zone (game/input/gamepad.js), so the stick's centre rests as a pad's does. */
export const TOUCH_DEAD_ZONE = 0.12;

/**
 * Whether the device is touch alone: a coarse primary pointer, touch points, and no fine pointer anywhere. A tablet with
 * a trackpad or a laptop with a touchscreen has a fine pointer, and the keyboard and mouse that go with it.
 */
export function touchOnlyDevice({ coarse = false, anyFine = false, maxTouchPoints = 0 } = {}) {
  return !!coarse && maxTouchPoints > 0 && !anyFine;
}

/** Whether the overlay is shown, for a Touch controls choice and what the device has. */
export function touchControlsShown(mode, { touchOnly = false, padConnected = false, keyUsed = false } = {}) {
  const choice = TOUCH_MODES.includes(mode) ? mode : TOUCH_MODES[0];
  if (choice === "on") return true;
  if (choice === "off") return false;
  return touchOnly && !padConnected && !keyUsed;
}

/**
 * The thumb's offset from the stick's centre (pixels) as a stick position: `{ x, y }`, each -1..1, held to the circle
 * of `radius`. y is down positive, as the screen's.
 */
export function stickVector(dx, dy, radius) {
  if (!(radius > 0)) return { x: 0, y: 0 };
  const length = Math.hypot(dx, dy);
  const scale = length > radius ? radius / length : 1;
  return { x: (dx * scale) / radius, y: (dy * scale) / radius };
}

/** The joystick input for the simulation: the stick's x steers, the pedals (0..1) are the pedal axis. */
export function touchJoystick({ steer = 0, gas = 0, brake = 0, shiftUp = false, shiftDown = false } = {}) {
  return {
    x: Math.max(-1, Math.min(1, steer)),
    y: Math.max(-1, Math.min(1, brake - gas)),
    deadZone: TOUCH_DEAD_ZONE,
    shiftUp: !!shiftUp,
    shiftDown: !!shiftDown,
    handbrake: false,
  };
}
