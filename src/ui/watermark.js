/*
  The OpenMTM2 version mark in the corner of every screen, drawn with the game's own font at the HUD's whole-number
  scale (render/bitmap-text.js `hudFontScale`), one canvas pixel to one device pixel, as the timing board is.
  Until the font is in, or when the install has none, plain text stands in. The font is asked for again on every
  screen change until it comes: at the first start the archives are not mounted yet when the mark goes up.
  A screen with a bar along the bottom (the replay's controls) lifts the mark over it with `liftWatermark`.
  The canvas is placed by its top-left corner on a whole device pixel, worked out in device pixels as the HUD is
  (ui/screens/race.js `layoutHud`): placed from the right and bottom edges in CSS pixels, at a pixel ratio that is not
  a whole number (Windows at 125 or 150%, a zoomed page) it would fall between device pixels and be resampled, which
  smears the font's pixels. Its transparency is drawn into the canvas, not left to CSS.
*/
import { drawText, hudFontScale, loadFont, textWidth } from "../render/bitmap-text.js";
import { WATERMARK } from "../app/version.js";

let host = null, shown = null, lift = 0;

/** Margins from the right and bottom edges, CSS pixels. */
const MARGIN_RIGHT = 8, MARGIN_BOTTOM = 6;
/** The mark's opacity. */
const ALPHA = 0.7;

/**
 * Where the canvas's top-left goes, CSS pixels, for a canvas `width` x `height` device pixels in a window `innerWidth`
 * x `innerHeight` CSS pixels at `ratio`: whole device pixels, divided back by the ratio.
 */
export function watermarkPlace(width, height, innerWidth, innerHeight, ratio, liftPx = 0) {
  const left = Math.round(innerWidth * ratio) - width - Math.round(MARGIN_RIGHT * ratio);
  const top = Math.round(innerHeight * ratio) - height - Math.round((MARGIN_BOTTOM + liftPx) * ratio);
  return { left: Math.max(0, left) / ratio, top: Math.max(0, top) / ratio };
}

/** Lift the mark `px` CSS pixels off the bottom edge (0 puts it back). */
export function liftWatermark(px) {
  lift = Math.max(0, Math.round(px));
  document.documentElement.style.setProperty("--watermark-lift", `${lift}px`);
  place();
}

/** Put the drawn mark on whole device pixels for the window now. */
function place() {
  if (!host || !shown) return;
  const ratio = window.devicePixelRatio || 1;
  const { left, top } = watermarkPlace(shown.width, shown.height, window.innerWidth, window.innerHeight, ratio, lift);
  Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto", opacity: "1" });
}

/** Draw the mark with `font` for the window's current size and pixel ratio. */
function draw(font) {
  const ratio = window.devicePixelRatio || 1;
  const scale = hudFontScale(Math.round(window.innerHeight * ratio));
  const width = Math.ceil(textWidth(font, WATERMARK, scale)) + scale;
  const height = Math.ceil((font.lineHeight ?? 16) * scale) + scale;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width / ratio}px`;
  canvas.style.height = `${height / ratio}px`;
  const ctx = canvas.getContext("2d");
  // The shadow and the letters into a layer first, then the layer at the mark's opacity: the letters' own pixels
  // do not let the shadow show through them.
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const lctx = layer.getContext("2d");
  drawText(lctx, font, WATERMARK, scale, scale, { color: "#000", scale });
  drawText(lctx, font, WATERMARK, 0, 0, { color: "#fff", scale });
  ctx.globalAlpha = ALPHA;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layer, 0, 0);
  host.replaceChildren(canvas);
  shown = { width, height, ratio };
  place();
}

/** Redraw when the pixel ratio changes (the window moved to another screen, the page zoomed) without a resize. */
function watchRatio(redraw) {
  if (typeof matchMedia !== "function") return;
  const query = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  query.addEventListener?.("change", () => { redraw(); watchRatio(redraw); }, { once: true });
}

/**
 * Put the mark up. `assets` is the asset worker (null before an install); `router`, when given, is asked to retry the
 * font on each screen change until it loads.
 */
export async function mountWatermark(assets, router = null) {
  host = document.createElement("div");
  host.className = "watermark";
  host.textContent = WATERMARK;
  document.body.append(host);
  let font = null, asking = null;
  const tryFont = async () => {
    if (font || !assets || asking) return;
    asking = loadFont(assets, "FNT1_480").catch(() => null);
    font = await asking;
    asking = null;
    if (font) draw(font);
  };
  addEventListener("resize", () => { if (font) draw(font); });
  watchRatio(() => { if (font) draw(font); });
  if (router) {
    const go = router.go.bind(router);
    router.go = async (...args) => { const done = await go(...args); tryFont(); return done; };
  }
  await tryFont();
  return host;
}
