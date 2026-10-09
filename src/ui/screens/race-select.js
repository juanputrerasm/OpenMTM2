/* One all-types track table, track preview, exact CPU field and allowed weather selection. */
import { el } from "../dom.js";
import { currentDriver, getProfiles } from "../../app/profile-store.js";
import { saveSettings } from "../../app/settings.js";
import { setRaceConfig } from "../../app/flow.js";
import { raceLengthLabel, raceTypeName, trackPreviewName } from "../../game/menu-data.js";
import { WEATHER_NAMES, allowedWeathers, resolveWeather } from "../../game/weather.js";
import { playMenuSound } from "../../audio/menu-sounds.js";
import { frame, uiImageUrl } from "../frame.js";

const SUPPORTED = new Set(["circuit", "rally", "summit"]);

export default async function mount(container, context) {
  const { settings } = context;
  const catalog = await context.assets.call("catalog");
  const tracks = catalog.tracks.filter((item) => settings.showHiddenTracks || !item.hidden);
  const trucks = catalog.trucks.filter((item) => !item.hidden);
  const driver = currentDriver(await getProfiles(context));
  let track = tracks.find((item) => item.file === settings.lastTrack) ?? tracks[0];
  if (!track) {
    container.append(el("section", { class: "screen" }, el("p", { class: "error" }, "The install has no tracks.")));
    return;
  }

  const validOpponentFiles = new Set(trucks.filter((item) => item.file !== driver.lastTruck).map((item) => item.file));
  let selectedOpponents = (Array.isArray(settings.opponentTrucks) ? settings.opponentTrucks : [])
    .filter((file, index, all) => validOpponentFiles.has(file) && all.indexOf(file) === index).slice(0, 7);
  if (!selectedOpponents.length) {
    const count = Number.isInteger(settings.opponents) ? settings.opponents : 3;
    selectedOpponents = trucks.filter((item) => item.file !== driver.lastTruck).slice(0, count).map((item) => item.file);
  }

  const laps = el("input", { type: "number", min: 1, max: 99, value: track.defaultLaps, class: "race-length", "aria-label": "Laps or minutes" });
  const lengthLabel = el("span", { class: "race-length-label" });
  const weather = el("select", { "aria-label": "Weather", class: "race-weather" });
  const tableBody = el("tbody");
  const table = el("table", { class: "race-track-table", role: "listbox", "aria-label": "Tracks" }, tableBody);
  const preview = el("img", { class: "track-preview", alt: "" });
  const opponentsButton = el("button", { class: "opponents-button" }, "Computer Opponents");
  const goButton = el("button", { class: "primary", "data-menu-sound": "STARTOFF" }, "Race");
  let previewRequest = 0;

  const fillWeather = () => {
    const allowed = allowedWeathers(track.weatherMask);
    const chosen = resolveWeather(settings.weather, track.weatherMask);
    weather.replaceChildren(
      ...allowed.map((value) => el("option", {
        value, selected: settings.weather !== "random" && value === chosen,
      }, context.t(WEATHER_NAMES[value]))),
      allowed.length > 1 ? el("option", { value: "random", selected: settings.weather === "random" }, "Random") : null,
    );
  };
  const showPreview = async () => {
    const request = ++previewRequest;
    const url = await uiImageUrl(context.assets, trackPreviewName(track.file));
    if (request !== previewRequest) return;
    preview.hidden = !url;
    if (url) { preview.src = url; preview.alt = `${track.name} preview`; }
  };
  const remember = () => {
    const value = Math.max(1, Math.min(99, Math.trunc(Number(laps.value)) || track.defaultLaps));
    laps.value = String(value);
    const chosen = {
      mode: track.raceType, track: track.file, laps: value, difficulty: settings.difficulty,
      opponents: [...selectedOpponents], weather: weather.value === "random" ? "random" : Number(weather.value),
    };
    Object.assign(settings, {
      lastTrack: track.file, weather: chosen.weather, opponentTrucks: [...selectedOpponents], opponents: selectedOpponents.length,
    });
    saveSettings(settings);
    setRaceConfig(context, chosen);
    goButton.disabled = !SUPPORTED.has(track.raceType);
    return chosen;
  };
  const chooseTrack = (item) => {
    if (item !== track) playMenuSound(context.menuAudio, settings, "TRACK", 0.7);
    track = item;
    laps.value = String(item.defaultLaps);
    lengthLabel.textContent = raceLengthLabel(item.raceType);
    fillWeather();
    show();
    showPreview();
    remember();
  };
  const show = () => tableBody.replaceChildren(...tracks.map((item) => el("tr", {
    class: item === track ? "selected" : null, role: "option", "aria-selected": item === track,
    onclick: () => chooseTrack(item), ondblclick: () => { chooseTrack(item); if (SUPPORTED.has(item.raceType)) context.router.go("garage"); },
  }, el("td", {}, item.name), el("td", {}, context.t(raceTypeName(item.raceType))))));

  opponentsButton.addEventListener("click", async () => {
    selectedOpponents = await chooseOpponents(trucks, driver.lastTruck, selectedOpponents);
    remember();
  });
  laps.addEventListener("change", remember);
  weather.addEventListener("change", remember);
  goButton.addEventListener("click", () => { remember(); context.router.go("garage"); });
  fillWeather();
  lengthLabel.textContent = raceLengthLabel(track.raceType);
  show();
  await showPreview();
  remember();

  const ui = await frame(container, context, {
    title: "Races", backdrop: "RACES",
    regions: {
      list: [42, 141, 274, 189], lengthLabel: [48, 350, 58, 24], length: [106, 350, 38, 24],
      opponents: [343, 81, 132, 38], preview: [342, 124, 258, 210], weather: [488, 349, 109, 27],
    },
  });
  if (ui.classic) {
    opponentsButton.textContent = "";
    opponentsButton.title = "Computer Opponents";
    ui.regions.list.append(table);
    ui.regions.lengthLabel.append(lengthLabel);
    ui.regions.length.append(laps);
    ui.regions.opponents.append(opponentsButton);
    ui.regions.preview.append(preview);
    ui.regions.weather.append(weather);
  } else {
    ui.regions.list.append(table,
      el("div", { class: "form-row" },
        el("label", {}, lengthLabel, " ", laps), el("label", {}, "Weather ", weather), opponentsButton),
      el("div", { class: "track-preview-modern" }, preview),
      el("div", { class: "screen-actions" }, goButton));
  }
  return { unmount: ui.unmount };
}

