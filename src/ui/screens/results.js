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

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];

/** The seven cells under the headings already painted into RESULTS.BMP. */
export function winnerCells(row, { summit = false, laps = 1, difficulty = 1 } = {}) {
  return [
    ordinal(row.place), row.name, row.truckName, DIFFICULTIES[difficulty] ?? DIFFICULTIES[1],
    summit ? String(Math.round(row.score)) : "",
    summit ? formatRaceTime(laps * 60) : (row.finished ? formatRaceTime(row.raceTime) : `${row.laps}/${laps}`),
    row.best ? formatRaceTime(row.best) : "",
  ];
}

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
    regions: { first: [12, 92, 410, 140], second: [470, 108, 160, 143], table: [32, 287, 572, 95] },
  });
  // The first and second regions are reserved for future 3D truck previews.
  ui.regions.first.classList.add("winner-preview");
  ui.regions.second.classList.add("winner-preview");
  ui.regions.table.append(
    el("table", { class: "results winners-table", title: hallNote ?? "" },
      el("tbody", {}, ...sorted.map((r) => {
        const cells = winnerCells(r, { summit, laps, difficulty });
        cells[3] = context.t(cells[3]);
        return el("tr", { class: r.player ? "player" : null }, ...cells.map((cell) => el("td", {}, cell)));
      }))));
  if (!ui.classic) ui.regions.table.append(el("div", { class: "screen-actions" },
    el("button", { "data-menu-sound": "STARTOFF", onclick: () => context.router.go("start", {}, { replace: false }) }, "Main menu"),
    el("button", { class: "primary", "data-menu-sound": "GOOFF", onclick: () => goRace(context) }, "Race again")));
  return { unmount: ui.unmount };
}
