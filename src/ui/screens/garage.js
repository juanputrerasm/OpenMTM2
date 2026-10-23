/*
  Garage tuning only. Truck selection lives on Driver Check-in.

  Every truck has MTM2's settings (MONSTER_EXE_ANALYSIS.md 8.5). A 4x4 Evolution vehicle also has the Evo garage's
  (EVO2_PHYSICS.md 2.2), used when the race runs on a 4x4 Evolution physics model; a CART Precision Racing car lists
  the setup CPR's garage holds (CPR_PHYSICS.md, "Garage setup"), which waits for CPR's own model.
*/
import { el } from "../dom.js";
import { currentDriver, getProfiles, saveProfiles } from "../../app/profile-store.js";
import { playMenuSound } from "../../audio/menu-sounds.js";
import { EVO_GARAGE_SLIDERS, EVO_TREADS, garageSummary } from "../../game/menu-data.js";
import { CPR_COMPOUNDS, CPR_DIFFERENTIALS, CPR_GARAGE_SLIDERS, cprSetupFromGar, cprSetupToGar, stockCprSetup } from "../../game/cpr-garage.js";
import { DEFAULT_EVO_GARAGE, cleanEvoGarage } from "../../game/profile.js";
import { frame } from "../frame.js";
import { msg } from "../../game/strings.js";

const TIRE_CUT_DOTS = [[459, 45], [428, 96], [408, 160]];
/** An Evo vehicle's fourth tire cut, Studded, beside Deep. */
const STUDDED_DOT = [500, 160];
const SUSPENSION_DOTS = [[447, 277], [490, 320], [546, 345]];
const SLIDER_RECT = [44, 346, 280, 22];
/** The free part of the stage, left of the tire and suspension pictures, for the other games' settings. */
const EXTRA_RECT = [20, 58, 372, 258];

/** The game a vehicle comes from, by its `<GAME>:<file>` name: "EVO1", "EVO2", "CPR", or null for an MTM truck. */
const vehicleGame = (file) => /^(EVO1|EVO2|CPR):/i.exec(String(file ?? ""))?.[1]?.toUpperCase() ?? null;

const TRANSFER_ENDS = 600 + 2000;
const TIRE_CUTS = [msg("Shallow"), msg("Medium"), msg("Deep")];
const SUSPENSIONS = [msg("Soft"), msg("Medium"), msg("Hard")];

