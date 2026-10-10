/* Shared contents of the Options screen and the Options modal opened from every menu screen. */
import { buildKind, defaultSkin } from "../install/exe-version.js";
import { el } from "./dom.js";
import { clearSettings, saveSettings } from "../app/settings.js";
import { loadStrings } from "../app/strings-store.js";
import { locName } from "../game/strings.js";
import { ACTIONS, DEFAULT_BINDINGS, codeLabel, conflictFor, mergeBindings } from "../game/input/bindings.js";
import { VOICE_COMMENTARY_ENABLED } from "../audio/commentary-audio.js";

/*
  The controls edit a draft. Apply puts it to use at once (this session), Save also stores it, and Close asks whether to
  save or discard when the draft differs from what is stored.
*/
export async function mountOptionsPanel(container, context, { close: closeNow = () => {} } = {}) {
  const live = context.settings;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  /** What is stored, and the draft the controls change. */
  let stored = JSON.stringify(live);
  const settings = copy(live);
  const footerNote = el("span", { class: "options-status muted" });
  const unsaved = () => JSON.stringify(settings) !== stored;
  const save = () => { footerNote.textContent = unsaved() ? "Changes not saved" : ""; };
  /** Put a settings object to use: the live settings keep their identity, since every screen holds them. */
  const use = (next) => {
    const before = copy(live);
    for (const key of Object.keys(live)) delete live[key];
    Object.assign(live, copy(next));
    context.menuAudio?.setVolumes(live.sound);
    context.menuMusic?.refresh();
    if (before.wording !== live.wording) loadStrings(context);
    // A new menu skin redraws the screen under the dialog (not a race, which would start again).
    const current = context.router.stack.at(-1);
    if ((before.skin ?? "auto") !== (live.skin ?? "auto") && current && !["race", "replay"].includes(current.name)) {
      context.router.go(current.name, current.params, { replace: true });
    }
  };
  const apply = () => { use(settings); footerNote.textContent = unsaved() ? "Applied, not saved" : ""; };
  const store = () => { use(settings); saveSettings(live); stored = JSON.stringify(live); footerNote.textContent = "Saved"; };
  /** Close, asking first when there are changes: save them, or go back to what was stored. */
  const close = () => {
    if (unsaved() || JSON.stringify(live) !== stored) {
      if (window.confirm("Save the changes to the options?\n\nOK saves them. Cancel discards them.")) store();
      else use(JSON.parse(stored));
    }
    closeNow();
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
  const toggle = (label, key, title = null) => row(label, el("input", {
    type: "checkbox", class: "opt-switch", checked: !!settings[key], "aria-label": label,
    onchange: (event) => { settings[key] = event.target.checked; save(); },
  }), title);
  const choose = (label, key, names, values = names.map((_, index) => index)) => row(label,
    el("select", { "aria-label": label, onchange: (event) => {
      settings[key] = typeof values[0] === "number" ? Number(event.target.value) : event.target.value;
      save();
    } }, ...names.map((name, index) => el("option", { value: values[index], selected: values[index] === settings[key] }, name))));
  const slider = (label, { min, max, step, value, format, set }) => {
    const out = el("output", { class: "opt-value" }, format(value));
    return row(label, el("span", { class: "opt-slider" }, el("input", {
      type: "range", min, max, step, value, "aria-label": label,
      oninput: (event) => { const v = Number(event.target.value); out.textContent = format(v); set(v); },
    }), out));
  };
  const percent = (v) => `${Math.round(v * 100)}%`;
  const sound = (label, key) => slider(label, {
    min: 0, max: 1, step: 0.05, value: settings.sound[key], format: percent,
    set: (v) => { settings.sound = { ...settings.sound, [key]: v }; save(); },
  });

  const locFiles = await context.assets.call("locFiles").catch(() => []);
  const wording = row("Localization", el("select", { "aria-label": "Wording" },
    el("option", { value: "", selected: !settings.wording }, "Standard"),
    ...locFiles.map(({ path }) => el("option", { value: path, selected: path === settings.wording }, locName(path)))));
  const kind = { retail: "retail", beta: "beta", patch: "community patch", unknown: "build not read" }[buildKind(context.exeVersion)];
  const menus = row("UI", el("select", { "aria-label": "Menus", onchange: (event) => { settings.skin = event.target.value; save(); } },
    ...[["auto", `Automatic (${defaultSkin(context.exeVersion) === "classic" ? "classic" : "modern"})`], ["classic", "Classic (game art)"], ["modern", "Modern"]]
      .map(([value, text]) => el("option", { value, selected: (settings.skin ?? "auto") === value }, text))),
    `MONSTER.EXE ${context.exeVersion ?? "(not found)"}, ${kind}.`);
  const button = (label, onclick, cls = null) => el("button", { class: cls, "data-menu-sound": "STARTOFF", onclick }, label);

  const sections = [
    ["Game", [
      toggle("Automatic gears", "autoShift"), toggle("Crash damage (dents)", "crashDamage"),
      toggle("Full Autopilot", "fullAutopilot", "The truck drives itself"),
      toggle("Short camera cycle", "shortViewCycle", "The Camera key (V) steps through the cockpit, Chase Near and Chase Far only"),
      toggle("Z-mode cameras", "zModeCameras", "Zoom with - and +, orbit with Insert and Delete, and the Inertia view, in any race without GOLD mode"), toggle("Show hidden tracks", "showHiddenTracks"),
      toggle("Kooky horn", "kookyHorn", "Three horns instead of one"), choose("Speed", "units", ["MPH", "KPH"], ["mph", "kph"]),
      row("Computer opponents", el("select", { "aria-label": "Computer opponents", onchange: (event) => {
        // A new default replaces the list picked on the Races screen.
        settings.defaultOpponents = Number(event.target.value);
        delete settings.opponentTrucks;
        save();
      } }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => el("option", { value: n, selected: n === (settings.defaultOpponents ?? 3) }, String(n)))),
      "How many computer trucks race by default; the Races screen picks which"),
      row("Opponent frame rate", el("select", { "aria-label": "Opponent frame rate", onchange: (event) => { settings.opponentFps = Number(event.target.value); save(); } },
        ...[15, 20, 24, 30, 45, 60].map((n) => el("option", { value: n, selected: n === (settings.opponentFps ?? 30) }, `${n} FPS`))),
      "The frame rate the computer trucks drive as if the game ran at: they steer by the frame, so it changes how they handle. 30 is the standard"),
      toggle("Sonic trucks", "sonicTrucks", "Professional only: the computer trucks drive as on a Sonic track, on every track"),
      row("Announcer voice", el("input", { type: "checkbox", class: "opt-switch", checked: false, disabled: !VOICE_COMMENTARY_ENABLED }), "Voice commentary is temporarily disabled."),
      el("div", { class: "opt-actions" },
        button("Hall of Fame", async () => { close(); await context.router.go("hall"); }),
        button("Instant Replay", async () => {
          const { pickReplayFile } = await import("./screens/replay.js");
          const replay = await pickReplayFile();
          if (!replay) { window.alert("That file is not a Monster Truck Madness 2 replay."); return; }
          close();
          await context.router.go("replay", { replay });
        }),
        button("Start screen", async () => { close(); await context.router.go("start", {}, { replace: true }); })),
    ]],
    ["Display", [
      choose("Look", "look", ["Classic", "Enhanced"], ["classic", "enhanced"]), choose("Detail", "detailLevel", ["Low", "Medium", "High"]),
      // In terrain cells (32 ft each), as the game counts its view; 128 is the standard.
      slider("Draw distance", { min: 16, max: 256, step: 16, value: Math.min(256, settings.drawCells ?? 128), format: (v) => `${v} cells`, set: (v) => { settings.drawCells = v; save(); } }),
      toggle("V-sync", "vsync", "Draw with the display's refresh. Off draws as fast as the browser allows; a browser still shows no more frames than the display has"),
      row("Frame rate limit", el("span", { class: "opt-slider" },
        el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.fpsLimit, "aria-label": "Frame rate limit", onchange: (event) => { settings.fpsLimit = event.target.checked; save(); } }),
        el("select", { "aria-label": "Frame rate limit value", onchange: (event) => { settings.fpsLimitValue = Number(event.target.value); save(); } },
          ...[24, 30, 45, 60, 75, 90, 120, 144, 240].map((n) => el("option", { value: n, selected: n === (settings.fpsLimitValue ?? 60) }, `${n} FPS`)))),
      "Hold the race to this many frames a second"),
      toggle("Backdrops", "backdrops"),
      toggle("MTM1 sky", "mtm1EarthSky", "Monster Truck Madness 1 tracks: the track's own flat sky (EARTHSKY) in place of MTM2's"),
      toggle("MTM1 terrain overlap", "mtm1TerrainOverlap", "Monster Truck Madness 1 tracks: overlap the ground tiles by two pixels, as MTM2 does"),
      toggle("CP3 Terrain detail", "terrainDetail", "Community Patch 3 tracks: detail normals where the track paints a mask, and HD ground normal maps (Enhanced look)"),
      toggle("CP3 Reflections", "reflections", "Community Patch 3 materials: the sky reflected in glass and paint (Enhanced look)"),
      menus, wording,
    ]],
    ["Effects", [
      toggle("Dust", "dustEffects"), toggle("Tire tracks", "tireTracks"), toggle("Sparks", "sparks"), toggle("Water splashes", "waterSplash"),
    ]],
    ["Sound", [
      sound("Master", "master"), sound("Effects", "effects"), sound("Music", "music"),
      row("Mute", el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.sound.muted, onchange: (event) => {
        settings.sound = { ...settings.sound, muted: event.target.checked };
        save();
      } })),
      toggle("Menu music", "menuMusic"),
    ]],
    ["Keys", [note, keyRows, el("div", { class: "opt-actions" }, button("Reset keys", () => {
      Object.assign(bindings, mergeBindings({})); settings.bindings = {}; save(); note.textContent = "Keys reset."; showKeys();
    }))]],
    ["Data", [
      el("p", { class: "muted" },
        "OpenMTM2 reads Monster Truck Madness 2, CART Precision Racing and 4x4 Evolution 1 and 2 tracks, and their vehicles in the future. "
        + "Add game folder reads the folder's POD.INI and mounts every archive it lists. "
        + "The POD manager shows what is mounted, and adds single POD files from any game without the game being installed."),
      el("div", { class: "opt-actions opt-data" },
      button("Add game folder", async (event) => {
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
      }),
      button("POD manager", async () => { (await import("./pod-manager.js")).openPodManager(context); }),
      button("Reload POD.INI", async (event) => {
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
          const done = await context.assets.call("reloadInstall", { files: found.files, podIni: found.podIni, exeVersion: found.exeVersion ?? null });
          const lines = [`${done.archives.length} archives mounted, in POD.INI order.`];
          if (done.added.length) lines.push(`Copied: ${done.added.join(", ")}.`);
          if (done.removed.length) lines.push(`Removed: ${done.removed.join(", ")}.`);
          if (found.missing?.length) lines.push(`Listed but not in the folder: ${found.missing.join(", ")}.`);
          window.alert(lines.join("\n"));
          window.location.reload();
        } catch (error) {
          window.alert(`Could not reload POD.INI: ${error.message}`);
          target.textContent = label;
          target.disabled = false;
        } finally {
          off();
        }
      }),
      button("Use a different install", async () => { close(); await context.assets.call("uninstall"); await context.router.go("install", {}, { replace: true }); }),
      el("button", { class: "danger", onclick: async (event) => {
        if (!window.confirm(
          "Clear all OpenMTM2 data from this browser? This permanently removes the copied install, "
          + "drivers, Hall of Fame entries and settings.",
        )) return;
        event.currentTarget.disabled = true;
        try {
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
  container.append(
    el("div", { class: "opt-tabs" }, ...tabs),
    el("div", { class: "opt-pages" }, ...pages),
    el("div", { class: "options-footer" }, footerNote,
      el("button", { onclick: apply, title: "Use the changes now, without storing them" }, "Apply"),
      el("button", { onclick: store, title: "Use the changes and store them" }, "Save"),
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
  };
  /** For the dialog's own ways out (Escape, a click outside): the same question as the Close button. */
  cleanup.requestClose = () => { if (performance.now() - escapeAt > 200) close(); };
  return cleanup;
}
