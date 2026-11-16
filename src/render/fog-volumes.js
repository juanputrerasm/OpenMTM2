/*
  Community Patch 4's fog volumes (docs/CP4_EXE_ANALYSIS.md 4, 15.11; docs/VISUALS.md, "Fog volumes"): a track's type 14
  boxes, each a box of fog standing at the box (base its bottom face), turned with it, and the waterfalls' mist. Each
  frame the nearest that the weather allows are drawn (game/fog-volumes.js `fogVolumesShown`, at most 16), in the
  see-through pass after the water.

  As the renderer DLL of beta 0.53 hotfix 3 draws them (15.11): each pixel sums the fog along its line of sight through
  the box in 12 jittered steps, up to where the line meets the scene. The density is the extinction (3 / vis) at the
  floor, halving every `half` ft upward; `wisp` breaks it up with a drifting 3D noise (two lookups of the DLL's 64 x 64 x
  64 volume, game/fog-volumes.js `fogNoiseVolume`) that also frays the footprint's outline inward; the footprint is a
  superellipse from a near rectangle (`round` 0) to an ellipse (1); the sides, top and bottom fade in over `edge`, `top`
  and `bot` with a smootherstep. The opacity is held to `maxOp`. The colour takes the weather's light (`fogVolumeLight`)
  and the scene's fog over it (render/atmosphere.js replaces three.js's fog chunks).

  OpenMTM2's stand-in for the DLL's scene depth: the faces toward the eye are drawn with the depth test (what stands in
  front of the box hides it), and inside the box the line ends where it first meets the ground under the box, from a
  small map of it made at load (game/fog-volumes.js `fogVolumeGround`). From inside the box the far faces are drawn over
  everything. What stands in the fog other than the ground (trees, rocks) does not end the line.
*/
import * as THREE from "three";
import { FOG_GROUND_SIDE, FOG_NOISE_SIDE, FOG_VOLUMES_DRAWN, fogDriftPhase, fogNoiseVolume, fogVolumeLight, fogVolumesShown } from "../game/fog-volumes.js";
import { atmosphereUniforms } from "./atmosphere.js";

/** After the water (2), before the dust and spray (3). */
const FOG_VOLUME_ORDER = 2.5;
/** The DLL's steps along a line of sight. */
const STEPS = 12;
/** Ground maps a row of the atlas. */
const GROUND_PER_ROW = 8;

const VERTEX = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
#include <common>
precision highp sampler3D;
varying vec3 vWorld;
// the box: centre (scene feet), half extents across, up and along, the turn (cosine, sine) from the scene into it
uniform vec3 uCentre, uHalf, uColor;
uniform vec2 uTurn;
// extinction a foot, height falloff (1 / half), max opacity, roundness
uniform vec4 uShape;
// soft edge, soft top, soft bottom (feet), 1 when the eye is inside
uniform vec4 uSoft;
// wisp, the noise's tiles a foot, its drift phase (0 to 1), 1 when the ground map is there
uniform vec4 uWisp;
uniform sampler3D uNoise;
// the ground map's atlas, and this volume's tile in it: offset, size (uv)
uniform sampler2D uGround;
uniform vec4 uGroundTile;
#include <fog_pars_fragment>

vec3 vfLocal( vec3 v ) { return vec3( uTurn.x * v.x - uTurn.y * v.z, v.y, uTurn.y * v.x + uTurn.x * v.z ); }
float vfSmoother( float x ) { return x * x * x * ( x * ( x * 6.0 - 15.0 ) + 10.0 ); }

// The ground's height at the box's local p.xz, up from the box's centre.
float vfGround( vec2 p ) {
  vec2 uv = clamp( p / uHalf.xz * 0.5 + 0.5, vec2( 0.5 / ${FOG_GROUND_SIDE}.0 ), vec2( 1.0 - 0.5 / ${FOG_GROUND_SIDE}.0 ) );
  return texture2D( uGround, uGroundTile.xy + uv * uGroundTile.zw ).r * 2.0 * uHalf.y - uHalf.y;
}

