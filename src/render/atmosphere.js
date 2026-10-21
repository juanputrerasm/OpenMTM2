/*
  Fog as a volume (docs/VISUALS.md, "Fog"; the numbers are in game/atmosphere.js).

  three.js fogs a fragment by its distance alone. Here the fog is a layer on the land: it lies
  on a floor that is a map of the world (game/fog-floor.js), is full up to a deck over that
  floor and thins above it, and a fragment is fogged by how much of it lies along the line from
  the eye. That line is cut in a few slices, short near the eye and long far off; each is as
  thick as the layer is over its length where its middle lies (summed in closed form) and as
  the fog's banks make it there, and each hides what is behind it. The floor and the banks
  are places in the world, so the fog stays where it is as a truck drives through it: a hill
  stands out of it, a bank stands in the air at its own distance, and things pass behind it
  and come out of it. It is lit toward the sun, and the sky is veiled by the same layer and
  the same banks.

  How it reaches every material. three.js builds each material's shader from named chunks; the
  four fog chunks are replaced here with ones that do the above when it is switched on and
  exactly what three.js does when it is not. The fog's state is one array of numbers that every
  material's uniforms point at (the shader library's uniform lists are given the same array, and
  three.js copies such lists without copying the arrays in them), so setting it once a frame
  sets it for every material in the scene, whoever made it. `installAtmosphere` must run before
  any material is compiled, since a compiled shader is kept by what it was made from and would
  be reused as it was: render/xr/xr-host.js, which makes the app's renderer, calls it first.

  Fog is mixed in after the picture's colours are encoded for where they are going, as three.js
  does it, so the fog's colours are given encoded the same way: for the screen, or, while the
  lens draws into a picture of light (render/lens.js), as light (`output`, `screenColor`).
*/
import * as THREE from "three";
import { BACKDROP_DISTANCE_FT, BACKDROP_FOOT, FOG_BANKS, FOG_TOP, fogColumn, fogTopLit } from "../game/atmosphere.js";
import { FOG_FLOOR } from "../game/fog-floor.js";
import { WORLD_FT } from "../shared/scene-frame.js";
import { SHARED_NOISE_GLSL, billowNoise, cloudNoise, detailNoise } from "./noise-textures.js";

/*
  The state, nine groups of four numbers:
    0  on (1) or off (0), thickness in the deck per foot, 1 / scale height, the height of the layer's top where the eye is
    1  where the far fade starts, where it ends (feet), drift 0 to 1, seconds
    2  the way to the sun (scene axes), glow 0 to 1
    3  the glow's colour, the sky's depth overhead
    4  the fog's colour, how many slices the line of sight is cut in
    5  the wind (x, z feet per second), the banks' noise's scale per foot, the deck's height over the floor (feet)
    6  how far from the eye the banks are told apart (feet), steps through the billows, how lit the top is, how far its light reaches in (feet)
    7  the billows' height (feet), their noise's scale per foot, how steeply the sun's light climbs (rise over run),
       whether the far fade dissolves the world into the track's backdrop (1) instead of fading it to the fog's colour
    8  the top's shape (game/atmosphere.js `fogProfile`): cap, cap feet, crisp feet, wisps
*/
const STATE = new Float32Array(36);
/** A floor at height nothing, until a track gives the fog its own (`atmosphere.floor`). */
const NO_FLOOR = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
NO_FLOOR.needsUpdate = true;
const SHARED = {
  mtmFog: { value: STATE }, mtmCloudNoise: { value: null }, mtmDetailNoise: { value: null }, mtmFogFloor: { value: NO_FLOOR }, mtmFogBillow: { value: null },
  // The fog along every way from the eye, worked out once a frame (render/fog-state.js, `atmosphere.ahead`). Like the state,
  // these are of kinds three.js copies a material's uniforms without copying (an array, its items kept), so every material
  // reads the same: the picture is always the one texture, and only what it holds changes.
  mtmFogState: { value: [null] }, mtmFogStateView: { value: new Float32Array(16) }, mtmFogStateEye: { value: new Float32Array(4) },
};
const glsl = (n) => n.toFixed(5);
/** The most slices a line of sight is cut in, and the most steps through the billows: loops' bounds, which a shader must know as it is compiled. */
const MOST_SLICES = 6, MOST_STEPS = FOG_TOP.steps;

