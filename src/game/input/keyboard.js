/*
  Keyboard driving input (the actions of MONSTER_EXE_ANALYSIS.md section 7): arrows or WASD to
  drive, Q / Z (or Page Up / Down) to shift, B for an Evolution truck's handbrake, H for the helicopter. The keys come from the
  bindings (bindings.js), rebindable in the options.
*/
import { mergeBindings } from "./bindings.js";

export function createKeyboardInput(target = window, saved = {}) {
  const bindings = mergeBindings(saved);
  const BINDINGS = { accelerate: bindings.accelerate, brake: bindings.brake, left: bindings.left, right: bindings.right, handbrake: bindings.handbrake };
  const SHIFT_UP = bindings.shiftUp, SHIFT_DOWN = bindings.shiftDown, HELICOPTER = bindings.helicopter, AUTO_STAGE = bindings.autoStage;
  const DRIVE_MODE = bindings.driveMode;
  const down = new Set();
  let shiftUp = false, shiftDown = false, helicopter = false, autoStage = false, driveMode = false;
  const onDown = (e) => {
    if (e.repeat) return;
    // A combination (Ctrl, Alt or Cmd with a key) is never a single key's action.
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    down.add(e.code);
    if (SHIFT_UP.includes(e.code)) shiftUp = true;
    if (SHIFT_DOWN.includes(e.code)) shiftDown = true;
    if (HELICOPTER.includes(e.code)) helicopter = true;
    if (AUTO_STAGE.includes(e.code)) autoStage = true;
    if (DRIVE_MODE.includes(e.code)) driveMode = true;
    if (Object.values(BINDINGS).some((codes) => codes.includes(e.code))) e.preventDefault();
  };
  const onUp = (e) => down.delete(e.code);
  const onBlur = () => down.clear();
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);
  return {
    /** The held keys, plus shift, helicopter, Auto Stage and Drive Mode presses since the last call. */
    sample() {
      const held = {};
      for (const [action, codes] of Object.entries(BINDINGS)) held[action] = codes.some((c) => down.has(c));
      held.shiftUp = shiftUp; held.shiftDown = shiftDown; held.helicopter = helicopter; held.autoStage = autoStage; held.driveMode = driveMode;
      shiftUp = shiftDown = helicopter = autoStage = driveMode = false;
      return held;
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
