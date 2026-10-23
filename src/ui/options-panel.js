/* Shared contents of the Options screen and the Options modal opened from every menu screen. */
import { DUST_LEVEL_NAMES, SPARK_LEVEL_NAMES, dustLevel, sparkLevel } from "../game/tire-effects.js";
import { GRASS_LEVEL_NAMES, grassLevel } from "../render/evo-grass.js";
import { FLY_SCHEMES, FLY_SCHEME_NAMES } from "../game/fly-camera.js";
import { buildKind, defaultSkin } from "../install/exe-version.js";
import { el } from "./dom.js";
import { LANGUAGES, PHYSICS_MODELS, applyMtm1Classic, applyMtm2Classic, applyOpenMtm2, clearSettings, languageOf, optionsFile, physicsModel, readOptionsFile, saveSettings } from "../app/settings.js";
import { offlineStatusText } from "../app/offline.js";
import { loadStrings } from "../app/strings-store.js";
import { locName, msg } from "../game/strings.js";
import { ACTIONS, DEFAULT_BINDINGS, codeLabel, conflictFor, mergeBindings } from "../game/input/bindings.js";
import { CAB_STYLES, VIEW_DISTANCES, VR_VIEWS, vrSettings } from "../game/vr/settings.js";
import { VOICE_COMMENTARY_ENABLED } from "../audio/commentary-audio.js";
import { AA_HINT, AA_MODES, aaChoice } from "../game/aa.js";
import { GRAPHICS_HINT, GRAPHICS_NOTES, GRAPHICS_PRESETS, applyGraphics, detectGraphics, graphicsChoice, graphicsLabel } from "../game/graphics.js";
import { graphicsHardware } from "../app/graphics-hardware.js";
import { VISUAL_OPTIONS } from "../game/visuals.js";
import { CPU_NAMES, CPU_NAME_MAX, cpuNames } from "../game/race-setup.js";
import { SHORT_VIEW_CHOICES, shortViews } from "../game/cameras.js";
import { EXTENSIONS, setExtensionSetting, settingsForExtension } from "../game/extensions/loader.js";

