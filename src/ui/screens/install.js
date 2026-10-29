/*
  Setup, the first screen of a new player: the language, the graphics, and where the game's files come from.

  The files come one of three ways, each copied once into the browser's private storage:
  - the player's Monster Truck Madness 2 folder (the one holding POD.INI);
  - a file: a disc image (.ISO) or a zip the player made from their own copy, or the trial's zip or installer
    (install/media/media-source.js);
  - the free trial, downloaded with one click (install/trial.js): the app's own copy, else the Internet Archive's.
  The trial's license is shown, and must be accepted, before it is installed.

  Where the page's own server also serves the player's game folder (tools/serve.mjs --game), the screen offers to install
  from there too: a headset's browser has no folder of the player's PC to pick (docs/VR.md, "Running it on a headset").
*/
import { el } from "../dom.js";
import { pickInstallFolder } from "../../install/picker.js";
import { inspectSource } from "../../install/inspect-source.js";
import { requiredPodsMessage } from "../../install/required-pods.js";
import { hasServedGame, installEntry, mayServeGame, urlSource } from "../../install/url-source.js";
import { openMedia } from "../../install/media/media-source.js";
import { downloadTrial, TRIAL } from "../../install/trial.js";
import { loadStrings } from "../../app/strings-store.js";
import { primeMenuAudio, startMenuAudio } from "../../app/menu-audio.js";
import {
  LANGUAGES, SETUP_GRAPHICS, applySetupGraphics, detectLanguage, hasSavedSettings, languageOf, saveSettings, setupGraphicsOf,
} from "../../app/settings.js";

const MB = 1024 * 1024;
const ISSUES = "https://github.com/juanputrerasm/OpenMTM2/issues";
const FILE_TYPES = ".zip,.iso,.exe,.cab";

