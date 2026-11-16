/*
  Community Patch 4's waterfalls in their enhanced look (docs/CP4_EXE_ANALYSIS.md 12.8.3, 16.7; docs/VISUALS.md,
  "Waterfalls"), as OpenMTM2 draws it in the enhanced picture (render/waterfalls.js; with "Reflective water", render/water-surface.js): the
  engine's looks 1 and 2 are built on Community Patch 4's own lake water, which OpenMTM2 does not have, so this one is
  built on OpenMTM2's, and the sheet, its whitewater and the pool it lands in read as one water.

  OpenMTM2's own (the Reflective water's rules on a thin running sheet): the water's own colour lit by the same daylight,
  thinner sheets seen through, red first (game/water.js); churned water milky as the wakes are; the same sky mirrored
  through the same Fresnel term, blurred by the sheet's roughness; the sun's glint as the lake's facets give it; small
  ripples riding down with the water. The scene's fog over all, as on the falls' other looks.

  The engine's (hotfix 3, 16.7.2 .. 16.7.5), at its defaults (game/waterfalls.js `FALL_WHITEWATER`): the sheet's
  thickness from the crest speed, the thin ragged sides and the break-up with the drop, the whitewater W from the drop,
  the speed (from the fall's roughFrom) and the impact, the lip kept clear, the froth from two Worley octaves and a larger
  fbm on a flow map, eroded by W through a wide soft edge, its light, the gaps between it showing the water, the veil of
  a tall free fall, the dry foot's fade, the back face's rules and Normal-Water on the sheet; the foam strip where the
  water lands, its white over the Reflective water's own churned water. Pure: no three.js, so the tests read the shader.
*/
import { WATER_GLINT, WATER_TAKES } from "../game/water.js";
import { FALL_WATER_LOOK, FALL_WHITEWATER } from "../game/waterfalls.js";
import { skyAlongGlsl } from "./water-common.js";

const glsl = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const vec = (values) => `vec${values.length}( ${values.map(glsl).join(", ")} )`;
const WW = FALL_WHITEWATER, OWN = FALL_WATER_LOOK;

/**
 * The Reflective water's uniforms the enhanced look reads as they are (render/water-surface.js `createWaterSystem`'s
 * `uniforms`): the same objects, so the falls see this frame's light, sky and detail as the water does.
 */
export const FALL_WATER_UNIFORMS = Object.freeze([
  "uSun", "uDaylight", "uScatter", "uSunGlint", "uSkyOn", "uSky", "uSkyCap", "uHorizon", "uDark", "uSkyVeil",
  "uWaterDetail", "uWaterMask", "uWaterDetailAt",
]);

/** The DLL's value noise (12.0.1) and the fbm with its octaves faded under a pixel: every look of the falls. */
export const FALL_NOISE_GLSL = /* glsl */ `
// The DLL's hash on an integer lattice (12.0.1); the froth's cells read all 32 bits of it, the value noise 24.
uint wfHashU( ivec2 c ) {
  uint h = uint( c.x ) * 0x8da6b343u ^ uint( c.y ) * 0xd8163841u;
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return h;
}
float wfHash( vec2 cell ) { return float( wfHashU( ivec2( cell ) ) & 0xffffffu ) / 16777215.0; }
// The DLL's value noise: the hash at each lattice point, a smoothstep blend between.
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
`;

/**
 * The enhanced look's pixel shader, for render/waterfalls.js's vertex shader (its varyings) and its per-fall uniforms:
 * uTime, uOpacity, uSpeed, uSplash, uEdge as the other looks have them, uRough the fall's roughFrom as
 * game/waterfalls.js `waterfallRough` gives it, and the Reflective water's `FALL_WATER_UNIFORMS`.
 */
