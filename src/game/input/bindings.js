/*
  Keyboard bindings: each action maps to the key codes (KeyboardEvent.code) that trigger it.
  The options screen stores only what the player changed, in `settings.bindings`.
*/
import { msg } from "../strings.js";
/** `label` is the game's own tag for the action (the options screen shows it through `context.t`). */
export const ACTIONS = Object.freeze([
  { id: "accelerate", label: msg("Accelerate") },
  { id: "brake", label: msg("Brake") },
  { id: "left", label: msg("Turn Left") },
  { id: "right", label: msg("Turn Right") },
  { id: "shiftUp", label: msg("Shift Up") },
  { id: "shiftDown", label: msg("Shift Down") },
  // 4x4 Evolution's own (its "Emergency Brake"): held, the rear brakes lock; only an Evolution truck has one.
  { id: "handbrake", label: msg("Emergency Brake") },
  // 4x4 Evolution's own: the transfer case, 2WD, 4WD High, 4WD Low, round again (Evo physics, a four-wheel-drive vehicle).
  { id: "driveMode", label: msg("Drive Mode") },
  { id: "helicopter", label: msg("Helicopter") },
  { id: "autoStage", label: msg("Auto Stage") },
  { id: "horn", label: msg("Horn") },
  { id: "yeehaw", label: msg("YeeHaw") },
  { id: "camera", label: msg("Camera") },
  { id: "dashboard", label: msg("Dashboard") },
  { id: "hud", label: msg("Timing display") },
  { id: "fps", label: msg("FPS counter") },
  // The game's four View keys (MONSTER_EXE_ANALYSIS.md 11): in a chase view they turn the camera round the truck and
  // tilt it; in the cockpit Left, Right and Back turn the head while held and View Forward switches the mirror.
  { id: "viewLeft", label: msg("View Left") },
  { id: "viewRight", label: msg("View Right") },
  { id: "cameraUp", label: msg("View Forward") },
  { id: "cameraDown", label: msg("View Back") },
  { id: "map", label: msg("Map") },
  { id: "names", label: msg("Names") },
  { id: "finder", label: msg("Finder") },
  { id: "headlights", label: msg("Headlights") },
  { id: "crashDamage", label: msg("Crash Damage") },
  { id: "pause", label: msg("Pause") },
  // The game's Chat key: in a network race, opens the box to type a line (ui/race-chat.js); Team chat opens it on the team.
  { id: "chat", label: msg("Chat") },
  { id: "teamChat", label: msg("Team chat") },
  // Not one of the game's: in a headset, makes where the head is the driving position (docs/VR.md).
  { id: "recenter", label: msg("Recentre VR view") },
]);

export const DEFAULT_BINDINGS = Object.freeze({
  accelerate: Object.freeze(["ArrowUp", "KeyW"]),
  brake: Object.freeze(["ArrowDown", "KeyS"]),
  left: Object.freeze(["ArrowLeft", "KeyA"]),
  right: Object.freeze(["ArrowRight", "KeyD"]),
  shiftUp: Object.freeze(["KeyQ", "PageUp"]),
  shiftDown: Object.freeze(["KeyZ", "PageDown"]),
  handbrake: Object.freeze(["KeyB"]),
  driveMode: Object.freeze(["KeyR"]),
  helicopter: Object.freeze(["KeyH"]),
  // The game's own key is S, which is Brake here (WASD).
  autoStage: Object.freeze(["KeyT"]),
  horn: Object.freeze(["Space"]),
  yeehaw: Object.freeze(["KeyY"]),
  camera: Object.freeze(["KeyV"]),
  dashboard: Object.freeze(["KeyG"]),
  hud: Object.freeze(["KeyO"]),
  fps: Object.freeze(["KeyU"]),
  // The game's Insert and Delete.
  viewLeft: Object.freeze(["Insert"]),
  viewRight: Object.freeze(["Delete"]),
  // Held: the chase camera tilts (game/cameras.js `CAMERA_PITCH_RATE`), as the game's keypad minus and plus: View Forward
  // raises the camera to look down on the truck, View Back lowers it. In the cockpit keypad plus looks back and minus
  // switches the mirror (the Monster Manual's "Looking Around from Within the Cab").
  cameraUp: Object.freeze(["Minus", "NumpadSubtract"]),
  cameraDown: Object.freeze(["Equal", "NumpadAdd"]),
  map: Object.freeze(["Tab", "KeyM"]),
  names: Object.freeze(["KeyN"]),
  finder: Object.freeze(["KeyF"]),
  headlights: Object.freeze(["KeyL"]),
  crashDamage: Object.freeze(["KeyX"]),
  pause: Object.freeze(["Escape", "KeyP"]),
  chat: Object.freeze(["Enter", "NumpadEnter"]),
  teamChat: Object.freeze(["KeyK"]),
  recenter: Object.freeze(["KeyC"]),
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
