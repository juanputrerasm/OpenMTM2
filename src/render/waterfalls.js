/*
  Community Patch 4 beta 0.53's waterfalls (docs/CP4_EXE_ANALYSIS.md 12; docs/VISUALS.md, "Waterfalls"): each fall's
  sheet and foam strip as the engine built them at load (worker/cp4-falls.js, OpenPhotex sim/cp4/falls.ts), drawn as
  its renderer DLL draws look 0 (Original) and look 3 (Ice) (12.0.1). Community Patch 4's looks 1 and 2 are its own
  Enhanced and Realistic lake water, which OpenMTM2 does not have: a fall keeps the Original look whatever the water
  (game/waterfalls.js `waterfallLook`).

  The track's falls share one vertex buffer (16 floats a vertex, positions in 1/256 ft from each fall's anchor) and one
  index buffer; each fall is a mesh of its own over its range of the indices, placed each frame at the copy of the world
  nearest the camera (the world wraps at its size, W: 8192 ft on a 256-cell world), left out beyond the draw range and culled by its own bounds. In the
  shader: the draped water lifted off the ground and pulled toward the eye, the texture flowing down the sheet with a
  second layer over it, the ragged edges and foot from the engine's value noise, the foam strip where the water lands
  (SPLASH), or in Snow on a FREEZE fall the ice; then the scene's light and the weather's fog. Drawn see-through after
  the water and the lakes and before the fog volumes. The water's mirror (render/water-mirror.js) draws the whole scene,
  so the falls are in it too, cut at the water's plane as everything is.
*/
import * as THREE from "three";
import { atmosphereUniforms } from "./atmosphere.js";
import {
  FALL_LOOK_ICE, WATERFALL_TUNING, advanceWaterfallClock, waterfallAnimationFrame, waterfallInRange, waterfallLook, waterfallRippleFrame,
  waterfallShaderTime,
} from "../game/waterfalls.js";
import { WORLD_FT } from "../shared/scene-frame.js";

/** After the water and the lakes, before the fog volumes (2.5). */
const WATERFALL_ORDER = 2.25;
const SPLASH = 2, SNOW = 5;

