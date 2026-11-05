/*
  The ground's fine detail (docs/VISUALS.md, "Ground"; the rules are in game/ground-detail.js),
  when "Ground detail" is on. Three things, all added to the terrain's own material:

   - The tiles as a stack of textures instead of one atlas. In an atlas a tile's neighbours are
     other tiles, so it cannot be shrunk for the distance without their colours running in, and
     the game's ground was drawn unfiltered: it shimmers far off and shows its repeats. A stack
     has no neighbours: every tile is filtered down for the distance and across a slant by
     itself.
   - Grain: a field of clods and grit laid over the tiles at two scales, lighter and darker by
     its height and by how its slopes face the sun. It is seen from above on level ground and
     from the side on a cliff, where the tile itself, seen edge on, would only smear.
   - Broad patches of lighter and darker ground, so a texture repeated to the horizon does not
     show its repeats.

  The ground in the weather (render/ground-surface.js) adds its lines to the same material and
  sees the ground's colour after this.
*/
import * as THREE from "three";
import { CLIFF_NORMAL, GRAIN, PATCHES, grainShare } from "../game/ground-detail.js";
import { WEATHER_LOOK } from "../game/weather.js";
import { SHARED_NOISE_GLSL, sharedNoiseUniforms } from "./noise-textures.js";
import { addShaderHook } from "./shader-hooks.js";
import { TILE_STACK_BUDGET, inSlotOrder, mergeTileStacks } from "../worker/terrain-mesh.js";

const glsl = (n) => n.toFixed(5);
/** How many mip levels further down a tile's texels have run together into its colour: a 64 texel tile is 8 across there. */
const FLAT_LEVELS = 3;
/**
 * A face of the grain seen less than this share of the whole is not read: its grain could move the ground's light by
 * under a fifth of a shade of an 8 bit picture.
 */
const FACE_UNSEEN = 1 / 256;

/*
  Which tile a point reads is found from where it falls in the atlas. With several samples a point (MSAA) a point on a
  cell's edge is shaded where its pixel's centre is, which may lie outside the cell, its atlas place then past the
  tile's padding and in the next slot: far off, where cells are a few pixels across, those points drew a line of
  another tile's colour along every cell edge, grey bands toward the horizon. The atlas place is read at a covered
  sample instead (centroid); how fast it crosses the screen is still taken from three.js's own, which runs on evenly.
*/
const SLOT_UV_PARS = "#ifdef USE_MAP\n\tcentroid varying vec2 vSlotUv;\n#endif";
const SLOT_UV = "#ifdef USE_MAP\n\tvSlotUv = vMapUv;\n#endif";

const VERTEX_PARS = `varying vec3 vDetWorld;\nvarying vec3 vDetUp;\n${SLOT_UV_PARS}`;
const VERTEX = `\tvDetWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvDetUp = normalize( mat3( modelMatrix ) * normal );\n${SLOT_UV}`;

const FRAGMENT_PARS = /* glsl */ `
${SLOT_UV_PARS}
varying vec3 vDetWorld;
varying vec3 vDetUp;
uniform sampler2D uDetShare;
// The noises the rest of the ground reads too, in the samplers they share (render/noise-textures.js).
${SHARED_NOISE_GLSL}
#define uDetNoise mtmDetailNoise
#define uDetCloud mtmCloudNoise
// the way to the sun (scene axes), and how strongly the grain's slopes are lit by it
uniform vec4 uDetSun;
// the atlas's width and height in texels, a slot's pitch, the padding round a tile
uniform vec4 uDetAtlas;
// a tile's side in texels, slots a row
uniform vec2 uDetTile;
// 1 the full detail, 0 the light one (a headset)
uniform float uDetFull;
#ifdef DET_TILES
${stacksGlsl("uDet", "detTile")}
#endif
// One face of the grain, seen \`weight\` of the whole: its noise at \`at\`, lit by the sun along \`sun\`. A face seen so little
// that its grain could not change a shade (\`weight\` under ${glsl(FACE_UNSEEN)}) gives its mean without being read: on level ground
// only the top is read, and on a sheer cliff only the sides.
vec2 detFace( vec2 at, vec2 sun, float weight ) {
  if ( weight < ${glsl(FACE_UNSEEN)} ) return vec2( 0.5, 0.0 ) * weight;
  vec4 noise = texture2D( uDetNoise, at );
  return vec2( noise.r, - dot( noise.gb - 0.5, sun ) ) * weight;
}
// The grain at one scale: its height (x, about a half) and how its slopes face the sun (y, about zero). \`weight\` says
// how much of it is seen from above and how much from either side.
vec2 detGrain( float feet, vec3 weight ) {
  vec2 grain = detFace( vDetWorld.xz / feet, uDetSun.xz, weight.y );
  if ( uDetFull > 0.5 ) grain += detFace( vDetWorld.zy / feet, uDetSun.zy, weight.x ) + detFace( vDetWorld.xy / feet, uDetSun.xy, weight.z );
  else grain += vec2( 0.5, 0.0 ) * ( weight.x + weight.z );
  return grain;
}
`;

