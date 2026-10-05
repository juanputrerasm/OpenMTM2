/* Garage tuning only. Truck selection lives on Driver Check-in. */
import { el } from "../dom.js";
import { currentDriver, getProfiles, saveProfiles } from "../../app/profile-store.js";
import { goRace } from "../../app/flow.js";
import { playMenuSound } from "../../audio/menu-sounds.js";
import { garageSummary } from "../../game/menu-data.js";
import { frame } from "../frame.js";

const TIRE_CUT_DOTS = [[459, 45], [428, 96], [408, 160]];
const SUSPENSION_DOTS = [[447, 277], [490, 320], [546, 345]];
const SLIDER_RECT = [44, 346, 280, 22];

export default async function mount(container, context) {
  const driver = currentDriver(await getProfiles(context));
  const setup = { ...driver.garage };
  const save = () => { driver.garage = { ...setup }; saveProfiles(context); };
  const transfer = el("input", {
    type: "range", min: 600, max: 2000, step: 100, value: setup.transferSetting, "aria-label": "Transfer gear",
  });
  const summary = el("span", { class: "garage-summary" });
  const refreshSummary = () => { summary.textContent = garageSummary(setup); };
  transfer.addEventListener("input", () => {
    const next = Number(transfer.value);
    if (next !== setup.transferSetting) {
      playMenuSound(context.menuAudio, context.settings, next > setup.transferSetting ? "SLIDERUP" : "SLIDERDN", 0.65);
    }
    setup.transferSetting = next;
    refreshSummary();
    save();
  });
  refreshSummary();
  save();

  const ui = await frame(container, context, {
    title: context.t("Garage"), backdrop: "GARAGE", regions: { summary: [328, 342, 104, 30] },
  });
  if (!ui.classic) {
    const choice = (label, key, names) => el("label", {}, `${label} `,
      el("select", { "aria-label": label, onchange: (event) => {
        setup[key] = Number(event.target.value); refreshSummary(); save();
      } }, ...names.map((name, index) => el("option", { value: index, selected: index === setup[key] }, name))));
    ui.regions.summary.append(
      el("div", { class: "form-row" },
        choice("Suspension", "suspension", ["Soft", "Medium", "Hard"]),
        choice("Tire cut", "tireCut", ["Shallow", "Medium", "Deep"]),
        el("label", {}, "Transfer gear ", transfer, " ", summary)),
      el("div", { class: "screen-actions" },
        el("button", { "data-menu-sound": "STARTOFF", onclick: () => context.router.back() }, "Back"),
        el("button", { class: "primary", "data-menu-sound": "GOOFF", onclick: () => goRace(context) }, "Race")));
    return { unmount: ui.unmount };
  }

  const stage = ui.regions.summary.parentElement;
  ui.regions.summary.append(summary);
  const rings = [];
  const dots = (centres, key, names) => centres.forEach(([x, y], index) => {
    const ring = el("button", {
      class: "garage-dot", title: `${names[index]} ${key}`, "aria-label": `${key}: ${names[index]}`,
      style: `left:${x - 13}px;top:${y - 13}px`,
      onclick: () => { setup[key] = index; refresh(); refreshSummary(); save(); },
    });
    rings.push({ ring, key, index });
    stage.append(ring);
  });
  dots(TIRE_CUT_DOTS, "tireCut", ["Shallow", "Medium", "Deep"]);
  dots(SUSPENSION_DOTS, "suspension", ["Soft", "Medium", "Hard"]);
  const refresh = () => rings.forEach(({ ring, key, index }) => ring.classList.toggle("on", setup[key] === index));
  refresh();
  const [x, y, width, height] = SLIDER_RECT;
  transfer.className = "garage-slider";
  Object.assign(transfer.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  stage.append(transfer);
  return { unmount: ui.unmount };
}
