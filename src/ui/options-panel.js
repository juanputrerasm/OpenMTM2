/* Shared contents of the Options screen and the Options modal opened from every menu screen. */
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

  const toggle = (label, key) => el("label", {}, el("input", {
    type: "checkbox", checked: !!settings[key],
    onchange: (event) => { settings[key] = event.target.checked; save(); context.menuMusic?.refresh(); },
  }), ` ${label}`);
  const choose = (label, key, names, values = names.map((_, index) => index)) => el("label", {}, `${label} `,
    el("select", { "aria-label": label, onchange: (event) => {
      settings[key] = typeof values[0] === "number" ? Number(event.target.value) : event.target.value;
      save();
    } }, ...names.map((name, index) => el("option", { value: values[index], selected: values[index] === settings[key] }, name))));

  const locFiles = await context.assets.call("locFiles").catch(() => []);
  const wording = el("label", {}, "Wording ", el("select", { "aria-label": "Wording" },
    el("option", { value: "", selected: !settings.wording }, "Standard"),
    ...locFiles.map(({ path }) => el("option", { value: path, selected: path === settings.wording }, locName(path)))));
  const sound = (label, key) => el("label", {}, `${label} `, el("input", {
    type: "range", min: 0, max: 1, step: 0.05, value: settings.sound[key], "aria-label": label,
    oninput: (event) => {
      settings.sound = { ...settings.sound, [key]: Number(event.target.value) };
      save(); context.menuAudio?.setVolumes(settings.sound); context.menuMusic?.refresh();
    },
  }));

  container.append(
    el("h2", {}, "Keys"), note, keyRows,
    el("div", { class: "screen-actions" }, el("button", {
      onclick: () => { Object.assign(bindings, mergeBindings({})); settings.bindings = {}; save(); note.textContent = "Keys reset."; showKeys(); },
    }, "Reset keys")),
    el("h2", {}, "Game"),
    el("div", { class: "form-row" },
      toggle("Automatic gears", "autoShift"), toggle("Full Autopilot (the truck drives itself)", "fullAutopilot"),
      toggle("Show hidden tracks", "showHiddenTracks"),
      toggle("Kooky horn (three horns)", "kookyHorn"), toggle("Menu music", "menuMusic"),
      el("label", { title: "Voice commentary is temporarily disabled." },
        el("input", { type: "checkbox", checked: false, disabled: !VOICE_COMMENTARY_ENABLED }), " Announcer voice (temporarily disabled)")),
    el("div", { class: "form-row" },
      choose("Look", "look", ["Classic", "Enhanced"], ["classic", "enhanced"]),
      choose("Detail", "detailLevel", ["Low", "Medium", "High"]),
      choose("Speed", "units", ["MPH", "KPH"], ["mph", "kph"]),
      choose("Menus", "skin", ["Classic (game art)", "Modern"], ["classic", "modern"]), wording),
    el("h2", {}, "Sound"),
    el("div", { class: "form-row" }, sound("Master", "master"), sound("Effects", "effects"), sound("Music", "music"),
      el("label", {}, el("input", {
        type: "checkbox", checked: !!settings.sound.muted,
        onchange: (event) => {
          settings.sound = { ...settings.sound, muted: event.target.checked };
          save(); context.menuAudio?.setVolumes(settings.sound); context.menuMusic?.refresh();
        },
      }), " Mute")),
    el("div", { class: "options-footer" },
      el("button", {
        "data-menu-sound": "STARTOFF", onclick: async () => { close(); await context.router.go("hall"); },
      }, "Hall Of Fame"),
      el("button", { "data-menu-sound": "STARTOFF", onclick: async () => {
        close(); await context.assets.call("uninstall"); await context.router.go("install", {}, { replace: true });
      } }, "Use a different install"),
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
      } }, "Clear browser game data"),
      el("button", { class: "primary", onclick: close }, "Close")),
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