/* In place of three.js's own read of the map. */
const MAP = /* glsl */ `
#ifdef USE_MAP
  vec2 detPx = vSlotUv * uDetAtlas.xy;
  vec2 detCell = floor( detPx / uDetAtlas.z );
  float detSlot = detCell.y * uDetTile.y + detCell.x;
  #ifdef DET_TILES
    // The tile's own square, 0 to 1. How fast it crosses the screen is taken from the atlas, where it runs on evenly
    // from a cell into the next: taken from the square it would jump at every cell's edge.
    vec2 detLocal = ( detPx - detCell * uDetAtlas.z - uDetAtlas.w ) / uDetTile.x;
    vec2 detAcross = dFdx( vMapUv * uDetAtlas.xy ) / uDetTile.x, detDown = dFdy( vMapUv * uDetAtlas.xy ) / uDetTile.x;
    vec4 sampledDiffuseColor = detTile( detLocal, detSlot, detAcross, detDown );
  #else
    vec4 sampledDiffuseColor = texture2D( map, vSlotUv );
  #endif
  float detShare = texelFetch( uDetShare, ivec2( int( detSlot + 0.5 ), 0 ), 0 ).r;
  vec3 detN = normalize( vDetUp );
  float detCliff = 1.0 - smoothstep( ${glsl(CLIFF_NORMAL.cliff)}, ${glsl(CLIFF_NORMAL.level)}, detN.y );
  float detDist = distance( cameraPosition, vDetWorld );
  float detNear = 1.0 - smoothstep( ${glsl(GRAIN.fine.fadeFromFt)}, ${glsl(GRAIN.fine.fadeToFt)}, detDist );
  float detMid = 1.0 - smoothstep( ${glsl(GRAIN.coarse.fadeFromFt)}, ${glsl(GRAIN.coarse.fadeToFt)}, detDist );
  // Broad patches, lighter and darker, which do not fade with distance.
  float detPatch = ( texture2D( uDetCloud, vDetWorld.xz / ${glsl(PATCHES.broadFt)} ).r - 0.5 ) + ( texture2D( uDetCloud, vDetWorld.xz / ${glsl(PATCHES.mediumFt)} ).g - 0.5 ) * 0.7
    + ( texture2D( uDetCloud, vDetWorld.xz / ${glsl(PATCHES.smallFt)} ).b - 0.5 ) * 0.5;
  float detFar = smoothstep( ${glsl(PATCHES.farFromFt)}, ${glsl(PATCHES.farToFt)}, detDist );
  #ifdef DET_TILES
    // A cliff shows its tile edge on, smeared down the face: there the tile gives its colour and the grain the structure.
    // Far off a tile's own picture is what shows it repeating, cell after cell: there too it gives its colour.
    // Its colour is the tile read that many levels further down than the distance asks, so it never reads finer than the screen can show.
    // (Level ground near by takes none of it, and does not read it.)
    // A ground box's wall is not a cliff: its tile is laid on it square, a building's front, and keeps its picture.
    #ifdef DET_WALLS
      float detFlatShare = detFar * ${glsl(PATCHES.farFlat)};
    #else
      float detFlatShare = max( detCliff * 0.7, detFar * ${glsl(PATCHES.farFlat)} );
    #endif
    if ( detFlatShare > 0.0 ) {
      vec3 detFlat = detTile( detLocal, detSlot, detAcross * ${glsl(2 ** FLAT_LEVELS)}, detDown * ${glsl(2 ** FLAT_LEVELS)} ).rgb;
      sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, detFlat, detFlatShare );
    }
  #endif
  // Past a scale's fade the grain is the flat value the fade would multiply away, so it is not read.
  vec2 detFine = vec2( 0.5, 0.0 ), detCoarse = vec2( 0.5, 0.0 );
  if ( detNear > 0.0 || detMid > 0.0 ) {
    vec3 detWeight = abs( detN );
    detWeight *= detWeight; detWeight *= detWeight;
    detWeight /= detWeight.x + detWeight.y + detWeight.z;
    if ( detNear > 0.0 ) detFine = detGrain( ${glsl(GRAIN.fine.repeatFt)}, detWeight );
    if ( detMid > 0.0 ) detCoarse = detGrain( ${glsl(GRAIN.coarse.repeatFt)}, detWeight );
  }
  float detAmount = detShare * ( 1.0 + 0.5 * detCliff );
  float detLight = ( detFine.x - 0.5 ) * 0.6 * detNear + ( detCoarse.x - 0.5 ) * 0.3 * detMid
    + ( detFine.y * detNear + detCoarse.y * detMid ) * uDetSun.w;
  if ( uDetFull > 0.5 && detMid > 0.0 && detCliff > 0.0 ) {
    // Beds of rock along the contours of a cliff: the same grain drawn out level. They fade with the coarse grain.
    float detBeds = texture2D( uDetNoise, vec2( ( vDetWorld.x + vDetWorld.z ) / 310.0, vDetWorld.y / 27.0 ) ).a
      + texture2D( uDetNoise, vec2( ( vDetWorld.x - vDetWorld.z ) / 140.0, vDetWorld.y / 9.0 ) ).r * 0.5 - 0.75;
    detLight += detCliff * detBeds * 0.5 * detMid;
  }
  // The grain never blacks the ground out nor doubles it; the patches grow a little stronger where the tile's own picture has gone.
  sampledDiffuseColor.rgb *= clamp( 1.0 + detAmount * detLight, 0.42, 1.75 ) * ( 1.0 + detPatch * ${glsl(PATCHES.amount * 2)} * ( 1.0 + detFar ) * step( 0.01, detShare ) );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

/*
  The tiles are read from up to MAX_STACKS stacks, one for each tile width (worker/terrain-mesh.js `planTileStacks`), so
  a 1024 px building front and a 64 px patch of grass each keep their own size. `<prefix>Place` says, a texel a slot,
  which stack a slot is in (red) and its layer there (green, then blue for the high byte). One stack has no table: its
  layers are in slot order (`stackTextures`), and the ground's shader, near the sixteen textures a graphics card may
  give one, spends one texture on its tiles as it always did.
*/
const MAX_STACKS = 4;
function stacksGlsl(prefix, name) {
  const count = `${prefix.toUpperCase()}_STACKS`;
  return `  #if ${count} > 1
    uniform highp sampler2D ${prefix}Place;
  #endif
