/*
  The ground in the weather (docs/VISUALS.md, "Rain" and "Snow"): wet and puddled in Rain,
  under snow in Snow. Both are drawn by the terrain's own material, which is given a few more
  lines of shader, so the ground keeps its textures, its light and its shadows.

  Rain ("Rain puddles"). The ground darkens as it gets wet and takes a sheen at a low angle.
  Water stands where the puddle map says the ground has a low point (game/ground-maps.js): the
  map holds how far each place lies under or over its pool's surface, so the waterline falls
  where it should between samples, and a little noise frays it. A puddle is muddy water over
  soaked ground. It mirrors the sky the level's water mirrors (render/water-common.js), as much
  as water does at the angle it is seen, ruffled by the rain and, close to the eye, ringed by its
  drops; under that the ground is darker, and the deeper the water the more its silt hides it.
  Its bank is soaked darker still. The waves the trucks stir (render/water-ripples.js) lift and
  lower it: a wheel parts it down to its bed and the water runs back in behind, and what a wheel
  churns clouds it and leaves a scum of froth. On a lit ground what is mirrored is worked out
  before the light, as light the ground gives off, so that little is kept across the lighting.

  Snow ("Snow cover"). Snow has a depth (game/snow-cover.js): deep on level ground, thinning
  as the ground steepens, thin along the course. In a race that begins in Snow the terrain's
  mesh carries that depth on every vertex and the ground is lifted by it as the snow settles
  (game/atmosphere.js), so the snow has thickness: a truck's tires sink into it off the course,
  and the road runs between its banks. How white the ground is follows the same depth: a thin
  fall lets the ground show through in patches, a deep one hides it. Snow that comes on during
  a race (GOLD mode) has no depth in the mesh and lies flat, by the ground's slope alone; so
  does the snow on the tops of ground boxes, kept thin where the course runs over them.

  Where the snow ends. The depth is known at the mesh's points, and between them it runs in
  straight lines, so a snow line drawn where the depth reaches nothing would follow the mesh's
  cells. How deep snow must lie before it shows varies from place to place instead
  (game/snow-cover.js `SNOW_LINE`), by noise that knows nothing of the mesh: the line wanders
  across the band where the snow thins, leaves islands ahead of itself and bare patches behind,
  and its edge is frayed. The ground just clear of it is damp and darker. The snow itself has
  hollows and wind-packed ridges, lit by the sun where there is one, and close to the eye its
  crystals glint.
*/
import * as THREE from "three";
import { POOL_LOOK, SNOW_START, WET, groundWetness, puddlesFilled, snowDown } from "../game/atmosphere.js";
import { PUDDLE_RANGE_FT, PUDDLE_WATERLINE, puddleDepthAt } from "../game/ground-maps.js";
import { SNOW_BARE_SLOPE, SNOW_DEPTH_SCALE_FT, SNOW_HOLD_SLOPE, SNOW_LINE, SNOW_MAX_FT } from "../game/snow-cover.js";
import { PUDDLE_FILL_DROP_FT, WATER_RIPPLES } from "../game/water.js";
import { WEATHER_LOOK } from "../game/weather.js";
import { atmosphere } from "./atmosphere.js";
import { SHARED_NOISE_GLSL, sharedNoiseUniforms } from "./noise-textures.js";
import { addShaderHook } from "./shader-hooks.js";
import { RAIN_RINGS_GLSL, mirrorSky, skyAlongGlsl } from "./water-common.js";

const RAIN = 4, SNOW = 5;
/** When the weather turns, the ground dries and the snow goes over this long, seconds. */
const DRY_SECONDS = 45, MELT_SECONDS = 12;
/** A puddle not yet full stands this far below its full level, feet. */
const FILL_DROP_FT = PUDDLE_FILL_DROP_FT;
/** The ground is soaked up the bank of a puddle until it stands this far over the water, feet. */
const POOL_RIM_FT = 0.025;
/** A wave can lift a puddle's water this far up its bank at the most, feet: no further from it is the field read. */
const LIFT_REACH_FT = 0.12;
/**
 * The rain's rings on a puddle (render/water-common.js): drawn `scale` times as fine as the lake's, so half their size, and
 * tipping its face `slope` as far; whole where a pixel spans `sharpFt` of the ground or less, gone where it spans `goneFt`.
 */
const POOL_RINGS = Object.freeze({ scale: 2, slope: 0.5, sharpFt: 0.025, goneFt: 0.08 });
const glsl = (n) => n.toFixed(5);