export default async function mount(container, context) {
  const { t } = context;
  const driver = currentDriver(await getProfiles(context));
  const setup = { ...driver.garage, evo: cleanEvoGarage(driver.garage?.evo) };
  const game = vehicleGame(driver.lastTruck);
  const save = () => { driver.garage = { ...setup }; saveProfiles(context); };
  const transfer = el("input", {
    // The slider runs the other way from the setting: its two ends add up to TRANSFER_ENDS.
    type: "range", min: 600, max: 2000, step: 100, value: TRANSFER_ENDS - setup.transferSetting, "aria-label": t("Transfer gear"),
  });
  const summary = el("span", { class: "garage-summary" });
  const refreshSummary = () => { summary.textContent = garageSummary(setup); };
  transfer.addEventListener("input", () => {
    const next = TRANSFER_ENDS - Number(transfer.value);
    if (next !== setup.transferSetting) {
      playMenuSound(context.menuAudio, context.settings, next < setup.transferSetting ? "SLIDERUP" : "SLIDERDN", 0.65);
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
  const evoVehicle = game === "EVO1" || game === "EVO2";
  const ui = await frame(container, context, {
    title: msg("Garage"), backdrop: "GARAGE", current: "garage",
    regions: { summary: [328, 342, 104, 30], ...(game ? { extra: EXTRA_RECT } : {}) },
    labels: [
      [msg("Tire Cut"), [330, 18, 120, 18]], ...dotLabels(evoVehicle ? [...TIRE_CUT_DOTS, STUDDED_DOT] : TIRE_CUT_DOTS, evoVehicle ? EVO_TREADS : TIRE_CUTS),
      [msg("Suspension"), [400, 230, 120, 18]], ...dotLabels(SUSPENSION_DOTS, SUSPENSIONS),
      [msg("Transfer Gear"), [44, 326, 280, 16]],
    ],
  });

  const stage = ui.regions.summary.parentElement;
  ui.regions.summary.append(summary);
  const rings = [];
  const dots = (centres, key, heading, names) => centres.forEach(([x, y], index) => {
    const ring = el("button", {
      class: "garage-dot", title: `${t(heading)}: ${t(names[index])}`, "aria-label": `${t(heading)}: ${t(names[index])}`,
      style: `left:${x - 13}px;top:${y - 13}px`,
      onclick: () => { choose(key, index); refreshSummary(); save(); },
    });
    rings.push({ ring, key, index });
    stage.append(ring);
  });
  // An Evo vehicle's tire cut is its tread (Shallow, Medium, Deep or Studded), one choice for both the rings and the panel.
  const treadOf = () => setup.evo.tread;
  const setTread = (index) => { setup.evo.tread = index; if (index <= 2) setup.tireCut = index; };
  const choose = (key, index) => {
    if (key === "tireCut" && evoVehicle) setTread(index); else setup[key] = index;
    refresh();
  };
  if (evoVehicle) dots([...TIRE_CUT_DOTS, STUDDED_DOT], "tireCut", "Tire Cut", EVO_TREADS);
  else dots(TIRE_CUT_DOTS, "tireCut", "Tire Cut", TIRE_CUTS);
  dots(SUSPENSION_DOTS, "suspension", "Suspension", SUSPENSIONS);
  let evoRefresh = () => {};
  const refresh = () => {
    rings.forEach(({ ring, key, index }) => ring.classList.toggle("on", (key === "tireCut" && evoVehicle ? treadOf() : setup[key]) === index));
    evoRefresh();
  };
  refresh();
  const [x, y, width, height] = SLIDER_RECT;
  transfer.className = "garage-slider";
  Object.assign(transfer.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  stage.append(transfer);
  if (evoVehicle) {
    const panel = evoPanel(context, setup, save, (index) => { setTread(index); refresh(); });
    evoRefresh = panel.refresh;
    ui.regions.extra.append(panel.element);
  }
  else if (game === "CPR") ui.regions.extra.append(cprPanel(context, setup, save));
  return { unmount: ui.unmount };
}

/** The 4x4 Evolution garage: the tire cut and the game's five sliders, each with its reading. */
function evoPanel(context, setup, save, setTread) {
  const { t } = context;
  const evo = setup.evo;
  // "Auto (by vehicle)" puts an Evo vehicle on its own game's model; the other choices may not.
  const physics = context.settings.physics;
  const note = el("p", { class: "garage-extra-note" }, t("Used when the race runs on a 4x4 Evolution physics model (Options, Physics)."));
  note.hidden = physics === "auto" || physics === "evo1" || physics === "evo2";
  const treads = el("div", { class: "garage-treads", role: "radiogroup", "aria-label": t("Tire Type") });
  const showTreads = () => [...treads.children].forEach((b, i) => b.classList.toggle("on", evo.tread === i));
  EVO_TREADS.forEach((name, i) => treads.append(el("button", {
    type: "button", role: "radio", onclick: () => { setTread(i); save(); },
  }, t(name))));
  showTreads();
  const rows = EVO_GARAGE_SLIDERS.map((slider) => {
    const reading = el("span", { class: "garage-reading" });
    const input = el("input", { type: "range", min: 0, max: 100, step: 5, "aria-label": t(slider.label) });
    const show = () => {
      reading.textContent = slider.show(evo[slider.key], t);
      input.value = String(Math.round((evo[slider.key] ?? 0.5) * 100));
      input.classList.toggle("stock", evo[slider.key] === null);
    };
    input.addEventListener("input", () => {
      const before = evo[slider.key] ?? 0.5, next = Number(input.value) / 100;
      if (next !== before) playMenuSound(context.menuAudio, context.settings, next < before ? "SLIDERDN" : "SLIDERUP", 0.65);
      evo[slider.key] = next;
      show();
      save();
    });
    const stockButton = slider.stock ? el("button", {
      type: "button", class: "garage-stock", title: t("The vehicle's own setting"),
      onclick: () => { evo[slider.key] = null; show(); save(); },
    }, t("Stock")) : null;
    show();
    return { show, row: el("div", { class: "garage-setting", title: t(slider.help) },
      el("div", { class: "garage-row" }, el("span", { class: "garage-row-label" }, t(slider.label)), reading, stockButton ?? ""),
      el("div", { class: "garage-track" }, el("span", { class: "garage-end" }, t(slider.ends[0])), input, el("span", { class: "garage-end" }, t(slider.ends[1])))) };
  });
  const reset = el("button", {
    type: "button", onclick: () => { Object.assign(evo, DEFAULT_EVO_GARAGE); setTread(evo.tread); rows.forEach((r) => r.show()); save(); },
  }, t("Default Settings"));
  const element = el("div", { class: "garage-extra" },
    el("h3", {}, t("4x4 Evolution settings")),
    el("div", { class: "garage-row" }, el("span", { class: "garage-row-label" }, t("Tire Type")), treads),
    ...rows.map((r) => r.row),
    el("div", { class: "garage-extra-foot" }, reset, note));
  return { element, refresh: showTreads };
}

/**
 * A CART Precision Racing car: the parts of the game's setup the CPR model uses (game/cpr-garage.js), as sliders and
 * choices, and the game's own `.gar` files to load and save.
 */
function cprPanel(context, setup, save) {
  const { t } = context;
  // Untouched, the car runs the stock setup (null); the first change makes it the player's.
  const current = () => setup.cpr ?? stockCprSetup();
  const change = (apply) => { const next = current(); apply(next); setup.cpr = next; save(); };
  const physics = context.settings.physics;
  const note = el("p", { class: "garage-extra-note" }, t("Used when the race runs on the CART Precision Racing physics model (Options, Physics)."));
  note.hidden = physics === "auto" || physics === "track" || physics === "cpr";
  const refreshers = [];
  const rows = [];
  let group = null;
  for (const slider of CPR_GARAGE_SLIDERS) {
    if (slider.group !== group) { group = slider.group; rows.push(el("div", { class: "garage-group" }, t(group))); }
    const reading = el("span", { class: "garage-reading" });
    const input = el("input", { type: "range", min: slider.min, max: slider.max, step: slider.step, "aria-label": t(slider.label) });
    const show = () => { const v = slider.get(current()); input.value = String(v); reading.textContent = slider.show(v); };
    input.addEventListener("input", () => { change((s) => slider.set(s, Number(input.value))); show(); });
    refreshers.push(show);
    show();
    rows.push(el("div", { class: "garage-row garage-cpr-row" }, el("span", { class: "garage-row-label" }, t(slider.label)), input, reading));
  }
  const choice = (label, options, get, set) => {
    const select = el("select", { "aria-label": t(label), onchange: (e) => change((s) => set(s, Number(e.target.value))) },
      ...options.map((o) => el("option", { value: o.value }, t(o.label))));
    const show = () => { select.value = String(get(current())); };
    refreshers.push(show);
    show();
    return el("div", { class: "garage-row garage-cpr-row" }, el("span", { class: "garage-row-label" }, t(label)), select);
  };
  rows.push(choice(msg("Differential"), CPR_DIFFERENTIALS, (s) => s.differentialType, (s, v) => { s.differentialType = v; }));
  rows.push(choice(msg("Tires"), CPR_COMPOUNDS, (s) => s.tireCompound[0], (s, v) => { s.tireCompound = [v, v, v, v]; }));
  const refresh = () => refreshers.forEach((f) => f());
  // The game's setups: a .gar file in, or the car's setup out as one.
  const picker = el("input", { type: "file", accept: ".gar,text/plain", hidden: true });
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    const loaded = cprSetupFromGar(await file.text());
    if (!loaded) return;
    setup.cpr = loaded;
    save();
    refresh();
  });
  const saveFile = () => {
    const link = el("a", { href: URL.createObjectURL(new Blob([cprSetupToGar(current())], { type: "text/plain" })), download: "openmtm2.gar" });
    document.body.append(link); link.click(); link.remove();
  };
  const foot = el("div", { class: "garage-extra-foot" },
    el("button", { type: "button", onclick: () => picker.click() }, t("Load Settings")),
    el("button", { type: "button", onclick: saveFile }, t("Save Settings")),
    el("button", { type: "button", onclick: () => { setup.cpr = null; save(); refresh(); } }, t("Default Settings")),
    picker);
  return el("div", { class: "garage-extra garage-cpr" }, el("h3", {}, t("CART Precision Racing setup")), ...rows, foot, note);
}