${[0, 1, 2, 3].map((i) => `  #if ${count} > ${i}\n    uniform highp sampler2DArray ${prefix}Tiles${i};\n  #endif`).join("\n")}
  vec4 ${name}( vec2 local, float slot, vec2 across, vec2 down ) {
    #if ${count} > 1
      vec4 place = floor( texelFetch( ${prefix}Place, ivec2( int( slot + 0.5 ), 0 ), 0 ) * 255.0 + 0.5 );
      vec3 at = vec3( local, place.g + place.b * 256.0 );
${[3, 2, 1].map((i) => `      #if ${count} > ${i}\n        if ( place.r > ${i - 0.5} ) return textureGrad( ${prefix}Tiles${i}, at, across, down );\n      #endif`).join("\n")}
    #else
      vec3 at = vec3( local, slot );
    #endif
    return textureGrad( ${prefix}Tiles0, at, across, down );
  }`;
}

/**
 * The tiles' layers as plain data, `{ stacks, place }` as worker/terrain-mesh.js `buildTileStacks` gives them: the
 * worker's own (`atlas.stacks`, the HD tiles at their own size), or one stack copied from the atlas. null without a layout.
 */
function stackLayers(atlas) {
  const { rgba, width, tileSide: side, padding = 0, slots, stacks: own = null } = atlas;
  if (!side || !slots) return null;
  if (own?.stacks) return { stacks: own.stacks, place: own.place };
  const pitch = side + padding * 2, cols = Math.round(width / pitch);
  const data = new Uint8Array(side * side * 4 * slots);
  const place = new Uint8Array(slots * 4);
  for (let slot = 0; slot < slots; slot++) {
    place.set([0, slot & 255, slot >> 8, 0], slot * 4);
    const ox = (slot % cols) * pitch + padding, oy = Math.floor(slot / cols) * pitch + padding;
    for (let y = 0; y < side; y++) {
      const from = ((oy + y) * width + ox) * 4;
      data.set(rgba.subarray(from, from + side * 4), (slot * side + y) * side * 4);
    }
  }
  return { stacks: [{ data, side, slots }], place };
}

/** The layers (`stackLayers`) as textures, `{ textures, place }`, or null where the graphics card cannot hold them. */
function stackTextures({ stacks: layers, place }, slots, renderer, look) {
  const gl = renderer.getContext();
  const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS), maxSide = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (layers.length > MAX_STACKS || slots > maxSide || layers.some((stack) => stack.slots > maxLayers || stack.side > maxSide)) return null;
  // One stack is read without the table: its layers go in slot order (two widths made one leave them in another).
  if (layers.length === 1) layers = [inSlotOrder(layers[0], place)];
  const textures = layers.map(({ data, side: layerSide, slots: count }) => {
    const stack = new THREE.DataArrayTexture(data, layerSide, layerSide, count);
    stack.format = THREE.RGBAFormat;
    stack.colorSpace = THREE.SRGBColorSpace;
    // The classic look keeps its square texels close up; either look is filtered down for the distance.
    stack.magFilter = look === "classic" ? THREE.NearestFilter : THREE.LinearFilter;
    stack.minFilter = THREE.LinearMipmapLinearFilter;
    stack.generateMipmaps = true;
    stack.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    stack.needsUpdate = true;
    return stack;
  });
  let placeTexture = null;
  if (textures.length > 1) {
    placeTexture = new THREE.DataTexture(place, slots, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    placeTexture.magFilter = placeTexture.minFilter = THREE.NearestFilter;
    placeTexture.generateMipmaps = false;
    placeTexture.needsUpdate = true;
  }
  return {
    textures, place: placeTexture,
    /** The stacks' uniforms under `prefix`, and the define that says how many there are. */
    uniforms: (prefix) => Object.fromEntries([
      ...(placeTexture ? [[`${prefix}Place`, { value: placeTexture }]] : []), ...textures.map((t, i) => [`${prefix}Tiles${i}`, { value: t }]),
    ]),
    define: (prefix) => `#define ${prefix.toUpperCase()}_STACKS ${textures.length}\n`,
    dispose() { for (const t of textures) t.dispose(); placeTexture?.dispose(); },
  };
}


