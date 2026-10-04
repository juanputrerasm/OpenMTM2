/*
  Race select: a Circuit track, the laps (the track's default, MONSTER_EXE_ANALYSIS.md 3), the
  number of CPU opponents (`defaultOpponents`, section 9) and the difficulty. Then the garage.
*/
import { el } from "../dom.js";
import { saveSettings } from "../../app/settings.js";

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];

export default async function mount(container, context) {
  const { settings } = context;
  const catalog = await context.assets.call("catalog");
  const tracks = catalog.tracks.filter((t) => t.raceType === "circuit" && (settings.showHiddenTracks || !t.hidden));
  let track = tracks.find((t) => t.file === settings.lastTrack) ?? tracks[0];
  if (!track) {
    container.append(el("section", { class: "screen" }, el("p", { class: "error" }, "The install has no Circuit tracks.")));
    return;
  }

  const laps = el("input", { type: "number", min: 1, max: 99, value: track.defaultLaps, class: "laps-input", "aria-label": "Laps" });
  const opponents = el("select", { "aria-label": "Opponents" },
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => el("option", { value: n, selected: n === settings.opponents }, String(n))));
  const difficulty = el("select", { "aria-label": "Difficulty" },
    ...DIFFICULTIES.map((name, i) => el("option", { value: i, selected: i === settings.difficulty }, name)));
  const list = el("ul", { class: "pick-list", role: "listbox" });
  const detail = el("p", { class: "muted" });
  const show = () => {
    list.replaceChildren(...tracks.map((t) => el("li", {},
      el("button", {
        class: t === track ? "pick selected" : "pick", role: "option", "aria-selected": t === track,
        onclick: () => { track = t; laps.value = t.defaultLaps; show(); },
      }, t.name))));
    detail.textContent = `${track.locale ?? ""}${track.locale ? ". " : ""}${track.defaultLaps} laps by default.`;
  };
  show();

  const next = () => {
    const chosen = {
      laps: Math.max(1, Math.min(99, Math.trunc(Number(laps.value)) || track.defaultLaps)),
      difficulty: Number(difficulty.value), opponents: Number(opponents.value),
    };
    Object.assign(settings, { lastTrack: track.file, difficulty: chosen.difficulty, opponents: chosen.opponents });
    saveSettings(settings);
    context.router.go("garage", { track, ...chosen });
  };
  container.append(el("section", { class: "screen" },
    el("h1", { class: "screen-title" }, "Circuit Race"),
    el("div", { class: "screen-panel" },
      list, detail,
      el("div", { class: "form-row" }, el("label", {}, "Laps ", laps), el("label", {}, "Opponents ", opponents), el("label", {}, "Difficulty ", difficulty)),
      el("div", { class: "screen-actions" },
        el("button", { onclick: () => context.router.back() }, "Back"),
        el("button", { class: "primary", onclick: next }, "Garage")),
    ),
  ));
}