const COMMON = /* glsl */ `
uniform vec4 mtmFog[ 9 ];
uniform sampler2D mtmFogFloor, mtmFogBillow;
// The fog's banks are the cloud noise the ground reads too (render/noise-textures.js \`SHARED_NOISE_GLSL\`).
${SHARED_NOISE_GLSL}
#ifndef mtmFogNoise
#define mtmFogNoise mtmCloudNoise
#endif
// Where the steps through the billows fall within each of theirs, 0 to 1: a fragment shader gives each point of the
// picture its own (MTM_FOG_JITTER, defined before this), so that the steps leave grain and not bands.
#ifndef MTM_FOG_JITTER
#define MTM_FOG_JITTER 0.5
#endif
// How thick the fog is \`h\` feet over its top (under it when negative), against its deck (game/atmosphere.js \`fogProfile\`).
// A fog without a top (no cap, all wisps: every weather but Foggy) skips the terms it would multiply by nothing.
float mtmFogShape( float h ) {
  vec4 top = mtmFog[ 8 ];
  if ( h <= 0.0 ) return top.x > 0.0 ? 1.0 + top.x * exp( max( h / top.y, - 40.0 ) ) : 1.0;
  float crisp = top.w < 1.0 ? ( 1.0 - top.w ) * exp( - min( h / top.z, 40.0 ) ) : 0.0;
  return ( 1.0 + top.x ) * ( crisp + top.w * exp( - min( h * mtmFog[ 0 ].z, 40.0 ) ) );
}
// The same, summed from \`a\` to \`b\` feet over the top (a <= b).
float mtmFogShapeSum( float a, float b ) {
  vec4 top = mtmFog[ 8 ];
  float sum = 0.0;
  if ( a < 0.0 ) {
    float upper = min( b, 0.0 );
    sum += upper - a;
    if ( top.x > 0.0 ) sum += top.x * top.y * ( exp( max( upper / top.y, - 40.0 ) ) - exp( max( a / top.y, - 40.0 ) ) );
  }
  if ( b > 0.0 ) {
    float lower = max( a, 0.0 ), tall = 1.0 / mtmFog[ 0 ].z;
    float crisp = top.w < 1.0 ? ( 1.0 - top.w ) * top.z * ( exp( - min( lower / top.z, 40.0 ) ) - exp( - min( b / top.z, 40.0 ) ) ) : 0.0;
    sum += ( 1.0 + top.x ) * ( crisp + top.w * tall * ( exp( - min( lower / tall, 40.0 ) ) - exp( - min( b / tall, 40.0 ) ) ) );
  }
  return sum;
}
// How much fog a line passes, as feet of fog at its deck's thickness (game/atmosphere.js \`fogColumn\`): it starts \`over\`
// feet over the layer's top (under it when negative), runs \`dist\` feet and climbs \`dy\` a foot.
float mtmFogColumn( float over, float dy, float dist ) {
  if ( abs( dy ) < 1e-5 ) return dist * mtmFogShape( over );
  float end = over + dy * dist;
  return mtmFogShapeSum( min( over, end ), max( over, end ) ) / abs( dy );
}
// How much even fog lies along a ray from the eye, taking the layer's top as it is where the eye stands: \`dir\` the
// ray's direction in the world, \`dist\` its length in feet.
float mtmFogDepth( vec3 dir, float dist ) {
  return mtmFog[ 0 ].y * mtmFogColumn( cameraPosition.y - mtmFog[ 0 ].w, dir.y, dist );
}
// The fog's banks at a place in the world: its noise there, 0 to 1 and about a half. Two broad fields that drift on
// the wind, the second read blurred: nothing in them is finer than a couple of hundred feet, so a truck at speed
// drives through them over seconds.
float mtmFogNoiseAt( vec3 p ) {
  vec2 blown = p.xz + mtmFog[ 5 ].xy * mtmFog[ 1 ].w;
  return textureLod( mtmFogNoise, blown * mtmFog[ 5 ].z, 0.0 ).r * 0.62
    + textureLod( mtmFogNoise, ( blown + mtmFog[ 5 ].yx * mtmFog[ 1 ].w * 0.5 ) * mtmFog[ 5 ].z * ${glsl(FOG_BANKS.broadFt / FOG_BANKS.midFt)} + 0.37, ${glsl(FOG_BANKS.midBlur)} ).g * 0.38;
}
// The fog's thickness against an even fog's where its noise reads \`noise\` (game/atmosphere.js \`fogBank\`).
float mtmFogBank( float noise ) {
  return max( 0.0, 1.0 + mtmFog[ 1 ].z * ${glsl(FOG_BANKS.reach)} * ( smoothstep( 0.36, 0.64, noise ) * 2.0 - 1.0 ) );
}
// The fog's floor at a place in the world, feet (game/fog-floor.js).
float mtmFogFloorAt( vec3 p ) {
  return textureLod( mtmFogFloor, vec2( p.x, - p.z ) / ${WORLD_FT.toFixed(1)} + ${(0.5 / FOG_FLOOR.side).toFixed(6)}, 0.0 ).r;
}
// The deck over the floor where the banks read \`noise\`: higher over a bank and lower over a thin place.
float mtmFogDeck( float noise ) {
  return mtmFog[ 5 ].w * ( 1.0 + ${glsl(FOG_BANKS.topSwell * 2)} * ( noise - 0.5 ) * step( 1e-4, mtmFog[ 1 ].z ) );
}
// The height of the layer's top at a place in the world, feet, without its billows.
float mtmFogTop( vec3 p, float noise ) {
  return mtmFogFloorAt( p ) + mtmFogDeck( noise );
}
// How bright the fog is \`over\` feet over its top, against its own colour (game/atmosphere.js \`fogLight\`).
float mtmFogLight( float over ) {
  return 1.0 + mtmFog[ 6 ].z * exp( max( min( over, 0.0 ) / mtmFog[ 6 ].w, - 40.0 ) );
}
// The billows of the top at a place in the world: x how far the top stands over its mean there (feet), y how thick the
// wisps over it lie, 0 to 1. Two layers of them drifting on the wind at their own speeds, so they change as they go.
// \`lod\`: how blurred, for what is far off.
vec2 mtmFogBillowAt( vec3 p, float lod ) {
  vec2 blown = p.xz + mtmFog[ 5 ].xy * mtmFog[ 1 ].w;
  vec2 a = textureLod( mtmFogBillow, blown * mtmFog[ 7 ].y, lod ).rg;
  vec2 turned = vec2( blown.x * 0.8 - blown.y * 0.6, blown.x * 0.6 + blown.y * 0.8 ) + mtmFog[ 5 ].yx * mtmFog[ 1 ].w * 0.7;
  vec2 b = textureLod( mtmFogBillow, turned * mtmFog[ 7 ].y * 2.3 + 0.31, lod ).rg;
  return vec2( mtmFog[ 7 ].x * ( a.x * 0.7 + b.x * 0.3 - 0.5 ), a.y * 0.6 + b.y * 0.4 );
}
// Fog is lighter where it is thick: \`bank\` is its thickness against an even fog's.
float mtmFogShade( float bank ) {
  return 1.0 + ${glsl(FOG_BANKS.shade)} * ( bank - 1.0 );
}
/*
  The fog along a ray from the eye, nearest first: x how much of what lies at its end it hides, y how bright the fog
  that is seen is against its own colour. The ray is cut in slices, each as thick as the layer is along its own length
  with the top and the banks as they are at its middle, summed in closed form; but where it passes through the top's
  billows it is followed step by step, each step as thick as the billows make the fog there and as lit as the day
  reaches it.
*/
#define MTM_FOG_ADD( depth, light ) { float hides_ = 1.0 - exp( - ( depth ) ); seen += clear * hides_ * ( light ); clear *= 1.0 - hides_; }
// One slice of the line along \`dir\`, from \`from\` to \`to\` feet from the eye, added to how much of the light still comes
// through (\`clear\`) and the fog's light seen so far (\`seen\`). \`billowFt\`, \`bandLow\`, \`bandHigh\`, \`sunFlat\` and
// \`steps\` are the line's, as \`mtmFogAlong\` works them out. (render/fog-state.js takes the whole slices the same way.)
void mtmFogSlice( vec3 dir, float from, float to, float billowFt, float bandLow, float bandHigh, vec2 sunFlat, int steps,
    inout float clear, inout float seen ) {
  float density = mtmFog[ 0 ].y;
  // The layer and its banks as they are at the slice's middle, a place in the world.
  vec3 middle = cameraPosition + dir * ( 0.5 * ( from + to ) );
  float noise = mtmFogNoiseAt( middle );
  float bank = mtmFogBank( noise ), shade = mtmFogShade( bank );
  float floorMid = mtmFogFloorAt( middle ), deck = mtmFogDeck( noise ), top = floorMid + deck;
  float over0 = cameraPosition.y + dir.y * from - top;
  // Where in the slice the line is among the billows.
  float ta = from, tb = from;
  if ( billowFt > 0.0 ) {
    if ( abs( dir.y ) < 1e-4 ) { if ( over0 > bandLow && over0 < bandHigh ) tb = to; }
    else {
      float t1 = from + ( bandLow - over0 ) / dir.y, t2 = from + ( bandHigh - over0 ) / dir.y;
      ta = clamp( min( t1, t2 ), from, to );
      tb = clamp( max( t1, t2 ), from, to );
    }
  }
  if ( ta > from ) {
    float run = ta - from;
    MTM_FOG_ADD( density * bank * mtmFogColumn( over0, dir.y, run ), shade * mtmFogLight( over0 + dir.y * run * 0.5 ) );
  }
  if ( tb > ta ) {
    float stride = ( tb - ta ) / float( steps );
    for ( int k = 0; k < ${MOST_STEPS}; k ++ ) {
      if ( k >= steps ) break;
      float t = ta + ( float( k ) + MTM_FOG_JITTER ) * stride;
      vec3 p = cameraPosition + dir * t;
      float lod = clamp( log2( t / 250.0 ), 0.0, 5.0 );
      vec2 billow = mtmFogBillowAt( p, lod );
      // The top here: its floor, the deck as the slice's banks have it, and the billow.
      float base = mtmFogFloorAt( p ) + deck;
      float over = p.y - base - billow.x;
      // Over the top only the wisps, and they lie in patches.
      float thick = mtmFogShape( over ) * mix( 1.0, 2.0 * billow.y, smoothstep( 0.0, 3.0 * mtmFog[ 8 ].z, over ) );
      // The day lights the top and reaches some way into it. A billow's face toward the sun takes more of it and one
      // turned away less: how the top climbs toward the sun against how steeply the light comes down.
      float slope = ( mtmFogBillowAt( p + vec3( sunFlat.x, 0.0, sunFlat.y ) * 12.0, lod ).x - billow.x ) / 12.0;
      float facing = clamp( ( 1.0 - slope / mtmFog[ 7 ].z ) * inversesqrt( 1.0 + slope * slope ), 0.0, 2.0 );
      // A crown stands in the open sky and a hollow between crowns sees less of it.
      float crown = clamp( billow.x / max( billowFt, 1.0 ) + 0.5, 0.0, 1.0 );
      float light = 1.0 + mtmFog[ 6 ].z * exp( max( min( over, 0.0 ) / mtmFog[ 6 ].w, - 40.0 ) ) * ( 0.3 + 0.7 * facing ) * ( 0.6 + 0.6 * crown );
      MTM_FOG_ADD( density * bank * thick * stride, shade * light );
    }
  }
  if ( to > tb ) {
    float run = to - tb, overB = over0 + dir.y * ( tb - from );
    MTM_FOG_ADD( density * bank * mtmFogColumn( overB, dir.y, run ), shade * mtmFogLight( overB + dir.y * run * 0.5 ) );
  }
}
#ifdef MTM_FOG_STATE
// The fog worked out once a frame along every way the eye looks (render/fog-state.js): along each, after each whole
// slice, how much of the light still comes through and the fog's light seen so far, on a picture of those ways in three
// bands side by side, after slices one and two, three and four, and five.
uniform sampler2D mtmFogState[ 1 ];
// What turns a way in the world into its place on that picture (the eye's turn and lens, unshifted), and where the eye
// was, w 1 while the picture may be read: only for this eye, and only between those slices it holds.
uniform mat4 mtmFogStateView;
uniform vec4 mtmFogStateEye;
// The line along \`dir\` after \`whole\` slices (1 to 5), \`clear\` and \`seen\`, or nothing (x below 0) where the picture
// does not hold it.
vec2 mtmFogStateAfter( vec3 dir, int whole ) {
  if ( mtmFogStateEye.w < 0.5 || distance( cameraPosition, mtmFogStateEye.xyz ) > 0.01 ) return vec2( - 1.0 );
  vec4 clip = mtmFogStateView * vec4( dir, 0.0 );
  if ( clip.w <= 0.0 ) return vec2( - 1.0 );
  // A way just past the picture's edge (TAA's shift) takes the edge's; a read never takes from the next band.
  vec2 band = vec2( textureSize( mtmFogState[ 0 ], 0 ) ) / vec2( 3.0, 1.0 );
  vec2 at = clamp( ( clip.xy / clip.w * 0.5 + 0.5 ) * band, vec2( 0.5 ), band - 0.5 );
  vec4 kept = textureLod( mtmFogState[ 0 ], ( at + vec2( float( ( whole - 1 ) / 2 ) * band.x, 0.0 ) ) / ( band * vec2( 3.0, 1.0 ) ), 0.0 );
  return ( whole - 1 ) % 2 == 0 ? kept.xy : kept.zw;
}
#endif
vec2 mtmFogAlong( vec3 dir, float dist ) {
  float far = mtmFog[ 6 ].x, billowFt = mtmFog[ 7 ].x;
  int slices = int( mtmFog[ 4 ].w + 0.5 ), steps = int( mtmFog[ 6 ].y + 0.5 );
  // The band the billows lie in, over the top's mean: below it the fog is its deck, above it only wisps.
  float bandLow = - 0.6 * billowFt - mtmFog[ 8 ].y, bandHigh = 0.6 * billowFt + 3.0 * mtmFog[ 8 ].z;
  // The sun's way along the ground and how steeply its light comes down, for the billows' shade.
  vec2 sunFlat = mtmFog[ 2 ].xz / max( length( mtmFog[ 2 ].xz ), 1e-4 );
  float clear = 1.0, seen = 0.0, from = 0.0;
  int first = 0;
  #ifdef MTM_FOG_STATE
    // The whole slices along this way are read from the picture of them, and only the rest is worked out here.
    if ( mtmFogStateEye.w > 0.5 && far > 0.0 ) {
      int whole = min( slices, int( float( slices ) * sqrt( max( dist, 0.0 ) / far ) ) );
      vec2 kept = whole > 0 ? mtmFogStateAfter( dir, whole ) : vec2( - 1.0 );
      if ( kept.x >= 0.0 ) {
        clear = kept.x;
        seen = kept.y;
        first = whole;
        float part = float( whole ) / float( slices );
        from = far * part * part;
      }
    }
  #endif
  for ( int i = first; i < ${MOST_SLICES}; i ++ ) {
    if ( i >= slices || from >= dist ) break;
    // Slices end by the square of their number: the nearest is the shortest.
    float part = float( i + 1 ) / float( slices );
    float to = min( far * part * part, dist );
    mtmFogSlice( dir, from, to, billowFt, bandLow, bandHigh, sunFlat, steps, clear, seen );
    from = to;
  }
  float density = mtmFog[ 0 ].y;
  // Beyond where the banks are told apart the fog is even, in two pieces each lying as the floor lies at its middle:
  // what is far off and seen from over the fog lies under its own fog, however clear the air is about the eye.
  for ( int k = 0; k < 2; k ++ ) {
    if ( dist <= from ) break;
    float to = k == 0 ? from + ( dist - from ) * 0.35 : dist;
    vec3 middle = cameraPosition + dir * ( 0.5 * ( from + to ) );
    float over0 = cameraPosition.y + dir.y * from - mtmFogTop( middle, 0.5 );
    MTM_FOG_ADD( density * mtmFogColumn( over0, dir.y, to - from ), mtmFogLight( over0 + dir.y * ( to - from ) * 0.5 ) );
    from = to;
  }
  float hidden = 1.0 - clear;
  return vec2( hidden, hidden > 1e-4 ? seen / hidden : mtmFogLight( cameraPosition.y - mtmFog[ 0 ].w ) );
}
// The fog's colour looking along \`dir\`: brighter toward the sun.
vec3 mtmFogTint( vec3 fogColor, vec3 dir ) {
  float toward = max( dot( dir, mtmFog[ 2 ].xyz ), 0.0 );
  float halo = toward * toward;
  return fogColor + mtmFog[ 3 ].rgb * ( mtmFog[ 2 ].w * ( 0.35 * halo + 0.65 * halo * halo * halo * halo ) );
}
// How bright the fog is that the eye sees where it stands: the far fade and the foot of the backdrop are that.
float mtmFogHere() {
  return mtmFogLight( cameraPosition.y - mtmFog[ 0 ].w );
}
// How much of what lies \`dist\` feet off the far fade takes to the fog's colour: none where it dissolves the world into
// the track's backdrop instead (\`mtmFogDissolve\`).
float mtmFogFarFade( float dist ) {
  return mtmFog[ 7 ].w > 0.5 ? 0.0 : smoothstep( mtmFog[ 1 ].x, mtmFog[ 1 ].y, dist );
}
// How much of a point \`dist\` feet off is see-through, 0 to 1, so the track's backdrop, drawn before the world, is seen
// through it: with a backdrop drawn the far fade is to the backdrop and not to the fog's colour, as the game's ground
// stops in front of its backdrop. Beyond the fade's end nothing of the world is seen. 0 where there is no backdrop.
float mtmFogDissolve( float dist ) {
  return mtmFog[ 0 ].x > 0.5 && mtmFog[ 7 ].w > 0.5 ? smoothstep( mtmFog[ 1 ].x, mtmFog[ 1 ].y, dist ) : 0.0;
}
// How much of what lies at \`viewPosition\` (view space, feet) the fog hides, 0 to 1: for what adds its light to the
// picture and is dimmed by the fog instead of being veiled in its colour.
float mtmFogHides( vec3 viewPosition ) {
  float dist = length( viewPosition );
  vec3 dir = ( vec4( viewPosition, 0.0 ) * viewMatrix ).xyz / max( dist, 1e-4 );
  return max( mtmFogAlong( dir, dist ).x, mtmFogFarFade( dist ) );
}
// The fog between the eye and \`viewPosition\` (view space, feet): its colour as it is added to the picture (its own
// colour times how much it hides), and how much it hides.
vec4 mtmFogOver( vec3 fogColor, vec3 viewPosition ) {
  float dist = length( viewPosition );
  vec3 dir = ( vec4( viewPosition, 0.0 ) * viewMatrix ).xyz / max( dist, 1e-4 );
  vec2 through = mtmFogAlong( dir, dist );
  float hidden = max( through.x, mtmFogFarFade( dist ) );
  // What the far fade takes beyond what the fog along the line hides is seen as the fog is from where the eye stands.
  float light = mix( mtmFogHere(), through.y, through.x / max( hidden, 1e-4 ) );
  return vec4( mtmFogTint( fogColor, dir ) * light * hidden, hidden );
}
// A fragment at \`viewPosition\` (view space, feet) seen through the fog.
vec3 mtmFogApply( vec3 color, vec3 fogColor, vec3 viewPosition ) {
  vec4 over = mtmFogOver( fogColor, viewPosition );
  return color * ( 1.0 - over.a ) + over.rgb;
}
// How much of the fog's whole depth lies over the eye, 0 to 1: all of it on the fog's floor, less as the eye climbs
// through the deck, little once it is out of the top.
float mtmFogOverhead() {
  return mtmFogColumn( cameraPosition.y - mtmFog[ 0 ].w, 1.0, 1e5 ) / max( mtmFogColumn( - mtmFog[ 5 ].w, 1.0, 1e5 ), 1e-3 );
}
// How much of the sky in direction \`dir\` an even fog between the eye and it hides, 0 to 1.
float mtmFogSkyHidden( vec3 dir ) {
  if ( mtmFog[ 0 ].x < 0.5 || mtmFog[ 3 ].w <= 0.0 ) return 0.0;
  return 1.0 - exp( - min( mtmFog[ 3 ].w * mtmFogOverhead() / max( dir.y, 1e-3 ), 60.0 ) );
}
// The sky in direction \`dir\`, veiled by it: by the banks the line meets, and lit as the fog over the eye is.
vec3 mtmFogSky( vec3 color, vec3 dir ) {
  if ( mtmFog[ 0 ].x < 0.5 || mtmFog[ 3 ].w <= 0.0 ) return color;
  float bank = mtmFogBank( mtmFogNoiseAt( cameraPosition + dir * 400.0 ) );
  float hidden = 1.0 - exp( - min( mtmFog[ 3 ].w * mtmFogOverhead() * bank / max( dir.y, 1e-3 ), 60.0 ) );
  // At the horizon it is the fog the far ground fades into; overhead, the top of the fog, which the day lights.
  float up = smoothstep( 0.1, 0.8, dir.y );
  float light = mix( mtmFogHere(), 1.0 + mtmFog[ 6 ].z, up ) * mix( 1.0, mtmFogShade( bank ), up );
  return mix( color, mtmFogTint( mtmFog[ 4 ].rgb, dir ) * light, hidden );
}
// How much of a track's backdrop in direction \`dir\` the fog hides: it stands beyond the world. Where the world
// fades into it (\`mtmFogDissolve\`) all of it is seen, its floor too, through the haze of its distance (below the
// horizon, as far off as at it). Otherwise, at the horizon, where the ground's own far fade has closed, it is hidden
// altogether, so the ground's far edge is never seen against it.
float mtmFogBackdropHidden( vec3 dir, float haze ) {
  // The fog or haze of a weather with a volume (game/atmosphere.js BACKDROP_HAZED) is seen between the eye and the backdrop.
  vec3 level = normalize( vec3( dir.x, max( dir.y, 0.0 ), dir.z ) );
  float through = haze * ( 1.0 - exp( - mtmFogDepth( level, ${BACKDROP_DISTANCE_FT.toFixed(1)} ) ) );
  if ( mtmFog[ 7 ].w > 0.5 ) return through;
  return max( through, 1.0 - smoothstep( 0.0, ${BACKDROP_FOOT.toFixed(3)}, dir.y ) );
}
// The fog's colour over a backdrop in direction \`dir\`: the ground's far edge, which it stands behind, has the same.
vec3 mtmFogBackdropTint( vec3 dir ) {
  return mtmFogTint( mtmFog[ 4 ].rgb, dir ) * mtmFogHere();
}
`;
/** A fragment shader's own place in the steps through the billows (`MTM_FOG_JITTER`): interleaved gradient noise over the picture. */
const JITTER = "#define MTM_FOG_JITTER fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) )";

