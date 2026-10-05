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
  results: [["hall", "Hall of Fame", "hall"], ["replay", "Instant Replay", null], ["continue", "Continue", "start"]],
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
 * @param {{ title: string, backdrop?: string, bar?: keyof typeof BARS, regions?: Record<string, number[]>, options?: boolean }} spec
 *   `regions`: classic panel rectangles by name; the modern skin stacks them in one panel.
 * @returns {Promise<{ classic: boolean, regions: Record<string, HTMLElement>, unmount?: () => void }>}
 */
export async function frame(container, context, { title, backdrop, bar = "main", regions = { main: [24, 120, 592, 280] }, options = true }) {
  const url = context.settings.skin === "classic" && backdrop ? await uiImageUrl(context.assets, backdrop) : null;
  if (!url) {
    const panel = el("div", { class: "screen-panel" });
    const screen = el("section", { class: "screen" }, el("h1", { class: "screen-title" }, title), panel);
    if (options) screen.append(optionsButton(context, "screen-utility"));
    container.append(screen);
    return { classic: false, regions: Object.fromEntries(Object.keys(regions).map((name) => [name, panel])) };
  }

  const stage = el("div", { class: "stage", role: "group", "aria-label": title }, el("img", { class: "stage-backdrop", src: url, alt: "", draggable: "false" }));
  const rects = {};
  const panels = Object.fromEntries(Object.entries(regions).map(([name, rect]) => {
    const panel = el("div", { class: `stage-panel stage-panel-${name}` });
    place(panel, rect);
    stage.append(panel);
    rects[name] = panel;
    return [name, panel];
  }));
  for (const [button, label, action] of BARS[bar] ?? []) {
    const hotspot = el("button", {
      class: "stage-hotspot", "aria-label": label, title: label, disabled: action === null,
      "data-menu-sound": action === "go" ? "GOOFF" : action && action !== "web" ? "STARTOFF" : null,
      onclick: () => navigate(context, action),
    });
    place(hotspot, BUTTONS[button]);
    stage.append(hotspot);
  }
  if (options) stage.append(optionsButton(context, "stage-utility"));
  const view = el("section", { class: "stage-view" }, stage);
  container.append(view);
  const fit = () => stage.style.setProperty("--stage-scale", String(Math.min(view.clientWidth / 640, view.clientHeight / 480)));
  const observer = new ResizeObserver(fit);
  observer.observe(view);
  fit();
  return { classic: true, regions: panels, unmount: () => observer.disconnect() };
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
  const screens = { drivers: ["drivers"], garage: ["garage"], hall: ["hall"], start: ["start"], races: ["race-select", { mode: context.raceConfig?.mode ?? "circuit" }] };
  const [name, params = {}] = screens[action];
  return router.go(name, params, { replace: true });
}
