/* Driver Check-in: editable profile name, skill and truck selection. */
import { el } from "../dom.js";
import { currentDriver, getProfiles, saveProfiles } from "../../app/profile-store.js";
import { saveSettings } from "../../app/settings.js";
import { MAX_NAME_LENGTH, selectOrAddDriver } from "../../game/profile.js";
import { frame } from "../frame.js";
import { createTruckPreview } from "../../render/truck-preview.js";

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
  // "Sonic trucks", offered on Professional: the computer trucks drive as on a Sonic track (MONSTER_EXE_ANALYSIS.md 6.5).
  const sonic = el("label", { class: "sonic-trucks" }, el("input", {
    type: "checkbox", checked: !!settings.sonicTrucks,
    onchange: (event) => { settings.sonicTrucks = event.target.checked; saveSettings(settings); },
  }), " Sonic trucks");
  const showSonic = () => { sonic.hidden = Number(settings.difficulty) !== 2; };
  showSonic();
  skill.addEventListener("change", () => {
    settings.difficulty = Number(skill.value);
    saveSettings(settings);
    showSonic();
  });
  // The truck turning in the mini garage (render/truck-preview.js).
  const look = context.settings.look === "enhanced" ? "enhanced" : "classic";
  let preview = null, previewRequest = 0;
  try { preview = createTruckPreview({ width: 484, height: 368, look }); } catch { /* no WebGL: no preview */ }
  const builds = new Map();
  const showPreview = async () => {
    if (!preview || !truck.value) return;
    const mine = ++previewRequest;
    try {
      if (!builds.has(truck.value)) builds.set(truck.value, context.assets.call("truckPreview", { file: truck.value }));
      const build = await builds.get(truck.value);
      if (mine === previewRequest) preview.show(build);
    } catch { builds.delete(truck.value); }
  };
  truck.addEventListener("change", () => {
    currentDriver(profiles).lastTruck = truck.value;
    saveProfiles(context);
    showPreview();
  });
  show();
  showPreview();

  const ui = await frame(container, context, {
    title: "Driver Check-in", backdrop: "DRIVER", current: "drivers",
    labels: [["Player Name", [35, 134, 184, 18]], ["Skill Level", [35, 195, 184, 18]], ["Select Truck", [354, 134, 242, 18]]],
    regions: {
      name: [35, 154, 184, 32], skill: [35, 215, 184, 32], sonic: [35, 252, 184, 24], message: [35, 280, 184, 52],
      truck: [354, 154, 242, 32], preview: [354, 199, 242, 184],
    },
  });
  if (ui.classic) {
    ui.regions.name.append(name, names);
    ui.regions.skill.append(skill);
    ui.regions.sonic.append(sonic);
    ui.regions.message.append(message);
    ui.regions.truck.append(truck);
    if (preview) ui.regions.preview.append(preview.canvas);
  } else {
    ui.regions.name.append(
      el("label", {}, "Player name ", name, names), message,
      el("label", {}, "Skill level ", skill),
      el("label", {}, "Select truck ", truck),
      preview ? el("div", { class: "truck-preview" }, preview.canvas) : el("div", { class: "truck-preview-placeholder" }, "The truck preview needs WebGL."),
      el("div", { class: "screen-actions" }, el("button", {
        class: "primary", "data-menu-sound": "STARTOFF", onclick: () => context.router.go("race-select"),
      }, "Races")),
    );
  }
  return { unmount() { previewRequest++; preview?.dispose(); ui.unmount?.(); } };
}
