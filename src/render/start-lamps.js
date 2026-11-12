/*
  The start gantry's lamps as the port draws them with "Truck lamps" (docs/VISUALS.md, "Lamps";
  the numbers and when each bar is lit are game/truck-lights.js `START_LAMPS`). The game fills
  each bar's texture with a single colour (MONSTER_EXE_ANALYSIS.md 6.1, render/track-scene.js
  `setStartLights`); here the bar's face is a row of round lamps behind glass, each lit far past
  white at its middle so the lens flares it, in a dark housing. A lit lamp has a soft glow about
  it, seen from in front of the gantry, and in the dark a light of the lit bar's colour falls on
  the ground and the trucks under it.

  The bars are instanced (the world repeats), and only the copy nearest the eye has glows and
  the light: the others are a world away.
*/
import * as THREE from "three";
import { START_LAMPS, startLampCount, startLampGlow, startLampsLit } from "../game/truck-lights.js";
import { fogDims } from "./atmosphere.js";
import { addShaderHook } from "./shader-hooks.js";
import { lensTexture } from "./truck-object.js";

const BARS = { "STRTRED.RAW": "red", "STRTGRN.RAW": "green" };
/** Where the light in the dark is aimed from the bar's middle, on the model: forward and down. */
const AIM = new THREE.Vector3(0, -6, 10);
const glsl = (n) => n.toFixed(4);

/* The bar's face, worked out from where a point is on the model (before its copies are placed). */
const VERTEX_PARS = "varying vec3 vLampAt;\nvarying vec3 vLampFacing;";
const VERTEX = "\tvLampAt = position;\n\tvLampFacing = normal;";
const FRAGMENT_PARS = /* glsl */ `
varying vec3 vLampAt;
varying vec3 vLampFacing;
// the bar's face: from x, to x, its middle's height and how many lamps; the lit colour times how lit it is
uniform vec4 uLampBar;
uniform vec3 uLampLit;
// How far a point of the bar is from the middle of the nearest lamp, in lamp radii; 9 off the face.
float mtmLampOff() {
  if ( abs( vLampFacing.z ) < 0.5 ) return 9.0;
  float cell = ( uLampBar.y - uLampBar.x ) / uLampBar.w;
  vec2 off = vec2( ( fract( ( vLampAt.x - uLampBar.x ) / cell ) - 0.5 ) * cell, vLampAt.y - uLampBar.z );
  return length( off ) / ${glsl(START_LAMPS.radiusFt)};
}
`;
/* Glass in a dark housing, with a pale rim round each lamp. */
const COLOR = /* glsl */ `
  float mtmLampR = mtmLampOff();
  float mtmGlass = 1.0 - smoothstep( 0.9, 1.0, mtmLampR );
  float mtmRim = smoothstep( 0.96, 1.04, mtmLampR ) * ( 1.0 - smoothstep( 1.1, 1.2, mtmLampR ) );
  diffuseColor.rgb = mix( vec3( 0.035 ), uLampTone * 0.09 + 0.02, mtmGlass ) + vec3( 0.12 ) * mtmRim;
`;
/* A lit lamp is hottest at its middle. */
const EMISSIVE = /* glsl */ `
  totalEmissiveRadiance += uLampLit * mtmGlass * ${glsl(START_LAMPS.face)} * ( 0.35 + 0.65 * exp( - mtmLampR * mtmLampR * 2.5 ) );
`;

/**
 * @param {{ world: THREE.Object3D, scene: THREE.Scene, dark?: boolean }} env `dark` a weather
 *   that lights the trucks' lamps (game/weather.js `headlights`): there the lit bar lights what
 *   is under it.
 * @returns the lamps, or null where the track has no gantry
 */
