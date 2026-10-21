/*
  The tracks tires leave (docs/VISUALS.md, "Tracks"; what leaves which is game/particles.js),
  when "Rich particles" is on.

  A track is a ribbon laid on the ground behind a tire, each piece joined to the last along a
  shared edge, so it bends without gaps. It is drawn as the rut it stands for, not as a print
  on the surface, and by what the tire did to the ground:

   - Earth and mud are pressed dark. The rut darkens the ground that is there, whatever its
     colour, most where the tread's lugs bit and along the foot of its walls. A line many
     trucks have taken is worn darker than one a single truck took.
   - Deep snow is packed: the rut's floor is packed snow in its own shade, bluer than the snow
     around, its walls lean so that the light catches one and leaves the other in shade, and
     its edge is a rim of what the tire pushed aside. This is drawn as snow lit by the scene.
   - Thin snow, which may not show at all, is cut through: the rut darkens what is there, as
     on earth.
   - Ice is scuffed pale, in streaks.
   - Hard ground takes no track from a tire that rolls. One that slides or spins leaves its
     rubber on it, darker the harder it slid.

  It is one of the scene's own lit materials with lines added, so packed snow takes the sun,
  the sky's light, the hills' shadows, the headlights and the fog exactly as the snow beside
  it does, and what only darkens the ground needs none of them. In the classic look, whose
  ground is not lit, the snow in a rut is unlit too.

  The ribbon's points keep the bare ground's height and the depth the snow will settle to, and
  the snow that is down lifts them as it lifts the ground (render/ground-surface.js), so a
  track stays on the snow's surface while the snow deepens.

  The pieces are kept in a ring, and a track lasts until the ring comes round to it
  (game/tire-effects.js `TRACK_POOL`): no clock wipes it. How far round the ring a piece is, and
  so how much of it is shown, is worked out by the graphics card from its place in the ring:
  nothing is written again as tracks fade. Where a tire runs straight over even ground the
  piece it is laying is drawn on instead of a new one begun, so the ring holds more of the track.

  Ruts in deep snow that cross, or run side by side, must make one surface: where two trenches
  cross, both are open; where a tire runs through another's ridge, the ridge is cut. So the
  ploughed snow about the eye is drawn first into one map (`createPloughMap`): each rut writes
  its trench and ridges into it, the deepest cut and the highest ridge kept, and a cut is lower
  than any ridge over it. A rut's lid is then only a window on that: the eye's line through it
  is followed down through the map to where it meets the snow, whichever rut ploughed it. Beyond
  the map each rut is drawn by itself, as a trench of its own seen through its opening, in the
  same shape and colours.

  Nothing of a rut stands over the snow but its ridges, which are the ribbon's own shape. The lid
  lies on the snow's surface, where the trench opens, so what is seen through it is seen where
  the snow is, however far the eye's line could be followed: a lid held over the snow hangs
  there wherever the line falls short.
*/
import * as THREE from "three";
import { PLOUGH, PLOUGH_MAP, RUT, TRACK_FADE_FT, TRACK_KINDS, TRACK_WIDTH_FT, TREAD_REPEAT_FT } from "../game/particles.js";
import { SCOUR, SCOUR_POOL, scourLid, scourLidFt } from "../game/snow-scour.js";
import { TRACK_BREAK_FT, TRACK_FADE_PIECES, TRACK_FADE_SHARE, TRACK_LONGEST_FT, TRACK_ORDER, TRACK_POOL, TRACK_PRESS_SAME, TRACK_STEP_FT, edgeHolds, trackLevel } from "../game/tire-effects.js";
import { detailNoise } from "./noise-textures.js";
import { addShaderHook } from "./shader-hooks.js";

/** A track lies this far over the ground, feet, so the ground does not cut it. */
const LIFT_FT = 0.06;
/** Each piece of track is twelve points: six across it at either end. */
const EACH = 12;
/** The lid over a hollow a truck's body leaves stands this many times its rim's height over the snow: over the highest clump. */
const LID_RAISE = 1.4;
/**
 * Across a rut in the snow, feet from its middle: where its ridges' crests stand, where the lid over its trench ends (the
 * ridge's inner face comes down to the snow there), and where the ridges' feet are.
 */
const CREST_FT = TRACK_WIDTH_FT / 2 - PLOUGH_MAP.rimFt, LID_FT = CREST_FT - PLOUGH.lipFt, FOOT_FT = TRACK_WIDTH_FT / 2 + PLOUGH.bermFt;
/** How hard a tire pressed and how deep the snow settles are kept as whole numbers of this many to the unit. */
const MARK_SCALE = 10000;
/** A tire packs down snow that settles deeper than this, and ploughs it (game/particles.js `PLOUGH`): thinner, it leaves the snow as it lay. */
const PLOUGHS_FT = PLOUGH.packedFt / (1 - PLOUGH.packed);
const glsl = (n) => n.toFixed(4);
/** A hollow a truck's body leaves in the snow (game/snow-scour.js) is drawn as a patch of four by four points, out to its rim's foot. */
const PATCH_SIDE = 4, PATCH_EACH = PATCH_SIDE * PATCH_SIDE, PATCH_REACH_FT = SCOUR.rimFt * 1.6 + 1.2;
/** The highest the rim's clumps stand, against its height: its own clumps, and the pile ahead of a body that slides. */
const RIM_MOST = 1.6 * (1 + SCOUR.pile);
const PATCH_FADE = Math.round(SCOUR_POOL * TRACK_FADE_SHARE);