const VERTEX_PARS = /* glsl */ `
varying vec3 vGfxWorld;
varying vec3 vGfxUp;
#ifdef GFX_SNOW_VOLUME
  attribute float snowDepth;
  uniform vec4 uGfx;
  varying float vGfxSnow;
#endif
#ifdef GFX_SNOW_SHARE
  // how much of the open ground's snow lies here: a ground box's top along the course is as thin as the road
  attribute float snowShare;
  varying float vGfxShare;
#endif
`;
/* The snow's depth lifts the ground, by as much of it as is down. */
const VERTEX_LIFT = /* glsl */ `
#ifdef GFX_SNOW_VOLUME
  vGfxSnow = snowDepth * ${glsl(SNOW_DEPTH_SCALE_FT)};
  transformed.y += vGfxSnow * uGfx.z;
#endif
`;
const VERTEX = "\tvGfxWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvGfxUp = normalize( mat3( modelMatrix ) * normal );\n#ifdef GFX_SNOW_SHARE\n\tvGfxShare = snowShare;\n#endif";

/* What the ground's weather is read from, by the ground and by what lies on it: declared once, whoever asks. */
const BASE_GLSL = /* glsl */ `
#ifndef GFX_BASE
#define GFX_BASE
// wet 0 to 1, puddles filled 0 to 1, snow down 0 to 1, seconds
uniform vec4 uGfx;
// The noises the rest of the ground reads too, in the samplers they share (render/noise-textures.js).
${SHARED_NOISE_GLSL}
#define uGfxNoise mtmCloudNoise
#endif
`;
/*
  Where water stands, for the ground and for what lies on it (render/tire-tracks.js), which take the same uniforms
  (`pools.uniforms`).
*/
const POOL_GLSL = /* glsl */ `
${BASE_GLSL}
uniform sampler2D uGfxPuddles;
uniform float uGfxPuddleSide;
// The puddle map read through a cubic kernel (four smoothed reads): between its samples, 8 ft apart, a straight
// blend would give every small puddle the corners of the samples' grid.
float gfxPuddleDepth( vec2 uv ) {
  vec2 st = uv * uGfxPuddleSide - 0.5;
  vec2 f = fract( st ), cell = floor( st );
  vec2 w0 = ( 1.0 - f ) * ( 1.0 - f ) * ( 1.0 - f ) / 6.0, w3 = f * f * f / 6.0;
  vec2 w1 = ( 3.0 * f * f * f - 6.0 * f * f + 4.0 ) / 6.0, w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 a = ( cell + w1 / g0 - 0.5 ) / uGfxPuddleSide, b = ( cell + w3 / g1 + 1.5 ) / uGfxPuddleSide;
  return g0.y * ( g0.x * texture2D( uGfxPuddles, a ).r + g1.x * texture2D( uGfxPuddles, vec2( b.x, a.y ) ).r )
    + g1.y * ( g0.x * texture2D( uGfxPuddles, vec2( a.x, b.y ) ).r + g1.x * texture2D( uGfxPuddles, b ).r );
}
// The puddle map at game (x, z) \`at\`, as its bytes have it (0 to 1): x the ground's depth under its pool's surface, y
// the waterline there now (the map's, lower while the puddles are filling, frayed by a little noise).
vec2 gfxPoolRest( vec2 at ) {
  float line = ${glsl(PUDDLE_WATERLINE / 255)} + ( 1.0 - uGfx.y ) * ${glsl((FILL_DROP_FT / PUDDLE_RANGE_FT) * (127 / 255))}
    + ( texture2D( uGfxNoise, at / 41.0 ).b - 0.5 ) * 0.03 + ( texture2D( uGfxNoise, at / 9.0 ).a - 0.5 ) * 0.02 - 0.012;
  return vec2( gfxPuddleDepth( at / 8192.0 ), line );
}
// The water standing over \`rest\` (\`gfxPoolRest\`), its face lifted \`liftFt\` by the waves the trucks stir: x how much of
// the point a puddle covers (0 to 1), y how deep it is there (feet), z how soaked the ground is by the puddle at rest (1
// under it and at its waterline, 0 a little way up the bank: ground a wave has just bared is as soaked as ever).
vec3 gfxPoolLifted( vec2 rest, float liftFt ) {
  float depth = rest.x + liftFt * ${glsl((127 / 255) / PUDDLE_RANGE_FT)};
  return vec3( smoothstep( rest.y - 0.003, rest.y + 0.01, depth ), max( depth - rest.y, 0.0 ) * ${glsl((255 / 127) * PUDDLE_RANGE_FT)},
    smoothstep( rest.y - ${glsl(POOL_RIM_FT * (127 / 255) / PUDDLE_RANGE_FT)}, rest.y, rest.x ) );
}
// The water standing at game (x, z) \`at\` now, at rest: how much of the point a puddle covers, and how deep it is (feet).
vec2 gfxPoolAt( vec2 at ) {
  if ( uGfx.y <= 0.0 ) return vec2( 0.0 );
  return gfxPoolLifted( gfxPoolRest( at ), 0.0 ).xy;
}
`;

