/*
  One all-types track table, track preview, exact CPU field and allowed weather selection, and the Mode
  list: the track's own race, driving alone (Free Roam), a camera-only visit (Fly-by) or a party game
  (docs/PLAN.md, "Party modes"). Hockey locks the track to Breakneck Ridge and the weather to Snow;
  Tag plays on any track in any weather it allows.
*/
import { startDragWeekend } from "../../app/drag-weekend.js";
import { MAX_FIELD, MIN_FIELD } from "../../game/events/drag-event.js";
import { el } from "../dom.js";
import { currentDriver, getProfiles } from "../../app/profile-store.js";
import { saveSettings } from "../../app/settings.js";
import { setRaceConfig } from "../../app/flow.js";
import { GAME_MODES, raceLengthLabel, raceTypeName, trackPreviewBmp } from "../../game/menu-data.js";
import { WEATHER_NAMES, allowedWeathers, resolveWeather } from "../../game/weather.js";
import { DEFAULT_GOALS, HOCKEY_WEATHER, isHockeyTrack } from "../../game/hockey.js";
import { DEFAULT_TAG_MINUTES } from "../../game/tag.js";
import { playMenuSound } from "../../audio/menu-sounds.js";
import { frame, uiImageUrl } from "../frame.js";

const SUPPORTED = new Set(["circuit", "rally", "summit", "drag", "freeroam"]);

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
  // The party modes: Hockey only where the install has Breakneck Ridge (MTM2's own, not another game's).
  const hockeyTrack = tracks.find((item) => isHockeyTrack(item)) ?? null;
  let gameMode = GAME_MODES.some((m) => m.id === settings.gameMode) && (settings.gameMode !== "hockey" || hockeyTrack) ? settings.gameMode : "default";
  // Free Roam used to be its own box: a save with it ticked opens in the Free Roam mode now.
  if (gameMode === "default" && settings.freeRoam) gameMode = "freeroam";
  const isFlyBy = () => gameMode === "flyby";
  /** The track chosen before Hockey took Breakneck Ridge, to go back to. */
  let trackBeforeHockey = null;
  if (gameMode === "hockey") { trackBeforeHockey = track; track = hockeyTrack; }
  // A track with no checkpoints has no race on it: it is driven in Free Roam.
  if (track.freeRoamOnly && gameMode === "default") gameMode = "freeroam";
  /** The length box's value in a mode: a party game's own (goals or minutes), else the track's laps. */
  const lengthFor = (mode, item) => (mode === "hockey" ? settings.hockeyGoals ?? DEFAULT_GOALS : mode === "tag" ? settings.tagMinutes ?? DEFAULT_TAG_MINUTES : item.defaultLaps);

  const validOpponentFiles = new Set(trucks.filter((item) => item.file !== driver.lastTruck).map((item) => item.file));
  // The player's own list (which may be empty: no opponents), or without one the default number (Options, Game).
  // Spectator mode (the Computer Opponents dialog): the computer's trucks race alone, the player's own among them if
  // picked, a full grid of eight at most.
  let spectator = !!settings.spectator;
  const allFiles = new Set(trucks.map((item) => item.file));
  let selectedOpponents = (Array.isArray(settings.opponentTrucks) ? settings.opponentTrucks : [])
    .filter((file, index, all) => (spectator ? allFiles : validOpponentFiles).has(file) && all.indexOf(file) === index).slice(0, spectator ? 8 : 7);
  if (!Array.isArray(settings.opponentTrucks)) {
    const count = Number.isInteger(settings.defaultOpponents) ? settings.defaultOpponents : 3;
    selectedOpponents = trucks.filter((item) => item.file !== driver.lastTruck && (!item.game || item.game === "MTM")).slice(0, count).map((item) => item.file);
  }

  // A drag strip takes one computer truck, picked at random until the player picks their own (or none: a pass alone).
  // The list for the other tracks is kept apart and comes back with them.
  let dragOpponents = null;
  const onDragStrip = () => track.raceType === "drag";
  const opponentsNow = () => {
    if (!onDragStrip()) return selectedOpponents;
    if (!dragOpponents) {
      const files = [...validOpponentFiles];
      dragOpponents = files.length ? [files[Math.floor(Math.random() * files.length)]] : [];
    }
    return dragOpponents;
  };

  const laps = el("input", { type: "number", min: 1, max: 99, value: lengthFor(gameMode, track), class: "race-length", "aria-label": "Laps or minutes" });
  const modes = GAME_MODES.filter((m) => m.id !== "hockey" || hockeyTrack);
  const modeSelect = el("select", { "aria-label": "Mode", class: "race-mode" },
    ...modes.map((m) => el("option", { value: m.id, selected: m.id === gameMode }, context.t(m.name))));
  const modeLabel = el("span", { class: "race-length-label race-mode-label" }, context.t("Mode"));
  const lengthLabel = el("span", { class: "race-length-label" });
  const weather = el("select", { "aria-label": "Weather", class: "race-weather" });
  const tableBody = el("tbody");
  const table = el("table", { class: "race-track-table", role: "listbox", "aria-label": "Tracks" }, tableBody);
  const preview = el("img", { class: "track-preview", alt: "" });
  const opponentsButton = el("button", { class: "opponents-button" }, "Computer Opponents");
  // Free Roam driving: the mode, or a track with no race on it in the Race mode. No opponents, no laps.
  // Fly-by (ui/screens/fly-by.js): the track with no truck on it and a camera to fly through it.
  const isFreeRoam = () => gameMode === "freeroam" || (gameMode === "default" && !!track.freeRoamOnly);
  const updateDrivingUI = () => {
    opponentsButton.disabled = isFreeRoam() || isFlyBy();
    laps.disabled = isFreeRoam() || isFlyBy() || (gameMode === "default" && onDragStrip());
    // A disabled number box looks the same on the menu art: grey it and its label.
    laps.classList.toggle("race-off", laps.disabled);
    lengthLabel.classList.toggle("race-off", laps.disabled);
  };
  const goButton = el("button", { class: "primary", "data-menu-sound": "STARTOFF" }, "Race");
  // On a drag strip: a drag weekend (ui/screens/drag-event.js), a new one or the one in progress.
  const weekendButton = el("button", { class: "stage-event", "data-menu-sound": "STARTOFF", hidden: true });
  const showWeekend = () => {
    weekendButton.hidden = !onDragStrip() && !context.dragWeekend;
    weekendButton.textContent = context.dragWeekend ? "Resume drag weekend" : "Drag weekend";
  };
  // Tournaments (ui/screens/tournament.js), beside Options: the list, or the one under way.
  const tourneyButton = el("button", { class: "stage-event stage-tourney", "data-menu-sound": "STARTOFF", onclick: () => { remember(); context.router.go("tournament"); } },
    context.tournament ? "Resume tournament" : "Tournament");
  weekendButton.addEventListener("click", async () => {
    if (!context.dragWeekend) {
      const size = await chooseField();
      if (!size) return;
      const chosen = remember();
      startDragWeekend(context, {
        track, trucks, playerTruck: (trucks.find((item) => item.file === driver.lastTruck) ?? trucks[0]).file, playerName: driver.name, size,
        difficulty: chosen.difficulty, weather: chosen.weather,
      });
    }
    context.router.go("drag-event");
  });
  let previewRequest = 0;

  const fillWeather = () => {
    weather.disabled = gameMode === "hockey";
    if (gameMode === "hockey") {
      weather.replaceChildren(el("option", { value: HOCKEY_WEATHER, selected: true }, context.t(WEATHER_NAMES[HOCKEY_WEATHER])));
      return;
    }
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
    // The picture the track's SIT names ("Track Logo .BMP file"), and no other.
    const name = trackPreviewBmp(track);
    const url = name ? await uiImageUrl(context.assets, name) : null;
    if (request !== previewRequest) return;
    preview.hidden = !url;
    if (url) { preview.src = url; preview.alt = `${track.name} preview`; }
  };
  // An MTM1 track's zoom map (MTM1_MONSTER_EXE_ANALYSIS.md 2.10): the button is there when the map the SIT names is.
  const zoomButton = el("button", { class: "race-zoom", hidden: true, title: "The track's map and description" }, context.t("Zoom"));
  let zoomRequest = 0;
  const showZoom = async () => {
    const request = ++zoomRequest, item = track;
    zoomButton.hidden = true;
    if (item.game !== "MTM1" || !item.mapBmp) return;
    const url = await uiImageUrl(context.assets, item.mapBmp);
    if (request === zoomRequest) zoomButton.hidden = !url;
  };
  zoomButton.addEventListener("click", async () => {
    const item = track, url = await uiImageUrl(context.assets, item.mapBmp);
    if (!url) return;
    const text = item.descriptionTxt ? await context.assets.call("trackText", { name: item.descriptionTxt }).catch(() => null) : null;
    openZoomMap(item, url, text);
  });
  /** Whether the chosen track can be played in the chosen mode: everything but a race runs anywhere; else the race types the port runs. */
  const playable = (item) => gameMode !== "default" || SUPPORTED.has(item.raceType);
  /** The Race button reads Fly-by in the Fly-by mode, where it starts a visit and not a race. */
  const updateGoButton = () => {
    goButton.textContent = isFlyBy() ? context.t("Fly-by") : "Race";
    goButton.disabled = !playable(track);
  };
  const remember = () => {
    const value = Math.max(1, Math.min(99, Math.trunc(Number(laps.value)) || lengthFor(gameMode, track)));
    laps.value = String(value);
    const chosen = {
      mode: track.raceType, track: track.file, laps: value, difficulty: settings.difficulty, gameMode,
      opponents: [...opponentsNow()], weather: weather.value === "random" ? "random" : Number(weather.value),
      freeRoam: isFreeRoam(),
      spectator: spectator && !isFreeRoam() && !isFlyBy(),
    };
    Object.assign(settings, {
      gameMode, spectator, opponentTrucks: [...selectedOpponents], opponents: selectedOpponents.length,
    });
    // Hockey's locked track and weather are not the player's choice: the ones chosen before stay remembered.
    if (gameMode !== "hockey") Object.assign(settings, { lastTrack: track.file, weather: chosen.weather });
    // Free Roam used to be a separate box; the mode holds it now.
    delete settings.freeRoam;
    if (gameMode === "hockey") settings.hockeyGoals = value;
    if (gameMode === "tag") settings.tagMinutes = value;
    saveSettings(settings);
    setRaceConfig(context, chosen);
    updateGoButton();
    return chosen;
  };
  /** The Race choice needs checkpoints: on a track with none the list offers Free Roam instead. */
  const updateModeOptions = () => {
    for (const option of modeSelect.options) {
      if (option.value === "default") option.disabled = !!track.freeRoamOnly;
      else if (option.value === "hockey") option.disabled = !hockeyTrack;
      else option.disabled = false;
    }
  };
  const chooseTrack = (item) => {
    // Hockey's track is Breakneck Ridge, whatever is clicked.
    if (gameMode === "hockey" && item !== hockeyTrack) return;
    if (item !== track) playMenuSound(context.menuAudio, settings, "TRACK", 0.7);
    track = item;
    // A track with no race on it is driven in Free Roam: the list follows.
    if (track.freeRoamOnly && gameMode === "default") {
      gameMode = "freeroam";
      modeSelect.value = gameMode;
    }
    updateModeOptions();
    laps.value = String(lengthFor(gameMode, item));
    lengthLabel.textContent = raceLengthLabel(item.raceType, gameMode);
    fillWeather();
    updateDrivingUI();
    showWeekend();
    showSelected();
    show();
    showZoom();
    showPreview();
    remember();
  };
  // The filter above the list: tracks whose name, type or file holds what is typed.
  const filter = el("input", { type: "search", class: "race-track-filter", placeholder: context.t("Filter tracks"), "aria-label": "Filter tracks", value: context.trackFilter ?? "" });
  const typeLabel = (item) => item.typeLabel ?? `${context.t(raceTypeName(item.raceType))}${item.game === "MTM1" ? " (MTM1)" : ""}`;
  const listed = () => {
    const words = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return tracks;
    return tracks.filter((item) => { const text = `${item.name} ${typeLabel(item)} ${item.file}`.toLowerCase(); return words.every((w) => text.includes(w)); });
  };
  // Above the filter: the track that is picked, which the filter or the scrolling may have taken out of sight.
  const selectedLabel = el("div", { class: "race-length-label race-track-selected", "aria-live": "polite" });
  const showSelected = () => {
    selectedLabel.textContent = `${context.t("Selected")}: ${track.name} - ${typeLabel(track)}`;
    selectedLabel.title = selectedLabel.textContent;
  };
  const listHead = el("div", { class: "race-track-head" }, filter);
  filter.addEventListener("input", () => { context.trackFilter = filter.value; show(); });
  // Typing in the box is not driving the menus.
  filter.addEventListener("keydown", (event) => event.stopPropagation());
  const show = () => {
    const locked = gameMode === "hockey";
    filter.disabled = locked;
    table.setAttribute("aria-disabled", String(locked));
    tableBody.replaceChildren(...(locked ? [track] : listed()).map((item) => el("tr", {
      class: item === track ? "selected" : null, role: "option", "aria-selected": item === track,
      onclick: () => chooseTrack(item),
      ondblclick: () => {
        chooseTrack(item);
        if (!playable(item)) return;
        // Fly-by starts its visit from here and skips the Garage.
        if (isFlyBy()) { const chosen = remember(); context.router.go("fly-by", { track, weather: chosen.weather }); }
        else context.router.go("garage");
      },
    }, el("td", {}, item.name), el("td", {}, typeLabel(item)))));
  };

  opponentsButton.addEventListener("click", async () => {
    // A drag strip has two lanes, the other tracks a grid of eight.
    const picked = await chooseOpponents(trucks, driver.lastTruck, opponentsNow(), onDragStrip() ? 2 : 8, spectator, settings);
    if (onDragStrip()) dragOpponents = picked.files; else selectedOpponents = picked.files;
    spectator = picked.spectator;
    remember();
  });
  modeSelect.addEventListener("change", () => {
    let next = modeSelect.value;
    if (next === gameMode) return;
    // Hockey is hidden without Breakneck Ridge, and never selected then.
    if (next === "hockey" && !hockeyTrack) return;
    // Into Hockey the track goes to Breakneck Ridge; out of it, back to the one chosen before.
    if (next === "hockey") { trackBeforeHockey = track; track = hockeyTrack; } else if (gameMode === "hockey") { track = trackBeforeHockey ?? track; trackBeforeHockey = null; }
    // A track with no race on it has no Race mode: the list falls back to Free Roam.
    if (track.freeRoamOnly && next === "default") next = "freeroam";
    gameMode = next;
    modeSelect.value = next;
    updateModeOptions();
    laps.value = String(lengthFor(gameMode, track));
    lengthLabel.textContent = raceLengthLabel(track.raceType, gameMode);
    fillWeather();
    updateDrivingUI();
    show();
    showSelected();
    showPreview();
    remember();
  });
  updateModeOptions();
  updateDrivingUI();
  laps.addEventListener("change", remember);
  weather.addEventListener("change", remember);
  goButton.addEventListener("click", () => {
    const chosen = remember();
    // Fly-by starts its visit from here and skips the Garage.
    if (isFlyBy()) context.router.go("fly-by", { track, weather: chosen.weather });
    else context.router.go("garage");
  });
  fillWeather();
  lengthLabel.textContent = raceLengthLabel(track.raceType, gameMode);
  showWeekend();
  showSelected();
  show();
  showZoom();
  await showPreview();
  remember();

  const ui = await frame(container, context, {
    title: "Races", backdrop: "RACES", current: "races",
    regions: {
      list: [42, 141, 274, 189], lengthLabel: [48, 350, 58, 24], length: [106, 350, 38, 24],
      opponents: [343, 81, 132, 38], preview: [342, 124, 258, 210], weather: [488, 349, 109, 27], weatherLabel: [0, 0, 0, 0],
      // The Mode list sits on the bottom row, right, its label to the left.
      selected: [42, 88, 296, 24], mode: [489, 379, 109, 20], modeLabel: [427, 378, 58, 22],
    },
    // Without the art: the list takes its own column headings, and Weather sits beside Laps under the list, in the same type.
    modernRegions: { opponents: [343, 84, 200, 32], list: [42, 122, 274, 208], weatherLabel: [150, 350, 70, 24], weather: [222, 350, 94, 24], modeLabel: [150, 378, 70, 24], mode: [222, 378, 94, 24] },
  });
  ui.regions.list.parentElement.append(weekendButton, tourneyButton);
  if (ui.classic) {
    if (ui.art) { opponentsButton.textContent = ""; opponentsButton.title = "Computer Opponents"; }
    ui.regions.list.append(listHead, table);
    ui.regions.lengthLabel.append(lengthLabel);
    ui.regions.length.append(laps);
    ui.regions.opponents.append(opponentsButton);
    ui.regions.preview.append(preview, zoomButton);
    ui.regions.selected.append(selectedLabel);
    ui.regions.weather.append(weather);
    ui.regions.modeLabel.append(modeLabel);
    ui.regions.mode.append(modeSelect);
    if (!ui.art) {
      ui.regions.weatherLabel.append(el("span", { class: "race-length-label" }, context.t("Weather")));
      table.prepend(el("thead", {}, el("tr", {}, el("th", {}, context.t("Track Name")), el("th", {}, context.t("Track Type")))));
    }
  } else {
    ui.regions.list.append(selectedLabel, listHead, table,
      el("div", { class: "form-row" },
        el("label", {}, lengthLabel, " ", laps), el("label", {}, "Weather ", weather), el("label", {}, modeLabel, " ", modeSelect), opponentsButton),
      el("div", { class: "track-preview-modern" }, preview, zoomButton),
      el("div", { class: "screen-actions" }, goButton));
  }
  return { unmount: ui.unmount };
}

