/* Shared contents of the Options screen and the Options modal opened from every menu screen. */
import { DUST_LEVEL_NAMES, SPARK_LEVEL_NAMES, dustLevel, sparkLevel } from "../game/tire-effects.js";
import { FLY_SCHEMES, FLY_SCHEME_NAMES } from "../game/fly-camera.js";
import { buildKind, defaultSkin } from "../install/exe-version.js";
import { el } from "./dom.js";
import { PHYSICS_MODELS, applyMtm1Classic, applyMtm2Classic, applyOpenMtm2, clearSettings, optionsFile, physicsModel, readOptionsFile, saveSettings } from "../app/settings.js";
import { offlineStatusText } from "../app/offline.js";
import { loadStrings } from "../app/strings-store.js";
import { locName } from "../game/strings.js";
import { ACTIONS, DEFAULT_BINDINGS, codeLabel, conflictFor, mergeBindings } from "../game/input/bindings.js";
import { CAB_STYLES, VIEW_DISTANCES, VR_VIEWS, vrSettings } from "../game/vr/settings.js";
import { VOICE_COMMENTARY_ENABLED } from "../audio/commentary-audio.js";
import { AA_HINT, AA_MODES, aaChoice } from "../game/aa.js";
import { GRAPHICS_HINT, GRAPHICS_NOTES, GRAPHICS_PRESETS, applyGraphics, detectGraphics, graphicsChoice, graphicsLabel } from "../game/graphics.js";
import { graphicsHardware } from "../app/graphics-hardware.js";
import { VISUAL_OPTIONS } from "../game/visuals.js";
import { CPU_NAMES, CPU_NAME_MAX, cpuNames } from "../game/race-setup.js";
import { SHORT_VIEW_CHOICES, shortViews } from "../game/cameras.js";

