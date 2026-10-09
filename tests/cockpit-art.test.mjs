import test from "node:test";
import assert from "node:assert/strict";
import { loadCockpit } from "../src/worker/cockpit-art.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("stock cockpit art: panels, 15 wheel frames, 6 shifter frames, light, mirror and the finder", { skip: skipWithoutStock("COCKPIT.POD") }, async () => {
  const art = await loadCockpit(stockVfs());
  assert.ok(art);
  assert.deepEqual(art.layout.window3d, [0, 88, 640, 240]);
  for (const name of ["front", "left", "right", "back"]) assert.deepEqual([art.panels[name]?.width, art.panels[name]?.height], [640, 480], name);
  assert.equal(Object.values(art.wheel).filter(Boolean).length, 15);
  assert.equal(Object.values(art.shifter).filter(Boolean).length, 6);
  assert.deepEqual([art.shiftLight.width, art.shiftLight.height], [18, 19]);
  assert.deepEqual([art.mirror.width, art.mirror.height], [108, 56]);
  for (const key of ["ring", "arrowGreen", "arrowRed", "dotGreen", "dotRed"]) assert.ok(art.finder[key], key);
  assert.equal(art.panels.front.rgba.length, 640 * 480 * 4);
  // Pure black is cut out: the front panel has both opaque and transparent texels.
  const alphas = new Set(Array.from(art.panels.front.rgba.filter((_, i) => i % 4 === 3)));
  assert.ok(alphas.has(0) && alphas.has(255));
});
