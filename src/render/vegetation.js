/*
  Community Patch 4's vegetation (docs/CP4_EXE_ANALYSIS.md 3; docs/VISUALS.md, "Vegetation"): the
  trees and grass of WORLD\<stem>.VEG, built by species in the worker (worker/cp4-world.js
  `buildVegetation`), drawn as instanced models.

  Each species' model, and its far card where it has one, is cut into square chunks of the world
  (MODEL_CHUNK_FT for models and grass, CARD_CHUNK_FT for the cards, which reach much further),
  one InstancedMesh a chunk and model part, as 4x4 Evolution's forest is (render/track-scene.js
  `createForest`): each frame a chunk is moved to the copy of the world nearest the eye, and one
  wholly beyond its band is not drawn. Within a chunk each instance is shown by its own distance
  from the eye, as the engine's rules have it (game/vegetation.js `vegDistances`): a tree's model to
  950 ft and its card from there, or the two crossfading over 900..1000 ft where the species asks
  for it; grass fading out from three quarters of its distance. A fade is drawn as a dither of
  the instance's pixels (no sorting, and it writes depth as a solid does); an instance wholly out
  of its band has its vertices put outside the picture.

  Shadows, where the sun casts them: a species' model casts with its "cast shadow" flag and its
  card with "far shadow" (the flags as Traxx 1.7 writes them; the engine's own shadows are not
  traced). A shadow is cast only where the eye draws the instance, at half its fade.
*/
import * as THREE from "three";
import { blockShift } from "../shared/object-chunks.js";
import { addShaderHook } from "./shader-hooks.js";

const MODEL_CHUNK_FT = 512, CARD_CHUNK_FT = 2048;
const FAR = 1e9;
/** After the ground, as the forest (render/track-scene.js FOREST_ORDER). */
const VEGETATION_ORDER = 0.875;
/** The numbers an instance takes in `place` (worker/cp4-world.js VEG_PLACE_STRIDE). */
const STRIDE = 8;

const VERTEX_PARS = /* glsl */ `
uniform vec3 uVegEye;
uniform vec4 uVegBand;
varying float vVegFade;
`;
const VERTEX = /* glsl */ `
  {
    #ifdef USE_INSTANCING
      vec3 vegAt = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
    #else
      vec3 vegAt = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
    #endif
    float vegDist = distance( vegAt, uVegEye );
    float vegRise = uVegBand.y > uVegBand.x ? clamp( ( vegDist - uVegBand.x ) / ( uVegBand.y - uVegBand.x ), 0.0, 1.0 ) : step( uVegBand.x, vegDist );
    float vegFall = uVegBand.w > uVegBand.z ? 1.0 - clamp( ( vegDist - uVegBand.z ) / ( uVegBand.w - uVegBand.z ), 0.0, 1.0 ) : 1.0 - step( uVegBand.z, vegDist );
    vVegFade = vegRise * vegFall;
    // Wholly out of its band: outside the picture, so none of its triangles is drawn.
    if ( vVegFade <= 0.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
  }
`;
const FRAGMENT_PARS = "varying float vVegFade;";
// A fade as a dither over the picture (interleaved gradient noise); the shadow takes half the fade as its edge.
const FRAGMENT = /* glsl */ `
  #ifdef VEG_SHADOW
    if ( vVegFade < 0.5 ) discard;
  #else
    if ( vVegFade < 1.0 && vVegFade <= fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) ) discard;
  #endif
`;

function fadeHook(material, uniforms) {
  return addShaderHook(material, "cp4-veg-fade", 40, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <clipping_planes_fragment>", `${FRAGMENT}\n#include <clipping_planes_fragment>`);
  });
}

/** A model part's material with the band's fade, keeping whatever the library gave it (its own shader hooks among it). */
function fadeMaterial(material, uniforms) {
  const faded = material.clone();
  const hooks = material.userData.shaderHooks;
  if (hooks) faded.userData.shaderHooks = hooks.map((hook) => ({ ...hook }));
  else if (Object.prototype.hasOwnProperty.call(material, "onBeforeCompile")) {
    faded.onBeforeCompile = material.onBeforeCompile;
    faded.customProgramCacheKey = material.customProgramCacheKey;
  }
  return fadeHook(faded, uniforms);
}

/** The part's shadow, with its texture's cut-outs and the same band. */
function fadeDepthMaterial(material, uniforms) {
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: material.map ?? null, alphaTest: material.alphaTest ?? 0 });
  depth.defines = { VEG_SHADOW: "" };
  return fadeHook(depth, uniforms);
}

