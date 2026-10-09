/*
  Results: each truck's place, time, best lap and laps (MONSTER_EXE_ANALYSIS.md 6), in the
  race order the simulation settled.
*/
import { el } from "../dom.js";
import { formatRaceTime, ordinal } from "../../game/race-setup.js";
import { currentDriver, getHall, getProfiles, saveHall, saveProfiles } from "../../app/profile-store.js";
import { addEntry } from "../../game/hall-of-fame.js";
import { recordRace } from "../../game/profile.js";
import { frame, uiImageUrl } from "../frame.js";
import { racePoints } from "../../game/race-points.js";

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];

/** The seven cells under the headings already painted into RESULTS.BMP. */
export function winnerCells(row, { summit = false, laps = 1, difficulty = 1, points = null } = {}) {
  return [
    ordinal(row.place), row.name, row.truckName, DIFFICULTIES[difficulty] ?? DIFFICULTIES[1],
    summit ? String(Math.round(row.score)) : points === null ? "" : String(points),
    summit ? formatRaceTime(laps * 60) : row.dq ? "DQ" : (row.finished ? formatRaceTime(row.raceTime) : `${row.laps}/${laps}`),
    row.best ? formatRaceTime(row.best) : "",
  ];
}

export default async function mount(container, context, { track, laps, difficulty = 1, rows, mode, truck }) {
  // Loaded here, not at the top: the previews need three.js, which the pure parts of this file do not.
  const { createPreviewSlot } = await import("../truck-preview-slot.js");
  const summit = mode === "summit";
  const me = rows.find((r) => r.player);
  const driver = currentDriver(await getProfiles(context));
  // Coming back from the replay mounts this screen again with the same rows: count the race once.
  const counted = context.countedRows === rows;
  context.countedRows = rows;
  if (me && !counted) {
    recordRace(driver, me.place);
    saveProfiles(context);
  }
  // The points (game/race-points.js): a Rumble's score, else the place's base with the lap bonuses.
  const ordered = [...rows].sort((a, b) => a.place - b.place);
  const pointList = racePoints(ordered, laps);
  const pointsOf = new Map(ordered.map((r, i) => [r, summit ? Math.round(r.score) : pointList[i]]));
  // A finished race, or any Rumble, may earn a Hall of Fame place.
  let hallNote = null;
  if (me && !counted && (summit || (me.finished && !me.dq && me.raceTime > 0))) {
    const hall = await getHall(context);
    const rank = addEntry(hall, {
      name: driver.name, truck: truck ?? "", track: track.file, trackName: track.name, mode, difficulty, laps,
      points: pointsOf.get(me) ?? 0, time: summit ? laps * 60 : me.raceTime, fastestLap: me.best ?? 0,
      date: new Date().toISOString().slice(0, 10),
    });
    if (rank) {
      saveHall(context);
      hallNote = `Hall of Fame: ${ordinal(rank)} on ${track.name}.`;
    }
  }
  const sorted = ordered;
  const first = sorted[0], second = sorted[1];
  // The artwork has one frame lit green: the player's own, first or second place (RESWIN1, RESWIN2).
  const lit = me && me.place === 2 ? "RESWIN2" : "RESWIN1";
  const ui = await frame(container, context, {
    title: "Winner's Circle", backdrop: "RESULTS", bar: "results",
    labels: [["First", [24, 196, 140, 18]], ["Second", [476, 291, 140, 18]]],
    // Without the art's frames: each place is a preview and its two columns of data side by side, first above, second below.
    modernRegions: {
      firstPreview: [24, 86, 140, 106], firstName: [176, 90, 230, 80], firstStats: [412, 90, 190, 80],
      secondPreview: [476, 182, 140, 106], secondName: [176, 200, 160, 80], secondStats: [340, 200, 132, 80],
    },
    regions: {
      lit: [7, 78, 631, 187],
      firstPreview: [35, 96, 114, 85], firstName: [163, 92, 160, 80], firstStats: [315, 92, 150, 80],
      secondPreview: [493, 157, 113, 85], secondName: [226, 185, 160, 80], secondStats: [381, 185, 130, 80],
      table: [32, 287, 572, 95],
    },
  });
  const slots = [];
  const info = (row) => {
    if (!row) return [null, null];
    const cells = winnerCells(row, { summit, laps, difficulty, points: pointsOf.get(row) });
    const line = (text) => el("div", { class: "winner-line" }, text);
    const stat = (label, value) => el("div", { class: "winner-line" }, el("span", { class: "winner-label" }, `${label}: `), value);
    return [
      [line(row.name), line(row.truckName), line(context.t(cells[3]))],
      [stat(context.t("Points"), cells[4] || String(pointsOf.get(row) ?? 0)), stat(context.t("Lap"), cells[6] || "-"), stat(context.t("Time"), cells[5] || "-")],
    ];
  };
  {
    const win = ui.art ? await uiImageUrl(context.assets, lit) : null;
    if (win) ui.regions.lit.append(el("img", { class: "winner-lit", src: win, alt: "", draggable: "false" }));
    for (const [row, who, mode] of [[first, "first", "crown"], [second, "second", "still"]]) {
      const [names, stats] = info(row);
      if (names) { ui.regions[`${who}Name`].append(...names); ui.regions[`${who}Stats`].append(...stats); }
      const slot = createPreviewSlot(context, { width: 228, height: 170, mode });
      slots.push(slot);
      if (slot.canvas) ui.regions[`${who}Preview`].append(slot.canvas);
      slot.show(row?.file ?? null);
    }
  }
  ui.regions.table.append(
    el("table", { class: "results winners-table", title: hallNote ?? "" },
      // The art paints the column headings; the modern stage writes them.
      ...(ui.art ? [] : [el("thead", {}, el("tr", {}, ...["Place", "Player Name", "Truck", "Skill Level", "Points", "Time", "Fast Lap"].map((h) => el("th", {}, context.t(h)))))]),
      el("tbody", {}, ...sorted.map((r) => {
        const cells = winnerCells(r, { summit, laps, difficulty, points: pointsOf.get(r) });
        cells[3] = context.t(cells[3]);
        const placeCell = el("td", {}, cells[0]);
        if (ui.classic) uiImageUrl(context.assets, `RESULT${r.place}`).then((url) => {
          if (url) placeCell.replaceChildren(el("img", { class: "place-icon", src: url, alt: cells[0] }));
        });
        return el("tr", { class: r.player ? "player" : null }, placeCell, ...cells.slice(1).map((cell) => el("td", {}, cell)));
      }))));
  return { unmount() { slots.forEach((slot) => slot.dispose()); ui.unmount?.(); } };
}
