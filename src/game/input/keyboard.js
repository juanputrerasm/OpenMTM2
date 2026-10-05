/*
  Keyboard driving input (the actions of MONSTER_EXE_ANALYSIS.md section 7): arrows or WASD to
  drive, Q / Z (or Page Up / Down) to shift, H for the helicopter. The keys come from the
  bindings (bindings.js), rebindable in the options.
*/
import { mergeBindings } from "./bindings.js";

export function createKeyboardInput(target = window, saved = {}) {
  const bindings = mergeBindings(saved);
  const BINDINGS = { accelerate: bindings.accelerate, brake: bindings.brake, left: bindings.left, right: bindings.right };
  const SHIFT_UP = bindings.shiftUp, SHIFT_DOWN = bindings.shiftDown, HELICOPTER = bindings.helicopter;
  const down = new Set();
  let shiftUp = false, shiftDown = false, helicopter = false;
  const onDown = (e) => {
    if (e.repeat) return;
    down.add(e.code);
    if (SHIFT_UP.includes(e.code)) shiftUp = true;
    if (SHIFT_DOWN.includes(e.code)) shiftDown = true;
    if (HELICOPTER.includes(e.code)) helicopter = true;
    if (Object.values(BINDINGS).some((codes) => codes.includes(e.code))) e.preventDefault();
  };
  const onUp = (e) => down.delete(e.code);
  const onBlur = () => down.clear();
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);
  return {
    /** The held keys, plus shift and helicopter presses since the last call. */
    sample() {
      const held = {};
      for (const [action, codes] of Object.entries(BINDINGS)) held[action] = codes.some((c) => down.has(c));
      held.shiftUp = shiftUp; held.shiftDown = shiftDown; held.helicopter = helicopter;
      shiftUp = shiftDown = helicopter = false;
      return held;
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