/**
 * MTM1's zoom map as a dialog: the track's map bitmap filling a 640 x 480 stage with its description over it, in the
 * rectangle the game draws it in (344, 26 to 624, 440), and OK.
 */
function openZoomMap(track, url, text) {
  const dialog = el("dialog", { class: "zoom-map-modal", "aria-label": `${track.name} map` },
    el("div", { class: "zoom-map-stage" },
      el("img", { src: url, alt: `${track.name} map`, draggable: "false" }),
      text ? el("div", { class: "zoom-map-text" }, ...text.split(/\n/).map((line) => el("p", {}, line))) : null,
      el("button", { class: "primary zoom-map-ok", onclick: () => dialog.close() }, "OK")));
  // A click outside the stage closes it, as Escape does.
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

/** The Drag weekend dialog: how many drivers, 2 to 16. Returns the number, or null when cancelled. */
async function chooseField() {
  return new Promise((resolve) => {
    const size = el("select", { "aria-label": "Drivers" }, ...Array.from({ length: MAX_FIELD - MIN_FIELD + 1 }, (_, k) => k + MIN_FIELD).map((n) => el("option", { value: n, selected: n === 8 }, `${n} drivers`)));
    const dialog = el("dialog", { class: "opponents-modal", "aria-label": "Drag weekend" },
      el("h1", {}, "Drag weekend"),
      el("p", {}, "Qualifying, then an elimination bracket on this strip. You qualify alone; the order seeds the bracket, and a field short of 2, 4, 8 or 16 gives the best seeds a bye."),
      el("div", { class: "form-row" }, el("label", {}, "Field ", size)),
      el("div", { class: "screen-actions" },
        el("button", { onclick: () => dialog.close() }, "Cancel"),
        el("button", { class: "primary", onclick: () => dialog.close("start") }, "Start")));
    dialog.addEventListener("close", () => { dialog.remove(); resolve(dialog.returnValue === "start" ? Number(size.value) : null); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * The Computer Opponents dialog. `full` is the grid (eight; a drag strip's two lanes): the player drives against up to
 * `full - 1` trucks, or with Spectator mode ticked watches up to `full` of them, their own truck among them if picked.
 * Filling the grid ticks Spectator mode by itself. The default number of opponents (Options, Game) is set here too, and
 * Fill tops the list up to it with trucks at random. Returns `{ files, spectator }`.
 */
async function chooseOpponents(trucks, playerTruck, initial, full = 8, watching = false, settings = {}) {
  return new Promise((resolve) => {
    let selected = [...initial], spectator = !!watching;
    const before = { selected: [...initial], spectator };
    const spectatorBox = el("input", { type: "checkbox", checked: spectator });
    const note = el("p", { class: "muted" });
    const limit = () => (spectator ? full : full - 1);
    const availableList = el("select", { multiple: true, size: 10, "aria-label": "Available trucks" });
    const selectedList = el("select", { multiple: true, size: 10, "aria-label": "Selected opponents" });
    const availableHead = el("span", {}), selectedHead = el("span", {});
    const draw = () => {
      const picked = new Set(selected);
      spectatorBox.checked = spectator;
      note.textContent = spectator
        ? `Spectator mode: these ${selected.length === 1 ? "truck races" : "trucks race"} and you watch. Up to ${full}.`
        : `You race against up to ${full - 1}. Pick ${full} to watch them race instead.`;
      availableList.replaceChildren(...trucks.filter((item) => (spectator || item.file !== playerTruck) && !picked.has(item.file))
        .map((item) => el("option", { value: item.file }, item.name)));
      selectedList.replaceChildren(...selected.map((file) => {
        const item = trucks.find((truck) => truck.file === file);
        return el("option", { value: file }, item?.name ?? file);
      }));
      availableHead.textContent = `Available trucks: ${availableList.options.length}`;
      selectedHead.textContent = `Selected opponents: ${selected.length}`;
    };
    const add = () => {
      for (const option of availableList.selectedOptions) {
        // The truck that fills the grid leaves no place for the player: the race is one to watch.
        if (!spectator && selected.length === full - 1 && !selected.includes(option.value)) spectator = true;
        if (selected.length < limit() && !selected.includes(option.value)) selected.push(option.value);
      }
      draw();
    };
    const remove = () => {
      const removed = new Set([...selectedList.selectedOptions].map((option) => option.value));
      selected = selected.filter((file) => !removed.has(file));
      draw();
    };
    // The default number of computer opponents, as on the Options' Game page.
    const defaultCount = el("select", { "aria-label": "Default computer opponents", onchange: () => {
      settings.defaultOpponents = Number(defaultCount.value);
      saveSettings(settings);
    } }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => el("option", { value: n, selected: n === (settings.defaultOpponents ?? 3) }, String(n))));
    // Fill: random trucks added, the ones picked kept, until the list holds the default number (as many as the grid allows).
    const fill = () => {
      const want = Math.min(limit(), Number(defaultCount.value));
      const pool = trucks.filter((item) => (spectator || item.file !== playerTruck) && !selected.includes(item.file)).map((item) => item.file);
      while (selected.length < want && pool.length) selected.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      draw();
    };
    const dialog = el("dialog", { class: "opponents-modal", "aria-label": "Computer Opponents" },
      el("h1", {}, "Computer Opponents"),
      el("div", { class: "opponent-lists" },
        el("label", {}, availableHead, availableList),
        el("div", { class: "opponent-moves" },
          el("div", { class: "opponent-moves-group" }, el("button", { onclick: add }, "Add >"), el("button", { onclick: remove }, "< Remove"),
            el("button", { onclick: () => { selected = []; draw(); } }, "Remove all")),
          el("button", {
            class: "opponent-fill", onclick: fill,
            title: "Add trucks at random, keeping the ones already picked, until the list holds the default number of computer opponents",
          }, "Fill")),
        el("label", {}, selectedHead, selectedList)),
      el("label", { class: "form-row" }, "Default computer opponents ", defaultCount),
      el("label", { class: "form-row opponent-spectator" }, spectatorBox, " Spectator mode"),
      note,
      el("div", { class: "screen-actions" },
        el("button", { onclick: () => { selected = before.selected; spectator = before.spectator; dialog.close(); } }, "Cancel"),
        el("button", { class: "primary", onclick: () => dialog.close() }, "Done")));
    availableList.addEventListener("dblclick", add);
    selectedList.addEventListener("dblclick", remove);
    spectatorBox.addEventListener("change", () => {
      spectator = spectatorBox.checked;
      // Driving again: the player's own truck and the grid's last place are the player's.
      if (!spectator) selected = selected.filter((file) => file !== playerTruck).slice(0, full - 1);
      draw();
    });
    dialog.addEventListener("close", () => { dialog.remove(); resolve({ files: selected, spectator }); }, { once: true });
    document.body.append(dialog);
    draw();
    dialog.showModal();
  });
}
