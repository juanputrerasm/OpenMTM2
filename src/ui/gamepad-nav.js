/*
  The whole game with a gamepad alone: the menus, the dialogs and the race's buttons.

  Menus. The D-pad or the left stick moves the focus to the nearest control that way, a list's rows (the track list)
  included. A presses it: a button or a row is clicked, a text box opens the on-screen keyboard (ui/pad-keyboard.js), and a
  dropdown or a slider is taken to edit: the D-pad then steps its value, A keeps it and B puts it back. The directions
  never change a value outside that. B goes back: it cancels the open dialog, else it is Escape on the race, fly-by and
  replay screens, else the screen's Back button, else the screen before. LB and RB step through the Options tabs.

  Racing. While the race screen says it is being driven (`context.padDriving`), the buttons are the race's own keys, from
  the player's bindings: Y Helicopter, X Camera, A Dashboard, B Map, Start Pause, D-pad up Drive Mode. The sticks,
  triggers and bumpers drive (game/input/gamepad.js).

  The menu sounds are the mouse's: MOUSEON as the focus comes to a button, and a button's own sound when A presses it.

  One loop polls the pad on every animation frame; nothing happens without a pad.
*/
import { mergeBindings } from "../game/input/bindings.js";
import { choosePad } from "../game/input/gamepad.js";
import { openPadKeyboard } from "./pad-keyboard.js";
import { menuSoundFor, playMenuSound } from "../audio/menu-sounds.js";

/** Standard-mapping button numbers. */
export const PAD = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
});

/** The race's buttons: the bound action each one presses. */
export const DRIVE_BUTTONS = Object.freeze({
  [PAD.Y]: "helicopter", [PAD.X]: "camera", [PAD.A]: "dashboard", [PAD.B]: "map", [PAD.START]: "pause", [PAD.UP]: "driveMode",
});

/** Screens whose own Escape key is their way back or their pause. */
const ESCAPE_SCREENS = new Set(["race", "fly-by", "replay", "dev-drive", "dev-track"]);

const FOCUSABLE = "button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex='-1']), [role=listbox] [role=option]";
const TEXT_TYPES = new Set(["text", "search", "url", "email", "password", "number", "tel", ""]);
/** A control whose value the D-pad steps once A has taken it to edit. */
const editable = (node) => node.tagName === "SELECT" || (node.tagName === "INPUT" && node.type === "range");
const STICK = 0.5, REPEAT_FIRST_MS = 380, REPEAT_MS = 130;

/**
 * The rectangle nearest `from` in direction `dir` ("up", "down", "left", "right"), as an index into `rects`, or -1.
 * A candidate must lie that way from the centre; it scores its distance along the way plus twice its offset across it.
 */
