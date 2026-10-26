/*
  Fullscreen, and the game as an installed app (manifest.webmanifest).

  - A Fullscreen button where the browser can put the page fullscreen (desktop browsers, Android). Only a click or a
    tap can do it: a browser does not count a gamepad's press. On a phone it also turns the screen to landscape.
  - Installed (Add to Home Screen, Install app) the game opens with no browser bars at all, and the button is not shown.
  - A tip, once, in a phone's browser tab. An iPhone puts only videos fullscreen, so there it is the way: Share, then
    Add to Home Screen. On Android it offers the browser's own Install prompt.
*/
import { el } from "./dom.js";
import { saveSettings } from "../app/settings.js";

/** Opened from the Home Screen or as an installed app. */
export const isInstalled = (win = window) =>
  !!win.matchMedia?.("(display-mode: fullscreen), (display-mode: standalone)").matches || win.navigator.standalone === true;

/** The browser can put the page fullscreen (never on an iPhone). */
export const canFullscreen = (doc = document) => !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

const fullscreenNow = (doc) => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

export async function toggleFullscreen(doc = document) {
  try {
    if (fullscreenNow(doc)) {
      await (doc.exitFullscreen ?? doc.webkitExitFullscreen).call(doc);
      return;
    }
    const root = doc.documentElement;
    await (root.requestFullscreen ?? root.webkitRequestFullscreen).call(root, { navigationUI: "hide" });
    // Landscape where the browser allows it (Android, in fullscreen); refused elsewhere, which is fine.
    await doc.defaultView.screen.orientation?.lock?.("landscape").catch(() => {});
  } catch {
    // Refused (no click behind it, or the browser will not): the page stays as it is.
  }
}

/** The Fullscreen button, or null where it cannot work or is not needed. */
export function fullscreenButton(t, className) {
  if (isInstalled() || !canFullscreen()) return null;
  const button = el("button", { class: className, onclick: () => toggleFullscreen() });
  const label = () => { button.textContent = fullscreenNow(document) ? t("Exit fullscreen") : t("Fullscreen"); };
  const onChange = () => {
    if (!button.isConnected) { document.removeEventListener("fullscreenchange", onChange); document.removeEventListener("webkitfullscreenchange", onChange); return; }
    label();
  };
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  label();
  return button;
}

const isIphone = (nav = navigator) => /iPhone|iPod/.test(nav.userAgent);
const isPhone = (win = window) => !!win.matchMedia?.("(pointer: coarse)").matches && Math.min(win.screen.width, win.screen.height) < 600;

/**
 * The phone tip, once (`settings.installTipSeen`). The browser's install prompt is caught from the start, since it comes
 * only once and may come before the tip is shown.
 */
export function startInstallTip(context, win = window) {
  let prompt = null, banner = null, installButton = null;
  win.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event;
    if (installButton) installButton.hidden = false;
  });
  const t = (text) => context.t?.(text) ?? text;
  const close = () => {
    banner?.remove();
    banner = null;
    context.settings.installTipSeen = true;
    saveSettings(context.settings);
  };
  return function show() {
    if (banner || context.settings.installTipSeen || isInstalled(win) || !isPhone(win)) return;
    const iphone = isIphone(win.navigator);
    installButton = el("button", {
      class: "primary", hidden: !prompt,
      onclick: async () => { const asked = prompt; prompt = null; await asked?.prompt(); close(); },
    }, t("Install"));
    banner = el("div", { class: "install-tip", role: "note" },
      el("p", {}, iphone
        ? t("For fullscreen, add OpenMTM2 to your Home Screen: tap Share, then Add to Home Screen. The Home Screen copy keeps its own files, so install the game once more there.")
        : t("For fullscreen, install OpenMTM2 as an app, or tap Fullscreen in the menus.")),
      el("div", { class: "install-tip-actions" }, iphone ? null : installButton, el("button", { onclick: close }, t("Close"))));
    win.document.body.append(banner);
  };
}
