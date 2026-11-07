/* Shared contents of the Options screen and the Options modal opened from every menu screen. */
import { DUST_LEVEL_NAMES, SPARK_LEVEL_NAMES, dustLevel, sparkLevel } from "../game/tire-effects.js";
import { GRASS_LEVEL_NAMES, grassLevel } from "../render/evo-grass.js";
import { FLY_SCHEMES, FLY_SCHEME_NAMES } from "../game/fly-camera.js";
import { buildKind, defaultSkin } from "../install/exe-version.js";
import { el } from "./dom.js";
import { showAlert, showConfirm } from "./dialogs.js";
import { fullscreenButton } from "./display-mode.js";
import { AI_BEHAVIOURS, LANGUAGES, PHYSICS_MODELS, applyMtm1Classic, applyMtm2Classic, applyOpenMtm2, clearSettings, languageOf, optionsFile, physicsModel, readOptionsFile, saveSettings } from "../app/settings.js";
import { offlineStatusText } from "../app/offline.js";
import { loadStrings } from "../app/strings-store.js";
import { locName, msg } from "../game/strings.js";
import { chatSettings, setMuted, soloChatOn } from "../game/chat.js";
import { ACTIONS, DEFAULT_BINDINGS, codeLabel, conflictFor, mergeBindings } from "../game/input/bindings.js";
import { PAD_PEDALS, choosePad, testRumble } from "../game/input/gamepad.js";
import { PAD_ACTIONS, bindPadButton, mergePadBindings, newPress, padButtonLabel } from "../game/input/pad-bindings.js";
import { TOUCH_MODES } from "../game/input/touch.js";

/** The Rumble effects slider's steps (game/input/rumble.js RUMBLE_LEVELS). */
const RUMBLE_LEVEL_NAMES = [msg("Hits"), msg("Hits + ground"), msg("All")];
import { CAB_STYLES, VIEW_DISTANCES, VR_VIEWS, vrSettings } from "../game/vr/settings.js";
import { AA_HINT, AA_MODES, aaChoice } from "../game/aa.js";
import { GRAPHICS_HINT, GRAPHICS_PRESETS, applyGraphics, detectGraphics, graphicsChoice, graphicsLabel } from "../game/graphics.js";
import { graphicsHardware } from "../app/graphics-hardware.js";
import { VISUAL_OPTIONS } from "../game/visuals.js";
import { CPU_NAMES, CPU_NAME_MAX, cpuNames } from "../game/race-setup.js";
import { CAMERA_SYSTEMS, FOV_ACROSS_MAX, FOV_ACROSS_MIN, GAME_FOV_ACROSS_DEG, SHORT_VIEW_CHOICES, shortViews } from "../game/cameras.js";
import { EXTENSIONS, REPAIR_CHOICES, setExtensionSetting, settingsForExtension } from "../game/extensions/loader.js";
import { FPS_LIMITS } from "../render/frame-limit.js";
import { MAP_LINE_MAX, MAP_LINE_MIN, MAP_TRANSPARENCY_MAX, mapLineScale, mapTransparency } from "../render/minimap.js";
import { NAME_TRANSPARENCY_MAX, nameTransparency } from "../render/name-tag-style.js";
import { useSystemFont } from "../render/bitmap-text.js";
import { AI_SPEED, aiSpeedPercent, effectiveAiSpeed } from "../game/ai-speed.js";

