/*
  Keyboard driving input (the actions of MONSTER_EXE_ANALYSIS.md section 7): arrows or WASD to
  drive, Q / Z (or Page Up / Down) to shift. Rebinding comes with the options screen (M9).
*/
const BINDINGS = {
  accelerate: ["ArrowUp", "KeyW"],
  brake: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
};
const SHIFT_UP = ["KeyQ", "PageUp"];
const SHIFT_DOWN = ["KeyZ", "PageDown"];

export function createKeyboardInput(target = window) {
  const down = new Set();
  let shiftUp = false, shiftDown = false;
  const onDown = (e) => {
    if (e.repeat) return;
    down.add(e.code);
    if (SHIFT_UP.includes(e.code)) shiftUp = true;
    if (SHIFT_DOWN.includes(e.code)) shiftDown = true;
    if (Object.values(BINDINGS).some((codes) => codes.includes(e.code))) e.preventDefault();
  };
  const onUp = (e) => down.delete(e.code);
  const onBlur = () => down.clear();
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);
  return {
    /** The held keys, plus shift presses since the last call. */
    sample() {
      const held = {};
      for (const [action, codes] of Object.entries(BINDINGS)) held[action] = codes.some((c) => down.has(c));
      held.shiftUp = shiftUp; held.shiftDown = shiftDown;
      shiftUp = shiftDown = false;
      return held;
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
