/*
  The frame around a menu screen, in one of two skins.

  Modern: the page's own dark layout, a title and one panel.

  Classic: the original game's 640 x 480 screen. `UI\<backdrop>.BMP` fills the stage, the
  baked-in buttons along its bottom (Driver Check-in, Races, Garage, Multiplayer, GO, or
  Continue) are laid over with invisible hotspots, and the screen's content goes in panels
  placed on the art's own empty areas. The stage scales to the window. If the backdrop cannot
  be read the screen falls back to the modern skin.
*/
import { el } from "./dom.js";
import { msg } from "../game/strings.js";
import { goRace, goDemo } from "../app/flow.js";
import { resolveSkin } from "../install/exe-version.js";
import { vrButton } from "./vr-button.js";
import { fullscreenButton } from "./fullscreen.js";

/** Baked button rectangles [x, y, w, h] on the 640 x 480 art. */
const BUTTONS = {
  driver: [16, 410, 116, 40], races: [136, 410, 116, 40], garage: [256, 410, 114, 40], multi: [374, 410, 116, 40],
  go: [508, 408, 118, 44], continue: [508, 408, 118, 44], hall: [16, 408, 116, 44], replay: [136, 408, 116, 44],
  again: [256, 408, 116, 44],
  startDriver: [506, 408, 122, 44],
  startWeb: [54, 406, 70, 50], startDemo: [208, 406, 64, 50], startManual: [376, 406, 64, 50],
};

/**
 * The hotspots per bar: [button, label, action name, modern only]; `null` actions are drawn nowhere in the game either. A
 * button the art does not paint (modern only) is left out on the classic stage.
 */
const BARS = {
  main: [["driver", msg("Driver Check-in"), "drivers"], ["races", msg("Races"), "races"], ["garage", msg("Garage"), "garage"], ["multi", msg("Multiplayer"), "multi"], ["go", msg("GO"), "go"]],
  // The Multiplayer Screen: its GO (or Ready) is the screen's own button.
  net: [["driver", msg("Driver Check-in"), "drivers"], ["races", msg("Races"), "races"], ["garage", msg("Garage"), "garage"], ["multi", msg("Multiplayer"), "multi"]],
  hall: [["continue", msg("Continue"), "back"]],
  // The Winner's Circle after a tournament's race: Continue goes back to the tournament.
  tournament: [["hall", msg("Hall of Fame"), "hall"], ["replay", msg("Instant Replay"), "replay"], ["continue", msg("Continue"), "tournament"]],
  results: [["hall", msg("Hall of Fame"), "hall"], ["replay", msg("Instant Replay"), "replay"], ["again", msg("Race Again"), "again", true], ["continue", msg("Continue"), "continue"]],
  start: [["startWeb", msg("Web Page"), "web"], ["startDemo", msg("Monster Demo"), "demo"], ["startManual", msg("Monster Manual"), null], ["startDriver", msg("Driver Check-in"), "drivers"]],
  none: [],
};

/** On the modern stage the Start screen's Driver Check-in is yellow, the way in among the other buttons. */
const PRIMARY_BUTTONS = new Set(["startDriver"]);

/** The Status column's location for each menu screen, by its backdrop (legacy-session.js LOCATION). */
const NET_LOCATIONS = { START: 1, DRIVER: 2, RACES: 3, GARAGE: 4, NETWORK: 5, HALLFAME: 6, RESULTS: 7 };

const images = new Map();

/** The blob URL of a `UI\*.BMP`, cached; null when the install lacks it. */
export function uiImageUrl(assets, name) {
  if (!images.has(name)) {
    images.set(name, assets.call("uiImage", { name }).then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes], { type: "image/bmp" })) : null)).catch(() => null));
  }
  return images.get(name);
}

/**
 * Forget every cached `UI\*.BMP` (the POD manager, after the mounted archives change: another
 * archive may now hold the file). Pictures already on screen stay put; the next screen reads again.
 */
export function clearUiImageCache() {
  for (const pending of images.values()) pending.then((url) => { if (url) URL.revokeObjectURL(url); }).catch(() => {});
  images.clear();
}

/**
 * @param {HTMLElement} container
 * @param {object} context
 * @param {{ title: string, backdrop?: string, bar?: keyof typeof BARS, regions?: Record<string, number[]>, options?: boolean,
 *   labels?: [string, number[]][], modernRegions?: Record<string, number[]>, current?: string, scene?: string }} spec
 *   `regions`: panel rectangles on the 640 x 480 stage. Both skins lay a screen out the same way: the classic one on the game's
 *   art, the modern one on a plain stage that draws what the art would (the title, `labels` such as "Player Name" baked into the
 *   art, and the bottom bar's buttons with their names) and may move panels with `modernRegions`. `current` is the bar button of
 *   this screen, shown pressed in the modern skin. `scene` names the modern stage (`stage-scene-<scene>`) so a screen can dress it.
 * @returns {Promise<{ classic: true, art: boolean, regions: Record<string, HTMLElement>, unmount?: () => void }>}
 */
