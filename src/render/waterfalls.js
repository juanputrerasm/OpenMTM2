/*
  Community Patch 4's waterfalls as beta 0.53 hotfix 3 builds them (docs/CP4_EXE_ANALYSIS.md 12 and 16; docs/VISUALS.md,
  "Waterfalls"): each fall's slab (its pushed front face, ribbons and back face) and foam strip as the engine built them
  at load (worker/cp4-falls.js, OpenPhotex sim/cp4/falls.ts and fall-sheet.ts), drawn as its renderer DLL draws look 0
  (Original) and look 3 (Ice) (12.0.1, 16.7.3: the back face faded by its air, and darker in look 0). Community Patch 4's
  looks 1 and 2 are built on its own Enhanced and Realistic lake water, which OpenMTM2 does not have; in the enhanced
  picture a fall wears an enhanced look built on OpenMTM2's water instead, with the engine's whitewater on it
  (render/waterfall-water.js; game/waterfalls.js `waterfallLook`), the Ice look still in Snow on a FREEZE fall. While
  "Reflective water" draws the track's water (`setWaterfallWater`) the falls read that water's light, sky and
  Normal-Water; without it they work the same light and sky out for themselves (`ownWater`), without Normal-Water. The
  classic picture keeps look 0.

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
import { mirrorSky } from "./water-common.js";
import { WATER_SCATTER } from "../game/water.js";
import {
  FALL_LOOK_ENHANCED, FALL_LOOK_ICE, WATERFALL_TUNING, advanceWaterfallClock, waterfallAnimationFrame, waterfallInRange, waterfallLook,
  waterfallRippleFrame, waterfallRough, waterfallShaderTime,
} from "../game/waterfalls.js";
import { WORLD_FT } from "../shared/scene-frame.js";
import { createWaterfallSpray } from "./waterfall-spray.js";
import { FALL_NOISE_GLSL, FALL_WATER_FRAGMENT, FALL_WATER_UNIFORMS } from "./waterfall-water.js";

/** After the water and the lakes, before the fog volumes (2.5). */
const WATERFALL_ORDER = 2.25;
const SPLASH = 2, SNOW = 5;

