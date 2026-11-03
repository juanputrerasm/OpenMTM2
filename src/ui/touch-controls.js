/*
  The race's touch controls (the port's own, game/input/touch.js): an overlay for a phone or tablet with no keyboard,
  mouse or gamepad.

  Left: a thumb stick that steers. It starts where the thumb comes down in the left part of the screen. Right: the gas
  and brake pedals, and, with manual gears, Shift Up and Shift Down. The stick and pedals are a joystick, as a gamepad's
  (`joystick()`), so the game's stick curve and Steering response apply.

  Top right: Helicopter, Camera, Crash Damage, Map, Dashboard, Timing display and Pause. Each presses the player's bound
  key for its action, as the gamepad's race buttons do (ui/gamepad-nav.js), so it does all the key does.

  Every animation frame it asks the race whether it is being driven (`driving`): not driven (paused, a replay, a menu,
  chat), the overlay hides and lets go of everything it holds.
*/
import { el } from "./dom.js";
import { choosePad } from "../game/input/gamepad.js";
import { stickVector, touchControlsShown, touchJoystick, touchOnlyDevice } from "../game/input/touch.js";
import { msg } from "../game/strings.js";

/** The top-right buttons: the bound action each presses, its glyph, and its name (the bindings' own tag). */
const ACTION_BUTTONS = Object.freeze([
  { action: "helicopter", glyph: "\u{1F681}", label: msg("Helicopter") },
  { action: "camera", glyph: "\u{1F3A5}", label: msg("Camera") },
  { action: "crashDamage", glyph: "\u{1F527}", label: msg("Crash Damage") },
  { action: "map", glyph: "\u{1F5FA}", label: msg("Map") },
  { action: "dashboard", glyph: "⏲", label: msg("Dashboard") },
  { action: "hud", glyph: "⏱", label: msg("Timing display") },
  { action: "pause", glyph: "⏸", label: msg("Pause") },
]);

/**
 * `actionKey(action)` is the key code bound to an action; `autoShift` false shows the shift buttons; `driving()`
 * says whether the race is being driven now. Returns `{ element, joystick(), dispose() }`.
 */
