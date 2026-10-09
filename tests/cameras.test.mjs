import test from "node:test";
import assert from "node:assert/strict";
import { CAMERA_MODES, blimpCamera, courseCentroid, createChaseCamera, distanceZoom, fovFor, nextMode, raceCamera, zoomToFov } from "../src/game/cameras.js";

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

test("the course's centre is the average of its straights' midpoints", () => {
  const course = [{ startFt: [0, 10, 0], endFt: [100, 10, 0] }, { startFt: [100, 30, 100], endFt: [100, 30, 300] }];
  assert.deepEqual(courseCentroid(course), [75, 20, 100]);
  assert.equal(courseCentroid([]), null);
});

test("the zoom follows the horizontal distance and is held between 0x1000 and 0x8000", () => {
  near(distanceZoom(100), 65536 / 6.25 / 65536);
  assert.equal(distanceZoom(1000), 0x1000 / 65536);
  assert.equal(distanceZoom(5), 0x8000 / 65536);
  assert.ok(zoomToFov(0.16) < 12 && zoomToFov(0.5) < zoomToFov(1));
});

test("BlimpCam hangs 100 ft from the truck toward a point 1000 ft over the course's centre", () => {
  const view = blimpCamera([2000, 100, 0], [0, 100, 0]);
  const away = Math.hypot(view.position[0] - 2000, view.position[1] - 100, view.position[2]);
  near(away, 100, 1e-6);
  assert.ok(view.position[0] < 2000 && view.position[1] > 100, "toward the centre and up");
  // Over the centre it hangs almost overhead and its pitch is held to 67.5 degrees.
  const over = blimpCamera([0, 100, 0], [0, 100, 0]);
  assert.ok(over.position[1] > 190);
  const look = [over.target[0] - over.position[0], over.target[1] - over.position[1], over.target[2] - over.position[2]];
  const pitch = Math.atan2(-look[1], Math.hypot(look[0], look[2]));
  assert.ok(pitch <= (0x3000 / 65536) * Math.PI * 2 + 1e-6);
});

test("RaceCam stands a quarter of the way along the straight the truck is heading for, over the ground", () => {
  const straights = [{ startFt: [0, 0, 0], endFt: [200, 0, 0] }, { startFt: [0, 0, 400], endFt: [200, 0, 400] }];
  const flat = () => 0;
  // Truck on straight 0 (segment 0) or on the arc after it (segment 1, heading for straight 1).
  near(raceCamera(straights, [50, 0, 0], 0, flat).position[0], 50);
  near(raceCamera(straights, [50, 0, 100], 1, flat).position[2], 400);
  // At least 14 ft over the highest ground between it and the truck.
  const hill = (x, z) => (z > 185 && z < 195 ? 80 : 0);
  assert.ok(raceCamera(straights, [50, 0, 100], 1, hill).position[1] >= 94 - 1e-9);
  // A long straight uses its middle when the truck is nearer it.
  const long = [{ startFt: [0, 0, 0], endFt: [1000, 0, 0] }];
  near(raceCamera(long, [600, 0, 50], 0, flat).position[0], 500);
  near(raceCamera(long, [10, 0, 50], 0, flat).position[0], 250);
  // Never farther than the view allows, and it looks at the truck.
  const far = raceCamera(straights, [50, 0, -5000], 1, flat);
  near(Math.hypot(far.position[0] - 50, far.position[2] + 5000), 30 * 32, 1);
  assert.equal(raceCamera([], [0, 0, 0], 0, flat), null);
});

test("Ctrl or Alt with a digit picks a view: 1 the cockpit, 0 the tenth", async () => {
  const { modeForShortcut } = await import("../src/game/cameras.js");
  assert.equal(modeForShortcut({ ctrlKey: true, code: "Digit1" }), 0);
  assert.equal(modeForShortcut({ ctrlKey: true, code: "Digit2" }), 1);
  assert.equal(modeForShortcut({ altKey: true, code: "Numpad5" }), 4);
  assert.equal(modeForShortcut({ ctrlKey: true, code: "Digit0" }), 9);
  assert.equal(modeForShortcut({ code: "Digit1" }), null);
  assert.equal(modeForShortcut({ ctrlKey: true, code: "KeyA" }), null);
  assert.equal(modeForShortcut({ ctrlKey: true, metaKey: true, code: "Digit1" }), null);
});
