/*
  Results: each truck's place, time, best lap and laps (MONSTER_EXE_ANALYSIS.md 6), in the
  race order the simulation settled.
*/
import { el } from "../dom.js";
import { formatRaceTime, ordinal } from "../../game/race-setup.js";

export default async function mount(container, context, { track, laps, rows }) {
  const sorted = [...rows].sort((a, b) => a.place - b.place);
  container.append(el("section", { class: "screen" },
    el("h1", { class: "screen-title" }, "Results"),
    el("div", { class: "screen-panel" },
      el("p", { class: "muted" }, `${track.name}, ${laps} ${laps === 1 ? "lap" : "laps"}`),
      el("table", { class: "results" },
        el("thead", {}, el("tr", {}, ...["Place", "Driver", "Truck", "Time", "Best lap"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...sorted.map((r) => el("tr", { class: r.player ? "player" : null },
          el("td", {}, ordinal(r.place)),
          el("td", {}, r.name),
          el("td", {}, r.truckName),
          el("td", {}, r.finished ? formatRaceTime(r.raceTime) : `${r.laps} of ${laps} laps`),
          el("td", {}, r.best ? formatRaceTime(r.best) : "")))),
      ),
      el("div", { class: "screen-actions" },
        el("button", { onclick: () => context.router.go("start", {}, { replace: false }) }, "Main menu"),
        el("button", { class: "primary", onclick: () => context.router.go("race-select") }, "Race again")),
    ),
  ));
}
