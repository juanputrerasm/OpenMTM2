/*
  The race's loading screen (ART\DATA480.RAW) with MTM2's loading bar (game/loading-bar.js;
  MONSTER_EXE_ANALYSIS.md, "The loading bar"): the bar and its message, "Race : " and "Skill : " over it, all in the
  game's FNT1 font; and the port's own lines at the top left saying what this race is. "Determining times for
  remaining trucks" is drawn on it too.

  One canvas over the whole view in device pixels, as the HUD is drawn: the art fitted inside it, the bar placed on the
  art in its 640 x 480 terms, and the text at the timing board's whole-number scale (render/bitmap-text.js
  `hudFontScale`), so each font pixel is the same size as the board's and sits on whole device pixels. The lines at the
  top left start where the timing board's first letter does (3/640 of the width, 16/480 of the height).
*/
import { el } from "./dom.js";
import { drawText, hudFontScale, textWidth } from "../render/bitmap-text.js";
import { LOADING_BAR, barFill } from "../game/loading-bar.js";

/** The bar's colours. The game's are entries 4 and 7 of the palette it has then, which was not traced. */
const BAR_FILL = "#5c5c5c";
const TEXT = "#cfcfcf";
const SHADOW = "#000";

/** `font`: FNT1 (render/bitmap-text.js `loadFont`), or null until it is in. */
export function createLoadingBoard(font = null) {
  const canvas = el("canvas", { class: "race-loading-board" });
  const g = canvas.getContext("2d");
  let art = null, info = [], race = "", skill = "", steps = 0, count = 0, message = "", shown = false;

  const write = (text, x, y, s) => {
    if (font) {
      drawText(g, font, text, x + s, y + s, { color: SHADOW, scale: s });
      drawText(g, font, text, x, y, { color: TEXT, scale: s });
    } else {
      g.font = `${12 * s}px sans-serif`;
      g.textBaseline = "top";
      g.fillStyle = TEXT;
      g.fillText(text, x, y);
    }
  };
  const width = (text, s) => (font ? textWidth(font, text, s) : (g.font = `${12 * s}px sans-serif`, g.measureText(text).width));

  /** The canvas at the view's size in device pixels; false while it is not laid out. */
  function fitCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const W = Math.round(canvas.clientWidth * ratio), H = Math.round(canvas.clientHeight * ratio);
    if (!W || !H) return false;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    return true;
  }

  function draw() {
    if (!fitCanvas()) return;
    const W = canvas.width, H = canvas.height;
    const s = hudFontScale(H);
    const lineH = (font?.lineHeight ?? 14) * s;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    // The art fitted inside the view, centred; the bar's 640 x 480 places mapped onto it.
    const aw = art?.width ?? 640, ah = art?.height ?? 480;
    const k = Math.min(W / aw, H / ah);
    const rw = Math.round(aw * k), rh = Math.round(ah * k), ox = Math.round((W - rw) / 2), oy = Math.round((H - rh) / 2);
    if (art) g.drawImage(art, ox, oy, rw, rh);
    const X = (x) => ox + Math.round((x * rw) / 640), Y = (y) => oy + Math.round((y * rh) / 480);
    // The port's lines, where the timing board's first row is.
    const left = Math.round((3 * W) / 640), top = Math.round((16 * H) / 480);
    info.forEach((line, i) => write(line, left, top + i * (lineH + s), s));
    if (!shown) return;
    const B = LOADING_BAR;
    const [x0, y0, x1, y1] = B.box;
    g.fillStyle = "#000";
    g.fillRect(X(x0), Y(y0), X(x1 + 1) - X(x0), Y(y1 + 1) - Y(y0));
    const bx = X(B.x), by = Y(B.y), bw = X(B.x + B.width) - bx, bh = Y(B.y + B.height) - by;
    g.fillStyle = BAR_FILL;
    g.fillRect(bx, by, X(B.x + barFill(count, steps)) - bx, bh);
    if (message) write(message, bx + Math.round((bw - width(message, s)) / 2), by + Math.round((bh - lineH) / 2), s);
    if (race) write(race, bx, by - lineH, s);
    if (skill) write(skill, bx + bw - Math.round(width(skill, s)), by - lineH, s);
  }

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null;
  observer?.observe(canvas);

  return {
    element: canvas,
    setFont(f) { font = f; draw(); },
    /** The loading screen's art: `{ width, height, rgba }` from the asset worker. */
    setArt(image) {
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.rgba.buffer ?? image.rgba), image.width, image.height), 0, 0);
      art = c;
      draw();
    },
    /** The lines at the top left (game/loading-bar.js `raceInfoLines`). */
    setInfo(lines) { info = [...lines]; draw(); },
    /** "Race : <name>" and "Skill : <level>", already worded. */
    setRace(raceLine, skillLine) { race = raceLine; skill = skillLine; draw(); },
    /** A new bar of `n` steps, empty, with `text`. */
    begin(n, text = "") { steps = n; count = 0; message = text; shown = true; draw(); },
    /** One step on, with what is being done now. */
    step(text) { count = Math.min(steps, count + 1); if (text) message = text; draw(); },
    /** The bar at `n` steps. */
    stepTo(n, text) { count = Math.max(0, Math.min(steps, n)); if (text) message = text; draw(); },
    /** Another message, the bar where it is. */
    say(text) { message = text; draw(); },
    redraw: draw,
    dispose() { observer?.disconnect(); },
  };
}
