import test from "node:test";
import assert from "node:assert/strict";
import { padCamera } from "../src/game/input/gamepad.js";
import { lookOptions, looksWith } from "../src/game/camera-look.js";

const pad = ({ rx = 0, ry = 0, left = false, right = false, mapping = "standard" } = {}) => ({
  mapping, axes: [0, 0, rx, ry], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: (i === 14 && left) || (i === 15 && right), value: 0 })),
});

test("a pad's right stick tilts the camera (up raises it) past a dead zone, and its D-pad left and right zoom", () => {
  assert.deepEqual(padCamera(pad()), { tilt: 0, zoom: 0, turn: 0 });
  assert.equal(padCamera(pad({ ry: -0.2 })).tilt, 0, "a resting thumb does not drift the camera");
  assert.equal(padCamera(pad({ ry: -1 })).tilt, 1);
  assert.equal(padCamera(pad({ ry: 1 })).tilt, -1);
  assert.equal(padCamera(pad({ left: true })).zoom, -1);
  assert.equal(padCamera(pad({ right: true })).zoom, 1);
  assert.deepEqual(padCamera(pad({ ry: -1, mapping: "" })), { tilt: 0, zoom: 0, turn: 0 }, "no standard mapping, no camera");
  // Its left and right turn the smooth cockpit look (CP4_EXE_ANALYSIS.md 6), right positive, past the same dead zone.
  assert.equal(padCamera(pad({ rx: 0.2 })).turn, 0);
  assert.equal(padCamera(pad({ rx: 1 })).turn, 1);
  assert.equal(padCamera(pad({ rx: -1 })).turn, -1);
});

test("Click to look: the mouse looks round only with a button held", () => {
  assert.equal(looksWith(lookOptions({}), 0), true);
  assert.equal(looksWith(lookOptions({ freeLookDrag: true }), 0), false);
  assert.equal(looksWith(lookOptions({ freeLookDrag: true }), 1), true);
});

test("a held zoom key goes on from 1x to 0.5x in a second, by the same proportion all the way, within the game's range", async () => {
  const { ZOOM_ONE, ZOOM_MIN, ZOOM_MAX, heldZoom, keptZoom } = await import("../src/game/z-zoom.js");
  let v = ZOOM_ONE;
  for (let i = 0; i < 100; i++) v = heldZoom(v, -1, 0.01);
  assert.ok(Math.abs(v - 2 * ZOOM_ONE) < 1);
  assert.equal(heldZoom(ZOOM_MAX, -1, 1), ZOOM_MAX);
  assert.equal(heldZoom(ZOOM_MIN, 1, 1), ZOOM_MIN);
  assert.equal(keptZoom(0x8000), 0x8000);
  assert.equal(keptZoom(5), null);
  assert.equal(keptZoom(undefined), null);
});

test("CP3's chase mirror: a quarter of the width, 30% of that high, centred, a 32nd down; 16% in a drag race", async () => {
  const { chaseMirrorRect } = await import("../src/game/cameras.js");
  assert.deepEqual(chaseMirrorRect({ x: 1280, y: 720 }), { x: 480, top: 22, w: 320, h: 96 });
  assert.equal(chaseMirrorRect({ x: 1000, y: 720 }, true).w, 160);
});

test("The smaller chase mirror: 16% of the width (12% in a drag race), same shape and place", async () => {
  const { chaseMirrorRect, chaseMirrorFigures, CHASE_MIRROR } = await import("../src/game/cameras.js");
  assert.equal(chaseMirrorFigures("original"), CHASE_MIRROR);
  assert.equal(chaseMirrorFigures(undefined), CHASE_MIRROR);
  assert.deepEqual(chaseMirrorRect({ x: 1000, y: 640 }, false, chaseMirrorFigures("small")), { x: 420, top: 20, w: 160, h: 48 });
  assert.equal(chaseMirrorRect({ x: 1000, y: 640 }, true, chaseMirrorFigures("small")).w, 120);
});
