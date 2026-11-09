/*
  Gamepad bindings (the port's own): each action a pad button can press, and the buttons that press it, in the standard
  mapping's numbering. The left stick steers and the triggers or stick work the pedals (Options, Keys, Gamepad pedals);
  those stay fixed. The options screen stores only what the player changed, in `settings.padBindings`.

  The defaults are the layout the port has always had: RB / LB shift, D-pad down is the Emergency Brake, Y the
  helicopter, X the camera, A the dashboard, B the map, Start pauses, D-pad up is Drive Mode, D-pad left and right zoom, Back shows the drag beam lines.
*/
import { msg } from "../strings.js";
import { ACTIONS } from "./bindings.js";

/** Standard-mapping button numbers. */
export const PAD = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16,
});

/** A readable name for each standard-mapping button. */
export const PAD_BUTTON_NAMES = Object.freeze([
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT", msg("Back"), msg("Start"), msg("Left stick"), msg("Right stick"),
  msg("D-pad up"), msg("D-pad down"), msg("D-pad left"), msg("D-pad right"), msg("Home"),
]);

/** A button's name; buttons past the standard ones are numbered. */
export const padButtonLabel = (i) => PAD_BUTTON_NAMES[i] ?? `${i + 1}`;

/** The actions read by the driving input itself (game/input/gamepad.js), not as keys. */
export const PAD_DRIVE_ACTIONS = Object.freeze(["shiftUp", "shiftDown", "handbrake", "zoomIn", "zoomOut"]);

/** The pad's own actions that have no key. */
const PAD_ONLY = [
  { id: "zoomOut", label: msg("Zoom out") },
  { id: "zoomIn", label: msg("Zoom in") },
];

/** The actions a button can be given: the keys' actions less the ones the sticks and triggers do, and the zoom. */
const NOT_ON_BUTTONS = new Set(["accelerate", "brake", "left", "right", "chat", "teamChat"]);
export const PAD_ACTIONS = Object.freeze([...ACTIONS.filter((a) => !NOT_ON_BUTTONS.has(a.id)), ...PAD_ONLY]);

export const DEFAULT_PAD_BINDINGS = Object.freeze({
  shiftUp: Object.freeze([PAD.RB]),
  shiftDown: Object.freeze([PAD.LB]),
  handbrake: Object.freeze([PAD.DOWN]),
  helicopter: Object.freeze([PAD.Y]),
  camera: Object.freeze([PAD.X]),
  dashboard: Object.freeze([PAD.A]),
  map: Object.freeze([PAD.B]),
  pause: Object.freeze([PAD.START]),
  driveMode: Object.freeze([PAD.UP]),
  zoomOut: Object.freeze([PAD.LEFT]),
  zoomIn: Object.freeze([PAD.RIGHT]),
  dragBeams: Object.freeze([PAD.BACK]),
});

const isButton = (b) => Number.isInteger(b) && b >= 0 && b < 32;

/** The defaults with the player's changes on top. A saved empty list unbinds the action; unknown actions are ignored. */
export function mergePadBindings(saved) {
  const merged = {};
  for (const { id } of PAD_ACTIONS) {
    const list = saved?.[id];
    merged[id] = Array.isArray(list) && list.every(isButton) ? [...list] : [...(DEFAULT_PAD_BINDINGS[id] ?? [])];
  }
  return merged;
}

/** The action already on `button`, other than `except`, or null. */
export function padConflictFor(bindings, button, except) {
  return PAD_ACTIONS.find((a) => a.id !== except && bindings[a.id]?.includes(button))?.id ?? null;
}

/**
 * Gives `button` to `action` alone: the button leaves any other action (which may be left with none), and the action
 * keeps only this button. Returns the changes to store (`settings.padBindings`).
 */
export function bindPadButton(saved, action, button) {
  const merged = mergePadBindings(saved);
  const next = { ...(saved ?? {}) };
  for (const { id } of PAD_ACTIONS) {
    if (id !== action && merged[id].includes(button)) next[id] = merged[id].filter((b) => b !== button);
  }
  next[action] = [button];
  return next;
}

/** Whether any of `buttons` is held on `pad`. */
export const padHeld = (pad, buttons) => !!buttons?.some((i) => pad?.buttons[i]?.pressed);

/** The button presses that act as keys while driving: `{ button: action }` for every bound non-driving action. */
export function padKeyButtons(bindings) {
  const out = new Map();
  for (const { id } of PAD_ACTIONS) {
    if (PAD_DRIVE_ACTIONS.includes(id)) continue;
    for (const b of bindings[id] ?? []) if (!out.has(b)) out.set(b, id);
  }
  return out;
}

/** The first button newly pressed between two samples of a pad's buttons (`pressed` arrays), or -1 (Options' capture). */
export function newPress(before, now) {
  for (let i = 0; i < now.length; i++) if (now[i] && !before[i]) return i;
  return -1;
}
