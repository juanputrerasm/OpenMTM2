/*
  Text drawn with the game's bitmap fonts (src/worker/bitmap-font.js) on 2D canvases: the HUD
  and messages, and any other text that should look like the game's. The font sheet is a mask;
  it is tinted once per colour and cut into glyphs when drawing.
*/
import { fontSpacing } from "../worker/bitmap-font.js";

const loaded = new Map();

/** A font ready to draw with, loaded through the asset worker once per stem. */
export function loadFont(assets, stem) {
  if (!loaded.has(stem)) {
    loaded.set(stem, assets.call("font", { stem }).then((data) => {
      if (!data) return null;
      const glyphs = new Map(data.glyphs);
      const sheet = document.createElement("canvas");
      sheet.width = data.width;
      sheet.height = data.height;
      const rgba = new Uint8ClampedArray(data.width * data.height * 4);
      for (let i = 0; i < data.mask.length; i++) { rgba.fill(255, i * 4, i * 4 + 3); rgba[i * 4 + 3] = data.mask[i]; }
      sheet.getContext("2d").putImageData(new ImageData(rgba, data.width, data.height), 0, 0);
      return { glyphs, lineHeight: data.lineHeight, sheet, tinted: new Map() };
    }).catch(() => null));
  }
  return loaded.get(stem);
}

function tintedSheet(font, color) {
  if (!font.tinted.has(color)) {
    const c = document.createElement("canvas");
    c.width = font.sheet.width;
    c.height = font.sheet.height;
    const g = c.getContext("2d");
    g.drawImage(font.sheet, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    font.tinted.set(color, c);
  }
  return font.tinted.get(color);
}

/** Draw `text` with its top-left at (x, y); returns its width in canvas pixels. */
export function drawText(ctx, font, text, x, y, { color = "#fff", scale = 1 } = {}) {
  const { space, gap } = fontSpacing(font);
  const sheet = tintedSheet(font, color);
  ctx.imageSmoothingEnabled = false;
  let cx = x;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code === 0x20) { cx += space * scale; continue; }
    const g = font.glyphs.get(code) ?? font.glyphs.get(0x7f);
    if (!g) continue;
    ctx.drawImage(sheet, g.x, g.y, g.w, g.h, cx, y, g.w * scale, g.h * scale);
    cx += (g.w + gap) * scale;
  }
  return cx - x;
}

export function textWidth(font, text, scale = 1) {
  const { space, gap } = fontSpacing(font);
  let w = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code === 0x20) { w += space; continue; }
    const g = font.glyphs.get(code) ?? font.glyphs.get(0x7f);
    if (g) w += g.w + gap;
  }
  return Math.max(0, w - gap) * scale;
}

/**
 * A canvas that shows rows of text in a bitmap font. Rows are strings, or `[label, value]`
 * pairs drawn at the left and right of `width` (`fit` makes it as wide as the text instead),
 * on a `background` colour with `padX` and `padY` sheet pixels around (the caption bar), or `[label, value, middle]` with a second value
 * set just after the label (the HUD's `Place: 1/4     Lap: 1/2`); `rowHeight` is the row pitch. Falls back to plain text when the font is
 * missing. `set(rows)` redraws only when the text changes.
 */
export function createTextPanel(font, {
  width = 160, scale = 1, color = "#fff", labelColor = color, valueColor = color,
  align = "left", shadow = "#000", rowHeight = null, background = null, padX = 0, padY = 0, fit = false,
} = {}) {
  // Without the font (an install lacking it) the rows fall back to plain text.
  const canvas = document.createElement(font ? "canvas" : "div");
  canvas.className = "bitmap-text";
  let last = "";
  const pad = 2 * scale;
  return {
    element: canvas,
    set(rows) {
      const key = JSON.stringify(rows);
      if (key === last) return;
      last = key;
      if (!font) {
        canvas.replaceChildren(...rows.map((r) => {
          const line = document.createElement("div");
          line.textContent = Array.isArray(r) ? r.join(" ") : r;
          return line;
        }));
        return;
      }
      const lineH = (rowHeight ?? font.lineHeight + 1) * scale;
      // Wide enough for the widest row, with a gap between a label and its value.
      const content = Math.max(0, ...rows.map((r) => (Array.isArray(r)
        ? textWidth(font, r[0]) + textWidth(font, r[1]) + 10 : textWidth(font, r)) + 4));
      canvas.width = (Math.max(fit ? 0 : width, Math.ceil(content)) + 2 * padX) * scale;
      canvas.height = rows.length * lineH + pad * 2 + 2 * padY * scale;
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      const ctx = canvas.getContext("2d");
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      rows.forEach((row, i) => {
        const y = pad + padY * scale + i * lineH;
        const left = Array.isArray(row) ? row[0] : row, right = Array.isArray(row) ? row[1] : null;
        const draw = (text, x, c, dy = 0) => drawText(ctx, font, text, x, y + dy, { color: c, scale });
        const place = (text) => (align === "center" ? (canvas.width - textWidth(font, text, scale)) / 2 : pad + padX * scale);
        if (shadow) draw(left, place(left) + scale, shadow, scale);
        draw(left, place(left), labelColor);
        if (Array.isArray(row) && row[2]) {
          const x = place(left) + textWidth(font, `${left} `, scale) + 6 * scale;
          if (shadow) draw(row[2], x + scale, shadow, scale);
          draw(row[2], x, valueColor);
        }
        if (right !== null) {
          const x = canvas.width - pad - padX * scale - textWidth(font, right, scale);
          if (shadow) draw(right, x + scale, shadow, scale);
          draw(right, x, valueColor);
        }
      });
    },
  };
}

/** Break `text` into lines no wider than `maxWidth` sheet pixels (a single longer word stays whole). */
export function wrapText(font, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (line && textWidth(font, trial) > maxWidth) { lines.push(line); line = word; } else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}
