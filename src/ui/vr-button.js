/*
  The button that puts the game in a headset (docs/VR.md). It shows only where the browser can
  open an immersive VR session, and turns into the way out while one runs.
*/
import { el } from "./dom.js";

/**
 * @param {object} context the app's context (`xr`: app/xr.js)
 * @param {string} [className] placed by the screen that shows it
 * @returns {{ element: HTMLButtonElement, dispose: () => void }}
 */
export function vrButton(context, className = "") {
  const { xr } = context;
  const t = (text) => context.t?.(text) ?? text;
  const button = el("button", { class: `vr-button ${className}`.trim(), hidden: true, "data-menu-sound": "none" }, t("Enter VR"));
  const show = () => {
    button.textContent = xr.presenting ? t("Leave VR") : t("Enter VR");
    button.title = "";
  };
  xr.supported.then((yes) => { button.hidden = !yes; });
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      // Straight from the click: a browser opens a session only then.
      if (xr.presenting) await xr.exit(); else await xr.enter();
      show();
    } catch (err) {
      button.textContent = t("VR did not start");
      button.title = err?.message ?? String(err);
    } finally {
      button.disabled = false;
    }
  });
  const off = xr.onChange(show);
  show();
  return { element: button, dispose: off };
}
