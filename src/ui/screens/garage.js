/*
  Garage: the driver's truck and setup (MONSTER_EXE_ANALYSIS.md 8.5). Both are saved to the
  driver as they change, so the classic skin's GO button can start the race from any screen.

  Classic skin: the radio dots baked into GARAGE.BMP (tire cut and suspension) and its Transfer
  Gear slider are the controls themselves; a ring marks the choice.
*/
import { el } from "../dom.js";
import { currentDriver, getProfiles, saveProfiles } from "../../app/profile-store.js";
import { goRace } from "../../app/flow.js";
import { frame } from "../frame.js";

/** The baked radio dots on GARAGE.BMP, centre [x, y], in the order of the choices. */
const TIRE_CUT_DOTS = [[459, 45], [428, 96], [408, 160]];
const SUSPENSION_DOTS = [[447, 277], [490, 320], [546, 345]];
const SLIDER_RECT = [44, 346, 280, 22];

export default async function mount(container, context) {
  const { settings } = context;
  const driver = currentDriver(await getProfiles(context));
  const catalog = await context.assets.call("catalog");
  const trucks = catalog.trucks.filter((t) => settings.showHiddenTrucks || !t.hidden);
  let truck = trucks.find((t) => t.file === driver.lastTruck) ?? trucks[0];
  const setup = { ...driver.garage };
  const save = () => {
    if (truck) driver.lastTruck = truck.file;
    driver.garage = { ...setup };
    saveProfiles(context);
  };
  save();

  const list = el("ul", { class: "pick-list", role: "listbox" });
  const showTrucks = () => list.replaceChildren(...trucks.map((t) => el("li", {},
    el("button", {
      class: t === truck ? "pick selected" : "pick", role: "option", "aria-selected": t === truck,
      onclick: () => { truck = t; showTrucks(); save(); },
    }, t.name))));
  showTrucks();

  const transferSetting = el("input", { type: "range", min: 600, max: 2000, step: 100, value: setup.transferSetting, "aria-label": "Transfer gear" });
  const transferValue = el("span", {}, String(setup.transferSetting));
  transferSetting.addEventListener("input", () => {
    setup.transferSetting = Number(transferSetting.value);
    transferValue.textContent = transferSetting.value;
    save();
  });

  const ui = await frame(container, context, {
    title: context.t("Garage"), backdrop: "GARAGE",
    regions: { trucks: [16, 108, 250, 196], setup: [16, 108, 250, 196] },
  });
  const intro = el("p", { class: "muted" }, `${driver.name}'s truck`);
  const race = el("button", { class: "primary", onclick: () => goRace(context), disabled: !truck }, "Race");
  if (!ui.classic) {
    const choice = (label, key, names) => el("label", {}, `${label} `,
      el("select", { "aria-label": label, onchange: (e) => { setup[key] = Number(e.target.value); save(); } },
        ...names.map((name, i) => el("option", { value: i, selected: i === setup[key] }, name))));
    ui.regions.trucks.append(intro, trucks.length ? list : el("p", { class: "error" }, "The install has no trucks."),
      el("div", { class: "form-row" },
        choice("Suspension", "suspension", ["Soft", "Medium", "Hard"]),
        choice("Tire cut", "tireCut", ["Shallow", "Medium", "Deep"]),
        el("label", {}, "Transfer gear ", transferSetting, " ", transferValue)),
      el("div", { class: "screen-actions" }, el("button", { onclick: () => context.router.back() }, "Back"), race));
    return {};
  }

  // Classic: the truck list in a panel, the setup on the art itself.
  ui.regions.setup.remove();
  ui.regions.trucks.append(intro, trucks.length ? list : el("p", { class: "error" }, "The install has no trucks."));
  const stage = ui.regions.trucks.parentElement;
  const rings = [];
  const dots = (centres, key, label) => centres.map(([x, y], i) => {
    const ring = el("button", {
      class: "garage-dot", title: `${label}: ${["first", "second", "third"][i]}`, "aria-label": label,
      style: `left:${x - 13}px;top:${y - 13}px`,
      onclick: () => { setup[key] = i; refresh(); save(); },
    });
    rings.push({ ring, key, i });
    stage.append(ring);
    return ring;
  });
  dots(TIRE_CUT_DOTS, "tireCut", "Tire cut");
  dots(SUSPENSION_DOTS, "suspension", "Suspension");
  const refresh = () => rings.forEach(({ ring, key, i }) => ring.classList.toggle("on", setup[key] === i));
  refresh();
  const [sx, sy, sw, sh] = SLIDER_RECT;
  transferSetting.className = "garage-slider";
  Object.assign(transferSetting.style, { left: `${sx}px`, top: `${sy}px`, width: `${sw}px`, height: `${sh}px` });
  stage.append(transferSetting);
  return { unmount: ui.unmount };
}
