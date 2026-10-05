/*
  Hall of Fame: the best results on each track, for each mode. Races rank by time, Summit
  Rumbles by points.
*/
import { el } from "../dom.js";
import { getHall } from "../../app/profile-store.js";
import { topFor } from "../../game/hall-of-fame.js";
import { formatRaceTime, ordinal } from "../../game/race-setup.js";
import { frame } from "../frame.js";

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];
const MODES = [["circuit", "Circuit"], ["rally", "Rally"], ["summit", "Summit Rumble"]];

export default async function mount(container, context) {
  const hall = await getHall(context);
  const catalog = await context.assets.call("catalog");
  let mode = "circuit";
  const body = el("div");
  const tabs = el("div", { class: "form-row tabs" });

  const show = () => {
    tabs.replaceChildren(...MODES.map(([id, label]) => el("button", {
      class: id === mode ? "pick selected" : "pick", onclick: () => { mode = id; show(); },
    }, id === "summit" ? label : context.t(label))));
    const sections = catalog.tracks.filter((t) => t.raceType === mode)
      .map((t) => ({ track: t, rows: topFor(hall, t.file, mode) })).filter((s) => s.rows.length);
    body.replaceChildren(...(sections.length ? sections.map(({ track, rows }) => el("div", {},
      el("h2", {}, track.name),
      el("table", { class: "results" },
        el("thead", {}, el("tr", {}, ...["", "Driver", "Truck", mode === "summit" ? "Points" : "Time", "Skill"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...rows.map((e, i) => el("tr", {},
          el("td", {}, ordinal(i + 1)), el("td", {}, e.name), el("td", {}, e.truck.replace(/\.TRK$/i, "")),
          el("td", {}, mode === "summit" ? String(e.points) : formatRaceTime(e.time)),
          el("td", {}, context.t(DIFFICULTIES[e.difficulty] ?? "")))))))) : [el("p", { class: "muted" }, "No results yet.")]));
  };
  show();

  const ui = await frame(container, context, { title: context.t("Hall Of Fame"), backdrop: "HALLFAME", bar: "hall", regions: { list: [30, 268, 580, 116], tabs: [400, 72, 192, 146] } });
  ui.regions.tabs.append(tabs);
  ui.regions.list.append(body);
  if (!ui.classic) ui.regions.list.append(el("div", { class: "screen-actions" }, el("button", { class: "primary", onclick: () => context.router.back() }, "Back")));
  return { unmount: ui.unmount };
}
