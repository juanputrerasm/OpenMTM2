/* The chase-view speedometer, tachometer and gear strip from the 640 x 480 race HUD. */
import { drawText, textWidth } from "./bitmap-text.js";

export const mphFromFeetPerSecond = (speed) => Math.abs(speed) * 3600 / 5280;
export const gearLabel = (gear) => ["", "P", "R", "N", "1", "2", "3"][gear] ?? "";
export const gaugeAngle = (value, maximum) => Math.PI * (0.75 + 1.5 * Math.max(0, Math.min(1, value / maximum)));

export function createRaceGauges(font) {
  const canvas = document.createElement("canvas");
  canvas.className = "race-gauges";
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  let last = "";

  const label = (text, x, y, color = "#fff") => {
    if (font) {
      drawText(ctx, font, text, x - textWidth(font, text) / 2 + 1, y + 1, { color: "#000" });
      drawText(ctx, font, text, x - textWidth(font, text) / 2, y, { color });
    } else {
      ctx.fillStyle = color;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(text, x, y + 10);
    }
  };
  const gauge = (cx, cy, value, maximum, step) => {
    ctx.strokeStyle = "rgba(255,255,255,.88)";
    ctx.lineWidth = 1;
    for (let n = 0; n <= maximum; n += step) {
      const a = gaugeAngle(n, maximum);
      const x0 = cx + Math.cos(a) * 48, y0 = cy + Math.sin(a) * 48;
      const x1 = cx + Math.cos(a) * 57, y1 = cy + Math.sin(a) * 57;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      label(String(n), cx + Math.cos(a) * 70, cy + Math.sin(a) * 70 - 5);
    }
    const a = gaugeAngle(value, maximum);
    ctx.strokeStyle = "#f00016";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 43, cy + Math.sin(a) * 43); ctx.stroke();
  };

  return {
    element: canvas,
    set({ speed = 0, rpm = 0, gear = 1 }) {
      const mph = mphFromFeetPerSecond(speed), thousands = Math.max(0, rpm / 1000);
      const key = `${mph.toFixed(1)}|${thousands.toFixed(1)}|${gear}`;
      if (key === last) return;
      last = key;
      ctx.clearRect(0, 0, 640, 480);
      gauge(105, 392, mph, 110, 10);
      gauge(540, 392, thousands, 9, 1);
      const gears = ["P", "R", "N", "1", "2", "3"];
      let x = 296;
      for (const item of gears) {
        label(item, x, 461, item === gearLabel(gear) ? "#f4a5a5" : "#fff");
        x += 10;
      }
    },
  };
}
