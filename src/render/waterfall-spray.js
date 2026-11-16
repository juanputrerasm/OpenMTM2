/*
  Community Patch 4 beta 0.53 hotfix 3's waterfall droplets (docs/CP4_EXE_ANALYSIS.md 16.5): where each fall lands,
  in water or on dry ground, the bursts OpenPhotex's emitter throws (sim/cp4/fall-droplets.ts `stepFallDroplets`:
  per landing stream, near the player, out of a shared bank) drawn as the renderer DLL's spray draws them: each burst
  83 sprites, 80 streaked drops and 3 round blobs, scattered by the DLL's sprite hash, thrown with drag 0.5/s and 32
  ft/s^2 of gravity, alive 2 s at most and gone below the landing's height, faded by the fog. One instanced draw:
  every burst is a record of a ring, its sprites worked out in the vertex shader from the record and the clock.

  Engine units in the DLL are 1/256 ft; this works in feet, its constants divided by 256.
*/
import * as THREE from "three";
import { FALL_SPRAY, createFallDroplets, stepFallDroplets } from "../vendor/openphotex/sim/cp4/fall-droplets.js";

/** After the waterfalls (render/waterfalls.js), before the fog volumes. */
const SPRAY_ORDER = 2.3;
/** Records kept: the emitter banks at most 500 bursts a second and a burst is drawn for 2.4 s. */
const RING = Math.ceil(500 * FALL_SPRAY.retentionSec);
const SPRITES = FALL_SPRAY.drops + FALL_SPRAY.blobs;