/*
  Where the snow shows, for the ground and for what lies on it (render/tire-tracks.js: a rut ploughed in snow is drawn
  only where the ground under it is drawn as snow), which take the same uniforms (`snowLine.uniforms`).
*/
const SNOW_LINE_GLSL = /* glsl */ `
${BASE_GLSL}
// How much of the ground at game (x, z) \`at\` the snow covers, 0 to 1 (x), and how far over the depth it must have to
// show its settled depth is, feet (y). \`deep\` is how deep it lies there now, feet; \`grain\` and \`patch_\` are the
// ground's noise there, read at 41 ft and at 430 ft to the repeat.
vec2 gfxSnowShown( vec2 at, float deep, vec4 grain, vec4 patch_ ) {
  // The snow line: how deep the snow must lie before it shows wanders from place to place, by noise that knows nothing
  // of the mesh the depth came from, and its edge is frayed.
  float need = mix( ${glsl(SNOW_LINE.showsFromFt)}, ${glsl(SNOW_LINE.showsToFt)}, smoothstep( 0.3, 0.7, texture2D( uGfxNoise, at / ${glsl(SNOW_LINE.wanderFt)} ).r * 0.55 + patch_.g * 0.2 + grain.b * 0.25 ) );
  // Taken against the snow's depth once it has all settled, so the line stays where it is while the snow deepens;
  // only the first tenth of a fall creeps out from where it will lie deepest.
  float fray = texture2D( uGfxNoise, at / ${glsl(SNOW_LINE.frayFt)} ).b;
  float over = deep / max( uGfx.z, ${glsl(SNOW_LINE.creepsUntil)} ) - need + ( fray - 0.5 ) * ${glsl(SNOW_LINE.frayDepthFt)};
  // Snow does not end at a line. Short of showing in full it lies thin: first as specks in the ground's hollows,
  // then as a broken sheet the ground shows through, then whole.
  float thin = smoothstep( - ${glsl(SNOW_LINE.softDepthFt)}, ${glsl(SNOW_LINE.softDepthFt * 0.4)}, over );
  float speck = smoothstep( 0.3, 0.7, grain.a * 0.6 + fray * 0.4 + ( thin - 0.5 ) * 1.1 );
  return vec2( thin * mix( speck, 1.0, thin * thin ), over );
}
`;