// The fog's density at p (box frame, feet from the centre), before the extinction.
float vfDensity( vec3 p ) {
  vec3 h = uHalf;
  float dens = exp2( - uShape.y * ( p.y + h.y ) );
  float nz = 0.5;
  if ( uWisp.x > 0.001 ) {
    vec3 q = p * uWisp.y;
    float n1 = texture( uNoise, q - vec3( 0.0, 0.0, 1.0 ) * uWisp.z ).r;
    float n2 = texture( uNoise, q * 2.7 - vec3( 1.0, 0.0, 2.0 ) * uWisp.z ).r;
    nz = 0.65 * n1 + 0.35 * n2;
    dens *= mix( 1.0, smoothstep( 0.25, 0.75, nz ) * 1.6, uWisp.x );
  }
  float edge = max( uSoft.x, 1.0 ), top = max( uSoft.y, 1.0 );
  // How far inside the footprint's outline: a superellipse, exponent 16 (near a rectangle) to 2 (an ellipse).
  float sd;
  if ( uShape.w < 0.001 ) {
    sd = min( h.x - abs( p.x ), h.z - abs( p.z ) );
  } else {
    float ne = mix( 16.0, 2.0, uShape.w );
    float qx = abs( p.x ) / h.x, qz = abs( p.z ) / h.z;
    float m = max( max( qx, qz ), 1e-6 );
    float rx = qx / m, rz = qz / m;
    float sr = max( pow( pow( rx, ne ) + pow( rz, ne ), 1.0 / ne ), 1e-6 );
    float gx = pow( rx / sr, ne - 1.0 ) / h.x, gz = pow( rz / sr, ne - 1.0 ) / h.z;
    sd = ( 1.0 - m * sr ) / max( length( vec2( gx, gz ) ), 1e-9 );
  }
  // The wisps fray the outline, inward only.
  sd = min( sd, sd + ( nz - 0.5 ) * edge * uWisp.x * 1.5 );
  float side = clamp( sd / edge, 0.0, 1.0 );
  float tf = clamp( ( h.y - p.y ) / top, 0.0, 1.0 );
  float bs = clamp( ( p.y + h.y ) / max( uSoft.z, 1.0 ), 0.0, 1.0 );
  float bf = uSoft.z > 0.5 ? vfSmoother( bs ) : 1.0;
  return dens * vfSmoother( side ) * vfSmoother( tf ) * bf;
}