export function pickInDirection(from, rects, dir) {
  const cx = (r) => r.left + r.width / 2, cy = (r) => r.top + r.height / 2;
  const fx = cx(from), fy = cy(from);
  let best = -1, bestScore = Infinity;
  rects.forEach((r, i) => {
    const dx = cx(r) - fx, dy = cy(r) - fy;
    let along, across;
    if (dir === "up") { along = -dy; across = Math.abs(dx); }
    else if (dir === "down") { along = dy; across = Math.abs(dx); }
    else if (dir === "left") { along = -dx; across = Math.abs(dy); }
    else { along = dx; across = Math.abs(dy); }
    if (along <= 1) return;
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

export function startGamepadNav(context, win = window) {
  const doc = win.document;
  let prev = [];
  const repeatAt = new Map();
  let frame = 0;
  /** The keys a race button holds down, let go when the race stops being driven (a pause) with the button still held. */
  const heldKeys = new Set();

  const usePad = () => doc.body.classList.add("pad-nav");
  const leavePad = (event) => { if (event.isTrusted) doc.body.classList.remove("pad-nav"); };
  for (const type of ["mousemove", "pointerdown", "keydown"]) win.addEventListener(type, leavePad, true);

  const visible = (node) => node.getClientRects().length > 0 && win.getComputedStyle(node).visibility !== "hidden" && !node.closest("[inert]");
  const openDialogs = () => [...doc.querySelectorAll("dialog[open]")];
  const scope = () => openDialogs().at(-1) ?? doc.body;
  const focusables = () => [...scope().querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled && visible(node));
  const screenName = () => context.router?.stack.at(-1)?.name ?? null;
  const driving = () => {
    // The race's answer may read state it has not set up yet while it loads: not driven then.
    try { return !!context.padDriving?.() && !openDialogs().length; } catch { return false; }
  };

  /** A key press and release, as the player's bound key for `action` would make them. */
  const pressKey = (code, type) => win.dispatchEvent(new win.KeyboardEvent(type, {
    code, key: code === "Escape" ? "Escape" : code, bubbles: true, cancelable: true,
  }));
  const actionKey = (action) => mergeBindings(context.settings?.bindings)[action]?.[0] ?? null;

  const sound = (name, gain) => { if (name) playMenuSound(context.menuAudio, context.settings ?? {}, name, gain); };
  const focus = (node) => {
    usePad();
    if (node !== doc.activeElement && menuSoundFor(node)) sound("MOUSEON", 0.35);
    // A list's row takes the focus without joining the Tab order.
    if (!node.hasAttribute("tabindex") && node.getAttribute("role") === "option") node.tabIndex = -1;
    node.focus({ preventScroll: true });
    node.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  const current = () => {
    const active = doc.activeElement;
    return active && active !== doc.body && scope().contains(active) && visible(active) ? active : null;
  };
  /** The control to start from: the dialog's or screen's main button, else the first. */
  const first = (list) => list.find((n) => n.matches(".primary, .go, [autofocus]")) ?? list[0];

  const move = (dir) => {
    const list = focusables();
    if (!list.length) return;
    const from = current();
    if (!from) { focus(first(list)); return; }
    const others = list.filter((n) => n !== from);
    const i = pickInDirection(from.getBoundingClientRect(), others.map((n) => n.getBoundingClientRect()), dir);
    if (i >= 0) focus(others[i]);
  };

  const fire = (node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true }));
  /** The dropdown or slider being edited, and its value before: `{ node, before }`, or null. */
  let editing = null;
  const valueOf = (node) => (node.tagName === "SELECT" ? [...node.options].map((o) => o.selected) : node.value);
  const restore = (node, before) => {
    if (node.tagName === "SELECT") [...node.options].forEach((o, i) => { o.selected = before[i]; });
    else node.value = before;
  };
  const startEdit = (node) => { editing = { node, before: valueOf(node) }; node.classList.add("pad-editing"); };
  /** Done editing: kept, the screen hears the change; else the value goes back as it was. */
  const endEdit = (keep) => {
    if (!editing) return;
    const { node, before } = editing;
    editing = null;
    node.classList.remove("pad-editing");
    if (!keep) {
      restore(node, before);
      if (node.tagName === "INPUT") fire(node, "input");
      return;
    }
    if (JSON.stringify(valueOf(node)) !== JSON.stringify(before)) { fire(node, "input"); fire(node, "change"); }
  };
  /** One step of the value being edited; a dropdown's screen hears of it only when A keeps it. */
  const step = (node, by) => {
    if (node.tagName === "SELECT") {
      const count = node.options.length;
      if (count) node.selectedIndex = Math.max(0, Math.min(count - 1, node.selectedIndex + by));
    } else {
      if (by > 0) node.stepUp(); else node.stepDown();
      // A slider's figure beside it follows as it moves.
      fire(node, "input");
    }
  };

  const press = () => {
    const node = current();
    if (!node) { const list = focusables(); if (list.length) focus(first(list)); return; }
    usePad();
    if (editing) { endEdit(true); return; }
    if (editable(node)) { startEdit(node); return; }
    if (node.tagName === "TEXTAREA" || (node.tagName === "INPUT" && TEXT_TYPES.has(node.type))) {
      openPadKeyboard(node, context.t ?? ((text) => text));
      return;
    }
    const list = node.getAttribute("role") === "option" ? node.closest("[role=listbox]") : null;
    const index = list ? [...list.querySelectorAll("[role=option]")].indexOf(node) : -1;
    sound(menuSoundFor(node), 0.6);
    node.click();
    // A list drawn again for the click (the track list): the focus goes to the same row in the new one.
    if (list && !node.isConnected) {
      const rows = [...list.querySelectorAll("[role=option]")];
      const again = list.querySelector("[role=option][aria-selected=true]") ?? rows[Math.min(index, rows.length - 1)];
      if (again) focus(again);
    }
  };

  const back = () => {
    usePad();
    if (editing) { endEdit(false); return; }
    const dialog = openDialogs().at(-1);
    if (dialog) {
      const cancel = new win.Event("cancel", { cancelable: true });
      if (dialog.dispatchEvent(cancel)) dialog.close();
      return;
    }
    if (ESCAPE_SCREENS.has(screenName())) { pressKey("Escape", "keydown"); pressKey("Escape", "keyup"); return; }
    const backButton = [...doc.querySelectorAll(".stage-back, [data-pad-back]")].find((n) => visible(n) && !n.disabled);
    if (backButton) { sound(menuSoundFor(backButton), 0.6); backButton.click(); return; }
    if ((context.router?.stack.length ?? 0) > 1) context.router.back();
  };

  /** LB / RB: the tab before or after the selected one (the Options tabs). */
  const tab = (step) => {
    const tabs = [...scope().querySelectorAll(".opt-tab")].filter(visible);
    if (!tabs.length) return;
    const at = tabs.findIndex((n) => n.classList.contains("selected"));
    const next = tabs[(at + step + tabs.length) % tabs.length];
    usePad();
    sound(menuSoundFor(next), 0.6);
    next.click();
    next.focus({ preventScroll: true });
  };

  const menuPress = (button) => {
    if (button === PAD.A) press();
    else if (button === PAD.B) back();
    else if (button === PAD.LB) tab(-1);
    else if (button === PAD.RB) tab(1);
    // On the paused race, Start resumes as it paused.
    else if (button === PAD.START && screenName() === "race") { const code = actionKey("pause"); if (code) { pressKey(code, "keydown"); pressKey(code, "keyup"); } }
  };

  const direction = (dir) => {
    if (editing) { usePad(); step(editing.node, dir === "right" || dir === "down" ? 1 : -1); return; }
    move(dir);
  };

  const loop = (now) => {
    frame = win.requestAnimationFrame(loop);
    const pads = win.navigator.getGamepads ? [...win.navigator.getGamepads()] : [];
    const pad = choosePad(pads);
    if (!pad) { prev = []; return; }
    if (editing && (doc.activeElement !== editing.node || !editing.node.isConnected)) endEdit(false);
    const down = pad.buttons.map((b) => !!b?.pressed);
    const edge = (i) => down[i] && !prev[i];
    if (driving()) {
      for (const [button, action] of Object.entries(DRIVE_BUTTONS)) {
        const i = Number(button);
        if (down[i] === !!prev[i]) continue;
        const code = actionKey(action);
        if (!code) continue;
        if (down[i]) heldKeys.add(code); else heldKeys.delete(code);
        pressKey(code, down[i] ? "keydown" : "keyup");
      }
    } else {
      for (const code of heldKeys) pressKey(code, "keyup");
      heldKeys.clear();
      for (const button of [PAD.A, PAD.B, PAD.LB, PAD.RB, PAD.START]) if (edge(button)) menuPress(button);
      const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
      const held = {
        up: down[PAD.UP] || y < -STICK, down: down[PAD.DOWN] || y > STICK,
        left: down[PAD.LEFT] || x < -STICK, right: down[PAD.RIGHT] || x > STICK,
      };
      for (const [dir, on] of Object.entries(held)) {
        if (!on) { repeatAt.delete(dir); continue; }
        const at = repeatAt.get(dir);
        if (at === undefined) { repeatAt.set(dir, now + REPEAT_FIRST_MS); direction(dir); }
        else if (now >= at) { repeatAt.set(dir, now + REPEAT_MS); direction(dir); }
      }
    }
    prev = down;
  };
  frame = win.requestAnimationFrame(loop);
  return () => {
    win.cancelAnimationFrame(frame);
    for (const type of ["mousemove", "pointerdown", "keydown"]) win.removeEventListener(type, leavePad, true);
  };
}
