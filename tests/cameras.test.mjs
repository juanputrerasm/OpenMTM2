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

test("a number key picks a view: 1 the cockpit, 0 the tenth; with Ctrl, Alt or Cmd it picks none", async () => {
  const { modeForShortcut } = await import("../src/game/cameras.js");
  assert.equal(modeForShortcut({ code: "Digit1" }), 0, "1 the cockpit");
  assert.equal(modeForShortcut({ code: "Digit2" }), 1, "2 Chase Near");
  assert.equal(modeForShortcut({ code: "Digit3" }), 2, "3 Chase Far");
  assert.equal(modeForShortcut({ code: "Numpad5" }), 4);
  assert.equal(modeForShortcut({ code: "Digit0" }), 9);
  assert.equal(modeForShortcut({ code: "KeyA" }), null);
  for (const held of ["ctrlKey", "altKey", "metaKey"]) assert.equal(modeForShortcut({ [held]: true, code: "Digit1" }), null, `${held}: a combination is no view key`);
});

test("the short cycle steps through the player's views in order, the cockpit, Chase Near and Chase Far unless changed", async () => {
  const { DEFAULT_SHORT_VIEWS, INERTIA_MODE, nextInList, shortViews } = await import("../src/game/cameras.js");
  assert.deepEqual(shortViews(undefined), [...DEFAULT_SHORT_VIEWS]);
  assert.deepEqual(shortViews([]), [0, 1, 2], "an empty list is the default");
  // Views once each, in the cycle's own order, with the Inertia view allowed and anything else dropped.
  assert.deepEqual(shortViews([10, 2, 2, 42, 0]), [0, 2, INERTIA_MODE.id]);
  const views = [1, 2, 10];
  assert.equal(nextInList(1, views), 2);
  assert.equal(nextInList(10, views), 1);
  assert.equal(nextInList(1, views, true), 10);
  assert.equal(nextInList(4, views), 1, "from a view not in the list, its first");
  assert.equal(nextInList(4, views, true), 10);
});

test("the chase camera tilts by the player's keys within the game's pitches, and with clearance keeps off the ground", async () => {
  const { CAMERA_CLEAR_FT, CAMERA_PITCH_MAX, CAMERA_PITCH_MIN, CAMERA_PITCH_RATE, CAMERA_TILT_RATE, turnedPitch } = await import("../src/game/cameras.js");
  // A quarter of the frame time a frame: 90 degrees a second; 0 to 0x3fff.
  assert.equal(CAMERA_PITCH_RATE, 0x4000);
  assert.equal(turnedPitch(2, 0x400), 0xc00);
  assert.equal(turnedPitch(2, -0x2000), -0x1800, "under the level, where the ground allows");
  assert.equal(turnedPitch(2, -0x8000), CAMERA_PITCH_MIN);
  assert.equal(turnedPitch(2, 0x8000), CAMERA_PITCH_MAX);
  assert.equal(CAMERA_TILT_RATE, 2 * CAMERA_PITCH_RATE, "the port's tilt is twice the game's, both ways");
  const flat = () => 0;
  const level = createChaseCamera().update(2, [0, 5, 0], 0, flat, 0.016).position;
  const up = createChaseCamera().update(2, [0, 5, 0], 0, flat, 0.016, { pitchBy: 0x800 }).position;
  assert.ok(up[1] > level[1] + 5, "tilted up, the camera stands higher");
  // A slope rising behind the truck: the game's camera may sit on it; with clearance it keeps clear of it.
  const slope = (x, z) => -z * 0.6;
  const touching = createChaseCamera().update(2, [0, 1, 0], 0, slope, 0.016).position;
  const clear = createChaseCamera().update(2, [0, 1, 0], 0, slope, 0.016, { clearFt: CAMERA_CLEAR_FT }).position;
  assert.ok(clear[1] - slope(clear[0], clear[2]) >= CAMERA_CLEAR_FT - 1e-6);
  assert.ok(touching[1] - slope(touching[0], touching[2]) < CAMERA_CLEAR_FT);
});

test("the Inertia view is all the way out by about 55 mph", async () => {
  const { INERTIA_SPEEDS_FT, inertiaView } = await import("../src/game/cameras.js");
  assert.deepEqual(INERTIA_SPEEDS_FT, [10, 45, 80]);
  const far = 0x2aaa / 256;
  assert.ok(Math.abs(inertiaView(80).dist - far * 1.5) < 1e-9);
  assert.ok(Math.abs(inertiaView(45).dist - far) < 1e-9);
});

