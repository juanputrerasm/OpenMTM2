/* Garage tuning only. Truck selection lives on Driver Check-in. */
import { el } from "../dom.js";
import { currentDriver, getProfiles, saveProfiles } from "../../app/profile-store.js";
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

  // Both skins lay the Garage out as the game does: the tire cut and suspension choices as rings on their pictures, the
  // transfer gear as a slider. Without the art the stage names each ring and section instead.
  const dotLabels = (centres, names) => centres.map(([x, y], i) => [names[i], [x + 16, y - 9, 80, 18]]);
  const ui = await frame(container, context, {
    title: context.t("Garage"), backdrop: "GARAGE", current: "garage", regions: { summary: [328, 342, 104, 30] },
    labels: [
      ["Tire Cut", [330, 18, 120, 18]], ...dotLabels(TIRE_CUT_DOTS, ["Shallow", "Medium", "Deep"]),
      ["Suspension", [400, 250, 120, 18]], ...dotLabels(SUSPENSION_DOTS, ["Soft", "Medium", "Hard"]),
      ["Transfer Gear", [44, 326, 280, 16]],
    ],
  });

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
