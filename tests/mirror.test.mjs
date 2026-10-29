/*
  The cockpit's rear-view mirror (src/ui/screens/race.js): the scene drawn again looking back,
  and read back for the dashboard (docs/VISUALS.md, "Cost", "On a small chip").
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const race = readFileSync(new URL("../src/ui/screens/race.js", import.meta.url), "utf8");

test("the mirror's picture is asked for and not waited for, and no second one is asked for meanwhile", () => {
  // Waiting for the graphics card held every other frame of the cockpit view.
  assert.match(race, /renderer\.readRenderTargetPixelsAsync\(mirrorTarget, 0, 0, mirrorTarget\.width, mirrorTarget\.height, mirrorPixels\)/);
  assert.doesNotMatch(race, /renderer\.readRenderTargetPixels\(/);
  assert.match(race, /if \(mirrorTick\+\+ % 2 \|\| mirrorReading\) return;/);
  // It is shown when it comes, if the mirror is still shown (the cockpit, facing forward, switched on).
  assert.match(race, /\.then\(\(\) => \{ if \(!disposed && mirrorShown\(\)\) cockpit\.setMirror\(/);
  assert.match(race, /const mirrorShown = \(\) => viewMode === 0 && dashMode\(\) === 0 && !!context\.cockpitMirror && cockpitTurn\(\) === 0;/);
});

test("the mirror's shaders are built when it is first drawn, the dust's among them", () => {
  assert.match(race, /weatherScene\.warmPools\(\(\) => renderer\.compile\(scene, mirrorCamera\)\);/);
  assert.match(race, /renderer\.compile\(scenery\.particles\.over\.scene, mirrorCamera\);/);
});
