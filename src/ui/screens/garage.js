/*
  Garage: the player's truck. Then the race.
*/
import { el } from "../dom.js";
import { saveSettings } from "../../app/settings.js";

export default async function mount(container, context, { track, laps, difficulty, opponents }) {
  const { settings } = context;
  const catalog = await context.assets.call("catalog");
  const trucks = catalog.trucks.filter((t) => settings.showHiddenTrucks || !t.hidden);
  let truck = trucks.find((t) => t.file === settings.lastTruck) ?? trucks[0];
  const list = el("ul", { class: "pick-list", role: "listbox" });
  const show = () => list.replaceChildren(...trucks.map((t) => el("li", {},
    el("button", {
      class: t === truck ? "pick selected" : "pick", role: "option", "aria-selected": t === truck,
      onclick: () => { truck = t; show(); },
    }, t.name))));
  show();
  const race = () => {
    settings.lastTruck = truck.file;
    saveSettings(settings);
    context.router.go("race", { track, laps, difficulty, opponents, truck: truck.file, trucks });
  };
  container.append(el("section", { class: "screen" },
    el("h1", { class: "screen-title" }, "Garage"),
    el("div", { class: "screen-panel" },
      el("p", { class: "muted" }, `${track.name}, ${laps} ${laps === 1 ? "lap" : "laps"}`),
      trucks.length ? list : el("p", { class: "error" }, "The install has no trucks."),
      el("div", { class: "screen-actions" },
        el("button", { onclick: () => context.router.back() }, "Back"),
        el("button", { class: "primary", onclick: race, disabled: !truck }, "Race")),
    ),
  ));
}
