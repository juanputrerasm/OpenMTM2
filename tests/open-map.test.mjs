import test from "node:test";
import assert from "node:assert/strict";
import { easeAngle, stripFade } from "../src/render/open-map.js";

test("the OpenMTM2 map eases its turn toward the truck's heading", () => {
  assert.equal(easeAngle(0.2, 1, 0), 0.2, "no time, no turn");
  const step = easeAngle(0, 1, 0.1, 0.3);
  assert.ok(step > 0 && step < 1, "part of the way in one frame");
  let a = 0;
  for (let i = 0; i < 300; i++) a = easeAngle(a, 1, 1 / 60, 0.3);
  assert.ok(Math.abs(a - 1) < 1e-6, "there in the end");
});

test("the OpenMTM2 map turns the short way across a half turn", () => {
  const a = easeAngle(3, -3, 0.1, 0.3);
  assert.ok(a > 3 || a < -3, "past +PI, not back through 0");
});

test("the strip's marks fade toward its ends", () => {
  assert.equal(stripFade(0, 0.3, 0.1), 0);
  assert.equal(stripFade(1, 0.3, 0.1), 0);
  assert.equal(stripFade(0.5, 0.3, 0.1), 1);
  assert.ok(Math.abs(stripFade(0.15, 0.3, 0.1) - 0.5) < 1e-9);
});

test("the Map zoom keys step through the zooms, held at the ends; a stored zoom reads as the nearest step", async () => {
  const { OPEN_MAP_ZOOMS, OPEN_MAP_DEFAULT_ZOOM, openMapZoom, stepOpenMapZoom } = await import("../src/render/open-map.js");
  assert.ok(OPEN_MAP_ZOOMS.includes(OPEN_MAP_DEFAULT_ZOOM));
  assert.equal(openMapZoom(undefined), OPEN_MAP_DEFAULT_ZOOM);
  assert.equal(openMapZoom(1.1), 1);
  const top = OPEN_MAP_ZOOMS[OPEN_MAP_ZOOMS.length - 1];
  assert.equal(stepOpenMapZoom(top, 1), top);
  assert.equal(stepOpenMapZoom(OPEN_MAP_ZOOMS[0], -1), OPEN_MAP_ZOOMS[0]);
  assert.equal(stepOpenMapZoom(1, 1), OPEN_MAP_ZOOMS[OPEN_MAP_ZOOMS.indexOf(1) + 1]);
});

test("the tilted view keeps the truck's own scale beside it and draws the road ahead smaller", async () => {
  const { tiltProject } = await import("../src/render/open-map.js");
  assert.deepEqual(tiltProject(50, 0, 0.85, 1000), [50, 0]);
  const near = tiltProject(0, 500, 0.85, 1000), far = tiltProject(0, 1000, 0.85, 1000);
  assert.ok(near[1] < 500 && far[1] < 1000 && far[1] > near[1], "farther is higher up, but closer together");
  assert.ok(tiltProject(100, 1000, 0.85, 1000)[0] < 100, "narrower far off");
  assert.equal(tiltProject(0, -5000, 0.85, 1000), null, "behind the eye is not drawn");
});
