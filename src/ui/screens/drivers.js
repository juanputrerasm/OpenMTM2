/* Driver Check-in: editable profile name, skill and truck selection. */
import { el } from "../dom.js";
import { currentDriver, getProfiles, saveProfiles } from "../../app/profile-store.js";
import { saveSettings } from "../../app/settings.js";
import { MAX_NAME_LENGTH, selectOrAddDriver } from "../../game/profile.js";
import { frame } from "../frame.js";

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];

export default async function mount(container, context) {
  const { settings } = context;
  const profiles = await getProfiles(context);
  const catalog = await context.assets.call("catalog");
  const trucks = catalog.trucks.filter((truck) => !truck.hidden);
  const names = el("datalist", { id: "driver-names" });
  const message = el("p", { class: "driver-message error", "aria-live": "polite" });
  const name = el("input", {
    type: "text", list: "driver-names", maxlength: MAX_NAME_LENGTH,
    autocomplete: "off", "aria-label": "Player name", class: "driver-combo",
  });
  const skill = el("select", { "aria-label": "Skill level", class: "driver-skill" },
    ...DIFFICULTIES.map((label, index) => el("option", { value: index }, context.t(label))));
  const truck = el("select", { "aria-label": "Select truck", class: "driver-truck" });

  const show = () => {
    const driver = currentDriver(profiles);
    if (!driver.lastTruck && trucks[0]) driver.lastTruck = trucks[0].file;
    names.replaceChildren(...profiles.drivers.map((profile) => el("option", { value: profile.name })));
    name.value = driver.name;
    skill.value = String(settings.difficulty);
    truck.replaceChildren(...trucks.map((item) => el("option", {
      value: item.file, selected: item.file === driver.lastTruck,
    }, item.name)));
  };
  const commitName = () => {
    const error = selectOrAddDriver(profiles, name.value);
    message.textContent = error ?? "";
    if (!error) saveProfiles(context);
    show();
  };
  name.addEventListener("change", commitName);
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commitName(); name.blur(); }
  });
  skill.addEventListener("change", () => {
    settings.difficulty = Number(skill.value);
    saveSettings(settings);
  });
  truck.addEventListener("change", () => {
    currentDriver(profiles).lastTruck = truck.value;
    saveProfiles(context);
  });
  show();

  const ui = await frame(container, context, {
    title: "Driver Check-in", backdrop: "DRIVER",
    regions: {
      name: [35, 154, 184, 32], skill: [35, 215, 184, 32], message: [35, 252, 184, 52],
      truck: [354, 154, 242, 32], preview: [354, 199, 242, 184],
    },
  });
  if (ui.classic) {
    ui.regions.name.append(name, names);
    ui.regions.skill.append(skill);
    ui.regions.message.append(message);
    ui.regions.truck.append(truck);
  } else {
    ui.regions.name.append(
      el("label", {}, "Player name ", name, names), message,
      el("label", {}, "Skill level ", skill),
      el("label", {}, "Select truck ", truck),
      el("div", { class: "truck-preview-placeholder" }, "Spinning truck preview and mini-garage will be added later."),
      el("div", { class: "screen-actions" }, el("button", {
        class: "primary", "data-menu-sound": "STARTOFF", onclick: () => context.router.go("race-select"),
      }, "Races")),
    );
  }
  return { unmount: ui.unmount };
}
