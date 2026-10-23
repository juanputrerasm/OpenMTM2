/*
  The POD manager: every archive mounted in the game's file system, in mount order, with the game
  it was read as and where it came from (worker/addon-store.js).

  Archives can be added from any game without that game being installed, removed again, and moved:
  when two archives of one game hold the same file, the one mounted first wins. Every archive is
  optional but the ones OpenMTM2 needs (install/required-pods.js); one of the base install's that is
  removed stays copied, and Reload POD.INI mounts it again. A change takes effect when the dialog closes:
  the screen underneath reads the fresh catalogue, with no page reload.
*/
import { el } from "./dom.js";
import { isZipName, podsInZip } from "../shared/zip.js";
import { refreshAfterPodChange } from "./pod-refresh.js";

const megabytes = (bytes) => (bytes == null ? "" : `${(bytes / 1048576).toFixed(1)} MB`);

function pickPodFiles() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".pod,.epd,.zip,.lte";
    input.addEventListener("change", () => resolve(input.files?.length ? [...input.files] : null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

export async function openPodManager(context) {
  const { t } = context;
  let pods = [];
  let changed = false;
  let busy = false;
  const body = el("tbody");
  const status = el("span", { class: "muted options-status" });
  const addButton = el("button", { "data-menu-sound": "STARTOFF", onclick: add, title: t("Add POD files, ZIP files (every POD a ZIP holds is added) or 4x4 Evolution Lite tracks (.LTE)") }, t("Add PODs"));
  const dialog = el("dialog", { class: "options-modal pod-manager", "aria-label": t("POD manager") },
    el("div", { class: "options-modal-title" }, el("h1", {}, t("POD manager"))),
    el("div", { class: "options-modal-panel" },
      el("p", { class: "muted" }, t("Mounted archives, first mounted first: among archives of one game, a file is taken from the first that has it.")),
      el("div", { class: "pod-manager-list" }, el("table", {},
        el("thead", {}, el("tr", {},
          el("th", { class: "num" }, "#"), el("th", {}, t("Archive")), el("th", {}, t("Game")), el("th", {}, t("From")), el("th", {}, t("Format")),
          el("th", { class: "num" }, t("Files")), el("th", { class: "num" }, t("Tracks")), el("th", { class: "num" }, t("Trucks")),
          el("th", { class: "num" }, t("Size")), el("th", {}))),
        body)),
      el("div", { class: "options-footer" }, status, addButton,
        el("button", { class: "primary", onclick: () => dialog.close() }, t("Close")))));

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
    const move = (i, by) => run(t("Moving..."), async () => {
      const keys = pods.map((p) => p.key);
      [keys[i], keys[i + by]] = [keys[i + by], keys[i]];
      await context.assets.call("setMountOrder", { keys });
    });
    body.replaceChildren(...pods.map((pod, i) => el("tr", {},
      el("td", { class: "num" }, String(i + 1)), el("td", {}, pod.name), el("td", {}, pod.game ?? "?"), el("td", {}, pod.source),
      el("td", {}, pod.format.toUpperCase()), el("td", { class: "num" }, String(pod.entries)), el("td", { class: "num" }, String(pod.tracks)),
      el("td", { class: "num" }, String(pod.trucks ?? 0)), el("td", { class: "num" }, megabytes(pod.size)),
      el("td", { class: "pod-actions" },
        el("button", { title: t("Mount earlier"), disabled: i === 0, onclick: () => move(i, -1) }, t("Up")),
        el("button", { title: t("Mount later"), disabled: i === pods.length - 1, onclick: () => move(i, 1) }, t("Down")),
        pod.removable && el("button", {
          class: "danger", title: pod.install ? t("Unmount it: it stays copied, and Reload POD.INI (Options, Data) mounts it again") : t("Delete it from this browser"),
          onclick: () => run(t("Removing <<1>>...", pod.name), async () => {
            await context.assets.call("removePod", { key: pod.key });
            return pod.install ? t("<<1>> removed until Reload POD.INI.", pod.name) : t("<<1>> removed.", pod.name);
          }),
        }, t("Remove")),
        pod.install && !pod.removable && el("span", { class: "muted", title: t("OpenMTM2 needs this archive to run") }, t("Required"))))));
  }

  /** The picked files with each ZIP opened: every POD it holds is added in its place (shared/zip.js). */
  async function expandZips(files) {
    const out = [], problems = [];
    for (const file of files) {
      if (!isZipName(file.name)) { out.push(file); continue; }
      try {
        const pods = await podsInZip(new Uint8Array(await file.arrayBuffer()));
        if (!pods.length) problems.push(t("<<1>> holds no POD.", file.name));
        for (const pod of pods) out.push(new File([pod.bytes], pod.name, { lastModified: file.lastModified }));
      } catch (error) {
        problems.push(`${file.name}: ${error.message}.`);
      }
    }
    return { files: out, problems };
  }

  async function add() {
    const picked = await pickPodFiles();
    if (!picked) return;
    status.textContent = picked.some((file) => isZipName(file.name)) ? t("Opening the ZIP files...") : status.textContent;
    const { files, problems } = await expandZips(picked);
    if (!files.length) { status.textContent = problems.join(" ") || t("Nothing to add."); return; }
    const off = context.assets.on("install-progress", ({ copied, total, name }) => {
      status.textContent = t("Copying <<1>> <<2>>%", name, total ? Math.round((copied / total) * 100) : 100);
    });
    await run(t("Copying..."), async () => {
      const done = await context.assets.call("addPods", { files });
      const said = [t("<<1>> added", done.added.length - (done.replaced?.length ?? 0))];
      if (done.replaced?.length) said.push(t("<<1>> read again (<<2>>)", done.replaced.length, done.replaced.join(", ")));
      if (done.failed.length) said.push(done.failed.join(" "));
      if (problems.length) said.push(problems.join(" "));
      return `${said.join(", ")}.`;
    });
    off();
  }

  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    dialog.remove();
    // The catalogue is rebuilt and the screen under the dialog reads it again. Only a refresh
    // that fails falls back to a reload, which is what the manager did before.
    if (changed) refreshAfterPodChange(context).catch(() => window.location.reload());
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  await refresh();
}
