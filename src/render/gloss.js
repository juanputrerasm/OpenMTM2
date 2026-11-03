/*
  Paint that shines (docs/VISUALS.md, "Paint"), when "Glossy paint" is on. The game's trucks are
  lit as chalk is: by how they face the light and nothing else. Paint, glass and chrome also
  mirror what is around them, weakly seen square on and strongly at a glancing angle, and throw
  the sun back as a glint. This adds both to a truck's own materials:

   - the sky, as two colours read off the level's sky art (overhead and at the horizon), with
     the ground's colour below the horizon, in the direction a ray off the surface would go.
     The trucks are a few flat faces each, and a flat face mirrors one thing all over, so a
     face is taken as bulging a little, as a real panel does (game/lighting.js `PAINT`): what
     it mirrors changes across it;
   - the sun's glint, a sharp one and a broad one, where the sun reaches the surface: it is
     scaled by the direct light the surface got against what it would get in the open, so a
     truck in a cliff's shadow has none.

  A texture whose normal map carries Community Patch 3's shine mask (its alpha: opaque is flat) shines only where the
  mask is clear.

  Nothing in a shadow mirrors anything: a surface turned to the sun mirrors as far as the sun
  reaches it (a wheel arch, the underside, a truck under a cliff, none), one turned from it the
  sky it faces, less the further it faces down, and the running gear only where the sun is on it.

  In Rain everything is wet and shines the more for it. Nothing is drawn twice and there is no
  picture of the surroundings to keep, so a headset can afford it.
*/
import * as THREE from "three";
import { DEFAULT_GROUND, PAINT, meanTone, skyTones } from "../game/lighting.js";
import { WEATHER_LOOK } from "../game/weather.js";
import { addShaderHook } from "./shader-hooks.js";
import { skyOf } from "./track-scene.js";

/** How strongly each part of a truck shines (game/lighting.js `PAINT.parts`). */
export const GLOSS = PAINT.parts;
const FACE_ON = PAINT.faceOn, GLANCING = PAINT.glancing, WET = PAINT.wet;
/** Along each of a part's own axes, how fast a body's bulge turns: one over the square of its half size that way. */
const BULGE = PAINT.bulge.map((half) => 1 / (half * half));

const VERTEX_PARS = "varying vec3 vGlossRound;";
/* Which way the bulge of a body that size faces at this point of the part, in view space: straight out from its middle, by its shape. */
const VERTEX = `\tvGlossRound = normalMatrix * normalize( position * vec3( ${BULGE.map((v) => v.toFixed(5)).join(", ")} ) + vec3( 0.0, 1e-4, 0.0 ) );`;

const PARS = /* glsl */ `
varying vec3 vGlossRound;
uniform vec3 uGlossZenith, uGlossHorizon, uGlossGround, uGlossSunLight;
// the way to the sun (scene axes), and how much stronger everything shines for being wet
uniform vec4 uGlossSun;
`;

/* After the light is summed and before it is written: `outgoingLight` takes what the surface mirrors. */
const shine = (amount) => /* glsl */ `
{
  // A face mirrors as if it bulged a little, as a real panel does: what it shows then changes across it.
  vec3 glossN = normalize( mix( normalize( normal ), normalize( vGlossRound ) * ( gl_FrontFacing ? 1.0 : - 1.0 ), ${PAINT.round.toFixed(3)} ) );
  vec3 glossV = normalize( vViewPosition );
  float glossGlance = pow( clamp( 1.0 - dot( glossN, glossV ), 0.0, 1.0 ), 5.0 );
  // View space to the scene's: a direction times the view matrix from the left is that direction turned back.
  vec3 glossBack = ( vec4( reflect( - glossV, glossN ), 0.0 ) * viewMatrix ).xyz;
  vec3 glossUp = ( vec4( glossN, 0.0 ) * viewMatrix ).xyz;
  vec3 glossSky = mix( uGlossHorizon, uGlossZenith, smoothstep( 0.0, 0.75, glossBack.y ) );
  glossSky = mix( uGlossGround, glossSky, smoothstep( - 0.22, 0.04, glossBack.y ) );
  // How much of the sun reaches here: the direct light this surface got against what the sun gives it in the open.
  float glossFacing = max( dot( glossUp, uGlossSun.xyz ), 0.0 );
  vec3 glossOpen = diffuseColor.rgb * uGlossSunLight * ( glossFacing * 0.3183099 );
  float glossReached = clamp( dot( reflectedLight.directDiffuse, vec3( 0.3333 ) ) / max( dot( glossOpen, vec3( 0.3333 ) ), 1e-4 ), 0.0, 1.0 ) * step( 1e-3, glossFacing );
  float glossToSun = max( dot( glossBack, uGlossSun.xyz ), 0.0 );
  vec3 glossGlint = uGlossSunLight * ( pow( glossToSun, 260.0 ) * 1.6 + pow( glossToSun, 18.0 ) * ${PAINT.broadGlint.toFixed(3)} ) * glossReached;
  // What it mirrors, only where it is in the light: as far as the sun reaches a surface turned to it; for one turned
  // away, the open sky it faces${amount < 1 ? " (none for the running gear, which sits under the body)" : ""}.
  float glossOpenSky = ${amount < 1 ? "0.0" : "0.5 * pow( clamp( glossUp.y * 0.5 + 0.5, 0.0, 1.0 ), 2.0 )"};
  float glossLit = glossFacing > 1e-3 ? glossReached : glossOpenSky;
  // Community Patch 3's shine mask, where a normal map carries one (render/track-scene.js, shineMask): 1 elsewhere.
  #ifdef CP3_SHINE_MASK
  float glossMask = specularStrength;
  #else
  float glossMask = 1.0;
  #endif
  outgoingLight += glossMask * ${amount.toFixed(3)} * uGlossSun.w * ( ( ${FACE_ON.toFixed(3)} + ${(GLANCING - FACE_ON).toFixed(3)} * glossGlance ) * glossSky * glossLit + ${amount.toFixed(3)} * glossGlint );
}
`;