export function createStartLamps({ world, scene, dark = false }) {
  const bars = [];
  world.traverse((object) => {
    const kind = BARS[object.material?.userData?.textureName];
    // A placed gantry is a mesh a copy of the world (track-scene.js `placeObjects`): the original's stands for them all.
    if (kind && object.isMesh && !object.userData.twinOf) bars.push({ object, kind });
  });
  if (!bars.length) return null;
  const root = new THREE.Group();
  root.name = "startLamps";
  scene.add(root);
  const instance = new THREE.Matrix4(), placed = new THREE.Matrix4(), turn = new THREE.Matrix3();
  for (const bar of bars) {
    const { object, kind } = bar;
    const tone = new THREE.Color(...START_LAMPS[kind]);
    // The face is the bar's side that faces along z; its lamps lie along x.
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox, length = box.max.x - box.min.x, count = startLampCount(length);
    const frontZ = box.max.z;
    bar.uniforms = { uLampBar: { value: new THREE.Vector4(box.min.x, box.max.x, (box.min.y + box.max.y) / 2, count) }, uLampLit: { value: new THREE.Vector3() }, uLampTone: { value: tone } };
    bar.tone = tone;
    bar.lamps = Array.from({ length: count }, (_, i) => new THREE.Vector3(box.min.x + ((i + 0.5) * length) / count, (box.min.y + box.max.y) / 2, frontZ + 0.12));
    bar.middle = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, frontZ);
    const material = object.material;
    material.map = null;
    material.emissiveMap = null;
    material.color.setRGB(1, 1, 1);
    material.emissive.setRGB(0, 0, 0);
    addShaderHook(material, "start-lamp", 40, (shader) => {
      Object.assign(shader.uniforms, bar.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}\nuniform vec3 uLampTone;`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${COLOR}`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${EMISSIVE}`);
    });
    // The glows, for the copy nearest the eye: one a lamp, light added to the view, which fog dims.
    bar.glows = bar.lamps.map(() => {
      const glow = new THREE.Sprite(fogDims(new THREE.SpriteMaterial({ map: lensTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })));
      glow.scale.setScalar(START_LAMPS.radiusFt * 5);
      glow.renderOrder = 2;
      glow.visible = false;
      root.add(glow);
      return glow;
    });
  }
  // In the dark, the lit bar's light on what is under the gantry: one light, made only for such a weather. It is never
  // hidden, only put out: a light hidden or shown changes what every lit material's shader is made with.
  // The lamps face forward, so it is thrown forward and down from the bar, and the gantry over them takes none of it.
  const light = dark ? new THREE.SpotLight(0xffffff, 0, START_LAMPS.reachFt, 1.15, 1, 1) : null;
  if (light) root.add(light, light.target);
  let lit = startLampsLit(true);
  const at = new THREE.Vector3(), facing = new THREE.Vector3(), toEye = new THREE.Vector3(), nearest = new THREE.Vector3();
  const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  return {
    /** The countdown is running (`counting`) or over: which bar is lit (MONSTER_EXE_ANALYSIS.md 6.1). */
    set(counting) {
      lit = startLampsLit(counting);
      for (const bar of bars) bar.uniforms.uLampLit.value.set(bar.tone.r, bar.tone.g, bar.tone.b).multiplyScalar(lit[bar.kind]);
    },
    /** Once a frame: `camera` the scene's, `daylight` how light the weather is (game/weather.js `light`). */
    update(camera, { daylight = 1 } = {}) {
      let lightAt = null, lightAim = null, lightTone = null, best = Infinity;
      for (const bar of bars) {
        // The placement nearest the eye, in whichever copy of the world.
        let object = bar.object, which = -1, least = Infinity;
        for (const mesh of [bar.object, ...(bar.object.userData.twins ?? [])]) {
          mesh.updateWorldMatrix(true, false);
          const count = mesh.isInstancedMesh ? mesh.count : 1;
          for (let i = 0; i < count; i++) {
            if (mesh.isInstancedMesh) mesh.getMatrixAt(i, instance); else instance.identity();
            placed.multiplyMatrices(mesh.matrixWorld, instance);
            const d = nearest.copy(bar.middle).applyMatrix4(placed).distanceToSquared(camera.position);
            if (d < least) { least = d; which = i; object = mesh; }
          }
        }
        if (object.isInstancedMesh) object.getMatrixAt(which, instance); else instance.identity();
        placed.multiplyMatrices(object.matrixWorld, instance);
        turn.getNormalMatrix(placed);
        facing.set(0, 0, 1).applyMatrix3(turn).normalize();
        const glow = startLampGlow(lit[bar.kind], daylight);
        bar.lamps.forEach((lamp, i) => {
          const sprite = bar.glows[i];
          at.copy(lamp).applyMatrix4(placed);
          toEye.copy(camera.position).sub(at);
          const distance = toEye.length() || 1;
          // Full from in front of the gantry, gone from behind it.
          const seen = glow * smoothstep(-0.1, 0.35, facing.dot(toEye.divideScalar(distance)));
          sprite.visible = seen > 0.01;
          if (!sprite.visible) return;
          sprite.material.color.copy(bar.tone).multiplyScalar(seen);
          sprite.position.copy(at).addScaledVector(toEye, Math.min(0.4, distance * 0.5));
        });
        if (lit[bar.kind] > 0 && least < best) {
          best = least;
          lightAt = nearest.copy(bar.middle).applyMatrix4(placed).clone();
          lightAim = nearest.copy(bar.middle).add(AIM).applyMatrix4(placed).clone();
          lightTone = bar.tone;
        }
      }
      if (light) {
        light.intensity = lightAt ? START_LAMPS.light : 0;
        if (lightAt) {
          light.position.copy(lightAt);
          light.target.position.copy(lightAim);
          light.color.copy(lightTone);
        }
      }
    },
    dispose() {
      scene.remove(root);
      for (const bar of bars) for (const glow of bar.glows) glow.material.dispose();
    },
  };
}
