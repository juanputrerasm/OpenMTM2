import test from "node:test";
import assert from "node:assert/strict";
import { FONT_SHEETS, measureText, parseBitmapFont } from "../src/worker/bitmap-font.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("a font sheet's markers give glyph boxes, in the game's order", () => {
  // Two lines: "!" "\"" then "#"; marker 254, glyph colour 0, background 255.
  const W = 12, H = 12;
  const raw = new Uint8Array(W * H).fill(255);
  const set = (x, y, v) => { raw[y * W + x] = v; };
  for (const x of [1, 2]) set(x, 0, 254);          // "!" box, 2 wide
  for (const x of [5, 6, 7]) set(x, 0, 254);       // '"' box, 3 wide
  set(1, 2, 0); set(6, 3, 0);
  for (const x of [1, 2, 3, 4]) set(x, 6, 254);    // "#" box, 4 wide
  set(2, 8, 0);
  for (const x of [1]) set(x, 11, 254);            // end marker
  const font = parseBitmapFont(raw, W, H);
  assert.deepEqual(font.glyphs.get(0x21), { x: 1, y: 1, w: 2, h: 5 });
  assert.deepEqual(font.glyphs.get(0x22), { x: 5, y: 1, w: 3, h: 5 });
  assert.deepEqual(font.glyphs.get(0x23), { x: 1, y: 7, w: 4, h: 4 });
  assert.equal(font.mask[2 * W + 1], 255);
  assert.equal(font.mask[0], 0, "markers are not glyph pixels");
  assert.equal(measureText(font, "!\""), 2 + 1 + 3);
  assert.throws(() => parseBitmapFont(new Uint8Array(W * H).fill(255), W, H), /markers/);
});

test("the stock 480 fonts hold 223 glyphs: ! to ~, a box, and 0x80 to 0xFF", { skip: skipWithoutStock("POD.INI") }, async () => {
  const vfs = stockVfs();
  for (const [stem, [w, h]] of Object.entries(FONT_SHEETS)) {
    const raw = await vfs.read(`ART\\${stem}.RAW`);
    assert.equal(raw.length, w * h, stem);
    const font = parseBitmapFont(raw, w, h);
    assert.equal(font.glyphs.size, 223, stem);
    assert.ok(font.glyphs.has(0x41) && font.glyphs.has(0xff), stem);
    assert.ok(measureText(font, "Place: 1/8") > 40, stem);
  }
});