let installed = false, stock = null;

/** Replace three.js's fog with the volume's, for every material compiled from now on. Does nothing a second time. */
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  const chunks = THREE.ShaderChunk;
  stock = { parsVertex: chunks.fog_pars_vertex, vertex: chunks.fog_vertex, parsFragment: chunks.fog_pars_fragment, fragment: chunks.fog_fragment };
  chunks.fog_pars_vertex = `${stock.parsVertex}\n#ifdef USE_FOG\n\tvarying vec3 vFogView;\n#endif`;
  chunks.fog_vertex = `${stock.vertex}\n#ifdef USE_FOG\n\tvFogView = mvPosition.xyz;\n#endif`;
  chunks.fog_pars_fragment = `${stock.parsFragment}\n#ifdef USE_FOG\n\tvarying vec3 vFogView;\n${JITTER}\n#define MTM_FOG_STATE\n${COMMON}\n#endif`;
  // Off, three.js's own lines run as they are. A material that adds its light to the picture (a lamp's lens, a spark)
  // says so with the define \`MTM_FOG_DIMS\`: fog cannot veil it in the fog's colour, which would add the fog's colour to
  // the picture, and dims it instead, with the volume on or off.
  chunks.fog_fragment = `#ifdef USE_FOG
\t#ifdef MTM_FOG_DIMS
\t\tgl_FragColor.rgb *= 1.0 - ( mtmFog[ 0 ].x > 0.5 ? mtmFogHides( vFogView ) : smoothstep( fogNear, fogFar, vFogDepth ) );
\t#else
\tif ( mtmFog[ 0 ].x > 0.5 ) {
\t\tgl_FragColor.rgb = mtmFogApply( gl_FragColor.rgb, fogColor, vFogView );
\t} else {
${stock.fragment.replace(/#ifdef USE_FOG|#endif\s*$/g, "")}
\t}
\t#endif
\t#ifndef MTM_FOG_TO_BACKDROP
\t\t// Faded into a track's backdrop: see-through by distance.
\t\tgl_FragColor.a *= 1.0 - mtmFogDissolve( length( vFogView ) );
\t#endif
#endif
// An opaque material of the world's drawn blended to fade into a track's backdrop (\`fadesToBackdrop\`): its cover is the
// fog's, by distance, and not its own alpha, which only its cut-out tested. With no fog it is wholly opaque.
#ifdef MTM_FOG_TO_BACKDROP
\tgl_FragColor.a = 1.0;
\t#ifdef USE_FOG
\t\tgl_FragColor.a -= mtmFogDissolve( length( vFogView ) );
\t#endif
#endif`;
  SHARED.mtmCloudNoise.value = cloudNoise();
  SHARED.mtmDetailNoise.value = detailNoise();
  SHARED.mtmFogBillow.value = billowNoise();
  for (const library of Object.values(THREE.ShaderLib)) {
    if (!library.uniforms?.fogColor) continue;
    library.uniforms.mtmFog = SHARED.mtmFog;
    library.uniforms.mtmCloudNoise = SHARED.mtmCloudNoise;
    library.uniforms.mtmDetailNoise = SHARED.mtmDetailNoise;
    library.uniforms.mtmFogFloor = SHARED.mtmFogFloor;
    library.uniforms.mtmFogBillow = SHARED.mtmFogBillow;
    library.uniforms.mtmFogState = SHARED.mtmFogState;
    library.uniforms.mtmFogStateView = SHARED.mtmFogStateView;
    library.uniforms.mtmFogStateEye = SHARED.mtmFogStateEye;
  }
}

