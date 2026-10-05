/*
  Race select: a track of the chosen mode (Circuit, Rally or Summit Rumble), the laps (the
  track's default, MONSTER_EXE_ANALYSIS.md 3; a Rumble's are minutes), the number of CPU
  opponents (`defaultOpponents`, section 9) and the difficulty. Then the garage.
*/
import { el } from "../dom.js";
import { saveSettings } from "../../app/settings.js";
import { setRaceConfig } from "../../app/flow.js";
import { frame } from "../frame.js";
import { WEATHER_NAMES, allowedWeathers, resolveWeather } from "../../game/weather.js";

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];
const MODES = {
  circuit: { title: "Circuit Race", unit: "Laps", noun: "laps" },
  rally: { title: "Rally Race", unit: "Laps", noun: "laps" },
  summit: { title: "Summit Rumble", unit: "Minutes", noun: "minutes" },
};

export default async function mount(container, context, { mode = "circuit" } = {}) {
  const info = MODES[mode] ?? MODES.circuit;
  const { settings } = context;
  const catalog = await context.assets.call("catalog");
  const tracks = catalog.tracks.filter((t) => t.raceType === mode && (settings.showHiddenTracks || !t.hidden));
  let track = tracks.find((t) => t.file === settings.lastTrack) ?? tracks[0];
  if (!track) {
    container.append(el("section", { class: "screen" }, el("p", { class: "error" }, `The install has no ${info.title} tracks.`)));
    return;
  }

  const laps = el("input", { type: "number", min: 1, max: 99, value: track.defaultLaps, class: "laps-input", "aria-label": info.unit });
  const opponents = el("select", { "aria-label": "Opponents" },
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => el("option", { value: n, selected: n === settings.opponents }, String(n))));
  const difficulty = el("select", { "aria-label": "Difficulty" },
    ...DIFFICULTIES.map((name, i) => el("option", { value: i, selected: i === settings.difficulty }, context.t(name))));
  const weather = el("select", { "aria-label": "Weather" });
  const fillWeather = () => {
    const allowed = allowedWeathers(track.weatherMask);
    const chosen = resolveWeather(settings.weather, track.weatherMask);
    weather.replaceChildren(
      ...allowed.map((w) => el("option", { value: w, selected: settings.weather !== "random" && w === chosen }, context.t(WEATHER_NAMES[w]))),
      allowed.length > 1 ? el("option", { value: "random", selected: settings.weather === "random" }, "Random") : null);
  };
  const list = el("ul", { class: "pick-list", role: "listbox" });
  const detail = el("p", { class: "muted" });
  const show = () => {
    list.replaceChildren(...tracks.map((t) => el("li", {},
      el("button", {
        class: t === track ? "pick selected" : "pick", role: "option", "aria-selected": t === track,
        onclick: () => { track = t; laps.value = t.defaultLaps; fillWeather(); show(); remember(); },
      }, t.name))));
    detail.textContent = `${track.locale ?? ""}${track.locale ? ". " : ""}${track.defaultLaps} ${info.noun} by default.`;
  };
  show();

  // What GO starts: the choice as it stands, kept up to date (and saved) as it changes.
  const remember = () => {
    const chosen = {
      mode, track: track.file,
      laps: Math.max(1, Math.min(99, Math.trunc(Number(laps.value)) || track.defaultLaps)),
      difficulty: Number(difficulty.value), opponents: Number(opponents.value),
      weather: weather.value === "random" ? "random" : Number(weather.value),
    };
    Object.assign(settings, { lastTrack: track.file, difficulty: chosen.difficulty, opponents: chosen.opponents, weather: chosen.weather });
    saveSettings(settings);
    setRaceConfig(context, chosen);
    return chosen;
  };
  fillWeather();
  for (const input of [laps, opponents, difficulty, weather]) input.addEventListener("change", remember);
  remember();

  const ui = await frame(container, context, {
    title: info.title, backdrop: "RACES",
    regions: { list: [42, 134, 274, 196], side: [344, 126, 256, 206], weather: [490, 348, 108, 28] },
  });
  ui.regions.list.append(list, detail);
  if (ui.classic) ui.regions.weather.append(weather);
  else ui.regions.side.append(el("div", { class: "form-row" }, el("label", {}, "Weather ", weather)));
  ui.regions.side.append(
    el("div", { class: "form-row" }, el("label", {}, `${info.unit} `, laps), el("label", {}, "Opponents ", opponents), el("label", {}, "Difficulty ", difficulty)),
    el("div", { class: "screen-actions" },
      ui.classic ? null : el("button", { onclick: () => context.router.back() }, "Back"),
      el("button", { class: "primary", onclick: () => { remember(); context.router.go("garage"); } }, "Garage")));
  return { unmount: ui.unmount };
}
