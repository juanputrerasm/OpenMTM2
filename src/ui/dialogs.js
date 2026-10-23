/*
  The game's own message boxes, in place of the browser's alert, confirm and prompt. Those stop the page until the mouse or
  keyboard answers them, so a player with only a gamepad (ui/gamepad-nav.js) could not get past one. These are <dialog>s
  like the rest, answered with the pad, the keys, the mouse or a touch.

  Each takes the translator in use (`context.t`) and returns a promise: nothing, true or false, or the text typed (null when
  cancelled).
*/
import { el } from "./dom.js";

function messageBox(t, text, buttons, field = null) {
  return new Promise((resolve) => {
    let answer = buttons.find((b) => b.cancel)?.value ?? buttons[0].value;
    const dialog = el("dialog", { class: "options-sub message-box", "aria-label": String(text).split("\n")[0] },
      el("p", { class: "message-box-text" }, String(text)),
      field,
      el("div", { class: "options-sub-actions" }, ...buttons.map((b) => el("button", {
        class: b.primary ? "primary" : null,
        onclick: () => { answer = typeof b.value === "function" ? b.value() : b.value; dialog.close(); },
      }, t(b.label)))));
    // Escape (or the pad's B) is the cancel button's answer.
    dialog.addEventListener("close", () => { dialog.remove(); resolve(answer); }, { once: true });
    if (field) field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); answer = field.value; dialog.close(); }
    });
    document.body.append(dialog);
    dialog.showModal();
    (field ?? dialog.querySelector("button.primary"))?.focus();
  });
}

/** A message with OK. */
export const showAlert = (t, text) => messageBox(t, text, [{ label: "OK", value: undefined, primary: true, cancel: true }]);

/** A question with OK and Cancel: true for OK. */
export const showConfirm = (t, text) => messageBox(t, text, [
  { label: "OK", value: true, primary: true }, { label: "Cancel", value: false, cancel: true },
]);

/** A question with a line to type in: the text, or null for Cancel. */
export function showPrompt(t, text, value = "") {
  const field = el("input", { type: "text", class: "message-box-field", value, "aria-label": String(text) });
  return messageBox(t, text, [
    { label: "OK", value: () => field.value, primary: true }, { label: "Cancel", value: null, cancel: true },
  ], field);
}
