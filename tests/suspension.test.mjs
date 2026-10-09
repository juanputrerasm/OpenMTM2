import test from "node:test";
import assert from "node:assert/strict";
import { BAR_HALF_WIDTH_FT, barChassisPoint, ribbonCorners, suspensionParts } from "../src/game/suspension.js";

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
// Bigfoot's TRK: axlebarOffset 1.28125, -3.15625, -0.113281; driveshaftPos 0, -2.45625, -0.113281; axles at z +6.1 and -5.5, y -3.8.
const spec = {
  axles: [{ z: 6.1, travel: -3.8, articulation: 0 }, { z: -5.5, travel: -3.8, articulation: 0 }],
  axlebar: { x: 1.28125, y: -3.15625, z: -0.113281 }, driveshaft: { x: 0, y: -2.45625, z: -0.113281 },
};

test("the bar's chassis point is pulled in 0.1 ft, held below -2 ft and raised 39.68 units", () => {
  const p = barChassisPoint(spec.axlebar);
  near(p.x, 1.18125);
  near(p.y, -3.15625 + 39.68 / 256);
  near(p.z, -0.113281);
  assert.equal(barChassisPoint({ x: 1, y: -1, z: 0 }).y, -2 + 39.68 / 256, "a higher offset is held at -2 ft");
});

test("per axle: two bars, four shocks and a shaft; the bars run from the axle's ends to the chassis", () => {
  const { bars, shocks, shafts } = suspensionParts(spec);
  assert.deepEqual([bars.length, shocks.length, shafts.length], [4, 8, 2]);
  const [from, to] = bars[0];
  near(from[0], 2); near(from[1], -3.8 - 79 / 256); near(from[2], 6.1 - 79 / 256);
  near(to[0], 1.18125);
  // The rear bar's axle end is ahead of the axle, toward the chassis.
  assert.ok(bars[2][0][2] > -5.5);
});

test("shocks stand 2.12 ft out, from just above the axle to the body at the axle's z plus or minus 0.28 ft", () => {
  const [foot, top] = suspensionParts(spec).shocks[0];
  near(foot[0], 542 / 256); near(foot[1], -3.8 + 84 / 256);
  near(top[0], 542 / 256); near(top[1], 0);
  assert.ok(Math.abs(Math.abs(top[2] - 6.1) - 71.68 / 256) < 1e-9);
  near(Math.abs(foot[2] - 6.1), 71 / 256);
});

test("an axle's articulation tilts its parts about the centre; the shaft follows the axle's height", () => {
  const tilted = suspensionParts({ ...spec, axles: [{ z: 6.1, travel: -3.8, articulation: 0.2 }, spec.axles[1]] });
  const flat = suspensionParts(spec);
  assert.ok(tilted.bars[0][0][1] > flat.bars[0][0][1], "the right end rises");
  assert.ok(tilted.bars[1][0][1] < flat.bars[1][0][1], "the left end falls");
  const lifted = suspensionParts({ ...spec, axles: [{ z: 6.1, travel: -3.0, articulation: 0 }, spec.axles[1]] });
  assert.ok(lifted.shafts[0].to[1] > flat.shafts[0].to[1]);
  near(flat.shafts[0].length, Math.hypot(-3.8 + 2.45625, 6.1 + 0.113281));
});

test("a ribbon faces the viewer and is as wide as the game's", () => {
  const corners = ribbonCorners([0, 0, 0], [0, 1, 0], BAR_HALF_WIDTH_FT, [5, 0.5, 0]);
  // Looking along +x at a vertical ribbon, the width runs along z.
  near(Math.abs(corners[0][2]), BAR_HALF_WIDTH_FT);
  near(corners[0][2], -corners[1][2]);
  near(corners[0][1], 0); near(corners[3][1], 1);
  // Straight down the ribbon's length still gives a ribbon.
  const end = ribbonCorners([0, 0, 0], [0, 1, 0], 0.16, [0, 9, 0]);
  assert.ok(end.every((c) => c.every(Number.isFinite)));
});