/*
  The controls edit a draft. Save puts it to use and stores it; Close warns first when the draft differs from what is
  stored, and then leaves without it.

  Labels are English tags (game/strings.js), shown through `t`. A control keeps its tag in `data-opt`, which is how
  `showDraft` finds it again in any language.
*/
export async function mountOptionsPanel(container, context, { close: closeNow = () => {} } = {}) {
  const t = (text, ...args) => context.t(text, ...args);
  const live = context.settings;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  /** What is stored, and the draft the controls change. */
  let stored = JSON.stringify(live);
  const settings = copy(live);
  const unsaved = () => JSON.stringify(settings) !== stored;
  const saveButton = el("button", { onclick: () => store(), title: t("Use the changes and store them") }, t("Save"));
  /** A control changed the draft: the Save button shows whether there is anything to save. */
  const save = () => { saveButton.classList.toggle("unsaved", unsaved()); };
  /** Put a settings object to use: the live settings keep their identity, since every screen holds them. */
  const use = (next) => {
    const before = copy(live);
    for (const key of Object.keys(live)) delete live[key];
    Object.assign(live, copy(next));
    context.menuAudio?.setVolumes(live.sound);
    context.menuMusic?.refresh();
    // A new language or wording redraws the screen under the dialog in it, as a new skin does.
    const words = before.wording !== live.wording || languageOf(before) !== languageOf(live);
    const redraw = () => {
      const current = context.router.stack.at(-1);
      if (current && !["race", "replay"].includes(current.name)) context.router.go(current.name, current.params, { replace: true });
    };
    if (words) loadStrings(context).then(redraw);
    // The copy of the app is made or taken away when the switch is put to use, and taken back with it.
    if ((before.offline !== false) !== (live.offline !== false)) context.offline?.start();
    // A new menu skin redraws the screen under the dialog (not a race, which would start again).
    const current = context.router.stack.at(-1);
    if (!words && (before.skin ?? "auto") !== (live.skin ?? "auto") && current && !["race", "replay"].includes(current.name)) {
      context.router.go(current.name, current.params, { replace: true });
    }
  };
  const store = () => { use(settings); saveSettings(live); stored = JSON.stringify(live); save(); };
  /** Close, warning first when there are changes: they are lost unless the player stays to save them. Returns whether it closed. */
  const close = () => {
    if (unsaved() && !window.confirm(t("The changes to the options are not saved.\n\nOK closes without them. Cancel goes back to save them."))) return false;
    closeNow();
    return true;
  };
  const bindings = mergeBindings(settings.bindings);
  const note = el("p", { class: "muted" }, t("Pick an action, then press the key to use for it. Escape cancels."));
  let listening = null, escapeAt = -Infinity;
  const keyRows = el("div", { class: "bindings" });
  const showKeys = () => keyRows.replaceChildren(...ACTIONS.map((action) => el("div", { class: "form-row" },
    el("span", { class: "binding-label" }, context.t(action.label)),
    el("button", {
      class: listening === action.id ? "pick selected" : "pick",
      onclick: () => { listening = action.id; note.textContent = t("Press a key for \"<<1>>\"...", t(action.label)); showKeys(); },
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
      note.textContent = `${t(ACTIONS.find((item) => item.id === action).label)}: ${codeLabel(event.code)}.`;
    } else {
      note.textContent = t("Cancelled.");
      escapeAt = performance.now();
    }
    showKeys();
  };
  window.addEventListener("keydown", onKey);

  // Every option is one row of the same height: its name on the left, its control on the right.
  const row = (label, control, title = null) => el("label", { class: "opt-row", title: title && t(title) }, el("span", { class: "opt-label" }, t(label)), el("span", { class: "opt-control" }, control));
  // Which setting each switch shows, for the controls to follow a preset (`showDraft`).
  const toggleKeys = new Map();
  const toggle = (label, key, title = null) => {
    toggleKeys.set(label, key);
    return row(label, el("input", {
      type: "checkbox", class: "opt-switch", checked: !!settings[key], "aria-label": t(label), "data-opt": label,
      onchange: (event) => { settings[key] = event.target.checked; save(); },
    }), title);
  };
  const choose = (label, key, names, values = names.map((_, index) => index)) => row(label,
    el("select", { "aria-label": t(label), "data-opt": label, onchange: (event) => {
      settings[key] = typeof values[0] === "number" ? Number(event.target.value) : event.target.value;
      save();
    } }, ...names.map((name, index) => el("option", { value: values[index], selected: values[index] === settings[key] }, t(name)))));
  const slider = (label, { min, max, step, value, format, set, title = null }) => {
    const out = el("output", { class: "opt-value" }, t(format(value)));
    // As wide as its longest figure, so the slider does not jump as the words change.
    const steps = Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step);
    out.style.width = `${Math.max(...steps.map((v) => t(format(v)).length)) + 1}ch`;
    return row(label, el("span", { class: "opt-slider" }, el("input", {
      type: "range", min, max, step, value, "aria-label": t(label), "data-opt": label,
      oninput: (event) => { const v = Number(event.target.value); out.textContent = t(format(v)); set(v); },
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
  }), ` ${t(label)}`);
  const vrChoose = (label, key, names, values) => {
    const current = vrSettings(settings.vr)[key];
    // The stored value may lie between the steps offered: the nearest one shows.
    const nearest = typeof values[0] === "number"
      ? values.reduce((best, value) => (Math.abs(value - current) < Math.abs(best - current) ? value : best))
      : current;
    return el("label", {}, `${t(label)} `, el("select", {
      "aria-label": t(label),
      onchange: (event) => setVr(key, typeof values[0] === "number" ? Number(event.target.value) : event.target.value),
    }, ...names.map((name, index) => el("option", { value: values[index], selected: values[index] === nearest }, t(name)))));
  };
  const headset = el("div", { hidden: true },
    el("h2", {}, t("Headset")),
    el("div", { class: "form-row" },
      vrChoose(msg("View"), "view", VR_VIEWS.map((view) => view.name), VR_VIEWS.map((view) => view.id)),
      vrChoose(msg("Steering"), "steering", [msg("Thumbstick"), msg("Hands as a wheel")], ["stick", "wheel"]),
      vrToggle(msg("Keep the horizon level"), "horizonLock"), vrToggle(msg("Cab around the driver"), "cab"), vrToggle(msg("Timing and gauges"), "hud")),
    el("div", { class: "form-row" },
      vrChoose(msg("Cab style"), "cabStyle", CAB_STYLES.map((style) => style.name), CAB_STYLES.map((style) => style.id))),
    el("div", { class: "form-row", title: t("Sharpness and Edge detail take effect the next time the headset is entered.") },
      vrChoose(msg("Sharpness"), "renderScale", ["70%", "85%", "100%", "120%", "140%"], [0.7, 0.85, 1, 1.2, 1.4]),
      vrChoose(msg("Edge detail"), "foveation", [msg("Full"), msg("High"), msg("Medium"), msg("Low")], [0, 0.34, 0.67, 1]),
      vrChoose(msg("View distance"), "viewDistance", VIEW_DISTANCES.map((v) => v.name), VIEW_DISTANCES.map((v) => v.id))));

  // The copy of the app for starting without a server (docs/ARCHITECTURE.md, "Without a server").
  const offlineLine = el("span", { class: "muted" });
  const showOffline = () => { offlineLine.textContent = context.offline ? offlineStatusText(context.offline.status, t) : ""; };
  const offOffline = context.offline?.onChange(showOffline);
  showOffline();
  const offlineRow = context.offline ? el("div", { class: "form-row" },
    el("label", { title: t("Keeps a copy of the game's own code in this browser, beside the installed game. With a server in reach the server's files are always the ones used.") },
      el("input", {
        type: "checkbox", checked: settings.offline !== false,
        onchange: (event) => { settings.offline = event.target.checked; save(); },
      }), ` ${t("Start without the server")}`),
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
    const machine = choice === "auto" ? t("This machine: <<1>>.", t(graphicsLabel(detected))) : "";
    sceneryNote.textContent = [GRAPHICS_NOTES[choice] && t(GRAPHICS_NOTES[choice]), machine, t("Takes effect from the next race.")].filter(Boolean).join(" ");
  };
  showScenery();

  const locFiles = await context.assets.call("locFiles").catch(() => []);
  const wording = row(msg("Localization"), el("select", { "aria-label": t("Wording"), "data-opt": "Wording" },
    el("option", { value: "", selected: !settings.wording }, t("Standard")),
    ...locFiles.map(({ path }) => el("option", { value: path, selected: path === settings.wording }, locName(path)))));
  const kind = { retail: msg("retail"), beta: msg("beta"), patch: msg("community patch"), unknown: msg("build not read") }[buildKind(context.exeVersion)];
  // The app's own language (app/settings.js LANGUAGES); a `.LOC` above changes the game's wording within it.
  const language = row(msg("Language"), el("select", { "aria-label": t("Language"), onchange: (event) => { settings.language = event.target.value; save(); } },
    ...LANGUAGES.map(({ id, label }) => el("option", { value: id, selected: id === languageOf(settings) }, label))));
  const menus = row(msg("UI"), el("select", { "aria-label": t("Menus"), onchange: (event) => { settings.skin = event.target.value; save(); } },
    ...[["auto", defaultSkin(context.exeVersion) === "classic" ? t("Automatic (classic)") : t("Automatic (modern)")], ["classic", t("Classic (game art)")], ["modern", t("Modern")]]
      .map(([value, text]) => el("option", { value, selected: (settings.skin ?? "auto") === value }, text))),
    `MONSTER.EXE ${context.exeVersion ?? t("(not found)")}, ${t(kind)}.`);
  const button = (label, onclick, cls = null, title = null) => el("button", { class: cls, "data-menu-sound": "STARTOFF", onclick, title: title && t(title) }, t(label));
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
    const dialog = el("dialog", { class: "options-sub", "aria-label": t(title) });
    const done = (keep) => { if (keep) ok(); dialog.close(); };
    dialog.append(el("h2", {}, t(title)), body, el("div", { class: "options-sub-actions" },
      el("button", { onclick: () => done(false) }, t("Cancel")),
      el("button", { class: "primary", onclick: () => done(true) }, t("OK"))));
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
      type: "text", maxlength: CPU_NAME_MAX, value: names[i] === name ? "" : names[i], placeholder: name, "aria-label": t("Computer driver <<1>>", i + 1),
    }));
    subDialog(msg("Computer drivers"), el("div", { class: "options-sub-list" },
      el("p", { class: "muted" }, t("The computer drivers by the order they are given out. A blank name is the game's own.")),
      ...inputs.map((input, i) => el("label", { class: "opt-row" }, el("span", { class: "opt-label" }, t("Driver <<1>>", i + 1)), el("span", { class: "opt-control" }, input))),
      el("div", { class: "opt-actions" }, button(msg("Game's names"), () => { for (const input of inputs) input.value = ""; }))), () => {
      const own = inputs.map((input) => input.value.trim());
      settings.aiNames = own.some(Boolean) ? own : [];
      save();
    });
  };
  /** The views of the short camera cycle (`shortViews`): at least one. */
  const editShortViews = () => {
    const chosen = new Set(shortViews(settings.shortViews));
    const boxes = SHORT_VIEW_CHOICES.map((view) => el("input", { type: "checkbox", class: "opt-switch", checked: chosen.has(view.id), "aria-label": t(view.name) }));
    const warn = el("p", { class: "muted" }, t("The Camera key steps through the views ticked here, in this order."));
    subDialog(msg("Short camera cycle"), el("div", { class: "options-sub-list" }, warn,
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
      const read = readOptionsFile(await file.text(), t);
      if (read.error) { window.alert(read.error); return; }
      if (!window.confirm(`${t("Replace the settings with those in <<1>>?", file.name)}${unsaved() ? `\n\n${t("The changes not saved here are lost.")}` : ""}`)) return;
      use(read.settings);
      saveSettings(live);
      stored = JSON.stringify(live);
      window.alert(t("Settings imported."));
      closeNow();
    });
    input.click();
  };

  // Leaving the options for another screen: the same warning as Close first.
  const leaveFor = (go) => async () => { if (close()) await go(); };
  const nav = (label, onclick) => el("button", { class: "nav", "data-menu-sound": "STARTOFF", onclick }, t(label));
  const navButtons = el("div", { class: "options-nav" },
    nav(msg("Hall of Fame"), leaveFor(() => context.router.go("hall"))),
    nav(msg("Instant Replay"), async () => {
      const { pickReplayFile } = await import("./screens/replay.js");
      const replay = await pickReplayFile();
      if (!replay) { window.alert(t("That file is not a Monster Truck Madness 2 replay.")); return; }
      await leaveFor(() => context.router.go("replay", { replay }))();
    }),
    nav(msg("Start screen"), leaveFor(() => context.router.go("start", {}, { replace: true }))));

  /** Settings declared by each extension: a heading, its description and its rows, as the Display page's sections are. */
  const extensionPanels = EXTENSIONS.flatMap((extension) => [
    el("h3", {}, t(extension.name)),
    el("p", { class: "muted" }, t(extension.description)),
    ...extension.settings.map((spec) => {
      const current = settingsForExtension(settings, extension)[spec.key];
      if (spec.type === "number") {
        const input = el("input", {
          type: "number", min: spec.min, max: spec.max, value: current,
          "aria-label": `${t(extension.name)}: ${t(spec.label)}`,
          onchange: (event) => {
            const typed = Math.trunc(Number(event.target.value));
            const value = Math.max(spec.min, Math.min(spec.max, Number.isFinite(typed) && event.target.value !== "" ? typed : spec.default));
            event.target.value = String(value);
            setExtensionSetting(settings, extension, spec.key, value);
            save();
          },
        });
        // The unit after the box ("minutes"), where there is one.
        return row(spec.label, spec.suffix ? el("span", {}, input, ` ${t(spec.suffix)}`) : input);
      }
      if (spec.type === "boolean") {
        return row(spec.label, el("input", {
          type: "checkbox", class: "opt-switch", checked: !!current,
          "aria-label": `${t(extension.name)}: ${t(spec.label)}`,
          onchange: (event) => { setExtensionSetting(settings, extension, spec.key, !!event.target.checked); save(); },
        }));
      }
      if (spec.type === "select") {
        return row(spec.label, el("select", {
          "aria-label": `${t(extension.name)}: ${t(spec.label)}`,
          onchange: (event) => { setExtensionSetting(settings, extension, spec.key, event.target.value); save(); },
        }, ...spec.options.map((option) => el("option", { value: option.value, selected: option.value === current }, t(option.label)))));
      }
      return null;
    }).filter(Boolean),
  ]);

  /**
   * Reload POD.INI: the browser keeps no handle on the folder, so it is picked again (the same one or another), and every
   * archive is copied afresh, so a POD rebuilt under the same name is read again.
   */
  const reinstall = async (target) => {
    const [{ pickInstallFolder }, { inspectSource }] = await Promise.all([import("../install/picker.js"), import("../install/inspect-source.js")]);
    const source = await pickInstallFolder();
    if (!source) return;
    const found = await inspectSource(source);
    if (!found.files?.length) { window.alert(t(found.message, ...(found.messageArgs ?? []))); return; }
    const label = target.textContent;
    target.disabled = true;
    const off = context.assets.on("install-progress", ({ copied, total, name }) => {
      target.textContent = t("Copying <<1>> <<2>>%", name, total ? Math.round((copied / total) * 100) : 100);
    });
    try {
      const done = await context.assets.call("reloadInstall", { files: found.files, podIni: found.podIni, exeVersion: found.exeVersion ?? null, weatherArt: found.weatherArt ?? [], force: true });
      const lines = [t("<<1>> archives mounted, in POD.INI order.", done.archives.length)];
      if (done.added.length) lines.push(t("Read again: <<1>>.", done.added.join(", ")));
      if (done.removed.length) lines.push(t("Removed: <<1>>.", done.removed.join(", ")));
      if (found.missing?.length) lines.push(t("Listed but not in the folder: <<1>>.", found.missing.join(", ")));
      window.alert(lines.join("\n"));
      window.location.reload();
    } catch (error) {
      window.alert(t("Could not reload POD.INI: <<1>>", error.message));
      target.textContent = label;
      target.disabled = false;
    } finally {
      off();
    }
  };

  const sections = [
    [msg("Game"), [
      row(msg("Physics"), el("select", { "aria-label": t("Physics"), "data-opt": "Physics", onchange: (event) => { settings.physics = event.target.value; save(); } },
        ...PHYSICS_MODELS.map((m) => el("option", { value: m.id, selected: m.id === physicsModel(settings.physics).id, title: t(m.note) }, t(m.label)))),
      msg("The rules the trucks are driven by, from the next race on. Monster Truck Madness is the 1996 game: tires that touch throw trucks twice as hard, water stops a truck, weather does not change the grip, no crash damage, and its drag rules")),
      toggle(msg("Automatic gears"), "autoShift"), toggle(msg("Crash damage"), "crashDamage", msg("Trucks dent where they are hit")),
      row(msg("Terrain overlap"), el("input", { type: "checkbox", class: "opt-switch", checked: settings.terrainOverlap !== false, "aria-label": t("Terrain overlap"), "data-opt": "Terrain overlap", onchange: (event) => { settings.terrainOverlap = event.target.checked; save(); } }),
        msg("The ground tiles overlap by two pixels, as Monster Truck Madness 2 draws them. Off, they meet edge to edge, as MTM1 draws them. Some HD texture packs need it on. From the next race")),
      toggle(msg("Drag auto stage"), "autoStage", msg("Drag races: the truck drives itself to the staging beams. Off, you stage it yourself; the Auto Stage key (T) then does it for one pass")),
      choose(msg("Speed"), "units", ["MPH", "KPH"], ["mph", "kph"]),
      row(msg("Computer opponents"), el("select", { "aria-label": t("Computer opponents"), "data-opt": "Computer opponents", onchange: (event) => {
        // A new default replaces the list picked on the Races screen.
        settings.defaultOpponents = Number(event.target.value);
        delete settings.opponentTrucks;
        save();
      } }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => el("option", { value: n, selected: n === (settings.defaultOpponents ?? 3) }, String(n)))),
      msg("How many computer trucks race by default; the Races screen picks which")),
      menus,
    ]],
    [msg("Display"), [
      row(msg("Smooth textures"), el("input", {
        type: "checkbox", class: "opt-switch", checked: settings.look === "enhanced", "aria-label": t("Smooth textures"), "data-opt": "Smooth textures",
        onchange: (event) => { settings.look = event.target.checked ? "enhanced" : "classic"; save(); },
      }), msg("Textures filtered smooth and the world lit by the sun (the enhanced look). Off: the game's own sharp texels and baked light")),
      toggle(msg("Lens flare"), "sunFlare", msg("With Smooth textures: the sun's flare across the screen. Off keeps the sun and moon")),
      choose(msg("Detail"), "detailLevel", [msg("Low"), msg("Medium"), msg("High")]),
      row(msg("Anti-aliasing"), el("select", {
        "aria-label": t("Anti-aliasing"), "data-opt": "Anti-aliasing", title: t(AA_HINT),
        onchange: (event) => { settings.aa = event.target.value; save(); },
      }, ...AA_MODES.map((mode) => el("option", { value: mode.id, selected: mode.id === aaChoice(settings.aa) }, t(mode.label)))), AA_HINT),
      // In terrain cells (32 ft each), as the game counts its view; 128 is the standard.
      slider(msg("Draw distance"), { min: 16, max: 256, step: 16, value: Math.min(256, settings.drawCells ?? 128), format: (v) => t("<<1>> cells", v), set: (v) => { settings.drawCells = v; save(); } }),
      toggle(msg("V-sync"), "vsync", msg("Draw with the display's refresh. Off draws as fast as the browser allows; a browser still shows no more frames than the display has")),
      row(msg("Frame rate limit"), el("span", { class: "opt-slider" },
        el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.fpsLimit, "aria-label": t("Frame rate limit"), "data-opt": "Frame rate limit", onchange: (event) => { settings.fpsLimit = event.target.checked; save(); } }),
        el("select", { "aria-label": t("Frame rate limit value"), "data-opt": "Frame rate limit value", onchange: (event) => { settings.fpsLimitValue = Number(event.target.value); save(); } },
          ...[24, 30, 45, 60, 75, 90, 120, 144, 240].map((n) => el("option", { value: n, selected: n === (settings.fpsLimitValue ?? 60) }, `${n} FPS`)))),
      msg("Hold the race to this many frames a second")),
      toggle(msg("FPS counter"), "fpsCounter", msg("Show the frames per second in the corner of a race or replay (the FPS counter key switches it)")),
      toggle(msg("Backdrops"), "backdrops"),
      el("h3", {}, t("Effects")),
      toggle(msg("Tire tracks"), "tireTracks"), toggle(msg("Water splashes"), "waterSplash"),
      // One amount for both pictures (game/tire-effects.js `CLASSIC_DUST`, `RICH_DUST`): Few is the game's own puffs.
      slider(msg("Dust"), {
        min: 0, max: 3, step: 1, value: dustLevel(settings), format: (v) => DUST_LEVEL_NAMES[v],
        set: (v) => { settings.dustAmount = v; settings.dustEffects = v > 0; save(); },
      }),
      // One amount for both pictures (game/tire-effects.js `sparkRules`).
      slider(msg("Sparks"), {
        min: 0, max: 3, step: 1, value: sparkLevel(settings), format: (v) => SPARK_LEVEL_NAMES[v],
        set: (v) => { settings.sparkAmount = v; settings.sparks = v > 0; save(); },
      }),
      // The port's own scenery (docs/VISUALS.md): one preset, and on Custom each part on its own switch.
      el("h3", {}, t("Enhanced graphics")),
      row(msg("Preset"), el("select", {
        "aria-label": t("Enhanced graphics"), "data-opt": "Enhanced graphics", title: t(GRAPHICS_HINT),
        onchange: (event) => {
          settings.graphics = graphicsChoice(event.target.value);
          applyGraphics(settings, hardware);
          showScenery();
          save();
        },
      }, ...GRAPHICS_PRESETS.map((preset) => el("option", { value: preset.id, selected: preset.id === graphicsChoice(settings.graphics) }, t(preset.label)))), GRAPHICS_HINT),
      scenerySwitches,
      sceneryNote,
    ]],
    [msg("Headset"), [headset]],
    [msg("Sound"), [
      sound(msg("Master"), "master"), sound(msg("Effects"), "effects"), sound(msg("Music"), "music"),
      row(msg("Mute"), el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.sound.muted, onchange: (event) => {
        settings.sound = { ...settings.sound, muted: event.target.checked };
        save();
      } })),
      toggle(msg("Menu music"), "menuMusic"),
      row(msg("Announcer voice"), el("input", { type: "checkbox", class: "opt-switch", checked: false, disabled: !VOICE_COMMENTARY_ENABLED }), "Voice commentary is temporarily disabled."),
    ]],
    [msg("Keys"), [note, keyRows, el("div", { class: "opt-actions" }, button(msg("Reset keys"), () => {
      Object.assign(bindings, mergeBindings({})); settings.bindings = {}; save(); note.textContent = t("Keys reset."); showKeys();
    })), choose(msg("Fly-by controls"), "flyControls", FLY_SCHEMES.map((id) => FLY_SCHEME_NAMES[id]), [...FLY_SCHEMES])]],
    [msg("Extensions"), [
      el("p", { class: "muted" }, t("Optional game modes shipped with OpenMTM2. Each extension owns its settings and runtime rules.")),
      ...extensionPanels,
    ]],
    // What a newcomer can leave alone: other games' tracks, the patch's materials, the computer trucks and the cameras.
    [msg("Advanced"), [
      // Each preset sets the draft; Save keeps it.
      el("div", { class: "opt-actions opt-presets" },
        preset(msg("MTM1 Classic preset"), applyMtm1Classic, "Monster Truck Madness 1 as it was: MTM1 sky, trucks apart, original backdrops shown, MTM1 particles and sounds with no dust or sparks, the 1996 physics, no terrain overlap, smooth textures, and the enhanced graphics off. Save to keep it."),
        preset(msg("MTM2 Classic preset"), applyMtm2Classic, "Monster Truck Madness 2 as it was: no MTM1 option, original backdrops, MTM2 classic dust (the game's few puffs), no sparks or water splashes, no CP3 HD weather or reflections, MTM2's water and truck reflections, backdrops, and the enhanced graphics off. Save to keep it."),
        preset(msg("OpenMTM2 preset"), applyOpenMtm2, "The port's own picture: no MTM1 or MTM2 option, tire tracks, water splashes, normal dust puffs and sparks, every enhanced part including the glossy paint, and CP3 terrain detail, HD weather and reflections. Save to keep it.")),
      el("h3", {}, t("Display")),
      // 4x4 Evolution's grass: how far around the camera it is drawn (render/evo-grass.js `GRASS_RADII`).
      slider(msg("Evo grass"), {
        min: 0, max: GRASS_LEVEL_NAMES.length - 1, step: 1, value: grassLevel(settings), format: (v) => GRASS_LEVEL_NAMES[v],
        set: (v) => { settings.evoGrassRange = v; settings.evoGrass = v > 0; save(); },
        title: msg("4x4 Evolution tracks: how far around the camera the grass is drawn, on every tile its .TEX marks for vegetation, pressed down under the trucks. Near is about the game's own. From the next race"),
      }),
      toggle(msg("Ground box grain"), "groundBoxGrain", msg("With Ground detail on: its grain on the ground boxes too, the walls, buildings and signs built of them. Off, they keep their textures plain. From the next race")),
      toggle(msg("No overlap on MTM1 tracks"), "mtm1NoOverlap", msg("With Terrain overlap on: the ground tiles of a Monster Truck Madness 1 track still meet edge to edge, as MTM1 draws them; the other tracks keep the two-pixel overlap. From the next race")),
      toggle(msg("MTM1 particles"), "mtm1Particles", msg("Monster Truck Madness 1's own particles and tracks: single points of the ground's colour thrown by the tires, which mark the ground where they land, and tracks darkened into the ground, in place of the dust, the spray and the tire tracks. From the next race")),
      toggle(msg("Original backdrops"), "originalBackdrops", msg("The game's own backdrops in place of HD ones (Community Patch 3's backdropsHD.pod), wherever an archive still has the original. From the next race")),
      toggle(msg("MTM1 sounds"), "mtm1Sounds", msg("Monster Truck Madness 1's skids from MTM2's SOUND.POD: its corner, wheelspin and brake skids. MTM1's engine is not in MTM2's archives; the engine stays MTM2's")),
      toggle(msg("MTM1 sky"), "mtm1EarthSky", msg("Monster Truck Madness 1's flat sky on every track: an MTM1 track's own, and EARTHSKY on the others, in the weathers without a sky of their own. Needs MTM1's sky files mounted (EARTHSKY.ACT and ALIENSKY.RAW, in MTM1's GAME.POD). From the next race")),
      // MTM2's own two (MONSTER.INI reflectionFlag and truckReflectionFlag), for the game's water and every truck.
      toggle(msg("MTM2 Water reflections"), "waterReflections", msg("MTM2's: the world mirrored in the game's water (\"Reflective water\" has its own). From the next race")),
      toggle(msg("MTM2 Truck reflections"), "truckReflections", msg("MTM2's: the clouds mirrored on the trucks' bodies, or the sky in Rain, Dusk and Night; none in fog or Pitch Black. From the next race")),
      toggle(msg("MTM2 classic dust"), "greyDust", msg("Wheels' dust and collisions' smoke in the game's own grey puff colour, as MTM2 draws them, in place of the port's earth-coloured dust and dark smoke. From the next race")),
      toggle(msg("Evo particles"), "evoParticles", msg("4x4 Evolution tracks: the game's tire debris, in the ground's colour, by surface (gravel, grass, sand, mud, snow) from spinning and sliding tires, and the leaves on Autumn. From the next race")),
      toggle(msg("Evo AI life"), "evoLife", msg("4x4 Evolution tracks: the game's AI life, four flocks of birds that follow the computer drivers' line, circle, land and take off when a truck comes near, as the game's ailife setting. From the next race")),
      toggle(msg("Evo forest"), "evoForest", msg("4x4 Evolution tracks without a vegetation file (the first game's): a forest generated over every tile its .TEX marks for trees, as 4x4 Evolution 2 does, from the track's own tree models. From the next race")),
      toggle(msg("CP3 Terrain detail"), "terrainDetail", msg("Community Patch 3 tracks: detail normals where the track paints a mask, and HD ground normal maps (Enhanced look)")),
      row(msg("CP3 HD weather"), el("input", { type: "checkbox", class: "opt-switch", checked: settings.hdWeather !== false, "aria-label": t("CP3 HD weather"), "data-opt": "CP3 HD weather", onchange: (event) => { settings.hdWeather = event.target.checked; save(); } }),
        msg("Community Patch 3's HD skies for Rain, Dusk and Night and the older levels' clouds: the pictures in the game folder's WeatherArt folder, or the port's own copy of the community's set. Off: the game's own sky art")),
      toggle(msg("CP3 Reflections"), "reflections", msg("Community Patch 3 materials: the sky reflected in glass and paint (Enhanced look)")),
      el("h3", {}, t("Game")),
      row(msg("Opponent frame rate"), el("select", { "aria-label": t("Opponent frame rate"), "data-opt": "Opponent frame rate", onchange: (event) => { settings.opponentFps = Number(event.target.value); save(); } },
        ...[15, 20, 24, 30, 45, 60].map((n) => el("option", { value: n, selected: n === (settings.opponentFps ?? 30) }, `${n} FPS`))),
      msg("The frame rate the computer trucks drive as if the game ran at: they steer by the frame, so it changes how they handle. 30 is the standard")),
      toggle(msg("Keep MTM1 trucks apart"), "mtm1TrucksApart", msg("Monster Truck Madness 1 trucks named like MTM2's (BIGFOOT.TRK and the rest) are listed too, as \"Bigfoot (MTM1)\", and drawn from MTM1's own files. Off, a name goes to the archive mounted first, MTM2's, as in the game")),
      toggle(msg("Sonic trucks"), "sonicTrucks", msg("Professional only: the computer trucks drive as on a Sonic track, on every track")),
      row(msg("Computer drivers"), button(msg("Names..."), () => editDriverNames()), "The names of the computer drivers"),
      toggle(msg("Full Autopilot"), "fullAutopilot", msg("The truck drives itself")),
      // CART Precision Racing's Skill Level (docs/CPR_PHYSICS.md 14.3; game/cpr-driver.js `cprAids`).
      row(msg("CPR skill level"), el("select", { "aria-label": t("CPR skill level"), "data-opt": "CPR skill level", onchange: (event) => { settings.cprSkill = event.target.value; save(); } },
        ...[["rookie", msg("Rookie")], ["intermediate", msg("Intermediate")], ["professional", msg("Professional")]]
          .map(([value, label]) => el("option", { value, selected: (settings.cprSkill ?? "rookie") === value }, t(label)))),
      msg("Under the CART Precision Racing physics, how much the game helps the player's car, as its Driving Aids. Rookie: full grip, Auto-Brake, Stay on track, anti-lock brakes, traction control and Spin Correction. Intermediate: four fifths of the grip, with Stay on track, anti-lock brakes, traction control and Spin Correction. Professional: four fifths of the grip, less still on grass, dirt and rocks, and no aids")),
      toggle(msg("Show hidden tracks"), "showHiddenTracks"),
      toggle(msg("Kooky horn"), "kookyHorn", msg("Three horns instead of one")),
      el("h3", {}, t("Cameras")),
      row(msg("Short camera cycle"), el("span", { class: "opt-slider" },
        el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.shortViewCycle, "aria-label": t("Short camera cycle"), "data-opt": "Short camera cycle", onchange: (event) => { settings.shortViewCycle = event.target.checked; save(); } }),
        button(msg("Views..."), () => editShortViews())),
      msg("The Camera key (V) steps through the views in the list only: the cockpit, Chase Near and Chase Far unless changed")),
      toggle(msg("Camera clearance"), "cameraClearance", msg("The chase camera keeps a few feet over the ground, easing back down after a crest. Off, it may touch the ground, as in the game")),
      toggle(msg("Z-mode cameras"), "zModeCameras", msg("Zoom with Shift and - or +, orbit with Insert and Delete, and the Inertia view, in any race without GOLD mode")),
      toggle(msg("Free look"), "freeLook", msg("On the external cameras the mouse looks round, easing back after two seconds; the wheel zooms either way")),
      toggle(msg("Reverse free look"), "freeLookInvert", msg("The mouse's look turns the other way, up and down and left and right")),
      toggle(msg("Hold free look"), "freeLookHold", msg("A look stays where the mouse leaves it, without easing back")),
      el("h3", {}, t("App")),
      language, wording, offlineRow,
    ]],
    [msg("Data"), [
      el("p", { class: "muted" },
        t("OpenMTM2 reads the tracks and vehicles of Monster Truck Madness 1 and 2, CART Precision Racing and 4x4 Evolution 1 and 2. Add POD.INI reads another game folder's POD.INI and mounts every archive it lists. Reload POD.INI picks the game folder again (or another Monster Truck Madness 2 folder) and reads every archive its POD.INI lists afresh, in its order. The POD manager shows what is mounted, and adds single POD files from any game without the game being installed.")),
      el("div", { class: "opt-actions opt-data" },
        button(msg("Add POD.INI"), async (event) => {
          const target = event.currentTarget;
          const [{ pickInstallFolder }, { inspectGameFolder }] = await Promise.all([import("../install/picker.js"), import("../install/inspect-source.js")]);
          const source = await pickInstallFolder();
          if (!source) return;
          const found = await inspectGameFolder(source);
          if (!found.ok) { window.alert(t(found.message, ...(found.messageArgs ?? []))); return; }
          const label = target.textContent;
          target.disabled = true;
          const off = context.assets.on("install-progress", ({ copied, total, name }) => {
            target.textContent = t("Copying <<1>> <<2>>%", name, total ? Math.round((copied / total) * 100) : 100);
          });
          try {
            const done = await context.assets.call("addGameFolder", { label: found.label, files: found.files });
            const lines = [done.game ? t("<<1>> archives added from <<2>> (<<3>>).", done.added.length, found.label, done.game) : t("<<1>> archives added from <<2>>.", done.added.length, found.label)];
            if (found.missing?.length) lines.push(t("Listed but not in the folder: <<1>>.", found.missing.join(", ")));
            window.alert(lines.join("\n"));
            window.location.reload();
          } catch (error) {
            window.alert(t("Could not add the folder: <<1>>", error.message));
            target.textContent = label;
            target.disabled = false;
          } finally {
            off();
          }
        }, null, msg("Pick another game's folder: its POD.INI is read and every archive it lists is added beside the base install")),
        button(msg("Reload POD.INI"), (event) => reinstall(event.currentTarget), null,
          msg("Pick the Monster Truck Madness 2 folder again, or another one: its POD.INI is read and every archive it lists is copied again, changed or not, and mounted in the file's order"))),
      el("h3", {}, t("POD mounting")),
      el("div", { class: "opt-actions opt-data" },
        button(msg("POD manager"), async () => { (await import("./pod-manager.js")).openPodManager(context); })),
      el("h3", {}, t("Settings")),
      el("div", { class: "opt-actions opt-data" },
        button(msg("Export settings"), () => exportOptions()),
        button(msg("Import settings"), () => importOptions())),
      el("div", { class: "opt-actions opt-data" },
        el("button", { class: "danger", onclick: async (event) => {
          if (!window.confirm(t("Clear all OpenMTM2 data from this browser? This permanently removes the copied install, drivers, Hall of Fame entries and settings."))) return;
          event.currentTarget.disabled = true;
          try {
            // The copy of the app goes too; a page that is opened again with a server makes a new one.
            await context.offline?.remove();
            await context.assets.call("clearGameData");
            clearSettings();
            window.location.reload();
          } catch (error) {
            event.currentTarget.disabled = false;
            window.alert(t("Could not clear the browser data: <<1>>", error.message));
          }
        } }, t("Clear browser game data"))),
    ]],
  ];
  // One category at a time, chosen from the tabs; the last one shown is remembered for the session.
  const pages = sections.map(([, rows]) => el("div", { class: "opt-page" }, ...rows));
  const tabs = sections.map(([name], i) => el("button", { class: "opt-tab", onclick: () => pick(i) }, t(name)));
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
      "Enhanced graphics": () => graphicsChoice(settings.graphics), "Terrain overlap": () => settings.terrainOverlap !== false,
      "CP3 HD weather": () => settings.hdWeather !== false, "Dust": () => dustLevel(settings), "Sparks": () => sparkLevel(settings), "Evo grass": () => grassLevel(settings),
    };
    // A slider's figure beside it, in its own words.
    const named = { "Dust": DUST_LEVEL_NAMES, "Sparks": SPARK_LEVEL_NAMES, "Evo grass": GRASS_LEVEL_NAMES };
    for (const control of container.querySelectorAll("input[data-opt], select[data-opt]")) {
      const label = control.getAttribute("data-opt");
      const value = toggleKeys.has(label) ? !!settings[toggleKeys.get(label)] : shown[label]?.();
      if (value === undefined) continue;
      if (control.type === "checkbox") control.checked = !!value; else control.value = String(value);
      if (control.type === "range" && named[label] && control.nextElementSibling) control.nextElementSibling.textContent = t(named[label][value]);
    }
    showScenery();
  }

  container.append(
    el("div", { class: "opt-tabs" }, ...tabs),
    el("div", { class: "opt-pages" }, ...pages),
    el("div", { class: "options-footer" }, navButtons, saveButton,
      el("button", { class: "primary", onclick: close }, t("Close"))),
  );

  const onChange = (event) => {
    const which = event.target?.getAttribute?.("data-opt");
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
