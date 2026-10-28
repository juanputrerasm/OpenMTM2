/*
  A top-crush car's cab is drawn at its crush, never played in time (render/track-scene.js). The animated objects are
  placed by `placeAnimatedObjects` and moved by the `parts.morphing` loop; both must carry and honour `crushCar`
  (lost once in a refactor, which made MTM1 Hill Climb's cab loop from intact to flat).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scene = readFileSync(new URL("../src/render/track-scene.js", import.meta.url), "utf8");

test("the animated objects' meshes carry their top-crush car", () => {
  const place = scene.slice(scene.indexOf("export function placeAnimatedObjects"), scene.indexOf("export function createForest"));
  assert.match(place, /mesh\.userData\.crushCar = object\.crushCar/);
});

test("the morphing loop stands a cab at its crush instead of playing it", () => {
  const loop = scene.slice(scene.indexOf("for (const mesh of parts.morphing)"));
  const crush = loop.indexOf("mesh.userData.crushCar !== undefined");
  const played = loop.indexOf("world.userData.animationTime");
  assert.ok(crush >= 0 && crush < played, "the crush is checked before the frames are played in time");
});
