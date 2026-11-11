// The fly camera's list of keys in the game's font (ui/fly-controller.js): small and pixel exact.

import test from "node:test";
import assert from "node:assert/strict";
import { listFontScale } from "../src/ui/fly-controller.js";
import { hudFontScale } from "../src/render/bitmap-text.js";

test("the list of keys is drawn at a whole number of device pixels per font pixel, no larger than the timing board", () => {
  for (const height of [480, 720, 900, 1080, 1440, 1600, 1800, 2160, 2880]) {
    const s = listFontScale(height);
    assert.ok(Number.isInteger(s) && s >= 1, `${height}: ${s}`);
    assert.ok(s <= hudFontScale(height), `${height}: ${s} over the board's ${hudFontScale(height)}`);
  }
  assert.equal(listFontScale(1080), 1);
  assert.equal(listFontScale(1800), 2);
  assert.equal(listFontScale(2160), 2);
});
