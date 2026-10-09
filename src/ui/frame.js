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
import { goRace } from "../app/flow.js";
import { resolveSkin } from "../install/exe-version.js";

/** Baked button rectangles [x, y, w, h] on the 640 x 480 art. */
const BUTTONS = {
  driver: [16, 410, 116, 40], races: [136, 410, 116, 40], garage: [256, 410, 114, 40], multi: [374, 410, 116, 40],
  go: [508, 408, 118, 44], continue: [508, 408, 118, 44], hall: [16, 408, 116, 44], replay: [136, 408, 116, 44],
  startDriver: [506, 408, 122, 44],
  startWeb: [54, 406, 70, 50], startDemo: [208, 406, 64, 50], startManual: [376, 406, 64, 50],
};

/** The hotspots per bar: [button, label, action name]; `null` actions are drawn nowhere in the game either. */
const BARS = {
  main: [["driver", "Driver Check-in", "drivers"], ["races", "Races", "races"], ["garage", "Garage", "garage"], ["multi", "Multiplayer", null], ["go", "GO", "go"]],
  hall: [["continue", "Continue", "back"]],
  results: [["hall", "Hall of Fame", "hall"], ["replay", "Instant Replay", "replay"], ["continue", "Continue", "start"]],
  start: [["startWeb", "Web Page", "web"], ["startDemo", "Monster Demo", null], ["startManual", "Monster Manual", null], ["startDriver", "Driver Check-in", "drivers"]],
  none: [],
};

const images = new Map();

/** The blob URL of a `UI\*.BMP`, cached; null when the install lacks it. */
export function uiImageUrl(assets, name) {
  if (!images.has(name)) {
    images.set(name, assets.call("uiImage", { name }).then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes], { type: "image/bmp" })) : null)).catch(() => null));
  }
  return images.get(name);
}

/**
 * @param {HTMLElement} container
 * @param {object} context
 * @param {{ title: string, backdrop?: string, bar?: keyof typeof BARS, regions?: Record<string, number[]>, options?: boolean,
 *   labels?: [string, number[]][], modernRegions?: Record<string, number[]>, current?: string }} spec
 *   `regions`: panel rectangles on the 640 x 480 stage. Both skins lay a screen out the same way: the classic one on the game's
 *   art, the modern one on a plain stage that draws what the art would (the title, `labels` such as "Player Name" baked into the
 *   art, and the bottom bar's buttons with their names) and may move panels with `modernRegions`. `current` is the bar button of
 *   this screen, shown pressed in the modern skin.
 * @returns {Promise<{ classic: true, art: boolean, regions: Record<string, HTMLElement>, unmount?: () => void }>}
 */
export async function frame(container, context, { title, backdrop, bar = "main", regions = { main: [24, 120, 592, 280] }, options = true, labels = [], modernRegions = {}, current = null }) {
  const url = resolveSkin(context.settings.skin, context.exeVersion) === "classic" && backdrop ? await uiImageUrl(context.assets, backdrop) : null;
  const art = !!url;
  const stage = el("div", { class: `stage${art ? "" : " stage-modern"}`, role: "group", "aria-label": title });
  if (art) stage.append(el("img", { class: "stage-backdrop", src: url, alt: "", draggable: "false" }));
  else {
    stage.append(el("h1", { class: "stage-title" }, context.t?.(title) ?? title));
    for (const [text, rect] of labels) {
      const label = el("div", { class: "stage-label" }, context.t?.(text) ?? text);
      place(label, rect);
      stage.append(label);
    }
  }
  const panels = Object.fromEntries(Object.entries(regions).map(([name, rect]) => {
    const panel = el("div", { class: `stage-panel stage-panel-${name}` });
    place(panel, (!art && modernRegions[name]) || rect);
    stage.append(panel);
    return [name, panel];
  }));
  for (const [button, label, action] of BARS[bar] ?? []) {
    const hotspot = el("button", {
      class: art ? "stage-hotspot" : `stage-button${action === current ? " current" : ""}${button === "go" ? " go" : ""}`,
      "aria-label": label, title: label, disabled: action === null,
      "data-menu-sound": action === "go" ? "GOOFF" : action && action !== "web" ? "STARTOFF" : null,
      onclick: () => navigate(context, action),
    }, art ? "" : context.t?.(label) ?? label);
    place(hotspot, BUTTONS[button]);
    stage.append(hotspot);
  }
  if (options) stage.append(optionsButton(context, "stage-utility"));
  // The modern skin also has a way back from a screen with no bottom bar to leave by.
  if (!art && bar === "none") {
    stage.append(el("button", { class: "stage-back", "data-menu-sound": "STARTOFF", onclick: () => context.router.back() }, "Back"));
  }
  const view = el("section", { class: `stage-view${art ? "" : " stage-view-modern"}` }, stage);
  container.append(view);
  const fit = () => stage.style.setProperty("--stage-scale", String(Math.min(view.clientWidth / 640, view.clientHeight / 480)));
  const observer = new ResizeObserver(fit);
  observer.observe(view);
  fit();
  return { classic: true, art, regions: panels, unmount: () => observer.disconnect() };
}

function optionsButton(context, className) {
  return el("button", {
    class: className, "aria-label": "Options",
    onclick: async () => (await import("./screens/options.js")).openOptionsModal(context),
  }, "Options");
}

function place(node, [x, y, w, h]) {
  Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}

async function navigate(context, action) {
  const { router } = context;
  if (action === "back") return router.back();
  if (action === "go") return goRace(context);
  if (action === "web") return window.open("https://mtm2.com/", "_blank", "noopener");
  if (action === "replay") return context.lastReplay ? router.go("replay", { replay: context.lastReplay }) : undefined;
  const screens = { drivers: ["drivers"], garage: ["garage"], hall: ["hall"], start: ["start"], races: ["race-select", { mode: context.raceConfig?.mode ?? "circuit" }] };
  const [name, params = {}] = screens[action];
  return router.go(name, params, { replace: true });
}
