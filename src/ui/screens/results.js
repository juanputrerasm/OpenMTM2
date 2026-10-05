/*
  Results: each truck's place, time, best lap and laps (MONSTER_EXE_ANALYSIS.md 6), in the
  race order the simulation settled.
*/
import { el } from "../dom.js";
import { formatRaceTime, ordinal } from "../../game/race-setup.js";
import { currentDriver, getHall, getProfiles, saveHall, saveProfiles } from "../../app/profile-store.js";
import { addEntry } from "../../game/hall-of-fame.js";
import { recordRace } from "../../game/profile.js";
import { goRace } from "../../app/flow.js";
import { frame } from "../frame.js";

export default async function mount(container, context, { track, laps, difficulty = 1, rows, mode, truck }) {
  const summit = mode === "summit";
  const me = rows.find((r) => r.player);
  const driver = currentDriver(await getProfiles(context));
  if (me) {
    recordRace(driver, me.place);
    saveProfiles(context);
  }
  // A finished race, or any Rumble, may earn a Hall of Fame place.
  let hallNote = null;
  if (me && (summit || (me.finished && me.raceTime > 0))) {
    const hall = await getHall(context);
    const rank = addEntry(hall, {
      name: driver.name, truck: truck ?? "", track: track.file, trackName: track.name, mode, difficulty, laps,
      points: summit ? Math.round(me.score) : 0, time: summit ? laps * 60 : me.raceTime, fastestLap: me.best ?? 0,
      date: new Date().toISOString().slice(0, 10),
    });
    if (rank) {
      saveHall(context);
      hallNote = `Hall of Fame: ${ordinal(rank)} on ${track.name}.`;
    }
  }
  const sorted = [...rows].sort((a, b) => a.place - b.place);
  const ui = await frame(container, context, {
    title: "Winner's Circle", backdrop: "RESULTS", bar: "results",
    regions: { first: [24, 170, 170, 40], second: [470, 108, 160, 40], table: [32, 286, 572, 98] },
  });
  if (ui.classic) {
    ui.regions.first.append(sorted[0]?.name ?? "");
    ui.regions.second.append(sorted[1]?.name ?? "");
  }
  ui.regions.table.append(
    el("p", { class: "muted" }, summit ? `${track.name}, ${laps} minutes` : `${track.name}, ${laps} ${laps === 1 ? "lap" : "laps"}`),
    hallNote ? el("p", { class: "hall-note" }, hallNote) : null,
    el("table", { class: "results" },
      el("thead", {}, el("tr", {}, ...(summit ? ["Place", "Driver", "Truck", "Score"] : ["Place", "Driver", "Truck", "Time", "Best lap"]).map((h) => el("th", {}, h)))),
      el("tbody", {}, ...sorted.map((r) => el("tr", { class: r.player ? "player" : null },
        el("td", {}, ordinal(r.place)),
        el("td", {}, r.name),
        el("td", {}, r.truckName),
        ...(summit ? [el("td", {}, String(Math.round(r.score)))] : [
          el("td", {}, r.finished ? formatRaceTime(r.raceTime) : `${r.laps} of ${laps} laps`),
          el("td", {}, r.best ? formatRaceTime(r.best) : "")])))),
    ),
    el("div", { class: "screen-actions" },
      ui.classic ? null : el("button", { onclick: () => context.router.go("start", {}, { replace: false }) }, "Main menu"),
      el("button", { class: "primary", onclick: () => goRace(context) }, "Race again")));
  return { unmount: ui.unmount };
}
