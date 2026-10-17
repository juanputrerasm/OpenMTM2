/*
  What fills the water about the eye (docs/VISUALS.md, "Under water"; the numbers are
  game/water.js `UNDERWATER_LOOK`), with "Reflective water", drawn only while the eye is under
  the level's water.

  Motes. Silt hangs in the water: specks a fraction of an inch across in a box about the eye,
  drifting with the water and swaying a little, lit as the water about them is and brighter. They
  are what shows the eye how it moves through the water. The box goes with the eye, each mote
  coming round again on its far side as it leaves the near one, and toward the box's edge they
  fade out, so it is never seen.

  Shafts. By day the sun comes down through the waves in shafts: long and narrow, slanting the way
  the surface bends the sunlight (game/water.js `sunUnderWater`), brightest under the surface and
  fading with depth as the water takes the light, each brightening and dimming as the waves over
  it gather the light and spread it. They stand in a square about the eye and come round as it
  moves, as the motes do. They are light, added to what is behind them, and what stands in front
  hides them.

  Both are worked out on the graphics card about the eye that draws them, so a headset's two eyes
  each have their own. The box and the square repeat across the world as they go round, so where
  a mote or a shaft is depends only on where the eye is, not on how it came there.
*/
import * as THREE from "three";
import { UNDERWATER_LOOK, sunUnderWater } from "../game/water.js";

const { motes: MOTES, moteBoxFt, moteFt, driftFtS, moteBright, moteGoneFt, shafts: SHAFTS, shaftFt, shaftBoxFt, shaftReachFt, shaftShare, shaftFadeFt } = UNDERWATER_LOOK;
const glsl = (n) => n.toFixed(4);
/** How much of the daylight on the water a mote sends back besides the water's own colour about it. */
const MOTE_PALE = 0.03;

const MOTE_VERTEX = /* glsl */ `
// where in the box (0 to 1 each way) and how wide, feet
attribute vec4 iMote;
// the water's level (scene y), seconds, the picture's height in pixels, whether the eye is under the water
uniform vec4 uAt;
varying float vShown;
void main() {
  // Drifting with the water and swaying a little, each by a way and a time of its own; the box goes with the eye.
  float seed = fract( iMote.x * 7.13 + iMote.y * 3.71 + iMote.z * 5.17 );
  vec3 sway = vec3( sin( uAt.y * 0.7 + seed * 40.0 ), sin( uAt.y * 0.5 + seed * 23.0 ) * 0.6, cos( uAt.y * 0.6 + seed * 31.0 ) ) * 0.4;
  vec3 at = iMote.xyz * ${glsl(moteBoxFt)} + vec3( 1.0, 0.15, 0.6 ) * ${glsl(driftFtS)} * uAt.y + sway;
  vec3 world = cameraPosition + mod( at - cameraPosition, ${glsl(moteBoxFt)} ) - ${glsl(moteBoxFt / 2)};
  vec4 view = viewMatrix * vec4( world, 1.0 );
  float away = length( view.xyz );
  // Only in the water, and fading out toward the box's edge.
  vShown = uAt.w * step( world.y, uAt.x ) * ( 1.0 - smoothstep( ${glsl(moteGoneFt * 0.5)}, ${glsl(moteGoneFt)}, away ) );
  gl_Position = projectionMatrix * view;
  // As wide as it is, and never under a pixel and a half: fainter instead.
  float pixels = iMote.w * projectionMatrix[ 1 ][ 1 ] * uAt.z * 0.5 / max( away, 0.1 );
  gl_PointSize = max( pixels, 1.5 );
  vShown *= min( 1.0, pixels / 1.5 );
}`;
const MOTE_FRAGMENT = /* glsl */ `
// the motes' colour: the water's own light, brighter
uniform vec3 uTone;
varying float vShown;
void main() {
  float round_ = 1.0 - smoothstep( 0.2, 0.5, length( gl_PointCoord - 0.5 ) );
  float alpha = vShown * round_ * 0.75;
  if ( alpha < 0.004 ) discard;
  gl_FragColor = vec4( uTone, 1.0 );
  #include <colorspace_fragment>
  gl_FragColor = vec4( gl_FragColor.rgb * alpha, alpha );
}`;

