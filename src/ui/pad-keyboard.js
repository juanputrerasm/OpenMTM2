/*
  An on-screen keyboard for a text box, for a player with only a gamepad (ui/gamepad-nav.js): A on a text box opens it,
  the D-pad picks a key, A types it, Done keeps the text and B puts back what was there. The text goes into the box as it
  is typed, with the box's own input events, and a change event when Done closes the keyboard.
*/
import { el } from "./dom.js";

const ROWS = ["1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm_.@"];

export function openPadKeyboard(target, t) {
  if (target.ownerDocument.querySelector("dialog.pad-keyboard[open]")) return;
  let upper = false, cancelled = false;
  const before = target.value;
  const limit = target.maxLength > 0 ? target.maxLength : Infinity;
  const preview = el("div", { class: "pad-keyboard-text", "aria-live": "polite" });
  const show = () => {
    preview.textContent = target.type === "password" ? "•".repeat(target.value.length) : target.value;
    for (const key of dialog.querySelectorAll("[data-char]")) key.textContent = upper ? key.dataset.char.toUpperCase() : key.dataset.char;
  };
  const setValue = (value) => {
    target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    show();
  };
  const type = (char) => { if (target.value.length < limit) setValue(target.value + (upper ? char.toUpperCase() : char)); };
  const key = (char) => el("button", { type: "button", class: "pad-key", "data-char": char, onclick: () => type(char) }, char);
  const dialog = el("dialog", { class: "options-sub pad-keyboard", "aria-label": t("Keyboard") },
    preview,
    ...ROWS.map((row) => el("div", { class: "pad-keyboard-row" }, ...[...row].map(key))),
    el("div", { class: "pad-keyboard-row" },
      el("button", { type: "button", class: "pad-key pad-key-wide", onclick: () => { upper = !upper; show(); } }, t("Shift")),
      el("button", { type: "button", class: "pad-key pad-key-space", onclick: () => type(" ") }, t("Space")),
      el("button", { type: "button", class: "pad-key pad-key-wide", onclick: () => setValue(target.value.slice(0, -1)) }, "⌫"),
      el("button", { type: "button", class: "pad-key pad-key-wide primary", onclick: () => dialog.close() }, t("Done"))));
  // B, or Escape: the text as it was.
  dialog.addEventListener("cancel", () => { cancelled = true; });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (cancelled) {
      target.value = before;
      target.dispatchEvent(new Event("input", { bubbles: true }));
    } else target.dispatchEvent(new Event("change", { bubbles: true }));
    target.focus({ preventScroll: true });
  }, { once: true });
  target.ownerDocument.body.append(dialog);
  show();
  dialog.showModal();
  dialog.querySelector("[data-char]")?.focus();
}