export async function frame(container, context, { title, backdrop, bar = "main", regions = { main: [24, 120, 592, 280] }, options = true, labels = [], modernRegions = {}, current = null, plainTitle = false, scene = null }) {
  // In a network game the others see where this player is (the Status column, MONSTER_EXE_ANALYSIS.md 14.3).
  if (context.net && NET_LOCATIONS[backdrop]) context.net.session.setLocation(NET_LOCATIONS[backdrop]);
  const url = resolveSkin(context.settings.skin, context.exeVersion) === "classic" && backdrop ? await uiImageUrl(context.assets, backdrop) : null;
  const art = !!url;
  // Every menu screen can put the game in a headset, where the browser has one (docs/VR.md).
  const enterVr = context.xr ? vrButton(context, url ? "stage-vr" : "screen-vr") : null;
  const t = (text) => context.t?.(text) ?? text;
  const stage = el("div", { class: `stage${art ? "" : ` stage-modern${scene ? ` stage-scene-${scene}` : ""}`}`, role: "group", "aria-label": t(title) });
  if (art) stage.append(el("img", { class: "stage-backdrop", src: url, alt: "", draggable: "false" }));
  else {
    stage.append(el("h1", { class: plainTitle ? "stage-title stage-title-plain" : "stage-title" }, t(title)));
    for (const [text, rect] of labels) {
      const label = el("div", { class: "stage-label" }, t(text));
      place(label, rect);
      stage.append(label);
    }
    if (enterVr) stage.append(enterVr.element);
  }
  const panels = Object.fromEntries(Object.entries(regions).map(([name, rect]) => {
    const panel = el("div", { class: `stage-panel stage-panel-${name}` });
    place(panel, (!art && modernRegions[name]) || rect);
    stage.append(panel);
    return [name, panel];
  }));
  for (const [button, label, action, modernOnly] of BARS[bar] ?? []) {
    if (art && modernOnly) continue;
    const hotspot = el("button", {
      class: art ? "stage-hotspot" : `stage-button${action === current ? " current" : ""}${button === "go" ? " go" : ""}${PRIMARY_BUTTONS.has(button) ? " primary" : ""}`,
      "aria-label": t(label), title: t(label), disabled: action === null,
      "data-menu-sound": action === "go" || action === "again" ? "GOOFF" : action && action !== "web" ? "STARTOFF" : null,
      onclick: () => navigate(context, action),
    }, art ? "" : t(label));
    place(hotspot, BUTTONS[button]);
    stage.append(hotspot);
  }
  // Options, and on the Start screen Fullscreen where the browser can do it (ui/fullscreen.js), in the top corner.
  const fullscreen = bar === "start" ? fullscreenButton(t, "stage-utility") : null;
  if (options || fullscreen) stage.append(el("div", { class: "stage-utilities" }, fullscreen, options ? optionsButton(context, "stage-utility") : null));
  // The modern skin also has a way back from a screen with no bottom bar to leave by.
  if (!art && bar === "none") {
    stage.append(el("button", { class: "stage-back", "data-menu-sound": "STARTOFF", onclick: () => context.router.back() }, t("Back")));
  }
  if (enterVr) stage.append(enterVr.element);
  const view = el("section", { class: `stage-view${art ? "" : " stage-view-modern"}` }, stage);
  container.append(view);
  const fit = () => stage.style.setProperty("--stage-scale", String(Math.min(view.clientWidth / 640, view.clientHeight / 480)));
  const observer = new ResizeObserver(fit);
  observer.observe(view);
  fit();
  return { classic: true, art, regions: panels, unmount: () => { observer.disconnect(); enterVr?.dispose(); } };
}

function optionsButton(context, className) {
  const label = context.t?.("Options") ?? "Options";
  return el("button", {
    class: className, "aria-label": label,
    onclick: async () => (await import("./screens/options.js")).openOptionsModal(context),
  }, label);
}

function place(node, [x, y, w, h]) {
  Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}

async function navigate(context, action) {
  const { router } = context;
  if (action === "back") return router.back();
  // In a network game the race is the host's to start, from the Multiplayer Screen.
  if ((action === "go" || action === "again") && context.net) return router.go("multiplayer", {}, { replace: true });
  if (action === "go" || action === "again") return goRace(context);
  if (action === "multi") return router.go(context.net ? "multiplayer" : "net-connect", {}, { replace: true });
  // The results' Continue: back to the Races screen, or to the Multiplayer Screen after a network race.
  if (action === "continue") return context.net ? router.go("multiplayer", {}, { replace: true }) : navigate(context, "races");
  if (action === "demo") return goDemo(context);
  if (action === "web") return window.open("https://mtm2.com/", "_blank", "noopener");
  if (action === "replay") return context.lastReplay ? router.go("replay", { replay: context.lastReplay }) : undefined;
  const screens = { tournament: ["tournament"], drivers: ["drivers"], garage: ["garage"], hall: ["hall"], start: ["start"], races: ["race-select", { mode: context.raceConfig?.mode ?? "circuit" }] };
  const [name, params = {}] = screens[action];
  return router.go(name, params, { replace: true });
}