void main() {
  vec3 eye = vfLocal( cameraPosition - uCentre );
  vec3 dir = vfLocal( normalize( vWorld - cameraPosition ) );
  // Where the line enters and leaves the box.
  vec3 inv = 1.0 / ( dir + vec3( equal( dir, vec3( 0.0 ) ) ) * 1e-6 );
  vec3 a = ( - uHalf - eye ) * inv, b = ( uHalf - eye ) * inv;
  vec3 near3 = min( a, b ), far3 = max( a, b );
  float t0 = max( max( max( near3.x, near3.y ), near3.z ), 0.0 );
  float t1 = min( min( far3.x, far3.y ), far3.z );
  if ( t1 <= t0 ) discard;
  float dt = ( t1 - t0 ) / float( ${STEPS} );
  float jitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  float depth = 0.0;
  for ( int i = 0; i < ${STEPS}; i ++ ) {
    vec3 p = eye + dir * ( t0 + ( float( i ) + jitter ) * dt );
    // The line ends where it meets the ground.
    if ( uWisp.w > 0.5 && p.y < vfGround( p.xz ) ) break;
    depth += vfDensity( p );
  }
  float alpha = min( uShape.z, 1.0 - exp( - depth * uShape.x * dt ) );
  if ( alpha < 0.002 ) discard;
  // The DLL's dither against banding on an 8-bit picture.
  gl_FragColor = vec4( max( uColor + ( jitter - 0.5 ) / 255.0, 0.0 ), alpha );
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** The wisps' noise as a texture that tiles (game/fog-volumes.js `fogNoiseVolume`), made once. */
let noiseTexture = null;
function noiseMap() {
  if (noiseTexture) return noiseTexture;
  const side = FOG_NOISE_SIDE;
  noiseTexture = new THREE.Data3DTexture(fogNoiseVolume(), side, side, side);
  noiseTexture.format = THREE.RedFormat;
  noiseTexture.type = THREE.UnsignedByteType;
  noiseTexture.minFilter = noiseTexture.magFilter = THREE.LinearFilter;
  noiseTexture.wrapS = noiseTexture.wrapT = noiseTexture.wrapR = THREE.RepeatWrapping;
  noiseTexture.unpackAlignment = 1;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}

/** The volumes' ground maps (`volume.ground`) in one texture, 8 a row, and each volume's tile in it. */
function groundAtlas(volumes) {
  const side = FOG_GROUND_SIDE, rows = Math.max(1, Math.ceil(volumes.length / GROUND_PER_ROW));
  const width = side * GROUND_PER_ROW, height = side * rows;
  const data = new Uint8Array(width * height);
  const tiles = new Map();
  volumes.forEach((volume, n) => {
    if (!(volume.ground?.length === side * side)) return;
    const ox = (n % GROUND_PER_ROW) * side, oy = Math.floor(n / GROUND_PER_ROW) * side;
    for (let j = 0; j < side; j++) data.set(volume.ground.subarray(j * side, (j + 1) * side), (oy + j) * width + ox);
    tiles.set(volume, [ox / width, oy / height, side / width, side / height]);
  });
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { texture, tiles };
}

const CONTROLS = new WeakMap();

/**
 * A track's fog volumes (`build.fogVolumes`, game/fog-volumes.js `fogVolumeOf`) as a group of at most 16 boxes, or null
 * for a track without any. `drawDistance` is the world's reach in feet; `wraps` whether the world repeats, every `worldFt`.
 */
export function createFogVolumes(volumes, { drawDistance = 20000, wraps = true, worldFt = 8192 } = {}) {
  if (!volumes?.length) return null;
  const group = new THREE.Group();
  group.name = "fogVolumes";
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const ground = groundAtlas(volumes);
  const pool = [];
  for (let i = 0; i < Math.min(FOG_VOLUMES_DRAWN, volumes.length); i++) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...atmosphereUniforms(),
        uCentre: { value: new THREE.Vector3() }, uHalf: { value: new THREE.Vector3(1, 1, 1) }, uColor: { value: new THREE.Color() },
        uTurn: { value: new THREE.Vector2(1, 0) }, uShape: { value: new THREE.Vector4() }, uSoft: { value: new THREE.Vector4() },
        uWisp: { value: new THREE.Vector4() }, uNoise: { value: noiseMap() }, uGround: { value: ground.texture }, uGroundTile: { value: new THREE.Vector4() },
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, fog: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "fogVolume";
    mesh.renderOrder = FOG_VOLUME_ORDER;
    mesh.visible = false;
    mesh.frustumCulled = true;
    group.add(mesh);
    pool.push(mesh);
  }
  let weather = 0, seconds = 0;
  const eye = new THREE.Vector3(), color = new THREE.Color();
  const control = {
    group,
    setWeather(id) { weather = id; },
    /** Once a frame, before the scene is drawn with `camera`; `dt` the frame's seconds, for the wisps' drift. */
    update(camera, dt = 0) {
      seconds = (seconds + dt) % 86400;
      camera.getWorldPosition(eye);
      const gx = eye.x, gz = -eye.z;
      const shown = fogVolumesShown(volumes, [gx, gz], weather, drawDistance, undefined, worldFt);
      const light = fogVolumeLight(weather);
      pool.forEach((mesh, i) => {
        const pick = shown[i];
        mesh.visible = !!pick;
        if (!pick) return;
        const v = pick.volume, u = mesh.material.uniforms;
        // At the copy of the world nearest the eye (`dx`, `dz` the shortest way there).
        const x = wraps ? gx + pick.dx : v.centre[0], z = wraps ? gz + pick.dz : v.centre[2];
        mesh.position.set(x, v.centre[1], -z);
        // The box's heading in the scene (its forward (sin psi, -cos psi) there; the box is the same turned half round).
        mesh.rotation.set(0, -v.heading, 0);
        mesh.scale.set(v.half[0], v.half[1], v.half[2]);
        u.uCentre.value.copy(mesh.position);
        u.uHalf.value.set(v.half[0], v.half[1], v.half[2]);
        u.uTurn.value.set(Math.cos(-v.heading), Math.sin(-v.heading));
        u.uColor.value.copy(color.setRGB(v.color[0] * light, v.color[1] * light, v.color[2] * light, THREE.SRGBColorSpace));
        u.uShape.value.set(v.extinction, v.falloff, v.maxOpacity, v.round);
        // Inside the box the far faces are drawn, over everything (all of it is in the fog); outside, the near ones.
        const lx = Math.cos(-v.heading) * (eye.x - x) - Math.sin(-v.heading) * (eye.z + z);
        const lz = Math.sin(-v.heading) * (eye.x - x) + Math.cos(-v.heading) * (eye.z + z);
        const inside = Math.abs(lx) < v.half[0] && Math.abs(eye.y - v.centre[1]) < v.half[1] && Math.abs(lz) < v.half[2];
        u.uSoft.value.set(v.edge, v.top, v.bottom, inside ? 1 : 0);
        const tile = ground.tiles.get(v);
        u.uWisp.value.set(v.wisp ?? 0, 1 / (v.noiseTileFt ?? 8), v.noiseTileFt ? fogDriftPhase(v, seconds) : 0, tile ? 1 : 0);
        if (tile) u.uGroundTile.value.fromArray(tile);
        const side = inside ? THREE.BackSide : THREE.FrontSide;
        if (mesh.material.side !== side) { mesh.material.side = side; mesh.material.depthTest = !inside; mesh.material.needsUpdate = true; }
      });
    },
    dispose() { geometry.dispose(); ground.texture.dispose(); for (const mesh of pool) mesh.material.dispose(); },
  };
  CONTROLS.set(group, control);
  return control;
}

/** Tell a world's fog volumes the weather (render/weather-scene.js, when the weather is set). */
export function setFogVolumeWeather(world, weather) {
  const group = world?.getObjectByName?.("fogVolumes");
  CONTROLS.get(group)?.setWeather(weather);
}
