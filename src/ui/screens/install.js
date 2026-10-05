/*
  First run: pick the MTM2 folder, check it, copy its archives into the browser.
*/
import { el } from "../dom.js";
import { pickInstallFolder } from "../../install/picker.js";
import { inspectSource } from "../../install/inspect-source.js";
import { loadStrings } from "../../app/strings-store.js";
import { primeMenuAudio, startMenuAudio } from "../../app/menu-audio.js";

const MB = 1024 * 1024;

export default function mount(container, context) {
  const status = el("p", { class: "muted" },
    "OpenMTM2 reads the tracks, trucks, art and sounds from your own Monster Truck Madness 2 "
    + "install. Pick the folder it is installed in (the one holding MONSTER.EXE and POD.INI). "
    + "Its archives are copied once into this browser's private storage; nothing is uploaded.");
  const detail = el("div");
  const pickButton = el("button", { class: "primary", onclick: pick }, "Choose game folder");
  const actions = el("div", { class: "screen-actions" }, pickButton);

  container.append(
    el("section", { class: "screen" },
      el("h1", { class: "screen-title" }, "Install"),
      el("div", { class: "screen-panel" }, status, detail, actions),
    ),
  );

  let busy = false;

  async function pick() {
    if (busy) return;
    primeMenuAudio(context);
    busy = true;
    pickButton.disabled = true;
    try {
      const source = await pickInstallFolder();
      if (!source) return;
      show(`Checking ${source.name || "the folder"}…`);
      const result = await inspectSource(source);
      if (!result.files?.length || (!result.ok && !result.missing?.length)) {
        show(result.message, "error");
        return;
      }
      await confirmAndCopy(result);
    } catch (err) {
      show(`Could not read the folder: ${err.message}`, "error");
    } finally {
      busy = false;
      pickButton.disabled = false;
    }
  }

  async function confirmAndCopy(result) {
    const needed = result.totalBytes;
    const estimate = await navigator.storage.estimate?.().catch(() => null);
    const free = estimate ? estimate.quota - estimate.usage : Infinity;
    detail.replaceChildren(
      el("p", { class: result.ok ? "" : "error" }, result.message),
      el("p", { class: "muted" },
        `${result.files.length} archives, ${(needed / MB).toFixed(0)} MB to copy.`),
    );
    if (free < needed * 1.1) {
      show(`The browser offers ${(free / MB).toFixed(0)} MB of storage, not enough for the game's `
        + `${(needed / MB).toFixed(0)} MB.`, "error");
      return;
    }
    await navigator.storage.persist?.().catch(() => false);

    const bar = el("span");
    const label = el("p", { class: "muted" }, "Copying…");
    detail.append(el("div", { class: "progress" }, bar), label);
    const off = context.assets.on("install-progress", ({ copied, total, name }) => {
      bar.style.width = `${((copied / total) * 100).toFixed(1)}%`;
      label.textContent = `Copying ${name}: ${(copied / MB).toFixed(0)} of ${(total / MB).toFixed(0)} MB`;
    });
    try {
      await context.assets.call("install", {
        files: result.files,
        podIni: result.podIni,
        build: result.build,
        exe: result.exe,
        exeFile: result.exeFile,
      });
    } finally {
      off();
    }
    await loadStrings(context);
    startMenuAudio(context);
    await context.router.go("start", {}, { replace: true });
  }

  function show(message, kind = "muted") {
    status.className = kind;
    status.textContent = message;
  }
}
