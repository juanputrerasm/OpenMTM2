import test from "node:test";
import assert from "node:assert/strict";
import { OMTM2_FONT, systemFontFor } from "../src/render/bitmap-text.js";

test("OpenMTM2 font in-game keeps the bitmap font's line height, so every layout keeps its size", () => {
  const font = systemFontFor(15);
  assert.equal(font.vector, true);
  assert.equal(font.lineHeight, 15);
  assert.ok(font.size > 0 && font.size <= 15);
  assert.match(OMTM2_FONT, /^"Trebuchet MS", "Segoe UI", system-ui, sans-serif$/);
});
