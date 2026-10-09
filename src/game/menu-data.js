/*
  Pure labels and stock UI artwork names used by the classic menu screens. Add-on tracks may
  omit a preview, in which case the Races screen keeps the artwork's preview opening empty.
*/

export const RACE_TYPE_NAMES = Object.freeze({
  circuit: "Circuit Race",
  rally: "Rally Race",
  summit: "Summit Rumble",
  drag: "Drag Race",
  unsupported: "Unsupported",
});

const STOCK_TRACK_PREVIEWS = Object.freeze({
  "ALASKA.SIT": "HIGHTS",
  "AZTEC.SIT": "EXCAVAT",
  "BAJA.SIT": "TUMBLE",
  "CRAZY98.SIT": "CRAZY98",
  "GRAVEY.SIT": "GRAVE",
  "JUNK.SIT": "SCRAP",
  "MAIN.SIT": "VOODOO",
  "AUSSIE.SIT": "TINHORN",
  "ROCKQRY.SIT": "BREAK",
  "SNAKE.SIT": "SIDEWIND",
  "WAR.SIT": "TORTURE",
  "SUMMIT1.SIT": "SUMMIT1",
  "SUMMIT2.SIT": "SUMMIT2",
  "SUMMIT3.SIT": "SUMMIT3",
  "TPARK.SIT": "FARM",
});

export function raceTypeName(type) {
  return RACE_TYPE_NAMES[type] ?? RACE_TYPE_NAMES.unsupported;
}

export function raceLengthLabel(type) {
  return type === "summit" ? "Minutes" : "Laps";
}

export function trackPreviewName(file) {
  return STOCK_TRACK_PREVIEWS[String(file).toUpperCase()] ?? String(file).replace(/\.SI[T2]$/i, "").toUpperCase();
}

export function garageSummary(setup) {
  const tire = ["s", "m", "d"][setup?.tireCut] ?? "s";
  const suspension = ["s", "m", "h"][setup?.suspension] ?? "s";
  return `${setup?.transferSetting ?? 1500} ${tire}/${suspension}`;
}
