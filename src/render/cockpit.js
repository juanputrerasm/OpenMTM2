/*
  The cockpit view's dashboard and the finder (MONSTER_EXE_ANALYSIS.md 11), drawn on 640 x 480
  canvases stretched over the race view with the art from `COCKPIT.POD` (worker/cockpit-art.js):
  the front panel (its black is see-through), the speedometer and tachometer needles at the
  layout's centres, the steering wheel frame for the steering angle, the shifter frame for the
  gear, the shift light and the mirror frame. The finder is the 60 x 60 ring at the top right
  with the next checkpoint's number, an arrow at its top and a dot that circles it; both are green
  while the checkpoint is within 22.5 degrees of straight ahead (0x4ed31d).
*/
import { drawNeedle, gaugeAngle } from "./race-gauges.js";
import { drawText, textWidth } from "./bitmap-text.js";

/** The steering lock (radians) at which the wheel frames reach 35 degrees. */
const STEER_LOCK = 0.45;
/** The shift light comes on near the top of the rev range. */
const SHIFT_LIGHT_RPM = 7500;

const toCanvas = (image) => {
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  return canvas;
};
const mapValues = (object) => Object.fromEntries(Object.entries(object ?? {}).map(([key, image]) => [key, toCanvas(image)]));

/** The wheel frame's name for a steering value: `C00`, or `L`/`R` and the angle in 5 degree steps (left is negative). */
export function wheelFrame(steer) {
  const degrees = Math.max(-35, Math.min(35, (steer / STEER_LOCK) * 35));
  const step = Math.round(Math.abs(degrees) / 5) * 5;
  return step === 0 ? "C00" : `${degrees < 0 ? "L" : "R"}${String(step).padStart(2, "0")}`;
}

/** The finder's ring angle for a target, degrees counted anticlockwise from the right with 90 straight ahead. */
export function finderAngle(from, yaw, to) {
  const world = (Math.atan2(to[2] - from[2], to[0] - from[0]) * 180) / Math.PI;
  return (((world + (yaw * 180) / Math.PI) % 360) + 360) % 360;
}
/** Green while the target is within 22.5 degrees of straight ahead. */
export const finderLinedUp = (angle) => angle >= 67.5 && angle <= 112.5;

function layer(className) {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.width = 640;
  canvas.height = 480;
  canvas.hidden = true;
  return canvas;
}

