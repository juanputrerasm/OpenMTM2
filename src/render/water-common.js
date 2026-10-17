/*
  What the level's water (render/water-surface.js) and the puddles on the ground
  (render/ground-surface.js) draw alike (docs/VISUALS.md, "Water" and "Rain"): the sky they mirror,
  and the rings the rain makes on them.
*/
import { BACKDROP_DARK } from "../game/atmosphere.js";

/**
 * GLSL: `vec3 <name>( vec3 way, float blur )`, the sky a ray leaving the water along `way` (scene
 * axes, a unit vector) meets: the dome's own picture (render/track-scene.js skyGeometry), read
 * `blur` levels down, veiled toward the horizon as the sky itself is. `reads` are what it reads,
 * each a GLSL expression: `on` (over a half while there is a sky to show), `map` the dome's
 * picture, `cap` the colour over its top, `horizon` what veils it, `dark` how far the dark weathers
 * darken it toward the horizon and `veil` how deep the fog over the eye lies (render/atmosphere.js
 * `skyVeil`).
 */
export function skyAlongGlsl(name, { on, map, cap, horizon, dark, veil }) {
  return /* glsl */ `
vec3 ${name}( vec3 way, float blur ) {
  if ( ${on} < 0.5 ) return ${horizon};
  // Never the art's very last rows, which are the horizon's own line of haze: a hand above it.
  float elevation = max( asin( clamp( way.y, 0.0, 1.0 ) ), 0.07 );
  float around = atan( way.x, - way.z ) / 6.2831853;
  // Four turns of the picture around the horizon; its rows from the bottom at the horizon to the top at 67.5 degrees.
  vec2 uv = vec2( around * 4.0, ( 254.0 - 252.0 * clamp( elevation / 1.1780972, 0.0, 1.0 ) ) / 256.0 );
  vec3 shown = mix( textureLod( ${map}, uv, blur ).rgb, ${cap}, smoothstep( 1.0, 1.178, elevation ) );
  // Toward the horizon the sky is veiled as the land is: by the fog, or in the dark weathers by their darkness.
  shown = mix( shown, ${horizon}, ${dark} * ( 1.0 - smoothstep( 0.0, 0.22, way.y ) ) );
  // The fog's veil, as the sky itself has it (\`mtmFogSkyHidden\`), from how deep the fog over the eye lies this frame.
  return mix( shown, ${horizon}, 1.0 - exp( - min( ${veil} / max( way.y, 1e-3 ), 60.0 ) ) );
}
`;
}

/**
 * Sets what `skyAlongGlsl` reads for this frame. `into` holds its uniforms `{ on, map, cap,
 * horizon, dark }`; `sky` is the dome, `fog` the scene's fog, `background` its clear colour,
 * `light` the weather's brightness and `weather` the weather. Without a sky to show, the horizon
 * stands for it, as bright as the weather's light.
 */
export function mirrorSky(into, { sky = null, fog = null, background = null, light = 1, weather = 0 } = {}) {
  const map = sky && sky.visible !== false ? sky.material?.map ?? null : null;
  into.on.value = map ? 1 : 0;
  into.map.value = map;
  if (sky?.userData.cap) into.cap.value.copy(sky.userData.cap.material.color);
  const horizon = fog?.color ?? background;
  if (horizon) into.horizon.value.copy(horizon).multiplyScalar(map ? 1 : light);
  // What the dark weathers' darkness takes of what stands at the horizon (game/atmosphere.js), it takes of the sky's mirror image there.
  into.dark.value = BACKDROP_DARK[weather] ?? 0;
}

/**
 * GLSL: `vec2 mtmRainRings( vec2 p, float seconds )`, the slope the rain's rings give the water at
 * `p` (feet at the lake's scale). Each drop sends a ring out from where it fell, which spreads and
 * fades. The drops fall into two grids of cells, one at a time in each cell, somewhere in it and
 * at a moment of its own.
 */
export const RAIN_RINGS_GLSL = /* glsl */ `
#ifndef MTM_RAIN_RINGS
#define MTM_RAIN_RINGS
float mtmRainHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec2 mtmRainRings( vec2 p, float seconds ) {
  vec2 slope = vec2( 0.0 );
  for ( int layer = 0; layer < 2; layer ++ ) {
    vec2 q = p / ( 2.4 + float( layer ) * 1.9 ) + float( layer ) * 13.7;
    vec2 cell = floor( q );
    float seed = mtmRainHash( cell );
    float age = fract( seconds * ( 0.8 + seed * 0.7 ) + seed * 9.0 );
    vec2 off = fract( q ) - ( 0.3 + 0.4 * vec2( mtmRainHash( cell + 7.3 ), mtmRainHash( cell + 19.1 ) ) );
    float r = length( off ), front = age * 0.42;
    float band = exp( - pow( ( r - front ) / 0.035, 2.0 ) ) * ( 1.0 - age );
    slope += ( off / max( r, 1e-3 ) ) * ( sin( ( r - front ) * 60.0 ) * band );
  }
  return slope;
}
#endif
`;