const VERTEX = /* glsl */ `
#include <common>
// u (ft across the crest), tau (s since the crest), speed (ft/s), air (1 in free fall)
attribute vec4 aFlow;
// edge (0 at the outer columns), end, kind (0 sheet and ribbons, 1 foam, 2 the slab's back face), the fall's slot
attribute vec4 aSheet;
// the drop below the crest (ft) and the path from it (ft, 0 on the foam strip), for the enhanced look
attribute float aDrop, aPath;
uniform float uLift, uDepthPull;
varying vec4 vFlow;
varying vec3 vSheet, vNormal, vWorld;
varying vec2 vAnchored, vDropPath;
#include <fog_pars_vertex>
void main() {
  // The game's axes in 1/256 ft from the anchor, to the scene's feet (z mirrored).
  vec3 local = vec3( position.x, position.y, - position.z ) / 256.0;
  vec3 n = normalize( vec3( normal.x, normal.y, - normal.z ) );
  vec4 world = modelMatrix * vec4( local, 1.0 );
  float eye = distance( world.xyz, cameraPosition );
  // Draped water (the sheet and the back face, not the foam: |kind - 1| > 0.5), off the ground it lies on and toward
  // the eye, against z-fighting. The back face's normal is stored turned over: turned back, it moves as the front (16.7.1).
  float draped = ( 1.0 - aFlow.w ) * step( 0.5, abs( aSheet.z - 1.0 ) );
  vec3 lift = aSheet.z > 1.5 ? - n : n;
  world.xyz += lift * draped * ( uLift + 0.0005 * eye );
  world.xyz += normalize( cameraPosition - world.xyz ) * draped * uDepthPull * eye;
  vFlow = aFlow;
  vSheet = aSheet.xyz;
  vNormal = n;
  vAnchored = position.xz / 256.0;
  vWorld = world.xyz;
  vDropPath = vec2( aDrop, aPath );
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
${FALL_NOISE_GLSL}

void main() {
  float u = vFlow.x, tau = vFlow.y;
  float edge = vSheet.x, end = vSheet.y, kind = vSheet.z;
  float time = uIce > 0.5 ? 0.0 : uTime;
  float flow = ( tau - time ) * uSpeed;
  vec4 colour;
  // The foam strip is kind 1 (|kind - 1| < 0.5); the slab's back face kind 2, faded by its air in every look (16.7.3).
  bool back = kind > 1.5;
  float backAlpha = back ? clamp( vFlow.w, 0.0, 1.0 ) : 1.0;
  if ( abs( kind - 1.0 ) < 0.5 ) {
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
      colour = vec4( mix( c, c2, 0.3 ) * ( back ? 0.6 : 1.0 ), uOpacity * mask );
    }
  }
  colour.a *= backAlpha;
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
 * world repeats. `update(camera, dt)` once a frame; the weather through `setWaterfallWeather`, the Reflective water through
 * `setWaterfallWater`. With `falls.droplets` (Options' "Waterfall droplets") the landings' droplets too
 * (render/waterfall-spray.js, 16.5).
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
    aDrop: new THREE.InterleavedBufferAttribute(buffer, 1, 11),
    normal: new THREE.InterleavedBufferAttribute(buffer, 3, 12),
    aPath: new THREE.InterleavedBufferAttribute(buffer, 1, 15),
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
    // Looks 0 and 3 wear `original`; the enhanced look its own material, made while the Reflective water is there.
    mesh.userData.original = material;
    mesh.userData.enhanced = null;
    group.add(mesh);
    return mesh;
  });

  /*
    The enhanced look (render/waterfall-water.js), one program for every fall, each fall's own values (its texture,
    opacity, crest speed, SPLASH, roughFrom) as its material's uniforms, as the other looks have them; the Reflective
    water's uniforms are the water's own objects, so the falls see this frame's light, sky and detail as it does.
  */
  let water = null;
  /*
    Without the Reflective water, the water's uniforms the falls read (FALL_WATER_UNIFORMS), filled each frame from the
    scene's lights and sky as render/water-surface.js fills its own: the light on the water the sky's and the sun's by how
    high it stands, the glint all the sun's light (none below the horizon), the water's own colour, the sky the dome's.
  */
  const ownWater = look === "enhanced" ? {
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uDaylight: { value: new THREE.Color(1, 1, 1) }, uScatter: { value: new THREE.Color(...WATER_SCATTER) },
    uSunGlint: { value: new THREE.Color() }, uSkyOn: { value: 0 }, uSky: { value: null }, uSkyCap: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color(0.6, 0.7, 0.8) }, uDark: { value: 0 }, uSkyVeil: { value: 0 },
    uWaterDetail: { value: null }, uWaterMask: { value: null }, uWaterDetailAt: { value: new THREE.Vector4(0, 1, 0, 8192) },
  } : null;
  let sky = null, skySought = false;
  function fillOwnWater(root) {
    const u = ownWater;
    u.uSun.value.copy(shared.uSunWay.value);
    const height = Math.max(0, u.uSun.value.y);
    u.uDaylight.value.copy(shared.uSkyLight.value).add(tone.copy(shared.uSunLight.value).multiplyScalar(height));
    u.uSunGlint.value.copy(shared.uSunLight.value).multiplyScalar(height > 0 ? Math.PI : 0);
    // The sky dome, looked for once (and again only if it leaves the scene): the whole scene is searched.
    if (!skySought || (sky && !sky.parent)) { sky = root.getObjectByName?.("sky") ?? null; skySought = true; }
    mirrorSky({ on: u.uSkyOn, map: u.uSky, cap: u.uSkyCap, horizon: u.uHorizon, dark: u.uDark },
      { sky, fog: root.fog ?? null, background: root.background?.isColor ? root.background : null, light: 1, weather });
  }
  /** The water uniforms the falls read: the Reflective water's while it is there, else their own in the enhanced picture. */
  const waterUniforms = () => water?.uniforms ?? ownWater;
  function makeEnhanced(fall, original) {
    const own = {}, from = waterUniforms();
    for (const name of FALL_WATER_UNIFORMS) own[name] = from[name];
    return new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...atmosphereUniforms(), ...shared, ...own,
        // The texture and the fall's values are the original material's own objects: one update serves both.
        uMap: original.uniforms.uMap, uOpacity: original.uniforms.uOpacity, uSpeed: original.uniforms.uSpeed, uSplash: original.uniforms.uSplash,
        uRough: { value: new THREE.Vector2(...waterfallRough(fall.roughFrom)) },
      },
      vertexShader: VERTEX, fragmentShader: FALL_WATER_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
  }
  /** Each fall's look in this weather (game/waterfalls.js `waterfallLook`), its material to match. */
  function wear() {
    for (const mesh of meshes) {
      const { fall, original, enhanced } = mesh.userData;
      const fallLook = waterfallLook(weather, fall.flags, !!enhanced);
      original.uniforms.uIce.value = fallLook === FALL_LOOK_ICE ? 1 : 0;
      mesh.material = fallLook === FALL_LOOK_ENHANCED && enhanced ? enhanced : original;
    }
  }
  /** The Reflective water now drawing the track's water (render/water-surface.js `createWaterSystem`), or null for none. */
  function setWater(system, force = false) {
    const next = system?.uniforms && FALL_WATER_UNIFORMS.every((name) => system.uniforms[name]) ? system : null;
    if (next === water && !force) return;
    for (const mesh of meshes) { mesh.userData.enhanced?.dispose(); mesh.userData.enhanced = null; }
    water = next;
    if (waterUniforms()) for (const mesh of meshes) mesh.userData.enhanced = makeEnhanced(mesh.userData.fall, mesh.userData.original);
    wear();
  }

  const spray = createWaterfallSpray(falls.droplets);
  if (spray) group.add(spray.mesh);

  let weather = 0, seconds = 0, rippleSeconds = 0;
  const eye = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), tone = new THREE.Color();
  // In the enhanced picture the falls wear the enhanced look from the start, on their own water until the Reflective water comes.
  if (ownWater) setWater(null, true);

  let lightRoot = null;
  /** The scene's lights as a matt face takes them (render/particles.js does the same): sun, sky and ground. */
  function readLights() {
    // The scene the world was added to, looked for each time: the world may be drawn before it is in one.
    let root = group;
    while (root.parent) root = root.parent;
    lightRoot = root;
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
    setWeather(id) { weather = id; spray?.setWeather(id); wear(); },
    setWater,
    /** Once a frame, before the scene is drawn with `camera`; `dt` the frame's seconds (none while paused). */
    update(camera, dt = 0) {
      seconds += dt;
      // The ripple holds still in Snow (12.8.1).
      if (weather !== SNOW) rippleSeconds += dt;
      for (const t of textures) if (t.delay > 0) t.clock = advanceWaterfallClock(t.clock, dt, t.maps.length, t.delay);
      shared.uTime.value = waterfallShaderTime(seconds);
      readLights();
      if (!water && ownWater) fillOwnWater(lightRoot);
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
        const texture = textures[fall.texture];
        u.uMap.value = !texture ? rippleMap : texture.delay > 0 ? texture.maps[waterfallAnimationFrame(texture.clock, texture.maps.length, texture.delay)] : texture.maps[0];
      }
      // The droplets' light: the scene's ambient, as the sky and the ground give it to a matt face.
      if (spray) {
        tone.copy(shared.uSkyLight.value).add(shared.uGroundLight.value).multiplyScalar(Math.PI / 2);
        spray.update(camera, dt, 0.2126 * tone.r + 0.7152 * tone.g + 0.0722 * tone.b);
      }
    },
    dispose() {
      spray?.dispose();
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.userData.original.dispose(); mesh.userData.enhanced?.dispose(); }
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

/**
 * Tell a world's waterfalls the Reflective water that draws its water (render/scenery.js, once it is made; null when it
 * goes): while there is one, the falls wear the enhanced look built on it (game/waterfalls.js `waterfallLook`).
 */
export function setWaterfallWater(world, water) {
  const group = world?.getObjectByName?.("waterfalls");
  CONTROLS.get(group)?.setWater(water);
}
