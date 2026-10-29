/*
  The jukebox (Options, Sound): the music of the mounted archives (worker/jukebox-list.js), each piece once, in an
  order the player sets by dragging a row or with Up and Down. Play starts it: it then plays piece after piece in the
  menus and in races in place of the game's music (audio/jukebox.js), until Stop gives the game its music back. A piece
  unticked is left out. Everything takes effect at once and is kept in this browser (game/jukebox.js).
*/
import { el } from "./dom.js";
import { showAlert } from "./dialogs.js";
import { moveEntry } from "../game/jukebox.js";
import { msg } from "../game/strings.js";

const clock = (seconds) => {
  if (!Number.isFinite(seconds)) return "-:--";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export async function openJukebox(context) {
  const { t } = context;
  const jukebox = context.jukebox;
  if (!jukebox) {
    await showAlert(t, t("The jukebox plays the installed game's music: install the game first."));
    return;
  }
  let entries = [];
  const body = el("tbody");
  const nowPlaying = el("span", { class: "jukebox-now" });
  const time = el("span", { class: "jukebox-time muted" });
  const control = (label, title, onclick) => el("button", { type: "button", "data-menu-sound": "STARTOFF", title: t(title), onclick }, t(label));
  const playButton = control(msg("Play"), msg("Play the list, in place of the game's music"), () => {
    const { on, paused } = jukebox.status();
    if (on && !paused) jukebox.pause();
    else jukebox.play();
  });
  playButton.classList.add("primary");
  const stopButton = control(msg("Stop"), msg("Stop the jukebox: the menus and the tracks play their own music again"), () => jukebox.stop());
  const dialog = el("dialog", { class: "options-modal jukebox", "aria-label": t("Jukebox") },
    el("div", { class: "options-modal-title" }, el("h1", {}, t("Jukebox"))),
    el("div", { class: "options-modal-panel" },
      el("p", { class: "muted" }, t("The music of the mounted archives, each piece once. Play plays it piece after piece, in the menus and in races, in place of the game's music. Drag a piece or use Up and Down to set the order; untick one to leave it out.")),
      el("div", { class: "jukebox-player" },
        control(msg("Previous"), msg("The piece before"), () => jukebox.previous()), playButton,
        control(msg("Next"), msg("The next piece"), () => jukebox.next()), stopButton, nowPlaying, time),
      el("div", { class: "jukebox-list" }, el("table", {},
        el("thead", {}, el("tr", {},
          el("th", { class: "num" }, "#"), el("th", {}, t("Play")), el("th", {}, t("Music")), el("th", {}, t("Format")),
          el("th", {}, t("Played on")), el("th", {}))),
        body)),
      el("div", { class: "options-footer" }, el("button", { class: "primary", onclick: () => dialog.close() }, t("Close")))));

  const nameOf = (entry) => `${entry.stem}.${entry.kind === "mod" ? "MOD" : entry.format.toUpperCase()}`;
  const usesOf = (entry) => [...(entry.menu ? [t("Menus")] : []), ...entry.tracks].join(", ");

  /** Put the order to use: the ids as the rows show them. */
  const reorder = (from, to) => {
    if (from === to || from < 0 || to < 0) return;
    jukebox.setOrder(moveEntry(entries.map((e) => e.id), from, Math.min(to, entries.length - 1)));
    showList();
  };

  let dragging = -1;
  async function showList() {
    entries = await jukebox.list();
    const { current, skip } = jukebox.status();
    const skipped = new Set(skip);
    body.replaceChildren(...entries.map((entry, i) => el("tr", {
      class: entry.id === current ? "jukebox-current" : null, draggable: "true",
      ondragstart: (event) => { dragging = i; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", entry.id); },
      ondragover: (event) => { if (dragging >= 0) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } },
      ondrop: (event) => { event.preventDefault(); const from = dragging; dragging = -1; reorder(from, i); },
      ondragend: () => { dragging = -1; },
    },
      el("td", { class: "num" }, String(i + 1)),
      el("td", {}, el("input", {
        type: "checkbox", checked: !skipped.has(entry.id), "aria-label": t("Play <<1>>", nameOf(entry)),
        onchange: (event) => jukebox.setSkipped(entry.id, !event.target.checked),
      })),
      el("td", {}, nameOf(entry)),
      el("td", {}, entry.kind === "mod" ? "MOD" : entry.format.toUpperCase()),
      el("td", { class: "jukebox-uses", title: usesOf(entry) }, usesOf(entry)),
      el("td", { class: "pod-actions" },
        el("button", { type: "button", title: t("Play this piece now"), onclick: () => jukebox.play(entry.id) }, t("Play")),
        el("button", { type: "button", title: t("Earlier in the list"), disabled: i === 0, onclick: () => reorder(i, i - 1) }, t("Up")),
        el("button", { type: "button", title: t("Later in the list"), disabled: i === entries.length - 1, onclick: () => reorder(i, i + 1) }, t("Down"))))));
    if (!entries.length) body.replaceChildren(el("tr", {}, el("td", { colspan: "6", class: "muted" }, t("No music in the mounted archives."))));
    showPlayer();
  }

  function showPlayer() {
    const { on, paused, loading, current, position, duration } = jukebox.status();
    const entry = entries.find((e) => e.id === current);
    playButton.textContent = on && !paused ? t("Pause") : t("Play");
    stopButton.disabled = !on;
    nowPlaying.textContent = !on ? t("Off: the game plays its own music.")
      : loading ? t("Loading <<1>>...", entry ? nameOf(entry) : "")
      : entry ? (paused ? t("Paused: <<1>>", nameOf(entry)) : t("Playing: <<1>>", nameOf(entry))) : "";
    time.textContent = on && entry && !loading ? `${clock(position)} / ${clock(duration)}` : "";
    for (const [i, row] of [...body.rows].entries()) row.classList.toggle("jukebox-current", entries[i]?.id === current);
  }

  const unsubscribe = jukebox.subscribe(showPlayer);
  const ticker = setInterval(showPlayer, 500);
  dialog.addEventListener("close", () => { unsubscribe(); clearInterval(ticker); dialog.remove(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  await showList();
}
