/* Shared contents of the Options screen and the Options modal opened from every menu screen. */
import { buildKind, defaultSkin } from "../install/exe-version.js";
import { el } from "./dom.js";
import { clearSettings, saveSettings } from "../app/settings.js";
import { loadStrings } from "../app/strings-store.js";
import { locName } from "../game/strings.js";
import { ACTIONS, DEFAULT_BINDINGS, codeLabel, conflictFor, mergeBindings } from "../game/input/bindings.js";
import { VOICE_COMMENTARY_ENABLED } from "../audio/commentary-audio.js";

export async function mountOptionsPanel(container, context, { close = () => {} } = {}) {
  const { settings } = context;
  const save = () => saveSettings(settings);
  const bindings = mergeBindings(settings.bindings);
  const note = el("p", { class: "muted" }, "Pick an action, then press the key to use for it. Escape cancels.");
  let listening = null;
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
    }
    showKeys();
  };
  window.addEventListener("keydown", onKey);

  // Every option is one row of the same height: its name on the left, its control on the right.
  const row = (label, control, title = null) => el("label", { class: "opt-row", title }, el("span", { class: "opt-label" }, label), el("span", { class: "opt-control" }, control));
  const toggle = (label, key, title = null) => row(label, el("input", {
    type: "checkbox", class: "opt-switch", checked: !!settings[key], "aria-label": label,
    onchange: (event) => { settings[key] = event.target.checked; save(); context.menuMusic?.refresh(); },
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
    set: (v) => { settings.sound = { ...settings.sound, [key]: v }; save(); context.menuAudio?.setVolumes(settings.sound); context.menuMusic?.refresh(); },
  });

  const locFiles = await context.assets.call("locFiles").catch(() => []);
  const wording = row("Wording", el("select", { "aria-label": "Wording" },
    el("option", { value: "", selected: !settings.wording }, "Standard"),
    ...locFiles.map(({ path }) => el("option", { value: path, selected: path === settings.wording }, locName(path)))));
  const kind = { retail: "retail", beta: "beta", patch: "community patch", unknown: "build not read" }[buildKind(context.exeVersion)];
  const menus = row("Menus", el("select", { "aria-label": "Menus", onchange: (event) => { settings.skin = event.target.value; save(); } },
    ...[["auto", `Automatic (${defaultSkin(context.exeVersion) === "classic" ? "classic" : "modern"})`], ["classic", "Classic (game art)"], ["modern", "Modern"]]
      .map(([value, text]) => el("option", { value, selected: (settings.skin ?? "auto") === value }, text))),
    `MONSTER.EXE ${context.exeVersion ?? "(not found)"}, ${kind}.`);
  const button = (label, onclick, cls = null) => el("button", { class: cls, "data-menu-sound": "STARTOFF", onclick }, label);

  const sections = [
    ["Game", [
      toggle("Automatic gears", "autoShift"), toggle("Crash damage (dents)", "crashDamage"),
      toggle("Full Autopilot", "fullAutopilot", "The truck drives itself"), toggle("Show hidden tracks", "showHiddenTracks"),
      toggle("Kooky horn", "kookyHorn", "Three horns instead of one"), choose("Speed", "units", ["MPH", "KPH"], ["mph", "kph"]),
      row("Announcer voice", el("input", { type: "checkbox", class: "opt-switch", checked: false, disabled: !VOICE_COMMENTARY_ENABLED }), "Voice commentary is temporarily disabled."),
    ]],
    ["Display", [
      choose("Look", "look", ["Classic", "Enhanced"], ["classic", "enhanced"]), choose("Detail", "detailLevel", ["Low", "Medium", "High"]),
      slider("Draw distance", { min: 1000, max: 20000, step: 500, value: settings.drawDistance ?? 20000, format: (v) => `${v} ft`, set: (v) => { settings.drawDistance = v; save(); } }),
      toggle("Track backdrops", "backdrops"), menus, wording,
    ]],
    ["Effects", [
      toggle("Dust", "dustEffects"), toggle("Tire tracks", "tireTracks"), toggle("Sparks", "sparks"), toggle("Water splashes", "waterSplash"),
    ]],
    ["Sound", [
      sound("Master", "master"), sound("Effects", "effects"), sound("Music", "music"),
      row("Mute", el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.sound.muted, onchange: (event) => {
        settings.sound = { ...settings.sound, muted: event.target.checked };
        save(); context.menuAudio?.setVolumes(settings.sound); context.menuMusic?.refresh();
      } })),
      toggle("Menu music", "menuMusic"),
    ]],
    ["Keys", [note, keyRows, el("div", { class: "opt-actions" }, button("Reset keys", () => {
      Object.assign(bindings, mergeBindings({})); settings.bindings = {}; save(); note.textContent = "Keys reset."; showKeys();
    }))]],
    ["Data", [el("div", { class: "opt-actions opt-data" },
      button("Hall Of Fame", async () => { close(); await context.router.go("hall"); }),
      button("Open replay (.rpl)", async () => {
        const { pickReplayFile } = await import("./screens/replay.js");
        const replay = await pickReplayFile();
        if (!replay) { window.alert("That file is not a Monster Truck Madness 2 replay."); return; }
        close();
        await context.router.go("replay", { replay });
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
      } }, "Clear browser game data"))]],
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
    el("div", { class: "options-footer" }, el("button", { class: "primary", onclick: close }, "Close")),
  );

  const onChange = (event) => {
    const which = event.target?.getAttribute?.("aria-label");
    if (which === "Wording") {
      settings.wording = event.target.value;
      save();
      loadStrings(context);
    } else if (which === "Menus") {
      close();
      const current = context.router.stack.at(-1);
      if (current) context.router.go(current.name, current.params, { replace: true });
    }
  };
  container.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("keydown", onKey);
    container.removeEventListener("change", onChange);
  };
}