/**
 * Have the far fade take an opaque material of the world to a track's backdrop, drawn before the world, instead of to the
 * fog's colour (\`mtmFogDissolve\`): it is drawn blended, by the alpha the fog gives it, which is 1 until the fade
 * begins, and the picture's own alpha is kept. See-through materials fade by their alpha already. Returns the material.
 */
export function fadesToBackdrop(material) {
  if (!material || material.transparent || material.fog === false || material.defines?.MTM_FOG_TO_BACKDROP !== undefined) return material;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.defines = { ...(material.defines ?? {}), MTM_FOG_TO_BACKDROP: "" };
  material.needsUpdate = true;
  return material;
}

/**
 * Have the fog dim a material that adds its light to the picture (a lamp's lens, a spark), instead of veiling it in the
 * fog's colour, which would add the fog's colour to the picture: it is given three.js's fog and the define the fog's
 * lines look for. Returns the material.
 */
export function fogDims(material) {
  material.fog = true;
  material.defines = { ...(material.defines ?? {}), MTM_FOG_DIMS: "" };
  material.needsUpdate = true;
  return material;
}

/**
 * Whether the light the port drew from the start (lamp lenses and cones, sparks, sprites added to the picture) is
 * dimmed by the fog. It is part of "Volumetric weather": off, that light shows through the fog as it first did. A
 * screen that draws a track sets it before it makes its materials.
 */