/*
  What wet ground and standing water mirror, and what glints in the snow: worked out the same for a ground that is lit,
  which adds them to its own light as light it gave off (`ALBEDO`), and for one that is not, which lays them over what it
  draws (`SHINE`).
*/
const MIRROR_GLSL = /* glsl */ `
#ifdef GFX_WET
// What wet ground and a puddle mirror at game (x, z) \`at\`, seen from the eye: rgb the light they send it, a how much of
// what the eye sees there that is (the rest is the ground's own light, seen through the water). \`wet\`, \`pool\` and
// \`snow\` as the ground has them, \`level\` how level it is, \`froth\` how much of the water muddy froth covers. Called where
// every pixel calls it, for the sake of the derivatives.
vec4 gfxMirror( vec2 at, float wet, float pool, float snow, float level, float froth ) {
  // How much ground one pixel spans here, feet: what is finer than that cannot be drawn.
  float span = length( fwidth( at ) );
  if ( wet <= 0.0 ) return vec4( 0.0 );
  vec3 eye = normalize( cameraPosition - vGfxWorld );
  // How the water's face slopes here, along the map's x and z. Rain on standing water: its surface is never still. The
  // rain ruffles it, and close to the eye each drop's ring shows (render/water-common.js), at half the lake's size, since
  // a puddle is seen nearer; further off, where a pixel spans more than a ring, they would only shimmer.
  vec2 slope = ( ( texture2D( uGfxNoise, at / 4.3 + uGfx.w * vec2( 0.37, 0.19 ) ).rg - 0.5 )
    + ( texture2D( uGfxNoise, at / 1.9 - uGfx.w * vec2( 0.23, 0.43 ) ).ba - 0.5 ) ) * 0.16;
  float rings = pool * uGfxRain * ( 1.0 - smoothstep( ${glsl(POOL_RINGS.sharpFt)}, ${glsl(POOL_RINGS.goneFt)}, span ) );
  if ( rings > 0.0 ) slope += mtmRainRings( at * ${glsl(POOL_RINGS.scale)}, uGfx.w ) * ( ${glsl(POOL_RINGS.slope)} * rings );
  #ifdef GFX_RIPPLES
    // In a puddle, the wakes and rings the trucks stir.
    vec2 uv = ( at - uRippleAt.xy ) * uRippleAt.z;
    if ( pool > 0.0 && uRippleAt.w > 0.5 && all( greaterThan( uv, vec2( 0.0 ) ) ) && all( lessThan( uv, vec2( 1.0 ) ) ) ) {
      vec2 edge = min( uv, 1.0 - uv ), texel = vec2( ${(1 / WATER_RIPPLES.windowTexels).toFixed(6)}, 0.0 );
      slope += vec2(
        texture2D( uRipples, uv + texel.xy ).r - texture2D( uRipples, uv - texel.xy ).r,
        texture2D( uRipples, uv + texel.yx ).r - texture2D( uRipples, uv - texel.yx ).r ) * ( ${(4 / (2 * WATER_RIPPLES.texelFt)).toFixed(4)} * smoothstep( 0.0, 0.1, min( edge.x, edge.y ) ) );
    }
  #endif
  // The scene mirrors z, so a slope along the map's second axis leans the other way.
  vec3 face = normalize( vec3( - slope.x, 1.0, slope.y ) ), back = reflect( - eye, face );
  // A puddle mirrors the sky, as much as water does at this angle (Schlick's, from 2% seen straight on), but where froth
  // covers it. A ray tipped under the horizon by a ripple meets what stands there, as the horizon has it.
  float shine = pool * ( 1.0 - froth ) * ( 0.02 + 0.98 * pow( clamp( 1.0 - dot( eye, face ), 0.0, 1.0 ), 5.0 ) );
  vec3 sky = shine > 0.0 ? gfxSkyAlong( vec3( back.x, max( back.y, 0.0 ), back.z ), 2.0 + 2.0 * uGfxRain ) : vec3( 0.0 );
  // Wet ground that holds no pool has a film of water on it, which mirrors the sky a very little from above and somewhat
  // at a low angle, unevenly, as the ground under it is uneven. It is a sheen on the ground and never hides what the
  // ground is: a track's textures must read through it as they do when dry. So slight a mirror shows the sky's two
  // colours, its horizon and its top, and no more of it, as dim as the weather's light.
  float film = clamp( wet * ( 1.0 - pool ) * ( 1.0 - snow ) * level * ( ${glsl(WET.sheen)} + ${glsl(WET.sheenLow - WET.sheen)} * pow( clamp( 1.0 - eye.y, 0.0, 1.0 ), 4.0 ) )
    * ( 0.5 + texture2D( uGfxNoise, at / 41.0 ).a ), 0.0, ${glsl(WET.sheenMost)} );
  vec3 sheen = mix( uGfxHorizon, uGfxSkyCap, smoothstep( 0.0, 0.55, back.y ) ) * ( uGfxSkyOn > 0.5 ? uGfxLight : 1.0 );
  // The film over the puddle's mirror (only at its edge are both).
  return vec4( sky * shine * ( 1.0 - film ) + sheen * film, 1.0 - ( 1.0 - shine ) * ( 1.0 - film ) );
}
#endif
// Crystals of snow close to the eye glint at game (x, z) \`at\`, where \`snow\` covers the ground: a fine field of points,
// each catching the light from one way only, so they come and go as the eye moves. Far off the field runs together and
// there are none. The light they send the eye.
vec3 gfxGlints( vec2 at, float snow ) {
  if ( snow <= 0.0 ) return vec3( 0.0 );
  vec3 seen = normalize( cameraPosition - vGfxWorld );
  float crystal = texture2D( uGfxNoise, at / 1.3 + seen.xz * 0.21 ).a * texture2D( uGfxNoise, at / 0.47 - seen.zx * 0.33 ).a;
  return snow * smoothstep( 0.36, 0.46, crystal ) * uGfxLight * ( 0.25 + 2.2 * uGfxSun.w ) * vec3( 1.0, 0.98, 0.95 );
}
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vGfxWorld;
varying vec3 vGfxUp;
#ifdef GFX_SNOW_VOLUME
  varying float vGfxSnow;
#endif
#ifdef GFX_SNOW_SHARE
  varying float vGfxShare;
#endif
${POOL_GLSL}
${SNOW_LINE_GLSL}
uniform float uGfxLight;
#define uGfxRelief mtmDetailNoise
#ifdef GFX_WET
  // What wet ground and puddles mirror (render/water-common.js): the sky's picture and the colour over its top, what veils
  // it toward the horizon, whether there is a sky to show, how dark the weather makes its horizon, how deep the fog over
  // the eye lies; and whether it is raining, which rings the puddles.
  uniform sampler2D uGfxSkyMap;
  uniform vec3 uGfxSkyCap, uGfxHorizon;
  uniform float uGfxSkyOn, uGfxDark, uGfxSkyVeil, uGfxRain;
  ${skyAlongGlsl("gfxSkyAlong", { on: "uGfxSkyOn", map: "uGfxSkyMap", cap: "uGfxSkyCap", horizon: "uGfxHorizon", dark: "uGfxDark", veil: "uGfxSkyVeil" })}
  ${RAIN_RINGS_GLSL}
  // the ground's own colour, taken broadly: the colour of the silt that muddies a puddle
  uniform vec3 uGfxMud;
#endif
#ifdef GFX_SHELTER
  // where the ground lies under cover (a bridge, a tunnel): neither rain nor snow falls there
  uniform sampler2D uGfxShelter;
#endif
#ifdef GFX_RIPPLES
  // the waves the trucks stir (render/water-ripples.js): the field, its corner on the map (feet), 1 / its width, whether it runs
  uniform sampler2D uRipples;
  uniform vec4 uRippleAt;
#endif
// the way to the sun (scene axes), and how much of the light is the sun's own
uniform vec4 uGfxSun;
${MIRROR_GLSL}
`;

