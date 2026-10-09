/*
  Keyboard bindings: each action maps to the key codes (KeyboardEvent.code) that trigger it.
  The options screen stores only what the player changed, in `settings.bindings`.
*/
/** `label` is the game's own tag for the action (the options screen shows it through `context.t`). */
export const ACTIONS = Object.freeze([
  { id: "accelerate", label: "Accelerate" },
  { id: "brake", label: "Brake" },
  { id: "left", label: "Turn Left" },
  { id: "right", label: "Turn Right" },
  { id: "shiftUp", label: "Shift Up" },
  { id: "shiftDown", label: "Shift Down" },
  { id: "helicopter", label: "Helicopter" },
  { id: "horn", label: "Horn" },
  { id: "yeehaw", label: "YeeHaw" },
  { id: "camera", label: "Camera" },
  { id: "dashboard", label: "Dashboard" },
  { id: "map", label: "Map" },
  { id: "names", label: "Names" },
  { id: "finder", label: "Finder" },
  { id: "pause", label: "Pause" },
]);

export const DEFAULT_BINDINGS = Object.freeze({
  accelerate: Object.freeze(["ArrowUp", "KeyW"]),
  brake: Object.freeze(["ArrowDown", "KeyS"]),
  left: Object.freeze(["ArrowLeft", "KeyA"]),
  right: Object.freeze(["ArrowRight", "KeyD"]),
  shiftUp: Object.freeze(["KeyQ", "PageUp"]),
  shiftDown: Object.freeze(["KeyZ", "PageDown"]),
  helicopter: Object.freeze(["KeyH"]),
  horn: Object.freeze(["Space"]),
  yeehaw: Object.freeze(["KeyY"]),
  camera: Object.freeze(["KeyV"]),
  dashboard: Object.freeze(["KeyG"]),
  map: Object.freeze(["Tab", "KeyM"]),
  names: Object.freeze(["KeyN"]),
  finder: Object.freeze(["KeyF"]),
  pause: Object.freeze(["Escape", "KeyP"]),
});

/** The defaults with the player's changes on top; unknown actions and empty lists are ignored. */
export function mergeBindings(saved) {
  const merged = {};
  for (const { id } of ACTIONS) {
    const codes = saved?.[id];
    merged[id] = Array.isArray(codes) && codes.length && codes.every((c) => typeof c === "string") ? [...codes] : [...DEFAULT_BINDINGS[id]];
  }
  return merged;
}

/** The action already using `code`, other than `except`, or null. */
export function conflictFor(bindings, code, except) {
  return ACTIONS.find((a) => a.id !== except && bindings[a.id].includes(code))?.id ?? null;
}

/** A readable name for a key code: "KeyW" is "W", "ArrowUp" is "Up Arrow". */
export function codeLabel(code) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return `${code.slice(5)} Arrow`;
  if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}