const VERTEX = /* glsl */ `
#include <common>
// the corner (along -1..1, across -1..1) and the sprite (0..79 drops, 80..82 blobs)
attribute vec3 aCorner;
// the burst: position (scene ft) and spawn time; velocity (scene ft/s) and intensity; waterY, half width, size scale;
// the seed's low and high 16 bits
attribute vec4 iPos;
attribute vec4 iVel;
attribute vec3 iMore;
attribute vec2 iSeed;
uniform float uClock, uAmbient;
varying vec2 vUv;
varying float vBlob, vAlpha;
varying vec3 vColour;
#include <fog_pars_vertex>

uint sprayHash( uint x ) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float unit( uint h ) { return float( h & 0xffffffu ) / 16777216.0; }

void cull() { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); vAlpha = 0.0; }

void main() {
  float s = aCorner.z;
  bool blob = s > 79.5;
  float idx = blob ? s - 80.0 : s, count = blob ? 3.0 : 80.0;
  uint seed = uint( iSeed.x ) | ( uint( iSeed.y ) << 16u );
  uint h = sprayHash( seed ^ ( uint( s ) * 0x9e3779b9u ) );
  uint h2 = sprayHash( h ), h3 = sprayHash( h2 ), h4 = sprayHash( h3 ), h5 = sprayHash( h4 );
  uint h6 = sprayHash( h5 ), h7 = sprayHash( h6 ), h8 = sprayHash( h7 ), h9 = sprayHash( h8 );
  vec3 vel = iVel.xyz;
  float speed = length( vel );
  // Fast bursts thin their drops: |v| from 1500 to 7700 units/s.
  float sfv = clamp( ( speed * 256.0 - 1500.0 ) / 6200.0, 0.0, 1.0 );
  if ( idx + 0.5 > count * iVel.w * ( blob ? 1.0 : 0.55 + 0.45 * sfv ) ) { cull(); return; }
  float age = uClock - iPos.w - 0.06 * unit( h9 );
  float life = 2.0 * ( blob ? 1.0 : 0.65 + 0.35 * unit( h6 ) );
  if ( age < 0.0 || age >= life ) { cull(); return; }
  vec2 hv = vel.xz;
  vec2 lat = dot( hv, hv ) > 1e-8 ? normalize( vec2( - hv.y, hv.x ) ) : vec2( 1.0, 0.0 );
  vec3 spawn = iPos.xyz + vec3( lat.x, 0.0, lat.y ) * ( unit( h2 ) - 0.5 ) * 2.0 * iMore.y;
  float spd = max( speed, 3.0 );
  float angle = 6.2831853 * unit( h3 ), radius = sqrt( unit( h4 ) );
  vec3 cone = vec3( cos( angle ), 0.0, sin( angle ) ) * radius;
  vec3 v0 = blob
    ? vel * ( 0.8 + 0.5 * unit( h6 ) ) + cone * spd * 0.12 + vec3( 0.0, spd * 0.75 * ( 0.5 + 0.5 * unit( h8 ) ), 0.0 )
    : vel * ( 0.6 + 0.4 * unit( h6 ) ) + cone * spd * 0.2 + vec3( 0.0, spd * 0.5 * unit( h8 ), 0.0 );
  // Drag k = 0.5 /s and gravity 32 ft/s^2.
  float k = 0.5, decay = exp( - k * age ), carried = ( 1.0 - decay ) / k;
  vec3 p = spawn + v0 * carried;
  p.y -= 32.0 * ( age - carried ) / k;
  float waterY = iMore.x;
  if ( p.y < waterY && age > 0.03 ) { cull(); return; }
  vec3 vNow = v0 * decay - vec3( 0.0, 32.0 * ( 1.0 - decay ) / k, 0.0 );
  vec4 world = modelMatrix * vec4( p, 1.0 );
  vec3 view = normalize( world.xyz - cameraPosition );
  vec3 vs = vNow - dot( vNow, view ) * view;
  float sv = length( vs ) * 256.0, sc = iMore.z;
  // Widths and lengths in units of 1/256 ft, as the DLL sizes them.
  float w = blob ? 44.0 * ( 0.8 + 0.5 * unit( h7 ) ) * sc : 12.0 * ( 0.8 + 0.4 * unit( h7 ) ) * sc;
  float len = blob ? clamp( 0.00875 * sv, 2.0 * w, 3.0 * w ) : clamp( 0.025 * sv, 2.0 * w, 2.0 * w + 520.0 * sc );
  vec3 along = sv > 1e-3 ? vs / length( vs ) : normalize( cross( view, vec3( 1.0, 0.0, 0.0 ) ) );
  vec3 across = normalize( cross( along, view ) );
  // The quad trails the head along the screen velocity: uv.x 1 at the head, -1 at the tail.
  vec3 at = world.xyz - along * ( len / 256.0 ) * ( 1.0 - aCorner.x ) * 0.5 + across * ( w / 512.0 ) * aCorner.y;
  vUv = aCorner.xy;
  vBlob = blob ? 1.0 : 0.0;
  vAlpha = ( blob ? 1.0 : 0.9 ) * clamp( ( p.y - waterY ) * 256.0 / 96.0, 0.0, 1.0 ) * clamp( age / 0.03, 0.0, 1.0 );
  float light = clamp( 0.22 + 1.15 * uAmbient, 0.0, 1.0 );
  vColour = ( blob ? vec3( 0.86, 0.94, 1.0 ) : vec3( 0.92, 0.97, 1.0 ) ) * light;
  vec4 mvPosition = viewMatrix * vec4( at, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
#include <common>
uniform float uAmbient;
varying vec2 vUv;
varying float vBlob, vAlpha;
varying vec3 vColour;
#include <fog_pars_fragment>
void main() {
  float amb2 = uAmbient * uAmbient;
  vec3 rgb;
  float a;
  if ( vBlob > 0.5 ) {
    float r = length( vUv );
    float disc = 1.0 - smoothstep( 0.7, 1.0, r );
    vec2 g = vUv - vec2( - 0.30, 0.35 );
    float glint = exp( - 14.0 * dot( g, g ) );
    rgb = clamp( vColour * ( 0.85 + 0.15 * ( 1.0 - r ) ) + 0.7 * amb2 * glint, 0.0, 1.0 );
    a = clamp( disc * ( 0.7 + 0.3 * glint ), 0.0, 1.0 );
  } else {
    float body = ( 1.0 - smoothstep( 0.3, 1.0, abs( vUv.y ) ) ) * ( 1.0 - smoothstep( 0.65, 1.0, vUv.x ) ) * smoothstep( - 1.0, 0.15, vUv.x );
    float core = ( 1.0 - abs( vUv.y ) ) * smoothstep( - 0.6, 0.5, vUv.x );
    rgb = clamp( 1.12 * vColour + ( 0.10 + 0.9 * amb2 ) * core, 0.0, 1.0 );
    a = clamp( body * ( 0.75 + 0.35 * core ), 0.0, 1.0 );
  }
  a *= vAlpha;
  // The fog fades the drops; it does not colour them.
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      a *= exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      a *= 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #endif
  if ( a < 0.003 ) discard;
  gl_FragColor = vec4( rgb, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The 83 sprites' quads: per vertex the corner and the sprite's index. */
function spriteGeometry() {
  const corners = new Float32Array(SPRITES * 4 * 3), index = [];
  const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let s = 0; s < SPRITES; s++) {
    quad.forEach(([x, y], k) => corners.set([x, y, s], (s * 4 + k) * 3));
    const b = s * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("aCorner", new THREE.BufferAttribute(corners, 3));
  geometry.setIndex(index);
  // The shader places everything: three.js needs a position, which is never read.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPRITES * 4 * 3), 3));
  return geometry;
}

/**
 * The droplets of a track's waterfalls (`falls.droplets`, worker/cp4-falls.js), or null without any. `update(camera,
 * dt, ambient)` once a frame runs the emitter at the camera (the player's view) and draws what it threw; the weather
 * through `setWeather` (Snow stops a FREEZE fall's).
 */
export function createWaterfallSpray(droplets) {
  if (!droplets?.length) return null;
  const geometry = spriteGeometry();
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(RING * 4), 4);
  const iVel = new THREE.InstancedBufferAttribute(new Float32Array(RING * 4), 4);
  const iMore = new THREE.InstancedBufferAttribute(new Float32Array(RING * 3), 3);
  const iSeed = new THREE.InstancedBufferAttribute(new Float32Array(RING * 2), 2);
  for (const a of [iPos, iVel, iMore, iSeed]) a.setUsage(THREE.DynamicDrawUsage);
  iPos.array.fill(-1e9);
  geometry.setAttribute("iPos", iPos);
  geometry.setAttribute("iVel", iVel);
  geometry.setAttribute("iMore", iMore);
  geometry.setAttribute("iSeed", iSeed);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uClock: { value: 0 }, uAmbient: { value: 0.5 } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, fog: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "waterfall-spray";
  mesh.frustumCulled = false;
  mesh.renderOrder = SPRAY_ORDER;
  mesh.visible = false;
  const state = createFallDroplets(droplets);
  const eye = new THREE.Vector3();
  let weather = 0, clock = 0, next = 0, written = 0, lastBurst = -Infinity;

  return {
    mesh,
    setWeather(id) { weather = id; },
    /** Once a frame: `dt` the frame's seconds (0 while paused), `ambient` the scene's ambient light, 0..1. */
    update(camera, dt = 0, ambient = 0.5) {
      clock += dt;
      camera.getWorldPosition(eye);
      const bursts = dt > 0 ? stepFallDroplets(state, droplets, { dt, player: [eye.x, -eye.z], enabled: true, weather }) : [];
      for (const b of bursts) {
        const i = next;
        next = (next + 1) % RING;
        written = Math.min(written + 1, RING);
        // Game feet to the scene's (z mirrored).
        iPos.setXYZW(i, b.position[0], b.position[1], -b.position[2], clock);
        iVel.setXYZW(i, b.velocity[0], b.velocity[1], -b.velocity[2], b.intensity);
        iMore.setXYZ(i, b.waterY, b.halfWidth, b.sizeScale);
        iSeed.setXY(i, b.seed & 0xffff, b.seed >>> 16);
      }
      if (bursts.length) {
        for (const a of [iPos, iVel, iMore, iSeed]) a.needsUpdate = true;
        lastBurst = clock;
        geometry.instanceCount = written;
      }
      material.uniforms.uClock.value = clock;
      material.uniforms.uAmbient.value = Math.min(1, Math.max(0, ambient));
      mesh.visible = clock - lastBurst < FALL_SPRAY.retentionSec + 0.1;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