/**
 * @param {{ world: THREE.Object3D, sun: THREE.Light, groundArt?: object|null }} env
 *   `world` is the track, whose sky dome gives the sky's colours; `sun` the scene's sun as the
 *   weather has set it; `groundArt` the ground's textures, whose mean colour is what paint
 *   mirrors below the horizon.
 */
export function createGloss({ world, sun, groundArt = null }) {
  const uniforms = {
    uGlossZenith: { value: new THREE.Color() }, uGlossHorizon: { value: new THREE.Color() }, uGlossGround: { value: new THREE.Color() },
    uGlossSunLight: { value: new THREE.Color() }, uGlossSun: { value: new THREE.Vector4(0, 1, 0, 1) },
  };
  const ground = groundArt ? meanTone(groundArt) : [...DEFAULT_GROUND];
  let seen = null, tones = skyTones(null);

  return {
    /**
     * Make a truck's materials shine: `object` is its root (render/truck-object.js, whose
     * `userData.gloss` on a part says how strongly it does; the body's paint is 1).
     */
    dress(object) {
      object.traverse((mesh) => {
        if (!mesh.isMesh) return;
        let amount = null;
        for (let node = mesh; node && amount === null; node = node.parent) amount = node.userData.gloss ?? null;
        if (!amount) return;
        for (const material of [mesh.material].flat()) {
          // Only what the scene lights has light to add to; a material shared by two parts is dressed once.
          if (!(material?.isMeshLambertMaterial || material?.isMeshPhongMaterial) || material.userData.glossed) continue;
          material.userData.glossed = true;
          addShaderHook(material, `gloss:${amount.toFixed(3)}`, 30, (shader) => {
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = shader.vertexShader
              .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
              .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX}`);
            shader.fragmentShader = shader.fragmentShader
              .replace("#include <common>", `#include <common>\n${PARS}`)
              .replace("#include <opaque_fragment>", `${shine(amount)}\n#include <opaque_fragment>`);
          });
        }
      });
    },
    /** Once a frame: the sky that is up, the sun as it stands, and whether it rains. */
    update({ weather = 0 } = {}) {
      const image = skyOf(world)?.material?.map?.image ?? null;
      if (image !== seen) {
        seen = image;
        tones = skyTones(image ? { rgba: image.data, width: image.width, height: image.height } : null);
      }
      const look = WEATHER_LOOK[weather] ?? WEATHER_LOOK[0];
      uniforms.uGlossZenith.value.setRGB(tones.zenith[0], tones.zenith[1], tones.zenith[2]);
      uniforms.uGlossHorizon.value.setRGB(tones.horizon[0], tones.horizon[1], tones.horizon[2]);
      // The ground is as bright as the weather leaves it.
      uniforms.uGlossGround.value.setRGB(ground[0], ground[1], ground[2]).multiplyScalar(look.light);
      uniforms.uGlossSunLight.value.copy(sun.color).multiplyScalar(sun.intensity);
      const way = uniforms.uGlossSun.value;
      way.set(sun.position.x, sun.position.y, sun.position.z, 0).normalize();
      way.w = look.precipitation === "rain" ? WET : 1;
    },
    dispose() {},
  };
}
