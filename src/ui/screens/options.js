/*
  Options: key bindings and the game's switches (look, detail, automatic gears, Full Autopilot,
  hidden tracks and trucks). Saved in the browser's local storage as they change.
*/
import { el } from "../dom.js";
import { saveSettings } from "../../app/settings.js";
import { frame } from "../frame.js";
import { loadStrings } from "../../app/strings-store.js";
import { locName } from "../../game/strings.js";
import { ACTIONS, DEFAULT_BINDINGS, codeLabel, conflictFor, mergeBindings } from "../../game/input/bindings.js";

export default async function mount(container, context) {
  const { settings } = context;
  const save = () => saveSettings(settings);
  const bindings = mergeBindings(settings.bindings);
  const note = el("p", { class: "muted" }, "Pick an action, then press the key to use for it. Escape cancels.");
  let listening = null;

  const keyRows = el("div", { class: "bindings" });
  const showKeys = () => keyRows.replaceChildren(...ACTIONS.map((a) => el("div", { class: "form-row" },
    el("span", { class: "binding-label" }, context.t(a.label)),
    el("button", {
      class: listening === a.id ? "pick selected" : "pick",
      onclick: () => { listening = a.id; note.textContent = `Press a key for "${a.label}"…`; showKeys(); },
    }, listening === a.id ? "…" : bindings[a.id].map(codeLabel).join(" / ")))));
  showKeys();

  const onKey = (e) => {
    if (!listening) return;
    e.preventDefault();
    const action = listening;
    listening = null;
    if (e.code !== "Escape") {
      const other = conflictFor(bindings, e.code, action);
      if (other) bindings[other] = bindings[other].filter((c) => c !== e.code);
      if (other && !bindings[other].length) bindings[other] = [...DEFAULT_BINDINGS[other]].filter((c) => c !== e.code);
      bindings[action] = [e.code];
      settings.bindings = { ...bindings };
      save();
      note.textContent = `${ACTIONS.find((a) => a.id === action).label}: ${codeLabel(e.code)}.`;
    } else {
      note.textContent = "Cancelled.";
    }
    showKeys();
  };
  window.addEventListener("keydown", onKey);

  const toggle = (label, key) => el("label", {}, el("input", {
    type: "checkbox", checked: !!settings[key],
    onchange: (e) => { settings[key] = e.target.checked; save(); context.menuMusic?.refresh(); },
  }), ` ${label}`);
  const choose = (label, key, names, values = names.map((_, i) => i)) => el("label", {}, `${label} `,
    el("select", { "aria-label": label, onchange: (e) => { settings[key] = typeof values[0] === "number" ? Number(e.target.value) : e.target.value; save(); } },
      ...names.map((name, i) => el("option", { value: values[i], selected: values[i] === settings[key] }, name))));

  const locFiles = await context.assets.call("locFiles").catch(() => []);
  const wording = el("label", {}, "Wording ", el("select", { "aria-label": "Wording" },
    el("option", { value: "", selected: !settings.wording }, "Standard"),
    ...locFiles.map(({ path }) => el("option", { value: path, selected: path === settings.wording }, locName(path)))));
  const sound = (label, key) => el("label", {}, `${label} `, el("input", {
    type: "range", min: 0, max: 1, step: 0.05, value: settings.sound[key], "aria-label": label,
    oninput: (e) => { settings.sound = { ...settings.sound, [key]: Number(e.target.value) }; save(); context.menuAudio?.setVolumes(settings.sound); context.menuMusic?.refresh(); },
  }));
  const ui = await frame(container, context, { title: "Options", backdrop: "BLANK", bar: "none", regions: { main: [20, 16, 600, 448] } });
  ui.regions.main.append(
    el("h2", {}, "Keys"), note, keyRows,
    el("div", { class: "screen-actions" }, el("button", {
      onclick: () => { Object.assign(bindings, mergeBindings({})); settings.bindings = {}; save(); note.textContent = "Keys reset."; showKeys(); },
    }, "Reset keys")),
    el("h2", {}, "Game"),
    el("div", { class: "form-row" },
      toggle("Automatic gears", "autoShift"),
      toggle("Full Autopilot (the truck drives itself)", "fullAutopilot"),
      toggle("Show hidden tracks", "showHiddenTracks"),
      toggle("Show hidden trucks", "showHiddenTrucks"),
      toggle("Developer views on the Start screen", "developer"),
      toggle("Kooky horn (three horns)", "kookyHorn"),
      toggle("Menu music", "menuMusic"),
      toggle("Announcer voice", "commentary"),
      toggle("Announcer text", "textCommentary")),
    el("div", { class: "form-row" },
      choose("Look", "look", ["Classic", "Enhanced"], ["classic", "enhanced"]),
      choose("Detail", "detailLevel", ["Low", "Medium", "High"]),
      choose("Menus", "skin", ["Classic (game art)", "Modern"], ["classic", "modern"]), wording),
    el("h2", {}, "Sound"),
    el("div", { class: "form-row" },
      sound("Master", "master"), sound("Effects", "effects"), sound("Music", "music"),
      el("label", {}, el("input", {
        type: "checkbox", checked: !!settings.sound.muted,
        onchange: (e) => { settings.sound = { ...settings.sound, muted: e.target.checked }; save(); context.menuAudio?.setVolumes(settings.sound); context.menuMusic?.refresh(); },
      }), " Mute")),
    el("div", { class: "screen-actions" }, el("button", { class: "primary", onclick: () => context.router.back() }, "Back")));
  // A changed skin shows at once.
  ui.regions.main.addEventListener("change", (e) => {
    const which = e.target?.getAttribute?.("aria-label");
    if (which === "Wording") {
      settings.wording = e.target.value;
      save();
      loadStrings(context).then(() => context.router.go("options", {}, { replace: true }));
    } else if (which === "Menus") {
      context.router.go("options", {}, { replace: true });
    }
  });
  return { unmount: () => { window.removeEventListener("keydown", onKey); ui.unmount?.(); } };
}