const SHAFT_VERTEX = /* glsl */ `
// where in the square (0 to 1 each way), how wide (feet), and a phase of its own
attribute vec4 iShaft;
// the way the sunlight runs down through the water (scene axes)
uniform vec3 uWay;
// the water's level (scene y), seconds
uniform vec2 uAt;
varying vec2 vAt;
varying float vDown, vAway, vPhase;
void main() {
  // Where the shaft meets the surface: its place in the square, which goes with the eye.
  vec2 corner = iShaft.xy * ${glsl(shaftBoxFt)};
  vec2 top = cameraPosition.xz + mod( corner - cameraPosition.xz, ${glsl(shaftBoxFt)} ) - ${glsl(shaftBoxFt / 2)};
  // Down along the way the light runs, turned about that line to face the eye.
  float down = position.y * ${glsl(shaftReachFt)};
  vec3 axis = vec3( top.x, uAt.x, top.y ) + uWay * down;
  vec3 across = cross( uWay, cameraPosition - axis );
  float wide = length( across );
  across = wide > 1e-4 ? across / wide : vec3( 1.0, 0.0, 0.0 );
  vec3 world = axis + across * ( position.x * iShaft.z );
  vec4 view = viewMatrix * vec4( world, 1.0 );
  vAt = vec2( position.x * 2.0, position.y );
  vDown = down;
  vAway = length( view.xyz );
  vPhase = iShaft.w;
  gl_Position = projectionMatrix * view;
}`;
const SHAFT_FRAGMENT = /* glsl */ `
// the sunlight a shaft carries
uniform vec3 uLight;
uniform vec2 uAt;
varying vec2 vAt;
varying float vDown, vAway, vPhase;
void main() {
  // Soft across, fading in under the surface and out with depth as the water takes the light, and out far off; brighter
  // and dimmer as the waves over it gather the light and spread it.
  float across = 1.0 - vAt.x * vAt.x;
  float waves = 0.55 + 0.45 * sin( uAt.y * ( 0.9 + vPhase * 0.6 ) + vPhase * 6.2832 ) * sin( uAt.y * 0.37 + vPhase * 17.0 );
  float strength = across * across * smoothstep( 0.0, 2.0, vDown ) * exp( - vDown / ${glsl(shaftFadeFt)} )
    * ( 1.0 - smoothstep( ${glsl(shaftBoxFt * 0.25)}, ${glsl(shaftBoxFt * 0.5)}, vAway ) ) * waves;
  if ( strength < 0.002 ) discard;
  // Light, added to what is behind it (three.js's additive blend weighs it by its alpha).
  gl_FragColor = vec4( uLight * strength, 1.0 );
  #include <colorspace_fragment>
}`;

/**
 * @param {{ scene: THREE.Scene, water: { under: { way: THREE.Vector3, sun: THREE.Color, daylight: THREE.Color, scatter: THREE.Color } } }} env
 *   `water` the level's water (render/water-surface.js), whose light under it the motes and shafts take
 */
export function createUnderwater({ scene, water, random = Math.random }) {
  const root = new THREE.Group();
  root.name = "underwater";
  root.visible = false;
  scene.add(root);

  const quad = (geometry) => { geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3)); geometry.setIndex([0, 1, 2, 0, 2, 3]); return geometry; };

  const moteGeometry = new THREE.BufferGeometry();
  const moteData = new Float32Array(MOTES * 4);
  for (let i = 0; i < MOTES; i++) moteData.set([random(), random(), random(), moteFt[0] + (moteFt[1] - moteFt[0]) * random() ** 2], i * 4);
  moteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  moteGeometry.setAttribute("iMote", new THREE.BufferAttribute(moteData, 4));
  const moteUniforms = { uAt: { value: new THREE.Vector4() }, uTone: { value: new THREE.Color() } };
  const motes = new THREE.Points(moteGeometry, new THREE.ShaderMaterial({
    vertexShader: MOTE_VERTEX, fragmentShader: MOTE_FRAGMENT, uniforms: moteUniforms,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  motes.frustumCulled = false;
  motes.renderOrder = 4;

  const shaftGeometry = quad(new THREE.InstancedBufferGeometry());
  const shaftData = new Float32Array(SHAFTS * 4);
  for (let i = 0; i < SHAFTS; i++) shaftData.set([random(), random(), shaftFt[0] + (shaftFt[1] - shaftFt[0]) * random(), random()], i * 4);
  shaftGeometry.setAttribute("iShaft", new THREE.InstancedBufferAttribute(shaftData, 4));
  shaftGeometry.instanceCount = SHAFTS;
  const shaftUniforms = { uWay: { value: new THREE.Vector3(0, -1, 0) }, uAt: { value: new THREE.Vector2() }, uLight: { value: new THREE.Color() } };
  const shafts = new THREE.Mesh(shaftGeometry, new THREE.ShaderMaterial({
    vertexShader: SHAFT_VERTEX, fragmentShader: SHAFT_FRAGMENT, uniforms: shaftUniforms,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  shafts.frustumCulled = false;
  shafts.renderOrder = 4;
  root.add(motes, shafts);

  let clock = 0;
  const way = new THREE.Vector3(), pale = new THREE.Color();
  return {
    /**
     * Once a frame: `under` how far under the water the eye is (0 above it), `levelFt` the water's level now (scene y),
     * `viewHeight` the picture's height in pixels, `fog` the water's colour as the eye sees it at its depth (the scene's
     * fog under water).
     */
    update(dt, { under = 0, levelFt = 0, viewHeight = 900, fog = null } = {}) {
      const { under: light } = water;
      clock = (clock + dt) % 4096;
      root.visible = under > 0;
      if (!root.visible) return;
      moteUniforms.uAt.value.set(levelFt, clock, viewHeight, Math.min(1, under));
      // The motes are lit as the water about them is, its colour at the eye's depth, and being pale silt they send back more
      // of the daylight than the water does, and paler.
      if (fog) moteUniforms.uTone.value.copy(fog).multiplyScalar(moteBright).add(pale.copy(light.daylight).multiplyScalar(MOTE_PALE));
      shaftUniforms.uAt.value.set(levelFt, clock);
      const [x, y, z] = sunUnderWater([light.way.x, light.way.y, light.way.z]);
      shaftUniforms.uWay.value.copy(way.set(x, y, z));
      // The sun's light that comes down into the water, its share in a shaft; none while the sun is down.
      shaftUniforms.uLight.value.copy(light.sun).multiplyScalar(shaftShare * Math.min(1, Math.max(0, light.way.y * 4)));
      shafts.visible = shaftUniforms.uLight.value.r + shaftUniforms.uLight.value.g + shaftUniforms.uLight.value.b > 1e-4;
    },
    dispose() {
      scene.remove(root);
      for (const mesh of [motes, shafts]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    },
  };
}