/**
 * The vegetation of a build (`build.vegetation`) drawn with `library` (render/track-scene.js `createModelLibrary`, which
 * holds the species' models), or null. `grass` false leaves the grass out.
 * @returns {{ group: THREE.Group, update: (camera: THREE.Camera, range?: number, wraps?: boolean) => boolean, dispose: () => void } | null}
 */
export function createVegetation(library, vegetation, { grass = true, worldFt = 8192 } = {}) {
  // `worldFt`: the world's size, for each chunk's copy nearest the eye (a track format version 6 world may be 16384 ft).
  if (!vegetation?.species?.length) return null;
  const group = new THREE.Group();
  group.name = "vegetation";
  const eye = { value: new THREE.Vector3() };
  const chunks = [];
  const materials = [];
  const matrix = new THREE.Matrix4();

  const addLayer = (name, band, castShadow, place, chunkFt) => {
    const parts = library.get(name);
    if (!parts || !band) return;
    const uniforms = { uVegEye: eye, uVegBand: { value: new THREE.Vector4(...band.map((v) => (Number.isFinite(v) ? v : FAR))) } };
    const faded = parts.map(({ material }) => fadeMaterial(material, uniforms));
    const depths = castShadow ? parts.map(({ material }) => fadeDepthMaterial(material, uniforms)) : [];
    materials.push(...faded, ...depths);
    // The instances by chunk (game x and z, the scene's z mirrored).
    const byChunk = new Map();
    for (let i = 0; i + STRIDE <= place.length; i += STRIDE) {
      const cx = Math.floor(place[i] / chunkFt), cz = Math.floor(-place[i + 2] / chunkFt);
      const key = cx * 4096 + cz;
      if (!byChunk.has(key)) byChunk.set(key, { cx, cz, at: [] });
      byChunk.get(key).at.push(i);
    }
    for (const { cx, cz, at } of byChunk.values()) {
      const centre = [(cx + 0.5) * chunkFt, -(cz + 0.5) * chunkFt];
      parts.forEach(({ geometry }, k) => {
        const mesh = new THREE.InstancedMesh(geometry, faded[k], at.length);
        mesh.name = "vegetation";
        mesh.matrixAutoUpdate = false;
        at.forEach((i, n) => {
          const s = place[i + 7];
          matrix.set(
            place[i + 3] * s, 0, place[i + 5] * s, place[i],
            0, s, 0, place[i + 1],
            place[i + 4] * s, 0, place[i + 6] * s, place[i + 2],
            0, 0, 0, 1,
          );
          mesh.setMatrixAt(n, matrix);
        });
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        mesh.computeBoundingSphere();
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        if (castShadow) mesh.customDepthMaterial = depths[k];
        mesh.renderOrder = VEGETATION_ORDER;
        mesh.userData.veg = { centre, half: chunkFt / 2, reach: band[3] };
        group.add(mesh);
        chunks.push(mesh);
      });
    }
  };
  for (const species of vegetation.species) {
    if (species.kind === "grass" && !grass) continue;
    addLayer(species.model, species.modelBand, species.castShadow, species.place, MODEL_CHUNK_FT);
    if (species.card) addLayer(species.card, species.cardBand, species.cardShadow, species.place, CARD_CHUNK_FT);
  }
  if (!chunks.length) return null;

  return {
    group,
    /**
     * Once a frame, before the scene is drawn: the eye the bands are measured from, each chunk at the copy of the world
     * nearest it (`wraps`), and left out when wholly beyond its band or beyond `range`. Whether anything moved or
     * turned on or off (the shadows' copy of what stands still then needs drawing again).
     */
    update(camera, range = Infinity, wraps = true) {
      camera.getWorldPosition(eye.value);
      const ex = eye.value.x, ez = eye.value.z;
      let moved = false;
      for (const mesh of chunks) {
        const { centre: [x, z], half, reach } = mesh.userData.veg;
        const [dx, dz] = wraps ? blockShift(x, z, ex, ez, worldFt) : [0, 0];
        if (mesh.position.x !== dx || mesh.position.z !== dz) { mesh.position.set(dx, 0, dz); mesh.updateMatrix(); moved = true; }
        const edge = Math.hypot(Math.max(0, Math.abs(x + dx - ex) - half), Math.max(0, Math.abs(z + dz - ez) - half));
        const visible = edge <= reach && edge <= range;
        if (mesh.visible !== visible) { mesh.visible = visible; moved = true; }
      }
      return moved;
    },
    dispose() { for (const m of materials) m.dispose(); },
  };
}