/* After the texture is read: what the weather does to the ground's own colour. */
const ALBEDO = /* glsl */ `
  vec2 gfxAt = vec2( vGfxWorld.x, - vGfxWorld.z );
  // The grain and the broad patches are what wet film and snow read. Dry ground leaves them at a half, which is what
  // those terms multiply by when the weather is off, and skips the darkening (it is the colour itself at wet 0).
  vec4 gfxGrain = vec4( 0.5 );
  vec4 gfxPatch = vec4( 0.5 );
  float gfxLevel = smoothstep( 0.8, 0.96, vGfxUp.y );
  // How open to the sky the ground is here: all of it, but under a bridge or in a tunnel.
  float gfxOpen = 1.0;
  // (What is worked out here and read again after the light is worked out is kept to a few numbers: everything kept
  // across the lighting costs every pixel of the ground, puddle or not.)
  // \`gfxFroth\` how much of a puddle's water muddy froth covers, which mirrors nothing
  float gfxWet = 0.0, gfxPool = 0.0, gfxSnow = 0.0, gfxFroth = 0.0;
  if ( uGfx.x > 0.0 || uGfx.z > 0.0 ) {
    gfxGrain = texture2D( uGfxNoise, gfxAt / 41.0 );
    gfxPatch = texture2D( uGfxNoise, gfxAt / 430.0 );
    #ifdef GFX_SHELTER
      gfxOpen = 1.0 - texture2D( uGfxShelter, gfxAt / 8192.0 ).r;
    #endif
    gfxWet = uGfx.x * gfxOpen;
    // Wet ground is darker and its colours deeper, and what it is made of is as plain to see as when it was dry. Ground
    // soaked at a puddle's edge is darker yet, and under standing water darker again.
    float gfxGrey = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    diffuseColor.rgb = max( mix( vec3( gfxGrey ), diffuseColor.rgb, 1.0 + ${glsl(WET.deeper)} * gfxWet ), 0.0 ) * mix( 1.0, ${glsl(WET.darker)}, gfxWet );
    #ifdef GFX_POOLS
      if ( uGfx.y > 0.0 && gfxLevel * gfxOpen > 0.0 ) {
        vec2 gfxRest = gfxPoolRest( gfxAt );
        // The waves the trucks stir here (render/water-ripples.js): the water's height (feet), its height a step before,
        // its foam and its silt; read where they could reach, in a puddle or a little way up its bank.
        vec4 gfxStirred = vec4( 0.0 );
        #ifdef GFX_RIPPLES
          vec2 gfxRippleUv = ( gfxAt - uRippleAt.xy ) * uRippleAt.z;
          if ( gfxRest.x > gfxRest.y - ${glsl(LIFT_REACH_FT * (127 / 255) / PUDDLE_RANGE_FT)} && uRippleAt.w > 0.5
            && all( greaterThan( gfxRippleUv, vec2( 0.0 ) ) ) && all( lessThan( gfxRippleUv, vec2( 1.0 ) ) ) ) {
            vec2 gfxRippleEdge = min( gfxRippleUv, 1.0 - gfxRippleUv );
            gfxStirred = texture2D( uRipples, gfxRippleUv ) * smoothstep( 0.0, 0.1, min( gfxRippleEdge.x, gfxRippleEdge.y ) );
          }
        #endif
        // The waves lift and lower the water: a wheel's trough parts a shallow puddle down to the ground under it, and the
        // water runs back in behind it.
        vec3 gfxPooled = gfxPoolLifted( gfxRest, gfxStirred.r );
        gfxPool = gfxPooled.x * gfxLevel * gfxOpen;
        float gfxRim = gfxPooled.z * gfxLevel * gfxOpen;
        if ( gfxRim + gfxPool > 0.0 ) {
          // The soaked ground at a puddle's edge is darker yet, and it and a puddle's bed where a wave has just bared it
          // keep a film of the muddy water; under standing water the ground is darker again.
          diffuseColor.rgb *= 1.0 - ${glsl(POOL_LOOK.soaked)} * gfxRim * ( 1.0 - gfxPool );
          diffuseColor.rgb = mix( diffuseColor.rgb, uGfxMud * ${glsl(POOL_LOOK.mud)}, ${glsl(POOL_LOOK.film)} * gfxRim * ( 1.0 - gfxPool ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.42, 0.45, 0.48 ), gfxPool );
          // Rain standing on dirt is muddy: the deeper the puddle, the more its water hides the ground under it in a
          // colour of its own, the silt's, much as the ground's own colour taken broadly. A wheel through it stirs the silt
          // up: the water clouds over whole and pales, in swirls that settle.
          float gfxSilted = gfxStirred.b > 0.004 ? smoothstep( 0.02, 0.3, gfxStirred.b * ( 0.3 + 1.4 * texture2D( uGfxNoise, gfxAt / 9.0 + uGfx.w * 0.01 ).a ) ) : 0.0;
          float gfxMurk = gfxPool * max( ${glsl(POOL_LOOK.murkMost)} * ( 1.0 - exp( - gfxPooled.y / ${glsl(POOL_LOOK.murkFt)} ) ), 0.95 * gfxSilted );
          diffuseColor.rgb = mix( diffuseColor.rgb, uGfxMud * ( ${glsl(POOL_LOOK.mud)} + 0.3 * ( gfxPatch.g - 0.5 ) + ${glsl(POOL_LOOK.stirredPaler)} * gfxSilted ), gfxMurk );
          // Where it was churned hardest, a scum of muddy froth rides on the water for a while.
          if ( gfxStirred.b > 0.1 ) {
            gfxFroth = gfxPool * ${glsl(POOL_LOOK.froth)} * smoothstep( 0.45, 0.85, gfxStirred.b * ( 0.3 + 1.4 * texture2D( uGfxNoise, gfxAt / 3.1 - uGfx.w * 0.02 ).b ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, uGfxMud * 1.4 + 0.06, gfxFroth );
          }
        }
      }
    #endif
    if ( uGfx.z > 0.0 ) {
    #ifdef GFX_SNOW_VOLUME
      // How deep the snow lies here now, feet: the mesh has its settled depth.
      float gfxDeep = vGfxSnow * uGfx.z * gfxOpen;
    #else
      // No depth in the mesh: what ground of this slope would hold, drifting from place to place.
      float gfxSlope = sqrt( max( 1.0 - vGfxUp.y * vGfxUp.y, 0.0 ) ) / max( vGfxUp.y, 0.05 );
      float gfxDeep = ${glsl(SNOW_MAX_FT)} * ( 1.0 - smoothstep( ${glsl(SNOW_HOLD_SLOPE)}, ${glsl(SNOW_BARE_SLOPE)}, gfxSlope ) ) * ( 0.72 + 0.28 * ( gfxPatch.r * 2.0 - 1.0 ) ) * uGfx.z * gfxOpen;
      #ifdef GFX_SNOW_SHARE
        gfxDeep *= vGfxShare;
      #endif
    #endif
    // Where the snow shows, and how far over the depth it must have to show its settled depth is (\`gfxSnowShown\`).
    vec2 gfxShown = gfxSnowShown( gfxAt, gfxDeep, gfxGrain, gfxPatch );
    float gfxOver = gfxShown.y;
    gfxSnow = gfxShown.x;
    // The ground just clear of the snow is damp from it.
    diffuseColor.rgb *= 1.0 - ${glsl(SNOW_LINE.damp)} * smoothstep( - ${glsl(SNOW_LINE.dampDepthFt)}, 0.0, gfxOver ) * ( 1.0 - gfxSnow );
    // Its surface: hollows and wind-packed ridges, a shade bluer in the hollows, and lit by the sun where there is one.
    vec4 gfxDrift = texture2D( uGfxRelief, gfxAt / 37.0 ), gfxRipple = texture2D( uGfxRelief, gfxAt / 6.1 );
    float gfxHigh = gfxDrift.r * 0.65 + gfxRipple.r * 0.35;
    float gfxLit = - dot( ( gfxDrift.gb - 0.5 ) * 0.7 + ( gfxRipple.gb - 0.5 ) * 0.5, vec2( uGfxSun.x, - uGfxSun.z ) ) * uGfxSun.w;
    // Deep snow is a clean white; thin snow is greyed by what lies under it.
    vec3 gfxWhite = mix( vec3( 0.74, 0.78, 0.85 ), vec3( 0.9, 0.93, 0.97 ), smoothstep( 0.0, 0.35, gfxOver ) );
    gfxWhite *= mix( vec3( 0.84, 0.89, 0.97 ), vec3( 1.03 ), gfxHigh ) * ( 1.0 + gfxLit );
    diffuseColor.rgb = mix( diffuseColor.rgb, gfxWhite, gfxSnow );
    }
  }
  #ifdef GFX_LIT
    // What wet ground and its puddles mirror, and the snow's glints, are light of their own over the ground's: the
    // ground's own light gives way to what is mirrored, and that is added to it once it is lit, as light it gave off
    // would be. (Worked out here, before the light is, so that of all of it only that light is kept across the lighting.)
    #ifdef GFX_WET
      vec4 gfxMirrored = gfxMirror( gfxAt, gfxWet, gfxPool, gfxSnow, gfxLevel, gfxFroth );
      diffuseColor.rgb *= 1.0 - gfxMirrored.a;
      totalEmissiveRadiance += gfxMirrored.rgb;
    #endif
    totalEmissiveRadiance += gfxGlints( gfxAt, gfxSnow );
  #endif
`;