let lightsInFog = false;
export function setLightsInFog(on) { lightsInFog = !!on; }
export const lightsDimInFog = () => lightsInFog;

/** `fogDims` for light the port drew from the start: with `setLightsInFog` off it is not fogged at all. Returns the material. */
export function classicFogDims(material) {
  if (lightsInFog) return fogDims(material);
  material.fog = false;
  return material;
}

/** The uniforms a shader of the port's own needs to use `ATMOSPHERE_GLSL`: the same state every other material reads. */
export const atmosphereUniforms = () => ({
  mtmFog: SHARED.mtmFog, mtmCloudNoise: SHARED.mtmCloudNoise, mtmDetailNoise: SHARED.mtmDetailNoise, mtmFogFloor: SHARED.mtmFogFloor, mtmFogBillow: SHARED.mtmFogBillow,
  mtmFogState: SHARED.mtmFogState, mtmFogStateView: SHARED.mtmFogStateView, mtmFogStateEye: SHARED.mtmFogStateEye,
});
/** The fog's functions for a shader of the port's own (its uniforms from `atmosphereUniforms`), in a vertex shader. */
export const ATMOSPHERE_GLSL = COMMON;
/** The same for a fragment shader, which steps through the billows each point of the picture its own way and reads the whole slices worked out for the frame (render/fog-state.js). */
export const ATMOSPHERE_FRAGMENT_GLSL = `${JITTER}\n#define MTM_FOG_STATE\n${COMMON}`;