export default async function mount(container, context, { requiredMissing = [] } = {}) {
  const settings = context.settings;
  // A first start: the browser's language, and the enhanced graphics, until the player picks otherwise.
  const firstStart = !hasSavedSettings();
  if (!settings.language) settings.language = detectLanguage(globalThis.navigator?.languages);
  if (firstStart) applySetupGraphics(settings, "enhanced");
  saveSettings(settings);
  await loadStrings(context);
  const t = (tag, ...args) => (context.t ? context.t(tag, ...args) : tag);

  let busy = false;
  let abort = null;
  let served = false;
  let lastStatus = null;
  const servedUrl = new URL("game/", document.baseURI).href;

  // The parts that keep their state across a re-render.
  const status = el("p", { class: "muted setup-status", hidden: true });
  const detail = el("div");
  const bar = el("span");
  const progressLabel = el("p", { class: "muted" });
  const cancelButton = el("button", { onclick: () => abort?.abort() }, t("Cancel"));
  const progress = el("div", { class: "setup-progress", hidden: true }, el("div", { class: "progress" }, bar), progressLabel, cancelButton);

  const root = el("section", { class: "screen setup" });
  container.append(root);
  render();
  if (requiredMissing.length) show(requiredPodsMessage(requiredMissing, t), "error");
  (mayServeGame(location.hostname) ? hasServedGame(servedUrl) : Promise.resolve(false)).then((yes) => {
    served = yes;
    if (yes && !busy) render();
  });

  /** The whole screen, in the language in force. Called again when the language changes. */
  function render() {
    const language = el("select", { id: "setup-language", onchange: async (event) => {
      settings.language = event.target.value;
      saveSettings(settings);
      await loadStrings(context);
      render();
    } }, LANGUAGES.map(({ id, label }) => el("option", { value: id, selected: id === languageOf(settings) }, label)));
    const graphicsNow = setupGraphicsOf(settings);
    const graphics = el("select", { id: "setup-graphics", onchange: (event) => {
      applySetupGraphics(settings, event.target.value);
      saveSettings(settings);
    } }, SETUP_GRAPHICS.map((id) => el("option", { value: id, selected: id === graphicsNow }, id === "enhanced" ? t("Enhanced") : t("Standard"))));

    // The game's videos (VIDEOS, about 155 MB) are copied only when asked for (game/videos.js).
    const videos = el("input", { type: "checkbox", id: "setup-videos", checked: !!settings.copyVideos, onchange: (event) => {
      settings.copyVideos = event.target.checked;
      saveSettings(settings);
    } });

    const fileInput = el("input", { type: "file", accept: FILE_TYPES, hidden: true, onchange: () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) run(() => fromFile(file, file.name));
    } });

    root.replaceChildren(
      el("h1", { class: "screen-title setup-title" }, t("Welcome to OpenMTM2")),
      el("div", { class: "screen-panel setup-panel", ondragover: (event) => event.preventDefault(), ondrop: onDrop },
        el("p", { class: "muted" }, t("A fan remake of Monster Truck Madness 2 that runs in your browser.")),
        el("div", { class: "setup-choices" },
          el("label", { class: "setup-choice" }, el("span", {}, t("Language")), language),
          el("label", { class: "setup-choice" }, el("span", {}, t("Graphics")), graphics),
          el("label", { class: "setup-choice setup-check" }, el("span", {}, t("Copy the game's videos")), videos),
        ),
        el("p", { class: "muted setup-hint" }, t("Enhanced uses every visual improvement. Standard keeps the game's own look and runs on any computer. Both can be fine-tuned later in Options.")),

        el("h2", { class: "setup-heading" }, t("Have the game?")),
        el("div", { class: "screen-actions" },
          served ? el("button", { class: "primary", onclick: () => run(() => install(urlSource(servedUrl))) }, t("Install from this server")) : null,
          el("button", { class: served ? "" : "primary", onclick: () => { if (!pickerAllowed()) return; run(fromFolder); } }, t("Choose MTM2 folder")),
          el("button", { onclick: () => { if (pickerAllowed()) fileInput.click(); } }, t("Choose ISO or ZIP file")),
          fileInput,
        ),
        el("p", { class: "muted setup-note" }, t("Use only files from a copy of the game you own. Your use stays subject to the game's End User License Agreement. Nothing is uploaded: the files are copied into this browser only.")),

        el("h2", { class: "setup-heading" }, t("Don't have it?")),
        el("div", { class: "screen-actions" },
          el("button", { class: "primary", onclick: () => run(fromTrial) }, t("Play the free trial (18 MB)")),
        ),
        el("p", { class: "muted setup-note" }, t("Downloads Microsoft's free 1998 trial (Includes the track 'Farm Road 29' and four trucks) into this browser. It is provided as-is under its original license, which is shown before it installs.")),

        status,
        detail,
        progress,

        el("details", { class: "setup-legal" },
          el("summary", {}, t("Legal notice")),
          el("p", {}, t("OpenMTM2 is an unofficial fan project, not affiliated with or endorsed by Microsoft, Terminal Reality or any truck owner. It includes no game files other than the unmodified Monster Truck Madness 2 trial, which its license allows to be passed on free of charge.")),
          el("p", {}, t("Monster Truck Madness 2 is © 1998 Microsoft Corporation and Terminal Reality. Truck names and logos are trademarks of their owners.")),
          el("p", {}, withLink(t("If you are a rights holder and object to anything here, <<1>> and it will be changed or removed."), t("open an issue on GitHub"), ISSUES)),
          el("p", {}, withLink(t("The trial also comes from the Internet Archive: <<1>>."), t("its page"), TRIAL.page)),
        ),
      ),
    );
    cancelButton.textContent = t("Cancel");
    for (const node of root.querySelectorAll("button, select, input")) node.disabled = busy && node !== cancelButton;
    if (lastStatus) show(...lastStatus);
  }

  /** Run one way of getting the files, with every control off until it ends. */
  async function run(task) {
    if (busy) return;
    primeMenuAudio(context);
    busy = true;
    lastStatus = null;
    status.hidden = true;
    detail.replaceChildren();
    render();
    try {
      await task();
    } catch (err) {
      if (err?.name === "AbortError") show(t("Download cancelled."), "muted");
      else show(err?.message ?? String(err), "error");
    } finally {
      busy = false;
      abort = null;
      progress.hidden = true;
      render();
    }
  }

  async function fromFolder() {
    const source = await pickInstallFolder();
    if (source) await install(source);
  }

  async function fromFile(blob, name) {
    show(t("Opening <<1>>…", name));
    const source = await openMedia(blob, name, { onProgress: unpacking });
    await install(source);
  }

  async function fromTrial() {
    abort = new AbortController();
    const started = performance.now();
    showProgress(0, t("Connecting…"), true);
    const zip = await downloadTrial({
      signal: abort.signal,
      onProgress: ({ loaded, total, source }) => showProgress(loaded / total, downloadLabel(loaded, total, source, started), true),
    });
    abort = null;
    await fromFile(zip, "MtM2trial.zip");
  }

  function unpacking(phase, done, total) {
    showProgress(done / total, t("Unpacking… <<1>>%", Math.round((done / total) * 100)), false);
  }

  function downloadLabel(loaded, total, source, started) {
    const seconds = (performance.now() - started) / 1000;
    const rate = seconds > 1 ? loaded / seconds : 0;
    const text = t("Downloading from <<1>>: <<2>> of <<3>> MB", t(source), (loaded / MB).toFixed(1), (total / MB).toFixed(0));
    if (!rate || loaded >= total) return text;
    const left = Math.max(1, Math.round((total - loaded) / rate));
    return `${text}, ${left >= 90 ? t("about <<1>> min left", Math.round(left / 60)) : t("about <<1>> s left", left)}`;
  }

  /** Check what the source holds, show the trial's license when it is the trial, then copy it. */
  async function install(source) {
    show(t("Checking <<1>>…", source.name || t("the folder")));
    const result = await inspectSource(source);
    if (!result.files?.length || (!result.ok && !result.missing?.length)) {
      show(t(result.message, ...(result.messageArgs ?? [])), "error");
      return;
    }
    if (result.edition === "trial" && !await acceptLicense(source)) {
      show(t("The trial was not installed: its license was not accepted."), "muted");
      return;
    }
    await confirmAndCopy(result);
  }

  /** The trial's own EULA, from its files (else the copy beside the app), with Accept and Decline. */
  async function acceptLicense(source) {
    progress.hidden = true;
    const file = await source.getFile("EULA.TXT");
    const text = file ? await file.text() : await fetch(new URL("assets/trial/EULA.txt", document.baseURI)).then((r) => r.text()).catch(() => "");
    return new Promise((resolve) => {
      const done = (yes) => { detail.replaceChildren(); resolve(yes); };
      show(t("Microsoft's license for the trial. Read it, then accept it to install."));
      detail.replaceChildren(
        el("pre", { class: "setup-eula", tabindex: "0" }, text.replace(/\r\n/g, "\n")),
        el("div", { class: "screen-actions" },
          el("button", { class: "primary", onclick: () => done(true) }, t("I accept")),
          el("button", { onclick: () => done(false) }, t("Decline")),
        ),
      );
    });
  }

  async function confirmAndCopy(result) {
    const needed = result.totalBytes + (settings.copyVideos ? (result.videos ?? []).reduce((sum, f) => sum + (f.file.size ?? 0), 0) : 0);
    const estimate = await navigator.storage.estimate?.().catch(() => null);
    const free = estimate ? estimate.quota - estimate.usage : Infinity;
    show(t(result.message, ...(result.messageArgs ?? [])), result.ok ? "muted" : "error");
    if (free < needed * 1.1) {
      show(t("The browser offers <<1>> MB of storage, not enough for the game's <<2>> MB.", (free / MB).toFixed(0), (needed / MB).toFixed(0)), "error");
      return;
    }
    await navigator.storage.persist?.().catch(() => false);
    showProgress(0, t("Copying…"), false);
    const off = context.assets.on("install-progress", ({ copied, total, name }) => {
      showProgress(copied / total, t("Copying <<1>>: <<2>> of <<3>> MB", name, (copied / MB).toFixed(0), (total / MB).toFixed(0)), false);
    });
    try {
      await context.assets.call("install", {
        // A served archive goes to the worker as its address: the worker downloads it.
        files: result.files.map(({ name, file }) => ({ name, file: installEntry(file) })),
        podIni: result.podIni,
        exeVersion: result.exeVersion ?? null,
        edition: result.edition ?? "full",
        // Community Patch 3's loose WeatherArt folder (worker/weather-art.js).
        weatherArt: (result.weatherArt ?? []).map(({ name, file }) => ({ name, file: installEntry(file) })),
        // The game's videos and the EXTRAS.INI that lists them (game/videos.js).
        // Only when the setup's "Copy the game's videos" is ticked (off by default).
        videos: settings.copyVideos ? (result.videos ?? []).map(({ name, file }) => ({ name, file: installEntry(file) })) : [],
      });
      context.exeVersion = result.exeVersion ?? null;
    } finally {
      off();
    }
    saveSettings(settings);
    await loadStrings(context);
    startMenuAudio(context);
    await context.router.go("start", {}, { replace: true });
    // With the game in, a copy of the app is all a start without the server needs.
    context.offlineNote?.check();
  }

  /** A file dropped on the panel: the same as choosing it. A folder has to go through the folder button. */
  function onDrop(event) {
    event.preventDefault();
    if (busy) return;
    const item = event.dataTransfer?.items?.[0];
    if (item?.webkitGetAsEntry?.()?.isDirectory) {
      show(t("To use a folder, click 'Choose MTM2 folder'."), "muted");
      return;
    }
    const file = event.dataTransfer?.files?.[0];
    if (file) run(() => fromFile(file, file.name));
  }

  function showProgress(fraction, label, cancellable) {
    progress.hidden = false;
    bar.style.width = `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`;
    progressLabel.textContent = label;
    cancelButton.hidden = !cancellable;
    cancelButton.disabled = false;
  }

  /**
   * Whether the browser will open its file window now: only for a press of the mouse, a key or a touch, never for a
   * gamepad's (ui/gamepad-nav.js). Otherwise the player is told so.
   */
  function pickerAllowed() {
    if (!navigator.userActivation || navigator.userActivation.isActive) return true;
    show(t("Choosing a folder or a file needs a mouse, a keyboard or a touch: the browser opens its file window only for those. With a gamepad alone, play the free trial."));
    return false;
  }

  function show(message, kind = "muted") {
    lastStatus = [message, kind];
    status.hidden = false;
    status.className = `${kind} setup-status`;
    status.textContent = message;
  }
}

/** `text` with its `<<1>>` made a link. */
function withLink(text, label, href) {
  const [before, after = ""] = String(text).split("<<1>>");
  return [before, el("a", { href, target: "_blank", rel: "noopener" }, label), after];
}
