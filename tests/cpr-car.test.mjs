import test from "node:test";
import assert from "node:assert/strict";
import { cprWheelPlaces } from "../src/worker/foreign-truck-build.js";

const box = (name, lo, hi) => ({ groupName: name, positions: [...lo, ...hi] });
const wheel = (r, w) => ({ meshes: [{ positions: [-w / 2, -r, -r, w / 2, r, r] }], bounds: { min: [-w / 2, -r, -r], max: [w / 2, r, r] } });

test("a CPR car's wheels stand at its suspension arms, the floor at the setup's ride height, a smaller wheel drawn lower", () => {
  // The stock cars' arms (model frame: z mirrored, the nose at -z), front wheels 1.03 ft, rear 1.15 ft.
  const body = { meshes: [
    box("RFSUSP", [0.59, 0.48, -5.41], [2.32, 1.44, -3.43]), box("LFSUSP", [-2.32, 0.48, -5.41], [-0.59, 1.44, -3.43]),
    box("RRSUSP", [0.59, 0.63, 4.69], [1.98, 1.54, 6.06]), box("LRSUSP", [-1.98, 0.63, 4.69], [-0.59, 1.54, 6.06]),
  ] };
  const front = wheel(1.03, 0.82), rear = wheel(1.15, 1.18);
  const placed = cprWheelPlaces({ body, tireFR: front, tireFL: front, tireRR: rear, tireRL: rear }, null);
  const [fr, fl, rr] = placed.anchors;
  assert.ok(Math.abs(fr[0] - 2.73) < 0.01 && Math.abs(fl[0] + 2.73) < 0.01, "out by the arm's end and half the wheel");
  assert.ok(Math.abs(fr[2] - 4.42) < 0.01 && Math.abs(rr[2] + 5.375) < 0.01, "at the arm's middle, in the game's z");
  assert.equal(placed.tire.radiusFt, 1.15, "the simulation rolls on the rear tire");
  // At rest the hub sits its sag over the anchor; the floor (y 0) is then the ride height over the ground.
  assert.ok(fr[1] > 0.9 && fr[1] < 1.03, `front anchor ${fr[1]}`);
  assert.ok(Math.abs(rr[1] - (1.15 - 0.208 - 0.034)) < 0.01, `rear anchor ${rr[1]}`);
  assert.ok(Math.abs(placed.tireLift[0] + 0.12) < 1e-9 && placed.tireLift[2] === 0);
  // Without the arms the manifest's anchors stand.
  const anchors = [[2.87, -0.33, 5], [-2.87, -0.33, 5], [2.64, -0.33, -5], [-2.64, -0.33, -5]];
  assert.equal(cprWheelPlaces({ body: { meshes: [] }, tireFR: front, tireFL: front, tireRR: rear, tireRL: rear }, anchors).anchors, anchors);
});
