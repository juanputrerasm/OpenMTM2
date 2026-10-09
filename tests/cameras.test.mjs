import test from "node:test";
import assert from "node:assert/strict";
import { CAMERA_MODES, blimpCamera, createChaseCamera, createRaceCamera, fovFor, nextMode } from "../src/game/cameras.js";

const flat = () => 0;
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("ten views, in the exe's order", () => {
  assert.deepEqual(CAMERA_MODES.map((m) => m.name), [
    "Cockpit", "Chase Near", "Chase Far", "BlimpCam", "RaceCam", "Chase Front", "Chase Left", "Chase Right", "Chase Big Rear", "Chase Big Front",
  ]);
  assert.equal(nextMode(9), 0);
  assert.equal(nextMode(0, true), 9);
});

test("Chase Near sits 21.3 ft behind a truck facing +z and 11.25 degrees up", () => {
  const cam = createChaseCamera();
  const { position, target } = cam.update(1, [100, 10, 200], 0, flat, 0.016);
  const d = 0x1555 / 256, p = (0x800 / 65536) * Math.PI * 2;
  near(position[0], 100); near(position[2], 200 - d * Math.cos(p)); near(position[1], 10 + d * Math.sin(p));
  assert.deepEqual(target, [100, 10, 200]);
});

test("Chase Far is twice as far, Left and Right stand beside, Front ahead", () => {
  const at = (mode) => createChaseCamera().update(mode, [0, 0, 0], 0, () => -1000, 0.016).position;
  near(at(2)[2], 2 * at(1)[2], 1e-3);
  assert.ok(at(6)[0] < -20, "left of a truck facing +z is -x");
  assert.ok(at(7)[0] > 20);
  assert.ok(at(5)[2] > 20, "front is ahead of it");
  assert.ok(at(8)[1] > at(1)[1], "Big Rear is tilted up more");
});

test("the heading follows the truck's turn at 4 per second, not at once", () => {
  const cam = createChaseCamera();
  cam.update(1, [0, 0, 0], 0, flat, 0.016);
  const turned = cam.update(1, [0, 0, 0], Math.PI / 2, flat, 0.1).position;
  const direct = createChaseCamera().update(1, [0, 0, 0], Math.PI / 2, flat, 0.1).position;
  assert.ok(Math.hypot(turned[0] - direct[0], turned[2] - direct[2]) > 5);
});

test("the camera is tilted up, then pulled in, to stay over a hill behind the truck", () => {
  const hill = (x, z) => (z < -10 ? 40 : 0);
  const { position } = createChaseCamera().update(1, [0, 10, 0], 0, hill, 0.016);
  assert.ok(position[1] >= hill(position[0], position[2]) || Math.abs(position[2]) < 1);
});

test("zoom narrows the Big views' field of view and keeps Far at the base", () => {
  near(fovFor(2), 60, 1e-9);
  assert.ok(fovFor(8) < fovFor(1) && fovFor(1) < fovFor(2));
});

test("BlimpCam is above, RaceCam beside the course ahead", () => {
  assert.ok(blimpCamera([0, 0, 0], 0, flat).position[1] >= 250);
  const loop = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
  const race = createRaceCamera(loop).update([100, 0, 0], flat);
  assert.ok(Math.abs(race.position[2]) > 50 || Math.abs(race.position[0]) > 50);
});
