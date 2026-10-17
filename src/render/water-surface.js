/*
  The water (docs/VISUALS.md, "Water"), when "Reflective water" is on. The game draws it as an
  animated texture on a flat plane (MONSTER_EXE_ANALYSIS.md section 13; render/water-effects.js
  draws that). This is the same plane, at the same level and with the same bob, drawn by a
  shader of its own:

   - waves: a field of wind waves worked out as waves on water run (game/water-waves.js), laid at
     four sizes, in gusts, lying down in the shallows; far off, where the picture cannot show a
     wave, its slope is roughness, read from the field's filtered pictures;
   - the sky in it: the level's own sky art, read where a ray off the surface would meet the
     dome, more of it the lower the eye looks, as blurred as the water is rough;
   - the land in it: the hills, as a level mirror would show them, broken up by the waves
     (render/water-reflection.js works out what a mirror shows, once a frame);
   - the sun's glint: the share of the water's facets tipped to send the sun to the eye, sparks
     near and a path far off (Cox and Munk);
   - depth: how deep the water is at each point comes from the map of the ground under it
     (game/ground-maps.js), and what the eye sees is light that has passed through that much
     water (game/water.js): the bed, less of it the deeper it lies and its red gone first; and
     the daylight the water itself sends back, in the water's colour and as bright as the day.
     So the shallows are clear, the deep is dark, water in the dark is black, and the shore has
     an edge of foam that laps. The ground under it takes the same (`dressBed`): it darkens and
     blues with depth, light dances on it in the shallows, and the shore is wet;
   - rain rings in Rain;
   - shadows: where the hills or anything standing cast the sun's shadow (render/sun-shadows.js, the enhanced look),
     the water loses the sun's share of its daylight and its glint, and keeps what it mirrors of the sky;
   - ice in Snow, when the game makes the water solid (MTM2_PHYSICS.md 2.1): flat and hard, at
     the game's own opacity, dark where water lies under it and pale where it is frozen to the
     bed, broken by long cracks, plates and hairlines that are seen running down into it, none of
     them even, with milky patches and bubbles caught in it, and snow gathering on it at the
     game's own pace (game/atmosphere.js) until it covers a seventh. Where a truck comes down on it
     hard it stars: cracks run out from the blow (game/ice.js), and stay; where a truck's body is
     dragged over it, it is scored white. Each point of the ice looks only at the marks that
     reach into its own cell, so it costs the same however many there are.

  The open water and the ice are two programs, the planes wearing one or the other: in one, the
  ice's many lines made the open water cost nearly twice as much.

  It needs no second view of the scene and no picture of what lies behind it: one pass over the
  water, and the land it mirrors a small pass over the map of the ground, the same size on any
  screen, so a headset can afford it. Fog is the scene's, as for everything else.
*/
import * as THREE from "three";
import { ICE_SNOW_SHARE, SNOW_START, snowDown } from "../game/atmosphere.js";
import { ICE, ICE_MARKS, ICE_SCRAPES, ICE_STARS, createIceMarks } from "../game/ice.js";
import { SNELL_WINDOW, WATER_BED, WATER_GLINT, WATER_INDEX, WATER_REFLECTION, WATER_RIPPLES, WATER_SCATTER, WATER_SILT, WATER_SILT_TONE, WATER_TAKES } from "../game/water.js";
import { addShaderHook } from "./shader-hooks.js";
import { WEATHER_LOOK, waterOffsetFt, waterOpacity } from "../game/weather.js";
import { ATMOSPHERE_FRAGMENT_GLSL, atmosphere, atmosphereUniforms, screenColor } from "./atmosphere.js";
import { WATER_WAVES, WATER_WAVE_LAYOUT, waveLoopSeconds } from "../game/water-waves.js";
import { cloudNoise, waveFieldTexture, waveNoise } from "./noise-textures.js";
import { RAIN_RINGS_GLSL, mirrorSky, skyAlongGlsl } from "./water-common.js";

const RAIN = 4, SNOW = 5;
/** The game's opacity for the frozen water of Snow. */
const ICE_OPACITY = waterOpacity(SNOW);
/** The clock the waves run on wraps here, seconds. */
const CLOCK_SECONDS = 4096;
const glsl = (n) => n.toFixed(4);
const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Numbers for the graphics card to read as they are, four to a texel: no filtering, no mipmaps. */
function dataTexture(data, width, height) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec3 vView;
#include <shadowmap_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vec4 view = viewMatrix * world;
  vWorld = world.xyz;
  vView = view.xyz;
  // Where this point lies in each of the sun's shadow maps (the cascades, render/sun-shadows.js); the water faces up.
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * ( world + vec4( 0.0, directionalLightShadows[ i ].shadowNormalBias, 0.0, 0.0 ) );
    }
    #pragma unroll_loop_end
  #endif
  gl_Position = projectionMatrix * view;
}`;

/** What the water and the ice share: the scene's light and shadows, the sky and the fog. */
const PRELUDE = /* glsl */ `
varying vec3 vWorld;
varying vec3 vView;
#include <packing>
#include <shadowmap_pars_fragment>
// uSunShare: the sun's share of the daylight on the water, which a shadow takes away
// uSkyVeil: how deep the fog over the eye lies, for the sky's veil (render/atmosphere.js \`skyVeil\`)
uniform float uTime, uLight, uSnow, uRain, uSkyOn, uDark, uSunShare, uSkyVeil;
// uDaylight: the light that falls on the water from the sky and the sun together; uScatter: the water's own colour
uniform vec3 uSun, uSunColor, uDaylight, uScatter, uSkyCap, uHorizon, uFogColor, uFogRange, uGroundAt;
uniform sampler2D uGround, uCloud, uSky, uRipples;
// the ripples' field (render/water-ripples.js): its corner on the map (feet), 1 / its width (feet), whether there is one
uniform vec4 uRippleAt;
// The marks the trucks have left in the ice, and each cell's list of those that reach into it (game/ice.js \`createIceMarks\`).
uniform sampler2D uIceMarks, uIceGrid;
${ATMOSPHERE_FRAGMENT_GLSL}

// The sun's shadow map at \`coord\` (three.js's packed depths), read at the four texels about the point and weighed
// between them: soft over a texel. three.js's soft shadows read sixteen, in each cascade the loop below unrolls, which
// cost the water more than all the rest of it; a surface that ripples needs no more than this.
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
float shadowAt( sampler2D map, vec2 size, float bias, vec4 coord ) {
  vec3 on = coord.xyz / coord.w;
  vec2 texel = on.xy * size - 0.5, f = fract( texel ), step_ = 1.0 / size;
  vec2 base = ( floor( texel ) + 0.5 ) * step_;
  float z = on.z + bias;
  return mix( mix( texture2DCompare( map, base, z ), texture2DCompare( map, base + vec2( step_.x, 0.0 ), z ), f.x ),
    mix( texture2DCompare( map, base + vec2( 0.0, step_.y ), z ), texture2DCompare( map, base + step_, z ), f.x ), f.y );
}
#endif
// How much of the sun reaches this point, 0 to 1: from the finest of the sun's shadow maps that covers it (they are listed
// nearest first), 1 where none does or there are no shadows.
float sunReaches() {
  float lit = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    bool found = false;
    DirectionalLightShadow caster;
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      caster = directionalLightShadows[ i ];
      if ( ! found ) {
        vec3 on = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
        if ( all( greaterThan( on.xy, vec2( 0.01 ) ) ) && all( lessThan( on.xy, vec2( 0.99 ) ) ) && on.z <= 1.0 ) {
          lit = mix( 1.0, shadowAt( directionalShadowMap[ i ], caster.shadowMapSize, caster.shadowBias, vDirectionalShadowCoord[ i ] ), caster.shadowIntensity );
          found = true;
        }
      }
    }
    #pragma unroll_loop_end
  #endif
  return lit;
}