/**
 * For a shader of the port's own that works its fog out at its points and not at every point of the picture: particles,
 * which lie over one another many deep, and ribbons on the ground. It declares what three.js's fog gives a material
 * (`fog: true`, with `veilUniforms`) and `mtmFogVeil`, to be called from the vertex shader.
 */
export const VEIL_GLSL = /* glsl */ `
#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear, fogFar;
${COMMON}
#endif
// The fog over a point at \`viewPosition\` (view space, feet): its colour there, and how much of the point it hides.
vec4 mtmFogVeil( vec3 viewPosition ) {
  #ifdef USE_FOG
    if ( mtmFog[ 0 ].x > 0.5 ) {
      vec4 over = mtmFogOver( fogColor, viewPosition );
      return vec4( over.a > 1e-4 ? over.rgb / over.a : fogColor, over.a );
    }
    return vec4( fogColor, smoothstep( fogNear, fogFar, - viewPosition.z ) );
  #else
    return vec4( 0.0 );
  #endif
}
`;
/** The uniforms `VEIL_GLSL` reads: three.js's fog, which it sets for a material with `fog: true`, and the volume's state. */
export const veilUniforms = () => ({ ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...atmosphereUniforms() });

/**
 * Veil a sky material by the fog (the dome and its cap, which three.js's fog leaves alone):
 * each fragment by the fog along its direction from the eye. Switched off it changes nothing.
 */