/* After the light is worked out: what water on the ground shows of the sky. */
const SHINE = /* glsl */ `
#ifndef GFX_LIT
  // A ground that is not lit: what it mirrors is laid over what it draws.
  #ifdef GFX_WET
    vec4 gfxMirrored = gfxMirror( vec2( vGfxWorld.x, - vGfxWorld.z ), gfxWet, gfxPool, gfxSnow, smoothstep( 0.8, 0.96, vGfxUp.y ), gfxFroth );
    gl_FragColor.rgb = gl_FragColor.rgb * ( 1.0 - gfxMirrored.a ) + gfxMirrored.rgb;
  #endif
  gl_FragColor.rgb += gfxGlints( vec2( vGfxWorld.x, - vGfxWorld.z ), gfxSnow );
#endif
`;

/**
 * @param {{ world: THREE.Object3D, puddleTexture?: THREE.Texture|null, puddles?: boolean, snow?: boolean }} options
 *   `world` is the track (render/track-scene.js); `puddleTexture` the puddle map
 *   (render/ground-textures.js), without which the ground is wet in Rain but holds no pools;
 *   `shelterTexture` where the ground lies under cover, which stays dry and bare;
 *   `puddles` and `snow` are the two switches; `sun` the scene's sun, which lights the snow's
 *   ridges; `ripples` the waves the trucks stir (render/water-ripples.js), which a puddle shows,
 *   and `puddleMap` the puddle map itself, which says how deep a puddle is where a wheel stands. Whether the snow has depth is read off the terrain itself: its mesh has `snowDepth`
 *   when the track was built for a race in Snow. `groundTone` is the ground's own colour taken broadly (linear), which a
 *   puddle's silt has.
 */