export function createTouchControls(context, { actionKey, autoShift = true, driving = () => true, win = window } = {}) {
  const t = (text) => context.t?.(text) ?? text;
  const doc = win.document;
  const mode = () => context.settings?.touchControls;
  const coarse = win.matchMedia?.("(pointer: coarse)");
  const anyFine = win.matchMedia?.("(any-pointer: fine)");
  const touchOnly = () => touchOnlyDevice({ coarse: !!coarse?.matches, anyFine: !!anyFine?.matches, maxTouchPoints: win.navigator.maxTouchPoints ?? 0 });
  /** A key pressed on a real keyboard since the last touch: Auto leaves the driving to it. */
  let keyUsed = false;
  const onRealKey = (e) => { if (e.isTrusted) keyUsed = true; };
  const onRealTouch = (e) => { if (e.pointerType === "touch") keyUsed = false; };
  win.addEventListener("keydown", onRealKey, true);
  win.addEventListener("pointerdown", onRealTouch, true);

  const noMenu = (e) => e.preventDefault();
  const capture = (node, e) => { try { node.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ } };

  // The stick: its base is placed where the thumb comes down, and goes back to its corner when it lifts.
  const knob = el("div", { class: "touch-knob" });
  const base = el("div", { class: "touch-stick-base" }, knob);
  const stickZone = el("div", { class: "touch-stick", "aria-label": t("Turn Left") + " / " + t("Turn Right") }, base);
  let stickId = null, stickCentre = null, steer = 0;
  const placeKnob = (x, y) => { knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`; };
  const stickRelease = () => {
    stickId = null; stickCentre = null; steer = 0;
    base.style.left = base.style.top = "";
    base.classList.remove("active");
    placeKnob(0, 0);
  };
  stickZone.addEventListener("pointerdown", (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    capture(stickZone, e);
    const zone = stickZone.getBoundingClientRect();
    base.style.left = `${e.clientX - zone.left}px`;
    base.style.top = `${e.clientY - zone.top}px`;
    base.classList.add("active");
    stickCentre = { x: e.clientX, y: e.clientY };
    placeKnob(0, 0);
  });
  stickZone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId || !stickCentre) return;
    const radius = base.offsetWidth / 2;
    const v = stickVector(e.clientX - stickCentre.x, e.clientY - stickCentre.y, radius);
    steer = v.x;
    // The knob moves only sideways: the stick steers, the pedals drive.
    placeKnob(v.x * radius, 0);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    stickZone.addEventListener(type, (e) => { if (e.pointerId === stickId) stickRelease(); });
  }

  /** A control held while a finger is on it: `onDown` and `onUp` run once per press. */
  const holdButton = (attrs, content, onDown, onUp) => {
    const node = el("button", { type: "button", tabindex: "-1", ...attrs }, content);
    let id = null;
    const up = () => { if (id === null) return; id = null; node.classList.remove("pressed"); onUp(); };
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      capture(node, e);
      node.classList.add("pressed");
      onDown();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) node.addEventListener(type, (e) => { if (e.pointerId === id) up(); });
    node.addEventListener("contextmenu", noMenu);
    return { node, release: up };
  };

  let gas = 0, brake = 0, shiftUp = false, shiftDown = false;
  const gasButton = holdButton({ class: "touch-pedal touch-gas", "aria-label": t("Accelerate"), title: t("Accelerate") }, "▲", () => { gas = 1; }, () => { gas = 0; });
  const brakeButton = holdButton({ class: "touch-pedal touch-brake", "aria-label": t("Brake"), title: t("Brake") }, "▼", () => { brake = 1; }, () => { brake = 0; });
  const shiftButtons = autoShift ? [] : [
    holdButton({ class: "touch-shift", "aria-label": t("Shift Up"), title: t("Shift Up") }, "+", () => { shiftUp = true; }, () => {}),
    holdButton({ class: "touch-shift", "aria-label": t("Shift Down"), title: t("Shift Down") }, "−", () => { shiftDown = true; }, () => {}),
  ];

  // The bound keys the action buttons hold down, let go when the overlay hides with a finger still on one.
  const heldKeys = new Set();
  const pressKey = (code, type) => win.dispatchEvent(new win.KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
  const actionButtons = ACTION_BUTTONS.map(({ action, glyph, label }) => {
    let code = null;
    return holdButton({ class: "touch-action", "data-action": action, "aria-label": t(label), title: t(label) }, glyph, () => {
      code = actionKey(action);
      if (!code) return;
      heldKeys.add(code);
      pressKey(code, "keydown");
    }, () => {
      if (!code) return;
      if (heldKeys.delete(code)) pressKey(code, "keyup");
      code = null;
    });
  });

  const element = el("div", { class: "touch-controls", hidden: true },
    stickZone,
    el("div", { class: "touch-pedals" },
      shiftButtons.length ? el("div", { class: "touch-shifts" }, ...shiftButtons.map((b) => b.node)) : null,
      brakeButton.node, gasButton.node),
    el("div", { class: "touch-actions" }, ...actionButtons.map((b) => b.node)));
  element.addEventListener("contextmenu", noMenu);

  const releaseAll = () => {
    stickRelease();
    for (const button of [gasButton, brakeButton, ...shiftButtons, ...actionButtons]) button.release();
    for (const code of heldKeys) pressKey(code, "keyup");
    heldKeys.clear();
    gas = brake = 0; shiftUp = shiftDown = false;
  };
  const onHidden = () => { if (doc.visibilityState !== "visible") releaseAll(); };
  win.addEventListener("blur", releaseAll);
  doc.addEventListener("visibilitychange", onHidden);

  // Shown while the race is driven and the Touch controls choice wants it.
  let frame = 0;
  const loop = () => {
    frame = win.requestAnimationFrame(loop);
    let driven = false;
    // The race's answer may read state it has not set up yet while it loads: not driven then.
    try { driven = !!driving(); } catch { driven = false; }
    const padConnected = driven && !!choosePad(win.navigator.getGamepads ? [...win.navigator.getGamepads()] : []);
    const show = driven && touchControlsShown(mode(), { touchOnly: touchOnly(), padConnected, keyUsed });
    if (show === !element.hidden) return;
    if (!show) releaseAll();
    element.hidden = !show;
  };
  frame = win.requestAnimationFrame(loop);

  return {
    element,
    /** The stick and pedals as a joystick, or null while none is touched; a shift press is given once. */
    joystick() {
      if (element.hidden) return null;
      const pressed = stickId !== null || gas > 0 || brake > 0 || shiftUp || shiftDown;
      if (!pressed) return null;
      const input = touchJoystick({ steer, gas, brake, shiftUp, shiftDown });
      shiftUp = shiftDown = false;
      return input;
    },
    dispose() {
      win.cancelAnimationFrame(frame);
      releaseAll();
      win.removeEventListener("keydown", onRealKey, true);
      win.removeEventListener("pointerdown", onRealTouch, true);
      win.removeEventListener("blur", releaseAll);
      doc.removeEventListener("visibilitychange", onHidden);
      element.remove();
    },
  };
}
