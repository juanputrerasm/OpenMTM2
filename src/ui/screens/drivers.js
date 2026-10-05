/*
  Driver Check-in: who is playing, their skill level and truck. Add, pick, rename and remove
  driver profiles; each keeps its own Garage setup, last truck and race tally.
*/
import { el } from "../dom.js";
import { currentDriver, getProfiles, saveProfiles } from "../../app/profile-store.js";
import { saveSettings } from "../../app/settings.js";
import { MAX_NAME_LENGTH, addDriver, removeDriver, renameDriver } from "../../game/profile.js";
import { frame } from "../frame.js";

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];

export default async function mount(container, context) {
  const { settings } = context;
  const profiles = await getProfiles(context);
  const catalog = await context.assets.call("catalog");
  const trucks = catalog.trucks.filter((t) => settings.showHiddenTrucks || !t.hidden);
  const message = el("p", { class: "error" });
  const list = el("ul", { class: "pick-list", role: "listbox" });
  const truckList = el("ul", { class: "pick-list", role: "listbox" });
  const name = el("input", { type: "text", maxlength: MAX_NAME_LENGTH, placeholder: "Driver name", "aria-label": "Driver name" });
  const skill = el("select", { "aria-label": "Skill level", onchange: (e) => { settings.difficulty = Number(e.target.value); saveSettings(settings); } },
    ...DIFFICULTIES.map((n, i) => el("option", { value: i, selected: i === settings.difficulty }, context.t(n))));

  const changed = (error) => {
    message.textContent = error ?? "";
    if (!error) saveProfiles(context);
    show();
  };
  const show = () => {
    list.replaceChildren(...profiles.drivers.map((d, i) => el("li", {},
      el("button", {
        class: i === profiles.current ? "pick selected" : "pick", role: "option", "aria-selected": i === profiles.current,
        onclick: () => { profiles.current = i; changed(null); },
      }, `${d.name} (${d.races} ${d.races === 1 ? "race" : "races"}, ${d.wins} ${d.wins === 1 ? "win" : "wins"})`))));
    const driver = currentDriver(profiles);
    truckList.replaceChildren(...trucks.map((t) => el("li", {},
      el("button", {
        class: t.file === driver.lastTruck ? "pick selected" : "pick", role: "option", "aria-selected": t.file === driver.lastTruck,
        onclick: () => { driver.lastTruck = t.file; changed(null); },
      }, t.name))));
    name.value = "";
  };
  if (!currentDriver(profiles).lastTruck && trucks[0]) currentDriver(profiles).lastTruck = trucks[0].file;
  show();

  const ui = await frame(container, context, {
    title: "Driver Check-in", backdrop: "DRIVER",
    regions: { drivers: [20, 158, 330, 240], trucks: [354, 158, 242, 226] },
  });
  ui.regions.drivers.append(...[
    list, message,
    el("div", { class: "form-row" }, name,
      el("button", { onclick: () => changed(addDriver(profiles, name.value)) }, "Add"),
      el("button", { onclick: () => changed(renameDriver(profiles, profiles.current, name.value)) }, "Rename"),
      el("button", { onclick: () => changed(removeDriver(profiles, profiles.current)) }, "Remove")),
    el("div", { class: "form-row" }, el("label", {}, "Skill level ", skill)),
    ui.classic ? null : el("div", { class: "screen-actions" }, el("button", { class: "primary", onclick: () => context.router.back() }, "Back")),
  ].filter(Boolean));
  ui.regions.trucks.append(...[ui.classic ? null : el("h2", {}, "Select truck"), truckList].filter(Boolean));
  return { unmount: ui.unmount };
}
