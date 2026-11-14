/*
  Community Patch 4's fog volumes (docs/CP4_EXE_ANALYSIS.md 4; docs/VISUALS.md, "Fog volumes"): a
  track's type 14 boxes, each a box of fog standing at the box (base its bottom face), turned with
  it. Each frame the nearest that the weather allows are drawn (game/fog-volumes.js
  `fogVolumesShown`, at most 16), in the see-through pass after the water.

  A volume is drawn on its own box's faces: the faces toward the eye from outside, the far faces
  from inside (then over what is in front of them, since all of that is in the fog too). Each pixel
  sums the fog along its line of sight through the box, in steps: the density is the engine's
  extinction (3 / vis, so about 5 % of the light is left after vis ft) at the bottom, halving every
  `half` ft upward, eased in over `edge` from the sides, over `top` from the top and over `bot`
  from the bottom, the footprint from a rectangle to an ellipse by `round`. That shape is the port's
  reading of Fila's description (the engine leaves it to its renderer DLLs, which are not in the
  CP4 beta: an approximation pending trid3d11.dll). The opacity is held to `maxOp`. The colour
  takes the weather's light (`fogVolumeLight`) and the scene's fog over it (render/atmosphere.js
  replaces three.js's fog chunks, so the volume is veiled as everything else is). Wisps are not drawn.
  The line stops at the box, not at what stands in it: the ground inside a volume is seen through
  the whole depth of the box behind it.
*/
import * as THREE from "three";
import { FOG_VOLUMES_DRAWN, fogVolumeLight, fogVolumesShown } from "../game/fog-volumes.js";
import { atmosphereUniforms } from "./atmosphere.js";

/** After the water (2), before the dust and spray (3). */
const FOG_VOLUME_ORDER = 2.5;
const STEPS = 24;

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
varying vec3 vWorld;
// the box: centre (scene feet), half extents across, up and along, the turn (cosine, sine) from the scene into it
uniform vec3 uCentre, uHalf, uColor;
uniform vec2 uTurn;
// extinction a foot, height falloff (1 / half), max opacity, roundness
uniform vec4 uShape;
// soft edge, soft top, soft bottom (feet), 1 when the eye is inside
uniform vec4 uSoft;
#include <fog_pars_fragment>

vec3 vfLocal( vec3 v ) { return vec3( uTurn.x * v.x - uTurn.y * v.z, v.y, uTurn.y * v.x + uTurn.x * v.z ); }

float vfDensity( vec3 p ) {
  float above = p.y + uHalf.y;
  float d = uShape.x * exp2( - above * uShape.y );
  float rect = min( uHalf.x - abs( p.x ), uHalf.z - abs( p.z ) );
  float ellipse = ( 1.0 - length( p.xz / uHalf.xz ) ) * min( uHalf.x, uHalf.z );
  float side = mix( rect, ellipse, uShape.w );
  d *= uSoft.x > 0.0 ? smoothstep( 0.0, uSoft.x, side ) : step( 0.0, side );
  if ( uSoft.y > 0.0 ) d *= smoothstep( 0.0, uSoft.y, 2.0 * uHalf.y - above );
  if ( uSoft.z > 0.0 ) d *= smoothstep( 0.0, uSoft.z, above );
  return d;
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
  float step_ = ( t1 - t0 ) / float( ${STEPS} );
  float jitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  float depth = 0.0;
  for ( int i = 0; i < ${STEPS}; i ++ ) depth += vfDensity( eye + dir * ( t0 + ( float( i ) + jitter ) * step_ ) );
  float alpha = min( uShape.z, 1.0 - exp( - depth * step_ ) );
  if ( alpha < 0.002 ) discard;
  gl_FragColor = vec4( uColor, alpha );
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

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
  const pool = [];
  for (let i = 0; i < Math.min(FOG_VOLUMES_DRAWN, volumes.length); i++) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...atmosphereUniforms(),
        uCentre: { value: new THREE.Vector3() }, uHalf: { value: new THREE.Vector3(1, 1, 1) }, uColor: { value: new THREE.Color() },
        uTurn: { value: new THREE.Vector2(1, 0) }, uShape: { value: new THREE.Vector4() }, uSoft: { value: new THREE.Vector4() },
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
  let weather = 0;
  const eye = new THREE.Vector3(), color = new THREE.Color();
  const control = {
    group,
    setWeather(id) { weather = id; },
    /** Once a frame, before the scene is drawn with `camera`. */
    update(camera) {
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
        const side = inside ? THREE.BackSide : THREE.FrontSide;
        if (mesh.material.side !== side) { mesh.material.side = side; mesh.material.depthTest = !inside; mesh.material.needsUpdate = true; }
      });
    },
    dispose() { geometry.dispose(); for (const mesh of pool) mesh.material.dispose(); },
  };
  CONTROLS.set(group, control);
  return control;
}

/** Tell a world's fog volumes the weather (render/weather-scene.js, when the weather is set). */
export function setFogVolumeWeather(world, weather) {
  const group = world?.getObjectByName?.("fogVolumes");
  CONTROLS.get(group)?.setWeather(weather);
}