async function chooseOpponents(trucks, playerTruck, initial) {
  return new Promise((resolve) => {
    let selected = [...initial];
    const availableList = el("select", { multiple: true, size: 10, "aria-label": "Available trucks" });
    const selectedList = el("select", { multiple: true, size: 10, "aria-label": "Selected opponents" });
    const draw = () => {
      const picked = new Set(selected);
      availableList.replaceChildren(...trucks.filter((item) => item.file !== playerTruck && !picked.has(item.file))
        .map((item) => el("option", { value: item.file }, item.name)));
      selectedList.replaceChildren(...selected.map((file) => {
        const item = trucks.find((truck) => truck.file === file);
        return el("option", { value: file }, item?.name ?? file);
      }));
    };
    const add = () => {
      for (const option of availableList.selectedOptions) {
        if (selected.length < 7 && !selected.includes(option.value)) selected.push(option.value);
      }
      draw();
    };
    const remove = () => {
      const removed = new Set([...selectedList.selectedOptions].map((option) => option.value));
      selected = selected.filter((file) => !removed.has(file));
      draw();
    };
    const dialog = el("dialog", { class: "opponents-modal", "aria-label": "Computer Opponents" },
      el("h1", {}, "Computer Opponents"),
      el("div", { class: "opponent-lists" },
        el("label", {}, "Available trucks", availableList),
        el("div", { class: "opponent-moves" }, el("button", { onclick: add }, "Add >"), el("button", { onclick: remove }, "< Remove")),
        el("label", {}, "Selected opponents", selectedList)),
      el("div", { class: "screen-actions" },
        el("button", { onclick: () => { selected = [...initial]; dialog.close(); } }, "Cancel"),
        el("button", { class: "primary", onclick: () => dialog.close() }, "Done")));
    availableList.addEventListener("dblclick", add);
    selectedList.addEventListener("dblclick", remove);
    dialog.addEventListener("close", () => { dialog.remove(); resolve(selected); }, { once: true });
    document.body.append(dialog);
    draw();
    dialog.showModal();
  });
}
