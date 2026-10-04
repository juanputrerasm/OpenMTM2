/*
  A gamepad or wheel as the game's analog joystick (MONSTER_EXE_ANALYSIS.md section 7, mode 2):
  the left stick steers; the pedal axis is the left trigger (brake) less the right trigger
  (throttle), or the left stick's y when no trigger is pressed (up is throttle). RB / LB shift up
  and down. Browsers report every axis already centred to -1..1, so the game's calibration
  reduces to the dead zone, which the simulation applies.

  Uses the first connected pad in the standard mapping; `sample()` returns null when there is
  none, and the keyboard then drives alone.
*/
const TRIGGER_LEFT = 6, TRIGGER_RIGHT = 7, BUMPER_LEFT = 4, BUMPER_RIGHT = 5;
const DEAD_ZONE = 0.12;

export function createGamepadInput(nav = navigator) {
  let upHeld = false, downHeld = false;
  const pressed = (pad, i) => !!pad.buttons[i]?.pressed;
  const value = (pad, i) => pad.buttons[i]?.value ?? 0;
  return {
    /** The joystick input for the simulation, or null with no pad. */
    sample() {
      const pads = nav.getGamepads ? [...nav.getGamepads()] : [];
      const pad = pads.find((p) => p && p.connected);
      if (!pad) return null;
      const throttle = value(pad, TRIGGER_RIGHT), brake = value(pad, TRIGGER_LEFT);
      const y = throttle > 0 || brake > 0 ? brake - throttle : pad.axes[1] ?? 0;
      const up = pressed(pad, BUMPER_RIGHT), down = pressed(pad, BUMPER_LEFT);
      // Shifts are edges, like the keys.
      const shiftUp = up && !upHeld, shiftDown = down && !downHeld;
      upHeld = up; downHeld = down;
      return { x: pad.axes[0] ?? 0, y, deadZone: DEAD_ZONE, shiftUp, shiftDown };
    },
  };
}
