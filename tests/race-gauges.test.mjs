import test from "node:test";
import assert from "node:assert/strict";
import { gaugeAngle, gearLabel, mphFromFeetPerSecond } from "../src/render/race-gauges.js";

test("race gauges convert feet per second and clamp their sweep", () => {
  assert.equal(mphFromFeetPerSecond(88), 60);
  assert.equal(mphFromFeetPerSecond(-88), 60);
  assert.equal(gaugeAngle(-1, 214.5, 2.65, 110), gaugeAngle(0, 214.5, 2.65, 110));
  assert.equal(gaugeAngle(120, 214.5, 2.65, 110), gaugeAngle(110, 214.5, 2.65, 110));
});

test("race gear numbers use the HUD's P R N 1 2 3 labels", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(gearLabel), ["P", "R", "N", "1", "2", "3"]);
});

test("the speedometer reads in kph, with its own full scale", async () => {
  const { kphFromFeetPerSecond, SPEED_SCALE } = await import("../src/render/race-gauges.js");
  assert.ok(Math.abs(kphFromFeetPerSecond(88) - 96.56) < 0.01);
  assert.equal(kphFromFeetPerSecond(-88), kphFromFeetPerSecond(88));
  assert.ok(SPEED_SCALE.kph.max >= 110 * 1.609);
});

test("the dials sweep as the exe's: 0 mph at 214.5 degrees, 2.65 degrees per mph", () => {
  const deg = (r) => (r * 180) / Math.PI;
  assert.ok(Math.abs(deg(gaugeAngle(0, 214.5, 2.65)) - 214.5) < 1e-9);
  assert.ok(Math.abs(deg(gaugeAngle(50, 214.5, 2.65)) - 347) < 1e-9, "50 mph points just above straight right");
  assert.ok(Math.abs(deg(gaugeAngle(8000, 63, 0.0261)) - 271.8) < 1e-9, "8000 rpm points almost straight up");
});

test("at 2560 x 1440 the HUD is laid out as Community Patch 3 draws it", async () => {
  const { gaugeLayout } = await import("../src/render/race-gauges.js");
  const { hudFontScale } = await import("../src/render/bitmap-text.js");
  assert.equal(hudFontScale(1440), 2, "fonts twice their size at 1440 lines");
  assert.equal(hudFontScale(480), 1);
  assert.equal(hudFontScale(200), 1, "never below the font's own size");
  const layout = gaugeLayout(2560, 1440, hudFontScale(1440));
  assert.deepEqual(layout.speedo, { x: 424, y: 1173 });
  assert.deepEqual(layout.tacho, { x: 2132, y: 1173 });
  assert.equal(layout.labelR, 219, "the numbers' radius grows with the height, so the dials stay round");
  assert.deepEqual(gaugeLayout().speedo, { x: 106, y: 391 }, "640 x 480 is the exe's own screen");
});

test("the dials' faces are drawn once a scale, and each reading lays them down and draws the needles over them", async () => {
  const { readFileSync } = await import("node:fs");
  const gauges = readFileSync(new URL("../src/render/race-gauges.js", import.meta.url), "utf8");
  // Drawn again only when the units or size change.
  assert.match(gauges, /if \(face && faceKey === key\) return face;/);
  // Each reading: the faces, then both needles, then the gear strip, in that order.
  const order = ["ctx.drawImage(faces(), 0, 0);", "drawNeedle(ctx, needle, layout.speedo", "drawNeedle(ctx, needle, layout.tacho", "labelOn(ctx, item,"];
  const at = order.map((line) => gauges.indexOf(line));
  assert.ok(at.every((i) => i > 0), "every step is there");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in that order");
});
