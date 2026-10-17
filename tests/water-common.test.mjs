/*
  What the level's water and the puddles draw alike (render/water-common.js; docs/VISUALS.md,
  "Water" and "Rain"): the sky they mirror, set the same way for both.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { BACKDROP_DARK } from "../src/game/atmosphere.js";
import { RAIN_RINGS_GLSL, mirrorSky, skyAlongGlsl } from "../src/render/water-common.js";

/** A colour as three.js's Color has it, for what `mirrorSky` copies and scales. */
function colour(r = 0, g = 0, b = 0) {
  return { r, g, b, copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }, multiplyScalar(k) { this.r *= k; this.g *= k; this.b *= k; return this; } };
}
const uniforms = () => ({ on: { value: -1 }, map: { value: "old" }, cap: { value: colour() }, horizon: { value: colour() }, dark: { value: -1 } });

test("the water mirrors the sky's dome where it is shown, its horizon veiled in the fog's colour", () => {
  const map = { name: "sky art" }, into = uniforms();
  const dome = { visible: true, material: { map }, userData: { cap: { material: { color: colour(0.2, 0.3, 0.4) } } } };
  mirrorSky(into, { sky: dome, fog: { color: colour(0.5, 0.5, 0.5) }, background: colour(1, 0, 0), light: 0.5, weather: 4 });
  assert.equal(into.on.value, 1);
  assert.equal(into.map.value, map);
  assert.equal(into.cap.value.b, 0.4);
  // The fog's colour as it is drawn: the dome is drawn as its art is, so neither is dimmed by the weather's light.
  assert.equal(into.horizon.value.r, 0.5);
  assert.equal(into.dark.value, 0);
});

test("with no sky to show the horizon stands for it, as dark as the weather's light, and the dark weathers darken it", () => {
  const into = uniforms();
  mirrorSky(into, { sky: { visible: false, material: { map: {} }, userData: {} }, fog: null, background: colour(0.8, 0.6, 0.4), light: 0.5, weather: 7 });
  assert.equal(into.on.value, 0);
  assert.equal(into.map.value, null);
  assert.equal(into.horizon.value.r, 0.4);
  assert.equal(into.dark.value, BACKDROP_DARK[7]);
  mirrorSky(into, {});
  assert.equal(into.on.value, 0);
});

test("the GLSL each takes reads what it is told to, and the rain's rings are declared once however often they are included", () => {
  const text = skyAlongGlsl("seen", { on: "a.x", map: "uMap", cap: "uCap", horizon: "uHz", dark: "a.y", veil: "a.z" });
  assert.match(text, /vec3 seen\( vec3 way, float blur \)/);
  for (const name of ["a.x", "uMap", "uCap", "uHz", "a.y", "a.z"]) assert.ok(text.includes(name), name);
  assert.match(RAIN_RINGS_GLSL, /#ifndef MTM_RAIN_RINGS/);
  assert.match(RAIN_RINGS_GLSL, /vec2 mtmRainRings\( vec2 p, float seconds \)/);
});
