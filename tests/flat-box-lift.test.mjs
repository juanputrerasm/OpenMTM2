/*
  Stacked flat models lift a truck in MTM2 (DDR Rumble's MAGELEV1 lift, Smile's rumble, Time Machine). The game keeps a
  flat model's box with no thickness (MONSTER.EXE 0x5495e0 sets no least size), so its two faces lie in one plane. The
  wheel test (0x4a6390) takes the nearest face either way along its line, the later face winning a tie, and only a face
  whose inward normal points down in the truck's frame carries the wheel: the back face of a plate turned up by theta
  1.57 is its top, and it wins the tie from below as well as from above (MTM2_PHYSICS.md 14.14).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mtm2Sim as S } from "../src/vendor/openphotex/index.js";
import { WHEEL_ORDER, faceNormal, nearestFace } from "../src/vendor/openphotex/sim/mtm2/collide/faces.js";

const plate = S.createBox([4046.5, 50.2, 3982.5], [32, 32, 0], 0, [1.57, 0, 0]);
const toBody = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const toWorld = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
/** The face a wheel's downward line meets from a hub `dy` feet from the plate, and that face's outward normal's world y. */
function met(dy) {
  const origin = toBody(plate.matrix, [0, dy, 0]);
  const dir = toBody(plate.matrix, [0, -1, 0]);
  const { face } = nearestFace(plate.half, origin, dir, false, WHEEL_ORDER);
  return { face, up: face < 0 ? 0 : toWorld(plate.matrix, faceNormal(face))[1] };
}

test("a flat plate's top carries a wheel over it", () => {
  const { face, up } = met(3);
  assert.ok(face >= 0);
  assert.ok(up > 0.5);
});

test("and a wheel under it too: the top wins the tie of the two faces in one plane", () => {
  const { face, up } = met(-8);
  assert.ok(face >= 0);
  assert.ok(up > 0.5);
});

test("a level box without a mass keeps its model's bounds; only a box that moves is made solid", () => {
  const worker = readFileSync(new URL("../src/worker/sim-worker.js", import.meta.url), "utf8");
  assert.match(worker, /S\.createLevelBox\(b, b\.mass >= 1 \? solidBounds\(b\.bounds\) : b\.bounds\)/);
});