export const FALL_WATER_FRAGMENT = /* glsl */ `
#include <common>
uniform sampler2D uMap;
uniform float uTime, uOpacity, uSpeed, uSplash, uEdge;
// The fall's roughFrom (16.7.2): the speed where its speed whitewater starts (ft/s), 1 while the drop and speed whitewater are on.
uniform vec2 uRough;
// The Reflective water's (render/water-surface.js): the way to the sun, the daylight on the water, the water's own colour, the
// sun's light for its glint, the sky it mirrors, and Normal-Water (on, strength, its clock, the mask's period in feet).
uniform vec3 uSun, uDaylight, uScatter, uSunGlint, uSkyCap, uHorizon;
uniform float uSkyOn, uDark, uSkyVeil;
uniform sampler2D uSky, uWaterDetail, uWaterMask;
uniform vec4 uWaterDetailAt;
varying vec4 vFlow;
varying vec3 vSheet, vNormal, vWorld;
varying vec2 vAnchored, vDropPath;
#include <fog_pars_fragment>
${FALL_NOISE_GLSL}
${skyAlongGlsl("wfSkyAlong", { on: "uSkyOn", map: "uSky", cap: "uSkyCap", horizon: "uHorizon", dark: "uDark", veil: "uSkyVeil" })}
float wfSat( float a ) { return clamp( a, 0.0, 1.0 ); }
float wfLum( vec3 c ) { return dot( c, vec3( 0.30, 0.59, 0.11 ) ); }
// How much of this point the scene's fog hides, 0 to 1.
float wfFogShare() {
  #ifdef USE_FOG
    if ( mtmFog[ 0 ].x > 0.5 ) return mtmFogHides( vFogView );
    #ifdef FOG_EXP2
      return 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      return smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #else
    return 0.0;
  #endif
}
// The value noise faded to its mean as its cells shrink under a pixel (\`fw\`, the footprint in cells), and the fbm so
// faded: no derivatives inside, so they may be called in a branch.
float wfNoiseF( vec2 p, vec2 fw ) { return 0.5 + ( wfNoise( p ) - 0.5 ) * wfSat( 1.5 - max( fw.x, fw.y ) ); }
float wfFbmF( vec2 p, vec2 fw ) {
  return wfSat( 0.5 + 0.55 * ( wfNoiseF( p, fw ) - 0.5 ) + 0.30 * ( wfNoiseF( 2.03 * p + vec2( 17.1, 3.7 ), 2.03 * fw ) - 0.5 )
    + 0.15 * ( wfNoiseF( 4.11 * p + vec2( 5.3, 31.7 ), 4.11 * fw ) - 0.5 ) );
}
// The sheet's outline (12.0.1's mask): x the side noise, y the foot's, at \`q\` (feet across, along), faded by \`fq\`.
vec2 wfMaskNoise( vec2 q, vec2 fq ) {
  return vec2(
    0.65 * wfNoiseF( vec2( q.x / 0.8, q.y / 4.0 ), fq / vec2( 0.8, 4.0 ) ) + 0.35 * wfNoiseF( vec2( q.x / 0.35 + 3.1, q.y / 1.7 ), fq / vec2( 0.35, 1.7 ) ),
    0.6 * wfNoiseF( vec2( q.x / 1.3 + 7.3, q.y / 3.0 ), fq / vec2( 1.3, 3.0 ) ) + 0.4 * wfNoiseF( vec2( q.x / 0.5 + 1.7, q.y / 1.4 ), fq / vec2( 0.5, 1.4 ) ) );
}
// Ragged sides, deeper with \`fray\` (the break-up), and a ragged foot.
float wfMask( vec2 n, float edge, float end, float fray ) {
  return smoothstep( 0.0, 0.25, sqrt( wfSat( edge ) ) * 1.1 + 0.08 - uEdge * ( 0.15 + 0.75 * n.x ) * ( 1.0 + fray ) )
    * smoothstep( 0.0, 0.3, end + 0.15 - 0.65 * n.y );
}
// The flow map's two layers of one noise by their weights, its spread kept (a plain average would halve it mid-cycle).
float wfMix2( float a, float b, float w ) {
  float w2 = 1.0 - w;
  return wfSat( 0.5 + ( w * ( a - 0.5 ) + w2 * ( b - 0.5 ) ) * inversesqrt( w * w + w2 * w2 ) );
}
// Worley cells on the hash (16.7.2): the nearest and the next nearest feature point, in cells; the points in 0.1 .. 0.9.
vec2 wfCells( vec2 p ) {
  vec2 ip = floor( p ), f = p - ip;
  ivec2 c = ivec2( ip );
  float d1 = 8.0, d2 = 8.0;
  for ( int y = - 1; y <= 1; y ++ ) {
    for ( int x = - 1; x <= 1; x ++ ) {
      uint h = wfHashU( c + ivec2( x, y ) );
      vec2 r = vec2( float( x ), float( y ) ) + vec2( float( h & 0xffffu ), float( h >> 16u ) ) * ( 0.8 / 65535.0 ) + 0.1 - f;
      float d = dot( r, r );
      if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
    }
  }
  return sqrt( vec2( d1, d2 ) );
}
// Froth: bright walls where the bubbles meet, thinner toward a bubble's middle.
float wfFroth( vec2 F ) {
  return max( 0.30 + 0.40 * smoothstep( 0.05, 0.70, F.x ), 1.0 - smoothstep( 0.0, ${glsl(WW.wall)}, F.y - F.x ) );
}
// The foam's density at \`q\` (feet), mean about a half: streaked cells (\`an\` 1) or round churn (0), each faded to the mean
// by the footprint \`fq\`, none at all where \`det\` is 0 (the back face), and the larger fbm's clumps and veils.
float wfFoamDensity( vec2 q, vec2 fq, float an, float det ) {
  vec2 sizeA = vec2( ${glsl(WW.cellA)}, ${glsl(WW.cellA * WW.aniso)} );
  float fA = det * wfSat( 1.6 - 2.0 * max( fq.x / sizeA.x, fq.y / sizeA.y ) );
  float fB = det * wfSat( 1.6 - 2.0 * max( fq.x, fq.y ) / ${glsl(WW.cellB)} );
  float cA = ${glsl(WW.frothMean)}, cB = ${glsl(WW.frothMean)};
  if ( fA > 0.0 ) cA = mix( ${glsl(WW.frothMean)}, wfFroth( wfCells( q / sizeA ) ), fA );
  if ( fB > 0.0 ) cB = mix( ${glsl(WW.frothMean)}, wfFroth( wfCells( q / ${glsl(WW.cellB)} + vec2( 7.31, 2.17 ) ) ), fB );
  float cells = mix( cB, cA, mix( 0.15, 0.85, an ) );
  vec2 densityFt = ${vec(WW.densityFt)};
  float broad = wfFbmF( q / densityFt + vec2( 23.1, 11.9 ), fq / densityFt );
  return wfSat( 0.5 + ${glsl(WW.cellAmp)} * ( cells - ${glsl(WW.frothMean)} ) + ${glsl(WW.densityAmp)} * ( broad - 0.5 ) );
}

void main() {
  float u = vFlow.x, tau = vFlow.y, speed = vFlow.z, air = wfSat( vFlow.w );
  float edge = vSheet.x, end = wfSat( vSheet.y ), kind = vSheet.z;
  float drop = vDropPath.x, path = vDropPath.y;
  // The foam strip is kind 1, the slab's back face kind 2 (16.7.1).
  bool foam = abs( kind - 1.0 ) < 0.5;
  bool back = kind > 1.5;
  float t = uTime, spd = uSpeed;
  float flow = ( tau - t ) * spd;
  float v = max( speed, 0.5 );

  // Every derivative and every implicit texture read here, where every point of the fall takes them.
  vec2 qo = vec2( u, flow );
  vec2 dqx = dFdx( qo ), dqy = dFdy( qo );
  vec2 fqo = abs( dqx ) + abs( dqy );
  float ftPerPixel = max( length( dqx ), length( dqy ) );
  // The flow map (16.7.2): two layers of the pattern in (u, path) feet, each carried down at the local speed through a
  // cycle of wfFlowCycle seconds (a whole number of them in the clock's 600 s) and jumping back, with a fresh offset,
  // while its weight is 0; the other half a cycle apart.
  float vA = max( speed, max( spd, 1.0 ) );
  float cycles = max( floor( 600.0 / ${glsl(WW.flowCycleS)} + 0.5 ), 1.0 );
  float cycleS = 600.0 / cycles;
  float phase = t / cycleS;
  float p1 = fract( phase ), p2 = fract( phase + 0.5 );
  float w1 = 1.0 - abs( 2.0 * p1 - 1.0 );
  float cy1 = floor( phase ), cy2 = floor( phase + 0.5 );
  cy1 -= cycles * floor( cy1 / cycles );
  cy2 -= cycles * floor( cy2 / cycles );
  vec2 q1 = vec2( u, path - vA * cycleS * p1 ) + fract( cy1 * vec2( 0.6180340, 0.7548777 ) ) * vec2( 37.0, 91.0 );
  vec2 q2 = vec2( u, path - vA * cycleS * p2 ) + fract( cy2 * vec2( 0.6180340, 0.7548777 ) + vec2( 0.5, 0.25 ) ) * vec2( 37.0, 91.0 );
  vec2 fq = fwidth( q1 );
  // Normal-Water on the sheet (16.7.5): two layers of the detail in the sheet's own (u, flow) feet, their clocks snapped so
  // the 600 s wrap is a whole number of repeats; the mask over the world at the point's own place, as the lakes read it.
  float sA = floor( 600.0 * spd / 48.0 + 0.5 ) * ( 48.0 / 600.0 );
  float sB = floor( 600.0 * spd / 89.0 + 0.5 ) * ( 89.0 / 600.0 );
  vec2 detailA = vec2( u / 64.0, ( tau * spd - t * sA ) / 48.0 );
  vec2 detailB = vec2( u / 118.72 + 0.37, ( tau * spd - t * sB ) / 89.0 + 0.61 );
  vec2 detailAx = dFdx( detailA ), detailAy = dFdy( detailA ), detailBx = dFdx( detailB ), detailBy = dFdy( detailB );
  vec2 at = vec2( vWorld.x, - vWorld.z );
  vec2 atx = dFdx( at ), aty = dFdy( at );
  vec3 dpx = dFdx( vWorld ), dpy = dFdy( vWorld );
  // The foam strip's two layers of the fall's texture drifting apart, and the texture's mean (its smallest picture).
  vec2 stripA = vAnchored / 12.0 + vec2( 0.04, 0.02 ) * t;
  vec2 stripB = vAnchored / 8.5 + vec2( 0.50, 0.30 ) + vec2( - 0.03, 0.035 ) * t;
  float lumA = wfLum( texture2D( uMap, stripA ).rgb ), lumB = wfLum( texture2D( uMap, stripB ).rgb );
  float lumMean = wfLum( textureLod( uMap, stripA, 16.0 ).rgb );
  float fogShare = wfFogShare();

  // The splash off: no foam strip (12.0.1).
  if ( foam && uSplash < 0.5 ) discard;
  vec3 eye = normalize( cameraPosition - vWorld );
  vec3 n = dot( vNormal, vNormal ) > 1e-12 ? normalize( vNormal ) : eye;
  if ( dot( n, eye ) < 0.0 ) n = - n;
  // The foam's light (16.7.2): a soft half-Lambert toward the sun over a high floor, in the daylight on the water.
  float halfLambert = wfSat( dot( n, uSun ) * 0.5 + 0.5 );
  vec3 foamLight = ${vec(WW.whiteRgb)} * uDaylight * ( ${glsl(WW.foamAmbient)} + ${glsl(1 - WW.foamAmbient)} * halfLambert * halfLambert );
  // The Reflective water's churned water (render/water-surface.js, the wakes): milky and pale, a white green.
  vec3 churnedWater = vec3( 0.3, 0.42, 0.41 ) * uDaylight;
  vec3 colour;
  float alpha;
  vec3 glint = vec3( 0.0 );

  if ( foam ) {
    // Where the water lands: the fall's texture as white, broken over the pool's own water churned (wfFoam's opacity).
    float sf = wfSat( 0.5 + 3.0 * ( 0.55 * ( lumA - lumMean ) + 0.45 * ( lumB - lumMean ) ) );
    colour = mix( churnedWater, foamLight, wfSat( 0.35 + 0.65 * sf ) );
    alpha = uOpacity * wfSat( ${glsl(WW.foam)} * pow( end, 0.6 ) * ( 0.30 + 0.70 * sf ) ) * mix( 0.6, 1.0, edge );
  } else {
    // The lip stays clear water: no whitewater, no churn, over the first wfLipBlend feet of path.
    float lip = wfSat( path / ${glsl(WW.lipBlendFt)} );
    // The break-up with the drop (0 on the lip and on draped water, 1 by about 100 ft of free fall), and near the crest the
    // patterns cross over from the plain (u, flow) to the flow map (over the first 2 to 12 ft of drop).
    float brk = wfSat( ${glsl(WW.breakup)} * smoothstep( 15.0, 100.0, drop ) * smoothstep( 0.0, 1.0, air ) );
    float fmx = smoothstep( 2.0, 12.0, drop );
    vec2 m1 = wfMaskNoise( q1, fq ), m2 = wfMaskNoise( q2, fq );
    vec2 outline = mix( wfMaskNoise( qo, fqo ), vec2( wfMix2( m1.x, m2.x, w1 ), wfMix2( m1.y, m2.y, w1 ) ), fmx );
    float sideNoise = mix( wfNoiseF( qo / vec2( 0.8, 4.0 ), fqo / vec2( 0.8, 4.0 ) ),
      wfMix2( wfNoiseF( q1 / vec2( 0.8, 4.0 ), fq / vec2( 0.8, 4.0 ) ), wfNoiseF( q2 / vec2( 0.8, 4.0 ), fq / vec2( 0.8, 4.0 ) ), w1 ), fmx );
    // Thin ragged sides, frayed wider with the drop.
    float sideK = wfSat( sqrt( wfSat( edge ) ) * 1.3 - 0.35 * uEdge * ( 1.0 + 0.6 * brk ) * sideNoise );
    // The clumps of a tall free fall: a broad noise, 5 ft across by 6 along.
    float clumps = mix( wfNoiseF( qo / vec2( 5.0, 6.0 ) + vec2( 13.7, 5.1 ), fqo / vec2( 5.0, 6.0 ) ),
      wfMix2( wfNoiseF( q1 / vec2( 5.0, 6.0 ) + vec2( 13.7, 5.1 ), fq / vec2( 5.0, 6.0 ) ), wfNoiseF( q2 / vec2( 5.0, 6.0 ) + vec2( 13.7, 5.1 ), fq / vec2( 5.0, 6.0 ) ), w1 ), fmx );

    /*
      The water (OpenMTM2's own, the Reflective water's rules): the sheet as thick as the engine has it (critical depth at
      the crest, thinning as it speeds up, thin at the sides), seen through along the eye's line; churned between the
      engine's calm and rough speeds, milky as the wakes are.
    */
    float v0 = max( spd, 0.5 );
    float thickFt = max( 0.05, v0 * v0 / 32.0 * ${glsl(WW.depthScale)} * v0 / v ) * sideK;
    float churn = smoothstep( ${glsl(WW.calmSpeed)}, ${glsl(WW.roughSpeed)}, v ) * lip;
    vec3 passes = exp( - ${vec(WATER_TAKES)} * thickFt / max( dot( eye, n ), 0.2 ) );
    float hides = 1.0 - dot( passes, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 body = uScatter * uDaylight * ( 1.0 - passes ) / max( hides, 1e-3 );
    body = mix( body, churnedWater, churn * ${glsl(OWN.churnMilk)} );
    hides = max( hides, churn * ${glsl(OWN.churnHides)} );
    vec3 water = body;
    float waterAlpha = hides;
    if ( ! back ) {
      // Ripples riding down with the water, longer along it than across, faded where a pixel is wider than they are; what
      // they would tip below a pixel is roughness.
      float rippleSeen = 1.0 - smoothstep( 0.6, 2.4, ftPerPixel );
      vec2 rq = vec2( u, flow / ${glsl(OWN.rippleStretch)} ) * ( 6.2831853 / ${glsl(OWN.rippleFt)} );
      vec2 k1 = vec2( 0.80, 0.60 ), k2 = vec2( - 0.55, 0.835 ), k3 = vec2( 0.28, - 0.96 );
      vec2 ripple = cos( dot( k1, rq ) ) * k1 + 0.6 * cos( dot( k2, rq ) * 1.7 + 1.3 ) * k2 + 0.35 * cos( dot( k3, rq ) * 2.9 + 2.1 ) * k3;
      float rippleGain = ${glsl(OWN.rippleSlope)} * mix( 0.5, 1.0, churn );
      vec2 slope = ripple * vec2( 1.0, 1.0 / ${glsl(OWN.rippleStretch)} ) * rippleGain * rippleSeen;
      float rough = mix( ${glsl(OWN.roughCalm)}, ${glsl(OWN.roughChurned)}, churn ) + rippleGain * rippleGain * ( 1.0 - rippleSeen * rippleSeen );
      // Normal-Water (16.7.5): 0.02 a layer, 1 + 4 x the mask, faded where a point covers 1.5 to 5 ft and with the fog.
      vec2 detail = vec2( 0.0 );
      if ( uWaterDetailAt.x > 0.5 ) {
        float detailSeen = 1.0 - fogShare;
        float detailLod = 1.0 - smoothstep( 1.5, 5.0, ftPerPixel );
        if ( detailSeen > 0.0 && detailLod > 0.0 ) {
          float mk = textureGrad( uWaterMask, at / uWaterDetailAt.w, atx / uWaterDetailAt.w, aty / uWaterDetailAt.w ).r;
          vec2 nA = textureGrad( uWaterDetail, detailA, detailAx, detailAy ).rg * 2.0 - 1.0;
          vec2 nB = textureGrad( uWaterDetail, detailB, detailBx, detailBy ).rg * 2.0 - 1.0;
          detail = - ( nA + nB ) * ( 0.02 * ( 1.0 + 4.0 * mk ) * detailLod * detailSeen * uWaterDetailAt.y );
        }
      }
      slope += detail;
      // The sheet's ways across (u) and along the flow on its surface, from the screen's derivatives, in its own plane.
      vec3 r1 = cross( dpy, n ), r2 = cross( n, dpx );
      vec3 across = r1 * dqx.x + r2 * dqy.x, along = r1 * dqx.y + r2 * dqy.y;
      across -= n * dot( n, across );
      along -= n * dot( n, along );
      across = dot( across, across ) > 1e-30 ? normalize( across ) : vec3( 0.0 );
      along = dot( along, along ) > 1e-30 ? normalize( along ) : vec3( 0.0 );
      vec3 face = normalize( n - slope.x * across - slope.y * along );
      // What it mirrors leans with the detail half as much again, as on the lakes.
      vec3 mirrorFace = normalize( n - ( slope.x + 1.5 * detail.x ) * across - ( slope.y + 1.5 * detail.y ) * along );
      float glance = 0.02 + 0.98 * pow( 1.0 - wfSat( dot( eye, face ) ), 5.0 );
      vec3 mirrorWay = reflect( - eye, mirrorFace );
      // The sky, blurred by the roughness; a line that looks down meets the ground and the pool, darker.
      float spread = 2.0 * sqrt( 0.5 * rough );
      vec3 mirrored = wfSkyAlong( vec3( mirrorWay.x, abs( mirrorWay.y ), mirrorWay.z ), log2( max( 1.0, spread * 700.0 ) ) )
        * ( 1.0 - ${glsl(OWN.belowDark)} * smoothstep( 0.0, 0.5, - mirrorWay.y ) );
      // The sun's glint, as the lake's facets give it (render/water-surface.js), only from the side the sun is on.
      vec3 toward = normalize( eye + uSun );
      float cosH = max( dot( toward, face ), 0.05 );
      float tan2 = ( 1.0 - cosH * cosH ) / ( cosH * cosH );
      float sigma2 = 0.5 * rough;
      float facets = exp( - tan2 / ( 2.0 * sigma2 ) ) / ( 6.2831853 * sigma2 );
      float sends = 0.02 + 0.98 * pow( 1.0 - max( dot( eye, toward ), 0.0 ), 5.0 );
      float shine = facets * sends / ( 4.0 * max( dot( eye, face ), ${glsl(WATER_GLINT.grazing)} ) * pow( cosH, 4.0 ) );
      glint = uSunGlint * min( shine, ${glsl(WATER_GLINT.most)} ) * step( 0.0, dot( n, uSun ) ) * mix( 1.0, ${glsl(OWN.glintRough)}, churn );
      // What the eye sees of the water: what it mirrors, as much as it mirrors, and of the rest its own light, as much as
      // it hides of what lies behind; the detail's light and dark facets.
      waterAlpha = 1.0 - ( 1.0 - glance ) * ( 1.0 - hides );
      float detailShade = clamp( 1.0 + 2.4 * dot( detail, vec2( 0.6, 0.8 ) ), 0.7, 1.3 );
      water = ( mirrored * glance + ( 1.0 - glance ) * hides * body ) * detailShade / max( waterAlpha, 1e-3 );
    }

    /*
      The whitewater (16.7.2): W from the drop in free fall past 27 ft and the speed past the fall's roughFrom (both off at
      255), and the impact over a column's last feet; none on the lip.
    */
    float W = wfSat( ( uRough.y * max( wfSat( ( drop - ${glsl(WW.dropFromFt)} ) / ${glsl(WW.dropOverFt)} ) * air, wfSat( ( v - uRough.x ) / ${glsl(WW.speedOverFt)} ) ) * 0.9
      + ( 1.0 - smoothstep( 0.0, 0.5, end ) ) * 0.85 ) * ${glsl(WW.white)} ) * lip;
    // Streaks where the water falls free or runs fast, round churn at the impact and on slow water.
    float an = wfSat( max( air, smoothstep( 10.0, 35.0, v ) ) ) * smoothstep( 0.0, 0.5, end );
    float density = 0.5, froth = 0.0;
    if ( W > 0.001 ) {
      // The back face's froth has no cells, only their mean and the broad fbm: softer and weaker (16.7.3).
      float cells = back ? 0.0 : 1.0;
      float d0 = 0.5, d1 = 0.5, d2 = 0.5;
      if ( fmx > 0.0 && w1 > 0.001 ) d1 = wfFoamDensity( q1, fq, an, cells );
      if ( fmx > 0.0 && w1 < 0.999 ) d2 = wfFoamDensity( q2, fq, an, cells );
      if ( fmx < 1.0 ) d0 = wfFoamDensity( qo, fqo, an, cells );
      density = wfSat( mix( d0, wfMix2( d1, d2, w1 ), fmx ) + 0.6 * brk * ( clumps - 0.5 ) );
      // Eroded by W through a wide soft edge, never cut: little W is a few feathered patches, much nearly solid froth.
      float soft = ${glsl(WW.soft)} * ( back ? 1.6 : 1.0 );
      froth = smoothstep( 1.0 - W - soft, 1.0 - W + soft, density ) * wfSat( W * 4.0 ) * wfSat( sideK * 1.5 ) * ( back ? 0.7 : 1.0 );
    }
    vec3 foamColour = foamLight * mix( vec3( 0.84, 0.92, 1.0 ), vec3( 1.0 ), smoothstep( 0.15, 0.85, froth ) ) * ( 0.90 + 0.14 * density );
    // Between the froth the water, a little milky and a little more see-through by W.
    float aer = wfSat( W * 1.25 ) * wfSat( sideK * 1.5 ) * ( back ? 0.5 : 1.0 );
    vec3 gap = mix( water, foamColour * vec3( 0.80, 0.90, 0.96 ), ${glsl(WW.gapAer)} * aer );
    colour = mix( gap, foamColour, froth );
    float outlineMask = wfMask( outline, edge, end, 0.6 * brk );
    alpha = uOpacity * mix( waterAlpha * ( 1.0 - ${glsl(WW.gapClear)} * aer ), max( waterAlpha, ${glsl(WW.foamAlpha)} ), froth ) * outlineMask;
    // The veil: a tall free fall thins to see-through in its gaps and thin foam; dense foam stays.
    alpha *= 1.0 - 0.4 * brk * ( 1.0 - 0.75 * froth );
    // The dry foot: water stopping on flat ground after a drop fades out instead of fanning white.
    float foot = ( 1.0 - air ) * smoothstep( 0.985, 0.998, abs( n.y ) ) * smoothstep( 8.0, 20.0, drop ) * smoothstep( 0.15, 0.7, tau - sqrt( max( drop, 0.0 ) / 16.0 ) );
    foot *= 1.0 - smoothstep( 3.0, 8.0, v );
    alpha *= 1.0 - smoothstep( 0.0, 1.0, foot * ( 1.0 + 0.6 * ( clumps - 0.5 ) ) );
    // The glint stands on the clear water, not on the froth, within the sheet's outline.
    glint *= ( 1.0 - froth ) * uOpacity * outlineMask;
  }
  // The slab's back face fades by its air (16.7.3); it has no glint.
  float backAlpha = back ? air : 1.0;
  alpha *= backAlpha;
  float shown = max( alpha, wfSat( dot( glint, vec3( 0.2126, 0.7152, 0.0722 ) ) ) );
  if ( shown < 0.004 ) discard;
  gl_FragColor = vec4( ( colour * alpha + glint ) / shown, shown );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
