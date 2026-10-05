/* Hall Of Fame: one selected track and the six columns already printed on the classic art. */
import { el } from "../dom.js";
import { getHall } from "../../app/profile-store.js";
import { topFor } from "../../game/hall-of-fame.js";
import { formatRaceTime, ordinal } from "../../game/race-setup.js";
import { frame } from "../frame.js";

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];

export default async function mount(container, context) {
  const hall = await getHall(context);
  const catalog = await context.assets.call("catalog");
  const tracks = catalog.tracks;
  let track = tracks.find((item) => item.file === context.settings.lastTrack) ?? tracks[0];
  const truckNames = new Map(catalog.trucks.map((item) => [item.file.toUpperCase(), item.name]));
  const picker = el("select", { "aria-label": "Tracks", class: "hall-track" },
    ...tracks.map((item) => el("option", { value: item.file, selected: item === track }, item.name)));
  const table = el("table", { class: "results hall-results" });

  const show = (classic = false) => {
    const rows = track ? topFor(hall, track.file, track.raceType) : [];
    const head = classic ? [] : [el("thead", {}, el("tr", {}, ...["Place", "Player", "Truck", "Skill Level", "Points", "Time"].map((label) => el("th", {}, label))))];
    table.replaceChildren(
      ...head, el("tbody", {}, ...rows.map((entry, index) => el("tr", {},
        el("td", {}, ordinal(index + 1)),
        el("td", {}, entry.name),
        el("td", {}, truckNames.get(String(entry.truck).toUpperCase()) ?? String(entry.truck).replace(/\.TRK$/i, "")),
        el("td", {}, context.t(DIFFICULTIES[entry.difficulty] ?? "")),
        el("td", {}, entry.mode === "summit" && Number.isFinite(entry.points) ? String(entry.points) : ""),
        el("td", {}, Number.isFinite(entry.time) && entry.time > 0 ? formatRaceTime(entry.time) : ""),
      ))),
    );
  };
  picker.addEventListener("change", () => {
    track = tracks.find((item) => item.file === picker.value) ?? track;
    show(table.closest(".stage") !== null);
  });

  const ui = await frame(container, context, {
    title: context.t("Hall Of Fame"), backdrop: "HALLFAME", bar: "hall",
    regions: { table: [29, 264, 582, 124], tracks: [82, 401, 181, 25] },
  });
  show(ui.classic);
  if (ui.classic) {
    ui.regions.table.append(table);
    ui.regions.tracks.append(picker);
  } else {
    ui.regions.table.append(el("label", {}, "Tracks ", picker), table,
      el("div", { class: "screen-actions" }, el("button", {
        class: "primary", "data-menu-sound": "STARTOFF", onclick: () => context.router.back(),
      }, "Back")));
  }
  return { unmount: ui.unmount };
}