/*
  The controls edit a draft. Save puts it to use and stores it; Close warns first when the draft differs from what is
  stored, and then leaves without it.
*/
export async function mountOptionsPanel(container, context, { close: closeNow = () => {} } = {}) {
  const live = context.settings;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  /** What is stored, and the draft the controls change. */
  let stored = JSON.stringify(live);
  const settings = copy(live);
  const unsaved = () => JSON.stringify(settings) !== stored;
  const saveButton = el("button", { onclick: () => store(), title: "Use the changes and store them" }, "Save");
  /** A control changed the draft: the Save button shows whether there is anything to save. */
  const save = () => { saveButton.classList.toggle("unsaved", unsaved()); };
  /** Put a settings object to use: the live settings keep their identity, since every screen holds them. */
  const use = (next) => {
    const before = copy(live);
    for (const key of Object.keys(live)) delete live[key];
    Object.assign(live, copy(next));
    context.menuAudio?.setVolumes(live.sound);
    context.menuMusic?.refresh();
    if (before.wording !== live.wording) loadStrings(context);
    // The copy of the app is made or taken away when the switch is put to use, and taken back with it.
    if ((before.offline !== false) !== (live.offline !== false)) context.offline?.start();
    // A new menu skin redraws the screen under the dialog (not a race, which would start again).
    const current = context.router.stack.at(-1);
    if ((before.skin ?? "auto") !== (live.skin ?? "auto") && current && !["race", "replay"].includes(current.name)) {
      context.router.go(current.name, current.params, { replace: true });
    }
  };
  const store = () => { use(settings); saveSettings(live); stored = JSON.stringify(live); save(); };
  /** Close, warning first when there are changes: they are lost unless the player stays to save them. Returns whether it closed. */
  const close = () => {
    if (unsaved() && !window.confirm("The changes to the options are not saved.\n\nOK closes without them. Cancel goes back to save them.")) return false;
    closeNow();
    return true;
  };
  const bindings = mergeBindings(settings.bindings);
  const note = el("p", { class: "muted" }, "Pick an action, then press the key to use for it. Escape cancels.");
  let listening = null, escapeAt = -Infinity;
  const keyRows = el("div", { class: "bindings" });
  const showKeys = () => keyRows.replaceChildren(...ACTIONS.map((action) => el("div", { class: "form-row" },
    el("span", { class: "binding-label" }, context.t(action.label)),
    el("button", {
      class: listening === action.id ? "pick selected" : "pick",
      onclick: () => { listening = action.id; note.textContent = `Press a key for "${action.label}"...`; showKeys(); },
    }, listening === action.id ? "..." : bindings[action.id].map(codeLabel).join(" / ")))));
  showKeys();

  const onKey = (event) => {
    if (!listening) return;
    event.preventDefault();
    const action = listening;
    listening = null;
    if (event.code !== "Escape") {
      const other = conflictFor(bindings, event.code, action);
      if (other) bindings[other] = bindings[other].filter((code) => code !== event.code);
      if (other && !bindings[other].length) bindings[other] = [...DEFAULT_BINDINGS[other]].filter((code) => code !== event.code);
      bindings[action] = [event.code];
      settings.bindings = { ...bindings };
      save();
      note.textContent = `${ACTIONS.find((item) => item.id === action).label}: ${codeLabel(event.code)}.`;
    } else {
      note.textContent = "Cancelled.";
      escapeAt = performance.now();
    }
    showKeys();
  };
  window.addEventListener("keydown", onKey);

  // Every option is one row of the same height: its name on the left, its control on the right.
  const row = (label, control, title = null) => el("label", { class: "opt-row", title }, el("span", { class: "opt-label" }, label), el("span", { class: "opt-control" }, control));
  // Which setting each switch shows, for the controls to follow a preset (`showDraft`).
  const toggleKeys = new Map();
  const toggle = (label, key, title = null) => {
    toggleKeys.set(label, key);
    return row(label, el("input", {
      type: "checkbox", class: "opt-switch", checked: !!settings[key], "aria-label": label,
      onchange: (event) => { settings[key] = event.target.checked; save(); },
    }), title);
  };
  const choose = (label, key, names, values = names.map((_, index) => index)) => row(label,
    el("select", { "aria-label": label, onchange: (event) => {
      settings[key] = typeof values[0] === "number" ? Number(event.target.value) : event.target.value;
      save();
    } }, ...names.map((name, index) => el("option", { value: values[index], selected: values[index] === settings[key] }, name))));
  const slider = (label, { min, max, step, value, format, set, title = null }) => {
    const out = el("output", { class: "opt-value" }, format(value));
    return row(label, el("span", { class: "opt-slider" }, el("input", {
      type: "range", min, max, step, value, "aria-label": label,
      oninput: (event) => { const v = Number(event.target.value); out.textContent = format(v); set(v); },
    }), out), title);
  };
  const percent = (v) => `${Math.round(v * 100)}%`;
  const sound = (label, key) => slider(label, {
    min: 0, max: 1, step: 0.05, value: settings.sound[key], format: percent,
    set: (v) => { settings.sound = { ...settings.sound, [key]: v }; save(); },
  });

  // The headset's preferences (docs/VR.md, "Options"), shown where the browser has a headset.
  const setVr = (key, value) => { settings.vr = { ...vrSettings(settings.vr), [key]: value }; save(); };
  const vrToggle = (label, key) => el("label", {}, el("input", {
    type: "checkbox", checked: vrSettings(settings.vr)[key], onchange: (event) => setVr(key, event.target.checked),
  }), ` ${label}`);
  const vrChoose = (label, key, names, values) => {
    const current = vrSettings(settings.vr)[key];
    // The stored value may lie between the steps offered: the nearest one shows.
    const nearest = typeof values[0] === "number"
      ? values.reduce((best, value) => (Math.abs(value - current) < Math.abs(best - current) ? value : best))
      : current;
    return el("label", {}, `${label} `, el("select", {
      "aria-label": `Headset ${label}`,
      onchange: (event) => setVr(key, typeof values[0] === "number" ? Number(event.target.value) : event.target.value),
    }, ...names.map((name, index) => el("option", { value: values[index], selected: values[index] === nearest }, name))));
  };
  const headset = el("div", { hidden: true },
    el("h2", {}, "Headset"),
    el("div", { class: "form-row" },
      vrChoose("View", "view", VR_VIEWS.map((view) => view.name), VR_VIEWS.map((view) => view.id)),
      vrChoose("Steering", "steering", ["Thumbstick", "Hands as a wheel"], ["stick", "wheel"]),
      vrToggle("Keep the horizon level", "horizonLock"), vrToggle("Cab around the driver", "cab"), vrToggle("Timing and gauges", "hud")),
    el("div", { class: "form-row" },
      vrChoose("Cab style", "cabStyle", CAB_STYLES.map((style) => style.name), CAB_STYLES.map((style) => style.id))),
    el("div", { class: "form-row", title: "Sharpness and Edge detail take effect the next time the headset is entered." },
      vrChoose("Sharpness", "renderScale", ["70%", "85%", "100%", "120%", "140%"], [0.7, 0.85, 1, 1.2, 1.4]),
      vrChoose("Edge detail", "foveation", ["Full", "High", "Medium", "Low"], [0, 0.34, 0.67, 1]),
      vrChoose("View distance", "viewDistance", VIEW_DISTANCES.map((v) => v.name), VIEW_DISTANCES.map((v) => v.id))));

  // The copy of the app for starting without a server (docs/ARCHITECTURE.md, "Without a server").
  const offlineLine = el("span", { class: "muted" });
  const showOffline = () => { offlineLine.textContent = context.offline ? offlineStatusText(context.offline.status) : ""; };
  const offOffline = context.offline?.onChange(showOffline);
  showOffline();
  const offlineRow = context.offline ? el("div", { class: "form-row" },
    el("label", { title: "Keeps a copy of the game's own code in this browser, beside the installed game. With a server in reach the server's files are always the ones used." },
      el("input", {
        type: "checkbox", checked: settings.offline !== false,
        onchange: (event) => { settings.offline = event.target.checked; save(); },
      }), " Start without the server"),
    offlineLine) : "";

  // The port's own scenery (docs/VISUALS.md). A preset sets every part; Custom is the one that shows each switch.
  const sceneryNote = el("p", { class: "muted" });
  const scenerySwitches = el("div", { class: "opt-switches" });
  const hardware = graphicsHardware();
  const detected = detectGraphics(hardware);
  const showScenery = () => {
    const choice = graphicsChoice(settings.graphics);
    scenerySwitches.replaceChildren(...(choice === "custom"
      ? VISUAL_OPTIONS.map((option) => (option.amountKey ? slider(option.label, {
        min: 0, max: option.levels.length - 1, step: 1, value: option.level(settings), format: (v) => option.levels[v], title: option.hint,
        set: (v) => { settings[option.amountKey] = v; settings[option.key] = v > 0; save(); },
      }) : toggle(option.label, option.key, option.hint)))
      : []));
    const machine = choice === "auto" ? ` This machine: ${graphicsLabel(detected)}.` : "";
    sceneryNote.textContent = [GRAPHICS_NOTES[choice], machine.trim(), "Takes effect from the next race."].filter(Boolean).join(" ");
  };
  showScenery();

  const locFiles = await context.assets.call("locFiles").catch(() => []);
  const wording = row("Localization", el("select", { "aria-label": "Wording" },
    el("option", { value: "", selected: !settings.wording }, "Standard"),
    ...locFiles.map(({ path }) => el("option", { value: path, selected: path === settings.wording }, locName(path)))));
  const kind = { retail: "retail", beta: "beta", patch: "community patch", unknown: "build not read" }[buildKind(context.exeVersion)];
  const menus = row("UI", el("select", { "aria-label": "Menus", onchange: (event) => { settings.skin = event.target.value; save(); } },
    ...[["auto", `Automatic (${defaultSkin(context.exeVersion) === "classic" ? "classic" : "modern"})`], ["classic", "Classic (game art)"], ["modern", "Modern"]]
      .map(([value, text]) => el("option", { value, selected: (settings.skin ?? "auto") === value }, text))),
    `MONSTER.EXE ${context.exeVersion ?? "(not found)"}, ${kind}.`);
  const button = (label, onclick, cls = null, title = null) => el("button", { class: cls, "data-menu-sound": "STARTOFF", onclick, title }, label);
  /** A preset button (Options, Advanced): `apply` writes its settings over the draft, and every control shows them. */
  const preset = (label, apply, title) => button(label, () => {
    apply(settings);
    applyGraphics(settings, hardware);
    showDraft();
    save();
  }, null, title);

  /**
   * A small dialog over the options: `body` its controls, `ok()` what OK does with them. Escape or Cancel leaves the
   * draft as it was.
   */
  const subDialog = (title, body, ok) => {
    const dialog = el("dialog", { class: "options-sub", "aria-label": title });
    const done = (keep) => { if (keep) ok(); dialog.close(); };
    dialog.append(el("h2", {}, title), body, el("div", { class: "options-sub-actions" },
      el("button", { onclick: () => done(false) }, "Cancel"),
      el("button", { class: "primary", onclick: () => done(true) }, "OK")));
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    // Its keys are its own: the Keys page listens for a key to bind only while it asks for one.
    dialog.addEventListener("keydown", (event) => event.stopPropagation());
    (container.closest("dialog") ?? document.body).append(dialog);
    dialog.showModal();
  };
  /** The computer drivers' names (`aiNames`): each blank one is the game's own. */
  const editDriverNames = () => {
    const names = cpuNames(settings.aiNames);
    const inputs = CPU_NAMES.map((name, i) => el("input", {
      type: "text", maxlength: CPU_NAME_MAX, value: names[i] === name ? "" : names[i], placeholder: name, "aria-label": `Computer driver ${i + 1}`,
    }));
    subDialog("Computer drivers", el("div", { class: "options-sub-list" },
      el("p", { class: "muted" }, "The computer drivers by the order they are given out. A blank name is the game's own."),
      ...inputs.map((input, i) => el("label", { class: "opt-row" }, el("span", { class: "opt-label" }, `Driver ${i + 1}`), el("span", { class: "opt-control" }, input))),
      el("div", { class: "opt-actions" }, button("Game's names", () => { for (const input of inputs) input.value = ""; }))), () => {
      const own = inputs.map((input) => input.value.trim());
      settings.aiNames = own.some(Boolean) ? own : [];
      save();
    });
  };
  /** The views of the short camera cycle (`shortViews`): at least one. */
  const editShortViews = () => {
    const chosen = new Set(shortViews(settings.shortViews));
    const boxes = SHORT_VIEW_CHOICES.map((view) => el("input", { type: "checkbox", class: "opt-switch", checked: chosen.has(view.id), "aria-label": view.name }));
    const warn = el("p", { class: "muted" }, "The Camera key steps through the views ticked here, in this order.");
    subDialog("Short camera cycle", el("div", { class: "options-sub-list" }, warn,
      ...SHORT_VIEW_CHOICES.map((view, i) => el("label", { class: "opt-row" }, el("span", { class: "opt-label" }, context.t(view.name)), el("span", { class: "opt-control" }, boxes[i])))), () => {
      const ids = SHORT_VIEW_CHOICES.filter((_, i) => boxes[i].checked).map((view) => view.id);
      // None ticked keeps the list as it was.
      if (ids.length) { settings.shortViews = ids; save(); }
    });
  };
  /** The stored settings as a JSON file, with the format's version, for keeping or for another browser. */
  const exportOptions = () => {
    const data = optionsFile(JSON.parse(stored));
    const link = el("a", { href: URL.createObjectURL(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" })), download: "openmtm2-settings.json" });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  /**
   * Settings from an exported file, any version up to this one: they replace the stored settings at once, and the dialog
   * closes, since its controls show the settings it was opened with.
   */
  const importOptions = () => {
    const input = el("input", { type: "file", accept: ".json,application/json" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const read = readOptionsFile(await file.text());
      if (read.error) { window.alert(read.error); return; }
      if (!window.confirm(`Replace the settings with those in ${file.name}?${unsaved() ? "\n\nThe changes not saved here are lost." : ""}`)) return;
      use(read.settings);
      saveSettings(live);
      stored = JSON.stringify(live);
      window.alert("Settings imported.");
      closeNow();
    });
    input.click();
  };

  // Leaving the options for another screen: the same warning as Close first.
  const leaveFor = (go) => async () => { if (close()) await go(); };
  const nav = (label, onclick) => el("button", { class: "nav", "data-menu-sound": "STARTOFF", onclick }, label);
  const navButtons = el("div", { class: "options-nav" },
    nav("Hall of Fame", leaveFor(() => context.router.go("hall"))),
    nav("Instant Replay", async () => {
      const { pickReplayFile } = await import("./screens/replay.js");
      const replay = await pickReplayFile();
      if (!replay) { window.alert("That file is not a Monster Truck Madness 2 replay."); return; }
      await leaveFor(() => context.router.go("replay", { replay }))();
    }),
    nav("Start screen", leaveFor(() => context.router.go("start", {}, { replace: true }))));

  const sections = [
    ["Game", [
      row("Physics", el("select", { "aria-label": "Physics", onchange: (event) => { settings.physics = event.target.value; save(); } },
        ...PHYSICS_MODELS.map((m) => el("option", { value: m.id, selected: m.id === physicsModel(settings.physics).id, title: m.note }, m.label))),
      "The rules the trucks are driven by, from the next race on. Monster Truck Madness is the 1996 game: tires that touch throw trucks twice as hard, water stops a truck, weather does not change the grip, no crash damage, and its drag rules"),
      toggle("Automatic gears", "autoShift"), toggle("Crash damage", "crashDamage", "Trucks dent where they are hit"),
      toggle("Drag auto stage", "autoStage", "Drag races: the truck drives itself to the staging beams. Off, you stage it yourself; the Auto Stage key (T) then does it for one pass"),
      choose("Speed", "units", ["MPH", "KPH"], ["mph", "kph"]),
      row("Computer opponents", el("select", { "aria-label": "Computer opponents", onchange: (event) => {
        // A new default replaces the list picked on the Races screen.
        settings.defaultOpponents = Number(event.target.value);
        delete settings.opponentTrucks;
        save();
      } }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => el("option", { value: n, selected: n === (settings.defaultOpponents ?? 3) }, String(n)))),
      "How many computer trucks race by default; the Races screen picks which"),
    ]],
    ["Display", [
      row("Smooth textures", el("input", {
        type: "checkbox", class: "opt-switch", checked: settings.look === "enhanced", "aria-label": "Smooth textures",
        onchange: (event) => { settings.look = event.target.checked ? "enhanced" : "classic"; save(); },
      }), "Textures filtered smooth and the world lit by the sun (the enhanced look). Off: the game's own sharp texels and baked light"),
      choose("Detail", "detailLevel", ["Low", "Medium", "High"]),
      row("Anti-aliasing", el("select", {
        "aria-label": "Anti-aliasing", title: AA_HINT,
        onchange: (event) => { settings.aa = event.target.value; save(); },
      }, ...AA_MODES.map((mode) => el("option", { value: mode.id, selected: mode.id === aaChoice(settings.aa) }, mode.label))), AA_HINT),
      // In terrain cells (32 ft each), as the game counts its view; 128 is the standard.
      slider("Draw distance", { min: 16, max: 256, step: 16, value: Math.min(256, settings.drawCells ?? 128), format: (v) => `${v} cells`, set: (v) => { settings.drawCells = v; save(); } }),
      toggle("V-sync", "vsync", "Draw with the display's refresh. Off draws as fast as the browser allows; a browser still shows no more frames than the display has"),
      row("Frame rate limit", el("span", { class: "opt-slider" },
        el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.fpsLimit, "aria-label": "Frame rate limit", onchange: (event) => { settings.fpsLimit = event.target.checked; save(); } }),
        el("select", { "aria-label": "Frame rate limit value", onchange: (event) => { settings.fpsLimitValue = Number(event.target.value); save(); } },
          ...[24, 30, 45, 60, 75, 90, 120, 144, 240].map((n) => el("option", { value: n, selected: n === (settings.fpsLimitValue ?? 60) }, `${n} FPS`)))),
      "Hold the race to this many frames a second"),
      toggle("FPS counter", "fpsCounter", "Show the frames per second in the corner of a race or replay (the FPS counter key switches it)"),
      toggle("Backdrops", "backdrops"),
      menus,
      el("h3", {}, "Effects"),
      toggle("Tire tracks", "tireTracks"), toggle("Water splashes", "waterSplash"),
      // MTM2's own two (MONSTER.INI reflectionFlag and truckReflectionFlag), for the game's water and every truck.
      toggle("Water reflections", "waterReflections", "MTM2's: the world mirrored in the game's water (\"Reflective water\" has its own). From the next race"),
      toggle("Truck reflections", "truckReflections", "MTM2's: the clouds mirrored on the trucks' bodies, or the sky in Rain, Dusk and Night; none in fog or Pitch Black. From the next race"),
      // One amount for both pictures (game/tire-effects.js `CLASSIC_DUST`, `RICH_DUST`): Few is the game's own puffs.
      slider("Dust", {
        min: 0, max: 3, step: 1, value: dustLevel(settings), format: (v) => DUST_LEVEL_NAMES[v],
        set: (v) => { settings.dustAmount = v; settings.dustEffects = v > 0; save(); },
      }),
      // One amount for both pictures (game/tire-effects.js `sparkRules`).
      slider("Sparks", {
        min: 0, max: 3, step: 1, value: sparkLevel(settings), format: (v) => SPARK_LEVEL_NAMES[v],
        set: (v) => { settings.sparkAmount = v; settings.sparks = v > 0; save(); },
      }),
      // The port's own scenery (docs/VISUALS.md): one preset, and on Custom each part on its own switch.
      el("h3", {}, "Enhanced graphics"),
      row("Preset", el("select", {
        "aria-label": "Enhanced graphics", title: GRAPHICS_HINT,
        onchange: (event) => {
          settings.graphics = graphicsChoice(event.target.value);
          applyGraphics(settings, hardware);
          showScenery();
          save();
        },
      }, ...GRAPHICS_PRESETS.map((preset) => el("option", { value: preset.id, selected: preset.id === graphicsChoice(settings.graphics) }, preset.label))), GRAPHICS_HINT),
      scenerySwitches,
      sceneryNote,
    ]],
    ["Headset", [headset]],
    ["Sound", [
      sound("Master", "master"), sound("Effects", "effects"), sound("Music", "music"),
      row("Mute", el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.sound.muted, onchange: (event) => {
        settings.sound = { ...settings.sound, muted: event.target.checked };
        save();
      } })),
      toggle("Menu music", "menuMusic"),
      row("Announcer voice", el("input", { type: "checkbox", class: "opt-switch", checked: false, disabled: !VOICE_COMMENTARY_ENABLED }), "Voice commentary is temporarily disabled."),
    ]],
    ["Keys", [choose("Fly-by controls", "flyControls", FLY_SCHEMES.map((id) => FLY_SCHEME_NAMES[id]), [...FLY_SCHEMES]), note, keyRows, el("div", { class: "opt-actions" }, button("Reset keys", () => {
      Object.assign(bindings, mergeBindings({})); settings.bindings = {}; save(); note.textContent = "Keys reset."; showKeys();
    }))]],
    // What a newcomer can leave alone: other games' tracks, the patch's materials, the computer trucks and the cameras.
    ["Advanced", [
      // Each preset sets the draft; Save keeps it.
      el("div", { class: "opt-actions opt-presets" },
        preset("MTM1 Classic preset", applyMtm1Classic, "Monster Truck Madness 1 as it was: MTM1 sky, trucks apart, original backdrops, MTM1 particles and sounds, the 1996 physics, tiles edge to edge, and the enhanced graphics off. Save to keep it."),
        preset("MTM2 Classic preset", applyMtm2Classic, "Monster Truck Madness 2 as it was: no MTM1 option, original backdrops, MTM2 classic dust (the game's few puffs), no sparks or water splashes, no CP3 HD weather or reflections, MTM2's water and truck reflections, backdrops, and the enhanced graphics off. Save to keep it."),
        preset("OpenMTM2 preset", applyOpenMtm2, "The port's own picture: no MTM1 or MTM2 option, tire tracks, water splashes, many dust puffs and normal sparks, every enhanced part but the glossy paint, and CP3 terrain detail, HD weather and reflections. Save to keep it.")),
      el("h3", {}, "Display"),
      toggle("MTM1 particles", "mtm1Particles", "Monster Truck Madness 1's own particles and tracks: single points of the ground's colour thrown by the tires, which mark the ground where they land, and tracks darkened into the ground, in place of the dust, the spray and the tire tracks. From the next race"),
      toggle("Original backdrops", "originalBackdrops", "The game's own backdrops in place of HD ones (Community Patch 3's backdropsHD.pod), wherever an archive still has the original. From the next race"),
      toggle("MTM1 sounds", "mtm1Sounds", "Monster Truck Madness 1's skids from MTM2's SOUND.POD: its corner, wheelspin and brake skids. MTM1's engine is not in MTM2's archives; the engine stays MTM2's"),
      toggle("MTM1 sky", "mtm1EarthSky", "Monster Truck Madness 1's flat sky on every track: an MTM1 track's own, and EARTHSKY on the others, in the weathers without a sky of their own. Needs MTM1's sky files mounted (EARTHSKY.ACT and ALIENSKY.RAW, in MTM1's GAME.POD). From the next race"),
      row("MTM1 no terrain overlap", el("input", { type: "checkbox", class: "opt-switch", checked: !settings.mtm1TerrainOverlap, "aria-label": "MTM1 no terrain overlap", onchange: (event) => { settings.mtm1TerrainOverlap = !event.target.checked; save(); } }),
        "Monster Truck Madness 1 tracks: the ground tiles meet edge to edge, as MTM1 draws them. Off, they overlap by two pixels, as MTM2 does"),
      toggle("MTM2 classic dust", "greyDust", "Wheels' dust and collisions' smoke in the game's own grey puff colour, as MTM2 draws them, in place of the port's earth-coloured dust and dark smoke. From the next race"),
      toggle("CP3 Terrain detail", "terrainDetail", "Community Patch 3 tracks: detail normals where the track paints a mask, and HD ground normal maps (Enhanced look)"),
      row("CP3 HD weather", el("input", { type: "checkbox", class: "opt-switch", checked: settings.hdWeather !== false, "aria-label": "CP3 HD weather", onchange: (event) => { settings.hdWeather = event.target.checked; save(); } }),
        "Community Patch 3's HD skies for Rain, Dusk and Night and the older levels' clouds: the pictures in the game folder's WeatherArt folder, or the port's own copy of the community's set. Off: the game's own sky art"),
      toggle("CP3 Reflections", "reflections", "Community Patch 3 materials: the sky reflected in glass and paint (Enhanced look)"),
      el("h3", {}, "Game"),
      row("Opponent frame rate", el("select", { "aria-label": "Opponent frame rate", onchange: (event) => { settings.opponentFps = Number(event.target.value); save(); } },
        ...[15, 20, 24, 30, 45, 60].map((n) => el("option", { value: n, selected: n === (settings.opponentFps ?? 30) }, `${n} FPS`))),
      "The frame rate the computer trucks drive as if the game ran at: they steer by the frame, so it changes how they handle. 30 is the standard"),
      toggle("Keep MTM1 trucks apart", "mtm1TrucksApart", "Monster Truck Madness 1 trucks named like MTM2's (BIGFOOT.TRK and the rest) are listed too, as \"Bigfoot (MTM1)\", and drawn from MTM1's own files. Off, a name goes to the archive mounted first, MTM2's, as in the game"),
      toggle("Sonic trucks", "sonicTrucks", "Professional only: the computer trucks drive as on a Sonic track, on every track"),
      row("Computer drivers", button("Names...", () => editDriverNames()), "The names of the computer drivers"),
      toggle("Full Autopilot", "fullAutopilot", "The truck drives itself"),
      toggle("Show hidden tracks", "showHiddenTracks"),
      toggle("Kooky horn", "kookyHorn", "Three horns instead of one"),
      el("h3", {}, "Cameras"),
      row("Short camera cycle", el("span", { class: "opt-slider" },
        el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.shortViewCycle, "aria-label": "Short camera cycle", onchange: (event) => { settings.shortViewCycle = event.target.checked; save(); } }),
        button("Views...", () => editShortViews())),
      "The Camera key (V) steps through the views in the list only: the cockpit, Chase Near and Chase Far unless changed"),
      toggle("Camera clearance", "cameraClearance", "The chase camera keeps a few feet over the ground, easing back down after a crest. Off, it may touch the ground, as in the game"),
      toggle("Z-mode cameras", "zModeCameras", "Zoom with Shift and - or +, orbit with Insert and Delete, and the Inertia view, in any race without GOLD mode"),
      el("h3", {}, "App"),
      wording, offlineRow,
    ]],
    ["Data", [
      el("p", { class: "muted" },
        "OpenMTM2 reads the tracks and vehicles of Monster Truck Madness 1 and 2, CART Precision Racing and 4x4 Evolution 1 and 2. "
        + "Add POD.INI reads another game folder's POD.INI and mounts every archive it lists. Reload POD.INI mounts again every archive "
        + "the base install's POD.INI lists, in its order. Change base install picks the Monster Truck Madness 2 folder again, or another one. "
        + "The POD manager shows what is mounted, and adds single POD files from any game without the game being installed."),
      el("div", { class: "opt-actions opt-data" },
        button("Add POD.INI", async (event) => {
          const target = event.currentTarget;
          const [{ pickInstallFolder }, { inspectGameFolder }] = await Promise.all([import("../install/picker.js"), import("../install/inspect-source.js")]);
          const source = await pickInstallFolder();
          if (!source) return;
          const found = await inspectGameFolder(source);
          if (!found.ok) { window.alert(found.message); return; }
          const label = target.textContent;
          target.disabled = true;
          const off = context.assets.on("install-progress", ({ copied, total, name }) => {
            target.textContent = `Copying ${name} ${total ? Math.round((copied / total) * 100) : 100}%`;
          });
          try {
            const done = await context.assets.call("addGameFolder", { label: found.label, files: found.files });
            const lines = [`${done.added.length} archives added from ${found.label}${done.game ? ` (${done.game})` : ""}.`];
            if (found.missing?.length) lines.push(`Listed but not in the folder: ${found.missing.join(", ")}.`);
            window.alert(lines.join("\n"));
            window.location.reload();
          } catch (error) {
            window.alert(`Could not add the folder: ${error.message}`);
            target.textContent = label;
            target.disabled = false;
          } finally {
            off();
          }
        }, null, "Pick another game's folder: its POD.INI is read and every archive it lists is added beside the base install"),
        button("Reload POD.INI", async (event) => {
          // The POD.INI picked with the base install, from its copy: no folder is picked.
          if (!close()) return;
          const target = event.currentTarget;
          target.disabled = true;
          try {
            const done = await context.assets.call("reloadPodIni");
            const lines = [`${done.archives} archives of the base install mounted, in POD.INI order.`];
            if (done.restored.length) lines.push(`Mounted again: ${done.restored.join(", ")}.`);
            window.alert(lines.join("\n"));
            window.location.reload();
          } catch (error) {
            window.alert(`Could not reload POD.INI: ${error.message}`);
            target.disabled = false;
          }
        }, null, "Mount again every archive the base install's POD.INI lists, those taken out in the POD manager included, in the file's order"),
        button("Change base install", async (event) => {
          // The browser keeps no handle on the folder, so it is picked again; only new or changed archives are copied.
          const target = event.currentTarget;
          const [{ pickInstallFolder }, { inspectSource }] = await Promise.all([import("../install/picker.js"), import("../install/inspect-source.js")]);
          const source = await pickInstallFolder();
          if (!source) return;
          const found = await inspectSource(source);
          if (!found.files?.length) { window.alert(found.message); return; }
          const label = target.textContent;
          target.disabled = true;
          const off = context.assets.on("install-progress", ({ copied, total, name }) => {
            target.textContent = `Copying ${name} ${total ? Math.round((copied / total) * 100) : 100}%`;
          });
          try {
            const done = await context.assets.call("reloadInstall", { files: found.files, podIni: found.podIni, exeVersion: found.exeVersion ?? null, weatherArt: found.weatherArt ?? [] });
            const lines = [`${done.archives.length} archives mounted, in POD.INI order.`];
            if (done.added.length) lines.push(`Copied: ${done.added.join(", ")}.`);
            if (done.removed.length) lines.push(`Removed: ${done.removed.join(", ")}.`);
            if (found.missing?.length) lines.push(`Listed but not in the folder: ${found.missing.join(", ")}.`);
            window.alert(lines.join("\n"));
            window.location.reload();
          } catch (error) {
            window.alert(`Could not change the base install: ${error.message}`);
            target.textContent = label;
            target.disabled = false;
          } finally {
            off();
          }
        }, null, "Pick the Monster Truck Madness 2 folder again, or another one: its POD.INI is read, and only new or changed archives are copied")),
      el("h3", {}, "POD mounting"),
      el("div", { class: "opt-actions opt-data" },
        button("POD manager", async () => { (await import("./pod-manager.js")).openPodManager(context); })),
      el("h3", {}, "Settings"),
      el("div", { class: "opt-actions opt-data" },
        button("Export settings", () => exportOptions()),
        button("Import settings", () => importOptions())),
      el("div", { class: "opt-actions opt-data" },
        el("button", { class: "danger", onclick: async (event) => {
          if (!window.confirm(
            "Clear all OpenMTM2 data from this browser? This permanently removes the copied install, "
            + "drivers, Hall of Fame entries and settings.",
          )) return;
          event.currentTarget.disabled = true;
          try {
            // The copy of the app goes too; a page that is opened again with a server makes a new one.
            await context.offline?.remove();
            await context.assets.call("clearGameData");
            clearSettings();
            window.location.reload();
          } catch (error) {
            event.currentTarget.disabled = false;
            window.alert(`Could not clear the browser data: ${error.message}`);
          }
        } }, "Clear browser game data")),
    ]],
  ];
  // One category at a time, chosen from the tabs; the last one shown is remembered for the session.
  const pages = sections.map(([, rows]) => el("div", { class: "opt-page" }, ...rows));
  const tabs = sections.map(([name], i) => el("button", { class: "opt-tab", onclick: () => pick(i) }, name));
  const pick = (i) => {
    context.optionsTab = i;
    pages.forEach((page, k) => { page.hidden = k !== i; });
    tabs.forEach((tab, k) => tab.classList.toggle("selected", k === i));
  };
  pick(Math.min(context.optionsTab ?? 0, sections.length - 1));
  // The Headset tab shows where the browser has a headset; elsewhere it stays out of the way.
  const headsetIndex = sections.findIndex(([name]) => name === "Headset");
  if (!context.xr) tabs[headsetIndex].hidden = true;
  context.xr?.supported.then((yes) => {
    headset.hidden = !yes;
    tabs[headsetIndex].hidden = !yes;
    if (!yes && context.optionsTab === headsetIndex) pick(0);
  });
  /** Every control shows the draft again, after a preset has changed it. */
  function showDraft() {
    const shown = {
      "Physics": () => physicsModel(settings.physics).id, "Smooth textures": () => settings.look === "enhanced",
      "Enhanced graphics": () => graphicsChoice(settings.graphics), "MTM1 no terrain overlap": () => !settings.mtm1TerrainOverlap,
      "CP3 HD weather": () => settings.hdWeather !== false, "Dust": () => dustLevel(settings), "Sparks": () => sparkLevel(settings),
    };
    // A slider's figure beside it, in its own words.
    const named = { "Dust": DUST_LEVEL_NAMES, "Sparks": SPARK_LEVEL_NAMES };
    for (const control of container.querySelectorAll("input[aria-label], select[aria-label]")) {
      const label = control.getAttribute("aria-label");
      const value = toggleKeys.has(label) ? !!settings[toggleKeys.get(label)] : shown[label]?.();
      if (value === undefined) continue;
      if (control.type === "checkbox") control.checked = !!value; else control.value = String(value);
      if (control.type === "range" && named[label] && control.nextElementSibling) control.nextElementSibling.textContent = named[label][value];
    }
    showScenery();
  }

  container.append(
    el("div", { class: "opt-tabs" }, ...tabs),
    el("div", { class: "opt-pages" }, ...pages),
    el("div", { class: "options-footer" }, navButtons, saveButton,
      el("button", { class: "primary", onclick: close }, "Close")),
  );

  const onChange = (event) => {
    const which = event.target?.getAttribute?.("aria-label");
    if (which === "Wording") {
      settings.wording = event.target.value;
      save();
    }
  };
  container.addEventListener("change", onChange);
  const cleanup = () => {
    window.removeEventListener("keydown", onKey);
    container.removeEventListener("change", onChange);
    offOffline?.();
  };
  /** For the dialog's own ways out (Escape, a click outside): the same question as the Close button. */
  cleanup.requestClose = () => { if (performance.now() - escapeAt > 200) close(); };
  return cleanup;
}