/*
  The controls edit a draft. Save puts it to use and stores it; Close warns first when the draft differs from what is
  stored, and then leaves without it.

  Labels are English tags (game/strings.js), shown through `t`. A control keeps its tag in `data-opt`, which is how
  `showDraft` finds it again in any language.
*/
export async function mountOptionsPanel(container, context, { close: closeNow = () => {}, tab = null, extension: onlyExtension = null } = {}) {
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
  /** Close, warning first when there are changes: they are lost unless the player stays to save them. Resolves to whether it closed. */
  const close = async () => {
    if (unsaved() && !await showConfirm(t, t("The changes to the options are not saved.\n\nOK closes without them. Cancel goes back to save them."))) return false;
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

  // The gamepad's buttons (game/input/pad-bindings.js): pick an action, then press a button on the pad; Escape or a
  // wait of PAD_WAIT_MS cancels. While waiting the pad does nothing else (ui/gamepad-nav.js `context.padCapture`).
  const PAD_WAIT_MS = 8000;
  const padNote = el("p", { class: "muted" }, t("The left stick steers and the triggers or the left stick work the pedals (Gamepad pedals). Pick an action, then press the gamepad button to use for it."));
  const padRows = el("div", { class: "bindings" });
  let padListening = null, padFrame = 0;
  const padButtons = () => {
    const pad = choosePad(navigator.getGamepads ? [...navigator.getGamepads()] : []);
    return pad ? pad.buttons.map((b) => !!b?.pressed) : [];
  };
  const stopPadListen = () => {
    cancelAnimationFrame(padFrame);
    padListening = null;
    context.padCapture = false;
  };
  const showPad = () => {
    const pb = mergePadBindings(settings.padBindings);
    padRows.replaceChildren(...PAD_ACTIONS.map((action) => el("div", { class: "form-row" },
      el("span", { class: "binding-label" }, context.t(action.label)),
      el("button", {
        class: padListening === action.id ? "pick selected" : "pick",
        onclick: () => listenPad(action),
      }, padListening === action.id ? "..." : pb[action.id].length ? pb[action.id].map(padButtonLabel).map((n) => t(n)).join(" / ") : t("None")))));
  };
  const listenPad = (action) => {
    stopPadListen();
    padListening = action.id;
    context.padCapture = true;
    padNote.textContent = t("Press a gamepad button for \"<<1>>\"...", t(action.label));
    showPad();
    // A button held when the wait starts (A, pressing this very button) must be let go first.
    let before = padButtons();
    const until = performance.now() + PAD_WAIT_MS;
    const poll = () => {
      if (padListening !== action.id) return;
      const now = padButtons();
      const pressed = newPress(before, now);
      before = now;
      if (pressed >= 0) {
        settings.padBindings = bindPadButton(settings.padBindings, action.id, pressed);
        save();
        padNote.textContent = `${t(action.label)}: ${t(padButtonLabel(pressed))}.`;
        // The button is still down: the menus must not take this press as their own.
        setTimeout(stopPadListen, 300);
        padListening = null;
        showPad();
        return;
      }
      if (performance.now() > until) { stopPadListen(); padNote.textContent = t("Cancelled."); showPad(); return; }
      padFrame = requestAnimationFrame(poll);
    };
    padFrame = requestAnimationFrame(poll);
  };
  const onPadEscape = (event) => {
    if (!padListening || event.code !== "Escape") return;
    event.preventDefault();
    stopPadListen();
    escapeAt = performance.now();
    padNote.textContent = t("Cancelled.");
    showPad();
  };
  window.addEventListener("keydown", onPadEscape, true);
  showPad();

  // Every option is one row of the same height: its name on the left, its control on the right.
  const row = (label, control, title = null) => el("label", { class: "opt-row", title: title && t(title) }, el("span", { class: "opt-label" }, t(label)), el("span", { class: "opt-control" }, control));
  // A long tab is split into sub-tabs at each `sub` heading (Keys, Extensions, Advanced); rows before the first stay
  // above the sub-tab buttons (Advanced's presets).
  // Rows after `foot()` sit under every sub-tab (Advanced's presets, Data's Clear browser game data).
  const SUB = Symbol("sub"), FOOT = Symbol("foot");
  const sub = (name) => ({ [SUB]: name });
  const foot = () => ({ [FOOT]: true });
  const subTabbed = (tabName, rows) => {
    const lead = [], groups = [], tail = [];
    let inFoot = false;
    for (const r of rows) {
      if (r?.[FOOT]) inFoot = true;
      else if (inFoot) tail.push(r);
      else if (r?.[SUB] !== undefined) groups.push({ name: r[SUB], rows: [] });
      else (groups.length ? groups[groups.length - 1].rows : lead).push(r);
    }
    const footer = tail.length ? [el("div", { class: "opt-foot" }, ...tail)] : [];
    if (!groups.length) return [...lead, ...footer];
    const panes = groups.map((g) => el("div", { class: "opt-subpage" }, ...g.rows));
    const buttons = groups.map((g, i) => el("button", { type: "button", class: "opt-subtab", onclick: () => show(i) }, t(g.name)));
    const remembered = (context.optionsSubTab ??= {});
    const show = (i) => {
      remembered[tabName] = i;
      panes.forEach((pane, k) => { pane.hidden = k !== i; });
      buttons.forEach((b, k) => b.classList.toggle("selected", k === i));
    };
    show(Math.min(remembered[tabName] ?? 0, groups.length - 1));
    return [...lead, ...(groups.length > 1 ? [el("div", { class: "opt-subtabs" }, ...buttons)] : []), ...panes, ...footer];
  };
  // Which setting each switch shows, for the controls to follow a preset (`showDraft`).
  const toggleKeys = new Map();
  const toggle = (label, key, title = null) => {
    toggleKeys.set(label, key);
    return row(label, el("input", {
      type: "checkbox", class: "opt-switch", checked: !!settings[key], "aria-label": t(label), "data-opt": label,
      onchange: (event) => { settings[key] = event.target.checked; save(); },
    }), title);
  };
  // Which setting each list shows, for the same reason.
  const chooseKeys = new Map();
  const choose = (label, key, names, values = names.map((_, index) => index)) => chooseKeys.set(label, key) && row(label,
    el("select", { "aria-label": t(label), "data-opt": label, onchange: (event) => {
      settings[key] = typeof values[0] === "number" ? Number(event.target.value) : event.target.value;
      save();
    } }, ...names.map((name, index) => el("option", { value: values[index], selected: values[index] === settings[key] }, t(name)))));
  const sliderFormats = new Map();
  const slider = (label, { min, max, step, value, format, set, title = null }) => {
    sliderFormats.set(label, format);
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
  const wheelsDamageTitle = msg("Hard hits, bad landings and rolls wear the wheels and dent the body; a worn wheel or a violent crash knocks one off, a huge one a whole axle. The truck limps on until they come back on, or press X for the pit crew (two seconds standing still; it fixes the body too). The timing board's Wheels line shows what is left before a wheel comes off, and N shows every truck's. Needs Crash damage. Not in Combat (it has its own), a classic network game or under MTM1 physics. Online rooms race by the owner's setting. From the next race");
  /** Wheels damage's switch, which only Crash damage on allows (it follows that switch). */
  const wheelsDamageRow = () => {
    const input = el("input", {
      type: "checkbox", class: "opt-switch", checked: !!settings.looseWheels && settings.crashDamage !== false, disabled: settings.crashDamage === false,
      "aria-label": t("Wheels damage"), "data-opt": "Wheels damage",
      onchange: (event) => { settings.looseWheels = event.target.checked; save(); },
    });
    wheelsDamageInput = input;
    return row(msg("Wheels damage"), input, wheelsDamageTitle);
  };
  let wheelsDamageInput = null;
  // The chat box in single-player races, which MTM2 caption bar (Advanced, MTM2) turns off.
  let soloChatInput = null;
  const soloChatRow = () => {
    soloChatInput = el("input", {
      type: "checkbox", class: "opt-switch", checked: soloChatOn(settings), disabled: !!settings.captionBar,
      "aria-label": t("Chat box in single player"), "data-opt": "Chat box in single player",
      onchange: (event) => { settings.soloChat = event.target.checked; save(); },
    });
    return row(msg("Chat box in single player"), soloChatInput, msg("A chat box in single-player races: the announcer's text commentary and the race's messages go to it as a log, in place of the caption bar, and the Chat key types lines only you see. Off while MTM2 caption bar (MTM2) is on. Not in the games. From the next race"));
  };
  function showSoloChat() { if (soloChatInput) { soloChatInput.disabled = !!settings.captionBar; soloChatInput.checked = soloChatOn(settings); } }
  // AI Speed (Community Patch 3, game/ai-speed.js). A running tournament keeps its own value: shown, locked.
  const aiSpeedTitle = msg("Community Patch 3's AI Speed: how fast the computer trucks drive, from 70 to 130 percent; 100 is the standard. A tournament keeps the value it started with");
  const aiSpeedRow = () => {
    const held = effectiveAiSpeed({ setting: settings.aiSpeed, tournament: context.tournament?.aiSpeed ?? null });
    if (held.locked) return row(msg("AI Speed"), el("output", { class: "opt-value", "data-opt": "AI Speed" }, t("<<1>>% (locked)", held.percent)), aiSpeedTitle);
    return slider(msg("AI Speed"), {
      min: AI_SPEED.min, max: AI_SPEED.max, step: AI_SPEED.step, value: aiSpeedPercent(settings.aiSpeed), format: (v) => `${v}%`,
      set: (v) => { settings.aiSpeed = v; save(); }, title: aiSpeedTitle,
    });
  };
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
    sceneryNote.textContent = [machine, t("Changes take effect next race.")].filter(Boolean).join(" ");
  };
  showScenery();

  const locFiles = await context.assets.call("locFiles").catch(() => []);
  const wording = row(msg("LOC file"), el("select", { "aria-label": t("Wording"), "data-opt": "Wording" },
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
      if (read.error) { await showAlert(t, read.error); return; }
      if (!await showConfirm(t, `${t("Replace the settings with those in <<1>>?", file.name)}${unsaved() ? `\n\n${t("The changes not saved here are lost.")}` : ""}`)) return;
      use(read.settings);
      saveSettings(live);
      stored = JSON.stringify(live);
      await showAlert(t, t("Settings imported."));
      closeNow();
    });
    input.click();
  };

  /**
   * Load race: a saved race (`*.mtm`, Monster Truck Madness 2's own or the pause menu's Save race; game/saved-race.js)
   * started where it was left. The dialog closes and the race starts.
   */
  const loadRace = () => {
    const input = el("input", { type: "file", accept: ".mtm" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const [{ readSavedGame }, catalog] = await Promise.all([import("../game/saved-race.js"), context.assets.call("catalog")]);
        const trucks = catalog.trucks.filter((item) => !item.hidden);
        const race = readSavedGame(new Uint8Array(await file.arrayBuffer()), { tracks: catalog.tracks, trucks });
        if (unsaved() && !await showConfirm(t, t("The changes not saved here are lost."))) return;
        closeNow();
        context.router.go("race", {
          track: race.track, mode: race.track.raceType, laps: race.laps, difficulty: 1, opponents: race.opponents, weather: race.weather,
          truck: race.truck, trucks, setup: race.setup ?? undefined, resume: { saved: race.saved, damage: race.damage },
        }, { replace: true });
      } catch (error) {
        await showAlert(t, t("The race could not be loaded: <<1>>", t(error.message)));
      }
    });
    input.click();
  };

  /**
   * The game's own drivers and Hall of Fame (`player.pro` and `MTM2 High Scores` from the game folder, MONSTER_EXE_ANALYSIS.md
   * 16): either or both files, told apart by what they hold, added to the port's (game/mtm2-saves.js).
   */
  const importGameSaves = () => {
    const input = el("input", { type: "file", multiple: true });
    input.addEventListener("change", async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      const [{ parseMtmPlayerPro }, { parseMtmHighScores }, saves, store] = await Promise.all([
        import("../vendor/openphotex/mtm/player-pro.js"), import("../vendor/openphotex/mtm/high-scores.js"),
        import("../game/mtm2-saves.js"), import("../app/profile-store.js"),
      ]);
      const catalog = await context.assets.call("catalog");
      const lines = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pro = parseMtmPlayerPro(bytes);
        if (pro) {
          const profiles = await store.getProfiles(context);
          const { added, kept } = saves.mergeDrivers(profiles, saves.driversFromPlayerPro(pro, catalog.trucks));
          await store.saveProfiles(context);
          lines.push(t("<<1>>: <<2>> drivers added.", file.name, added.length));
          if (kept.length) lines.push(t("Already here, kept as they are: <<1>>.", kept.join(", ")));
          continue;
        }
        const boards = parseMtmHighScores(bytes);
        if (boards) {
          const hall = await store.getHall(context);
          const { added, skipped } = saves.mergeHighScores(hall, boards, catalog);
          await store.saveHall(context);
          lines.push(t("<<1>>: <<2>> Hall of Fame entries added.", file.name, added));
          if (skipped.length) lines.push(t("Tracks not installed: <<1>>.", skipped.join(", ")));
          continue;
        }
        lines.push(t("<<1>> is not a Monster Truck Madness 2 player.pro or MTM2 High Scores file.", file.name));
      }
      await showAlert(t, lines.join("\n"));
    });
    input.click();
  };
  /** The port's drivers and Hall of Fame as the game's two files, to put in its folder. */
  const exportGameSaves = async () => {
    const [{ writeMtmPlayerPro }, { writeMtmHighScores, HIGH_SCORES_FILE }, saves, store] = await Promise.all([
      import("../vendor/openphotex/mtm/player-pro.js"), import("../vendor/openphotex/mtm/high-scores.js"),
      import("../game/mtm2-saves.js"), import("../app/profile-store.js"),
    ]);
    const catalog = await context.assets.call("catalog");
    const download = (data, name) => {
      const link = el("a", { href: URL.createObjectURL(new Blob([data], { type: "application/octet-stream" })), download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    download(writeMtmPlayerPro(saves.playerProFromProfiles(await store.getProfiles(context), catalog)), "player.pro");
    download(writeMtmHighScores(saves.highScoresFromHall(await store.getHall(context), catalog)), HIGH_SCORES_FILE);
  };

  // Leaving the options for another screen: the same warning as Close first.
  const leaveFor = (go) => async () => { if (await close()) await go(); };
  const nav = (label, onclick) => el("button", { class: "nav", "data-menu-sound": "STARTOFF", onclick }, t(label));
  const navButtons = el("div", { class: "options-nav" },
    nav(msg("Hall of Fame"), leaveFor(() => context.router.go("hall"))),
    nav(msg("Instant Replay"), async () => {
      const { pickReplayFile } = await import("./screens/replay.js");
      const replay = await pickReplayFile();
      if (!replay) { await showAlert(t, t("That file is not a Monster Truck Madness 2 replay.")); return; }
      await leaveFor(() => context.router.go("replay", { replay }))();
    }),
    nav(msg("Start screen"), leaveFor(() => context.router.go("start", {}, { replace: true }))),
    nav(msg("About"), leaveFor(() => context.router.go("about"))));

  /** Settings declared by each extension: a heading, its description and its rows, as the Display page's sections are. */
  // Opened for one extension (the Races screen's button beside Mode): only its panel shows.
  const extensionPanels = EXTENSIONS.filter((extension) => !onlyExtension || extension.id === onlyExtension).map((extension) => el("div", { class: "ext-panel", "data-ext": extension.id, "data-name": extension.name },
    el("h3", {}, t(extension.name)),
    el("p", { class: "muted" }, t(extension.description)),
    ...extension.settings.map((spec) => {
      const current = settingsForExtension(settings, extension)[spec.key];
      if (spec.type === "number") {
        const input = el("input", {
          type: "number", min: spec.min, max: spec.max, step: spec.step ?? 1, value: current,
          "aria-label": `${t(extension.name)}: ${t(spec.label)}`,
          onchange: (event) => {
            // Whole numbers unless the setting has a finer step (Freestyle's trick physics).
            const raw = Number(event.target.value);
            const typed = spec.step ? Number((Math.round(raw / spec.step) * spec.step).toFixed(4)) : Math.trunc(raw);
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
  ));

  /**
   * Reload POD.INI: the browser keeps no handle on the folder, so it is picked again (the same one or another), and every
   * archive is copied afresh, so a POD rebuilt under the same name is read again.
   */
  const reinstall = async (target) => {
    const [{ pickInstallFolder }, { inspectSource }] = await Promise.all([import("../install/picker.js"), import("../install/inspect-source.js")]);
    const source = await pickInstallFolder();
    if (!source) return;
    const found = await inspectSource(source);
    if (!found.files?.length) { await showAlert(t, t(found.message, ...(found.messageArgs ?? []))); return; }
    const label = target.textContent;
    target.disabled = true;
    const off = context.assets.on("install-progress", ({ copied, total, name }) => {
      target.textContent = t("Copying <<1>> <<2>>%", name, total ? Math.round((copied / total) * 100) : 100);
    });
    try {
      const done = await context.assets.call("reloadInstall", { files: found.files, podIni: found.podIni, exeVersion: found.exeVersion ?? null, weatherArt: found.weatherArt ?? [], videos: settings.copyVideos ? found.videos ?? [] : [], force: true });
      const lines = [t("<<1>> archives mounted, in POD.INI order.", done.archives.length)];
      if (done.added.length) lines.push(t("Read again: <<1>>.", done.added.join(", ")));
      if (done.removed.length) lines.push(t("Removed: <<1>>.", done.removed.join(", ")));
      if (found.missing?.length) lines.push(t("Listed but not in the folder: <<1>>.", found.missing.join(", ")));
      await showAlert(t, lines.join("\n"));
      window.location.reload();
    } catch (error) {
      await showAlert(t, t("Could not reload POD.INI: <<1>>", error.message));
      target.textContent = label;
      target.disabled = false;
    } finally {
      off();
    }
  };

  const introVideosSwitch = toggle(msg("Play intro videos"), "introVideos", msg("The game's start videos at launch. Needs the videos copied (below)"));
  const resultVideosSwitch = toggle(msg("Play win / lose videos"), "resultVideos", msg("A video after each race for your place: first, last or between. Needs the videos copied (below)"));
  context.assets.call("videoLists").then(({ files }) => {
    if (files?.length) return;
    for (const r of [introVideosSwitch, resultVideosSwitch]) {
      const input = r.querySelector("input");
      input.disabled = true;
      input.checked = false;
      r.classList.add("opt-disabled");
    }
  }).catch(() => {});

  /**
   * "Copy the game's videos" acts at once, as an install step and not a draft setting: ticked, the game's folder is picked
   * again (a browser keeps no handle on it) and its VIDEOS folder is copied; unticked, the copied videos are removed.
   */
  const setVideoSwitches = (on) => {
    for (const r of [introVideosSwitch, resultVideosSwitch]) {
      const input = r.querySelector("input");
      input.disabled = !on;
      if (!on) input.checked = false;
      r.classList.toggle("opt-disabled", !on);
    }
  };
  const copyVideosSwitch = el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.copyVideos, "aria-label": t("Copy the game's videos"), "data-opt": "Copy the game's videos" });
  const keepCopyVideos = (on) => {
    copyVideosSwitch.checked = on;
    settings.copyVideos = live.copyVideos = on;
    saveSettings(live);
    stored = JSON.stringify(live);
  };
  copyVideosSwitch.addEventListener("change", async () => {
    const want = copyVideosSwitch.checked;
    copyVideosSwitch.checked = !want;
    if (!want) {
      if (!await showConfirm(t, t("Remove the game's videos from this browser?"))) return;
      await context.assets.call("installVideos", { videos: [] }).catch(() => {});
      keepCopyVideos(false);
      setVideoSwitches(false);
      return;
    }
    const [{ pickInstallFolder }, { findVideos }] = await Promise.all([import("../install/picker.js"), import("../install/inspect-source.js")]);
    if (!await showConfirm(t, t("Pick the Monster Truck Madness 2 folder to copy its videos (about 155 MB)."))) return;
    const source = await pickInstallFolder();
    if (!source) return;
    const videos = await findVideos(source).catch(() => []);
    if (!videos.some(({ name }) => name.toUpperCase() !== "EXTRAS.INI")) { await showAlert(t, t("That folder has no VIDEOS folder.")); return; }
    const label = copyVideosRow.querySelector(".opt-label"), text = label.textContent;
    copyVideosSwitch.disabled = true;
    const off = context.assets.on("install-progress", ({ copied, total, name }) => {
      label.textContent = t("Copying <<1>> <<2>>%", name, total ? Math.round((copied / total) * 100) : 100);
    });
    try {
      const list = await context.assets.call("installVideos", { videos });
      keepCopyVideos(true);
      setVideoSwitches(true);
      await showAlert(t, t("<<1>> videos copied.", list.filter((name) => name !== "EXTRAS.INI").length));
    } catch (error) {
      await showAlert(t, t("Could not copy the videos: <<1>>", error.message));
    } finally {
      off();
      label.textContent = text;
      copyVideosSwitch.disabled = false;
    }
  });
  const copyVideosRow = row(msg("Copy the game's videos"), copyVideosSwitch, msg("Copy the game's VIDEOS folder (about 155 MB) now, from its folder; untick to remove them"));

  /** Chat and the lobby (game/chat.js; settings.net, which keeps its other fields). */
  function multiplayerRows() {
    const chat = chatSettings(settings.net);
    const setNet = (changes) => { settings.net = { ...settings.net, ...changes }; save(); };
    const mutedList = el("div", { class: "opt-muted" });
    const showMuted = () => {
      const muted = chatSettings(settings.net).muted;
      mutedList.replaceChildren(...(muted.length ? muted.map((name) => el("div", { class: "opt-muted-row" }, el("span", {}, name),
        button(msg("Unmute"), () => { setNet({ muted: setMuted(chatSettings(settings.net).muted, name, false) }); showMuted(); })))
        : [el("p", { class: "muted" }, t("No one is muted. Mute a player from the lobby's player list, or type /mute and their name in a race."))]));
    };
    showMuted();
    return [
      row(msg("Chat in races"), el("select", { "aria-label": t("Chat in races"), "data-opt": "Chat in races", onchange: (event) => setNet({ chat: event.target.value }) },
        ...[["all", msg("Everyone")], ["team", msg("Team and private only")], ["off", msg("Off")]].map(([value, label]) => el("option", { value, selected: value === chat.mode }, t(label)))),
      msg("Which lines show over a network race. The lobby always shows every line")),
      slider(msg("Chat lines"), { min: 3, max: 10, step: 1, value: chat.lines, format: (v) => String(v), set: (v) => setNet({ chatLines: v }),
        title: msg("How many lines the chat shows over the race at once") }),
      slider(msg("Chat fade"), { min: 4, max: 30, step: 1, value: chat.fadeS, format: (v) => `${v} s`, set: (v) => setNet({ chatFadeS: v }),
        title: msg("How long a line stays over the race") }),
      row(msg("Allow missing trucks"), el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.net?.allowMissingTrucks, "aria-label": t("Allow missing trucks"),
        onchange: (event) => setNet({ allowMissingTrucks: event.target.checked }) }),
      msg("When you host: start the race even if a player chose a truck you do not have installed; it is drawn as another truck. Off, every player must choose a truck you have")),
      row(msg("Latency display"), el("input", { type: "checkbox", class: "opt-switch", checked: settings.net?.latencyDisplay !== false, "aria-label": t("Latency display"),
        onchange: (event) => setNet({ latencyDisplay: event.target.checked }) }), msg("The lobby's Latency column, with the round trip in milliseconds, and each player's latency in the corner of a network race")),
      el("h3", {}, t("Muted players")),
      mutedList,
      el("p", { class: "muted" }, t("In a race: Enter (Chat) types a line, K (Team chat) types one to your team. Tab changes who it goes to, Page Up and Page Down scroll back, /help lists the commands. With a gamepad, hold View and point the right stick for a quick message.")),
    ];
  }

  const sections = [
    [msg("Game"), [
      row(msg("Physics"), el("select", { "aria-label": t("Physics"), "data-opt": "Physics", onchange: (event) => { settings.physics = event.target.value; save(); } },
        ...PHYSICS_MODELS.map((m) => el("option", { value: m.id, selected: m.id === physicsModel(settings.physics).id, title: t(m.note) }, t(m.label)))),
      msg("The rules the trucks are driven by, from the next race on. Monster Truck Madness is the 1996 game: tires that touch throw trucks twice as hard, water stops a truck, weather does not change the grip, no crash damage, and its drag rules")),
      toggle(msg("Automatic gears"), "autoShift"), row(msg("Crash damage"), el("input", {
        type: "checkbox", class: "opt-switch", checked: settings.crashDamage !== false, "aria-label": t("Crash damage"), "data-opt": "Crash damage",
        onchange: (event) => {
          settings.crashDamage = event.target.checked;
          // Wheels damage goes with it.
          if (!settings.crashDamage) settings.looseWheels = false;
          if (wheelsDamageInput) { wheelsDamageInput.disabled = !settings.crashDamage; wheelsDamageInput.checked = !!settings.looseWheels; }
          save();
        },
      }), msg("Trucks dent where they are hit")),
      // Wheels damage (game/extensions/loose-wheels.js), an OpenMTM2 addition: Combat's wheels in every race. A part of
      // crash damage: it can be switched on only with Crash damage on.
      wheelsDamageRow(),
      choose(msg("Wheels back on after"), "looseWheelsRepairS", [msg("5 seconds"), msg("8 seconds"), msg("12 seconds"), msg("Never (X only)")], [...REPAIR_CHOICES]),
      toggle(msg("Drag auto stage"), "autoStage", msg("Drag races: the truck drives itself to the staging beams. Off, you stage it yourself; the Auto Stage key (T) then does it for one pass")),
      choose(msg("Speed"), "units", ["MPH", "KPH"], ["mph", "kph"]),
      // The game's videos (game/videos.js): off and greyed while the install has none.
      introVideosSwitch, resultVideosSwitch,
      menus,
      // Fullscreen, where the browser can do it and the game is not installed (ui/display-mode.js), at the page's foot.
      // Load race (a saved race: the pause menu's Save race, or Monster Truck Madness 2's own .mtm) beside Fullscreen.
      el("div", { class: "opt-actions opt-fullscreen" },
        button(msg("Load race..."), () => loadRace(), null, msg("Start a race saved with Save race in the pause menu, or by Monster Truck Madness 2, where it was left")),
        ...[fullscreenButton(t, "opt-fullscreen-button")].filter(Boolean)),
    ]],
    [msg("Display"), [
      row(msg("Smooth textures"), el("input", {
        type: "checkbox", class: "opt-switch", checked: settings.look === "enhanced", "aria-label": t("Smooth textures"), "data-opt": "Smooth textures",
        onchange: (event) => { settings.look = event.target.checked ? "enhanced" : "classic"; save(); },
      }), msg("Textures filtered smooth and the world lit by the sun (the enhanced look). Off: the game's own sharp texels and baked light")),
      toggle(msg("Lens flare"), "sunFlare", msg("With Smooth textures: the sun's flare across the screen. Off keeps the sun and moon")),
      choose(msg("Detail"), "detailLevel", [msg("Low"), msg("Medium"), msg("High")]),
      choose(msg("Texture size"), "textureSize", [msg("Full"), msg("Half (512)"), msg("Quarter (256)")], [1024, 512, 256]),
      el("p", { class: "muted" }, t("The largest HD textures and ground tiles a track and the trucks keep (Community Patch 3 and HD tracks such as Valparaíso Racing). Half or Quarter for graphics with little memory, built into the processor: the game then needs a quarter or a sixteenth of the video memory for them. The game's own textures are not changed. From the next race")),
      row(msg("Anti-aliasing"), el("select", {
        "aria-label": t("Anti-aliasing"), "data-opt": "Anti-aliasing", title: t(AA_HINT),
        onchange: (event) => { settings.aa = event.target.value; save(); },
      }, ...AA_MODES.map((mode) => el("option", { value: mode.id, selected: mode.id === aaChoice(settings.aa) }, t(mode.label)))), AA_HINT),
      // In terrain cells (32 ft each), as the game counts its view; 128 is the standard.
      slider(msg("Draw distance"), { min: 16, max: 256, step: 16, value: Math.min(256, settings.drawCells ?? 128), format: (v) => t("<<1>> cells", v), set: (v) => { settings.drawCells = v; save(); } }),
      slider(msg("Field of view"), {
        min: FOV_ACROSS_MIN, max: FOV_ACROSS_MAX, step: 5, value: Number(settings.chaseFov) || GAME_FOV_ACROSS_DEG,
        format: (v) => t("<<1>> degrees", v),
        set: (v) => { settings.chaseFov = v; save(); },
        title: msg("How wide the external cameras see, in degrees across a 4:3 screen; 90 is Monster Truck Madness 2's lens. The cockpit keeps the game's"),
      }),
      toggle(msg("V-sync"), "vsync", msg("Draw with the display's refresh. Off draws as fast as the browser allows; a browser still shows no more frames than the display has")),
      // One list: picking a rate switches the limit on, so a rate is never shown chosen while the limit is off.
      row(msg("Frame rate limit"), el("select", {
        "aria-label": t("Frame rate limit"), "data-opt": "Frame rate limit",
        onchange: (event) => { const n = Number(event.target.value); settings.fpsLimit = n > 0; if (n > 0) settings.fpsLimitValue = n; save(); },
      }, el("option", { value: 0, selected: !settings.fpsLimit }, t("Off")),
        ...FPS_LIMITS.map((n) => el("option", { value: n, selected: !!settings.fpsLimit && n === (settings.fpsLimitValue ?? 60) }, `${n} FPS`))),
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
      // The game's two commentary switches (MONSTER.INI commentaryFlag and textCommentaryFlag).
      toggle(msg("Voice commentary"), "commentary", msg("The announcer talks about your truck and the one the camera follows. From the next race")),
      toggle(msg("Text commentary"), "textCommentary", msg("The announcer's lines are shown on screen. From the next race")),
      // Community Patch 3's (CP3_EXE_ANALYSIS.md 3): the announcer on a surround system's centre speaker.
      row(msg("Commentary from Center"), el("input", { type: "checkbox", class: "opt-switch", checked: settings.sound.centreCommentary !== false, "aria-label": t("Commentary from Center"), onchange: (event) => {
        settings.sound = { ...settings.sound, centreCommentary: event.target.checked };
        save();
      } }), msg("With a 5.1 or 7.1 output, the announcer comes from the centre speaker, as Community Patch 3 has it. A stereo output hears it in the middle either way")),
      // Community Patch 3's opponent sound switches (game/air-calls.js).
      toggle(msg("Opponents Horn"), "aiHorn", msg("Computer trucks high in the air may honk")),
      toggle(msg("Opponents Yee-Haw"), "aiYeeHaw", msg("Computer trucks high in the air may whoop")),
      toggle(msg("Reduce Yee-Haw/Horn Freq."), "aiSfxReduce", msg("Computer trucks honk and whoop in the air 6 to 10 times less often, each at its own rate")),
      // The jukebox acts at once, apart from the draft (ui/jukebox-dialog.js, game/jukebox.js).
      el("div", { class: "opt-actions" }, button(msg("Jukebox"), async () => { (await import("./jukebox-dialog.js")).openJukebox(context); },
        null, msg("The music of the mounted tracks and menus as one playlist, in your own order, played in the menus and in races"))),
    ]],
    [msg("Keys"), [sub(msg("Keyboard")), note, keyRows, el("div", { class: "opt-actions" }, button(msg("Reset keys"), () => {
      Object.assign(bindings, mergeBindings({})); settings.bindings = {}; save(); note.textContent = t("Keys reset."); showKeys();
    })), choose(msg("Fly-by controls"), "flyControls", FLY_SCHEMES.map((id) => FLY_SCHEME_NAMES[id]), [...FLY_SCHEMES]),
      sub(msg("Gamepad")),
      // The left stick as the pedals too makes a thumb that drifts while steering press them (game/input/gamepad.js).
      choose(msg("Gamepad pedals"), "padPedals", [msg("Triggers"), msg("Left stick"), msg("Triggers and left stick")], [...PAD_PEDALS]),
      el("h3", {}, t("Gamepad buttons")), padNote, padRows, el("div", { class: "opt-actions" }, button(msg("Reset gamepad"), () => {
        stopPadListen(); settings.padBindings = {}; save(); padNote.textContent = t("Gamepad buttons reset."); showPad();
      })),
      // The game's steering response (MONSTER.INI [Control]): a stick's curve is x ^ (1 + 2r), the keys' x ^ (1 + r / 4), r a tenth of it.
      slider(msg("Steering response"), {
        min: 0, max: 10, step: 1, value: settings.steeringResponse ?? 10, format: (v) => String(v),
        set: (v) => { settings.steeringResponse = v; save(); },
        title: msg("How steep the steering is. 10 is the game's own: a gamepad stick or wheel turns little near the centre and fast near the edge. Lower makes a stick turn more evenly; 0 is straight. From the next race"),
      }),
      // The game's force feedback (MONSTER.INI useForceFeedback, forceFeedbackStrength) as the pad's rumble (game/input/rumble.js).
      toggle(msg("Gamepad rumble"), "padRumble", msg("The gamepad shakes with crashes, hard landings and rough ground, as the game's force feedback pushed a joystick. Needs a browser and pad with rumble (Chrome, Edge or Safari, and an Xbox or PlayStation pad)")),
      slider(msg("Rumble strength"), {
        min: 0, max: 100, step: 10, value: settings.padRumbleStrength ?? 70, format: (v) => `${v}%`,
        set: (v) => { settings.padRumbleStrength = v; save(); },
        title: msg("The game's force feedback strength: 70% is its default"),
      }),
      // Fewer effects run the motors less: a wireless pad's battery lasts longer (game/input/rumble.js RUMBLE_LEVELS).
      slider(msg("Rumble effects"), {
        min: 1, max: 3, step: 1, value: settings.padRumbleLevel ?? 3, format: (v) => RUMBLE_LEVEL_NAMES[v - 1],
        set: (v) => { settings.padRumbleLevel = v; save(); },
        title: msg("What makes the gamepad rumble. Hits: crashes, landings and wheels hitting things. Hits + ground: also the surface under the wheels. All: also a soft, steady rumble from the engine. Fewer effects make a wireless pad's battery last longer"),
      }),
      // Both motors in turn, to check the pad and the browser outside a race.
      el("div", { class: "opt-actions" }, button(msg("Test rumble"), async (event) => {
        const target = event.currentTarget;
        const said = await testRumble();
        target.textContent = said === "ok" ? t("Rumble: strong motor, then weak motor") : said === "no gamepad" ? t("No gamepad connected") : t("This browser or pad has no rumble");
      })),
      sub(msg("Touch")),
      // The race's touch overlay (ui/touch-controls.js): Auto on a phone or tablet with no mouse, keyboard or gamepad.
      Object.assign(choose(msg("Touch controls"), "touchControls", [msg("Auto"), msg("On"), msg("Off")], [...TOUCH_MODES]), {
        title: t(msg("On-screen stick, pedals and buttons for racing on a phone or tablet. Auto shows them on a device with only a touchscreen, and hides them while a gamepad is connected or a key is pressed")),
      }),
    ]],
    [msg("Multiplayer"), multiplayerRows()],
    [msg("Extensions"), [
      ...extensionPanels.flatMap((panel) => [sub(panel.dataset.name), panel]),
    ]],
    // What a newcomer can leave alone: other games' tracks, the patch's materials, the computer trucks and the cameras.
    [msg("Advanced"), [
      sub(msg("MTM1")),
      toggle(msg("No overlap on MTM1 tracks"), "mtm1NoOverlap", msg("With Terrain overlap on: the ground tiles of a Monster Truck Madness 1 track still meet edge to edge, as MTM1 draws them; the other tracks keep the two-pixel overlap. From the next race")),
      toggle(msg("MTM1 particles"), "mtm1Particles", msg("Monster Truck Madness 1's own particles and tracks: single points of the ground's colour thrown by the tires, which mark the ground where they land, and tracks darkened into the ground, in place of the dust, the spray and the tire tracks. From the next race")),
      toggle(msg("MTM1 sounds"), "mtm1Sounds", msg("Monster Truck Madness 1's skids from MTM2's SOUND.POD: its corner, wheelspin and brake skids. MTM1's engine is not in MTM2's archives; the engine stays MTM2's")),
      toggle(msg("MTM1 sky"), "mtm1EarthSky", msg("Monster Truck Madness 1's flat sky on every track: an MTM1 track's own, and EARTHSKY on the others, in the weathers without a sky of their own. Needs MTM1's sky files mounted (EARTHSKY.ACT and ALIENSKY.RAW, in MTM1's GAME.POD). From the next race")),
      toggle(msg("Keep MTM1 trucks apart"), "mtm1TrucksApart", msg("Monster Truck Madness 1 trucks named like MTM2's (BIGFOOT.TRK and the rest) are listed too, as \"Bigfoot (MTM1)\", and drawn from MTM1's own files. Off, a name goes to the archive mounted first, MTM2's, as in the game")),
      sub(msg("MTM2")),
      toggle(msg("Original backdrops"), "originalBackdrops", msg("The game's own backdrops in place of HD ones (Community Patch 3's backdropsHD.pod), wherever an archive still has the original. From the next race")),
      // MTM2's own two (MONSTER.INI reflectionFlag and truckReflectionFlag), for the game's water and every truck.
      toggle(msg("MTM2 Water reflections"), "waterReflections", msg("MTM2's: the world mirrored in the game's water (\"Reflective water\" has its own). From the next race")),
      toggle(msg("MTM2 Truck reflections"), "truckReflections", msg("MTM2's: the clouds mirrored on the trucks' bodies, or the sky in Rain, Dusk and Night; none in fog or Pitch Black. From the next race")),
      toggle(msg("MTM2 classic dust"), "greyDust", msg("Wheels' dust and collisions' smoke in the game's own grey puff colour, as MTM2 draws them, in place of the port's earth-coloured dust and dark smoke. From the next race")),
      toggle(msg("Commentary truck names"), "commentaryTruckNames", msg("The text commentary names the trucks, as the game's does, in place of their drivers. From the next race")),
      row(msg("MTM2 Caption bar"), el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.captionBar, "aria-label": t("MTM2 Caption bar"), "data-opt": "MTM2 Caption bar",
        onchange: (event) => { settings.captionBar = event.target.checked; save(); showSoloChat(); } }),
        msg("The race's messages and the text commentary in the game's caption bar at the bottom of the screen, as MTM2 shows them. Turns off the chat box in single-player races. From the next race")),
      toggle(msg("Full Autopilot"), "fullAutopilot", msg("The truck drives itself")),
      toggle(msg("Show hidden tracks"), "showHiddenTracks"),
      toggle(msg("Kooky horn"), "kookyHorn", msg("Three horns instead of one")),
      copyVideosRow,
      sub(msg("CP3")),
      toggle(msg("CP3 voice commentary"), "cp3Commentary", msg("Community Patch 3's announcer: many more lines, calls for the final lap, the weather, road signs, trains, the Summit Rumble and drag passes, and shorter pauses between lines. The drag calls need Community Patch 3's Sound.POD. From the next race")),
      toggle(msg("CP3 Terrain detail"), "terrainDetail", msg("Community Patch 3 tracks: detail normals where the track paints a mask, and HD ground normal maps (Enhanced look)")),
      row(msg("CP3 HD weather"), el("input", { type: "checkbox", class: "opt-switch", checked: settings.hdWeather !== false, "aria-label": t("CP3 HD weather"), "data-opt": "CP3 HD weather", onchange: (event) => { settings.hdWeather = event.target.checked; save(); } }),
        msg("Community Patch 3's HD skies for Rain, Dusk and Night and the older levels' clouds: the pictures in the game folder's WeatherArt folder, or the port's own copy of the community's set. Off: the game's own sky art")),
      toggle(msg("CP3 Reflections"), "reflections", msg("Community Patch 3 materials: the sky reflected in glass and paint (Enhanced look)")),
      toggle(msg("Chase mirror"), "chaseMirror", msg("Community Patch 3's rear-view mirror over the top of the external views: a look back from the cab")),
      toggle(msg("Racing line"), "raceLine", msg("Community Patch 3's racing line: the course the computer trucks follow, drawn on the ground ahead in a race")),
      toggle(msg("Drag split screen"), "dragSplitScreen", msg("Community Patch 3's drag split screen: in a drag race against a truck, both lanes at once, side by side, in the same chase view")),
      sub(msg("OMTM2")),
      row(msg("Terrain overlap"), el("input", { type: "checkbox", class: "opt-switch", checked: settings.terrainOverlap !== false, "aria-label": t("Terrain overlap"), "data-opt": "Terrain overlap", onchange: (event) => { settings.terrainOverlap = event.target.checked; save(); } }),
        msg("The ground tiles overlap by two pixels, as Monster Truck Madness 2 draws them. Off, they meet edge to edge, as MTM1 draws them. Some HD texture packs need it on. From the next race")),
      toggle(msg("Shift gears in automatic"), "shiftInAuto", msg("With Automatic gears: the shift keys and a gamepad's LB and RB still change gear, to shift down before a corner. The chosen gear holds until the engine reaches its redline or drops too low, then the automatic box takes over again. Not in the games")),
      row(msg("OpenMTM2 font in-game"), el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.systemFont, "aria-label": t("OpenMTM2 font in-game"), "data-opt": "OpenMTM2 font in-game",
        onchange: (event) => { settings.systemFont = event.target.checked; save(); useSystemFont(settings.systemFont); } }),
        msg("Every text in the race, the replays and the fly-bys (the timing board, the messages, the names, the map, the gauges and the loading screen) in OpenMTM2's own font instead of the game's bitmap fonts. Not in the games")),
      soloChatRow(),
      choose(msg("Course map"), "mapStyle", [msg("OpenMTM2 map"), msg("MTM2 classic map")], ["openmtm2", "classic"]),
      el("p", { class: "muted" }, t("OpenMTM2 map: a strip on the right of the screen that turns smoothly with the truck, the other trucks as white dots and yours as a yellow chevron. The Map key (Tab) cycles no names, driver names and truck names, each with its place, then turns it off; ] and [ zoom it. MTM2 classic map: the game's own map over the whole screen, which the Map key turns off, or shows with places, truck names or driver names. From the next race")),
      toggle(msg("Checkpoints on the map"), "mapCheckpoint", msg("The course map marks every checkpoint with a bar across the road, the next one in yellow and kept at the map's edge when it is farther away. Not in the games")),
      slider(msg("Map line thickness"), {
        min: MAP_LINE_MIN, max: MAP_LINE_MAX, step: 0.25, value: mapLineScale(settings.mapLineWidth), format: (v) => `${v}x`,
        set: (v) => { settings.mapLineWidth = v; save(); },
        title: msg("How thick the course map's lines are: 1x is the game's"),
      }),
      slider(msg("Map transparency"), {
        min: 0, max: MAP_TRANSPARENCY_MAX, step: 0.1, value: mapTransparency(settings.mapTransparency), format: (v) => `${Math.round(v * 100)}%`,
        set: (v) => { settings.mapTransparency = v; save(); },
        title: msg("How see-through the course map is over the race: 0% is the game's"),
      }),
      slider(msg("Name transparency"), {
        min: 0, max: NAME_TRANSPARENCY_MAX, step: 0.1, value: nameTransparency(settings.nameTransparency), format: percent,
        set: (v) => { settings.nameTransparency = v; save(); },
        title: msg("How see-through the names over the trucks (the Names key) and on the course map are: 0% is the game's"),
      }),
      toggle(msg("Ground box grain"), "groundBoxGrain", msg("With Ground detail on: its grain on the ground boxes too, the walls, buildings and signs built of them. Off, they keep their textures plain. From the next race")),
      sub(msg("Computer trucks")),
      choose(msg("Computer trucks drive as"), "aiBehaviour", [msg("OMTM2"), msg("Same as physics"), msg("MTM2"), msg("MTM1"), msg("EVO")], [...AI_BEHAVIOURS]),
      el("p", { class: "muted" }, t("OMTM2: the port's computer drivers, which weave less, catch slides, steer round objects, back out when stuck and take another course when cut off. Same as physics: the drivers of the race's physics model, MTM2's under CART Precision Racing. MTM2 and MTM1: each game's own autopilot alone, as they drove in 1998 and 1996. EVO: 4x4 Evolution's drivers on their race lines. From the next race")),
      row(msg("Computer opponents"), el("select", { "aria-label": t("Computer opponents"), "data-opt": "Computer opponents", onchange: (event) => {
        // A new default replaces the list picked on the Races screen.
        settings.defaultOpponents = Number(event.target.value);
        delete settings.opponentTrucks;
        save();
      } }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => el("option", { value: n, selected: n === (settings.defaultOpponents ?? 3) }, String(n)))),
      msg("How many computer trucks race by default; the Races screen picks which")),
      row(msg("Opponent frame rate"), el("select", { "aria-label": t("Opponent frame rate"), "data-opt": "Opponent frame rate", onchange: (event) => { settings.opponentFps = Number(event.target.value); save(); } },
        ...[15, 20, 24, 30, 45, 60].map((n) => el("option", { value: n, selected: n === (settings.opponentFps ?? 30) }, `${n} FPS`))),
      msg("The frame rate the computer trucks drive as if the game ran at: they steer by the frame, so it changes how they handle. 30 is the standard")),
      toggle(msg("Sonic trucks"), "sonicTrucks", msg("Professional only: the computer trucks drive as on a Sonic track, on every track")),
      aiSpeedRow(),
      row(msg("Computer drivers"), button(msg("Names..."), () => editDriverNames()), "The names of the computer drivers"),
      sub(msg("CPR")),
      // CART Precision Racing's Skill Level (docs/CPR_PHYSICS.md 14.3; game/cpr-driver.js `cprAids`).
      row(msg("CPR skill level"), el("select", { "aria-label": t("CPR skill level"), "data-opt": "CPR skill level", onchange: (event) => { settings.cprSkill = event.target.value; save(); } },
        ...[["rookie", msg("Rookie")], ["intermediate", msg("Intermediate")], ["professional", msg("Professional")]]
          .map(([value, label]) => el("option", { value, selected: (settings.cprSkill ?? "rookie") === value }, t(label)))),
      msg("Under the CART Precision Racing physics, how much the game helps the player's car, as its Driving Aids. Rookie: full grip, Auto-Brake, Stay on track, anti-lock brakes, traction control and Spin Correction. Intermediate: four fifths of the grip, with Stay on track, anti-lock brakes, traction control and Spin Correction. Professional: four fifths of the grip, less still on grass, dirt and rocks, and no aids")),
      sub(msg("EVO")),
      // 4x4 Evolution's grass: how far around the camera it is drawn (render/evo-grass.js `GRASS_RADII`).
      slider(msg("Evo grass"), {
        min: 0, max: GRASS_LEVEL_NAMES.length - 1, step: 1, value: grassLevel(settings), format: (v) => GRASS_LEVEL_NAMES[v],
        set: (v) => { settings.evoGrassRange = v; settings.evoGrass = v > 0; save(); },
        title: msg("4x4 Evolution tracks: how far around the camera the grass is drawn, on every tile its .TEX marks for vegetation, pressed down under the trucks. Near is about the game's own. From the next race"),
      }),
      toggle(msg("Evo particles"), "evoParticles", msg("4x4 Evolution tracks: the game's tire debris, in the ground's colour, by surface (gravel, grass, sand, mud, snow) from spinning and sliding tires, and the leaves on Autumn. From the next race")),
      toggle(msg("Evo AI life"), "evoLife", msg("4x4 Evolution tracks: the game's AI life, four flocks of birds that follow the computer drivers' line, circle, land and take off when a truck comes near, as the game's ailife setting. From the next race")),
      toggle(msg("Evo forest"), "evoForest", msg("4x4 Evolution tracks without a vegetation file (the first game's): a forest generated over every tile its .TEX marks for trees, as 4x4 Evolution 2 does, from the track's own tree models. From the next race")),
      toggle(msg("Helicopter to the last checkpoint"), "checkpointHeli", msg("The Helicopter key (H) sets the truck down 32 feet behind the last checkpoint it passed, facing on, as 4x4 Evolution 2's H key does, instead of at the nearest point of the course. Checkpoints sit at the corners, so it is the start of the stretch you are on. Useful on bridges. From the next race")),
      sub(msg("Cameras")),
      choose(msg("Camera system"), "cameraSystem", Object.values(CAMERA_SYSTEMS).map((c) => c.name), Object.keys(CAMERA_SYSTEMS)),
      el("p", { class: "muted" }, t("The views the Camera key (V) and the number keys step through, whatever the physics. OMTM2: the cockpit, Chase Near and Chase Far, with the standard lens. MTM2: the game's ten. MTM1: its five, with the Goodyear Blimp. EVO: 4x4 Evolution 2's cockpit, Inertia (farther back the faster you go), Sky Cam, Chase Near and Chase Far")),
      toggle(msg("Inertia widens the lens"), "inertiaLens", msg("With Z-mode cameras: the Inertia view stays at Chase Near's distance and widens its lens as the truck speeds up, to a quarter of Chase Near's zoom, so the ground seems to rush at the screen. Off, it pulls back instead, keeping the game's lens")),
      row(msg("Short camera cycle"), el("span", { class: "opt-slider" },
        el("input", { type: "checkbox", class: "opt-switch", checked: !!settings.shortViewCycle, "aria-label": t("Short camera cycle"), "data-opt": "Short camera cycle", onchange: (event) => { settings.shortViewCycle = event.target.checked; save(); } }),
        button(msg("Views..."), () => editShortViews())),
      msg("The Camera key (V) steps through the views in the list only: the cockpit, Chase Near and Chase Far unless changed")),
      toggle(msg("Camera clearance"), "cameraClearance", msg("The chase camera keeps a few feet over the ground, easing back down after a crest. Off, it may touch the ground, as in the game")),
      toggle(msg("Z-mode cameras"), "zModeCameras", msg("Zoom with Shift and - or + (hold them to zoom on smoothly; a gamepad's D-pad left and right), orbit with Insert and Delete, and the Inertia view, in any race without GOLD mode. The zoom is kept for the next races")),
      toggle(msg("Reverse camera tilt"), "cameraTiltSwap", msg("Keypad plus raises the chase camera and keypad minus lowers it; the game's keys do the opposite. A gamepad's right stick tilts it either way")),
      toggle(msg("Free look"), "freeLook", msg("On the external cameras the mouse looks round, easing back after two seconds; the wheel zooms either way")),
      toggle(msg("Click to look"), "freeLookDrag", msg("With Free look: the mouse looks round only while a button is held on the picture, so moving it off the screen does not turn the camera")),
      toggle(msg("Reverse free look"), "freeLookInvert", msg("The mouse's look turns the other way, up and down and left and right")),
      toggle(msg("Hold free look"), "freeLookHold", msg("A look stays where the mouse leaves it, without easing back")),
      sub(msg("Localization")),
      language, wording,
      foot(),
      // Each preset sets the draft; Save keeps it.
      el("div", { class: "opt-actions opt-presets" },
        preset(msg("MTM1 Classic preset"), applyMtm1Classic, "Monster Truck Madness 1 as it was: MTM1 sky, trucks apart, original backdrops shown, MTM1 particles and sounds with no dust or sparks, the 1996 physics, no terrain overlap, smooth textures, the MTM2 classic map with solid names, and the enhanced graphics off. Save to keep it."),
        preset(msg("MTM2 Classic preset"), applyMtm2Classic, "Monster Truck Madness 2 as it was: no MTM1 option, original backdrops, MTM2 classic dust (the game's few puffs), no sparks or water splashes, no CP3 HD weather or reflections, MTM2's water and truck reflections, backdrops, the MTM2 classic map with solid names, and the enhanced graphics off. Save to keep it."),
        preset(msg("OpenMTM2 preset"), applyOpenMtm2, "The port's own picture: no MTM1 or MTM2 option, the track backdrops, tire tracks, water splashes, normal dust puffs and sparks, every enhanced part including the glossy paint, CP3 terrain detail, HD weather and reflections, and the OpenMTM2 map with names at 50% transparency. Save to keep it.")),
    ]],
    [msg("Data"), [
      sub(msg("POD mounting")),
      el("p", { class: "muted" },
        t("OpenMTM2 reads the tracks and vehicles of Monster Truck Madness 1 and 2, CART Precision Racing and 4x4 Evolution 1 and 2. Add POD.INI reads another game folder's POD.INI and mounts every archive it lists. Reload POD.INI picks the game folder again (or another Monster Truck Madness 2 folder) and reads every archive its POD.INI lists afresh, in its order. The POD manager shows what is mounted, and adds single POD files from any game without the game being installed.")),
      el("div", { class: "opt-actions opt-data" },
        button(msg("POD manager"), async () => { (await import("./pod-manager.js")).openPodManager(context); })),
      offlineRow,
      sub(msg("POD.INI")),
      el("div", { class: "opt-actions opt-data" },
        button(msg("Add POD.INI"), async (event) => {
          const target = event.currentTarget;
          const [{ pickInstallFolder }, { inspectGameFolder }] = await Promise.all([import("../install/picker.js"), import("../install/inspect-source.js")]);
          const source = await pickInstallFolder();
          if (!source) return;
          const found = await inspectGameFolder(source);
          if (!found.ok) { await showAlert(t, t(found.message, ...(found.messageArgs ?? []))); return; }
          const label = target.textContent;
          target.disabled = true;
          const off = context.assets.on("install-progress", ({ copied, total, name }) => {
            target.textContent = t("Copying <<1>> <<2>>%", name, total ? Math.round((copied / total) * 100) : 100);
          });
          try {
            const done = await context.assets.call("addGameFolder", { label: found.label, files: found.files });
            const lines = [done.game ? t("<<1>> archives added from <<2>> (<<3>>).", done.added.length, found.label, done.game) : t("<<1>> archives added from <<2>>.", done.added.length, found.label)];
            if (found.missing?.length) lines.push(t("Listed but not in the folder: <<1>>.", found.missing.join(", ")));
            await showAlert(t, lines.join("\n"));
            window.location.reload();
          } catch (error) {
            await showAlert(t, t("Could not add the folder: <<1>>", error.message));
            target.textContent = label;
            target.disabled = false;
          } finally {
            off();
          }
        }, null, msg("Pick another game's folder: its POD.INI is read and every archive it lists is added beside the base install")),
        button(msg("Reload POD.INI"), (event) => reinstall(event.currentTarget), null,
          msg("Pick the Monster Truck Madness 2 folder again, or another one: its POD.INI is read and every archive it lists is copied again, changed or not, and mounted in the file's order"))),
      sub(msg("Settings")),
      el("div", { class: "opt-actions opt-data" },
        button(msg("Export settings"), () => exportOptions()),
        button(msg("Import settings"), () => importOptions())),
      sub(msg("MTM2 HOF")),
      el("div", { class: "opt-actions opt-data" },
        button(msg("Import drivers and Hall of Fame"), () => importGameSaves(), null,
          msg("Pick player.pro, MTM2 High Scores or both from the game's folder: their drivers and results are added to OpenMTM2's")),
        button(msg("Export drivers and Hall of Fame"), () => exportGameSaves(), null,
          msg("Save OpenMTM2's drivers and Hall of Fame as player.pro and MTM2 High Scores, for the game's folder"))),
      foot(),
      el("div", { class: "opt-actions opt-data" },
        el("button", { class: "danger", onclick: async (event) => {
          const target = event.currentTarget;
          if (!await showConfirm(t, t("Clear all OpenMTM2 data from this browser? This permanently removes the copied install, drivers, Hall of Fame entries and settings."))) return;
          target.disabled = true;
          try {
            // The copy of the app goes too; a page that is opened again with a server makes a new one.
            await context.offline?.remove();
            await context.assets.call("clearGameData");
            clearSettings();
            window.location.reload();
          } catch (error) {
            target.disabled = false;
            await showAlert(t, t("Could not clear the browser data: <<1>>", error.message));
          }
        } }, t("Clear browser game data"))),
    ]],
  ];
  // One category at a time, chosen from the tabs; the last one shown is remembered for the session.
  const pages = sections.map(([name, rows]) => el("div", { class: "opt-page" }, ...subTabbed(name, rows.filter(Boolean))));
  const tabs = sections.map(([name], i) => el("button", { class: "opt-tab", onclick: () => pick(i) }, t(name)));
  const pick = (i) => {
    context.optionsTab = i;
    pages.forEach((page, k) => { page.hidden = k !== i; });
    tabs.forEach((tab, k) => tab.classList.toggle("selected", k === i));
  };
  // Opened on a named tab (`tab`, its English name), else the last one shown.
  const named = tab ? sections.findIndex(([name]) => name === tab) : -1;
  pick(named >= 0 ? named : Math.min(context.optionsTab ?? 0, sections.length - 1));
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
      "Crash damage": () => settings.crashDamage !== false, "Wheels damage": () => !!settings.looseWheels && settings.crashDamage !== false,
      "Frame rate limit": () => (settings.fpsLimit ? settings.fpsLimitValue ?? 60 : 0),
      "CP3 HD weather": () => settings.hdWeather !== false, "MTM2 Caption bar": () => !!settings.captionBar, "OpenMTM2 font in-game": () => !!settings.systemFont,
      "Map line thickness": () => mapLineScale(settings.mapLineWidth), "Map transparency": () => mapTransparency(settings.mapTransparency), "Name transparency": () => nameTransparency(settings.nameTransparency), "Dust": () => dustLevel(settings), "Sparks": () => sparkLevel(settings), "Evo grass": () => grassLevel(settings),
    };
    // A slider's figure beside it, in its own words.
    const named = { "Dust": DUST_LEVEL_NAMES, "Sparks": SPARK_LEVEL_NAMES, "Evo grass": GRASS_LEVEL_NAMES };
    for (const control of container.querySelectorAll("input[data-opt], select[data-opt]")) {
      const label = control.getAttribute("data-opt");
      const value = toggleKeys.has(label) ? !!settings[toggleKeys.get(label)] : shown[label] ? shown[label]() : chooseKeys.has(label) ? settings[chooseKeys.get(label)] : undefined;
      if (value === undefined) continue;
      if (control.type === "checkbox") control.checked = !!value; else control.value = String(value);
      if (control.type === "range" && named[label] && control.nextElementSibling) control.nextElementSibling.textContent = t(named[label][value]);
      else if (control.type === "range" && sliderFormats.has(label) && control.nextElementSibling) control.nextElementSibling.textContent = t(sliderFormats.get(label)(Number(value)));
    }
    if (wheelsDamageInput) wheelsDamageInput.disabled = settings.crashDamage === false;
    showSoloChat();
    useSystemFont(!!settings.systemFont);
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
    window.removeEventListener("keydown", onPadEscape, true);
    stopPadListen();
    container.removeEventListener("change", onChange);
    offOffline?.();
  };
  /** For the dialog's own ways out (Escape, a click outside): the same question as the Close button. */
  cleanup.requestClose = () => { if (performance.now() - escapeAt > 200) close(); };
  return cleanup;
}