// The sky a ray leaving the water along \`way\` would meet (render/water-common.js).
${skyAlongGlsl("skyAlong", { on: "uSkyOn", map: "uSky", cap: "uSkyCap", horizon: "uHorizon", dark: "uDark", veil: "uSkyVeil" })}
${RAIN_RINGS_GLSL}
float hash1( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec2 hash2( vec2 p ) { return fract( sin( vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 ); }
`;

/** The start of each one's `main`: where the point is, how deep the water under it, and the light on it. */
const SETUP = /* glsl */ `
  vec3 toEye = cameraPosition - vWorld;
  float dist = length( toEye );
  vec3 eye = toEye / dist;
  bool under = eye.y < 0.0;
  vec2 at = vec2( vWorld.x, - vWorld.z );
  // How deep the water is here: its surface over the ground under it.
  float depth = uGroundAt.z > 0.5 ? vWorld.y - ( texture2D( uGround, at * uGroundAt.y ).r + uGroundAt.x ) : 8.0;
  float through = 1.0 - exp( - max( depth, 0.0 ) * 0.26 );
  vec4 cloud = texture2D( uCloud, at / 61.0 );
  vec3 color;
  float alpha;
  // In a shadow the water has the sky's light alone: no sun's share of the daylight, and no glint.
  float sunLit = sunReaches();
  float shade = 1.0 - uSunShare * ( 1.0 - sunLit );
  vec3 daylight = uDaylight * shade;
`;

/** The end of each one's `main`: the colour out, through the curve and the fog. */
const FINISH = /* glsl */ `
  gl_FragColor = vec4( color, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // The scene's fog, as every other material has it (render/atmosphere.js).
  if ( mtmFog[ 0 ].x > 0.5 ) gl_FragColor.rgb = mtmFogApply( gl_FragColor.rgb, uFogColor, vView );
  else if ( uFogRange.z > 0.5 ) gl_FragColor.rgb = mix( gl_FragColor.rgb, uFogColor, smoothstep( uFogRange.x, uFogRange.y, - vView.z ) );
`;

/**
 * The ice (Snow), a program of its own. In one with the open water its many lines made the water cost nearly twice as
 * much, though it never ran them: a graphics card sets aside for every point what the longer of the two needs.
 */
const ICE_FRAGMENT = /* glsl */ `
${PRELUDE}
// A value from 0 to 1 that wanders smoothly along \`u\`, its own for each \`seed\`.
float iceWander( float u, float seed ) {
  float i = floor( u ), f = fract( u );
  return mix( hash1( vec2( i, seed ) ), hash1( vec2( i + 1.0, seed ) ), f * f * ( 3.0 - 2.0 * f ) );
}
// A field of plates, one to a cell of \`p\`, each around a point of its own: the crushed middle of a star is shards of
// them. x: how far \`p\` is from the crack between its plate and the next, in cells. y: a number of the plate's own. zw:
// the way across that crack, from it toward \`p\`.
vec4 icePlates( vec2 p ) {
  vec2 cell = floor( p ), f = fract( p );
  vec2 nearest = vec2( 8.0 ), next = vec2( 8.0 );
  float dNearest = 64.0, dNext = 64.0, plate = 0.0;
  for ( int y = - 1; y <= 1; y ++ ) {
    for ( int x = - 1; x <= 1; x ++ ) {
      vec2 g = vec2( float( x ), float( y ) );
      vec2 r = g + 0.1 + 0.8 * hash2( cell + g ) - f;
      float d = dot( r, r );
      if ( d < dNearest ) { dNext = dNearest; next = nearest; dNearest = d; nearest = r; plate = hash1( cell + g + 3.1 ); }
      else if ( d < dNext ) { dNext = d; next = r; }
    }
  }
  // The crack is the line midway between this plate's point and the next nearest: straight, as ice breaks.
  vec2 across = normalize( nearest - next );
  return vec4( dot( 0.5 * ( nearest + next ), - across ), plate, across );
}
/*
  A field of the ice's own cracks (game/ice.js \`ICE\`): plates, one to a cell of \`p\` round a point of its own, and of the
  cracks between them only \`kept\` of them, so that two plates the crack between which is not kept are one. Each crack
  has a number of its own, the same seen from either side. x: how far \`p\` is from the crack between its plate and the
  next, in cells, if that crack is kept (8 if not); y: that crack's number, 0 to 1; zw: the way across it, from it
  toward \`p\`. (A crack's line runs on to where it meets the next; its face, near there, only as far as it is the nearer.)
*/
vec4 iceCracks( vec2 p, float kept ) {
  vec2 cell = floor( p ), f = fract( p );
  vec2 nearest = vec2( 8.0 ), next = vec2( 8.0 ), nearestCell = vec2( 0.0 ), nextCell = vec2( 0.0 );
  float dNearest = 64.0, dNext = 64.0;
  for ( int y = - 1; y <= 1; y ++ ) {
    for ( int x = - 1; x <= 1; x ++ ) {
      vec2 g = vec2( float( x ), float( y ) ), r = g + 0.1 + 0.8 * hash2( cell + g ) - f;
      float d = dot( r, r );
      if ( d < dNearest ) { dNext = dNearest; next = nearest; nextCell = nearestCell; dNearest = d; nearest = r; nearestCell = g; }
      else if ( d < dNext ) { dNext = d; next = r; nextCell = g; }
    }
  }
  vec2 a = cell + nearestCell, b = cell + nextCell;
  float number = hash1( ( a + b ) * 0.5 + abs( a - b ) * vec2( 13.1, 7.7 ) + 0.31 );
  if ( number >= kept ) return vec4( 8.0, 0.0, 0.0, 0.0 );
  vec2 across = normalize( nearest - next );
  return vec4( dot( 0.5 * ( nearest + next ), - across ), number / max( kept, 1e-3 ), across );
}
// How a crack numbered \`number\` (0 to 1) differs from its field's measure, by \`k\` a field of its own: from 1 - vary to 1 + vary.
float iceVary( float number, float k ) { return 1.0 + ${glsl(ICE.vary)} * ( 2.0 * fract( number * k ) - 1.0 ); }
// A crack \`width\` wide seen \`away\` from its middle, no thinner than \`pixel\` (all in one measure): fainter instead.
float iceCrack( float away, float width, float pixel ) {
  return ( 1.0 - smoothstep( width, width + pixel * 1.5 + width * 0.6, away ) ) * min( 1.0, width / max( pixel, 1e-5 ) + 0.35 );
}
/*
  A crack seen in the ice (game/ice.js \`crackPlane\`): x the line where it meets the surface, \`width\` wide; y its face, a
  plane running \`deepFt\` straight down, seen through the ice where the eye's line meets it. The point is \`away\` from
  the line (feet), and the eye's line closes on the line by \`closing\` for each foot it runs down. The face is brightest
  near the top and is gone at its foot; seen edge on it is no wider than the line, and no thinner than a pixel.
*/
vec2 crackSeen( float away, float closing, float deepFt, float width, float pixel ) {
  float line = iceCrack( away, width, pixel );
  if ( closing <= 1e-3 ) return vec2( line, 0.0 );
  float down = away / closing;
  float face = ( 1.0 - smoothstep( deepFt * 0.7, deepFt, down ) ) * ( 0.6 + 0.4 * ( 1.0 - down / deepFt ) );
  face *= smoothstep( width * 0.5, width + pixel, away ) * min( 1.0, closing * deepFt / max( pixel, 1e-5 ) );
  return vec2( line, face );
}
/*
  A crack from \`a\` to \`b\` on the surface (feet), seen from \`p\` as \`crackSeen\`: its face is as long as the crack, so the
  eye's line must meet it between its ends. \`lean\` is how far aside the eye's line runs for a foot down. The crack is
  ragged: it wanders up to \`ragged\` feet either side of the straight line along its length, and not at all at its ends,
  where it meets the next.
*/
vec2 crackPiece( vec2 p, vec2 a, vec2 b, float width, float deepFt, vec2 lean, float pixel, float ragged ) {
  vec2 ab = b - a;
  float long_ = max( length( ab ), 1e-3 );
  vec2 way = ab / long_, side = vec2( - way.y, way.x );
  float t = dot( p - a, way ), across = dot( p - a, side );
  // Too far from it to see its line or its face (as most points are from most cracks): nothing.
  float near_ = ragged + width * 1.6 + pixel * 1.5 + deepFt * length( lean );
  if ( abs( across ) > near_ || t < - near_ || t > long_ + near_ ) return vec2( 0.0 );
  across -= ragged *( 2.0 * iceWander( t / 0.45, fract( a.x * 0.0137 + b.y * 0.0071 ) * 97.0 ) - 1.0 ) * clamp( min( t, long_ - t ) / 0.4, 0.0, 1.0 );
  float away = length( vec2( across, t - clamp( t, 0.0, long_ ) ) );
  float closing = - dot( lean, side ) * ( across < 0.0 ? - 1.0 : 1.0 );
  vec2 seen = crackSeen( away, closing, deepFt, width, pixel );
  float along = ( t + dot( lean, way ) * ( away / max( closing, 1e-3 ) ) ) / long_;
  seen.y *= step( 0.0, along ) * step( along, 1.0 );
  return seen;
}
vec2 iceWay( float angle ) { return vec2( cos( angle ), sin( angle ) ); }
// Spoke \`j\` of a star of \`spokes\` struck at \`star\` (game/ice.js \`ICE_STARS\`): its four points, from the crushed middle
// out, in three straight pieces of uneven lengths that turn a little where they meet; and how bright its face is. It
// leaves the blow out of step with an even star, reaches as far as it happens to, and less far on the star's weak side.
void starSpoke( vec4 star, float spokes, float j, out vec2 p0, out vec2 p1, out vec2 p2, out vec2 p3, out float catches ) {
  j = mod( j, spokes );
  float h = hash1( vec2( j, star.w * 91.7 ) ), h2 = hash1( vec2( j + 7.1, star.w * 23.3 ) ), h3 = hash1( vec2( j + 1.9, star.w * 61.1 ) );
  float angle = ( j + 0.5 + ${glsl(2 * ICE_STARS.spread)} * ( h - 0.5 ) ) * 6.2831853 / spokes;
  float weak = 0.5 - 0.5 * cos( angle - star.w * 40.0 );
  float reach = star.z * ( ${glsl(ICE_STARS.shortest)} + ${glsl(1 - ICE_STARS.shortest)} * sqrt( hash1( vec2( j + 3.7, star.w * 17.3 ) ) ) ) * ( 1.0 - ${glsl(ICE_STARS.lopsided)} * weak );
  float k1 = ( h2 - 0.5 ) * ${glsl(2 * ICE_STARS.kink)}, k2 = k1 + ( h3 - 0.5 ) * ${glsl(2 * ICE_STARS.kink)};
  float crushed = star.z * ${glsl(ICE_STARS.crushed)};
  p0 = star.xy + iceWay( angle ) * crushed * 0.6;
  p1 = star.xy + iceWay( angle ) * max( reach * ( 0.18 + 0.3 * h2 ), crushed * 0.8 );
  p2 = p1 + iceWay( angle + k1 ) * reach * ( 0.18 + 0.32 * h3 );
  p3 = p2 + iceWay( angle + k2 ) * max( 0.0, reach - length( p2 - star.xy ) );
  catches = 0.45 + 0.55 * h3;
}
// The point of a spoke \`radius\` from where the star was struck, walking its pieces out.
vec2 spokeAt( vec2 middle, vec2 p0, vec2 p1, vec2 p2, vec2 p3, float radius ) {
  float r1 = length( p1 - middle ), r2 = length( p2 - middle ), r3 = length( p3 - middle );
  if ( radius < r1 ) return mix( p0, p1, clamp( ( radius - length( p0 - middle ) ) / max( r1 - length( p0 - middle ), 1e-3 ), 0.0, 1.0 ) );
  if ( radius < r2 ) return mix( p1, p2, clamp( ( radius - r1 ) / max( r2 - r1, 1e-3 ), 0.0, 1.0 ) );
  return mix( p2, p3, clamp( ( radius - r2 ) / max( r3 - r2, 1e-3 ), 0.0, 1.0 ) );
}
/*
  A star where the ice was struck (game/ice.js \`ICE_STARS\`), \`star\` its middle (feet), how far its cracks have run by now
  and its own number. Cracks run out from the blow, each in straight pieces with a turn or two and some forking, joined
  across on two rings by straight cracks from one to the next, as ice breaks; the middle is crushed white and water wells
  up dark round it. Each crack is seen as the ice's own are, a line and its face under it. Into \`found\`: x the lines, y
  their faces, z how crushed the ice is, w how wet. \`piece\` says which of the pieces the cracks cut the point lies in
  (a number of its own), if it lies in none yet.
*/
void iceStar( vec2 at, vec4 star, vec2 lean, float pixel, inout vec4 found, inout float piece ) {
  vec2 off = at - star.xy;
  float r = length( off );
  if ( star.z <= 0.0 || r > star.z + ${glsl(ICE_STARS.deepFt)} * length( lean ) + 0.2 ) return;
  float spokes = ${glsl(ICE_STARS.spokes)} + floor( fract( star.w * 7.31 ) * ${glsl(ICE_STARS.spokesMore)} );
  float sector = floor( ( atan( off.y, off.x ) / 6.2831853 + 1.0 ) * spokes );
  float width = mix( 0.05, 0.012, clamp( r / star.z, 0.0, 1.0 ) );
  // The spokes either side of the point and the next ones out, and the joins across the two gaps between them.
  vec2 a0, a1, a2, a3, b0, b1, b2, b3;
  float catchA, catchB;
  starSpoke( star, spokes, sector - 1.0, a0, a1, a2, a3, catchA );
  for ( int k = 0; k <= 2; k ++ ) {
    float j = sector + float( k ) - 1.0, jj = mod( j, spokes );
    starSpoke( star, spokes, j + 1.0, b0, b1, b2, b3, catchB );
    {
      // Spoke j (a) itself, as wide as it happens to be, and its fork; then the joins from it to the next (b).
      float own = width * ( 0.6 + 0.8 * hash1( vec2( jj + 2.3, star.w * 71.3 ) ) );
      vec2 seen = max( max( crackPiece( at, a0, a1, own, ${glsl(ICE_STARS.deepFt)}, lean, pixel, ${glsl(ICE_STARS.raggedFt)} ),
        crackPiece( at, a1, a2, own, ${glsl(ICE_STARS.deepFt)}, lean, pixel, ${glsl(ICE_STARS.raggedFt)} ) ),
        crackPiece( at, a2, a3, own * 0.8, ${glsl(ICE_STARS.deepFt)}, lean, pixel, ${glsl(ICE_STARS.raggedFt)} ) );
      float forkAt = hash1( vec2( jj + 5.3, star.w * 43.9 ) );
      if ( forkAt < ${glsl(ICE_STARS.forks)} ) {
        vec2 from = forkAt < ${glsl(ICE_STARS.forks / 2)} ? a1 : a2;
        float turn = ( hash1( vec2( jj + 9.7, star.w * 13.1 ) ) < 0.5 ? - 1.0 : 1.0 ) * ( 0.3 + 0.45 * forkAt / ${glsl(ICE_STARS.forks)} );
        vec2 way = normalize( a3 - from + 1e-4 );
        way = vec2( way.x * cos( turn ) - way.y * sin( turn ), way.x * sin( turn ) + way.y * cos( turn ) );
        float forkLong = length( a3 - from ) * ( 0.3 + 0.45 * hash1( vec2( jj + 4.1, star.w * 29.3 ) ) );
        seen = max( seen, crackPiece( at, from, from + way * forkLong, own * 0.7, ${glsl(ICE_STARS.deepFt)}, lean, pixel, ${glsl(ICE_STARS.raggedFt)} ) * 0.85 );
      }
      found.xy = max( found.xy, seen * catchA );
    }
    if ( k < 2 ) {
      for ( int ring = 0; ring < 2; ring ++ ) {
        float which = float( ring );
        if ( hash1( vec2( jj * 1.7 + which * 9.1, star.w * 29.9 ) ) > ${glsl(ICE_STARS.joins)} ) continue;
        // Each join at its own distance out, and the far end nearer or further than the near.
        float radius = star.z * ( which < 0.5 ? ${glsl(ICE_STARS.rings[0])} : ${glsl(ICE_STARS.rings[1])} )
          * ( ${glsl(1 - ICE_STARS.ringsVary)} + ${glsl(2 * ICE_STARS.ringsVary)} * hash1( vec2( jj + which * 5.3, star.w * 53.1 ) ) );
        if ( length( a3 - star.xy ) < radius || length( b3 - star.xy ) < radius ) continue;
        vec2 from = spokeAt( star.xy, a0, a1, a2, a3, radius );
        vec2 to = spokeAt( star.xy, b0, b1, b2, b3, radius * ( 0.8 + 0.4 * hash1( vec2( jj + 2.9, star.w * 7.7 + which ) ) ) );
        found.xy = max( found.xy, crackPiece( at, from, to, width * 0.85, ${glsl(ICE_STARS.deepFt)}, lean, pixel, ${glsl(ICE_STARS.raggedFt)} ) * 0.8 * catchA );
      }
    }
    a0 = b0; a1 = b1; a2 = b2; a3 = b3; catchA = catchB;
  }
  // The crushed middle is ragged, not round.
  float bearing = atan( off.y, off.x );
  float crushedR = star.z * ${glsl(ICE_STARS.crushed)} * ( 1.0 + 0.16 * sin( bearing * 3.0 + star.w * 20.0 ) + 0.09 * sin( bearing * 7.0 + star.w * 50.0 ) );
  found.z = max( found.z, 1.0 - smoothstep( crushedR * 0.55, crushedR, r ) );
  found.w = max( found.w, ( 1.0 - smoothstep( crushedR, crushedR * ${glsl(ICE_STARS.wet)}, r ) ) * smoothstep( crushedR * 0.5, crushedR, r ) );
  // The piece: which gap between spokes, and which ring it lies inside.
  if ( r < star.z && piece < 0.0 ) piece = hash1( vec2( sector + 17.0 * floor( r / ( star.z * ${glsl((ICE_STARS.rings[0] + ICE_STARS.rings[1]) / 3)} ) ), star.w * 31.7 ) );
}
/*
  A piece of a band scored by a body dragged over the ice (game/ice.js \`ICE_SCRAPES\`): \`a\` its two ends (feet), \`b\` 1,
  how wide it is either side of its middle, the band's own number and how far along the band the piece begins. It is
  scored white with fine scratches along the way the body went, each running for a stretch of its own, to a ragged
  edge; off its edges short cracks run out and back, into \`found\` as a star's do. Returns x, how much of the band is
  here (it sweeps the snow away), and y, how scored the ice is.
*/
vec2 iceScrape( vec2 at, vec4 a, vec4 b, vec2 lean, float pixel, inout vec4 found ) {
  vec2 way = a.zw - a.xy;
  float long_ = max( length( way ), 1e-3 );
  way /= long_;
  vec2 side = vec2( - way.y, way.x ), off = at - a.xy;
  float along = dot( off, way ), across = dot( off, side ), halfFt = b.y, band = b.z;
  float reach = halfFt + ${glsl(ICE_SCRAPES.spurFt[1])} + ${glsl(ICE_SCRAPES.spurDeepFt)} * length( lean ) + 0.2;
  if ( along < - reach || along > long_ + reach || abs( across ) > reach ) return vec2( 0.0 );
  float total = b.w + along;
  // The band, round at its ends so that one piece runs into the next, its edge ragged.
  float out_ = length( vec2( along - clamp( along, 0.0, long_ ), across ) );
  float edgeSide = across < 0.0 ? 0.0 : 5.0;
  float edge = halfFt * ( 0.78 + 0.14 * iceWander( total / 2.1, band * 31.0 + edgeSide ) + 0.08 * iceWander( total / 0.37, band * 17.0 + edgeSide ) );
  vec2 scraped = vec2( 1.0 - smoothstep( edge - 0.25 - pixel, edge + pixel, out_ ), 0.0 );
  if ( scraped.x > 0.0 ) {
    // Scratches along the way, fine and coarse, each its own strength, running for a stretch and stopping. Finer than a
    // pixel they are a frosting, as white as they are in all.
    float scratches = 0.0;
    for ( int s = 0; s < 2; s ++ ) {
      float coarse = float( s ), spacing = mix( 0.045, 0.19, coarse ), width = mix( 0.012, 0.04, coarse );
      float u = across / spacing + band * 57.0 * ( coarse + 1.0 ), line = floor( u );
      float strength = pow( hash1( vec2( line, band * 13.7 + coarse ) ), 2.5 )
        * step( 0.3, iceWander( total / ( 1.5 + 4.0 * hash1( vec2( line, 3.1 + coarse ) ) ) + line * 0.37, band * 7.9 + coarse ) );
      float sharp = 1.0 - smoothstep( width * 0.5, width * 0.5 + pixel, abs( fract( u ) - 0.5 ) * spacing );
      scratches = max( scratches, mix( sharp * strength, 0.5, smoothstep( 0.4, 1.2, pixel / spacing ) ) );
    }
    // The body bore down harder in some places than others as it went, and hardest at its edges, which dig in: scored
    // more there, and in streaks across the band.
    float bore = 0.35 + 0.65 * iceWander( total / 7.0, band * 3.3 ) * iceWander( across / 0.9 + total / 31.0, band * 5.1 );
    float rim = smoothstep( 0.55, 0.95, abs( across ) / max( edge, 1e-3 ) );
    scraped.y = scraped.x * clamp( ( 0.2 + 0.7 * scratches ) * bore + 0.35 * rim * scratches, 0.0, 1.0 );
  }
  // The cracks off its edges, from the places along the band near the point (a crack reaches back less far than the next).
  float slot = floor( total / ${glsl(ICE_SCRAPES.spurEveryFt)} );
  for ( int k = - 1; k <= 1; k ++ ) {
    float n = slot + float( k );
    if ( hash1( vec2( n, band * 41.3 ) ) > ${glsl(ICE_SCRAPES.spurs)} ) continue;
    // Drawn by the piece it leaves from.
    float rootAt = ( n + 0.15 + 0.7 * hash1( vec2( n + 3.3, band * 9.1 ) ) ) * ${glsl(ICE_SCRAPES.spurEveryFt)} - b.w;
    if ( rootAt < 0.0 || rootAt >= long_ ) continue;
    float h = hash1( vec2( n + 7.7, band * 5.3 ) ), outward = h < 0.5 ? - 1.0 : 1.0;
    float angle = mix( ${glsl(ICE_SCRAPES.spurAngle[0])}, ${glsl(ICE_SCRAPES.spurAngle[1])}, hash1( vec2( n + 1.3, band * 3.7 ) ) );
    float spurLong = mix( ${glsl(ICE_SCRAPES.spurFt[0])}, ${glsl(ICE_SCRAPES.spurFt[1])}, hash1( vec2( n + 5.9, band * 2.3 ) ) );
    vec2 root = a.xy + way * rootAt + side * outward * halfFt * 0.85;
    vec2 first = - way * cos( angle ) + side * outward * sin( angle );
    float turn = ( fract( h * 7.0 ) - 0.5 ) * 0.7;
    vec2 then_ = vec2( first.x * cos( turn ) - first.y * sin( turn ), first.x * sin( turn ) + first.y * cos( turn ) );
    vec2 bend = root + first * spurLong * 0.55;
    vec2 seen = max( crackPiece( at, root, bend, 0.022, ${glsl(ICE_SCRAPES.spurDeepFt)}, lean, pixel, 0.04 ),
      crackPiece( at, bend, bend + then_ * spurLong * 0.45, 0.015, ${glsl(ICE_SCRAPES.spurDeepFt)}, lean, pixel, 0.04 ) );
    found.xy = max( found.xy, seen * 0.85 );
  }
  return scraped;
}
/*
  The marks the trucks have left in the ice (game/ice.js \`createIceMarks\`): the point looks only at those its own cell
  lists (\`ICE_MARKS\`), in the order they were made. Returns what the stars and the cracks off the scored bands give
  (\`iceStar\`); \`piece\` is which piece of a star the point lies in, or -1, and \`scraped\` how much of a scored band is
  here and how scored (\`iceScrape\`).
*/
vec4 iceMarks( vec2 at, vec2 lean, float pixel, out float piece, out vec2 scraped ) {
  vec4 found = vec4( 0.0 );
  piece = - 1.0;
  scraped = vec2( 0.0 );
  ivec2 cell = ivec2( floor( at / ${glsl(ICE_MARKS.cellFt)} ) ) & ivec2( ${ICE_MARKS.cells - 1} );
  for ( int t = 0; t < ${ICE_MARKS.perCell / 4}; t ++ ) {
    vec4 listed = texelFetch( uIceGrid, ivec2( cell.x * ${ICE_MARKS.perCell / 4} + t, cell.y ), 0 );
    for ( int c = 0; c < 4; c ++ ) {
      float slot = listed[ c ];
      if ( slot < 0.0 ) return found;
      int i = int( slot + 0.5 );
      ivec2 where = ivec2( ( i % ${ICE_MARKS.perRow} ) * 2, i / ${ICE_MARKS.perRow} );
      vec4 a = texelFetch( uIceMarks, where, 0 ), b = texelFetch( uIceMarks, where + ivec2( 1, 0 ), 0 );
      if ( b.x < 0.5 ) iceStar( at, a, lean, pixel, found, piece );
      else scraped = max( scraped, iceScrape( at, a, b, lean, pixel, found ) );
    }
  }
  return found;
}

void main() {
${SETUP}
  // How wide a pixel is on the ice here, feet, and how far aside the eye's line runs a foot down in it.
  float pixel = length( fwidth( at ) );
  vec2 lean = - vec2( eye.x, - eye.z ) / max( abs( eye.y ), ${glsl(ICE.flattest)} ) * ${glsl(ICE.bend)};
  // Fine things fewer far off, where they would only shimmer.
  float fineness = 1.0 / ( 1.0 + dist / 260.0 );
  // The marks the trucks have left: where it was struck and which broken piece this is, and where a body was dragged.
  float piece;
  vec2 scraped;
  vec4 struck = iceMarks( at, lean, pixel, piece, scraped );
  // Ice: level and hard, and what it shows of the sky is blurred. A broken piece is tipped its own way; crushed ice is all facets.
  vec4 vein = texture2D( uCloud, at / 23.0 );
  vec3 face = normalize( vec3( ( vein.a - 0.5 ) * 0.04, 1.0, ( vein.b - 0.5 ) * 0.04 ) );
  if ( piece >= 0.0 ) face = normalize( face + vec3( ( hash2( vec2( piece, 1.3 ) ) - 0.5 ) * ${glsl(2 * ICE_STARS.tiltRad)}, 0.0 ).xzy );
  // Crushed ice is shards a few inches across, each tipped its own way, with fine cracks between them.
  vec4 shards = struck.z > 0.0 ? icePlates( at / 0.42 + 5.0 + ( vein.rg - 0.5 ) * 1.4 ) : vec4( 1.0, 0.5, 0.0, 0.0 );
  face = normalize( face + vec3( hash2( vec2( shards.y, 7.7 ) ) - 0.5, 0.0 ).xzy * 0.6 * struck.z );
  if ( under ) face = - face;
  // Scored ice is rough: it throws back less of the sky, and that blurred.
  float glance = pow( clamp( 1.0 - dot( eye, face ), 0.0, 1.0 ), 5.0 ) * ( 1.0 - 0.6 * scraped.y );
  vec3 back = reflect( - eye, face );
  back.y = abs( back.y );
  // Dark where water lies under it, pale where it is frozen to the bed, a shade lighter or darker in broad patches;
  // milky in places.
  vec3 body = mix( vec3( 0.5, 0.64, 0.71 ), vec3( 0.045, 0.14, 0.21 ), through ) * ( 0.9 + 0.2 * cloud.g );
  float milk = smoothstep( 0.42, 0.66, texture2D( uCloud, ( at + lean * 0.5 ) / 140.0 ).g * 0.7 + vein.r * 0.3 );
  body = mix( body, vec3( 0.52, 0.66, 0.73 ), milk * 0.55 );
  // Bubbles caught in it, in swarms, a little way down.
  float bubbles = smoothstep( 0.6, 0.68, texture2D( uCloud, ( at + lean * 0.3 ) / 2.3 ).a ) * smoothstep( 0.5, 0.6, texture2D( uCloud, at / 37.0 ).b );
  body = mix( body, vec3( 0.7, 0.8, 0.85 ), bubbles * 0.5 );
  /*
    The ice's own cracks (game/ice.js \`ICE\`), each a bright line on the surface over its face, which is seen running down
    into the ice where the eye's line meets it. Three fields of them, each pushed about so that no two plates are alike:
    long cracks between floes; plates, most of their cracks showing where the ice is broken up and few where it is
    whole; and hairlines in patches. Each crack is as wide, deep and bright as its own number has it.
  */
  float broken = smoothstep( 0.35, 0.65, texture2D( uCloud, at / ${glsl(ICE.patchFt)} + 0.43 ).g );
  vec4 floes = iceCracks( at / ${glsl(ICE.floeFt)} + 5.3 + ( texture2D( uCloud, at / 433.0 ).ba - 0.5 ) * ${glsl(2 * ICE.warp)} + ( cloud.ba - 0.5 ) * 0.03,
    ${glsl(ICE.floesKept)} );
  vec2 floe = crackSeen( floes.x * ${glsl(ICE.floeFt)}, - dot( lean, floes.zw ), ${glsl(ICE.floeDepthFt)} * iceVary( floes.y, 7.31 ), 0.045 * iceVary( floes.y, 13.7 ), pixel )
    * ( 0.55 + 0.45 * fract( floes.y * 3.17 ) );
  vec4 plates = iceCracks( at / ${glsl(ICE.plateFt)} + ( texture2D( uCloud, at / 157.0 ).rg - 0.5 ) * ${glsl(2 * ICE.warp)} + ( cloud.rg - 0.5 ) * 0.22 + ( vein.ba - 0.5 ) * 0.03,
    mix( ${glsl(ICE.platesKept[0])}, ${glsl(ICE.platesKept[1])}, broken ) );
  vec2 crack = crackSeen( plates.x * ${glsl(ICE.plateFt)}, - dot( lean, plates.zw ), ${glsl(ICE.crackDepthFt)} * iceVary( plates.y, 7.31 ), 0.03 * iceVary( plates.y, 13.7 ), pixel )
    * ( 0.55 + 0.45 * fract( plates.y * 3.17 ) );
  float hairy = smoothstep( 0.42, 0.62, texture2D( uCloud, at / 89.0 + 0.37 ).b ) * fineness;
  vec2 hair = vec2( 0.0 );
  if ( hairy > 0.02 ) {
    vec4 fine = iceCracks( at / ${glsl(ICE.hairlineFt)} + 17.0 + ( vein.gb - 0.5 ) * 0.7, ${glsl(ICE.hairlinesKept)} );
    hair = crackSeen( fine.x * ${glsl(ICE.hairlineFt)}, - dot( lean, fine.zw ), ${glsl(ICE.hairlineDepthFt)} * iceVary( fine.y, 7.31 ), 0.01 * iceVary( fine.y, 13.7 ), pixel ) * 0.5 * hairy;
  }
  // Faces, the ice's own and the marks' alike: silvery, as a plane of ice against air throws back what reaches it.
  // A face throws back more in some places than others.
  body += vec3( 0.42, 0.55, 0.6 ) * ( crack.y * 0.5 + floe.y * 0.55 + hair.y + struck.y * ( 0.45 + 0.4 * vein.r ) ) * ( 0.4 + 0.6 * through ) * fineness;
  float lines = clamp( crack.x * 0.85 + floe.x + hair.x + struck.x, 0.0, 1.0 );
  body = mix( body, vec3( 0.8, 0.9, 0.94 ), lines * ( 0.35 + 0.65 * through ) );
  // Water welled up round the crushed middle of a blow: dark, and wet on top.
  body *= 1.0 - 0.45 * struck.w;
  // The crushed middle: white, broken small, darker in the cracks between the shards.
  vec3 crushedIce = vec3( 0.86, 0.92, 0.95 ) * ( 0.8 + 0.2 * shards.y ) * ( 1.0 - 0.18 * iceCrack( shards.x * 0.42, 0.015, pixel ) );
  body = mix( body, crushedIce, struck.z * ( 0.6 + 0.4 * vein.a ) );
  // Scored white where a body was dragged over it.
  body = mix( body, vec3( 0.8, 0.87, 0.91 ) * ( 0.9 + 0.1 * vein.a ), scraped.y * 0.8 );
  body *= uLight * shade;
  color = mix( body, skyAlong( back, 3.5 + 2.0 * scraped.y ), ( 0.05 + 0.55 * glance + 0.25 * struck.w ) * ( 1.0 - 0.6 * struck.z ) );
  color += uSunColor * ( pow( max( dot( back, uSun ), 0.0 ), 90.0 ) * 0.6 * ( 1.0 - 0.7 * scraped.y ) ) * sunLit;
  // Snow on the ice, in drifts the wind has drawn out: it covers \`uSnow\` of it (the noise lies about a half, so a
  // threshold there covers half), and gathers first along the shore.
  vec2 blown = vec2( at.x * 0.82 + at.y * 0.57, at.y * 0.82 - at.x * 0.57 );
  float drift = texture2D( uCloud, blown / vec2( 310.0, 120.0 ) ).r * 0.55 + texture2D( uCloud, blown / vec2( 90.0, 31.0 ) ).b * 0.3 + cloud.b * 0.15;
  // (The threshold falls with the share to cover: at a seventh, the tops of the drifts and a fringe along the shore.)
  float edge = 0.85 - 0.7 * uSnow;
  float lying = smoothstep( edge - 0.015, edge + 0.045, drift + ( 1.0 - smoothstep( 0.0, 2.5, depth ) ) * 0.3 + ( vein.a - 0.5 ) * 0.05 ) * step( 0.001, uSnow );
  // The drift's edge is thin and lets the ice show; a blow, or a body dragged through it, sweeps it clear.
  lying *= 1.0 - 0.85 * max( max( struck.z, struck.w ), scraped.x );
  color = mix( color, vec3( 0.87, 0.91, 0.97 ) * uLight * shade * ( 0.92 + 0.08 * vein.a ), lying );
  alpha = ${ICE_OPACITY.toFixed(4)} * smoothstep( - 0.05, 0.12, depth );
${FINISH}
}`;

/** The open water. */
const WATER_FRAGMENT = /* glsl */ `
${PRELUDE}
// The land in the water (render/water-reflection.js): its map, and whether it holds anything this frame.
uniform sampler2D uLand;
uniform float uLandOn;
// The waves (game/water-waves.js): the field, and for each of the four sizes it is laid at the way its waves run on
// the map (the wind's, turned a little) and 1 / its size (feet), and how far through its loop it is.
uniform highp sampler3D uWaveField;
uniform vec3 uWaveWays[ 4 ];
uniform vec4 uWaveLoop;
// how strongly each size is laid, this weather's wind times its own (the gusts come on top), and the roughness below them
uniform vec4 uWaveGain;
uniform float uWaveRough;
// where the gusts' pattern lies now (feet), 1 / their size (feet); the sun's light on a face square to it, for its glint
uniform vec3 uGustAt;
uniform vec3 uSunGlint;
// the colour of the silt the trucks stir up: the level's ground's
uniform vec3 uSiltTone;
// The field at one of its sizes, at the map point \`at\`, as strong as \`gain\`: its slope, onto \`slope\` (the map's axes),
// and the mean square of what of it is too fine to show at this distance, onto \`rough\`.
void waveAt( int size, vec2 at, float gain, inout vec2 slope, inout float rough ) {
  vec3 way = uWaveWays[ size ];
  vec2 across = vec2( - way.y, way.x );
  vec4 field = texture( uWaveField, vec3( vec2( dot( way.xy, at ), dot( across, at ) ) * way.z, uWaveLoop[ size ] ) );
  vec2 s = ( field.rg - 0.5 ) * ${glsl(2 * WATER_WAVES.slopeRange)};
  float meanSquare = field.a * ${glsl(2 * WATER_WAVES.slopeRange * WATER_WAVES.slopeRange)};
  slope += gain * ( way.xy * s.x + across * s.y );
  rough += gain * gain * max( meanSquare - dot( s, s ), 0.0 );
}
// The land a line leaving the water along \`way\` meets, as the map holds it: its colour, already as much of it as
// fills the line, and how much of the line it fills (none where the line meets only the sky).
vec4 landAlong( vec3 way, float blur ) {
  if ( uLandOn < 0.5 ) return vec4( 0.0 );
  return textureLod( uLand, vec2( atan( way.x, - way.z ) / 6.2831853, sqrt( clamp( way.y, 0.0, 1.0 ) ) ), blur );
}

void main() {
${SETUP}
  /*
    Waves (game/water-waves.js): the field at four sizes, with the wind and gusting. A gust raises the short waves at
    once, the long less; between gusts the water below the field lies glassy. Far off, where the picture cannot show a
    wave, its slope becomes roughness: the sky in the water blurs and the sun's glint spreads into a path. The waves lie
    down in the shallows.
  */
  vec2 gusts = texture2D( uCloud, ( at - uGustAt.xy ) * uGustAt.z ).rg;
  float gust = mix( ${glsl(WATER_WAVE_LAYOUT.gustReach[0])}, ${glsl(WATER_WAVE_LAYOUT.gustReach[1])}, smoothstep( 0.32, 0.68, gusts.r * 0.65 + gusts.g * 0.35 ) );
  float shallow = 0.35 + 0.65 * smoothstep( 0.0, 2.0, depth );
  vec2 slope = vec2( 0.0 );
  float rough = 0.0;
  waveAt( 0, at, uWaveGain.x * sqrt( gust ) * shallow, slope, rough );
  waveAt( 1, at, uWaveGain.y * gust * shallow, slope, rough );
  waveAt( 2, at, uWaveGain.z * gust * shallow, slope, rough );
  // The finest only near the eye; further off, all its slope is roughness (the field's mean square, twice its square slope).
  float finest = uWaveGain.w * gust * shallow, near = 1.0 - smoothstep( ${glsl(WATER_WAVE_LAYOUT.finestFt * 2 / 3)}, ${glsl(WATER_WAVE_LAYOUT.finestFt)}, dist );
  if ( near > 0.0 ) waveAt( 3, at, finest * near, slope, rough );
  rough += finest * finest * ( 1.0 - near * near ) * ${glsl(2 * WATER_WAVES.slopeRms * WATER_WAVES.slopeRms)};
  rough += uWaveRough * gust * gust * shallow * shallow;
  // Rain's rings, fewer far off where they would only shimmer.
  if ( uRain > 0.0 ) slope += mtmRainRings( at, uTime ) * ( uRain * 0.5 / ( 1.0 + dist / 450.0 ) );
  // The ripples and wakes the trucks stir, the water they beat white and the silt they stir up, about the eye.
  float churned = 0.0, silt = 0.0;
  vec4 stirred = vec4( 0.0 );
  vec2 rippleUv = ( at - uRippleAt.xy ) * uRippleAt.z;
  if ( uRippleAt.w > 0.5 && all( greaterThan( rippleUv, vec2( 0.0 ) ) ) && all( lessThan( rippleUv, vec2( 1.0 ) ) ) ) {
    vec2 texel = vec2( ${(1 / WATER_RIPPLES.windowTexels).toFixed(6)}, 0.0 );
    vec2 rippleSlope = vec2(
      texture2D( uRipples, rippleUv + texel.xy ).r - texture2D( uRipples, rippleUv - texel.xy ).r,
      texture2D( uRipples, rippleUv + texel.yx ).r - texture2D( uRipples, rippleUv - texel.yx ).r ) / ${(2 * WATER_RIPPLES.texelFt).toFixed(3)};
    vec2 rippleEdge = min( rippleUv, 1.0 - rippleUv );
    float rippleShown = smoothstep( 0.0, 0.1, min( rippleEdge.x, rippleEdge.y ) );
    slope += rippleSlope * ( 1.4 * rippleShown );
    stirred = texture2D( uRipples, rippleUv ) * rippleShown;
    churned = stirred.b;
    silt = stirred.a;
    // Churned water is rough: what it mirrors blurs, and its glints spread.
    rough += 0.05 * churned;
  }
  // The scene mirrors z, so a slope along the map's second axis leans the other way.
  vec3 face = normalize( vec3( - slope.x, 1.0, slope.y ) );
  if ( under ) face = - face;
  float glance = 0.02 + 0.98 * pow( clamp( 1.0 - dot( eye, face ), 0.0, 1.0 ), 5.0 );
  vec3 back = reflect( - eye, face );
  // How far the roughness spreads what the water mirrors, radians either way: twice the slope's spread along an axis.
  rough = max( rough, 1e-4 );
  float spread = 2.0 * sqrt( 0.5 * rough );
  if ( under ) {
    // From below. Within a cone about straight up the sky is seen through the surface, ruffled and bright; outside
    // it the surface is a mirror of the water under it (game/water.js \`SNELL_WINDOW\`).
    float up = - eye.y + ( slope.x + slope.y ) * 0.25;
    float window = smoothstep( ${(SNELL_WINDOW - 0.07).toFixed(3)}, ${(SNELL_WINDOW + 0.05).toFixed(3)}, up );
    vec3 through_ = refract( - eye, face, ${WATER_INDEX.toFixed(3)} );
    through_.y = abs( through_.y );
    vec3 above = skyAlong( normalize( through_ + vec3( 0.0, 1e-3, 0.0 ) ), 2.0 ) * 0.85 + uSunColor * pow( max( dot( through_, uSun ), 0.0 ), 60.0 ) * 0.6;
    color = mix( uScatter * uDaylight * 4.2, above, window );
    alpha = mix( 0.92, 0.8, window );
  } else {
    back.y = abs( back.y );
    // The line of sight through the water, bent toward the upright at the surface, and what the water does along it:
    // it takes the bed's light, red first, and gives its own, the daylight it scatters.
    float path = max( depth, 0.0 ) / sqrt( 1.0 - ( 1.0 - eye.y * eye.y ) / ${(WATER_INDEX * WATER_INDEX).toFixed(4)} );
    vec3 passes = exp( - vec3( ${WATER_TAKES.map((v) => v.toFixed(4)).join(", ")} ) * path );
    float hides = 1.0 - dot( passes, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 body = uScatter * daylight * ( 1.0 - passes ) / max( hides, 1e-3 );
    /*
      Churned water (game/water.js \`wheelStir\`): beaten full of air it is milky and pale, a white green under its foam;
      stirred off the bed it is clouded with silt the colour of the ground, which hides the bed, the more the shallower the
      water (in deep water the cloud stays down by the bed).
    */
    if ( churned + silt > 0.002 ) {
      float aired = smoothstep( 0.04, 0.6, churned ), silted = smoothstep( 0.0, 0.45, silt ) * ( 1.0 - smoothstep( 4.0, 14.0, depth ) );
      body = mix( body, vec3( 0.3, 0.42, 0.41 ) * daylight, aired * 0.65 );
      hides = max( hides, aired * 0.55 );
      // (Fine silt held in the water scatters more light than the wet bed it came off: it is paler.)
      body = mix( body, ( uSiltTone * 1.3 + 0.06 ) * daylight * 0.8, silted );
      hides = max( hides, silted * 0.97 );
    }
    // What it mirrors, blurred by the roughness (the land's map and the sky's art each so many points a radian): the land
    // the line off the water meets, and the sky past it.
    vec4 land = landAlong( back, log2( max( 1.0, spread * ${(WATER_REFLECTION.columns / (2 * Math.PI)).toFixed(1)} ) ) );
    vec3 mirrored = skyAlong( back, log2( max( 1.0, spread * 700.0 ) ) ) * ( 1.0 - land.a ) + land.rgb;
    /*
      The sun's glint (Cox and Munk): the share of the water's facets, too small to draw, that are tipped to send the
      sun to the eye, by how the slopes about this point's own spread (the roughness), times what such a facet sends back.
      Near, the waves themselves are drawn and the glints are sparks; far off they are a path. Where the hills or what
      stands round the water shade it, the sun's shadows take it away.
    */
    vec3 half_ = normalize( eye + uSun );
    vec2 off = vec2( - half_.x, half_.z ) / max( half_.y, 0.05 ) - slope;
    float sigma2 = 0.5 * rough;
    float facets = exp( - dot( off, off ) / ( 2.0 * sigma2 ) ) / ( 6.2831853 * sigma2 );
    float sends = 0.02 + 0.98 * pow( 1.0 - max( dot( eye, half_ ), 0.0 ), 5.0 );
    float glint = facets * sends / ( 4.0 * max( dot( eye, face ), ${glsl(WATER_GLINT.grazing)} ) * pow( max( dot( half_, face ), 0.05 ), 4.0 ) );
    vec3 sparkle = uSunGlint * min( glint, ${glsl(WATER_GLINT.most)} ) * sunLit;
    /*
      What the eye sees: what the surface mirrors, as much as it mirrors (\`glance\`), and of the rest the water's own
      light, as much as its depth hides of the bed, over the bed itself (what lies under, which the blend brings). How
      much of the bed the water hides is the water's own doing, whatever the weather: in the dark deep water is black,
      not clear. The bed's own colour through the water is the ground's to give (\`dressBed\`). A glint stands over all.
    */
    alpha = 1.0 - ( 1.0 - glance ) * ( 1.0 - hides );
    vec3 seen = mirrored * glance + ( 1.0 - glance ) * hides * body + sparkle;
    alpha = max( alpha, clamp( dot( sparkle, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 ) );
    color = seen / max( alpha, 1e-3 );
    // Foam where the water meets the shore, lapping in and out, as bright as the day: a lace, broken and thin, not a line.
    float lace = texture2D( uCloud, at / 40.0 + uTime * 0.004 ).a * 0.6 + texture2D( uCloud, at / 23.0 - uTime * 0.006 ).b * 0.4;
    float reach = 0.3 + 0.22 * sin( uTime * 0.7 + cloud.r * 9.0 );
    float foam = ( 1.0 - smoothstep( 0.0, reach, depth ) ) * smoothstep( 0.25, 0.6, cloud.b + 0.25 * sin( uTime * 1.3 + cloud.g * 12.0 ) )
      * smoothstep( 0.32, 0.62, lace ) * 0.8;
    /*
      And where the trucks have beaten it white. Fresh, it is whitewater all over; as it thins it breaks into clots and
      patches, ragged and full of bubbles, which cover as much of the water as there is foam left, heaped on the crests of
      the wake's own waves; thinner still, a lace that lingers.
    */
    float clots = 0.5, bubbles = 0.5;
    if ( churned > 0.004 ) {
      // Clots a few feet across, and in them bubbles a few inches across: the noise's broad and fine fields, read once.
      vec2 froth = texture2D( uCloud, at / 9.0 - uTime * vec2( 0.006, 0.009 ) + stirred.r * 0.06 ).ba;
      clots = froth.x;
      bubbles = froth.y;
      // (The noise lies close about a half: spread to cover from nothing to all.)
      float patch_ = clamp( 0.5 + 2.6 * ( 0.65 * ( clots - 0.5 ) + 0.35 * ( bubbles - 0.5 ) ) + 0.35 * clamp( stirred.r, - 0.5, 0.5 ), 0.0, 1.0 );
      float white = smoothstep( 0.92 - churned, 1.08 - churned, patch_ );
      float lacework = smoothstep( 0.25, 0.55, churned * ( 0.2 + 1.8 * lace ) ) * smoothstep( 0.02, 0.12, churned );
      foam = max( foam, max( white * 0.95, lacework * 0.8 ) );
    }
    // White, as bright as the day lights it: greyer in the hollows between the clots and between the bubbles.
    color = mix( color, vec3( 0.9, 0.93, 0.95 ) * daylight * ( 0.76 + 0.16 * clots + 0.12 * bubbles ), foam * 0.94 );
    alpha = max( alpha, foam * 0.94 ) * smoothstep( - 0.02, 0.1, depth );
  }
${FINISH}
}`;

/*
  The ground under the water, added to the terrain's own material. The light that reaches the bed has passed through
  the water over it and lost its red on the way; in the shallows it dances, drawn together and apart by the waves; and
  the ground just over the waterline is wet. Under ice the light is still.
*/
const BED_VERTEX_PARS = "varying vec3 vBedWorld;";
const BED_VERTEX = "\tvBedWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;";
const BED_PARS = /* glsl */ `
varying vec3 vBedWorld;
// (cameraPosition is three.js's own)
// the water's level now, the clock, 1 where the water is open (0 frozen), unused
uniform vec4 uBed;
uniform sampler2D uBedWaves;
`;
const BED = /* glsl */ `
  {
    float bedDeep = uBed.x - vBedWorld.y;
    if ( bedDeep > - ${WATER_BED.wetShoreFt.toFixed(2)} ) {
      float bedUnder = smoothstep( 0.0, 0.3, bedDeep );
      // Wet from the water, just over the waterline.
      diffuseColor.rgb *= 1.0 - ${WATER_BED.wetShore.toFixed(2)} * smoothstep( - ${WATER_BED.wetShoreFt.toFixed(2)}, 0.0, bedDeep ) * mix( 1.0, 0.5, bedUnder );
      // Light dancing on the bed where the water is shallow.
      vec2 bedAt = vec2( vBedWorld.x, - vBedWorld.z );
      float bedLace = texture2D( uBedWaves, bedAt / 9.0 + uBed.y * vec2( 0.031, 0.017 ) ).b * texture2D( uBedWaves, bedAt / 6.1 - uBed.y * vec2( 0.019, 0.027 ) ).b;
      float bedDance = 1.0 + ${WATER_BED.caustics.toFixed(2)} * ( smoothstep( 0.2, 0.34, bedLace ) * 2.0 - 0.8 ) * uBed.z * ( 1.0 - smoothstep( 0.0, ${WATER_BED.causticsToFt.toFixed(1)}, bedDeep ) );
      // The light that reaches it has come down through the water over it.
      vec3 bedTakes = vec3( ${WATER_TAKES.map((v) => v.toFixed(4)).join(", ")} );
      vec3 bedLit = exp( - bedTakes * max( bedDeep, 0.0 ) ) * bedDance;
      // And what comes back up from it to an eye over the water passes through the water on the eye's line, bent toward the
      // upright at the surface: the water's own opacity takes how much of it (render/water-surface.js), and this the
      // colour that leaves, red the first to go.
      if ( cameraPosition.y > uBed.x ) {
        float bedSine = clamp( normalize( cameraPosition - vBedWorld ).y, 0.0, 1.0 );
        vec3 bedUp = exp( - bedTakes * max( bedDeep, 0.0 ) / sqrt( 1.0 - ( 1.0 - bedSine * bedSine ) / ${(WATER_INDEX * WATER_INDEX).toFixed(4)} ) );
        bedLit *= bedUp / max( dot( bedUp, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 );
      }
      diffuseColor.rgb *= mix( vec3( 1.0 ), bedLit, bedUnder );
    }
  }
`;

/**
 * @param {{ world: THREE.Object3D, groundTexture?: { texture: THREE.Texture, referenceFt: number }|null,
 *   lights?: { sun?: THREE.Light|null, ambient?: THREE.Light|null, hemisphere?: THREE.Light|null } }} options
 *   `world` is the track (its "water" meshes, one a copy of the world, take the new material,
 *   and its ground is dressed as the water's bed); `groundTexture` the map of the ground
 *   (render/ground-textures.js), without which the water is everywhere deep; `lights` the
 *   scene's own, whose light the water sends back; `ripples` the field of waves the trucks stir
 *   (render/water-ripples.js), which the water is told its level and its ice each frame.
 * @returns the water, or null where the level has none
 */
export function createWaterSystem({ world, groundTexture = null, lights = {}, ripples = null, reflection = null, groundTone = [0.2, 0.16, 0.12] }) {
  const meshes = [];
  let level = null;
  world.traverse((object) => { if (object.name === "water") { meshes.push(object); level ??= object.userData.levelFt ?? null; } });
  if (!meshes.length) return null;
  // The marks the trucks leave in the ice, which the graphics card reads as two small pictures of numbers.
  const ice = createIceMarks();
  const uniforms = {
    // The scene's lights, for the sun's shadow maps (`sunReaches`).
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    ...atmosphereUniforms(),
    uSunShare: { value: 0 },
    uTime: { value: 0 }, uLight: { value: 1 }, uSnow: { value: 0 }, uRain: { value: 0 }, uDark: { value: 0 }, uSkyVeil: { value: 0 },
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
    uDaylight: { value: new THREE.Color(1, 1, 1) }, uScatter: { value: new THREE.Color(...WATER_SCATTER) },
    uSkyOn: { value: 0 }, uSky: { value: null }, uSkyCap: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() }, uFogRange: { value: new THREE.Vector3() },
    uGround: { value: groundTexture?.texture ?? null }, uGroundAt: { value: new THREE.Vector3(groundTexture?.referenceFt ?? 0, 1 / 8192, groundTexture ? 1 : 0) },
    uCloud: { value: cloudNoise() },
    uWaveField: { value: waveFieldTexture() }, uWaveWays: { value: WATER_WAVE_LAYOUT.sizesFt.map(() => new THREE.Vector3()) },
    uWaveLoop: { value: new THREE.Vector4() }, uWaveGain: { value: new THREE.Vector4() }, uWaveRough: { value: 0 }, uGustAt: { value: new THREE.Vector3(0, 0, 1 / WATER_WAVE_LAYOUT.gustFt) },
    uSunGlint: { value: new THREE.Color() }, uSiltTone: { value: new THREE.Color(...groundTone) },
    uIceMarks: { value: dataTexture(ice.marks, ICE_MARKS.perRow * 2, ICE_MARKS.kept / ICE_MARKS.perRow) },
    uIceGrid: { value: dataTexture(ice.grid, (ICE_MARKS.cells * ICE_MARKS.perCell) / 4, ICE_MARKS.cells) },
    // The ripples and wakes the trucks stir (render/water-ripples.js), where they run.
    ...(ripples?.uniforms ?? { uRipples: { value: null }, uRippleAt: { value: new THREE.Vector4() } }),
    // The land in the water (render/water-reflection.js).
    ...(reflection?.uniforms ?? { uLand: { value: null }, uLandOn: { value: 0 } }),
  };
  // The open water and the ice, two programs over the one set of uniforms: the planes wear one or the other.
  const made = (fragmentShader) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, lights: true });
  const material = made(WATER_FRAGMENT), iceMaterial = made(ICE_FRAGMENT);
  let worn = material;
  const replaced = new Set();
  // The water takes the shadows of the hills and of what stands round it; it casts none.
  for (const mesh of meshes) { replaced.add(mesh.material); mesh.material = material; mesh.receiveShadow = true; mesh.castShadow = false; }
  for (const old of replaced) old.dispose();
  // The ground as the water's bed.
  const bed = { uBed: { value: new THREE.Vector4(level ?? -1e6, 0, 1, 0) }, uBedWaves: { value: waveNoise() } };
  const dressed = new Set();
  function dressBed(ground) {
    if (!ground || dressed.has(ground)) return ground;
    dressed.add(ground);
    // After the ground's own detail (which replaces three.js's read of the map) and before the weather on it.
    return addShaderHook(ground, "water-bed", 25, (shader) => {
      Object.assign(shader.uniforms, bed);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${BED_VERTEX_PARS}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${BED_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${BED_PARS}`)
        .replace("#include <color_fragment>", `${BED}\n#include <color_fragment>`);
    });
  }
  world.traverse((object) => { if (object.name === "terrain" && object.material) dressBed(object.material); });
  const daylight = new THREE.Color(), part = new THREE.Color(), eyeAt = new THREE.Vector3();
  /** The sun's light as it comes down into the water, where the weather shows the sun clearly (render/underwater.js). */
  const shafting = new THREE.Color();
  /** The light on the land the water mirrors (render/water-reflection.js), worked out with the water's own. */
  const landLight = { sun: uniforms.uSun.value, sunLight: new THREE.Color(), skyLight: new THREE.Color(), horizon: uniforms.uHorizon.value, fade: [0, 0], haze: 0 };
  let levelNow = level, frozenNow = false;

  let clock = 0, bobClock = 0, snowSeconds = 0, snowStart = 0, begun = false, wasFrozen = false, gustAt = 0;
  const waveLoop = [0, 0, 0, 0];
  // Each size's way on the map: the wind's, turned by its own amount; and 1 / its size.
  WATER_WAVE_LAYOUT.sizesFt.forEach((size, i) => {
    const turn = WATER_WAVE_LAYOUT.turns[i], [wx, wz] = WATER_WAVE_LAYOUT.windWay, length = Math.hypot(wx, wz);
    uniforms.uWaveWays.value[i].set((wx * Math.cos(turn) - wz * Math.sin(turn)) / length, (wx * Math.sin(turn) + wz * Math.cos(turn)) / length, 1 / size);
  });
  const display = new THREE.Color();
  return {
    /**
     * Once a frame. `env`: `sun` the scene's sun (its position is the way to it), `light` the
     * weather's brightness, `sky` the sky dome or null, `fog` the scene's fog or null,
     * `background` the sky's colour, `levelFt` the water's level now, bob and all.
     */
    update(dt, weather, { sun = null, light = 1, sky = null, fog = null, background = null, levelFt = null } = {}) {
      const look = WEATHER_LOOK[weather] ?? WEATHER_LOOK[0], frozen = weather === SNOW;
      // The game holds the water still in Snow; so are the waves, and the bob.
      if (!frozen) clock = (clock + dt) % CLOCK_SECONDS;
      bobClock += dt;
      // A race that begins in Snow has some of it down already; snow that comes on later starts from nothing (game/atmosphere.js).
      if (frozen && !wasFrozen) { snowSeconds = 0; snowStart = begun ? 0 : SNOW_START; }
      snowSeconds = frozen ? snowSeconds + dt : 0;
      wasFrozen = frozen;
      begun = true;
      uniforms.uTime.value = clock;
      uniforms.uLight.value = light;
      // A change of weather builds the shaders it needs (render/weather-scene.js `warmPools`); so does this.
      if (worn !== (frozen ? iceMaterial : material)) {
        worn = frozen ? iceMaterial : material;
        for (const mesh of meshes) mesh.material = worn;
      }
      // The marks the ice has taken, each star as far as its cracks have run; a thaw heals them.
      if (!frozen && ice.count) ice.clear();
      const changed = ice.update(dt);
      if (changed.marks) uniforms.uIceMarks.value.needsUpdate = true;
      if (changed.grid) uniforms.uIceGrid.value.needsUpdate = true;
      uniforms.uSnow.value = frozen ? snowDown(snowSeconds, snowStart) * ICE_SNOW_SHARE : 0;
      uniforms.uRain.value = weather === RAIN ? 1 : 0;
      // The waves: each size through its loop, the gusts running on with the wind (game/water-waves.js).
      const wind = WATER_WAVE_LAYOUT.weather[weather] ?? 1, [wx, wz] = WATER_WAVE_LAYOUT.windWay;
      if (!frozen) {
        WATER_WAVE_LAYOUT.sizesFt.forEach((size, i) => { waveLoop[i] = (waveLoop[i] + dt / waveLoopSeconds(size)) % 1; });
        gustAt = (gustAt + dt * WATER_WAVE_LAYOUT.gustFtPerS) % WATER_WAVE_LAYOUT.gustFt;
      }
      uniforms.uWaveLoop.value.fromArray(waveLoop);
      uniforms.uGustAt.value.set(wx * gustAt, wz * gustAt, 1 / WATER_WAVE_LAYOUT.gustFt);
      uniforms.uWaveGain.value.fromArray(WATER_WAVE_LAYOUT.gains).multiplyScalar(wind);
      uniforms.uWaveRough.value = WATER_WAVE_LAYOUT.roughness * wind * wind;
      if (sun) uniforms.uSun.value.copy(sun.position).normalize();
      // The light that falls on the water: the sky's from all round, and the sun's by how high it stands. With the
      // scene's own lights it has their colours (dim orange at Dusk, the moon's blue at Night); without, the weather's white.
      const { sun: sunLight = sun, ambient = null, hemisphere = null } = lights;
      daylight.setScalar(0);
      if (ambient) daylight.add(part.copy(ambient.color).multiplyScalar(ambient.intensity / Math.PI));
      if (hemisphere) daylight.add(part.copy(hemisphere.color).multiplyScalar(hemisphere.intensity / Math.PI));
      const height = Math.max(0, uniforms.uSun.value.y);
      uniforms.uSunShare.value = 0;
      landLight.skyLight.copy(daylight);
      landLight.sunLight.setScalar(0);
      if (sunLight?.isLight) {
        landLight.sunLight.copy(sunLight.color).multiplyScalar(sunLight.intensity / Math.PI);
        const sky = luminance(daylight);
        daylight.add(part.copy(sunLight.color).multiplyScalar((sunLight.intensity / Math.PI) * height));
        // What a shadow takes: the sun's part of it.
        uniforms.uSunShare.value = 1 - sky / Math.max(luminance(daylight), 1e-6);
        uniforms.uSunColor.value.copy(sunLight.color).multiplyScalar(Math.min(1.6, sunLight.intensity * 0.42) * (frozen ? 1 : look.sun > 0 ? 1 : 0));
        // The glint is the sun itself, mirrored: all its light, where the weather shows it.
        uniforms.uSunGlint.value.copy(sunLight.color).multiplyScalar(sunLight.intensity * (look.sun > 0 ? 1 : 0));
      } else {
        daylight.setScalar(light);
        landLight.skyLight.setScalar(light);
        uniforms.uSunColor.value.setScalar(look.sun * light * 1.4);
        uniforms.uSunGlint.value.setScalar(look.sun * light * 3);
      }
      uniforms.uDaylight.value.copy(daylight);
      // Stirred and silted in Rain.
      uniforms.uScatter.value.setRGB(...WATER_SCATTER).lerp(part.setRGB(...WATER_SILT_TONE), weather === RAIN ? WATER_SILT : 0);
      // The sun's light coming down into the water, for its shafts there: only where the weather shows the sun clearly,
      // and none through ice.
      const clear = Math.min(1, Math.max(0, (look.sun - 0.45) / 0.45));
      shafting.copy(uniforms.uSunGlint.value).multiplyScalar(frozen ? 0 : clear * clear * (3 - 2 * clear));
      bed.uBed.value.set(levelFt ?? level ?? -1e6, clock, frozen ? 0 : 1, 0);
      levelNow = levelFt ?? level;
      frozenNow = frozen;
      ripples?.lake(levelFt ?? level, frozen);
      mirrorSky({ on: uniforms.uSkyOn, map: uniforms.uSky, cap: uniforms.uSkyCap, horizon: uniforms.uHorizon, dark: uniforms.uDark }, { sky, fog, background, light, weather });
      // Fog is mixed in after the colours are encoded for where they are going, so its colour is encoded the same way.
      if (fog?.isFog) {
        screenColor(fog.color, display);
        uniforms.uFogColor.value.copy(display);
        uniforms.uFogRange.value.set(fog.near, fog.far, 1);
      } else uniforms.uFogRange.value.set(0, 1, 0);
      // The haze on the land in the water: the fog's, or the classic fog's ramp, or none.
      const haze = atmosphere.haze();
      if (haze) { landLight.fade[0] = haze.fadeStartFt; landLight.fade[1] = haze.farFt; landLight.haze = haze.densityPerFt; }
      else if (fog?.isFog) { landLight.fade[0] = fog.near; landLight.fade[1] = fog.far; landLight.haze = 0; }
      else { landLight.fade[0] = 9000; landLight.fade[1] = 10000; landLight.haze = 0; }
    },
    /**
     * The ice was struck at game (x, z) by something coming down at `speedFtPerS`: it stars
     * there (game/ice.js). Returns the star's reach in feet, 0 for a blow too light to crack it.
     */
    strike(x, z, speedFtPerS, random = Math.random) {
      return wasFrozen ? ice.strike(x, z, speedFtPerS, random()) : 0;
    },
    /**
     * A truck's body is dragged over the ice: `points` are those of it down on the ice this frame, game `[x, z]` each,
     * and `chain` the body's own (an object, `{}` to begin). It scores a band as it goes (game/ice.js `ICE_SCRAPES`);
     * with no points, or no ice, the band ends.
     */
    drag(chain, points, random = Math.random) {
      if (wasFrozen) ice.drag(chain, points, random());
      else ice.lift(chain);
    },
    /** The water's level above its resting one now, feet: the game's bob (frozen in Snow). */
    offsetFt: (weather) => waterOffsetFt(bobClock, weather),
    /** Dress one more ground material as the water's bed (the lit twin of the classic look's, render/weather-scene.js). */
    dressBed,
    /** The colour of the water seen from inside it, as the scene's fog has it under water: what the depth sends back of the light that is. */
    underColor: (target = new THREE.Color()) => target.copy(uniforms.uScatter.value).multiply(uniforms.uDaylight.value).multiplyScalar(6.6),
    /**
     * The light under the water, for what is drawn in it (render/underwater.js), kept up to date each frame: `way` to the
     * sun (scene axes), `sun` its light coming down into the water (none where the weather hides it), `daylight` the light
     * on the water, `scatter` the water's own colour.
     */
    under: { way: uniforms.uSun.value, sun: shafting, daylight: uniforms.uDaylight.value, scatter: uniforms.uScatter.value },
    /** Before a frame is drawn with `view`: how deep the fog over the eye lies, for the sky in the water. */
    prepare(view) {
      view.getWorldPosition(eyeAt);
      uniforms.uSkyVeil.value = atmosphere.skyVeil(eyeAt.y);
      // The land in the water, but not from under it, nor on ice.
      reflection?.render(eyeAt, frozenNow ? null : levelNow, landLight);
    },
    dispose() {
      material.dispose();
      iceMaterial.dispose();
      uniforms.uIceMarks.value.dispose();
      uniforms.uIceGrid.value.dispose();
      dressed.clear();
    },
  };
}