/*
  The ground's shader is near the sixteen textures a graphics card may give one (render/noise-textures.js), and each stack
  is one more. What else the ground's shader reads (the weather, the water's bed, the tracks, the fog, the shadows) is
  only known once three.js has built it, so the stacks are checked there: a program that did not link draws no ground
  at all, and the stacks give up a texture (two widths made one, worker/terrain-mesh.js `mergeTileStacks`) and the
  ground is built again, down to one stack and then to the atlas.
*/
function createTileSource(atlas, renderer, look) {
  const gl = renderer.getContext();
  if (!gl.getParameter) return null;
  const slots = atlas.slots;
  let layers = stackLayers(atlas);
  let stack = layers ? stackTextures(layers, slots, renderer, look) : null;
  const materials = new Set(), seen = new WeakSet();
  function giveUp() {
    const before = stack.textures.length;
    const merged = before > 1 ? mergeTileStacks(layers, { smooth: look !== "classic", budgetBytes: TILE_STACK_BUDGET }) : null;
    stack.dispose();
    layers = merged;
    stack = merged ? stackTextures(merged, slots, renderer, look) : null;
    console.warn(`The ground's shader did not build with ${before} tile stack(s), too many textures for this graphics card: built again with ${stack ? `${stack.textures.length}` : "the atlas"}.`);
    for (const material of materials) material.needsUpdate = true;
  }
  return {
    /** The stacks as they are now (`stackTextures`), or null: the atlas. */
    get stack() { return stack; },
    /** A material that reads the stacks, to be checked. */
    watch(material) { materials.add(material); },
    /**
     * Whether a program three.js built for the watched materials since the last call failed to link: the stacks then
     * give up a texture and their materials are built again. True when that happened.
     */
    check() {
      if (!stack) return false;
      let failed = false;
      for (const material of materials) {
        for (const program of renderer.properties.get(material).programs?.values() ?? []) {
          if (seen.has(program) || (program.isReady && !program.isReady())) continue;
          seen.add(program);
          if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) failed = true;
        }
      }
      if (failed) giveUp();
      return failed;
    },
    dispose() { stack?.dispose(); stack = null; materials.clear(); },
  };
}

