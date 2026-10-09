import test from "node:test";
import assert from "node:assert/strict";
import { loadEffectsArt } from "../src/worker/effects-art.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("stock effect art: flakes, three raindrop sheets, four ice textures, blob, ripple and two splashes", { skip: skipWithoutStock("STARTUP.POD") }, async () => {
  const art = await loadEffectsArt(stockVfs());
  assert.equal(art.flakes.width, 64);
  assert.equal(art.drops.filter(Boolean).length, 3);
  assert.equal(art.ice.filter(Boolean).length, 4);
  assert.ok(art.blob && art.ripple);
  assert.equal(art.splash.filter(Boolean).length, 2);
  assert.equal(art.water.filter(Boolean).length, 8);
  // The flake sheet is bright flakes on black.
  const bright = art.flakes.rgba.filter((v, i) => i % 4 === 0 && v > 200).length;
  assert.ok(bright > 50 && bright < 64 * 64 / 2, String(bright));
});
