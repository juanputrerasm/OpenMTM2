/*
  A gamepad or wheel as the game's analog joystick (MONSTER_EXE_ANALYSIS.md section 7, mode 2):
  the left stick steers, RB / LB shift up and down, and the D-pad's down, held, is an Evolution truck's handbrake.
  The other buttons are the race's keys (ui/gamepad-nav.js).
  Browsers report every axis already centred to -1..1, so the game's calibration reduces to the
  dead zone, which the simulation applies.

  The pedal axis (up is throttle) depends on the Gamepad pedals option (`PAD_PEDALS`):
  - "triggers": the left trigger (brake) less the right trigger (throttle). The left stick only
    steers, so a thumb that drifts up or down while steering does not move the truck (a false
    start in a drag race).
  - "stick": the left stick's y, as the game's joystick mode reads it.
  - "both": the triggers while one is pressed, else the left stick's y.
  A pad without the standard mapping always uses the left stick's y: its buttons 6 and 7 need not
  be triggers (USB adapters for older pads often number them their own way).

  Uses the first connected pad in the standard mapping, else the first connected pad; `sample()`
  returns null when there is none, and the keyboard then drives alone.
*/
const TRIGGER_LEFT = 6, TRIGGER_RIGHT = 7, BUMPER_LEFT = 4, BUMPER_RIGHT = 5, DPAD_DOWN = 13;
const DEAD_ZONE = 0.12;

/** The Gamepad pedals choices, the first the default. */
export const PAD_PEDALS = Object.freeze(["triggers", "stick", "both"]);

/** The pedal axis of a pad (negative is throttle) for a Gamepad pedals choice. */
export function padPedalAxis(pad, pedals = PAD_PEDALS[0]) {
  const stickY = pad.axes[1] ?? 0;
  if (pad.mapping !== "standard" || pedals === "stick") return stickY;
  const throttle = pad.buttons[TRIGGER_RIGHT]?.value ?? 0, brake = pad.buttons[TRIGGER_LEFT]?.value ?? 0;
  if (pedals === "both" && throttle <= 0 && brake <= 0) return stickY;
  return brake - throttle;
}

/** The pad to use: the first connected one in the standard mapping, else the first connected one, else null. */
export function choosePad(pads) {
  const connected = (pads ?? []).filter((p) => p && p.connected);
  return connected.find((p) => p.mapping === "standard") ?? connected[0] ?? null;
}

/** A motor barely turns below about this; any level asked for is lifted over it, so a soft rumble is still felt. */
const MOTOR_START = 0.12;
const EFFECT_MS = 250, RESEND_MS = 150, LEVEL_STEP = 0.05;

/** The level sent to a motor for one asked for (0..1): 0 stays 0, anything else starts where the motor turns. */
export const motorLevel = (v) => (v > 0.01 ? MOTOR_START + (1 - MOTOR_START) * Math.min(1, v) : 0);

/**
 * Options, Keys, Test rumble: half a second of the strong motor, then half a second of the weak one. Resolves to
 * "ok", "no gamepad" or "no rumble" (the browser or the pad has none).
 */
export async function testRumble(nav = navigator) {
  const actuator = choosePad(nav.getGamepads ? [...nav.getGamepads()] : [])?.vibrationActuator;
  if (!choosePad(nav.getGamepads ? [...nav.getGamepads()] : [])) return "no gamepad";
  if (!actuator?.playEffect) return "no rumble";
  try {
    await actuator.playEffect("dual-rumble", { startDelay: 0, duration: 500, strongMagnitude: 1, weakMagnitude: 0 });
    await actuator.playEffect("dual-rumble", { startDelay: 100, duration: 500, strongMagnitude: 0, weakMagnitude: 1 });
    return "ok";
  } catch {
    return "no rumble";
  }
}

/** `pedals` gives the Gamepad pedals choice, read at every sample so that a change in the options takes effect at once. */
export function createGamepadInput(nav = navigator, pedals = () => PAD_PEDALS[0]) {
  let upHeld = false, downHeld = false, rumbling = false, sentStrong = 0, sentWeak = 0, sentAt = 0;
  const sends = [];
  const padNow = () => choosePad(nav.getGamepads ? [...nav.getGamepads()] : []);
  const pressed = (pad, i) => !!pad.buttons[i]?.pressed;
  return {
    /** The joystick input for the simulation, or null with no pad. */
    sample() {
      const pad = choosePad(nav.getGamepads ? [...nav.getGamepads()] : []);
      if (!pad) return null;
      const choice = pedals();
      const y = padPedalAxis(pad, PAD_PEDALS.includes(choice) ? choice : PAD_PEDALS[0]);
      const up = pressed(pad, BUMPER_RIGHT), down = pressed(pad, BUMPER_LEFT);
      // Shifts are edges, like the keys.
      const shiftUp = up && !upHeld, shiftDown = down && !downHeld;
      upHeld = up; downHeld = down;
      return { x: pad.axes[0] ?? 0, y, deadZone: DEAD_ZONE, shiftUp, shiftDown, handbrake: pressed(pad, DPAD_DOWN) };
    },
    /**
     * The pad's two motors, 0..1 (game/input/rumble.js), for the next tenth of a second, or off with both 0. A browser or
     * pad without rumble (Firefox, most adapters) is left alone.
     */
    /** For the rumble readout: the pad in use, whether it can rumble, the levels last sent and the sends in the last second. */
    rumbleInfo() {
      const pad = padNow(), now = performance.now();
      while (sends.length && now - sends[0] > 1000) sends.shift();
      return { pad: pad?.id ?? null, canRumble: !!pad?.vibrationActuator?.playEffect, sent: rumbling ? { strong: sentStrong, weak: sentWeak } : null, perSecond: sends.length };
    },
    /**
     * The pad's two motors, 0..1 (game/input/rumble.js), or off with both 0. A level is lifted to where a motor turns
     * (`motorLevel`). An effect plays for a quarter second and is sent again only when a level moves or it is about to
     * end: sent every frame, a pad on Bluetooth drops them or starts over before its motors spin up. A browser or pad
     * without rumble (Firefox, most adapters) is left alone.
     */
    rumble(strong, weak, now = performance.now()) {
      const actuator = padNow()?.vibrationActuator;
      if (!actuator?.playEffect) return;
      const s = motorLevel(strong), w = motorLevel(weak);
      if (s === 0 && w === 0) {
        if (!rumbling) return;
        rumbling = false;
        (actuator.reset?.() ?? actuator.playEffect("dual-rumble", { startDelay: 0, duration: 0, strongMagnitude: 0, weakMagnitude: 0 }))?.catch?.(() => {});
        return;
      }
      if (rumbling && Math.abs(s - sentStrong) < LEVEL_STEP && Math.abs(w - sentWeak) < LEVEL_STEP && now - sentAt < RESEND_MS) return;
      rumbling = true; sentStrong = s; sentWeak = w; sentAt = now; sends.push(now);
      actuator.playEffect("dual-rumble", { startDelay: 0, duration: EFFECT_MS, strongMagnitude: s, weakMagnitude: w })?.catch?.(() => {});
    },
  };
}
