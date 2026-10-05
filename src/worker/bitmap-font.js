/*
  The game's bitmap fonts (`ART\FNT<n>_480.RAW` with an `.ACT` palette, MONSTER_EXE_ANALYSIS.md
  section 17, loader 0x591200 / 0x591700).

  A font sheet is a palette-indexed image of known size. Background pixels are 255. A line of
  glyphs starts with a marker row: a pixel colour that is neither the background nor a glyph
  colour (254 in the stock fonts) is set along the top edge of each glyph's box. The glyphs
  hang below it until the next marker row. Marker runs, line by line and left to right, give the
  glyphs in this order: `!` to `~` (94), a box for the missing 0x7F, then 0x80 to 0xFF (128). A
  last marker row ends the sheet. Space has no glyph. Glyph pixels are colour 0 in the stock
  fonts, so the sheet is a mask: the game recolours it as it draws.
*/
const BACKGROUND = 255;

/** Sheet sizes for the 480 line set (the sizes the loader passes), by file stem. */
export const FONT_SHEETS = Object.freeze({
  FNTO_480: [248, 330], FNT1_480: [248, 330], FNT2_480: [384, 520],
});

/**
 * @param {Uint8Array} raw palette indices, width * height
 * @returns {{ width: number, height: number, lineHeight: number, glyphs: Map<number, { x: number, y: number, w: number, h: number }>, mask: Uint8Array }}
 *   `mask` is 255 where a glyph pixel is set and 0 elsewhere, same size as the sheet
 */
export function parseBitmapFont(raw, width, height) {
  if (raw.length < width * height) throw new Error("The font sheet is smaller than its size says.");
  const marker = raw.find((b) => b !== BACKGROUND);
  if (marker === undefined) throw new Error("No character markers found in the font sheet.");
  const rowsWithMarkers = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (raw[y * width + x] === marker) { rowsWithMarkers.push(y); break; }
    }
  }
  const order = [];
  for (let code = 0x21; code <= 0x7e; code++) order.push(code);
  for (let code = 0x7f; code <= 0xff; code++) order.push(code);
  const glyphs = new Map();
  let next = 0, lineHeight = 0;
  for (let i = 0; i < rowsWithMarkers.length - 1; i++) {
    const top = rowsWithMarkers[i], h = rowsWithMarkers[i + 1] - top - 1;
    lineHeight = Math.max(lineHeight, h);
    for (let x = 0; x < width;) {
      if (raw[top * width + x] !== marker) { x++; continue; }
      let end = x;
      while (end < width && raw[top * width + end] === marker) end++;
      if (next < order.length) glyphs.set(order[next++], { x, y: top + 1, w: end - x, h });
      x = end;
    }
  }
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = raw[i] !== BACKGROUND && raw[i] !== marker ? 255 : 0;
  return { width, height, lineHeight, glyphs, mask };
}

/** The width of a space and the gap between glyphs, from the line height. */
export function fontSpacing(font) {
  return { space: Math.round(font.lineHeight * 0.4), gap: 1 };
}

/** The width in sheet pixels of `text`; unknown characters count as the missing-glyph box. */
export function measureText(font, text) {
  const { space, gap } = fontSpacing(font);
  let w = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code === 0x20) { w += space; continue; }
    const g = font.glyphs.get(code) ?? font.glyphs.get(0x7f);
    if (g) w += g.w + gap;
  }
  return Math.max(0, w - (text.length ? gap : 0));
}
