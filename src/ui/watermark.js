/*
  The "OpenMTM2 v0.3.1" mark in the corner of every screen, drawn with the game's own font.
  Until the font is in, or when the install has none, plain text stands in.
*/
import { drawText, loadFont, textWidth } from "../render/bitmap-text.js";
import { WATERMARK } from "../app/version.js";

export async function mountWatermark(assets) {
  const host = document.createElement("div");
  host.className = "watermark";
  host.textContent = WATERMARK;
  document.body.append(host);
  try {
    const font = assets ? await loadFont(assets, "FNT1_480") : null;
    if (!font) return host;
    const scale = 1.4, width = Math.ceil(textWidth(font, WATERMARK, scale)) + 2;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.ceil((font.lineHeight ?? 16) * scale) + 3;
    const ctx = canvas.getContext("2d");
    drawText(ctx, font, WATERMARK, 1, 1, { color: "#000", scale });
    drawText(ctx, font, WATERMARK, 0, 0, { color: "#fff", scale });
    host.replaceChildren(canvas);
  } catch { /* the plain text stays */ }
  return host;
}