const VERTEX = /* glsl */ `
#include <common>
// u (ft across the crest), tau (s since the crest), speed (ft/s), air (1 in free fall)
attribute vec4 aFlow;
// edge (0 at the outer columns), end, kind (1 foam), the fall's slot
attribute vec4 aSheet;
uniform float uLift, uDepthPull;
varying vec4 vFlow;
varying vec3 vSheet, vNormal;
varying vec2 vAnchored;
#include <fog_pars_vertex>
void main() {
  // The game's axes in 1/256 ft from the anchor, to the scene's feet (z mirrored).
  vec3 local = vec3( position.x, position.y, - position.z ) / 256.0;
  vec3 n = normalize( vec3( normal.x, normal.y, - normal.z ) );
  vec4 world = modelMatrix * vec4( local, 1.0 );
  float eye = distance( world.xyz, cameraPosition );
  // Draped water (the sheet, not the foam), off the ground it lies on and toward the eye, against z-fighting.
  float draped = ( 1.0 - aFlow.w ) * ( 1.0 - step( 0.5, aSheet.z ) );
  world.xyz += n * draped * ( uLift + 0.0005 * eye );
  world.xyz += normalize( cameraPosition - world.xyz ) * draped * uDepthPull * eye;
  vFlow = aFlow;
  vSheet = aSheet.xyz;
  vNormal = n;
  vAnchored = position.xz / 256.0;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
#include <common>
uniform sampler2D uMap;
// the shader's time (s, 0 for the ice), the fall's opacity (0..1), its crest speed (ft/s), SPLASH (1), ice (1), wfEdge / 100
uniform float uTime, uOpacity, uSpeed, uSplash, uIce, uEdge;
// the scene's light on a matt face (colour times strength over pi): the sun's, and the sky's above and the ground's below
uniform vec3 uSunLight, uSunWay, uSkyLight, uGroundLight;
varying vec4 vFlow;
varying vec3 vSheet, vNormal;
varying vec2 vAnchored;
#include <fog_pars_fragment>

// The DLL's value noise: an integer lattice, this hash at each point, a smoothstep blend between.
float wfHash( vec2 cell ) {
  ivec2 c = ivec2( cell );
  uint h = uint( c.x ) * 0x8da6b343u ^ uint( c.y ) * 0xd8163841u;
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return float( h & 0xffffffu ) / 16777215.0;
}
float wfNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 s = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wfHash( i ), wfHash( i + vec2( 1.0, 0.0 ) ), s.x ), mix( wfHash( i + vec2( 0.0, 1.0 ) ), wfHash( i + vec2( 1.0, 1.0 ) ), s.x ), s.y );
}
// An octave of the ice's fbm, less its mean, faded to nothing as its cells shrink under a pixel.
float wfOctave( vec2 p ) {
  vec2 w = fwidth( p );
  return ( wfNoise( p ) - 0.5 ) * ( 1.0 - smoothstep( 0.5, 1.0, max( w.x, w.y ) ) );
}
float wfFbm( vec2 p ) {
  return 0.5 + 0.55 * wfOctave( p ) + 0.30 * wfOctave( 2.03 * p + vec2( 17.1, 3.7 ) ) + 0.15 * wfOctave( 4.11 * p + vec2( 5.3, 31.7 ) );
}
// The DLL works on the texture's own values; the scene lights in linear colour.
vec3 wfLinear( vec3 c ) { return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) ); }

void main() {
  float u = vFlow.x, tau = vFlow.y;
  float edge = vSheet.x, end = vSheet.y, kind = vSheet.z;
  float time = uIce > 0.5 ? 0.0 : uTime;
  float flow = ( tau - time ) * uSpeed;
  vec4 colour;
  if ( kind > 0.5 ) {
    // The foam strip where the water lands: only with SPLASH, never on ice.
    if ( uSplash < 0.5 || uIce > 0.5 ) discard;
    vec3 c = texture2D( uMap, vAnchored / 16.0 + vec2( 0.0, time * 0.03 ) ).rgb;
    colour = vec4( clamp( c * 1.6 + 0.12, 0.0, 1.0 ), uOpacity * clamp( end * 1.5, 0.0, 1.0 ) );
  } else {
    // Ragged sides and a ragged foot.
    float ns = 0.65 * wfNoise( vec2( u / 0.8, flow / 4.0 ) ) + 0.35 * wfNoise( vec2( u / 0.35 + 3.1, flow / 1.7 ) );
    float nf = 0.6 * wfNoise( vec2( u / 1.3 + 7.3, flow / 3.0 ) ) + 0.4 * wfNoise( vec2( u / 0.5 + 1.7, flow / 1.4 ) );
    float mask = smoothstep( 0.0, 0.25, sqrt( edge ) * 1.1 + 0.08 - uEdge * ( 0.15 + 0.75 * ns ) )
      * smoothstep( 0.0, 0.3, end + 0.15 - 0.65 * nf );
    vec3 c = texture2D( uMap, vec2( u / 16.0, flow / 16.0 ) ).rgb;
    if ( uIce > 0.5 ) {
      float l = dot( c, vec3( 0.30, 0.59, 0.11 ) );
      float g = clamp( 0.5 + ( l - 0.35 ) * 2.5, 0.0, 1.0 );
      colour = vec4( mix( vec3( 0.62, 0.72, 0.80 ), vec3( 0.84, 0.90, 0.95 ), g ) * ( 0.82 + 0.36 * wfFbm( vec2( u / 1.5, flow / 16.0 ) ) ), mask );
    } else {
      vec3 c2 = texture2D( uMap, vec2( u / 21.92 + 0.31, ( tau * uSpeed - time * uSpeed * 0.85 ) / 21.92 + 0.17 ) ).rgb;
      colour = vec4( mix( c, c2, 0.3 ), uOpacity * mask );
    }
  }
  if ( colour.a < 0.004 ) discard;
  vec3 n = normalize( vNormal );
  vec3 light = mix( uGroundLight, uSkyLight, n.y * 0.5 + 0.5 ) + uSunLight * max( dot( n, uSunWay ), 0.0 );
  gl_FragColor = vec4( wfLinear( colour.rgb ) * light, colour.a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** A texture of the falls' from a decoded image (`{ width, height, rgba }`), repeated, its values as they are. */
function fallTexture(image, look) {
  const rgba = image.rgba instanceof Uint8Array ? image.rgba : new Uint8Array(image.rgba.buffer, image.rgba.byteOffset, image.rgba.length);
  const texture = new THREE.DataTexture(rgba, image.width, image.height, THREE.RGBAFormat);
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = look === "classic" ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const CONTROLS = new WeakMap();

/**
 * A track's waterfalls (`build.falls`, worker/cp4-falls.js `buildTrackFalls`), or null for a track without any.
 * `look` the picture ("classic" keeps the texels sharp), `drawDistance` the world's reach in feet, `wraps` whether the
 * world repeats. `update(camera, dt)` once a frame; the weather through `setWaterfallWeather`.
 */
export function createWaterfalls(falls, { look = "enhanced", drawDistance = 20000, wraps = true, worldFt = WORLD_FT } = {}) {
  if (!falls?.list?.length || !falls.vertices?.length) return null;
  const group = new THREE.Group();
  group.name = "waterfalls";
  const buffer = new THREE.InterleavedBuffer(falls.vertices, 16);
  const attributes = {
    position: new THREE.InterleavedBufferAttribute(buffer, 3, 0),
    aFlow: new THREE.InterleavedBufferAttribute(buffer, 4, 3),
    aSheet: new THREE.InterleavedBufferAttribute(buffer, 4, 7),
    normal: new THREE.InterleavedBufferAttribute(buffer, 3, 12),
  };
  const index = new THREE.BufferAttribute(falls.indices, 1);
  const textures = (falls.textures ?? []).map((t) => ({ ...t, maps: t.frames.map((image) => fallTexture(image, look)), clock: 0 }));
  const ripple = falls.ripple ? falls.ripple.map((image) => fallTexture(image, look)) : null;
  // Without the game's ripple art: water's own colour, flat.
  const plain = ripple ? null : fallTexture({ width: 1, height: 1, rgba: new Uint8Array([60, 110, 140, 255]) }, look);
  const shared = {
    uTime: { value: 0 }, uEdge: { value: WATERFALL_TUNING.edge }, uLift: { value: WATERFALL_TUNING.liftFt }, uDepthPull: { value: WATERFALL_TUNING.depthPull },
    uSunLight: { value: new THREE.Color(0, 0, 0) }, uSunWay: { value: new THREE.Vector3(0, 1, 0) },
    uSkyLight: { value: new THREE.Color(1, 1, 1) }, uGroundLight: { value: new THREE.Color(1, 1, 1) },
  };
  const meshes = falls.list.map((fall) => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(index);
    geometry.setDrawRange(fall.firstIndex, fall.indexCount);
    // The bounds (vertex units, game axes, from the anchor) in the mesh's own frame: feet, z mirrored.
    const { min, max } = fall.bounds;
    const centre = new THREE.Vector3((min[0] + max[0]) / 512, (min[1] + max[1]) / 512, -(min[2] + max[2]) / 512);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 512;
    geometry.boundingSphere = new THREE.Sphere(centre, Math.max(radius, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...atmosphereUniforms(), ...shared,
        uMap: { value: ripple?.[0] ?? plain }, uOpacity: { value: fall.opacity }, uSpeed: { value: fall.crestSpeed },
        uSplash: { value: fall.flags & SPLASH ? 1 : 0 }, uIce: { value: 0 },
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "waterfall";
    mesh.renderOrder = WATERFALL_ORDER;
    mesh.userData.fall = fall;
    group.add(mesh);
    return mesh;
  });

  let weather = 0, seconds = 0, rippleSeconds = 0;
  const eye = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), tone = new THREE.Color();

  /** The scene's lights as a matt face takes them (render/particles.js does the same): sun, sky and ground. */
  function readLights() {
    // The scene the world was added to, looked for each time: the world may be drawn before it is in one.
    let root = group;
    while (root.parent) root = root.parent;
    let sun = null;
    shared.uSkyLight.value.setRGB(0, 0, 0);
    shared.uGroundLight.value.setRGB(0, 0, 0);
    for (const light of root.children) {
      if (!light.isLight || !light.visible) continue;
      if (light.isAmbientLight) {
        tone.copy(light.color).multiplyScalar(light.intensity / Math.PI);
        shared.uSkyLight.value.add(tone);
        shared.uGroundLight.value.add(tone);
      } else if (light.isHemisphereLight) {
        shared.uSkyLight.value.add(tone.copy(light.color).multiplyScalar(light.intensity / Math.PI));
        shared.uGroundLight.value.add(tone.copy(light.groundColor).multiplyScalar(light.intensity / Math.PI));
      } else if (light.isDirectionalLight && !sun && light.intensity > 0) sun = light;
    }
    // The sun's cascades (render/sun-shadows.js) stand in for it as several lights of its strength: one is the sun.
    if (sun) {
      shared.uSunLight.value.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);
      sun.getWorldPosition(a);
      sun.target.getWorldPosition(b);
      shared.uSunWay.value.subVectors(a, b).normalize();
    } else shared.uSunLight.value.setRGB(0, 0, 0);
  }

  const control = {
    group,
    setWeather(id) { weather = id; },
    /** Once a frame, before the scene is drawn with `camera`; `dt` the frame's seconds (none while paused). */
    update(camera, dt = 0) {
      seconds += dt;
      // The ripple holds still in Snow (12.8.1).
      if (weather !== SNOW) rippleSeconds += dt;
      for (const t of textures) if (t.delay > 0) t.clock = advanceWaterfallClock(t.clock, dt, t.maps.length, t.delay);
      shared.uTime.value = waterfallShaderTime(seconds);
      readLights();
      camera.getWorldPosition(eye);
      const gx = eye.x, gz = -eye.z;
      const rippleMap = ripple ? ripple[waterfallRippleFrame(rippleSeconds)] : plain;
      for (const mesh of meshes) {
        const fall = mesh.userData.fall, u = mesh.material.uniforms;
        // At the copy of the world nearest the eye (12.9).
        let [x, y, z] = fall.anchorFt;
        if (wraps) { x += worldFt * Math.round((gx - x) / worldFt); z += worldFt * Math.round((gz - z) / worldFt); }
        mesh.position.set(x, y, -z);
        const { min, max } = fall.bounds;
        mesh.visible = waterfallInRange(x + (min[0] + max[0]) / 512 - gx, z + (min[2] + max[2]) / 512 - gz, fall.bounds, drawDistance);
        if (!mesh.visible) continue;
        u.uIce.value = waterfallLook(weather, fall.flags) === FALL_LOOK_ICE ? 1 : 0;
        const texture = textures[fall.texture];
        u.uMap.value = !texture ? rippleMap : texture.delay > 0 ? texture.maps[waterfallAnimationFrame(texture.clock, texture.maps.length, texture.delay)] : texture.maps[0];
      }
    },
    dispose() {
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
      for (const t of textures) for (const map of t.maps) map.dispose();
      for (const map of ripple ?? []) map.dispose();
      plain?.dispose();
    },
  };
  CONTROLS.set(group, control);
  return control;
}

/** Tell a world's waterfalls the weather (render/weather-scene.js, when the weather is set): Snow holds the ripple, and freezes a FREEZE fall. */
export function setWaterfallWeather(world, weather) {
  const group = world?.getObjectByName?.("waterfalls");
  CONTROLS.get(group)?.setWeather(weather);
}
