/*
  The OpenMTM2 version mark in the corner of every screen, drawn with the game's own font at the HUD's whole-number
  scale (render/bitmap-text.js `hudFontScale`), one canvas pixel to one device pixel, as the timing board is.
  Until the font is in, or when the install has none, plain text stands in. The font is asked for again on every
  screen change until it comes: at the first start the archives are not mounted yet when the mark goes up.
  A screen with a bar along the bottom (the replay's controls) lifts the mark over it with `liftWatermark`.
*/
import { drawText, hudFontScale, loadFont, textWidth } from "../render/bitmap-text.js";
import { WATERMARK } from "../app/version.js";

let host = null;

/** Lift the mark `px` CSS pixels off the bottom edge (0 puts it back). */
export function liftWatermark(px) {
  document.documentElement.style.setProperty("--watermark-lift", `${Math.max(0, Math.round(px))}px`);
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
  drawText(ctx, font, WATERMARK, scale, scale, { color: "#000", scale });
  drawText(ctx, font, WATERMARK, 0, 0, { color: "#fff", scale });
  host.replaceChildren(canvas);
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
  if (router) {
    const go = router.go.bind(router);
    router.go = async (...args) => { const done = await go(...args); tryFont(); return done; };
  }
  await tryFont();
  return host;
}