export function veilSky(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmosphereUniforms());
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMtmSkyWay;")
      .replace("#include <project_vertex>", "#include <project_vertex>\n\tvMtmSkyWay = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz - cameraPosition;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vMtmSkyWay;\n${JITTER}\n${COMMON}`)
      .replace("#include <fog_fragment>", "gl_FragColor.rgb = mtmFogSky( gl_FragColor.rgb, normalize( vMtmSkyWay ) );");
  };
  material.customProgramCacheKey = () => "mtm-sky-veil";
  return material;
}

/**
 * Veil a backdrop's shader (render/track-scene.js): with the volume on, by the fog between the
 * eye and it; without, by `backdropVeil`, a colour (as the screen shows it) and how much of the
 * backdrop it takes, which is how the dark weathers dim it. Called from the material's own
 * `onBeforeCompile`, whose uniforms must have `backdropVeil` (a Vector4).
 */
export function veilBackdropShader(shader) {
  Object.assign(shader.uniforms, atmosphereUniforms());
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vMtmSkyWay;")
    .replace("#include <project_vertex>", "#include <project_vertex>\n\tvMtmSkyWay = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz - cameraPosition;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\nvarying vec3 vMtmSkyWay;\nuniform vec4 backdropVeil;\nuniform float backdropHaze;\n${JITTER}\n${COMMON}`)
    .replace("#include <fog_fragment>", `{
      vec3 mtmWay = normalize( vMtmSkyWay );
      if ( mtmFog[ 0 ].x > 0.5 ) gl_FragColor.rgb = mix( gl_FragColor.rgb, mtmFogBackdropTint( mtmWay ), mtmFogBackdropHidden( mtmWay, backdropHaze ) );
      else gl_FragColor.rgb = mix( gl_FragColor.rgb, backdropVeil.rgb, backdropVeil.a );
    }`);
}

/** The fog's floor (game/fog-floor.js `buildFogFloor`) as a texture the fog's shader reads: feet, as half floats, repeating with the world. */
export function fogFloorTexture(floor) {
  const data = new Uint16Array(floor.data.length);
  for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(floor.data[i]);
  const texture = new THREE.DataTexture(data, floor.side, floor.side, THREE.RedFormat, THREE.HalfFloatType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const _color = new THREE.Color();
/** Whether colours are being written as light (the lens is drawing) and not encoded for the screen. */
let linear = false;
/** The fog's and the glow's colours as they were given, kept to encode again when the output changes. */
const fogGiven = new THREE.Color(), glowGiven = new THREE.Color();

/**
 * A colour as a material must mix it in after its own colours are encoded: for the screen, or
 * as light while the lens draws. Into `target`, which is returned.
 */
export function screenColor(color, target = new THREE.Color()) {
  target.copy(color);
  return linear ? target : target.getRGB(target, THREE.SRGBColorSpace);
}

function writeColors() {
  screenColor(glowGiven, _color);
  STATE[12] = _color.r; STATE[13] = _color.g; STATE[14] = _color.b;
  screenColor(fogGiven, _color);
  STATE[16] = _color.r; STATE[17] = _color.g; STATE[18] = _color.b;
}

/**
 * The fog as it stands, for whoever sets it (render/weather-volume.js).
 */
export const atmosphere = {
  /** Whether the volume is on. */
  get on() { return STATE[0] > 0.5; },
  /** Whether colours are being written as light, for the lens (render/lens.js). */
  get linear() { return linear; },
  /** Say where the picture's colours are going: `true` into the lens's picture of light, `false` to the screen. */
  output(asLight) {
    if (!!asLight === linear) return;
    linear = !!asLight;
    writeColors();
  },
  /** Switch the volume off: every material fogs as three.js fogs. */
  clear() { STATE.fill(0); this.ahead(); },
  /**
   * Set the volume from game/atmosphere.js `fogVolume` and the scene: `color` the fog's (a
   * THREE.Color), `sun` the way to the sun (scene axes) and `glowColor` its light's colour.
   */
  set(volume, { color, sun, glowColor, glow = volume.glow, sunShare = 1 }) {
    STATE[0] = 1; STATE[1] = volume.densityPerFt; STATE[2] = 1 / volume.scaleHeightFt;
    STATE[4] = volume.fadeStartFt; STATE[5] = volume.farFt; STATE[6] = volume.drift;
    STATE[8] = sun.x; STATE[9] = sun.y; STATE[10] = sun.z; STATE[11] = glow;
    STATE[15] = volume.skyDepth;
    glowGiven.copy(glowColor);
    this.color(color);
    if (STATE[19] < 1) STATE[19] = FOG_BANKS.slices;
    // The banks move with the wind, a little across it.
    STATE[20] = volume.windFtPerS * 0.93; STATE[21] = volume.windFtPerS * 0.37; STATE[22] = 1 / FOG_BANKS.broadFt; STATE[23] = volume.deckFt;
    STATE[24] = volume.reachFt;
    if (STATE[25] < 1) STATE[25] = FOG_TOP.steps;
    // The top, lit as the sun that gets through and how high it stands let it be; a sun under the horizon lights nothing.
    const flat = Math.hypot(sun.x, sun.z);
    STATE[26] = fogTopLit(volume, sunShare * Math.min(1, Math.max(0, sun.y / 0.25)));
    STATE[27] = volume.lightFt;
    STATE[28] = volume.billowFt; STATE[29] = 1 / (volume.billowSizeFt * 5); STATE[30] = Math.min(3, Math.max(0.05, sun.y / Math.max(flat, 1e-3)));
    STATE[31] = volume.dissolve ? 1 : 0;
    STATE[32] = volume.shape.cap; STATE[33] = volume.shape.capFt; STATE[34] = volume.shape.crispFt; STATE[35] = volume.shape.wisps;
  },
  /** Whether the fog has billows, which a fragment steps through its own way (`MTM_FOG_JITTER`). */
  get billows() { return STATE[0] > 0.5 && STATE[28] > 0; },
  /**
   * The picture of the fog along every way from the eye (render/fog-state.js): set once, before any material that reads
   * it is built, since each takes its own copy of the list it is in.
   */
  aheadPicture(texture) { SHARED.mtmFogState.value[0] = texture; },
  /**
   * The picture holds the fog along every way from `eye` for this frame, placed on it by `view` (a Matrix4): a fragment
   * seen from that eye reads its whole slices there. With no eye, every fragment works its fog out as before.
   */
  ahead(eye = null, view = null) {
    const at = SHARED.mtmFogStateEye.value;
    if (!eye) { at[3] = 0; return; }
    SHARED.mtmFogStateView.value.set(view.elements);
    at[0] = eye.x; at[1] = eye.y; at[2] = eye.z; at[3] = 1;
  },
  /** How finely the line of sight is cut for the banks and stepped through the billows: `lite` (a headset, which draws everything twice) the coarser. */
  detail(lite) {
    if (STATE[0] < 0.5) return;
    STATE[19] = lite ? FOG_BANKS.liteSlices : FOG_BANKS.slices;
    STATE[25] = lite ? FOG_TOP.liteSteps : FOG_TOP.steps;
  },
  /** The fog's colour, when it changes (lightning lights it). */
  color(color) {
    fogGiven.copy(color);
    writeColors();
  },
  /** Where the far fade lies, feet: a headset may draw the view in (game/vr/settings.js). */
  range(fadeStartFt, farFt) { STATE[4] = fadeStartFt; STATE[5] = farFt; },
  /**
   * The fog's floor for a track, as a texture (`fogFloorTexture`), or null for none: a floor at
   * height nothing. It is the world's, so it is set once when a track is made.
   */
  floor(texture) { SHARED.mtmFogFloor.value = texture ?? NO_FLOOR; },
  /**
   * Once a frame: the clock the banks drift by, and the fog's floor where the eye stands, feet
   * (game/fog-floor.js), from which the sky's veil and what falls through the air take the
   * layer's top.
   */
  update(dt, floorFt) {
    STATE[7] = (STATE[7] + dt) % 3600;
    if (Number.isFinite(floorFt)) STATE[3] = floorFt + STATE[23];
  },
  /**
   * How deep the fog over an eye at height `eyeY` (feet) lies against the sky, as the shaders' `mtmFogSkyHidden` takes
   * it (the sky's depth times `mtmFogOverhead`): it hides `1 - exp(-veil / sine)` of the sky a line `sine` steep meets.
   * It depends on the eye alone, so a shader that veils many lines (the sky in the water) is given it once a frame. 0
   * with the volume off.
   */
  skyVeil(eyeY) {
    if (STATE[0] < 0.5 || STATE[15] <= 0 || !(STATE[2] > 0)) return 0;
    const shape = { cap: STATE[32], capFt: STATE[33], crispFt: STATE[34], wisps: STATE[35], scaleHeightFt: 1 / STATE[2] };
    return STATE[15] * fogColumn(eyeY - STATE[3], 1, 1e5, shape) / Math.max(fogColumn(-STATE[23], 1, 1e5, shape), 1e-3);
  },
  /**
   * The haze the volume lays on what is far off, for a shader that hazes what it works out at a distance of its own (the
   * land in the water, render/water-reflection.js): how thick it is a foot, and where the far fade starts and ends.
   * Null with the volume off.
   */
  haze() {
    return STATE[0] < 0.5 ? null : { densityPerFt: STATE[1], fadeStartFt: STATE[4], farFt: STATE[5] };
  },
  /** For tests in the browser: the state itself. */
  state: STATE,
};