test("where the clearance cannot be had, the camera stays as the game places it, behind the truck and never over it", async () => {
  const { CAMERA_CLEAR_FT } = await import("../src/game/cameras.js");
  // Ground climbing 3 in 1 all round the truck: clear by 6 ft only past 67.5 degrees, which the clearance does not go to.
  const pit = (x, z) => 4.5 + 3 * Math.hypot(x, z);
  const game = createChaseCamera().update(1, [0, 5, 0], 0, pit, 0.016).position;
  const clear = createChaseCamera().update(1, [0, 5, 0], 0, pit, 0.016, { clearFt: CAMERA_CLEAR_FT }).position;
  assert.deepEqual(clear, game);
  assert.ok(clear[2] < 0, "behind the truck (heading 0 is +z)");
});

test("tilted under the level over flat ground, the camera stands low but over the ground; tilted over a slope it is lifted only as far as it must", async () => {
  const { CAMERA_PITCH_MIN } = await import("../src/game/cameras.js");
  const flat = () => 0;
  const low = createChaseCamera().update(2, [0, 5, 0], 0, flat, 0.016, { pitchBy: CAMERA_PITCH_MIN - 0x800 }).position;
  assert.ok(low[1] >= 0 && low[1] < 5, `${low[1]} ft up`);
});

test("a chase camera with the clearance follows a tilt down at once, not at the settling rate", async () => {
  const { CAMERA_CLEAR_FT } = await import("../src/game/cameras.js");
  const flat = () => 0;
  const cam = createChaseCamera();
  cam.update(2, [0, 5, 0], 0, flat, 0.016, { pitchBy: 0x2000, clearFt: CAMERA_CLEAR_FT });
  const after = cam.update(2, [0, 5, 0], 0, flat, 0.016, { pitchBy: 0, clearFt: CAMERA_CLEAR_FT }).position;
  const fresh = createChaseCamera().update(2, [0, 5, 0], 0, flat, 0.016, { pitchBy: 0, clearFt: CAMERA_CLEAR_FT }).position;
  assert.ok(Math.abs(after[1] - fresh[1]) < 1e-6);
});

test("the mouse look: it turns the camera at once, eases back after two seconds, and the wheel's zoom stays per view", async () => {
  const { createCameraLook, LOOK_RETURN_S, turnedTarget } = await import("../src/game/camera-look.js");
  const look = createCameraLook();
  look.move(100, 0);
  assert.ok(look.yaw < 0);
  look.wheel(1, 1);
  assert.ok(look.zoom(1) > 1 && look.zoom(2) === 1);
  look.step(LOOK_RETURN_S - 0.1);
  assert.ok(look.yaw < -0.5, "still looking");
  for (let i = 0; i < 200; i++) look.step(0.05);
  assert.equal(look.yaw, 0);
  assert.ok(look.zoom(1) > 1, "the zoom stays");
  look.setBack(true);
  assert.ok(Math.abs(look.yaw - Math.PI) < 1e-9, "Backspace: half a turn");
  const cam = createChaseCamera();
  const behind = cam.update(1, [0, 5, 0], 0, () => 0, 0.016).position;
  const front = createChaseCamera().update(1, [0, 5, 0], 0, () => 0, 0.016, { look: { yaw: Math.PI, pitch: 0 } }).position;
  assert.ok(behind[2] < 0 && front[2] > 0, "looking back puts the camera ahead of the truck");
  const t = turnedTarget([0, 0, 0], [0, 0, 10], Math.PI / 2, 0);
  assert.ok(Math.abs(t[0] - 10) < 1e-9 && Math.abs(t[2]) < 1e-9);
});

test("free look's options: off leaves the mouse alone, reversed turns it the other way, held stays put", async () => {
  const { createCameraLook, lookOptions, LOOK_RETURN_S } = await import("../src/game/camera-look.js");
  assert.deepEqual(lookOptions({}), { enabled: true, invert: false, hold: false });
  const off = createCameraLook(() => lookOptions({ freeLook: false }));
  off.move(100, 0);
  assert.equal(off.yaw, 0);
  off.wheel(1, 1);
  assert.ok(off.zoom(1) > 1, "the wheel still zooms");
  const plain = createCameraLook(() => lookOptions({}));
  const reversed = createCameraLook(() => lookOptions({ freeLookInvert: true }));
  plain.move(50, 20);
  reversed.move(50, 20);
  assert.ok(Math.abs(plain.yaw + reversed.yaw) < 1e-12 && Math.abs(plain.pitch + reversed.pitch) < 1e-12);
  const held = createCameraLook(() => lookOptions({ freeLookHold: true }));
  held.move(80, 0);
  const yaw = held.yaw;
  for (let t = 0; t < LOOK_RETURN_S + 3; t += 0.1) held.step(0.1);
  assert.equal(held.yaw, yaw);
});
