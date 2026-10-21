/*
  Every shader a race draws with is built before the race starts (render/weather-scene.js
  `warmPools`, render/scenery.js `compile`): one built in the middle of a race stops the picture
  for as long as the graphics driver takes, a tenth of a second and more on a small chip.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the helicopters and pterodactyls are made with the scene, one of each a truck, so their shaders are built ahead", () => {
  const heli = read("../src/render/heli-object.js");
  assert.match(heli, /export function createHelicopters\(build, look, scene, count = 0\)/);
  assert.match(heli, /for \(let i = 0; i < count; i\+\+\) slot\(i\);/);
  assert.match(read("../src/ui/screens/race.js"), /createHelicopters\(build\.heli, look, scene, entrants\.length\)/);
});

test("the warm-up builds the ripples' step and, with the anti-aliasing and no lens, the passes that lay the dust on", () => {
  const scenery = read("../src/render/scenery.js");
  assert.match(scenery, /compile\(view\) \{\n(.*\n)*?\s*ripples\?\.warm\(\);/);
  assert.match(scenery, /if \(aa && !lens\) over\.warm\(view, scene\.fog, into\.depthTexture, into\.width, into\.height\);\n\s*else renderer\.compile\(over\.scene, view\);/);
  const over = read("../src/render/over-scene.js");
  // The heavy way, once: the puffs' picture deepened and laid on.
  assert.match(over, /warm\(camera, fog, depth, width, height\) \{\n\s*renderer\.compile\(scene, camera\);\n\s*const was = heavy;\n\s*heavy = true;\n\s*try \{ this\.lay\(this\.draw\(camera, fog, depth, width, height\)\); \} finally \{ heavy = was; \}/);
});
