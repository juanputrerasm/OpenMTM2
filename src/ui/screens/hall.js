/* Hall Of Fame: one selected track and the six columns already printed on the classic art. */
import { el } from "../dom.js";
import { getHall } from "../../app/profile-store.js";
import { TOURNAMENT_MODE, topFor, tournamentBoards } from "../../game/hall-of-fame.js";
import { formatRaceTime, ordinal } from "../../game/race-setup.js";
import { frame } from "../frame.js";
import { msg } from "../../game/strings.js";

const DIFFICULTIES = [msg("Rookie"), msg("Intermediate"), msg("Professional")];

export default async function mount(container, context) {
  // Loaded here, not at the top: the previews need three.js, which the pure parts of this file do not.
  const { createPreviewSlot } = await import("../truck-preview-slot.js");
  const { t } = context;
  const hall = await getHall(context);
  const catalog = await context.assets.call("catalog");
  // The tournaments that were finished are listed after the tracks, each a board of points totals.
  const tracks = [...catalog.tracks, ...tournamentBoards(hall).map(({ key, name }) => ({ file: key, name: `${name} (${t("tournament")})`, raceType: TOURNAMENT_MODE }))];
  let track = tracks.find((item) => item.file === context.settings.lastTrack) ?? tracks[0];
  const truckNames = new Map(catalog.trucks.map((item) => [item.file.toUpperCase(), item.name]));
  const picker = el("select", { "aria-label": t("Tracks"), class: "hall-track" },
    ...tracks.map((item) => el("option", { value: item.file, selected: item === track }, item.name)));
  const table = el("table", { class: "results hall-results" });
  const info = el("div", {}), stats = el("div", {});
  const slot = createPreviewSlot(context, { width: 388, height: 292, mode: "crown" });
  let selected = 0;
  const truckName = (entry) => truckNames.get(String(entry.truck).toUpperCase()) ?? String(entry.truck).replace(/\.TRK$/i, "");

  /** The selected entry's details and its crowned truck. */
  const showSelected = (rows) => {
    const entry = rows[selected];
    const line = (text) => el("div", { class: "winner-line" }, text);
    const stat = (label, value) => el("div", { class: "winner-line" }, el("span", { class: "winner-label" }, `${label}: `), value);
    if (!entry) { info.replaceChildren(); stats.replaceChildren(); slot.show(null); return; }
    info.replaceChildren(line(entry.name), line(truckName(entry)), line(context.t(DIFFICULTIES[entry.difficulty] ?? "")));
    stats.replaceChildren(
      stat(context.t("Points"), String(Number.isFinite(entry.points) ? entry.points : 0)),
      line(""),
      stat(context.t("Time"), Number.isFinite(entry.time) && entry.time > 0 ? formatRaceTime(entry.time) : ""));
    slot.show(entry.truck ? String(entry.truck) : null);
  };

  const show = (classic = false) => {
    const rows = track ? topFor(hall, track.file, track.raceType) : [];
    selected = Math.min(selected, Math.max(0, rows.length - 1));
    showSelected(rows);
    const head = classic ? [] : [el("thead", {}, el("tr", {}, ...[msg("Place"), msg("Player"), msg("Truck"), msg("Skill Level"), msg("Points"), msg("Time")].map((label) => el("th", {}, t(label)))))];
    table.replaceChildren(
      ...head, el("tbody", {}, ...rows.map((entry, index) => el("tr", {
        class: index === selected ? "selected" : null,
        onclick: () => { selected = index; show(classic); },
      },
        el("td", {}, t(ordinal(index + 1))),
        el("td", {}, entry.name),
        el("td", {}, truckName(entry)),
        el("td", {}, context.t(DIFFICULTIES[entry.difficulty] ?? "")),
        el("td", {}, Number.isFinite(entry.points) && entry.points > 0 ? String(entry.points) : ""),
        el("td", {}, Number.isFinite(entry.time) && entry.time > 0 ? formatRaceTime(entry.time) : ""),
      ))),
    );
  };
  picker.addEventListener("change", () => {
    track = tracks.find((item) => item.file === picker.value) ?? track;
    selected = 0;
    show(ui.art);
  });

  const ui = await frame(container, context, {
    title: msg("Hall Of Fame"), backdrop: "HALLFAME", bar: "hall",
    labels: [[msg("Tracks"), [26, 404, 54, 20]]],
    regions: {
      hallInfo: [62, 137, 160, 80], hallStats: [227, 137, 150, 80], hallPreview: [398, 75, 194, 146],
      table: [29, 264, 582, 124], tracks: [82, 401, 181, 25],
    },
  });
  show(ui.art);
  if (ui.classic) {
    ui.regions.hallInfo.append(info);
    ui.regions.hallStats.append(stats);
    if (slot.canvas) ui.regions.hallPreview.append(slot.canvas);
    ui.regions.table.append(table);
    ui.regions.tracks.append(picker);
  } else {
    ui.regions.table.append(el("label", {}, `${t("Tracks")} `, picker), table,
      el("div", { class: "screen-actions" }, el("button", {
        class: "primary", "data-menu-sound": "STARTOFF", onclick: () => context.router.back(),
      }, t("Back"))));
  }
  return { unmount() { slot.dispose(); ui.unmount?.(); } };
}
