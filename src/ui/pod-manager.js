/*
  The POD manager: every archive mounted in the game's file system, in mount order, with the game
  it was read as and where it came from (worker/addon-store.js).

  Archives can be added from any game without that game being installed, removed again (the MTM2
  install's own are changed with Reload POD.INI), and moved: when two archives of one game hold
  the same file, the one mounted first wins. A change takes effect when the dialog closes, which
  reloads the page as Reload POD.INI does.
*/
import { el } from "./dom.js";

const megabytes = (bytes) => (bytes == null ? "" : `${(bytes / 1048576).toFixed(1)} MB`);

function pickPodFiles() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".pod,.epd";
    input.addEventListener("change", () => resolve(input.files?.length ? [...input.files] : null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

export async function openPodManager(context) {
  let pods = [];
  let changed = false;
  let busy = false;
  const body = el("tbody");
  const status = el("span", { class: "muted options-status" });
  const addButton = el("button", { "data-menu-sound": "STARTOFF", onclick: add }, "Add PODs");
  const dialog = el("dialog", { class: "options-modal pod-manager", "aria-label": "POD manager" },
    el("div", { class: "options-modal-title" }, el("h1", {}, "POD manager")),
    el("div", { class: "options-modal-panel" },
      el("p", { class: "muted" }, "Mounted archives, first mounted first: among archives of one game, a file is taken from the first that has it."),
      el("div", { class: "pod-manager-list" }, el("table", {},
        el("thead", {}, el("tr", {},
          el("th", { class: "num" }, "#"), el("th", {}, "Archive"), el("th", {}, "Game"), el("th", {}, "From"), el("th", {}, "Format"),
          el("th", { class: "num" }, "Files"), el("th", { class: "num" }, "Tracks"), el("th", { class: "num" }, "Size"), el("th", {}))),
        body)),
      el("div", { class: "options-footer" }, status, addButton,
        el("button", { class: "primary", onclick: () => dialog.close() }, "Close"))));

  /** Run one change against the asset worker, then list again. */
  async function run(text, work) {
    if (busy) return;
    busy = true;
    addButton.disabled = true;
    status.textContent = text;
    try {
      const said = await work();
      changed = true;
      status.textContent = said ?? "";
    } catch (error) {
      status.textContent = error.message;
    }
    busy = false;
    addButton.disabled = false;
    await refresh();
  }

  async function refresh() {
    try {
      pods = await context.assets.call("podList");
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    const move = (i, by) => run("Moving...", async () => {
      const keys = pods.map((p) => p.key);
      [keys[i], keys[i + by]] = [keys[i + by], keys[i]];
      await context.assets.call("setMountOrder", { keys });
    });
    body.replaceChildren(...pods.map((pod, i) => el("tr", {},
      el("td", { class: "num" }, String(i + 1)), el("td", {}, pod.name), el("td", {}, pod.game ?? "?"), el("td", {}, pod.source),
      el("td", {}, pod.format.toUpperCase()), el("td", { class: "num" }, String(pod.entries)), el("td", { class: "num" }, String(pod.tracks)),
      el("td", { class: "num" }, megabytes(pod.size)),
      el("td", { class: "pod-actions" },
        el("button", { title: "Mount earlier", disabled: i === 0, onclick: () => move(i, -1) }, "Up"),
        el("button", { title: "Mount later", disabled: i === pods.length - 1, onclick: () => move(i, 1) }, "Down"),
        pod.removable && el("button", { class: "danger", onclick: () => run(`Removing ${pod.name}...`, async () => {
          await context.assets.call("removePod", { key: pod.key });
          return `${pod.name} removed.`;
        }) }, "Remove")))));
  }

  async function add() {
    const files = await pickPodFiles();
    if (!files) return;
    const off = context.assets.on("install-progress", ({ copied, total, name }) => {
      status.textContent = `Copying ${name} ${total ? Math.round((copied / total) * 100) : 100}%`;
    });
    await run("Copying...", async () => {
      const done = await context.assets.call("addPods", { files });
      const said = [`${done.added.length} added`];
      if (done.skipped) said.push(`${done.skipped} already there`);
      if (done.failed.length) said.push(done.failed.join(" "));
      return `${said.join(", ")}.`;
    });
    off();
  }

  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    dialog.remove();
    // The catalogue and everything loaded from the archives are stale: start again, as Reload POD.INI does.
    if (changed) window.location.reload();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  await refresh();
}