export function createGroundSurface({ world, puddleTexture = null, shelterTexture = null, puddles = true, snow = true, sun = null, ripples = null, puddleMap = null, groundTone = [0.2, 0.16, 0.12] }) {
  const uniforms = {
    ...(ripples?.uniforms ?? {}),
    ...sharedNoiseUniforms(), uGfx: { value: new THREE.Vector4() }, uGfxLight: { value: 1 }, uGfxSun: { value: new THREE.Vector4(0, 1, 0, 0) },
    uGfxSkyMap: { value: null }, uGfxSkyCap: { value: new THREE.Color(0.6, 0.7, 0.85) }, uGfxHorizon: { value: new THREE.Color(0.7, 0.75, 0.8) },
    uGfxSkyOn: { value: 0 }, uGfxDark: { value: 0 }, uGfxSkyVeil: { value: 0 }, uGfxRain: { value: 0 },
    uGfxMud: { value: new THREE.Color(...groundTone) },
    uGfxPuddles: { value: puddleTexture }, uGfxShelter: { value: shelterTexture },
    uGfxPuddleSide: { value: puddleTexture?.image.width ?? 1 },
  };
  const sky = { on: uniforms.uGfxSkyOn, map: uniforms.uGfxSkyMap, cap: uniforms.uGfxSkyCap, horizon: uniforms.uGfxHorizon, dark: uniforms.uGfxDark };
  const dressed = new Set();
  let volume = false;

  /**
   * Give a ground material the weather. `pools` false leaves out standing water (ground boxes:
   * the puddle map is of the ground under them, not of their tops); `depth` says the mesh it
   * draws has the snow's depth on its vertices; `shelter` false leaves out the cover overhead
   * (ground boxes again: they are the cover); `share` says its vertices say how much of the open
   * ground's snow lies there (`snowShare`: ground boxes' tops along the course).
   */
  function dress(material, { pools = true, depth = false, shelter = true, share = false } = {}) {
    if (dressed.has(material)) return material;
    dressed.add(material);
    const pooled = pools && puddles && puddleTexture;
    // A ground the scene's lights light adds what it mirrors to its own light; one they do not lays it over (`MIRROR_GLSL`).
    const lit = !!(material.isMeshLambertMaterial || material.isMeshPhongMaterial || material.isMeshStandardMaterial);
    const defines = `${lit ? "#define GFX_LIT\n" : ""}${puddles ? "#define GFX_WET\n" : ""}${pooled ? "#define GFX_POOLS\n" : ""}${pooled && ripples ? "#define GFX_RIPPLES\n" : ""}${depth && snow ? "#define GFX_SNOW_VOLUME\n" : ""}${shelter && shelterTexture ? "#define GFX_SHELTER\n" : ""}${share && snow ? "#define GFX_SNOW_SHARE\n" : ""}`;
    // Its lines go beside three.js's own, which stay where they are for whoever replaces them (render/ground-detail.js).
    return addShaderHook(material, `ground-surface:${defines}`, 10, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${defines}${VERTEX_PARS}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_LIFT}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${defines}${FRAGMENT_PARS}`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${ALBEDO}`)
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${SHINE}`);
    });
  }
  world.traverse((object) => {
    if (object.name === "terrain" && object.material) {
      const depth = !!object.geometry?.attributes.snowDepth;
      volume ||= depth && snow;
      dress(object.material, { depth });
    }
    // A ground box's top is itself what stands over the ground: it is out in the weather, whatever lies under it, and
    // along the course it is the course, its snow as thin as the road's.
    if (object.name === "groundBoxes" && object.material) dress(object.material, { pools: false, shelter: false, share: !!object.geometry?.attributes.snowShare });
  });

  let weather = 0, wet = 0, filled = 0, down = 0, rainSeconds = 0, snowSeconds = 0, snowStart = 0;
  const horizon = new THREE.Color();
  return {
    /** Dress one more material as the terrain's is (the lit twin of the classic look's, render/weather-scene.js). */
    dress: (material) => dress(material, { depth: volume }),
    /**
     * The weather changed (or began). `instant` at a race's start: in Rain the ground is wet and
     * its puddles full already, and in Snow part of the snow is already down; a change during a
     * race comes on from nothing.
     */
    set(next, { instant = false } = {}) {
      if (next === SNOW && weather !== SNOW) { snowSeconds = 0; snowStart = instant ? SNOW_START : down; }
      if (instant) {
        const raining = puddles && next === RAIN;
        rainSeconds = raining ? 600 : 0; wet = raining ? 1 : 0; filled = raining ? 1 : 0;
        down = snow && next === SNOW ? SNOW_START : 0;
      }
      weather = next;
    },
    /**
     * Once a frame: `light` the weather's brightness; `sky` the sky's dome, `fog` the scene's fog
     * and `background` the sky's colour, which wet ground and standing water mirror; `eyeY` the
     * eye's height in the scene, which says how much of that sky the fog over it hides.
     */
    update(dt, { light = 1, fog = null, background = null, sky: dome = null, eyeY = null } = {}) {
      if (puddles && weather === RAIN) {
        rainSeconds += dt;
        wet = Math.max(wet, groundWetness(rainSeconds));
        filled = Math.max(filled, puddlesFilled(rainSeconds));
      } else {
        rainSeconds = 0;
        wet = Math.max(0, wet - dt / DRY_SECONDS);
        filled = Math.max(0, filled - dt / DRY_SECONDS);
      }
      if (snow && weather === SNOW) { snowSeconds += dt; down = snowDown(snowSeconds, snowStart); } else down = Math.max(0, down - dt / MELT_SECONDS);
      uniforms.uGfx.value.set(wet, wet > 0 ? filled : 0, down, (uniforms.uGfx.value.w + dt) % 4096);
      // The puddles, while there is water in them, for the trucks to stir.
      ripples?.puddles(puddles && wet > 0 && filled > 0 ? (1 - filled) * FILL_DROP_FT : null);
      uniforms.uGfxLight.value = light;
      if (sun) {
        const way = uniforms.uGfxSun.value;
        way.set(sun.position.x, sun.position.y, sun.position.z, 0).normalize();
        way.w = WEATHER_LOOK[weather]?.sun ?? 1;
      }
      // The sky that wet ground and puddles mirror, the lake's own (render/water-common.js); without a dome to show it,
      // the sky's colour overhead, greyed toward the fog by how much the weather shuts it out.
      if (puddles) {
        mirrorSky(sky, { sky: dome, fog, background, light, weather });
        if (!dome?.userData.cap) {
          horizon.copy(fog?.color ?? background ?? uniforms.uGfxHorizon.value);
          uniforms.uGfxSkyCap.value.copy(background ?? horizon).lerp(horizon, WEATHER_LOOK[weather]?.fogEndFt ? 0.6 : 0);
        }
        uniforms.uGfxSkyVeil.value = eyeY === null ? 0 : atmosphere.skyVeil(eyeY);
        uniforms.uGfxRain.value = weather === RAIN ? 1 : 0;
      }
    },
    /** How deep the puddle that stands at game (x, z) is now, feet, as the ground draws it; 0 where none does. */
    puddleAt(x, z) {
      if (!puddles || !puddleMap || !(wet > 0 && filled > 0)) return 0;
      return Math.max(0, puddleDepthAt(puddleMap, x, z) - (1 - filled) * FILL_DROP_FT);
    },
    /**
     * Where water stands, for what lies on the ground and must go under it (render/tire-tracks.js), or null without
     * puddles: `glsl` gives `vec2 gfxPoolAt( vec2 at )` (how much of game (x, z) a puddle covers, and how deep it is
     * there, feet), and `uniforms` are what it reads.
     */
    pools: puddles && puddleTexture ? { glsl: POOL_GLSL, uniforms } : null,
    /**
     * Where the snow shows, for what is ploughed in it (render/tire-tracks.js), or null without snow cover: `glsl` gives
     * `vec2 gfxSnowShown( vec2 at, float deep, vec4 grain, vec4 patch_ )` (how much of game (x, z) the snow covers, as
     * the ground draws it), and `uniforms` are what it reads.
     */
    snowLine: snow ? { glsl: SNOW_LINE_GLSL, uniforms } : null,
    /** How much of the snow is down, 0 to 1. */
    get snowDown() { return down; },
    /** Whether the snow has depth: the terrain is lifted by it (game/snow-cover.js). */
    get snowHasDepth() { return volume; },
    dispose() { dressed.clear(); },
  };
}