export function createCockpit(art, { needle = null, font = null, units = "mph" } = {}) {
  if (!art) return null;
  const { layout } = art;
  const panels = mapValues(art.panels), wheel = mapValues(art.wheel), shifter = mapValues(art.shifter), finderArt = mapValues(art.finder);
  const light = toCanvas(art.shiftLight), mirror = toCanvas(art.mirror);

  const dash = layer("race-cockpit");
  const dashCtx = dash.getContext("2d");
  let lastDash = "";
  // The rear-view mirror shows a live second view; the layer sits over the mirror's window.
  const mirrorRect = layout.mirrors[0]?.location ?? null;
  const mirror2d = document.createElement("canvas");
  mirror2d.className = "race-mirror";
  mirror2d.hidden = true;
  if (mirrorRect) {
    mirror2d.width = mirrorRect[2];
    mirror2d.height = mirrorRect[3];
    Object.assign(mirror2d.style, { left: `${(mirrorRect[0] / 640) * 100}%`, top: `${(mirrorRect[1] / 480) * 100}%`, width: `${(mirrorRect[2] / 640) * 100}%`, height: `${(mirrorRect[3] / 480) * 100}%` });
  }
  const mirrorCtx = mirror2d.getContext("2d");
  const finder = layer("race-finder");
  const finderCtx = finder.getContext("2d");
  let lastFinder = "";

  return {
    dashboard: dash,
    finder,
    mirror: mirror2d,
    setUnits(next) { units = next; lastDash = ""; },
    /**
     * The cockpit's own panel, wheel, needles and shifter; `visible` is whether the view is the cockpit.
     */
    setDashboard({ visible, speed = 0, rpm = 0, gear = 1, steer = 0, instruments = true }) {
      dash.hidden = !visible;
      if (!visible) return;
      const kph = units === "kph";
      const reading = Math.abs(speed) * 3600 / 5280 * (kph ? 1.609344 : 1);
      const key = `${reading.toFixed(1)}|${Math.round(rpm / 10)}|${gear}|${wheelFrame(steer)}|${units}|${instruments}`;
      if (key === lastDash) return;
      lastDash = key;
      dashCtx.clearRect(0, 0, 640, 480);
      const draw = (image, x, y) => { if (image) dashCtx.drawImage(image, x, y); };
      draw(panels.front, 0, 0);
      const { speedometer: speedo, tachometer: tacho } = layout;
      if (instruments) {
        drawNeedle(dashCtx, needle, speedo.center[0], speedo.center[1], gaugeAngle(reading / (kph ? 1.609344 : 1), speedo.zeroAngle - 90, speedo.degreesPerUnit, 110), speedo.radius);
        drawNeedle(dashCtx, needle, tacho.center[0], tacho.center[1], gaugeAngle(rpm, tacho.zeroAngle - 90, tacho.degreesPerUnit, 9000), tacho.radius);
      }
      draw(wheel[wheelFrame(steer)], layout.steeringWheel[0], layout.steeringWheel[1]);
      if (instruments) draw(shifter[["", "P", "R", "N", "1", "2", "3"][gear]], layout.shifterRect[0], layout.shifterRect[1]);
      if (instruments && rpm >= SHIFT_LIGHT_RPM) draw(light, layout.shiftLightRect[0], layout.shiftLightRect[1]);
      if (layout.mirrors[0]) draw(mirror, layout.mirrors[0].bitmapRect[0], layout.mirrors[0].bitmapRect[1]);
    },
    /** The rear-view mirror's window in 640 x 480 pixels, or null. */
    mirrorRect,
    /**
     * Show the mirror: `pixels` are RGBA rows from the bottom as WebGL reads them, `width` x `height`
     * of the mirror's window; turned half a circle, which is both the flip and the mirroring.
     */
    setMirror(pixels, width, height, visible = true) {
      mirror2d.hidden = !visible || !mirrorRect;
      if (mirror2d.hidden) return;
      const turned = new Uint8ClampedArray(pixels.length);
      for (let i = 0; i < width * height; i++) {
        const j = (width * height - 1 - i) * 4;
        turned[i * 4] = pixels[j]; turned[i * 4 + 1] = pixels[j + 1]; turned[i * 4 + 2] = pixels[j + 2]; turned[i * 4 + 3] = 255;
      }
      mirror2d.width = width;
      mirror2d.height = height;
      mirrorCtx.putImageData(new ImageData(turned, width, height), 0, 0);
    },
    /** `angle` from `finderAngle`; `number` the next checkpoint's number; `visible` hides it. */
    setFinder({ visible, angle = 90, number = 1 }) {
      finder.hidden = !visible;
      if (!visible) return;
      const key = `${Math.round(angle)}|${number}`;
      if (key === lastFinder) return;
      lastFinder = key;
      finderCtx.clearRect(0, 0, 640, 480);
      const x0 = 640 - 60 - 6, y0 = 7, cx = x0 + 30, cy = y0 + 30;
      const green = finderLinedUp(angle);
      finderCtx.drawImage(finderArt.ring, x0, y0);
      const arrow = green ? finderArt.arrowGreen : finderArt.arrowRed, dot = green ? finderArt.dotGreen : finderArt.dotRed;
      if (arrow) finderCtx.drawImage(arrow, cx - 6, cy - 3 - 18);
      if (dot) {
        const a = (angle * Math.PI) / 180, r = 23;
        finderCtx.drawImage(dot, Math.round(cx + Math.cos(a) * r - 3), Math.round(cy - Math.sin(a) * r - 3));
      }
      const text = String(number);
      if (font) {
        const left = Math.round(cx - textWidth(font, text) / 2);
        drawText(finderCtx, font, text, left + 1, cy - 8 + 1, { color: "#000" });
        drawText(finderCtx, font, text, left, cy - 8, { color: "#e0e0e0" });
      }
    },
  };
}
