/*
  Results: each truck's place, time, best lap and laps (MONSTER_EXE_ANALYSIS.md 6), in the
  race order the simulation settled. A headset shows the same table on a board, with the ways
  on from here (docs/VR.md, "Between races").
*/
import { el } from "../dom.js";
import { formatRaceTime, ordinal } from "../../game/race-setup.js";
import { currentDriver, getHall, getProfiles, saveHall, saveProfiles } from "../../app/profile-store.js";
import { addEntry } from "../../game/hall-of-fame.js";
import { recordRace } from "../../game/profile.js";
import { raceFromBoard } from "../../app/vr-lobby.js";
import { createMenu } from "../../game/vr/menu.js";
import { racePoints } from "../../game/race-points.js";
import { frame, uiImageUrl } from "../frame.js";
import { takeRace } from "../../app/tournament.js";

const DIFFICULTIES = ["Rookie", "Intermediate", "Professional"];

/** The party modes (docs/PLAN.md, "Party modes"): the score is Hockey's goals or Tag's points, the time the game's length. */
export const PARTY_MODES = Object.freeze(["hockey", "tag"]);

/**
 * The seven cells under the headings already painted into RESULTS.BMP. A party game (`party`) shows its score
 * and its length (`row.raceTime`) as a Rumble shows its own.
 */
export function winnerCells(row, { summit = false, party = false, laps = 1, difficulty = 1, points = null } = {}) {
  return [
    ordinal(row.place), row.name, row.truckName, DIFFICULTIES[difficulty] ?? DIFFICULTIES[1],
    summit || party ? String(Math.round(row.score)) : points === null ? "" : String(points),
    party ? formatRaceTime(row.raceTime) : summit ? formatRaceTime(laps * 60) : row.rerun ? "Rerun" : row.dq ? "DQ" : (row.finished ? formatRaceTime(row.raceTime) : `${row.laps}/${laps}`),
    row.best && !party ? formatRaceTime(row.best) : "",
  ];
}

/**
 * Whether the Winner's Circle plays the crowd (0x519212): only when the player's own truck is the one placed first, as
 * the art lights the first frame (RESWIN1) for, and finished the race.
 */
export function crowdCheers(me, summit = false) {
  return !!me && me.place === 1 && !me.dq && !me.rerun && (summit || !!me.finished);
}

/**
 * The headset's Winner's Circle: place, driver, truck, the score (a Rumble) or the time, and
 * the best lap, the player's row marked. `rows` are in finishing order.
 */
export function winnerBoard(rows, { summit = false, party = false, laps = 1, difficulty = 1, note = null, onAgain, onNew, onLeave }) {
  return createMenu({
    title: "Winner's Circle",
    lines: note ? [note] : [],
    table: rows.map((row) => {
      const cells = winnerCells(row, { summit, party, laps, difficulty });
      return Object.assign([cells[0], cells[1], cells[2], summit || party ? cells[4] : cells[5], cells[6]], { highlight: !!row.player });
    }),
    items: [
      { label: "Race again", action: onAgain },
      { label: "New race", action: onNew },
      { label: "Leave VR", action: onLeave },
    ],
  });
}

export default async function mount(container, context, { track, laps, difficulty = 1, rows, mode, truck, tournament = false }) {
  // Loaded here, not at the top: the previews need three.js, which the pure parts of this file do not.
  const { createPreviewSlot } = await import("../truck-preview-slot.js");
  const summit = mode === "summit";
  const party = PARTY_MODES.includes(mode);
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
  const pointsOf = new Map(ordered.map((r, i) => [r, summit || party ? Math.round(r.score) : pointList[i]]));
  // A tournament's race (app/tournament.js): its points go to the tournament, once.
  if (tournament && context.tournament) await takeRace(context, rows, rows.map((r) => pointsOf.get(r) ?? 0));
  // A finished race, or any Rumble, may earn a Hall of Fame place; a party game does not.
  let hallNote = null;
  if (me && !counted && !party && (summit || (me.finished && !me.dq && me.raceTime > 0))) {
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
  const toStart = () => context.router.go("start", {}, { replace: false });
  context.xr?.setBoard(winnerBoard(sorted, {
    summit, party, laps, difficulty, note: hallNote,
    onAgain: () => raceFromBoard(context),
    // Back among the menus the headset shows the race setup.
    onNew: toStart,
    onLeave: () => context.xr.exit(),
  }));
  const ui = await frame(container, context, {
    title: "Winner's Circle", backdrop: "RESULTS", bar: tournament && context.tournament ? "tournament" : "results",
    labels: [["First", [24, 62, 140, 16]], ["Second", [328, 62, 140, 16]]],
    // Without the art's frames: first on the left and second on the right, each a label over its preview with the
    // names and the figures beside it, and the whole list under both.
    modernRegions: {
      firstPreview: [24, 80, 140, 106], firstName: [172, 80, 144, 54], firstStats: [172, 134, 144, 54],
      secondPreview: [328, 80, 140, 106], secondName: [476, 80, 144, 54], secondStats: [476, 134, 144, 54],
      table: [24, 200, 592, 198],
    },
    regions: {
      lit: [7, 78, 631, 187],
      firstPreview: [35, 96, 114, 85], firstName: [163, 92, 160, 80], firstStats: [315, 92, 150, 80],
      secondPreview: [493, 157, 113, 85], secondName: [226, 185, 160, 80], secondStats: [381, 185, 130, 80],
      table: [32, 287, 572, 95],
    },
  });
  // The crowd cheers while the player's win is shown (0x519212): CROWD.WAV looping on its KLP, until the screen closes.
  const crowd = crowdCheers(me, summit) && !context.settings.sound?.muted ? context.menuAudio?.play("CROWD", { loop: true, gain: 1 }) : null;
  const slots = [];
  const info = (row) => {
    if (!row) return [null, null];
    const cells = winnerCells(row, { summit, party, laps, difficulty, points: pointsOf.get(row) });
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
        const cells = winnerCells(r, { summit, party, laps, difficulty, points: pointsOf.get(r) });
        cells[3] = context.t(cells[3]);
        const placeCell = el("td", {}, cells[0]);
        if (ui.classic) uiImageUrl(context.assets, `RESULT${r.place}`).then((url) => {
          if (url) placeCell.replaceChildren(el("img", { class: "place-icon", src: url, alt: cells[0] }));
        });
        return el("tr", { class: r.player ? "player" : null }, placeCell, ...cells.slice(1).map((cell) => el("td", {}, cell)));
      }))));
  return {
    unmount() {
      crowd?.then((voice) => voice?.stop());
      slots.forEach((slot) => slot.dispose());
      context.xr?.setBoard(null);
      ui.unmount?.();
    },
  };
}