/** The tread as a texture: 1 where a lug presses. From the game's `TREAD` art, or chevrons of the port's own without it. */
function treadTexture(art) {
  const side = art?.width ?? 64, data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const o = (y * side + x) * 4;
      const lug = art
        ? Math.min(255, Math.max(art.rgba[o], art.rgba[o + 1], art.rgba[o + 2]) * 3)
        : ((y / side) * 4 + Math.abs(x / side - 0.5) * 1.5) % 1 < 0.45 ? 255 : 0;
      data[o] = data[o + 1] = data[o + 2] = lug;
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, side, side, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/*
  What the ruts' material and the ploughed snow's map both work out of a point. \`aTrackMark\` is what the piece was laid
  on (\`TRACK_KINDS\`), how hard the tire pressed and how deep the snow settles there (feet), the last two in
  ten-thousandths, and 1 where it lies on the ice over the level's water; \`uTrack\` the ring's next place, how much of
  the snow is down, and between which distances from the eye tracks fade out (feet).
*/
const TRACK_FUNCTIONS = /* glsl */ `
// The mark as laid: what on, how hard the tire pressed, how deep the snow settles here.
vec3 mtmTrackLaid() { return vec3( aTrackMark.x, aTrackMark.yz / ${MARK_SCALE.toFixed(1)} ); }
// How whole the piece this point is of is, 0 to 1: whole until the ring comes near it, and nothing by the time its place
// is taken (game/tire-effects.js \`trackShown\`). Its place in the ring is its points' (twelve to a piece).
float mtmTrackLife() {
  int behind = ( int( uTrack.x + 0.5 ) - 1 - gl_VertexID / ${EACH} + ${TRACK_POOL} ) % ${TRACK_POOL};
  return clamp( float( ${TRACK_POOL - 1} - behind ) / ${TRACK_FADE_PIECES.toFixed(1)}, 0.0, 1.0 );
}
// The trench a tire leaves in the snow here (game/particles.js \`snowTrench\`): x its floor over the bare ground, y the
// ridges' height over the snow, z how far its floor lies under their tops. As the track fades the snow fills it in.
vec3 mtmTrackTrench() {
  vec3 laid = mtmTrackLaid();
  float snowKind = 1.0 - step( 0.5, abs( laid.x - ${glsl(TRACK_KINDS.snow)} ) );
  float settled = mtmTrackLife() * snowKind;
  float snow = laid.z * uTrack.y;
  float floorFt = min( snow, ${glsl(PLOUGH.packedFt)} + ${glsl(PLOUGH.packed)} * snow );
  float berm = ${glsl(PLOUGH.berm)} * ( snow - floorFt ) * clamp( laid.y, 0.0, 1.0 ) * settled;
  return vec3( floorFt, berm, snow + berm - mix( snow, floorFt, settled ) );
}
`;
const VERTEX_PARS = /* glsl */ `
attribute vec4 aTrackMark;
// the way across the track, in the scene's x and z
attribute vec2 aTrackAcross;
// the ground's lie under the piece; w, which of the track's parts a point is of: the ridge of snow on its left (-1) or
// right (1), or the rut itself (0)
attribute vec4 aTrackLie;
uniform vec4 uTrack;
// 1 while the level's water is ice
uniform float uTrackIce;
varying vec2 vTrackUv;
varying vec4 vTrackMark;
varying vec3 vTrackAcross;
varying vec3 vTrackWorld;
varying vec2 vTrackAcrossWorld;
varying float vTrackDeep;
// how high this point of the ribbon stands over the snow (feet), and how deep the snow is now
varying vec2 vTrackOver;
// how high the ridges either side of the rut stand over the snow here (feet)
varying float vTrackRidge;
${TRACK_FUNCTIONS}
`;
/*
  The snow that is down lifts a track as it lifts the ground. A rut in deep snow lies on the snow's surface, the lid over
  its trench, and nothing of it stands over the snow but its ridges, which are the ribbon's own shape: their feet and the
  lid's edges on the snow, their crests raised by the ridge's height. So whatever is seen through the lid is seen at the
  snow's surface, where the trench opens, and never hangs over the ground.
*/
const VERTEX_LIFT = /* glsl */ `
  vec3 trackTrench = mtmTrackTrench();
  float trackSnow = mtmTrackLaid().z * uTrack.y;
  float trackPart = abs( aTrackLie.w );
  float trackRaise = trackPart > 0.25 && trackPart < 0.75 ? trackTrench.y : 0.0;
  transformed.y += trackSnow + ${glsl(LIFT_FT)} + trackRaise;
  // How far the trench's floor lies under the snow's surface.
  vTrackDeep = trackTrench.z - trackTrench.y;
  vTrackOver = vec2( ${glsl(LIFT_FT)} + trackRaise, trackSnow );
  vTrackRidge = trackTrench.y;
`;
/* In place of three.js's normal: the ground's lie under the piece. How a ridge leans is worked out where it is drawn. */
const NORMAL_LEAN = /* glsl */ `
  vec3 objectNormal = aTrackLie.xyz;
`;
const VERTEX = /* glsl */ `
  vTrackUv = uv;
  vTrackWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vTrackAcrossWorld = aTrackAcross;
  // It is whole until the ring comes round near it, and then fades; far off it is not drawn. One on the ice goes with
  // the ice when it thaws.
  float trackShown = mtmTrackLife() * ( 1.0 - smoothstep( uTrack.z, uTrack.w, length( mvPosition.xyz ) ) ) * ( 1.0 - step( 0.5, aTrackMark.w ) * ( 1.0 - uTrackIce ) );
  vTrackMark = vec4( mtmTrackLaid(), trackShown );
  vTrackAcross = normalize( normalMatrix * vec3( aTrackAcross.x, 0.0, aTrackAcross.y ) );
  if ( trackShown <= 0.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
`;

/*
  The ploughed snow's map (`createPloughMap`) as what is drawn over the snow reads it: the ruts' lids, and the hollows a
  truck's body leaves. Each point of the map holds the highest ridge (r), 4 ft less the deepest cut (g), how much a
  body has scoured the snow there (b, 0 to 1) and how it is scored (a).
*/
const PLOUGH_GLSL = /* glsl */ `
#ifdef TRACK_PLOUGH
  // The map, and where it lies: its corner (scene x, z), whether it is drawn, 1 / its width.
  uniform sampler2D uPlough;
  uniform vec4 uPloughAt;
  vec4 trackMap( vec2 xz ) { return texture2D( uPlough, ( xz - uPloughAt.xy ) * uPloughAt.w ); }
  // How high the snow stands at scene (x, z) over the snow that lay there, feet, as the ruts and the hollows have left
  // it: the highest ridge, cut down by the deepest cut.
  float trackPloughed( vec2 xz ) {
    vec4 f = trackMap( xz );
    return min( f.r, 4.0 - f.g );
  }
  // How much anything has touched the snow at scene (x, z), 0 to 1: none where the map holds nothing.
  float trackTouched( vec2 xz ) {
    vec4 f = trackMap( xz );
    return clamp( max( max( f.r, f.g * 0.1 ), f.b ) / 0.02, 0.0, 1.0 );
  }
  // How far along the eye's line \`ray\`, through a lid at \`world\` standing \`over\` feet over snow \`snow\` deep, it
  // meets the snow, as the map has it: in steps, then halving the last step. The snow lay level under the lid, so how
  // high the line is over it is how far it has come down.
  float trackMarch( vec3 world, vec3 ray, float over, float snow ) {
    float down = max( - ray.y, 0.03 );
    float reach = min( ( over + snow + 0.05 ) / down, ${glsl(PLOUGH_MAP.reachFt)} );
    float ploughNear = 0.0, ploughFar = 0.0;
    if ( trackPloughed( world.xz ) < over ) {
      ploughFar = reach;
      for ( int i = 1; i <= ${PLOUGH_MAP.steps}; i ++ ) {
        float s = reach * float( i ) / ${glsl(PLOUGH_MAP.steps)};
        if ( over - down * s <= trackPloughed( world.xz + ray.xz * s ) ) { ploughFar = s; break; }
        ploughNear = s;
      }
      for ( int i = 0; i < ${PLOUGH_MAP.refine}; i ++ ) {
        float s = 0.5 * ( ploughNear + ploughFar );
        if ( over - down * s <= trackPloughed( world.xz + ray.xz * s ) ) ploughFar = s; else ploughNear = s;
      }
    }
    return ploughFar;
  }
  // The snow's lie at scene (x, z), from the map's slope (the scene mirrors nothing here: the map is laid in the scene's
  // own x and z).
  vec3 trackPloughNormal( vec2 at ) {
    const float e = ${glsl(PLOUGH_MAP.texelFt * 1.5)};
    return normalize( vec3( trackPloughed( at - vec2( e, 0.0 ) ) - trackPloughed( at + vec2( e, 0.0 ) ), 2.0 * e,
      trackPloughed( at - vec2( 0.0, e ) ) - trackPloughed( at + vec2( 0.0, e ) ) ) );
  }
#endif
`;
/*
  A hollow a truck's body leaves in the snow (game/snow-scour.js `SCOUR`), as its patch, the map and the lids over it
  have it. Its shape: a rectangle with rounded corners, its edge ragged by the snow (a noise of the world, so the edges
  of hollows laid one over another agree); its floor lumpy, its wall as steep as the snow will stand, and round it a rim
  in clumps of the snow it pushed out. Inside, the snow is pressed smooth, greyer and bluer than fresh snow, scored the
  way the body went, with clumps of broken crust left about it, and where the body went down to the ground the ground
  shows through, wet.
*/
const SCOUR_GLSL = /* glsl */ `
// the ground's own colour, as it shows where a body has scoured the snow down to it
uniform vec3 uScourGround;
// How far a point \`at\` feet from a hollow's middle (along it, across it) lies outside its edge, feet (less than nothing
// inside): a rectangle \`extent\` feet in half, its corners rounded, its edge ragged by the snow at scene \`xz\`, in and
// out over a few inches and over many feet (less so for a small hollow, which would be lost in it).
float scourEdge( vec2 at, vec2 extent, vec2 xz ) {
  float round_ = min( min( extent.x, extent.y ), ${glsl(SCOUR.roundFt)} );
  vec2 q = abs( at ) - extent + round_;
  float s = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - round_;
  float ragged = ( texture2D( uTrackGrain, xz / 2.6 ).a - 0.5 ) * 0.8 + ( texture2D( uTrackGrain, xz / 8.3 ).g - 0.5 ) * 1.1
    + ( texture2D( uTrackGrain, xz / 23.0 + 0.53 ).r - 0.5 ) * 1.3;
  return s + ragged * clamp( extent.y / 2.5, 0.35, 1.0 );
}
// The snow's surface in and about a hollow \`depth\` feet deep, against the snow that lay, feet, at \`s\` from its edge,
// \`ahead\` how far ahead of a sliding body the point lies (0 to 1): x the surface, y the rim alone, z the cut alone
// (rising steeply outside the edge, so that the rim is what is there). The floor is lumpy, with clumps of broken crust
// standing in it; the rim is clumps, piled higher ahead.
vec3 scourSurface( float s, float depth, vec2 xz, float ahead ) {
  float wall = clamp( depth * 1.6, 0.3, 1.0 );
  float lumps = 0.75 + 0.5 * texture2D( uTrackGrain, xz / 3.3 ).r;
  float crust = smoothstep( 0.68, 0.75, texture2D( uTrackGrain, xz / 4.3 + 0.17 ).b ) * smoothstep( 0.3, 0.6, texture2D( uTrackGrain, xz / 3.7 ).g );
  float cut = s < 0.0 ? ( - depth * lumps + crust * min( depth * 0.4, 0.15 ) ) * smoothstep( 0.0, wall, - s ) : s * 4.0;
  float top = depth * ${glsl(SCOUR.rim)} * ( 0.4 + 1.2 * texture2D( uTrackGrain, xz / 1.4 ).b ) * ( 1.0 + ${glsl(SCOUR.pile)} * ahead );
  float rim = top * exp( - pow( ( s - ${glsl(0.35 * SCOUR.rimFt)} ) / ${glsl(0.4 * SCOUR.rimFt)}, 2.0 ) );
  return vec3( min( rim, cut ), rim, cut );
}
// How far ahead of a body that slid the way \`way\` (along the hollow and across it) a point \`at\` from its middle lies, 0 to 1.
float scourAhead( vec2 at, vec2 way ) { return dot( way, way ) < 0.25 ? 0.0 : smoothstep( 0.2, 0.9, dot( normalize( at ), normalize( way ) ) ); }
// How much of the hollow a point \`s\` from its edge is: its floor and its wall, 0 to 1.
float scourIn( float s ) { return smoothstep( 0.25, -0.2, s ); }
// How deeply scored the snow is at scene \`xz\` by a body that went the way \`drag\` (scene x, z; none where it went
// straight in): lines along the way it went, fine and coarse.
float scourStreak( vec2 xz, vec2 drag ) {
  if ( dot( drag, drag ) < 0.25 ) return 0.0;
  vec2 way = normalize( drag );
  float across = dot( xz, vec2( - way.y, way.x ) ), along = dot( xz, way );
  return max( smoothstep( 0.55, 0.85, texture2D( uTrackGrain, vec2( across / 0.8, along / 70.0 ) ).r ),
    0.6 * smoothstep( 0.6, 0.9, texture2D( uTrackGrain, vec2( across / 2.3 + 0.37, along / 110.0 ) ).g ) );
}
// The colour of the snow in a hollow at scene \`xz\`, scored \`streak\`, \`h\` feet under the snow's surface where the
// snow is \`snow\` thick.
vec3 scourTone( float streak, float h, float snow, vec2 xz ) {
  vec4 fine = texture2D( uTrackGrain, xz / 3.7 ), broad = texture2D( uTrackGrain, xz / 13.0 + 0.31 );
  // Pressed smooth, a shade greyer and bluer than fresh snow, unevenly, and scored faintly the way the body went.
  vec3 pressed = vec3( 0.74, 0.8, 0.89 ) * ( 0.92 + 0.08 * broad.r + 0.05 * fine.r ) * ( 1.0 - 0.1 * streak );
  // Where the body went down to the ground, the ground shows through here and there, smeared with snow: drawn out
  // along the scoring where the body slid.
  float bare = smoothstep( 0.75, 0.95, - h / max( snow, 0.05 ) ) * smoothstep( 0.52, 0.7, broad.a * 0.5 + streak * 0.35 + fine.a * 0.15 );
  pressed = mix( pressed, mix( uScourGround, pressed, 0.5 ), bare );
  // Clumps of the crust it broke, left lying in it.
  float clump = smoothstep( 0.68, 0.75, texture2D( uTrackGrain, xz / 4.3 + 0.17 ).b ) * smoothstep( 0.3, 0.6, fine.g );
  return mix( pressed, vec3( 0.9, 0.93, 0.97 ), clump * 0.6 );
}
`;
/*
  The colour of ploughed snow, the same whichever way it is found (through the map, or a rut by itself beyond it): met
  `below` feet under the snow's surface or `above` it, on the trench's packed floor (`floored`, 0 to 1) or its
  wall, with the tread pressed `lug` deep there and the snow's grain `grain`. The floor is packed snow in its own
  shade with the tread pressed in it; the walls are pressed rough; what stands over the snow is fresh, in clumps. The
  further down, the less of the sky is seen.
*/
const SNOW_TONE_GLSL = /* glsl */ `
vec3 trackFreshSnow( float grain ) { return vec3( 0.93, 0.95, 0.99 ) * ( 0.86 + 0.16 * grain ); }
vec3 trackSnowTone( float below, float above, float floored, float lug, float grain ) {
  vec3 tone = mix( vec3( 0.8, 0.86, 0.95 ) * ( 0.85 + 0.2 * grain ), mix( vec3( 0.66, 0.73, 0.85 ), vec3( 0.5, 0.58, 0.74 ), lug * ( 0.45 + 0.4 * grain ) ), floored );
  tone = mix( tone, trackFreshSnow( grain ), smoothstep( 0.0, 0.06, above ) );
  return tone * ( 1.0 - 0.3 * smoothstep( 0.0, 1.2, below ) );
}
`;
const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uTrackTread, uTrackGrain;
varying vec2 vTrackUv;
varying vec4 vTrackMark;
varying vec3 vTrackAcross;
varying vec3 vTrackWorld;
varying vec2 vTrackAcrossWorld;
varying float vTrackDeep;
varying vec2 vTrackOver;
varying float vTrackRidge;
${PLOUGH_GLSL}
${SCOUR_GLSL}
${SNOW_TONE_GLSL}
`;
/*
  In place of three.js's read of the map. A rut does two things to the picture: it darkens what is there
  (`trackDark`, 0 to 1), and it lays its own lit colour over it (`trackTone`, over `trackCover` of it).
*/
const ALBEDO = /* glsl */ `
  trackFog();
  float trackU = vTrackUv.x;
  // The floor of the rut, and a rim outside it.
  float trackIn = smoothstep( 0.02, 0.2, trackU ) * smoothstep( 0.98, 0.8, trackU );
  float trackRim = min( exp( - pow( ( trackU - 0.04 ) / 0.045, 2.0 ) ) + exp( - pow( ( trackU - 0.96 ) / 0.045, 2.0 ) ), 1.0 );
  // Where its walls stand: toward the middle from either side.
  float trackLeft = exp( - pow( ( trackU - 0.12 ) / 0.08, 2.0 ) ), trackRight = exp( - pow( ( trackU - 0.88 ) / 0.08, 2.0 ) );
  float trackLug = texture2D( uTrackTread, vTrackUv ).r;
  float trackKind = vTrackMark.x, trackPress = vTrackMark.y * vTrackMark.w;
  vec3 trackTone = vec3( 1.0 ), trackFace = vec3( 0.0, 1.0, 0.0 );
  float trackCover = 0.0, trackDark = 0.0, trackLid = 0.0;
  if ( trackKind < ${glsl(TRACK_KINDS.dust + 0.5)} ) {
    // Earth pressed dark, darkest where the lugs bit and at the foot of the walls.
    trackDark = trackIn * mix( ${glsl(RUT.earth[0])}, ${glsl(RUT.earth[1])}, trackLug ) + ${glsl(RUT.wall)} * ( trackLeft + trackRight );
  } else if ( trackKind < ${glsl(TRACK_KINDS.snow + 0.5)} ) {
    // Where the snow will settle thin (and may not show at all, render/ground-surface.js) the tire is through it: there
    // it darkens what is there, as on earth. Where it lies deep the tire ploughs it: a trench between ridges.
    float trackThin = 1.0 - smoothstep( ${glsl(RUT.thinSnowFt[0])}, ${glsl(RUT.thinSnowFt[1])}, vTrackMark.z );
    // Within the map, the snow as the map has it; at its edge, the two, one into the other.
    float trackMapped = 0.0;
    #ifdef TRACK_PLOUGH
      vec2 ploughUv = ( vTrackWorld.xz - uPloughAt.xy ) * uPloughAt.w;
      vec2 ploughEdge = min( ploughUv, 1.0 - ploughUv );
      trackMapped = uPloughAt.z * smoothstep( 0.01, ${glsl(PLOUGH_MAP.edge)}, min( ploughEdge.x, ploughEdge.y ) );
    #endif
    // How far from the rut's middle, feet, and on which side.
    float trackOut = abs( trackU - 0.5 ) * ${glsl(TRACK_WIDTH_FT)}, trackSide = trackU < 0.5 ? - 1.0 : 1.0;
    vec3 trackAcross3 = normalize( vec3( vTrackAcrossWorld.x, 0.0, vTrackAcrossWorld.y ) );
    if ( trackOut > ${glsl(LID_FT + 0.001)} ) {
      // A ridge of the snow the tire pushed aside, which is the ribbon's own shape here: fresh and in clumps, running
      // into the snow at its foot, and lit as it leans, out from its crest on the one side and in to the rut on the other.
      vec4 trackClumps = texture2D( uTrackGrain, vTrackWorld.xz / 2.3 );
      trackTone = trackFreshSnow( trackClumps.r );
      float trackFoot = ( trackOut - ${glsl(CREST_FT)} ) / ${glsl(FOOT_FT - CREST_FT)};
      trackCover = ( 1.0 - smoothstep( 0.55, 1.0, trackFoot + ( trackClumps.a - 0.5 ) * 0.5 ) ) * ( 1.0 - trackThin );
      // (Its crest is rounded, and its inner face, which is all but upright, is lit as no steeper than one in one.)
      float trackLean = mix( - min( vTrackRidge / ${glsl(PLOUGH.lipFt)}, 1.0 ), vTrackRidge / ${glsl(FOOT_FT - CREST_FT)}, smoothstep( ${glsl(CREST_FT - 0.1)}, ${glsl(CREST_FT + 0.1)}, trackOut ) )
        * ( 1.0 - smoothstep( 0.7, 1.0, trackFoot ) );
      trackFace = trackAcross3 * ( trackSide * trackLean ) + vec3( trackClumps.g - 0.5, 0.0, trackClumps.b - 0.5 ) * 0.9;
      trackLid = 2.0;
      #ifdef TRACK_PLOUGH
        // Where another rut's trench, or a hollow, has cut this ridge, it is gone: the map has the snow there lower than
        // this rut's own wall ever is under its ridge.
        trackCover *= mix( 1.0, smoothstep( -0.3, -0.14, trackPloughed( vTrackWorld.xz ) ), trackMapped );
      #endif
    } else {
      if ( trackMapped < 0.999 ) {
        // The trench by itself, seen through its opening in the snow's surface: the eye's line followed down into it
        // meets its packed floor, or a wall.
        vec3 trenchRay = normalize( vTrackWorld - cameraPosition );
        float trenchDown = max( - trenchRay.y, 0.04 );
        float trenchAside = dot( trenchRay, trackAcross3 ) / trenchDown;
        float trenchOn = dot( trenchRay, cross( vec3( 0.0, 1.0, 0.0 ), trackAcross3 ) ) / trenchDown;
        float trenchAt = ( trackU - 0.5 ) * ${glsl(TRACK_WIDTH_FT)}, trenchDeep = vTrackDeep;
        // Its rims are ragged: each stands in from the lid's edge by its own amount along the way, as the map has them.
        float trenchRimL = ${glsl(LID_FT)} - ${glsl(PLOUGH_MAP.raggedFt)} * texture2D( uTrackGrain, vec2( vTrackUv.y * 0.31, 0.21 ) ).a;
        float trenchRimR = ${glsl(LID_FT)} - ${glsl(PLOUGH_MAP.raggedFt)} * texture2D( uTrackGrain, vec2( vTrackUv.y * 0.31, 0.63 ) ).a;
        float trenchFloorL = max( 0.05, trenchRimL - trenchDeep * ${glsl(PLOUGH.wallLean)} ), trenchFloorR = max( 0.05, trenchRimR - trenchDeep * ${glsl(PLOUGH.wallLean)} );
        float trenchHit = trenchDeep, trenchHitAt = trenchAt + trenchDeep * trenchAside;
        vec3 trenchFace = vec3( 0.0, 1.0, 0.0 );
        bool trenchOut = trenchAt < - trenchRimL || trenchAt > trenchRimR;
        if ( trenchOut ) {
          // Beyond the rim: the foot of the ridge, on the snow.
          trenchHit = 0.0;
          trenchHitAt = trenchAt;
        } else if ( trenchHitAt < - trenchFloorL || trenchHitAt > trenchFloorR ) {
          // A wall: the one the line runs toward, leaning out as it rises.
          float trenchSide = trenchAside < 0.0 ? - 1.0 : 1.0;
          trenchHit = clamp( ( trenchSide * ( trenchSide < 0.0 ? trenchRimL : trenchRimR ) - trenchAt ) / ( trenchAside + trenchSide * ${glsl(PLOUGH.wallLean)} ), 0.0, trenchDeep );
          trenchHitAt = trenchAt + trenchHit * trenchAside;
          // (Lit as the map's slope would have it, which is taken across more than the wall's width.)
          trenchFace = normalize( vec3( 0.0, ${glsl(PLOUGH_MAP.wallLit)}, 0.0 ) - trackAcross3 * trenchSide );
        }
        // Where the line meets it, in the world, for the snow's own grain there.
        vec3 trenchPoint = vTrackWorld + trenchRay * ( trenchHit / trenchDown );
        vec4 trenchGrain = texture2D( uTrackGrain, trenchPoint.xz / 1.7 );
        float trenchLug = texture2D( uTrackTread, vec2( trenchHitAt / ${glsl(TRACK_WIDTH_FT)} + 0.5, vTrackUv.y + trenchHit * trenchOn / ${glsl(TREAD_REPEAT_FT)} ) ).r;
        bool trenchFloor = ! trenchOut && trenchHit >= trenchDeep - 1e-3;
        trackTone = trackSnowTone( trenchHit, trenchOut ? 1.0 : 0.0, trenchFloor ? 1.0 : 0.0, trenchLug, trenchGrain.r );
        trenchFace = normalize( trenchFace + vec3( trenchGrain.g - 0.5, 0.0, trenchGrain.b - 0.5 ) * ( trenchFloor ? 0.25 : 0.6 ) );
        trackCover = 1.0 - trackThin;
        trackLid = 1.0;
        trackFace = normalize( ( viewMatrix * vec4( trenchFace, 0.0 ) ).xyz );
      }
      #ifdef TRACK_PLOUGH
      if ( trackMapped > 0.001 ) {
        // The eye's line through the lid followed down through the map to where it meets the snow, and the snow's lie there.
        vec3 ploughRay = normalize( vTrackWorld - cameraPosition );
        vec2 ploughAt = vTrackWorld.xz + ploughRay.xz * trackMarch( vTrackWorld, ploughRay, vTrackOver.x, vTrackOver.y );
        float ploughH = trackPloughed( ploughAt );
        vec3 ploughN = trackPloughNormal( ploughAt );
        vec4 ploughGrain = texture2D( uTrackGrain, ploughAt / 1.7 );
        float ploughBelow = max( - ploughH, 0.0 ), ploughAbove = max( ploughH, 0.0 );
        // The tread pressed in the floor, read where the line met it, across and along the rut whose lid this is.
        vec2 ploughAcross = normalize( vTrackAcrossWorld ), ploughOff = ploughAt - vTrackWorld.xz;
        float ploughLug = texture2D( uTrackTread, vec2( trackU + dot( ploughOff, ploughAcross ) / ${glsl(TRACK_WIDTH_FT)},
          vTrackUv.y + dot( ploughOff, vec2( ploughAcross.y, - ploughAcross.x ) ) / ${glsl(TREAD_REPEAT_FT)} ) ).r;
        float ploughFloor = smoothstep( 0.8, 0.95, ploughN.y ) * smoothstep( 0.03, 0.12, ploughBelow );
        vec3 ploughTone = trackSnowTone( ploughBelow, ploughAbove, ploughFloor, ploughLug, ploughGrain.r );
        // Where a truck's body has scoured the snow (\`SCOUR_GLSL\`), it is as the body left it, whichever rut crossed it.
        vec4 ploughMap = trackMap( ploughAt );
        ploughTone = mix( ploughTone, scourTone( ploughMap.a, ploughH, vTrackOver.y, ploughAt ), ploughMap.b );
        vec3 ploughFace = normalize( ploughN + vec3( ploughGrain.g - 0.5, 0.0, ploughGrain.b - 0.5 ) * mix( 0.6, 0.25, max( ploughFloor, ploughMap.b ) ) );
        // Snow the ruts have not touched is the ground's own, drawn already: there the lid shows nothing.
        float ploughCover = trackTouched( ploughAt ) * ( 1.0 - trackThin );
        trackTone = mix( trackTone, ploughTone, trackMapped );
        trackCover = mix( trackCover, ploughCover, trackMapped );
        if ( trackMapped > 0.5 ) {
          trackLid = 1.0;
          trackFace = normalize( ( viewMatrix * vec4( ploughFace, 0.0 ) ).xyz );
        }
      }
      #endif
    }
    #ifdef TRACK_SNOW_LINE
      // Ploughed snow is drawn only where the ground under it is drawn as snow: where the snow does not show
      // (render/ground-surface.js \`gfxSnowShown\`), a ridge of it would stand white on the bare ground.
      vec2 trackGround = vec2( vTrackWorld.x, - vTrackWorld.z );
      trackCover *= gfxSnowShown( trackGround, vTrackMark.z * uGfx.z, texture2D( uGfxNoise, trackGround / 41.0 ), texture2D( uGfxNoise, trackGround / 430.0 ) ).x;
    #endif
    trackDark = trackThin * ( trackIn * mix( ${glsl(RUT.earth[0])}, ${glsl(RUT.earth[1])}, trackLug ) + ${glsl(RUT.wall)} * ( trackLeft + trackRight ) );
  } else if ( trackKind < ${glsl(TRACK_KINDS.mud + 0.5)} ) {
    // Mud: pressed darker and wetter than the wet ground.
    trackDark = trackIn * mix( ${glsl(RUT.mud[0])}, ${glsl(RUT.mud[1])}, trackLug ) + ${glsl(RUT.wall)} * ( trackLeft + trackRight );
  } else if ( trackKind < ${glsl(TRACK_KINDS.ice + 0.5)} ) {
    // Ice scuffed pale, in streaks along the way.
    trackTone = vec3( 0.84, 0.9, 0.94 );
    trackCover = trackIn * ( 0.08 + 0.3 * texture2D( uTrackTread, vec2( trackU * 3.0, vTrackUv.y * 0.06 ) ).r );
  } else {
    // Rubber a sliding tire leaves on hard ground: dark, drawn out along the slide, with no tread in it. How hard it
    // slid is how hard it pressed.
    trackDark = trackIn * ${glsl(RUT.rubber)} * ( 0.6 + 0.4 * texture2D( uTrackTread, vec2( trackU * 2.0, vTrackUv.y * 0.05 ) ).r );
  }
  trackCover *= trackPress;
  trackDark = min( trackDark * trackPress, 0.9 );
  #ifdef TRACK_POOLS
    // Under standing water a rut is seen through it, the less the deeper it lies: the water's face, which the ground has
    // drawn already, lies over it (render/ground-surface.js).
    vec2 trackPool = gfxPoolAt( vec2( vTrackWorld.x, - vTrackWorld.z ) );
    float trackUnder = trackPool.x * mix( ${glsl(RUT.underWater[0])}, ${glsl(RUT.underWater[1])}, smoothstep( 0.0, ${glsl(RUT.underWaterFt)}, trackPool.y ) );
    trackCover *= 1.0 - trackUnder;
    trackDark *= 1.0 - trackUnder;
  #endif
  diffuseColor = vec4( trackTone, 1.0 );
  // A rut that lays no colour of its own (earth, mud, rubber, thin snow) only darkens what is there: its own light would be
  // given none of the picture (\`OUTPUT\`), so it is not worked out. The most of the ruts on most ground.
  if ( trackCover <= 0.0 ) {
    gl_FragColor = trackOutput( vec3( 0.0 ), 0.0, trackDark );
    return;
  }
`;
/* What the eye meets in a trench in the snow takes the light as it faces. */
const NORMAL = "\tif ( trackLid > 1.5 ) normal = normalize( normal + ( viewMatrix * vec4( trackFace, 0.0 ) ).xyz ); else if ( trackLid > 0.5 ) normal = trackFace;";
/*
  Last of all: what is given to the picture. It is blended as "this, plus what is there times that": the rut's own lit
  colour over its share, and what is there kept by the rest and darkened.

  What is there is the ground seen through the fog, and the fog itself. Only the ground's share may be darkened, or a
  rut would stand out of the fog as a dark line: so the fog's own share, which the darkening took with it, is given
  back. (What is there, darkened, plus the fog's share of the darkening: exactly the darkened ground seen through the
  same fog.) The darkening is taken in the picture's own encoding, so a rut is as dark through the lens as without it.
*/
const OUTPUT_GLSL = /* glsl */ `
// The fog as a volume between the eye and the point (render/atmosphere.js \`mtmFogOver\`), worked out once (\`trackFog\`,
// first thing) for the two that lay it on: three.js's fog line over the rut's own colour (\`FOG_ONCE\`), and \`trackOutput\`
// over what is there. Each working it out for itself, a shader held the fog's loops two and three times over, too much
// for the graphics card to shade sixteen pixels at a time (Intel HD 630), and a pixel worked it out twice.
vec4 trackFogged = vec4( 0.0 );
void trackFog() {
  #ifdef USE_FOG
    if ( mtmFog[ 0 ].x > 0.5 ) trackFogged = mtmFogOver( fogColor, vFogView );
  #endif
}
// What is given to the picture: \`lit\` the rut's own lit colour over \`cover\` of the point, and what is there darkened by \`dark\`.
vec4 trackOutput( vec3 lit, float cover, float dark ) {
  vec4 fog = vec4( 0.0 );
  #ifdef USE_FOG
    if ( mtmFog[ 0 ].x > 0.5 ) fog = trackFogged;
    else fog = vec4( fogColor, 1.0 ) * smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float keep = linearToOutputTexel( vec4( vec3( 1.0 - dark ), 1.0 ) ).r;
  return vec4( lit * cover + ( 1.0 - cover ) * ( 1.0 - keep ) * fog.rgb, ( 1.0 - cover ) * keep );
}
`;
const OUTPUT = "\tgl_FragColor = trackOutput( gl_FragColor.rgb, trackCover, trackDark );";
/** three.js's fog line as render/atmosphere.js has it, laying on the fog `trackFog` worked out instead of working it out again. */
const FOG_ONCE = () => THREE.ShaderChunk.fog_fragment.replace("mtmFogApply( gl_FragColor.rgb, fogColor, vFogView )", "gl_FragColor.rgb * ( 1.0 - trackFogged.a ) + trackFogged.rgb");

/*
  The ploughed snow's map. Each piece of rut in deep snow is drawn into it flat, from above, and writes two numbers, of
  which the map keeps the larger each: red, how high its ridges stand over the snow; green, 4 ft less how low its
  trench lies (so the deepest is kept). Across a rut (its texture's u), from its middle out: the packed floor, a wall
  that leans out as it rises, the rim, standing as high as the ridges, and the ridge falling away to nothing.
*/
const PLOUGH_VERTEX = /* glsl */ `
attribute vec4 aTrackMark;
uniform vec4 uTrack;
uniform vec4 uPloughAt;
varying float vPloughU;
varying vec2 vPloughWorld;
// how deep the trench lies under the snow, and how high the ridges stand over it (feet)
varying vec2 vPloughCut;
${TRACK_FUNCTIONS}
void main() {
  vec3 laid = mtmTrackLaid();
  float snowKind = 1.0 - step( 0.5, abs( laid.x - ${glsl(TRACK_KINDS.snow)} ) );
  vec3 trench = mtmTrackTrench();
  float snow = laid.z * uTrack.y;
  vPloughCut = vec2( snow - trench.x, trench.y ) * snowKind;
  vPloughCut.x *= mtmTrackLife();
  vPloughU = uv.x;
  vPloughWorld = position.xz;
  vec2 at = ( position.xz - uPloughAt.xy ) * uPloughAt.w * 2.0 - 1.0;
  gl_Position = snowKind > 0.5 && vPloughCut.x > 0.005 ? vec4( at, 0.0, 1.0 ) : vec4( 2.0, 2.0, 2.0, 1.0 );
}`;
const PLOUGH_FRAGMENT = /* glsl */ `
uniform sampler2D uTrackGrain;
varying float vPloughU;
varying vec2 vPloughWorld;
varying vec2 vPloughCut;
void main() {
  float out_ = abs( vPloughU - 0.5 ) * ${glsl(TRACK_WIDTH_FT)};
  // Its rims are ragged, each its own way along the rut.
  float rim = ${glsl(TRACK_WIDTH_FT / 2 - PLOUGH_MAP.rimFt)} - ${glsl(PLOUGH_MAP.raggedFt)} * texture2D( uTrackGrain, vPloughWorld / 3.1 ).a;
  // The wall leans out as it rises, and is the tire's rounded shoulder however shallow the rut.
  float floorHalf = max( 0.05, rim - max( ( vPloughCut.x + vPloughCut.y ) * ${glsl(PLOUGH.wallLean)}, ${glsl(PLOUGH_MAP.shoulderFt)} ) );
  // 1 on the floor, 0 at the rim.
  float wall = smoothstep( rim, floorHalf, out_ );
  float top = vPloughCut.y * mix( ${glsl(PLOUGH_MAP.clumps[0])}, ${glsl(PLOUGH_MAP.clumps[1])}, texture2D( uTrackGrain, vPloughWorld / 2.3 ).r );
  float ridge = out_ <= rim ? top : top * smoothstep( rim + ${glsl(PLOUGH.bermFt)}, rim, out_ );
  // Past the rim the trench's own height goes on rising steeply, so that between the map's points it never jumps.
  float trench = 4.0 - ( out_ <= rim ? mix( top, - vPloughCut.x, wall ) : min( top + ( out_ - rim ) * 4.0, 4.0 ) );
  gl_FragColor = vec4( ridge, trench, 0.0, 0.0 );
}`;

/*
  The hollows a truck's body leaves in the snow (game/snow-scour.js), each a patch of points over it. \`aScourAt\` is a
  point's place from the hollow's middle, feet, along it and across it; \`aScourShape\` the hollow's half length and half
  width, how deep it went (feet) and how deep the snow settles at the point; \`aScourDrag\` the way the body went (scene x,
  z, and along the hollow and across it), or nothing where it went straight in. \`uScour\` holds the ring's next place.
*/
const PATCH_FUNCTIONS = /* glsl */ `
// How whole the hollow this point is of is, 0 to 1, as the tracks are (\`mtmTrackLife\`).
float mtmScourLife() {
  int behind = ( int( uScour.x + 0.5 ) - 1 - gl_VertexID / ${PATCH_EACH} + ${SCOUR_POOL} ) % ${SCOUR_POOL};
  return clamp( float( ${SCOUR_POOL - 1} - behind ) / ${PATCH_FADE.toFixed(1)}, 0.0, 1.0 );
}
// How deep the hollow is now: no deeper than the snow that is down, less what the body packed, and filling in as it fades.
float mtmScourDepth( float snow ) { return min( aScourShape.z, max( snow - ${glsl(SCOUR.floorFt)}, 0.0 ) ) * mtmScourLife(); }
`;
const PATCH_VERTEX_PARS = /* glsl */ `
attribute vec2 aScourAt;
attribute vec4 aScourShape;
attribute vec4 aScourDrag;
// whether this hollow has a lid (game/snow-scour.js \`scourLid\`): one without is drawn into the map, and seen through another's
attribute float aScourLid;
uniform vec4 uTrack, uScour;
varying vec3 vTrackWorld;
varying vec2 vTrackOver;
varying vec2 vScourAt;
// the hollow's half length and half width, how deep it is now, and how deep the snow is now (feet)
varying vec4 vScourShape;
varying vec4 vScourDrag;
varying float vScourShown;
${PATCH_FUNCTIONS}
`;
/* The snow that is down lifts the patch as it lifts the ground; its lid stands over the rim's highest clump. */
const PATCH_LIFT = /* glsl */ `
  float scourSnow = aScourShape.w * uTrack.y, scourDepth = mtmScourDepth( scourSnow );
  float scourRaise = scourDepth * ${glsl(SCOUR.rim * RIM_MOST * LID_RAISE)} + ${glsl(LIFT_FT)};
  transformed.y += scourSnow + scourRaise;
  vTrackOver = vec2( scourRaise, scourSnow );
  vScourShape = vec4( aScourShape.xy, scourDepth, scourSnow );
`;
const PATCH_VERTEX = /* glsl */ `
  vTrackWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vScourAt = aScourAt;
  vScourDrag = aScourDrag;
  vScourShown = mtmScourLife() * ( 1.0 - smoothstep( uTrack.z, uTrack.w, length( mvPosition.xyz ) ) );
  if ( vScourShown <= 0.0 || scourDepth <= 0.005 || aScourLid < 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
`;
const PATCH_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uTrackGrain;
varying vec3 vTrackWorld;
varying vec2 vTrackOver;
varying vec2 vScourAt;
varying vec4 vScourShape;
varying vec4 vScourDrag;
varying float vScourShown;
${PLOUGH_GLSL}
${SCOUR_GLSL}
`;
/*
  In place of three.js's read of the map. Within the ploughed snow's map, the hollow as the map has it, with every rut and
  every other hollow in it: the eye's line through the lid is followed down to where it meets the snow, as a rut's is.
  Beyond the map, the hollow by itself, as it would be seen from straight over it: its own shape, lit as it lies.
*/
const PATCH_ALBEDO = /* glsl */ `
  trackFog();
  float scourS = scourEdge( vScourAt, vScourShape.xy, vTrackWorld.xz );
  vec3 scourOwn = scourSurface( scourS, vScourShape.z, vTrackWorld.xz, scourAhead( vScourAt, vScourDrag.zw ) );
  vec3 scourP = vec3( vTrackWorld.x, scourOwn.x, vTrackWorld.z );
  vec3 scourN = normalize( cross( dFdx( scourP ), dFdy( scourP ) ) );
  scourN *= scourN.y < 0.0 ? - 1.0 : 1.0;
  float scourInside = scourIn( scourS );
  vec4 scourGrain = texture2D( uTrackGrain, vTrackWorld.xz / 2.3 );
  vec3 trackFresh = vec3( 0.93, 0.95, 0.99 ) * ( 0.86 + 0.16 * scourGrain.r );
  vec3 trackTone = mix( trackFresh, scourTone( scourStreak( vTrackWorld.xz, vScourDrag.xy ) * scourInside, scourOwn.x, vScourShape.w, vTrackWorld.xz ), scourInside );
  float trackCover = 1.0 - smoothstep( ${glsl(0.6 * SCOUR.rimFt)}, ${glsl(1.2 * SCOUR.rimFt)}, scourS );
  vec3 scourFace = normalize( scourN + vec3( scourGrain.g - 0.5, 0.0, scourGrain.b - 0.5 ) * mix( 0.5, 0.15, scourInside ) );
  float trackDark = 0.0, trackLid = 1.0;
  #ifdef TRACK_PLOUGH
    vec2 ploughUv = ( vTrackWorld.xz - uPloughAt.xy ) * uPloughAt.w;
    vec2 ploughEdge = min( ploughUv, 1.0 - ploughUv );
    float trackMapped = uPloughAt.z * smoothstep( 0.01, ${glsl(PLOUGH_MAP.edge)}, min( ploughEdge.x, ploughEdge.y ) );
    vec3 ploughRay = normalize( vTrackWorld - cameraPosition );
    // As far as the eye's line through the lid can reach the snow: where the map holds nothing all along it, the lid shows nothing.
    float ploughReach = min( ( vTrackOver.x + vTrackOver.y + 0.05 ) / max( - ploughRay.y, 0.03 ), ${glsl(PLOUGH_MAP.reachFt)} );
    if ( trackMapped > 0.001 && trackTouched( vTrackWorld.xz ) + trackTouched( vTrackWorld.xz + ploughRay.xz * ploughReach * 0.5 ) + trackTouched( vTrackWorld.xz + ploughRay.xz * ploughReach ) < 0.001 ) {
      trackCover *= 1.0 - trackMapped;
    } else if ( trackMapped > 0.001 ) {
      vec2 ploughAt = vTrackWorld.xz + ploughRay.xz * trackMarch( vTrackWorld, ploughRay, vTrackOver.x, vTrackOver.y );
      vec4 ploughMap = trackMap( ploughAt );
      float ploughH = min( ploughMap.r, 4.0 - ploughMap.g );
      vec3 ploughN = trackPloughNormal( ploughAt );
      vec4 ploughGrain = texture2D( uTrackGrain, ploughAt / 1.7 );
      float ploughBelow = max( - ploughH, 0.0 ), ploughAbove = max( ploughH, 0.0 );
      // A rut it meets: packed snow, its floor in its own shade; the ridges and rims fresh, in clumps; the hollow scoured.
      float ploughFloor = smoothstep( 0.8, 0.95, ploughN.y ) * smoothstep( 0.03, 0.12, ploughBelow );
      vec3 ploughTone = mix( vec3( 0.8, 0.86, 0.95 ) * ( 0.85 + 0.2 * ploughGrain.r ), vec3( 0.6, 0.67, 0.8 ) * ( 0.9 + 0.2 * ploughGrain.r ), ploughFloor );
      ploughTone = mix( ploughTone, vec3( 0.93, 0.95, 0.99 ) * ( 0.86 + 0.16 * ploughGrain.r ), smoothstep( 0.0, 0.06, ploughAbove ) );
      ploughTone *= 1.0 - 0.3 * smoothstep( 0.0, 1.2, ploughBelow ) * ( 1.0 - ploughMap.b );
      ploughTone = mix( ploughTone, scourTone( ploughMap.a, ploughH, vTrackOver.y, ploughAt ), ploughMap.b );
      trackTone = mix( trackTone, ploughTone, trackMapped );
      trackCover = mix( trackCover, trackTouched( ploughAt ), trackMapped );
      if ( trackMapped > 0.5 ) scourFace = normalize( ploughN + vec3( ploughGrain.g - 0.5, 0.0, ploughGrain.b - 0.5 ) * mix( 0.5, 0.15, max( ploughFloor, ploughMap.b ) ) );
    }
  #endif
  vec3 trackFace = normalize( ( viewMatrix * vec4( scourFace, 0.0 ) ).xyz );
  trackCover *= vScourShown;
  diffuseColor = vec4( trackTone, 1.0 );
`;

/* A hollow drawn into the ploughed snow's map: its rim (r), its cut (g, as 4 ft less), how scoured (b) and scored (a). */
const PATCH_PLOUGH_VERTEX = /* glsl */ `
attribute vec2 aScourAt;
attribute vec4 aScourShape;
attribute vec4 aScourDrag;
uniform vec4 uTrack, uScour, uPloughAt;
varying vec2 vScourAt, vScourXZ;
varying vec4 vScourDrag;
varying vec3 vScourShape;
${PATCH_FUNCTIONS}
void main() {
  float depth = mtmScourDepth( aScourShape.w * uTrack.y );
  vScourAt = aScourAt;
  vScourXZ = position.xz;
  vScourDrag = aScourDrag;
  vScourShape = vec3( aScourShape.xy, depth );
  vec2 at = ( position.xz - uPloughAt.xy ) * uPloughAt.w * 2.0 - 1.0;
  gl_Position = depth > 0.005 ? vec4( at, 0.0, 1.0 ) : vec4( 2.0, 2.0, 2.0, 1.0 );
}`;
const PATCH_PLOUGH_FRAGMENT = /* glsl */ `
uniform sampler2D uTrackGrain;
varying vec2 vScourAt, vScourXZ;
varying vec4 vScourDrag;
varying vec3 vScourShape;
${SCOUR_GLSL}
void main() {
  float s = scourEdge( vScourAt, vScourShape.xy, vScourXZ );
  vec3 surface = scourSurface( s, vScourShape.z, vScourXZ, scourAhead( vScourAt, vScourDrag.zw ) );
  float inside = scourIn( s );
  gl_FragColor = vec4( max( surface.y, 0.0 ), 4.0 - surface.z, inside, scourStreak( vScourXZ, vScourDrag.xy ) * inside );
}`;

/**
 * The map of the ploughed snow about the eye, drawn each frame from the tracks' own `geometry` and the hollows'
 * `patches` (their `uniforms`, the rings' next places and the snow's depth, are the tracks'). `shared` is what the
 * tracks' and the hollows' materials read of it. It is made the first time it is drawn: a race that ploughs no snow has
 * none.
 */
function createPloughMap({ renderer, geometry, patches, uniforms }) {
  const side = PLOUGH_MAP.side, width = side * PLOUGH_MAP.texelFt;
  let target = null;
  const shared = { uPlough: { value: null }, uPloughAt: { value: new THREE.Vector4(0, 0, 0, 1 / width) } };
  // Each number the larger of what is there and what is drawn.
  const material = new THREE.ShaderMaterial({
    vertexShader: PLOUGH_VERTEX, fragmentShader: PLOUGH_FRAGMENT, uniforms: { uTrack: uniforms.uTrack, uTrackGrain: uniforms.uTrackGrain, uPloughAt: shared.uPloughAt },
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  // Drawn as the tracks' groups are: their ruts, and their ridges while there are any.
  const mesh = new THREE.Mesh(geometry, [material]);
  mesh.frustumCulled = false;
  // The hollows, the same way: the larger of what is there and what is drawn, each number.
  const patchMaterial = new THREE.ShaderMaterial({
    vertexShader: PATCH_PLOUGH_VERTEX, fragmentShader: PATCH_PLOUGH_FRAGMENT,
    uniforms: { uTrack: uniforms.uTrack, uScour: uniforms.uScour, uTrackGrain: uniforms.uTrackGrain, uScourGround: uniforms.uScourGround, uPloughAt: shared.uPloughAt },
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const patchMesh = new THREE.Mesh(patches, patchMaterial);
  patchMesh.frustumCulled = false;
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(mesh, patchMesh);
  const black = new THREE.Color(0, 0, 0), kept = new THREE.Color();
  /** Where it was last drawn about, and how long ago, how many frames since, and whether a piece laid since is still to be drawn into it. */
  let drawnAt = null, since = Infinity, frames = 0, owed = false;
  return {
    shared,
    /**
     * Draw it about game (x, z) `eye`, `dt` seconds on; `on` false leaves it undrawn, and the ruts each drawn by
     * themselves. It is drawn again only when it must be: a piece of rut that ploughs it was laid or drawn on since
     * (`laid`), the eye has gone `PLOUGH_MAP.redrawFt`, or `PLOUGH_MAP.redrawS` have passed, the snow deepening and the
     * oldest ruts filling in meanwhile; in a headset (`lite`) no more than every other frame.
     */
    draw(eye, on, { dt = 0, laid = true, lite = false } = {}) {
      shared.uPloughAt.value.z = on ? 1 : 0;
      since += dt;
      frames++;
      owed ||= laid;
      if (!on) { drawnAt = null; owed = false; return; }
      const moved = drawnAt ? Math.hypot(eye[0] - drawnAt[0], eye[2] - drawnAt[1]) : Infinity;
      if (!(owed || moved > PLOUGH_MAP.redrawFt || since > PLOUGH_MAP.redrawS) || (lite && frames < 2)) return;
      drawnAt = [eye[0], eye[2]];
      since = 0;
      frames = 0;
      owed = false;
      // Its corner on whole points, so the snow does not swim as the eye moves.
      const step = PLOUGH_MAP.texelFt;
      shared.uPloughAt.value.x = Math.floor((eye[0] - width / 2) / step) * step;
      shared.uPloughAt.value.y = Math.floor((-eye[2] - width / 2) / step) * step;
      target ??= new THREE.WebGLRenderTarget(side, side, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      });
      shared.uPlough.value = target.texture;
      // Drawn outside a headset's own drawing, which would otherwise draw it once for each eye.
      const was = renderer.getRenderTarget(), xr = renderer.xr.enabled, alpha = renderer.getClearAlpha();
      renderer.getClearColor(kept);
      renderer.xr.enabled = false;
      renderer.setClearColor(black, 0);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setClearColor(kept, alpha);
      renderer.setRenderTarget(was);
      renderer.xr.enabled = xr;
    },
    /**
     * Whether game (x, z) lies on the map as it was last drawn, or within `marginFt` of it; anywhere while it is not
     * drawn.
     */
    covers(x, z, marginFt = 0) {
      if (!drawnAt) return true;
      const half = width / 2 + marginFt;
      return Math.abs(x - drawnAt[0]) < half && Math.abs(z - drawnAt[1]) < half;
    },
    /** The map itself (null until it is first drawn) and what draws it, for tests in the browser. */
    get target() { return target; },
    material, patchMaterial,
    dispose() { target?.dispose(); material.dispose(); patchMaterial.dispose(); },
  };
}

/**
 * @param {{ scene: THREE.Scene, art?: object|null, ground: (x: number, z: number, y?: number) => number,
 *   snowDepth?: (x: number, z: number, y?: number) => number, look?: string, pools?: object|null }} env
 *   `art` is the effects art, whose `tread` is the game's tread; `ground` the height of the ground
 *   as its mesh is drawn, without snow, and `snowDepth` how deep that mesh has the snow settle,
 *   game feet (both at game x, z, under a tire at height y: on a bridge's deck, the deck's;
 *   game/drawn-ground.js, game/ground-boxes.js);
 *   `look` the look, which says whether the ground is lit; `pools` where water stands
 *   (render/ground-surface.js `pools`), which a rut goes under, or null; `snowLine` where the
 *   snow shows on the ground (render/ground-surface.js `snowLine`), which a rut ploughed in it
 *   goes by, or null; `renderer` what draws
 *   the ploughed snow's map, without which each rut in the snow is drawn by itself; `onIce`
 *   whether `ground` is the ice over the level's water there, which a rut laid on goes when it thaws.
 */
export function createTireTracks({ scene, art = null, ground, snowDepth = () => 0, onIce = () => false, look = "enhanced", pools = null, snowLine = null, renderer = null, groundTone = null }) {
  /*
    A piece is five strips side by side, each from the piece's near edge to its far edge: the rut in the middle, and
    either side of it a ridge of snow in two, its inner face up from the rut's edge to its crest and its outer slope down
    to its foot. Off snow the ridges have no width, and they are drawn only in snow. Every piece's rut is listed first and
    every piece's ridges after, and the ridges are drawn only while some piece in the ring has them: off snow a piece is
    its rut's two triangles, and the graphics card works on no others.

    Each point is kept small, 36 bytes: where it is; its place across and along the texture; the ground's lie under it
    and which part it is of, a byte each; the way across, in two short numbers; and its mark (\`aTrackMark\`), in four.
  */
  const vertices = TRACK_POOL * EACH;
  const positions = new Float32Array(vertices * 3), uvs = new Float32Array(vertices * 2);
  const lies = new Int8Array(vertices * 4), across = new Int16Array(vertices * 2), marks = new Uint16Array(vertices * 4);
  const geometry = new THREE.BufferGeometry();
  const attributes = {
    position: new THREE.BufferAttribute(positions, 3), uv: new THREE.BufferAttribute(uvs, 2),
    aTrackLie: new THREE.BufferAttribute(lies, 4, true), aTrackAcross: new THREE.BufferAttribute(across, 2, true), aTrackMark: new THREE.BufferAttribute(marks, 4),
  };
  for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute.setUsage(THREE.DynamicDrawUsage));
  // Which points each piece's strips are drawn between, written as it is laid: the ruts' first, the ridges' from here.
  const RIDGES_AT = TRACK_POOL * 6;
  const index = new Uint32Array(TRACK_POOL * 30);
  geometry.setIndex(new THREE.BufferAttribute(index, 1).setUsage(THREE.DynamicDrawUsage));

  /*
    The hollows a truck's body leaves in the snow (game/snow-scour.js), in a ring of their own: each a patch of four by
    four points over it, out to its rim's foot, following the ground. Where each point is; its place from the hollow's
    middle, along it and across it; the hollow's half length and half width, how deep it went and how deep the snow
    settles at the point; and the way the body went.
  */
  const patchVertices = SCOUR_POOL * PATCH_EACH;
  const patchArrays = {
    position: new Float32Array(patchVertices * 3), aScourAt: new Float32Array(patchVertices * 2),
    aScourShape: new Float32Array(patchVertices * 4), aScourDrag: new Float32Array(patchVertices * 4), aScourLid: new Float32Array(patchVertices),
  };
  const patchGeometry = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(patchArrays)) {
    patchGeometry.setAttribute(name, new THREE.BufferAttribute(array, array.length / patchVertices).setUsage(THREE.DynamicDrawUsage));
  }
  const patchIndex = new Uint32Array(SCOUR_POOL * (PATCH_SIDE - 1) ** 2 * 6);
  for (let q = 0, k = 0; q < SCOUR_POOL; q++) {
    for (let j = 0; j < PATCH_SIDE - 1; j++) {
      for (let i = 0; i < PATCH_SIDE - 1; i++) {
        const a = q * PATCH_EACH + j * PATCH_SIDE + i, b = a + 1, c = a + PATCH_SIDE, d = c + 1;
        patchIndex.set([a, b, d, a, d, c], k);
        k += 6;
      }
    }
  }
  patchGeometry.setIndex(new THREE.BufferAttribute(patchIndex, 1));
  patchGeometry.setDrawRange(0, 0);
  const PATCH_INDICES = (PATCH_SIDE - 1) ** 2 * 6;

  const uniforms = {
    uTrack: { value: new THREE.Vector4() }, uTrackIce: { value: 0 }, uTrackTread: { value: treadTexture(art?.tread ?? null) }, uTrackGrain: { value: detailNoise() },
    uScour: { value: new THREE.Vector4() },
    // The ground where a hollow goes down to it: the level's own colour, darkened wet (game/lighting.js `meanTone`).
    uScourGround: { value: new THREE.Color().setRGB(...(groundTone ?? [0.4, 0.34, 0.27]), THREE.SRGBColorSpace).multiplyScalar(0.55) },
  };
  const plough = renderer ? createPloughMap({ renderer, geometry, patches: patchGeometry, uniforms }) : null;
  // Blended as its own colour plus what is there times its alpha (`OUTPUT`). What lies on the ground faces one way all
  // along, so it is drawn in one pass, not three.js's two for what is see-through on both sides.
  const options = {
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  };
  // A ribbon's strips all face up, and a ridge is raised out of them: one of its faces seen from behind is hidden by the
  // ridge itself, and is left out. (The hollows' lids below are flat, and drawn from either side.)
  const ribbon = { ...options, side: THREE.FrontSide };
  const material = look === "classic" ? new THREE.MeshBasicMaterial(ribbon) : new THREE.MeshLambertMaterial(ribbon);
  addShaderHook(material, `tire-tracks${pools ? ":pools" : ""}${snowLine ? ":snow-line" : ""}${plough ? ":plough" : ""}`, 10, (shader) => {
    Object.assign(shader.uniforms, uniforms, pools?.uniforms ?? {}, snowLine?.uniforms ?? {}, plough?.shared ?? {});
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <beginnormal_vertex>", NORMAL_LEAN)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_LIFT}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${pools ? `#define TRACK_POOLS\n${pools.glsl}` : ""}\n${snowLine ? `#define TRACK_SNOW_LINE\n${snowLine.glsl}` : ""}\n${plough ? "#define TRACK_PLOUGH\n" : ""}${FRAGMENT_PARS}`)
      .replace("#include <fog_pars_fragment>", `#include <fog_pars_fragment>\n${OUTPUT_GLSL}`)
      .replace("#include <map_fragment>", ALBEDO)
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>\n${NORMAL}`)
      .replace("#include <fog_fragment>", FOG_ONCE())
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n${OUTPUT}`);
  });
  // Drawn as the geometry's groups (`update`): the ruts laid so far, and their ridges while there are any.
  // FIRST_DRAW: from the race's first frame the ring's first place is drawn, every corner of it at one point until a rut
  // is laid there. A graphics driver can leave the last of a shader's building to the first draw that uses it, and the
  // first rut, a moment after the start, stopped the picture for a tenth of a second (Mesa, Intel HD 630). Drawing
  // nothing does not count: the draw must have a triangle in it.
  geometry.addGroup(0, 6, 0);
  const mesh = new THREE.Mesh(geometry, [material]);
  mesh.name = "tire-tracks";
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  // Among the first of the see-through things, after the water (whose ice a rut can lie on) and before dust, smoke,
  // drops and sparks, which are drawn over the tracks, not under them.
  mesh.renderOrder = TRACK_ORDER;
  scene.add(mesh);
  // The hollows' lids, drawn as the ruts' are, after them.
  const patchMaterial = look === "classic" ? new THREE.MeshBasicMaterial(options) : new THREE.MeshLambertMaterial(options);
  addShaderHook(patchMaterial, `snow-scours${plough ? ":plough" : ""}`, 10, (shader) => {
    Object.assign(shader.uniforms, uniforms, plough?.shared ?? {});
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PATCH_VERTEX_PARS}`)
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${PATCH_LIFT}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${PATCH_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${plough ? "#define TRACK_PLOUGH\n" : ""}${PATCH_FRAGMENT_PARS}`)
      .replace("#include <fog_pars_fragment>", `#include <fog_pars_fragment>\n${OUTPUT_GLSL}`)
      .replace("#include <map_fragment>", PATCH_ALBEDO)
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>\n${NORMAL}`)
      .replace("#include <fog_fragment>", FOG_ONCE())
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n${OUTPUT}`);
  });
  const patchMesh = new THREE.Mesh(patchGeometry, patchMaterial);
  patchMesh.name = "snow-scours";
  patchMesh.frustumCulled = false;
  patchMesh.receiveShadow = true;
  patchMesh.renderOrder = TRACK_ORDER;
  scene.add(patchMesh);
  /** The hollows' ring: its next place, whether it has been round once, how many laid since the last frame, and in all, and when the last was. */
  let patchHead = 0, patchWrapped = false, patchFresh = 0, patchBegun = 0, lastPatch = -Infinity;

  /**
   * The ring's next place, whether it has been round once, how many pieces have been begun, when the last that ploughs
   * the snow and the last with ridges were, what is drawn now, and whether a piece that ploughs the snow on the map has
   * been laid since it was drawn.
   */
  let head = 0, wrapped = false, begun = 0, snowBegun = -Infinity, ridgedBegun = -Infinity, drawn = "", ploughLaid = false;
  /** The places written since the last frame. */
  const dirty = [];
  const half = TRACK_WIDTH_FT / 2;
  /**
   * One point of a track's edge, under a tire at height `y`: where it is, the ground there and the snow's settled depth,
   * and whether it lies on the ice.
   */
  const edgePoint = (x, z, y) => [x, ground(x, z, y), z, snowDepth(x, z, y), onIce(x, z, y) ? 1 : 0];
  /** Where the six points across a rut in the snow lie, feet to the left of its middle: a ridge's foot, its crest, the lid's edge, and the same on the right. */
  const SNOW_ACROSS_FT = [FOOT_FT, CREST_FT, LID_FT, -LID_FT, -CREST_FT, -FOOT_FT];
  /**
   * The six points across a track at game (x, z), going the way (px, pz) is square to (a unit
   * vector, to its left), under a tire at height `y`. In snow (`ridges`): a ridge's foot, its crest, the
   * left edge of the lid over the trench, its right edge, the other ridge's crest and foot. Off snow
   * there are no ridges: the rut's left edge three times and its right edge three times. `tread` is how wide the tire
   * is against a stock truck's (game/tire-effects.js `treadShare`): the whole track is that much narrower.
   */
  const edgeAcross = (x, z, px, pz, ridges, y, tread = 1) => {
    if (ridges) return SNOW_ACROSS_FT.map((out) => edgePoint(x + px * out * tread, z + pz * out * tread, y));
    const left = edgePoint(x + px * half * tread, z + pz * half * tread, y), right = edgePoint(x - px * half * tread, z - pz * half * tread, y);
    return [left, left, left, right, right, right];
  };
  /** Each of the six points' place across the track's texture, off snow and in it, and which part it is of: a ridge's foot (1), its crest (a half), the rut (0). */
  const ACROSS_U = [0, 0, 0, 1, 1, 1], SNOW_ACROSS_U = SNOW_ACROSS_FT.map((out) => 0.5 - out / TRACK_WIDTH_FT), PART = [-1, -0.5, 0, 0, 0.5, 1];
  const mark = (value) => Math.min(65535, Math.round(Math.max(0, value) * MARK_SCALE));

  /**
   * Write the piece at place `q` of the ring: from edge `from` to edge `to` (each `edgeAcross`), the way across each in
   * `ways`, along the texture from `v0` to `v1`, laid on `kind` pressing `press`; `ridged`, whether it is a rut in the
   * snow, whose edges have ridges (`edgeAcross`).
   */
  function writePiece(q, from, to, ways, v0, v1, kind, press, ridged) {
    // The ground's own lie under the rut, for its light: square to its width and its length (the scene mirrors z).
    const ax = from[3][0] - from[2][0], ay = from[3][1] - from[2][1], az = -(from[3][2] - from[2][2]);
    const bx = to[2][0] - from[2][0], by = to[2][1] - from[2][1], bz = -(to[2][2] - from[2][2]);
    let ux = ay * bz - az * by, uy = az * bx - ax * bz, uz = ax * by - ay * bx;
    const size = Math.hypot(ux, uy, uz) || 1;
    if (uy < 0) { ux = -ux; uy = -uy; uz = -uz; }
    const lie = [Math.round((ux / size) * 127), Math.round((uy / size) * 127), Math.round((uz / size) * 127)], pressed = mark(press);
    // A piece any of which lies on the ice goes with it, all of it.
    const icy = from.some((point) => point[4]) || to.some((point) => point[4]) ? 1 : 0;
    [from, to].forEach((edge, e) => edge.forEach((point, k) => {
      const o = q * EACH + e * 6 + k;
      positions.set([point[0], point[1], -point[2]], o * 3);
      uvs.set([(ridged ? SNOW_ACROSS_U : ACROSS_U)[k], e === 0 ? v0 : v1], o * 2);
      lies.set([lie[0], lie[1], lie[2], Math.round(PART[k] * 127)], o * 4);
      across.set([Math.round(ways[e][0] * 32767), Math.round(ways[e][1] * 32767)], o * 2);
      marks.set([kind, pressed, mark(point[3]), icy], o * 4);
    }));
    // Each strip from its two points on the near edge to its two on the far edge (the far edge's are six on); ridges not
    // drawn are the rut's first point over and over.
    const o = q * EACH, strip = (a, b) => [o + a, o + b, o + b + 6, o + a, o + b + 6, o + a + 6];
    index.set(strip(2, 3), q * 6);
    if (ridged) {
      index.set([...strip(0, 1), ...strip(1, 2), ...strip(3, 4), ...strip(4, 5)], RIDGES_AT + q * 24);
      ridgedBegun = begun;
    } else index.fill(o + 2, RIDGES_AT + q * 24, RIDGES_AT + q * 24 + 24);
    // A piece that ploughs the snow is drawn into its map: while any is in the ring the map is drawn, and drawn again
    // when one is laid on it. (The eye may go some way, and a piece be drawn on, before the map is drawn again.)
    if (kind === TRACK_KINDS.snow && (from.some((point) => point[3] > PLOUGHS_FT) || to.some((point) => point[3] > PLOUGHS_FT))) {
      snowBegun = begun;
      ploughLaid ||= !!plough?.covers(to[2][0], to[2][2], PLOUGH_MAP.redrawFt + TRACK_LONGEST_FT);
    }
    dirty.push(q);
  }

  /**
   * Lay a hollow a truck's body leaves in the snow (game/snow-scour.js \`scourShape\`, \`scourSteps\`): \`shape\` is
   * \`{ x, z, angle, halfLengthFt, halfWidthFt, depthFt, drag }\`, game feet, the body at height \`y\`; \`chain\` the
   * body's own, where the last lid over its drag was kept (\`scourLid\`). A lid reaches ahead along the way the body
   * went as far as the next will be laid, over the hollows between.
   */
  function writePatch(shape, y, chain) {
    const lid = scourLid(shape, chain.lid ?? null);
    if (lid) chain.lid = [shape.x, shape.z];
    const q = patchHead;
    patchHead = (patchHead + 1) % SCOUR_POOL;
    if (patchHead === 0) patchWrapped = true;
    patchFresh++;
    patchBegun++;
    lastPatch = patchBegun;
    // Along it and across it, game x and z; the way the body went in the scene's axes (z mirrored), and along the
    // hollow and across it.
    const ax = Math.sin(shape.angle), az = Math.cos(shape.angle), d = shape.drag;
    const drag = d ? [d[0], -d[1], d[0] * ax + d[1] * az, d[0] * az - d[1] * ax] : [0, 0, 0, 0];
    // Out to the rim's foot, and a lid on as far ahead as the next lid.
    const ahead = lid && d ? scourLidFt(shape.halfLengthFt) + 1 : 0;
    const u0 = -shape.halfLengthFt - PATCH_REACH_FT + Math.min(0, drag[2] * ahead), u1 = shape.halfLengthFt + PATCH_REACH_FT + Math.max(0, drag[2] * ahead);
    const v0 = -shape.halfWidthFt - PATCH_REACH_FT + Math.min(0, drag[3] * ahead), v1 = shape.halfWidthFt + PATCH_REACH_FT + Math.max(0, drag[3] * ahead);
    for (let j = 0; j < PATCH_SIDE; j++) {
      for (let i = 0; i < PATCH_SIDE; i++) {
        const u = u0 + ((u1 - u0) * i) / (PATCH_SIDE - 1), v = v0 + ((v1 - v0) * j) / (PATCH_SIDE - 1);
        const x = shape.x + ax * u + az * v, z = shape.z + az * u - ax * v, o = q * PATCH_EACH + j * PATCH_SIDE + i;
        patchArrays.position.set([x, ground(x, z, y), -z], o * 3);
        patchArrays.aScourAt.set([u, v], o * 2);
        patchArrays.aScourShape.set([shape.halfLengthFt, shape.halfWidthFt, shape.depthFt, snowDepth(x, z, y)], o * 4);
        patchArrays.aScourDrag.set(drag, o * 4);
        patchArrays.aScourLid[o] = lid ? 1 : 0;
      }
    }
    ploughLaid ||= !!plough?.covers(shape.x, shape.z, PLOUGH_MAP.redrawFt + shape.halfLengthFt + PATCH_REACH_FT + ahead);
  }

  /**
   * Draw the piece \`strip\` is laying on to game (x, z) instead of beginning another, if it may be (game/tire-effects.js
   * \`TRACK_LONGEST_FT\`): its near edge stays where it was, shared with the piece before. Without the ploughed snow's map
   * a rut in the snow is never drawn on, so what it ploughed is kept as it was laid (\`keepPloughed\`).
   */
  function drawOn(strip, x, z, kind, press, ridges, y) {
    const open = strip.open;
    if (!open || open.kind !== kind || Math.abs(open.press - press) > TRACK_PRESS_SAME || (ridges && !plough)) return false;
    // (Never one the ring is coming round to.)
    if ((head - 1 - open.q + TRACK_POOL) % TRACK_POOL > TRACK_POOL / 2) return false;
    const lx = x - open.start[0], lz = z - open.start[1], long = Math.hypot(lx, lz);
    if (!(long <= TRACK_LONGEST_FT && long > 1e-6)) return false;
    const px = -lz / long, pz = lx / long;
    const to = edgeAcross(x, z, px, pz, ridges, y, strip.tread);
    if (!trackLevel(to, ground(x, z, y)) || !edgeHolds(open.from, to, open.to) || !open.passed.every((edge) => edgeHolds(open.from, to, edge))) return false;
    open.passed.push(open.to);
    open.to = to;
    const v1 = open.v0 + long / TREAD_REPEAT_FT, way = [-px, pz];
    writePiece(open.q, open.from, to, [open.nearWay, way], open.v0, v1, kind, open.press, ridges);
    strip.last = [x, z];
    strip.edge = to;
    strip.way = way;
    strip.along = v1 % 64;
    return true;
  }

  /*
    Without the map, a tire that runs in a rut another has ploughed in the snow (a rear tire behind a front one, a truck
    in another's tracks) rides in it, and lays none of its own: two trenches drawn each by itself cannot be drawn into
    one. The pieces of snow laid lately are kept by where they lie, a grid of cells `CELL_FT` across. With the map, every
    tire lays its own, and the map makes one snow of them all.
  */
  const RIDES_FT = 1.3, CELL_FT = 6;
  const ploughed = new Map();
  let strips = 0;
  const cellOf = (x, z) => `${Math.floor(x / CELL_FT)},${Math.floor(z / CELL_FT)}`;
  /** Whether game (x, z) lies within `RIDES_FT` of a piece of snow rut laid by another strip, not yet filled in. */
  const inRut = (x, z, strip) => {
    const cx = Math.floor(x / CELL_FT), cz = Math.floor(z / CELL_FT);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        for (const piece of ploughed.get(`${i},${j}`) ?? []) {
          if (piece.strip === strip.id || begun - piece.laid > TRACK_POOL - TRACK_FADE_PIECES) continue;
          const [ax, az, bx, bz] = piece.line, abx = bx - ax, abz = bz - az;
          const t = Math.min(1, Math.max(0, ((x - ax) * abx + (z - az) * abz) / Math.max(abx * abx + abz * abz, 1e-6)));
          if (Math.hypot(x - ax - abx * t, z - az - abz * t) < RIDES_FT) return true;
        }
      }
    }
    return false;
  };
  const keepPloughed = (strip, line) => {
    const key = cellOf((line[0] + line[2]) / 2, (line[1] + line[3]) / 2);
    const list = ploughed.get(key) ?? [];
    list.push({ strip: strip.id, laid: begun, line });
    // Only what is still there.
    while (list.length && begun - list[0].laid >= TRACK_POOL) list.shift();
    ploughed.set(key, list);
  };

  return {
    /** A tire's own track: hand it back to `lay` and `lift`. */
    strip: () => ({ id: strips++, last: null, edge: null, along: 0, kind: null, open: null, tread: 1 }),
    /**
     * The tire of `strip` stands at game (x, z) on ground that takes a track of `kind`
     * (`TRACK_KINDS`), pressing `press` hard (0 to 1), its hub at height `y` (which says whether it
     * is on a bridge's deck or the ground under it), `tread` how wide its tire is against a stock truck's. Lays a piece
     * when it has gone far enough.
     */
    lay(strip, x, z, kind, press = 1, y = undefined, tread = 1) {
      // A change of width begins a new piece: the last one's edge is the old width.
      if (strip.tread !== tread) { strip.tread = tread; strip.edge = null; strip.open = null; }
      if (!strip.last) { strip.last = [x, z]; strip.edge = null; strip.open = null; return; }
      const dx = x - strip.last[0], dz = z - strip.last[1], length = Math.hypot(dx, dz);
      if (length > TRACK_BREAK_FT) { strip.last = [x, z]; strip.edge = null; strip.open = null; return; }
      if (length < TRACK_STEP_FT) return;
      const px = -dz / length, pz = dx / length, ridges = kind === TRACK_KINDS.snow;
      if (drawOn(strip, x, z, kind, press, ridges, y)) return;
      strip.open = null;
      // The piece starts on the last one's far edge, so the two share it; a strip's first starts square to its own way.
      const fresh = !(strip.edge && strip.kind === kind);
      const from = fresh ? edgeAcross(strip.last[0], strip.last[1], px, pz, ridges, y, tread) : strip.edge;
      const to = edgeAcross(x, z, px, pz, ridges, y, tread);
      // Never off a deck's edge or across a ledge: the strip ends, and begins again where the ground is level with the tire.
      if (!trackLevel(to, ground(x, z, y)) || (fresh && !trackLevel(from, ground(strip.last[0], strip.last[1], y)))) {
        strip.last = [x, z]; strip.edge = null; return;
      }
      if (ridges && !plough) {
        // Riding in another's rut: none of its own.
        if (inRut((x + strip.last[0]) / 2, (z + strip.last[1]) / 2, strip)) { strip.last = [x, z]; strip.edge = null; return; }
        keepPloughed(strip, [strip.last[0], strip.last[1], x, z]);
      }
      const v0 = strip.along, v1 = v0 + length / TREAD_REPEAT_FT;
      const q = head;
      head = (head + 1) % TRACK_POOL;
      if (head === 0) wrapped = true;
      begun++;
      // Across the piece from its left to its right, the way its texture runs: at its near edge as the last piece had it
      // at its far one, so a track that bends shades without a seam.
      const ways = [strip.edge && strip.kind === kind && strip.way ? strip.way : [-px, pz], [-px, pz]];
      writePiece(q, from, to, ways, v0, v1, kind, press, ridges);
      strip.open = { q, from, to, passed: [], start: strip.last, v0, kind, press, nearWay: ways[0] };
      strip.last = [x, z];
      strip.edge = to;
      strip.kind = kind;
      strip.way = ways[1];
      strip.along = v1 % 64;
    },
    /** The tire of `strip` left the ground, or ground that takes a track: its strip ends here. */
    lift(strip) { strip.last = null; strip.edge = null; strip.open = null; },
    /**
     * A truck's body is in the snow: lay the hollow it leaves there (game/snow-scour.js), `shape` as `scourSteps` gives
     * it, the body at height `y` (which says whether it is over a bridge's deck).
     */
    scour(shape, y = undefined, chain = {}) { writePatch(shape, y, chain); },
    /**
     * Once a frame, before the scene is drawn: `snowDown` is how much of the snow is down, 0 to 1
     * (render/ground-surface.js); `fadeFt` between which distances from the eye tracks fade out;
     * `ice` whether the level's water is ice, without which a rut laid on it is gone.
     * They lie on the ground's fine level, so they must be gone before the ground is drawn coarse
     * (render/track-scene.js). `eye` is where the eye is, game feet, which the ploughed snow's map
     * is drawn about; `lite` a headset, which draws the map less often.
     */
    update(dt, { snowDown = 0, fadeFt = TRACK_FADE_FT, eye = null, lite = false, ice = false } = {}) {
      uniforms.uTrack.value.set(head, snowDown, fadeFt[0], fadeFt[1]);
      uniforms.uTrackIce.value = ice ? 1 : 0;
      const laid = dirty.length > 0;
      if (laid) {
        // Only what was laid or drawn on since the last frame goes to the graphics card: every place from the oldest of
        // them, which are all young, to the newest. Once round the ring in one frame, all of it.
        let back = 0;
        for (const q of dirty) back = Math.max(back, (head - 1 - q + TRACK_POOL) % TRACK_POOL);
        dirty.length = 0;
        const first = (head - 1 - back + TRACK_POOL) % TRACK_POOL, count = back + 1;
        const ranges = count >= TRACK_POOL ? [[0, TRACK_POOL]]
          : first + count <= TRACK_POOL ? [[first, count]] : [[first, TRACK_POOL - first], [0, first + count - TRACK_POOL]];
        for (const attribute of Object.values(attributes)) {
          for (const [from, n] of ranges) attribute.addUpdateRange(from * EACH * attribute.itemSize, n * EACH * attribute.itemSize);
          attribute.needsUpdate = true;
        }
        for (const [from, n] of ranges) {
          geometry.index.addUpdateRange(from * 6, n * 6);
          geometry.index.addUpdateRange(RIDGES_AT + from * 24, n * 24);
        }
        geometry.index.needsUpdate = true;
      }
      // What is drawn: the ruts laid so far (all of them once the ring has been round), and their ridges while any piece
      // in the ring has them. Before the first rut, the ring's first place, which is a point until something is laid there (`FIRST_DRAW`).
      const pieces = wrapped ? TRACK_POOL : head, ridges = begun - ridgedBegun < TRACK_POOL, now = `${pieces} ${ridges}`;
      if (now !== drawn) {
        drawn = now;
        geometry.clearGroups();
        geometry.addGroup(0, Math.max(1, pieces) * 6, 0);
        if (ridges) geometry.addGroup(RIDGES_AT, pieces * 24, 0);
      }
      if (patchFresh) {
        // Only the hollows laid since the last frame go to the graphics card, the newest before the ring's next place.
        const count = Math.min(patchFresh, SCOUR_POOL), first = (patchHead - count + SCOUR_POOL) % SCOUR_POOL;
        const ranges = first + count <= SCOUR_POOL ? [[first, count]] : [[first, SCOUR_POOL - first], [0, first + count - SCOUR_POOL]];
        for (const attribute of Object.values(patchGeometry.attributes)) {
          for (const [from, n] of ranges) attribute.addUpdateRange(from * PATCH_EACH * attribute.itemSize, n * PATCH_EACH * attribute.itemSize);
          attribute.needsUpdate = true;
        }
        patchGeometry.setDrawRange(0, (patchWrapped ? SCOUR_POOL : patchHead) * PATCH_INDICES);
        patchFresh = 0;
      }
      uniforms.uScour.value.x = patchHead;
      // The map is drawn while any rut in the ring ploughs the snow, or any hollow is there.
      const ploughed = begun - snowBegun < TRACK_POOL || patchBegun - lastPatch < SCOUR_POOL;
      plough?.draw(eye, !!eye && snowDown > 0 && ploughed, { dt, laid: ploughLaid, lite });
      ploughLaid = false;
    },
    /** The ploughed snow's map (`createPloughMap`), or null: for tests in the browser. */
    plough,
    dispose() {
      scene.remove(mesh, patchMesh);
      plough?.dispose();
      geometry.dispose();
      patchGeometry.dispose();
      patchMaterial.dispose();
      uniforms.uTrackTread.value.dispose();
      material.dispose();
    },
  };
}
