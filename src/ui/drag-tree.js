/*
  The drag race's Christmas tree on the HUD (game/drag-race.js), laid out as the exe's 0x548ff0
  draws it: seven lamps a side, the left lane's and the right lane's, the labels between them.
  The player's lane is marked.
*/
import { el } from "./dom.js";
import { LAMP_LABELS } from "../game/drag-race.js";

/** Each lamp's lit colour: prestage and stage, the three ambers, Go, Disqualify. */
const COLOURS = ["#f4f0c8", "#f4f0c8", "#ffb020", "#ffb020", "#ffb020", "#3cff50", "#ff3030"];

export function createDragTree() {
  const sides = [[], []];
  const rows = LAMP_LABELS.map((label, k) => {
    const lamp = (side) => {
      const dot = el("span", { class: "drag-lamp" });
      dot.style.setProperty("--lit", COLOURS[k]);
      sides[side].push(dot);
      return dot;
    };
    return el("div", { class: "drag-row" }, lamp(0), el("span", { class: "drag-label" }, label.trim()), lamp(1));
  });
  const marks = [el("span", { class: "drag-mark" }), el("span", { class: "drag-mark" })];
  const element = el("div", { class: "drag-tree", hidden: true }, el("div", { class: "drag-marks" }, marks[0], el("span"), marks[1]), ...rows);
  let shown = "";
  return {
    element,
    /** `lamps` per lane (bits), `playerLane` the player's lane, or null to hide the tree. */
    set(lamps, playerLane) {
      const key = lamps ? `${lamps.join(",")}:${playerLane}` : "";
      if (key === shown) return;
      shown = key;
      element.hidden = !lamps;
      if (!lamps) return;
      sides.forEach((dots, side) => dots.forEach((dot, k) => dot.classList.toggle("lit", !!((lamps[side] ?? 0) & (1 << k)))));
      marks.forEach((m, side) => { m.textContent = side === playerLane ? "YOU" : ""; });
    },
  };
}
