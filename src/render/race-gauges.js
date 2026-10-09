/*
  The chase-view speedometer, tachometer and gear strip, laid out as in the game's 640 x 480
  race screen (MONSTER_EXE_ANALYSIS.md 11): numbers in the HUD's light grey with a one-pixel
  black shadow around a dial, the red `NEEDLE.BIN` needle, and the small "PRN123" strip.
  The sweeps are the exe's: the speedometer starts at 304.5 degrees and turns 2.65 degrees per
  mph, the tachometer at 153 degrees and 0.0261 degrees per rpm (the exe's angles are 90 degrees
  ahead of the canvas's, which count clockwise from the x axis).
*/
import { drawText, textWidth } from "./bitmap-text.js";

export const mphFromFeetPerSecond = (speed) => Math.abs(speed) * 3600 / 5280;
export const kphFromFeetPerSecond = (speed) => Math.abs(speed) * 0.3048 * 3.6;
export const gearLabel = (gear) => ["", "P", "R", "N", "1", "2", "3"][gear] ?? "";
/** The speedometer's full scale and tick spacing in a unit. */
export const SPEED_SCALE = Object.freeze({ mph: { max: 110, step: 10 }, kph: { max: 180, step: 20 } });

const GREY = "#cfcfcf", GEAR_ON = "#f4a5a5";
const DEG = Math.PI / 180;
/** Dial centres, the exe's start angles and sweeps per unit, and the needle's reach, in 640 x 480 pixels. */
export const SPEEDO = { x: 105, y: 390, start: 304.5 - 90, perMph: 2.65 };
export const TACHO = { x: 533, y: 390, start: 153 - 90, perRpm: 0.0261 };
const LABEL_R = 72, TICK_FROM = 51, TICK_TO = 56, NEEDLE_R = 47;

/** A dial's needle angle in canvas radians: `start` degrees, then `perUnit` degrees for each unit of `value`. */
export const gaugeAngle = (value, start, perUnit, maximum = Infinity) => (start + perUnit * Math.max(0, Math.min(maximum, value))) * DEG;

/** The needle's colours: the model's two lit faces are drawn red, its hub stays dark. */
const needleFill = (color, lit) => ((color & 0xffffff) === 0x202020 ? "#202020" : lit ? "#ff2a36" : "#b00016");

/**
 * Draw the needle model (NEEDLE.BIN as flat shapes, or a plain line when null) from (cx, cy)
 * along `angle` (canvas radians), its tip `reach` pixels out.
 */
export function drawNeedle(ctx, needle, cx, cy, angle, reach) {
  if (!needle) {
    ctx.strokeStyle = "#e0101e";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach); ctx.stroke();
    return;
  }
  const tip = Math.max(...needle.flatMap((shape) => shape.points.map((p) => p[1])));
  const k = reach / tip;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle + Math.PI / 2);
  needle.forEach(({ color, points }, shape) => {
    ctx.fillStyle = needleFill(color, shape === 0);
    for (let n = 0; n + 2 < points.length; n += 3) {
      ctx.beginPath();
      ctx.moveTo(points[n][0] * k, -points[n][1] * k);
      ctx.lineTo(points[n + 1][0] * k, -points[n + 1][1] * k);
      ctx.lineTo(points[n + 2][0] * k, -points[n + 2][1] * k);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.restore();
}

/**
 * `needle` is NEEDLE.BIN as flat shapes (the asset worker's `needle`), or null for a plain line;
 * `units` is "mph" or "kph".
 */
export function createRaceGauges(font, { needle = null, units = "mph" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "race-gauges";
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  let last = "";
  let unit = units, shown = true;

  /** Text centred on (x, y) with the game's shadow. */
  const label = (text, x, y, color = GREY, scale = 1) => {
    if (font) {
      const w = textWidth(font, text, scale), left = Math.round(x - w / 2), top = Math.round(y - 8 * scale);
      drawText(ctx, font, text, left + 1, top + 1, { color: "#000", scale });
      drawText(ctx, font, text, left, top, { color, scale });
    } else {
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#000"; ctx.fillText(text, x + 1, y + 5);
      ctx.fillStyle = color; ctx.fillText(text, x, y + 4);
    }
  };

  const pointer = (cx, cy, angle) => drawNeedle(ctx, needle, cx, cy, angle, NEEDLE_R);

  const dial = ({ x, y }, angleOf, labels, value) => {
    ctx.strokeStyle = "rgba(225,225,225,.9)";
    ctx.lineWidth = 1;
    for (const n of labels) {
      const a = angleOf(n);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * TICK_FROM, y + Math.sin(a) * TICK_FROM);
      ctx.lineTo(x + Math.cos(a) * TICK_TO, y + Math.sin(a) * TICK_TO);
      ctx.stroke();
      label(String(n), x + Math.cos(a) * LABEL_R, y + Math.sin(a) * LABEL_R);
    }
    pointer(x, y, angleOf(value));
  };

  return {
    element: canvas,
    /** The Dashboard key: show or hide both gauges and the gear strip. */
    toggle() { shown = !shown; canvas.hidden = !shown; return shown; },
    setVisible(on) { shown = !!on; canvas.hidden = !shown; },
    get visible() { return shown; },
    setUnits(next) { unit = next === "kph" ? "kph" : "mph"; last = ""; },
    set({ speed = 0, rpm = 0, gear = 1 }) {
      if (!shown) return;
      const kph = unit === "kph";
      const reading = kph ? kphFromFeetPerSecond(speed) : mphFromFeetPerSecond(speed), thousands = Math.max(0, rpm / 1000);
      const key = `${reading.toFixed(1)}|${thousands.toFixed(1)}|${gear}|${unit}`;
      if (key === last) return;
      last = key;
      ctx.clearRect(0, 0, 640, 480);
      const { max, step } = SPEED_SCALE[unit];
      const perUnit = kph ? SPEEDO.perMph / 1.609344 : SPEEDO.perMph;
      dial(SPEEDO, (v) => gaugeAngle(v, SPEEDO.start, perUnit, max), Array.from({ length: max / step + 1 }, (_, i) => i * step), reading);
      dial(TACHO, (v) => gaugeAngle(v * 1000, TACHO.start, TACHO.perRpm, 9000), Array.from({ length: 10 }, (_, i) => i), thousands);
      // The gear strip at the bottom with the current gear lit (the exe draws it at a fixed spot).
      let x = 296;
      for (const item of ["P", "R", "N", "1", "2", "3"]) {
        label(item, x, 461, item === gearLabel(gear) ? GEAR_ON : GREY);
        x += 10;
      }
    },
  };
}