/** Whether a material draws ground boxes (render/track-scene.js `createGroundBoxes`), whose walls are not cliffs. */
const isBoxes = (material) => !!material?.userData?.groundBoxes;

/** What a shader needs to find a point's tile in `atlas`: the atlas's size, a slot's pitch and the padding; the tile's side and slots a row. */
function atlasUniforms(atlas) {
  const pitch = (atlas.tileSide ?? 64) + (atlas.padding ?? 0) * 2;
  return {
    layout: new THREE.Vector4(atlas.width, atlas.height, pitch, atlas.padding ?? 0),
    tile: new THREE.Vector2(atlas.tileSide ?? 64, Math.max(1, Math.round(atlas.width / pitch))),
  };
}

/**
 * @param {{ world: THREE.Object3D, atlas: object, textureValues?: ArrayLike<number>|null, renderer: THREE.WebGLRenderer,
 *   sun: THREE.Light, look?: string }} options
 *   `world` is the track (render/track-scene.js), whose terrain and ground boxes take the detail;
 *   `atlas` the ground's textures with their layout (worker/track-build.js `terrain.atlas`);
 *   `textureValues` each texture's `.TTY` value, which says what ground it is; `sun` the scene's
 *   sun, whose position is the way to it.
 */
export function createGroundDetail({ world, atlas, textureValues = null, renderer, sun, look = "enhanced", boxes = true }) {
  const common = {
    ...sharedNoiseUniforms(),
    uDetSun: { value: new THREE.Vector4(0, 1, 0, 1) },
    uDetFull: { value: 1 },
  };
  // The ground's tiles, which its boxes share, and what the shader needs to read them.
  let source = null, fixed = null, plain = null;
  function prepare() {
    if (fixed) return;
    source = createTileSource(atlas, renderer, look);
    const slots = Math.max(1, atlas.slots ?? 1);
    const shares = new Uint8Array(slots);
    for (let slot = 0; slot < slots; slot++) shares[slot] = Math.round(grainShare(textureValues?.[slot] ?? 0) * 255);
    const shareTexture = new THREE.DataTexture(shares, slots, 1, THREE.RedFormat, THREE.UnsignedByteType);
    shareTexture.magFilter = shareTexture.minFilter = THREE.NearestFilter;
    shareTexture.generateMipmaps = false;
    shareTexture.needsUpdate = true;
    const { layout, tile } = atlasUniforms(atlas);
    fixed = { shareTexture, uniforms: { uDetShare: { value: shareTexture }, uDetAtlas: { value: layout }, uDetTile: { value: tile } } };
    plain = source?.stack ? plainTiles(source, atlas) : null;
  }
  const dressed = new Set();

  /** Give a ground material the detail; a ground box's, with "Ground box grain" off, only its tiles. */
  function dress(material) {
    if (!material?.map || dressed.has(material)) return material;
    dressed.add(material);
    prepare();
    if (isBoxes(material) && !boxes) return plain ? plain(material) : material;
    source?.watch(material);
    const walls = isBoxes(material);
    const stack = () => source?.stack ?? null;
    // After the hooks that add lines beside three.js's read of the map: this one replaces it.
    return addShaderHook(material, () => `ground-detail:${stack() ? `tiles${stack().textures.length}` : "atlas"}${walls ? ":walls" : ""}`, 20, (shader) => {
      const now = stack();
      const defines = `${now ? `#define DET_TILES\n${now.define("uDet")}` : ""}${walls ? "#define DET_WALLS\n" : ""}`;
      Object.assign(shader.uniforms, common, fixed.uniforms, now?.uniforms("uDet"));
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${defines}${FRAGMENT_PARS}`)
        .replace("#include <map_fragment>", MAP);
    });
  }
  // `boxes` false ("Ground box grain" off): the ground boxes (walls, buildings, signs) keep their own textures plain.
  world.traverse((object) => { if ((object.name === "terrain" || object.name === "groundBoxes") && object.material) dress(object.material); });

  return {
    /** Dress one more material as the terrain's is (the lit twin of the classic look's, render/weather-scene.js). */
    dress,
    /** After a frame or a build of the scene's shaders: whether the ground's had to be built again (`createTileSource`). */
    check: () => source?.check() ?? false,
    /**
     * Once a frame: `weather` decides how much of the light is the sun's, which is what shows
     * the grain's slopes; `lite` (a headset) reads the grain from above only.
     */
    update({ weather = 0, lite = false } = {}) {
      const way = common.uDetSun.value;
      way.set(sun.position.x, sun.position.y, sun.position.z, 0).normalize();
      way.w = 2.2 * (WEATHER_LOOK[weather]?.sun ?? 1);
      common.uDetFull.value = lite ? 0 : 1;
    },
    dispose() {
      source?.dispose();
      fixed?.shareTexture.dispose();
      source = fixed = plain = null;
      dressed.clear();
    },
  };
}

/* The tiles alone, for the ground without "Ground detail": the stack's read in place of the atlas's, nothing over it. */
const TILES_PARS = /* glsl */ `
${SLOT_UV_PARS}
${stacksGlsl("uGnd", "gndTile")}
// the atlas's width and height in texels, a slot's pitch, the padding round a tile
uniform vec4 uGndAtlas;
// a tile's side in texels, slots a row
uniform vec2 uGndTile;
`;
const TILES_MAP = /* glsl */ `
#ifdef USE_MAP
  vec2 gndPx = vSlotUv * uGndAtlas.xy;
  vec2 gndCell = floor( gndPx / uGndAtlas.z );
  vec2 gndLocal = ( gndPx - gndCell * uGndAtlas.z - uGndAtlas.w ) / uGndTile.x;
  vec4 sampledDiffuseColor = gndTile( gndLocal, gndCell.y * uGndTile.y + gndCell.x,
    dFdx( vMapUv * uGndAtlas.xy ) / uGndTile.x, dFdy( vMapUv * uGndAtlas.xy ) / uGndTile.x );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

/**
 * The plain tiles hook for a tile source's stacks (`createTileSource`): `(material) => material`, the stacks' read in
 * place of the atlas's. Once the source has given its stacks up, the material reads its atlas as three.js does.
 */
function plainTiles(source, tiles) {
  const { layout, tile } = atlasUniforms(tiles);
  const fixed = { uGndAtlas: { value: layout }, uGndTile: { value: tile } };
  return (material) => {
    source.watch(material);
    return addShaderHook(material, () => (source.stack ? `ground-tiles${source.stack.textures.length}` : "ground-tiles:atlas"), 20, (shader) => {
      const stack = source.stack;
      if (!stack) return;
      Object.assign(shader.uniforms, fixed, stack.uniforms("uGnd"));
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${SLOT_UV_PARS}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${SLOT_UV}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${stack.define("uGnd")}${TILES_PARS}`)
        .replace("#include <map_fragment>", TILES_MAP);
    });
  };
}

/**
 * Mipmapped ground for every picture (docs/VISUALS.md, "Ground"): the atlas cannot be shrunk for the distance without
 * its tiles' neighbours running in, so its tiles are read from a stack, each filtered down by itself, and far ground
 * stops shimmering. What "Ground detail" does with the grain left out; null where the atlas has no layout (a level of
 * another game) or the graphics card cannot hold the stacks, and the ground keeps its atlas.
 */
export function createGroundTiles({ world, atlas, renderer, look = "classic" }) {
  const source = createTileSource(atlas, renderer, look);
  if (!source?.stack) { source?.dispose(); return null; }
  const plain = plainTiles(source, atlas);
  const dressed = new Set();
  function dress(material) {
    if (!material?.map || dressed.has(material)) return material;
    dressed.add(material);
    return plain(material);
  }
  world.traverse((object) => { if ((object.name === "terrain" || object.name === "groundBoxes") && object.material) dress(object.material); });
  return {
    dress,
    /** After a frame or a build of the scene's shaders: whether the ground's had to be built again (`createTileSource`). */
    check: () => source.check(),
    dispose() { source.dispose(); dressed.clear(); },
  };
}
