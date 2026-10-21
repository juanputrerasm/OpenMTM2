/*
  A track as three.js objects, from the asset worker's build (worker/track-build.js).

  Everything arrives in scene coordinates already (shared/scene-frame.js), so this module only
  makes geometry, textures and materials.

  Looks (settings.look):
  - "classic": as the 1998 software renderer shaded it. Terrain is unlit and darkened by the
    .LTE's baked ground brightness; textures are point-sampled.
  - "enhanced": the same art, lit by the level's sun with smooth normals and filtered textures.

  The ground is the game's own two triangles a cell, or with "Smooth terrain" the drawn ground
  (game/terrain-relief.js, cut by worker/relief-mesh.js), which comes at two levels of detail:
  the chunks near the camera are drawn fine and the rest coarse.

  The world wraps without end, as the game's does. It is drawn nine times over (the original and its
  eight neighbours), and each frame the nine are moved by whole worlds so that the middle one is the
  copy the camera is over (`centreCopies`): whichever way the camera goes, there is a world on every
  side of it, at least 8192 ft of ground however far it has gone, which is the most the Draw distance
  reaches. That is what the game shows: it draws the cells around the view out to the view's range,
  reading the map modulo its size (MONSTER_EXE_ANALYSIS.md "The wrapping world").

  What it costs to draw. The world is drawn nine times, and a headset draws everything twice.
  Three things keep that affordable:
  - the terrain is cut into chunks, each its own mesh, so what lies outside the view is skipped
    (one mesh per copy would always be in view, all 131072 triangles of it);
  - a model's placements in all nine copies are one instanced mesh, so a model costs one draw
    however often and wherever it stands;
  - camera-facing scenery (SIT types 8 and 9, trees and the like) is instanced too and turned
    toward the camera in the vertex shader, instead of being hundreds of objects turned by hand.
*/
import * as THREE from "three";
import { createEvoGrass, updateEvoGrass } from "./evo-grass.js";
import { terrainOfBuild } from "../shared/build-terrain.js";
import { DEFAULT_FRAME_SECONDS, keyframeWeights } from "../shared/keyframe-spline.js";
import { blockShift, chunkTriangles, indexedBounds } from "../shared/object-chunks.js";
import { WORLD_FT } from "../shared/scene-frame.js";
import { bleedCutout } from "../game/cutouts.js";
import { fadesToBackdrop, installAtmosphere, screenColor, veilBackdropShader, veilSky } from "./atmosphere.js";
import { BACKDROP_HAZED } from "../game/atmosphere.js";

// The fog every material here is built with (render/atmosphere.js): three.js's own until "Volumetric weather" turns it on.
installAtmosphere();

/** The terrain grid: cells per side, feet per cell, and a chunk's side in cells. */
const GRID = 256, CELL_FT = 32, CHUNK_CELLS = 64;
/**
 * How near the camera a chunk of the drawn ground is drawn at its fine level, feet from the
 * chunk's edge, and the play that keeps one at that range from changing back and forth.
 */
export const FINE_RANGE_FT = 2400, FINE_PLAY_FT = 160;
/** Where the world is drawn, in worlds: the original first, then its eight neighbours. */
const WORLD_COPIES = Object.freeze([[0, 0], [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
/** What `updateTrackWorld` and `moveObjects` work on, per world, found once when it is made. */
const PARTS = new WeakMap();

export function dataTexture({ rgba, width, height }, look, repeat = false) {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Texture rows are stored top first; three.js reads the first row as the bottom.
  texture.flipY = false;
  const nearest = look === "classic";
  texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = nearest ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // The enhanced look filters sharply at a slant (clamped to what the GPU offers).
  if (!nearest) texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** MRGL_TEXTURECYCLE frames a second (the record's own timing words are not decoded; the helicopter's rotor reads right at this). */
const TEXTURE_CYCLE_FPS = 15;
const cycles = new Set();
let cycleTimer = 0;
function tickCycles() {
  cycleTimer = cycles.size ? requestAnimationFrame(tickCycles) : 0;
  const step = Math.floor((performance.now() / 1000) * TEXTURE_CYCLE_FPS);
  for (const cycle of cycles) {
    const frame = cycle.frames[step % cycle.frames.length];
    if (frame === cycle.shown) continue;
    cycle.shown = frame;
    cycle.texture.image = { data: frame.rgba, width: frame.width, height: frame.height };
    cycle.texture.needsUpdate = true;
  }
}

/**
 * A texture that runs through `frames` (`{ rgba, width, height }`, all one size), on its own clock, until it is disposed.
 */
export function cycleTexture(frames, look, repeat = false) {
  const texture = dataTexture(frames[0], look, repeat);
  const same = frames.filter((f) => f.width === frames[0].width && f.height === frames[0].height);
  if (same.length < 2 || typeof requestAnimationFrame !== "function") return texture;
  const cycle = { texture, frames: same, shown: same[0] };
  cycles.add(cycle);
  texture.addEventListener("dispose", () => cycles.delete(cycle));
  if (!cycleTimer) cycleTimer = requestAnimationFrame(tickCycles);
  return texture;
}

/** Geometry from a worker mesh: positions, normals, uvs, indices, optional baked shade. */
function meshGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  if (mesh.shade) {
    const colors = new Float32Array(mesh.shade.length * 3);
    for (let i = 0; i < mesh.shade.length; i++) colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = mesh.shade[i];
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** The terrain's atlas as a texture; ground boxes draw from it too. */
/**
 * A mesh of the world's ground cut into blocks (shared/object-chunks.js): a group under the mesh's name of one mesh a
 * block, each with the mesh's name, material and vertices and its own triangles and bounds, to be drawn at the copy
 * nearest the camera (`updateTrackWorld`).
 */
function inBlocks(mesh) {
  const source = mesh.geometry, group = new THREE.Group();
  group.name = mesh.name;
  const positions = source.getAttribute("position").array;
  for (const indices of chunkTriangles(positions, source.getIndex().array).values()) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // The block's own bounds. three.js would take them from every vertex of the shared list, the whole world's: each
    // block would then be placed, and culled, as if it were the world.
    const bounds = indexedBounds(positions, indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...bounds.center), bounds.radius);
    const block = new THREE.Mesh(geometry, mesh.material);
    block.name = mesh.name;
    // Still: its matrix is not composed again every frame (a move calls updateMatrix, `placeBlocks`).
    block.matrixAutoUpdate = false;
    block.receiveShadow = mesh.receiveShadow;
    block.userData = { ...mesh.userData, block: true };
    group.add(block);
  }
  return group;
}

export function createTerrainAtlas(atlas, look) {
  const map = dataTexture(atlas, look);
  // Mipmaps would blend neighbouring atlas tiles together.
  map.minFilter = look === "classic" ? THREE.NearestFilter : THREE.LinearFilter;
  map.generateMipmaps = false;
  return map;
}

/** `litShade`: the lit look also multiplies by the baked shade (4x4 Evolution's .RTD shade map). */
function surfaceMaterial(map, look, hasShade, litShade = false) {
  return look === "classic"
    ? new THREE.MeshBasicMaterial({ map, vertexColors: hasShade })
    : new THREE.MeshLambertMaterial({ map, vertexColors: litShade });
}

export function createGroundBoxes(boxes, map, look) {
  if (!boxes) return null;
  const mesh = new THREE.Mesh(meshGeometry(boxes), surfaceMaterial(map, look, boxes.hasLte));
  mesh.name = "groundBoxes";
  return inBlocks(mesh);
}

/** Detail strength where the mask is black (TERRAIN_DETAIL_MASK.md: `terrDetail` 10), the feet a detail pattern spans, and the mask's reach. */
const TERRAIN_DETAIL = 0.1, TERRAIN_DETAIL_REP_FT = 64, TERRAIN_MASK_FT = 8192;

/**
 * The engine's generated detail map: a tiling normal map of fine noise with its cavities in blue (255 open), 256 px.
 */
function generatedDetail() {
  const n = 256, height = new Float32Array(n * n);
  // Three octaves of value noise that wrap at the edges.
  let seed = 12345;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [cells, weight] of [[16, 0.5], [32, 0.3], [64, 0.2]]) {
    const grid = Float32Array.from({ length: cells * cells }, random);
    const smooth = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells, fy = (y / n) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = smooth(fx - x0), ty = smooth(fy - y0);
      const at = (cx, cy) => grid[(cy % cells) * cells + (cx % cells)];
      height[y * n + x] += weight * ((at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty);
    }
  }
  const rgba = new Uint8ClampedArray(n * n * 4);
  const h = (x, y) => height[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 6, dy = (h(x, y + 1) - h(x, y - 1)) * 6;
    const o = (y * n + x) * 4;
    rgba[o] = 128 - dx * 127;
    rgba[o + 1] = 128 - dy * 127;
    // The cavity: lower than its surroundings reads as occluded.
    const around = (h(x + 3, y) + h(x - 3, y) + h(x, y + 3) + h(x, y - 3)) / 4;
    rgba[o + 2] = 255 * Math.min(1, Math.max(0.35, 1 - (around - h(x, y)) * 5));
    rgba[o + 3] = 255;
  }
  return { rgba, width: n, height: n };
}

/**
 * Community Patch 3's terrain detail (TERRAIN_DETAIL_MASK.md) on a lit terrain material: a detail normal tiling in world
 * space every TERRAIN_DETAIL_REP_FT, its blue channel occlusion at 0.6 of the strength, both scaled 1x to 5x by the
 * track's painted mask (a top-down picture of the level, in the level's own orientation).
 */
function addTerrainDetail(material, detail, look) {
  const linear = (image, repeat) => {
    const t = dataTexture(image, look, repeat);
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  };
  const uniforms = {
    detailMap: { value: linear(detail.detail ?? generatedDetail(), true) },
    detailMask: { value: linear(detail.mask, true) },
    detailParams: { value: new THREE.Vector3(TERRAIN_DETAIL, 1 / TERRAIN_DETAIL_REP_FT, 1 / TERRAIN_MASK_FT) },
  };
  material.userData.detail = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vDetailXZ;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvDetailXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec2 vDetailXZ;
        uniform sampler2D detailMap;
        uniform sampler2D detailMask;
        uniform vec3 detailParams;`)
      // The scene's z is the game's mirrored: the mask and the pattern are addressed in game feet.
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec2 detailFt = vec2(vDetailXZ.x, -vDetailXZ.y);
        vec3 detailTexel = texture2D(detailMap, detailFt * detailParams.y).xyz;
        float detailStrength = detailParams.x * (1.0 + 4.0 * texture2D(detailMask, detailFt * detailParams.z).r);
        vec2 detailTilt = (detailTexel.xy * 2.0 - 1.0) * detailStrength * 4.0;
        vec3 detailWorld = normalize(inverseTransformDirection(normal, viewMatrix) + vec3(detailTilt.x, 0.0, -detailTilt.y));
        normal = normalize((viewMatrix * vec4(detailWorld, 0.0)).xyz);
        diffuseColor.rgb *= mix(1.0, detailTexel.z, min(1.0, 0.6 * detailStrength * 2.0));`);
  };
  material.customProgramCacheKey = () => "terrain-detail";
}

/**
 * CART Precision Racing's road has precedence over the ground (worker/cpr-road.js `roadMask`, after JSTrackViewer): a
 * terrain fragment inside the road's footprint is pushed to the back of the depth range, so the road over it always
 * shows, whichever is drawn first. Pushed, not discarded: at the mask's edge a pushed fragment still fills the pixel
 * when nothing else does. Objects, trucks and walls depth test as ever, so a hill in front of the road still hides it.
 */
function addRoadMask(material, mask) {
  const texture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const uniforms = { roadMask: { value: texture }, roadMaskBounds: { value: new THREE.Vector4(...mask.bounds) } };
  material.userData.roadMask = uniforms;
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vRoadMaskXZ;")
      // The scene's z is the game's mirrored: the mask is addressed in game feet.
      .replace("#include <project_vertex>", "#include <project_vertex>\nvRoadMaskXZ = (modelMatrix * vec4(transformed, 1.0)).xz * vec2(1.0, -1.0);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec2 vRoadMaskXZ;
        uniform sampler2D roadMask;
        uniform vec4 roadMaskBounds;`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        gl_FragDepth = gl_FragCoord.z;
        vec2 roadUv = (vRoadMaskXZ - roadMaskBounds.xy) / roadMaskBounds.zw;
        if (all(greaterThanEqual(roadUv, vec2(0.0))) && all(lessThanEqual(roadUv, vec2(1.0)))
            && texture2D(roadMask, roadUv).r > 0.5) gl_FragDepth = 0.999999;`);
  };
  const key = material.customProgramCacheKey?.() ?? "";
  material.customProgramCacheKey = () => `${key}|road-mask`;
}

/*
  The ground is drawn after the rest of what is opaque (three.js draws by renderOrder first, then by material): the
  trucks, the placed objects and the trees in front of it have written their depth by then, and the ground behind them is
  not shaded. Its shader is the dearest in the scene; drawn first, as its material's age had it, it was shaded under every
  truck and tree and then covered (1 ms a frame of 23 on an Intel HD 630 at 1920 x 1080 on Max, The Graveyard in Rain).
  It still comes before the sky (1 and 2), which is drawn last so that only what shows is shaded, and before 4x4
  Evolution's forest, whose trees a hill hides by the thousand.
*/
const GROUND_ORDER = 0.75, FOREST_ORDER = 0.875;

/**
 * `detail`: whether Community Patch 3's terrain extras are drawn (the enhanced look only): the HD tiles' normal maps
 * and, on a track with a painted mask, the detail normals.
 */
export function createTerrain(terrain, look, map = createTerrainAtlas(terrain.atlas, look), { detail = true } = {}) {
  const material = surfaceMaterial(map, look, terrain.hasLte, !!terrain.shadeLit);
  if (look !== "classic" && detail) {
    if (terrain.normalAtlas) {
      const normalMap = createTerrainAtlas(terrain.normalAtlas, look);
      normalMap.colorSpace = THREE.NoColorSpace;
      material.normalMap = normalMap;
      // DirectX (green-down) normal maps.
      material.normalScale.set(1, -1);
    }
    if (terrain.detail?.mask) addTerrainDetail(material, terrain.detail, look);
  }
  if (terrain.roadMask) addRoadMask(material, terrain.roadMask);
  const group = new THREE.Group();
  group.name = "terrainChunks";
  const side = CHUNK_CELLS * CELL_FT;
  if (terrain.relief) {
    // The drawn ground: every chunk at both levels of detail, the fine one shown when the camera is near (updateTrackWorld).
    for (const [detail, lod] of [["coarse", terrain.relief.coarse], ["fine", terrain.relief.fine]]) {
      const attributes = {
        position: new THREE.BufferAttribute(lod.positions, 3), normal: new THREE.BufferAttribute(lod.normals, 3, true),
        uv: new THREE.BufferAttribute(lod.uvs, 2), color: new THREE.BufferAttribute(lod.colors, 3, true),
        // In a race in Snow: how deep the snow lies on each vertex once settled (render/ground-surface.js lifts the ground by it).
        ...(lod.snow ? { snowDepth: new THREE.BufferAttribute(lod.snow, 1, true) } : {}),
      };
      for (const chunk of lod.chunks) {
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute);
        geometry.setIndex(new THREE.BufferAttribute(lod.indices.subarray(chunk.start, chunk.start + chunk.count), 1));
        geometry.boundingSphere = new THREE.Sphere(
          new THREE.Vector3((chunk.col + 0.5) * side, (chunk.low + chunk.high) / 2, -(chunk.row + 0.5) * side),
          Math.hypot(side / 2, side / 2, (chunk.high - chunk.low) / 2));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "terrain";
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = GROUND_ORDER;
        mesh.userData.chunk = chunk.row * (GRID / CHUNK_CELLS) + chunk.col;
        mesh.userData.detail = detail;
        mesh.visible = detail === "coarse";
        group.add(mesh);
      }
    }
    return group;
  }
  const shared = meshGeometry(terrain);
  // Two triangles a cell, or more where the cell is cut finer (4x4 Evolution 2's smoothed ground, worker/terrain-mesh.js).
  const per = terrain.indicesPerCell ?? 6;
  for (let chunkRow = 0; chunkRow < GRID / CHUNK_CELLS; chunkRow++) {
    for (let chunkCol = 0; chunkCol < GRID / CHUNK_CELLS; chunkCol++) {
      const indices = new Uint32Array(CHUNK_CELLS * CHUNK_CELLS * per);
      let count = 0, low = Infinity, high = -Infinity;
      for (let row = chunkRow * CHUNK_CELLS; row < (chunkRow + 1) * CHUNK_CELLS; row++) {
        const from = (row * GRID + chunkCol * CHUNK_CELLS) * per;
        for (let i = from; i < from + CHUNK_CELLS * per; i += 3) {
          const a = terrain.indices[i], b = terrain.indices[i + 1], c = terrain.indices[i + 2];
          // Outside a stadium's footprint the triangles are collapsed to a point.
          if (a === b && b === c) continue;
          indices[count++] = a; indices[count++] = b; indices[count++] = c;
          for (const vertex of [a, b, c]) {
            const y = terrain.positions[vertex * 3 + 1];
            if (y < low) low = y;
            if (y > high) high = y;
          }
        }
      }
      if (!count) continue;
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(shared.attributes)) geometry.setAttribute(name, attribute);
      geometry.setIndex(new THREE.BufferAttribute(count === indices.length ? indices : indices.slice(0, count), 1));
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3((chunkCol + 0.5) * side, (low + high) / 2, -(chunkRow + 0.5) * side),
        Math.hypot(side / 2, side / 2, (high - low) / 2));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = "terrain";
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = GROUND_ORDER;
      group.add(mesh);
    }
  }
  return group;
}

/**
 * The sky reflected by Community Patch 3 materials that ask for it (`reflectivity`), or null for none. Set before the
 * models and trucks of a scene are built (createTrackWorld does, from its `reflections` option).
 */
let reflectionMap = null;
export function setReflectionSky(sky, look) {
  reflectionMap?.dispose();
  reflectionMap = null;
  if (!sky) return;
  reflectionMap = dataTexture(sky, look, true);
  reflectionMap.mapping = THREE.EquirectangularReflectionMapping;
  reflectionMap.generateMipmaps = false;
  reflectionMap.minFilter = THREE.LinearFilter;
}

/** A texture name's stem: `ROCK.RAW`, `ROCK.PNG` and `ROCK` are one texture (Community Patch 3 resolves by stem). */
export const textureStem = (name) => String(name ?? "").toUpperCase().replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");

/*
  A model part's material. A legacy face takes Lambert shading, a cutout for face types 0x11 and 0x33, a blend where the
  record says so. A Community Patch 3 material (MRGL_MATERIAL) states its own: as JSTrackViewer maps it, LIT off draws
  unshaded, ALPHATEST wins over BLEND (a cutout writes depth), TWOSIDED draws both sides, TINT colours the texture, ADDITIVE
  adds, NOZWRITE leaves depth alone, and a lit material is Phong for its specular power and emissive.
*/
function modelMaterial(mesh, map, normalMap, aoMap = null, look = "enhanced") {
  const record = mesh.material;
  const flags = record?.flags ?? 0;
  const F = { LIT: 0x0001, BLEND: 0x0004, ALPHATEST: 0x0008, ADDITIVE: 0x0010, TWOSIDED: 0x0080, NOZWRITE: 0x0100, EMISSIVE: 0x0200, TINT: 0x0400, ALPHAREF: 0x0800, TEXSOLID: 0x2000 };
  if (!record) {
    const material = new THREE.MeshLambertMaterial({
      // Occlusion darkens the ambient light only, never the sun (AUTHORING_HD_ART.md 5b), which is how three.js applies it.
      map, normalMap, aoMap, color: map ? 0xffffff : new THREE.Color((mesh.color ?? 0x808080) & 0xffffff),
      // A 4x4 Evolution model's sheets are seen from both faces (worker/evo-models.js).
      transparent: mesh.blended, alphaTest: mesh.cutout ? 0.5 : 0, side: mesh.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      // The classic look keeps the faceted shading; the enhanced one uses the model's smooth normals.
      flatShading: look === "classic",
    });
    if (normalMap) material.normalScale.set(1, -1);
    // Self-lit faces (lamps, signs) ignore the scene's lighting.
    if (mesh.emissive) { material.emissive = new THREE.Color(0xffffff); material.emissiveMap = map; }
    return material;
  }
  const alphaTested = !!(flags & (F.ALPHATEST | F.TEXSOLID));
  const blended = !!(flags & F.BLEND) && !alphaTested;
  const tint = flags & F.TINT && record.tint ? record.tint : [1, 1, 1];
  const clamp01 = (v) => Math.min(1, Math.max(0, v ?? 1));
  const props = {
    map, color: map ? new THREE.Color(clamp01(tint[0]), clamp01(tint[1]), clamp01(tint[2])) : new THREE.Color((mesh.color ?? 0x808080) & 0xffffff),
    side: flags & F.TWOSIDED ? THREE.DoubleSide : THREE.FrontSide,
    transparent: blended, opacity: blended ? clamp01(record.baseAlpha) : 1,
    alphaTest: alphaTested ? (flags & F.ALPHAREF ? clamp01((record.alphaRef ?? 128) / 255) : 0.5) : 0,
    depthWrite: alphaTested || !(flags & F.NOZWRITE),
    blending: flags & F.ADDITIVE ? THREE.AdditiveBlending : THREE.NormalBlending,
  };
  if (!(flags & F.LIT)) return new THREE.MeshBasicMaterial(props);
  const material = new THREE.MeshPhongMaterial({
    ...props, normalMap, aoMap, flatShading: look === "classic",
    shininess: Math.max(0, record.specPower ?? 0),
    emissive: flags & F.EMISSIVE ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: flags & F.EMISSIVE ? clamp01(record.emissive ?? 0) : 0,
  });
  // DirectX (green-down) normal maps, at the material's strength.
  if (normalMap) material.normalScale.set(mesh.normalStrength ?? 1, -(mesh.normalStrength ?? 1));
  // Reflection (optional): the sky, by the record's reflectivity. Its Fresnel bias and strength are folded into one
  // amount, since this shading has no view-angle term.
  const reflect = clamp01(record.reflectivity ?? 0) * clamp01((record.fresnelBias ?? 0) + 0.5 * (record.fresnelStrength ?? 1));
  if (reflectionMap && reflect > 0.01) {
    material.envMap = reflectionMap;
    material.combine = THREE.MixOperation;
    material.reflectivity = Math.min(0.8, reflect);
  }
  return material;
}

/**
 * One geometry and material set per model, shared by every object that uses it. `cleanEdges`
 * ("Natural light", docs/VISUALS.md) rids cut-out pictures of their dark outline and draws their
 * edges soft where the picture is antialiased.
 */
export function createModelLibrary(models, modelTextures, look, { cleanEdges = false } = {}) {
  const textures = new Map();
  // The textures some face cuts out, known before any is made: their see-through texels take the picture's colour.
  const cutouts = new Set();
  if (cleanEdges) {
    for (const model of Object.values(models)) {
      for (const mesh of model?.meshes ?? []) if (mesh.textureName && (mesh.cutout || (mesh.material?.flags ?? 0) & 0x2008)) cutouts.add(mesh.textureName);
    }
  }
  const textureFor = (name) => {
    if (!textures.has(name)) {
      if (cutouts.has(name) && modelTextures[name]) bleedCutout(modelTextures[name]);
      textures.set(name, modelTextures[name] ? dataTexture(modelTextures[name], look, true) : null);
    }
    return textures.get(name);
  };
  // A texture's normal map and occlusion (Community Patch 3: `<stem>_N`, `<stem>_AO`), linear data rather than colour.
  const normalFor = (mesh, suffix = "_N") => {
    const stem = mesh.textureName ? textureStem(mesh.textureName) : null;
    const data = stem && modelTextures[`${stem}${suffix}`];
    if (!data) return null;
    const key = `${stem}${suffix}`;
    if (!textures.has(key)) {
      const t = dataTexture(data, look, true);
      t.colorSpace = THREE.NoColorSpace;
      textures.set(key, t);
    }
    return textures.get(key);
  };
  const library = new Map();
  for (const [name, model] of Object.entries(models)) {
    if (!model?.meshes?.length) continue;
    const parts = model.meshes.map((mesh, meshIndex) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
      if (model.keyframes?.length >= 2) {
        geometry.morphAttributes.position = model.keyframes.slice(1).map((frame) =>
          new THREE.BufferAttribute(frame.meshes[meshIndex].positions, 3));
        geometry.morphAttributes.normal = model.keyframes.slice(1).map((frame) =>
          new THREE.BufferAttribute(frame.meshes[meshIndex].normals, 3));
      }
      const frames = (mesh.textureFrames ?? []).map((n) => modelTextures[n]).filter(Boolean);
      const cycleKey = frames.length > 1 ? `cycle:${mesh.textureFrames.join(",")}` : null;
      if (cycleKey && !textures.has(cycleKey)) textures.set(cycleKey, cycleTexture(frames, look, true));
      const map = cycleKey ? textures.get(cycleKey) : mesh.textureName ? textureFor(mesh.textureName) : null;
      const material = modelMaterial(mesh, map, normalFor(mesh), normalFor(mesh, "_AO"), look);
      // A cut-out's edge is spread over the samples of an antialiased picture instead of being a stair of whole pixels.
      if (cleanEdges && material.alphaTest > 0) material.alphaToCoverage = true;
      material.userData.textureName = mesh.textureName?.toUpperCase() ?? null;
      return { geometry, material, frameCount: model.keyframes?.length ?? 0, frameSeconds: model.frameSeconds ?? null };
    });
    // A Mesh material (TEXSOLID) is drawn twice, as the engine does: the solid texels above (alpha tested), and glass across
    // the whole face, tinted and see-through, without writing depth.
    model.meshes.forEach((mesh, meshIndex) => {
      if (!(mesh.material && mesh.material.flags & 0x2000)) return;
      const tint = mesh.material.flags & 0x0400 && mesh.material.tint ? mesh.material.tint : [0.85, 0.9, 1];
      parts.push({
        geometry: parts[meshIndex].geometry,
        material: new THREE.MeshPhongMaterial({
          color: new THREE.Color(tint[0], tint[1], tint[2]), transparent: true, opacity: Math.min(0.6, Math.max(0.15, mesh.material.baseAlpha ?? 0.3)),
          depthWrite: false, shininess: Math.max(30, mesh.material.specPower ?? 60), side: mesh.material.flags & 0x0080 ? THREE.DoubleSide : THREE.FrontSide,
          // Glass shows the sky when reflections are on.
          ...(reflectionMap ? { envMap: reflectionMap, combine: THREE.MixOperation, reflectivity: 0.35 } : {}),
        }),
        frameCount: parts[meshIndex].frameCount,
      });
    });
    library.set(name, parts);
  }
  return library;
}

const LAMPS = { "STRTRED.RAW": [1, 0], "STRTGRN.RAW": [0, 2] };

/**
 * The start lights (MONSTER_EXE_ANALYSIS.md 6.1): during the countdown (`on`) the game fills the
 * red lamp texture with palette index 1 and the green with 0; after it, red with 0 and green with 2.
 * `colours` are the level palette's indices 0, 1 and 2 as RGB (track-build.js).
 */
export function setStartLights(world, on, colours) {
  if (!colours) return;
  world.traverse((o) => {
    const material = o.material;
    const lamp = material && LAMPS[material.userData?.textureName];
    if (!lamp) return;
    const [r, g, b] = colours[on ? lamp[0] : lamp[1]];
    const colour = new THREE.Color(r / 255, g / 255, b / 255);
    material.map = null;
    material.emissiveMap = null;
    material.color.copy(colour);
    material.emissive = colour;
    material.needsUpdate = true;
  });
}

/*
  Camera-facing scenery: the model turned about its own vertical so that its +z points at the
  camera, as `Object3D.lookAt` at the camera's place and the object's own height would turn it.
  Done per vertex, before the instance's placement, which for these is a move without a turn.
*/
const facingPars = (viewer) => /* glsl */ `
vec2 mtmFacing() {
  #ifdef USE_INSTANCING
    vec3 place = ( modelMatrix * instanceMatrix )[ 3 ].xyz;
  #else
    vec3 place = modelMatrix[ 3 ].xyz;
  #endif
  vec2 toCamera = ${viewer}.xz - place.xz;
  float distance = length( toCamera );
  // The sine and cosine of the turn; facing as placed when the camera is right above.
  return distance > 1e-4 ? toCamera / distance : vec2( 0.0, 1.0 );
}
vec3 mtmFace( vec3 v, vec2 turn ) {
  return vec3( v.x * turn.y + v.z * turn.x, v.y, v.z * turn.y - v.x * turn.x );
}
`;
const FACING_PARS = facingPars("cameraPosition");
/*
  A shadow map is drawn from the sun, and a camera-facing model's shadow does not turn with the
  camera: it is cast by the model held square to the sun, as the classic look's shadows are, and
  stays put however the camera goes round it. `SHADOW_TURN` is the sun's direction across the
  ground (the sine and cosine of that turn); `updateTrackWorld` keeps it from the world's sun.
*/
const SHADOW_TURN = { value: new THREE.Vector2(0, 1) };
const FACING_DEPTH_PARS = /* glsl */ `
uniform vec2 mtmShadowTurn;
vec2 mtmFacing() { return mtmShadowTurn; }
vec3 mtmFace( vec3 v, vec2 turn ) {
  return vec3( v.x * turn.y + v.z * turn.x, v.y, v.z * turn.y - v.x * turn.x );
}
`;
const facingMaterials = new WeakMap(), roundedMaterials = new WeakMap(), facingDepthMaterials = new WeakMap();
/*
  A camera-facing model is a flat card, and lit as one it brightens and darkens as the camera goes round it. `rounded`
  ("Natural light") lights it as the round thing it pictures instead: its face leans up, toward the camera and outward
  from its middle, so a tree has a sunny side and a crown lit from above, wherever it is seen from.
*/
const ROUNDED_NORMAL = "objectNormal = normalize( vec3( clamp( position.x * 0.09, - 0.75, 0.75 ), 0.6, 0.55 ) );";

/** A model part's material, with its vertices turned to face the camera. One per source material and way of lighting. */
function facingMaterial(material, rounded = false) {
  const made = rounded ? roundedMaterials : facingMaterials;
  if (!made.has(material)) {
    const facing = material.clone();
    facing.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${FACING_PARS}`)
        .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\n\tvec2 mtmTurn = mtmFacing();\n\t${rounded ? ROUNDED_NORMAL : ""}\n\tobjectNormal = mtmFace( objectNormal, mtmTurn );`)
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n\ttransformed = mtmFace( transformed, mtmTurn );");
    };
    facing.customProgramCacheKey = () => `mtm-facing|${rounded}`;
    made.set(material, facing);
  }
  return made.get(material);
}

/** The depth material for a camera-facing part's shadow, held square to the sun. One per source material: three.js gives it that material's texture. */
function facingDepthMaterial(material) {
  if (!facingDepthMaterials.has(material)) {
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => {
      shader.uniforms.mtmShadowTurn = SHADOW_TURN;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${FACING_DEPTH_PARS}`)
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n\ttransformed = mtmFace( transformed, mtmFacing() );");
    };
    facingDepthMaterials.set(material, depth);
  }
  return facingDepthMaterials.get(material);
}

const _placement = new THREE.Matrix4();
/** An object's matrix in one copy of the world; a camera-facing one keeps only its place. */
function placement(elements, [dx, dz], facing) {
  _placement.fromArray(elements);
  if (facing) _placement.makeTranslation(elements[12], elements[13], elements[14]);
  _placement.elements[12] += dx;
  _placement.elements[14] += dz;
  return _placement;
}

/** The sphere around all of a mesh's instances, with room for a camera-facing model's turning. */
function boundInstances(mesh) {
  mesh.computeBoundingSphere();
  if (mesh.userData.facing) mesh.boundingSphere.radius += mesh.geometry.boundingSphere.radius;
}

/** Write one block of a mesh's instances: the model's placements, moved by a copy's offset. */
function fillBlock(mesh, block, offset) {
  const { perCopy, facing, places } = mesh.userData;
  for (let i = 0; i < perCopy; i++) mesh.setMatrixAt(block * perCopy + i, placement(places[i], offset, facing));
}

/**
 * Every placed object that does not animate: one InstancedMesh per model part, holding the
 * model's placements in every copy of the world (`copies`, in worlds, the original first). A
 * model used as camera-facing scenery gets meshes of its own, with the facing material.
 *
 * The instances are kept in blocks, one copy of the world each; `order` says which copy a block
 * holds. The original is always the first block; `orderObjects` brings the copies in view to
 * the front and draws only those. `rounded` lights the camera-facing ones as round things.
 */
export function placeObjects(library, objects, copies = [[0, 0]], { rounded = false } = {}) {
  const byKey = new Map();
  // Where each SIT box is drawn, for moving it later: its meshes' name and its place among their instances.
  const slots = {};
  for (const object of objects) {
    const parts = library.get(object.model);
    if (!parts || object.moving || parts.some((part) => part.frameCount > 1)) continue;
    const key = object.billboard ? `${object.model}|facing` : object.model;
    if (!byKey.has(key)) byKey.set(key, { parts, facing: !!object.billboard, matrices: [] });
    const entry = byKey.get(key);
    if (object.sitIndex !== undefined) slots[object.sitIndex] = [key, entry.matrices.length];
    entry.matrices.push(object.matrix);
  }
  const offsets = copies.map(([dx, dz]) => [dx * WORLD_FT, dz * WORLD_FT]);
  const group = new THREE.Group();
  group.name = "objects";
  group.userData.slots = slots;
  group.userData.offsets = offsets;
  group.userData.order = offsets.map((_, copy) => copy);
  for (const [key, { parts, facing, matrices }] of byKey) {
    const perCopy = matrices.length, total = perCopy * offsets.length;
    for (const { geometry, material } of parts) {
      const instanced = new THREE.InstancedMesh(geometry, facing ? facingMaterial(material, rounded) : material, total);
      instanced.name = key;
      instanced.matrixAutoUpdate = false;
      // `places` is the model's placements in the original world, shared by the model's parts.
      Object.assign(instanced.userData, { perCopy, facing, places: matrices, blocks: offsets.length });
      if (facing) instanced.customDepthMaterial = facingDepthMaterial(material);
      offsets.forEach((offset, block) => fillBlock(instanced, block, offset));
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      boundInstances(instanced);
      // Only the original world casts shadows: its instances come first.
      instanced.onBeforeShadow = () => { instanced.count = perCopy; };
      instanced.onAfterShadow = () => { instanced.count = perCopy * instanced.userData.blocks; };
      group.add(instanced);
    }
  }
  return group;
}

/** How many changes to what never moves are remembered, for the shadow cascades to tell which of them a change reaches. */
const SHADOW_CHANGES_KEPT = 64;

/**
 * The static shadow copy (render/sun-shadows.js) was drawn from the world as it stood. Something that never moves, until
 * it does, has changed: `spheres` say where, `[x, y, z, radius]` in scene feet in the world's first copy, as it stood and
 * as it stands now. Without them the change is taken to reach everywhere.
 */
function bumpShadowStatic(world, spheres = null) {
  const serial = (world.userData.shadowStaticSerial ?? 0) + 1;
  world.userData.shadowStaticSerial = serial;
  const changes = (world.userData.shadowChanges ??= []);
  changes.push({ serial, spheres });
  if (changes.length > SHADOW_CHANGES_KEPT) changes.splice(0, changes.length - SHADOW_CHANGES_KEPT);
}

/** How far a model part reaches from the place `elements` (a column-major matrix) puts it at, feet. */
function partReach(mesh, elements) {
  const geometry = mesh.geometry;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const e = elements;
  const scale = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
  return (geometry.boundingSphere.center.length() + geometry.boundingSphere.radius) * scale;
}

/** Something that casts moved (an object the simulation moves, a falling tree): render/sun-shadows.js `invalidateIfMoved`. */
function bumpShadowMotion(world) {
  world.userData.shadowMotion = (world.userData.shadowMotion ?? 0) + 1;
}

/**
 * Draw the placed objects only in the copies of the world that are shown (`shown`, by copy): the
 * blocks of instances holding those are brought to the front, a block changing places with one
 * behind it, and the meshes draw that many blocks.
 */
function orderObjects(objects, shown) {
  const { order, offsets } = objects.userData;
  const count = shown.filter(Boolean).length;
  const rewritten = [];
  for (let front = 0; front < count; front++) {
    if (shown[order[front]]) continue;
    let behind = count;
    while (!shown[order[behind]]) behind++;
    [order[front], order[behind]] = [order[behind], order[front]];
    rewritten.push(front, behind);
  }
  for (const mesh of objects.children) {
    for (const block of rewritten) fillBlock(mesh, block, offsets[order[block]]);
    if (rewritten.length) mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.blocks = count;
    mesh.count = mesh.userData.perCopy * count;
    boundInstances(mesh);
  }
}

/**
 * How far past the eye's range a copy of the world still counts as in view, feet: room for what
 * stands on its edge. And the play that keeps a copy at the edge of the range from coming and
 * going with every step.
 */
const COPY_MARGIN_FT = 600, COPY_PLAY_FT = 300;

/**
 * Which copies of the world are drawn: the original always, another when any of its ground lies
 * within `range` feet of the camera. A copy out of view is not drawn at all: its ground, its
 * water, its animated objects, and its share of the placed objects.
 */
function showCopies(parts, camera, range) {
  const { copies, objects } = parts;
  if (copies.length < 2) return;
  // The camera where the copies are (`centreCopies`).
  const x = camera.position.x - parts.lattice.position.x, z = camera.position.z - parts.lattice.position.z;
  let changed = false;
  copies.forEach((copy, i) => {
    let shown = true;
    if (i > 0 && range < Infinity) {
      const away = Math.hypot(Math.max(copy.x0 - x, 0, x - copy.x1), Math.max(copy.z0 - z, 0, z - copy.z1));
      shown = away < range + COPY_MARGIN_FT + (copy.shown ? COPY_PLAY_FT : 0);
    }
    if (shown === copy.shown) return;
    copy.shown = shown;
    copy.group.visible = shown;
    changed = true;
  });
  if (changed && objects) orderObjects(objects, copies.map((copy) => copy.shown));
  return changed;
}


/**
 * Move the copies of the world by whole worlds so that the middle one is the copy the camera is over: the world goes
 * on without end however far the camera goes (the trucks and the camera are drawn where they went, not wrapped:
 * ui/screens/race.js). Whether they moved.
 */
function centreCopies(parts, camera) {
  if (parts.copies.length < 2) return false;
  const [dx, dz] = blockShift(WORLD_FT / 2, -WORLD_FT / 2, camera.position.x, camera.position.z);
  const { lattice } = parts;
  if (lattice.position.x === dx && lattice.position.z === dz) return false;
  lattice.position.set(dx, 0, dz);
  lattice.updateMatrix();
  return true;
}

/**
 * The placed objects that animate (keyframed models) or keep moving (`moving`: a 4x4 Evolution path's object, a
 * train), one group each with a mesh per part. They need their own morph state and place, so each copy of the world has
 * its own.
 */
export function placeAnimatedObjects(library, objects) {
  const group = new THREE.Group();
  group.name = "animated";
  const m = new THREE.Matrix4();
  for (const object of objects) {
    const parts = library.get(object.model);
    if (!parts || !(object.moving || parts.some((part) => part.frameCount > 1))) continue;
    const placed = new THREE.Group();
    placed.name = "placedObject";
    placed.userData.sitIndex = object.sitIndex;
    placed.userData.billboard = !!object.billboard;
    m.fromArray(object.matrix);
    if (object.billboard) placed.position.setFromMatrixPosition(m);
    else {
      placed.matrixAutoUpdate = false;
      placed.matrix.copy(m);
    }
    for (const part of parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      // Its shadow is drawn each frame with the trucks', not kept with the still ground's (render/sun-shadows.js).
      if (object.moving) mesh.userData.moving = true;
      if (part.frameCount > 1) {
        mesh.updateMorphTargets();
        mesh.userData.frameCount = part.frameCount;
        // A 4x4 Evolution placement's own time a frame (worker/evo-track-build.js).
        if (object.frameSeconds) mesh.userData.frameSeconds = object.frameSeconds;
      }
      placed.add(mesh);
    }
    group.add(placed);
  }
  return group.children.length ? group : null;
}

/** The side of a forest chunk, feet: the trees of one are drawn, and culled, together. */
const FOREST_CHUNK_FT = 1024;
/**
 * How near the camera a forest chunk's nearest edge is when its trees are drawn as models, feet; farther, as cards. The
 * game draws a tree's model within 512 ft of the camera and a card beyond (docs/EVO2_EXE_ANALYSIS.md 2.2); by chunks,
 * every tree within this distance is a model, and some up to a chunk's diagonal beyond it. `FOREST_LOD_PLAY_FT` keeps a
 * chunk at the edge from flipping back and forth.
 */
const FOREST_MODEL_FT = 512;
const FOREST_LOD_PLAY_FT = 64;

/**
 * 4x4 Evolution's trees (`object.forest`, worker/evo-track-build.js), thousands of them: one InstancedMesh per model part
 * and FOREST_CHUNK_FT chunk, holding the original world's trees only. Each frame a chunk is moved to the copy of the world
 * nearest the camera (`placeForest`), as the terrain's blocks are, so every tree is drawn once and whole chunks are culled
 * by their own bounds, in the picture and in each shadow cascade. Placed over every copy (`placeObjects`), every tree was
 * drawn nine times, and never culled. A tree with a card (`object.far`) is drawn as its model in the chunks near the
 * camera and as its card, turned to the camera, in the rest (`lod`): a forest of models is millions of triangles, nearly
 * all of them far off. `slots` finds a tree's instances by its `sitIndex`. `rounded` lights the cards as round things.
 */
export function createForest(library, objects, { rounded = false } = {}) {
  const byKey = new Map();
  const add = (model, matrix, sitIndex, lod, [cx, cz]) => {
    const parts = library.get(model);
    if (!parts || parts.some((part) => part.frameCount > 1)) return false;
    const key = `${model}|${lod ?? ""}|${cx}|${cz}`;
    if (!byKey.has(key)) byKey.set(key, { parts, model, lod, placed: [], at: [(cx + 0.5) * FOREST_CHUNK_FT, -(cz + 0.5) * FOREST_CHUNK_FT] });
    byKey.get(key).placed.push({ matrix, sitIndex });
    return true;
  };
  for (const object of objects) {
    const chunk = [Math.floor(object.matrix[12] / FOREST_CHUNK_FT), Math.floor(-object.matrix[14] / FOREST_CHUNK_FT)];
    const carded = !!object.far && library.has(object.far.model) && library.has(object.model);
    if (add(object.model, object.matrix, object.sitIndex, carded ? "model" : null, chunk) && carded) add(object.far.model, object.far.matrix, object.sitIndex, "card", chunk);
  }
  const group = new THREE.Group();
  group.name = "forest";
  const slots = {};
  const m = new THREE.Matrix4();
  for (const { parts, model, lod, placed, at } of byKey.values()) {
    const card = lod === "card";
    for (const { geometry, material } of parts) {
      const mesh = new THREE.InstancedMesh(geometry, card ? facingMaterial(material, rounded) : material, placed.length);
      mesh.name = model;
      mesh.matrixAutoUpdate = false;
      placed.forEach(({ matrix, sitIndex }, i) => {
        mesh.setMatrixAt(i, m.fromArray(matrix));
        if (sitIndex !== undefined) (slots[sitIndex] ??= []).push([mesh, i]);
      });
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      // A card's shadow is held square to the sun, as a camera-facing object's is.
      if (card) {
        mesh.userData.facing = true;
        mesh.customDepthMaterial = facingDepthMaterial(material);
      }
      boundInstances(mesh);
      mesh.userData.forestAt = at;
      mesh.userData.forestLod = lod;
      // After the ground, which hides most of a forest from most places (GROUND_ORDER).
      mesh.renderOrder = FOREST_ORDER;
      group.add(mesh);
    }
  }
  group.userData.slots = slots;
  return group.children.length ? group : null;
}

/**
 * Each forest chunk, and each tree falling by itself, at the copy of the world nearest the camera (`wraps`: the world
 * has copies), a chunk with cards as its models or its cards by how near it is (`createForest`); with a headset's
 * `range`, a chunk wholly beyond it is left out. Whether anything moved.
 */
function placeForest(parts, camera, range, wraps) {
  const cx = camera.position.x, cz = camera.position.z;
  let moved = false;
  const place = (object, [x, z], reach) => {
    const [dx, dz] = wraps ? blockShift(x, z, cx, cz) : [0, 0];
    if (object.position.x !== dx || object.position.z !== dz) { object.position.set(dx, 0, dz); object.updateMatrix(); moved = true; }
    let visible = range === Infinity || Math.hypot(x + dx - cx, z + dz - cz) <= range + reach;
    const lod = object.userData.forestLod;
    if (lod) {
      // How far the chunk's nearest edge is; the chunk's meshes all keep the same state, so they turn over together.
      const half = FOREST_CHUNK_FT / 2;
      const edge = Math.hypot(Math.max(0, Math.abs(x + dx - cx) - half), Math.max(0, Math.abs(z + dz - cz) - half));
      const near = object.userData.forestNear = edge < FOREST_MODEL_FT + (object.userData.forestNear ? FOREST_LOD_PLAY_FT : 0);
      visible &&= near === (lod === "model");
    }
    if (object.visible !== visible) { object.visible = visible; moved = true; }
  };
  if (parts.forest) for (const mesh of parts.forest.children) place(mesh, mesh.userData.forestAt, FOREST_CHUNK_FT);
  for (const falling of parts.falling) place(falling, falling.userData.forestAt, 200);
  return moved;
}

const _forestMatrix = new THREE.Matrix4();

/**
 * A forest tree's instances drawn with `matrix` (scene, column-major), or left out with null: a knocked tree is drawn
 * by itself while it falls (`addFallingTree`), then put back lying where it fell. Whether the tree is in the forest.
 */
export function setForestTree(world, sitIndex, matrix) {
  const parts = PARTS.get(world);
  const list = parts?.forest?.userData.slots[sitIndex];
  if (!list) return false;
  for (const [mesh, i] of list) {
    // A card stands for an upright tree: a knocked one has none.
    const card = mesh.userData.forestLod === "card";
    if (matrix && !card) _forestMatrix.fromArray(matrix);
    else {
      // Shrunk to nothing where it stands, so the chunk's bounds still hold it.
      mesh.getMatrixAt(i, _forestMatrix);
      const e = _forestMatrix.elements;
      for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) e[k] = 0;
    }
    mesh.setMatrixAt(i, _forestMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    // Only the one chunk's bounds: a tree lying down may reach past them.
    if (matrix && !card) mesh.computeBoundingSphere();
  }
  bumpShadowStatic(world);
  return true;
}

/**
 * A tree of `model` drawn by itself, for its fall: posed by `poseFallingTree`, kept at the copy of the world nearest the
 * camera, and taken out by `removeFallingTree`. It shares the forest's geometry and materials, and casts its shadow as
 * something that moves does. Null when the model is not in the world's library.
 */
export function addFallingTree(world, model, [x, z]) {
  const parts = PARTS.get(world);
  const pieces = parts?.library.get(model);
  if (!pieces) return null;
  const falling = new THREE.Group();
  falling.name = "fallingTree";
  falling.userData.forestAt = [x, z];
  falling.userData.world = world;
  const posed = new THREE.Group();
  posed.matrixAutoUpdate = false;
  for (const { geometry, material } of pieces) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !!parts.forest?.children[0]?.castShadow;
    mesh.receiveShadow = !!parts.forest?.children[0]?.receiveShadow;
    posed.add(mesh);
  }
  falling.add(posed);
  world.add(falling);
  parts.falling.push(falling);
  return falling;
}

/** A falling tree's pose: `matrix` scene, column-major, in the original world. */
export function poseFallingTree(falling, matrix) {
  const posed = falling.children[0];
  posed.matrix.fromArray(matrix);
  posed.matrixWorldNeedsUpdate = true;
  const world = falling.userData.world;
  if (world) bumpShadowMotion(world);
}

export function removeFallingTree(world, falling) {
  const parts = PARTS.get(world);
  bumpShadowMotion(world);
  falling.removeFromParent();
  if (parts) parts.falling = parts.falling.filter((f) => f !== falling);
}

/**
 * Move drawn SIT boxes: `moves` is `[{ sitIndex, matrix }]` with scene-frame matrices. Every
 * copy of the world is updated.
 */
export function moveObjects(world, moves) {
  const parts = PARTS.get(world);
  if (!moves.length || !parts) return;
  bumpShadowMotion(world);
  const m = new THREE.Matrix4();
  const bySit = new Map(moves.map((item) => [item.sitIndex, item]));
  for (const group of parts.placed) {
    const moved = bySit.get(group.userData.sitIndex);
    if (!moved) continue;
    m.fromArray(moved.matrix);
    if (group.userData.billboard) group.position.setFromMatrixPosition(m);
    else { group.matrix.copy(m); group.matrixWorldNeedsUpdate = true; }
  }
  if (!parts.objects) return;
  const { slots, offsets, order } = parts.objects.userData;
  const touched = new Set();
  parts.loose ??= new Map();
  // Where the still objects changed, as each stood and stands now, for the shadows: only the cascades its shadow reaches
  // are drawn again.
  const spheres = [];
  for (const { sitIndex, matrix } of moves) {
    const slot = slots[sitIndex];
    if (!slot) continue;
    // A still object that has started to move (a knocked sign, fence or crate) is drawn by itself from then on, its
    // shadow among the moving ones: kept among the instances, each move would make the shadows redraw every still
    // thing in the world, the forest with it, frame after frame (render/sun-shadows.js).
    const loose = parts.loose.get(sitIndex) ?? (parts.byName.get(slot[0])?.[0]?.userData.facing ? null : loosen(world, parts, sitIndex, slot, touched, spheres));
    if (loose) {
      loose.matrix.copy(placement(matrix, offsets[order[0]], false));
      loose.matrixWorldNeedsUpdate = true;
      continue;
    }
    let reach = 0, was = null;
    for (const mesh of parts.byName.get(slot[0]) ?? []) {
      const { perCopy, facing, places } = mesh.userData;
      reach = Math.max(reach, partReach(mesh, matrix));
      was ??= places[slot[1]] ?? null;
      // Kept, for when a block is written afresh; then every block, the copies not drawn too.
      places[slot[1]] = matrix;
      order.forEach((copy, block) => mesh.setMatrixAt(block * perCopy + slot[1], placement(matrix, offsets[copy], facing)));
      mesh.instanceMatrix.needsUpdate = true;
      touched.add(mesh);
    }
    if (was) spheres.push([was[12], was[13], was[14], reach]);
    spheres.push([matrix[12], matrix[13], matrix[14], reach]);
  }
  for (const mesh of touched) boundInstances(mesh);
  if (touched.size) bumpShadowStatic(world, spheres);
}

/** A shrunk matrix: an instance drawn as nothing, its place kept. */
const NOWHERE = Object.freeze(new THREE.Matrix4().makeScale(0, 0, 0).toArray());

/**
 * Take a SIT box out of the still objects' instances (`moveObjects`): its instances in every block are shrunk to
 * nothing, and a group of its own draws it, flagged `moving`. Its new meshes are handed to the shadows through
 * `world.userData.newDynamicCasters`. The instances it leaves are added to `touched`, and where it stood to `spheres`
 * (`bumpShadowStatic`).
 */
function loosen(world, parts, sitIndex, slot, touched, spheres) {
  const meshes = parts.byName.get(slot[0]) ?? [];
  if (!meshes.length) return null;
  const { offsets, order } = parts.objects.userData;
  const group = new THREE.Group();
  group.name = "looseObject";
  group.matrixAutoUpdate = false;
  group.userData.sitIndex = sitIndex;
  const added = [];
  // The model's parts share their places, so where it stood is read before the first part is shrunk.
  const was = meshes[0].userData.places[slot[1]] ?? null;
  let reach = 0;
  for (const instanced of meshes) {
    const { perCopy, places } = instanced.userData;
    if (was) reach = Math.max(reach, partReach(instanced, was));
    places[slot[1]] = NOWHERE;
    order.forEach((copy, block) => instanced.setMatrixAt(block * perCopy + slot[1], placement(NOWHERE, offsets[copy], false)));
    instanced.instanceMatrix.needsUpdate = true;
    touched.add(instanced);
    const mesh = new THREE.Mesh(instanced.geometry, instanced.material);
    mesh.castShadow = instanced.castShadow;
    mesh.receiveShadow = instanced.receiveShadow;
    mesh.userData.moving = true;
    group.add(mesh);
    added.push(mesh);
  }
  parts.objects.parent?.add(group) ?? world.add(group);
  (world.userData.newDynamicCasters ??= []).push(...added);
  parts.loose.set(sitIndex, group);
  if (was) spheres.push([was[12], was[13], was[14], reach]);
  return group;
}

/**
 * Tint drawn SIT boxes: `tints` maps a box's `sitIndex` to a CSS colour. The model's texture is made grey
 * (its darkest at half brightness) so the colour shows whatever the texture's own, its pattern kept as shades;
 * the model's other placements stay white, so they show that grey. Every copy of the world is tinted.
 */
export function tintObjects(world, tints) {
  const parts = PARTS.get(world);
  if (!parts?.objects || !tints.size) return;
  const { slots, offsets } = parts.objects.userData;
  const colour = new THREE.Color();
  for (const [sitIndex, css] of tints) {
    const slot = slots[sitIndex];
    if (!slot) continue;
    colour.set(css);
    for (const mesh of parts.byName.get(slot[0]) ?? []) {
      if (!mesh.instanceColor) {
        const white = new THREE.Color(1, 1, 1);
        for (let k = 0; k < mesh.instanceMatrix.count; k++) mesh.setColorAt(k, white);
        greyMap(mesh.material);
      }
      // Every block holds the copies' placements in the same order (`fillBlock`).
      for (let block = 0; block < offsets.length; block++) mesh.setColorAt(block * mesh.userData.perCopy + slot[1], colour);
      mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** A material's texture swapped for a grey copy of itself, from half to full brightness. */
function greyMap(material) {
  const map = material?.map;
  const image = map?.image;
  if (!image?.data || map.userData.grey) return;
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = 128 + luma / 2;
    data[i + 3] = image.data[i + 3];
  }
  const grey = map.clone();
  grey.image = { data, width: image.width, height: image.height };
  grey.userData = { grey: true };
  grey.needsUpdate = true;
  material.map = grey;
  material.needsUpdate = true;
}

/** Draw the SIT backdrop models as camera-centred scenery behind the world. */
/** Where the sky's cap, the sky and a track's backdrop come in the opaque pass when the backdrop is drawn: before the world, at 0. */
const SKY_CAP_FIRST = -4, SKY_FIRST = -3, BACKDROP_ORDER = -2;

/**
 * Draw the sky and a track's backdrop before the world, as the game draws its backdrop, and have the far fade take the
 * world's opaque materials to the backdrop instead of to the fog's colour (render/atmosphere.js `fadesToBackdrop`): the
 * whole backdrop, its floor too, is seen behind the ground's far edge, with no band of fog over it.
 */
function drawBackdropFirst(world) {
  world.userData.fadesToBackdrop = true;
  const skip = new Set();
  for (const name of ["sky", "backdrops"]) world.getObjectByName(name)?.traverse((o) => skip.add(o));
  const sky = world.getObjectByName("sky");
  if (sky) {
    sky.renderOrder = SKY_FIRST;
    if (sky.userData.cap) sky.userData.cap.renderOrder = SKY_CAP_FIRST;
  }
  world.traverse((o) => {
    if (!o.isMesh || skip.has(o)) return;
    for (const material of [o.material].flat()) fadesToBackdrop(material);
  });
}

export function createBackdrops(build, look) {
  if (!build.backdrops?.length) return null;
  // An HD backdrop's panels sit in a ring of see-through texels: sealed, so that faces meeting show no seam. The game's
  // own RAW backdrop is a keyed cut-out whose silhouette is the skyline: sealing it would smear its rim up into the sky
  // as a solid band. Its see-through texels only take the colour beside them, so filtering reads the rim, not black.
  const sealed = { ...build.modelTextures };
  for (const name of build.backdrops) {
    for (const mesh of build.models[name]?.meshes ?? []) {
      const image = sealed[mesh.textureName];
      if (!image || image !== build.modelTextures[mesh.textureName] || !hasAlpha(image)) continue;
      if (image.source === "RAW") {
        const copy = { ...image, rgba: new Uint8Array(image.rgba) };
        bleedCutout(copy);
        sealed[mesh.textureName] = copy;
      } else sealed[mesh.textureName] = sealPanels(image);
    }
  }
  const library = createModelLibrary(build.models, sealed, look);
  const group = new THREE.Group();
  group.name = "backdrops";
  const uniforms = {
    backdropTint: { value: new THREE.Color(0xffffff) }, backdropSaturation: { value: 1 }, backdropVeil: { value: new THREE.Vector4(0, 0, 0, 0) },
    backdropHaze: { value: 0 },
  };
  // As the game draws it: first, after the sky and before the world (`drawBackdropFirst`), so the far world fades into
  // it (render/atmosphere.js `fadesToBackdrop`). The group stays at 0 (three.js sorts by the nearest Group's renderOrder
  // first, and the sky is part of `world`); the meshes carry BACKDROP_ORDER. Depth is not written, so the world is drawn
  // over it wherever it is, however far; it is drawn at the far plane (installBackdropShader). An HD backdrop (a PNG with
  // its own alpha) is blended over the sky in the same place, not in the see-through pass, which comes after the world.
  group.renderOrder = 0;
  for (const name of build.backdrops) {
    for (const part of library.get(name) ?? []) {
      const source = part.material;
      const material = new THREE.MeshBasicMaterial({
        map: source.map, color: source.color, transparent: false,
        alphaTest: source.alphaTest, side: THREE.DoubleSide, depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth,
        fog: false,
      });
      if (source.transparent) {
        // Blended by its alpha over the sky, the picture's own alpha kept.
        Object.assign(material, {
          blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
          blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
        });
      }
      // The panels run round the horizon (S) but not over it (T): the picture's top row is never filtered into its bottom.
      if (material.map && material.map.wrapT !== THREE.ClampToEdgeWrapping) { material.map.wrapT = THREE.ClampToEdgeWrapping; material.map.needsUpdate = true; }
      installBackdropShader(material, uniforms);
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.renderOrder = BACKDROP_ORDER;
      group.add(mesh);
    }
  }
  group.userData.uniforms = uniforms;
  return group.children.length ? group : null;
}

/*
  The backdrop is unlit, so it would stay in full daylight under a dusk or night sky; the weather tints and greys it instead,
  with JSTrackViewer's values for Clear, Cloudy, Dusk and Night and the port's for the rest.
*/
export const BACKDROP_WEATHER = Object.freeze({
  0: [0xffffff, 1], 1: [0xb4b4b8, 0.45], 2: [0x9c9ca2, 0.35], 3: [0x8a8a90, 0.25], 4: [0x8c8c96, 0.4],
  5: [0xc6c8cc, 0.4], 6: [0x7a6466, 0.9], 7: [0x3c3d58, 0.8], 8: [0x16161e, 0.6],
});

/** Whether a texture has see-through texels. */
function hasAlpha({ rgba }) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
  return false;
}

/**
 * A copy of an HD backdrop picture whose panels are sealed: the see-through texels within `reach` of a solid one take its
 * colour and become solid, so filtering at the edge of a face reads the panel and not the ring round it, and two faces
 * that meet show no line of sky between them. The game's 2-texel gutters of the RAW art did this; a PNG's ring does not.
 */
function sealPanels({ width, height, rgba }, reach = 3) {
  const out = new Uint8Array(rgba);
  let solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i++) solid[i] = out[i * 4 + 3] >= 250 ? 1 : 0;
  for (let pass = 0; pass < reach; pass++) {
    const next = solid.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        if (solid[at]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ox = x + dx, oy = y + dy;
            if (ox < 0 || oy < 0 || ox >= width || oy >= height) continue;
            const o = oy * width + ox;
            if (!solid[o]) continue;
            r += out[o * 4]; g += out[o * 4 + 1]; b += out[o * 4 + 2]; n++;
          }
        }
        if (!n) continue;
        out[at * 4] = r / n; out[at * 4 + 1] = g / n; out[at * 4 + 2] = b / n; out[at * 4 + 3] = 255;
        next[at] = 1;
      }
    }
    solid = next;
  }
  return { width, height, rgba: out };
}

function installBackdropShader(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // At the far plane: behind everything the world draws, as the game's backdrop, drawn first with depth off, is.
    shader.vertexShader = shader.vertexShader
      .replace("#include <project_vertex>", "#include <project_vertex>\n\tgl_Position.z = gl_Position.w;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 backdropTint;\nuniform float backdropSaturation;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float backdropGrey = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(backdropGrey), diffuseColor.rgb, backdropSaturation) * backdropTint;`);
    // The fog between the eye and the backdrop, or the darkness (render/atmosphere.js).
    veilBackdropShader(shader);
  };
  material.customProgramCacheKey = () => "backdrop-weather-veiled";
}

const _veil = new THREE.Color();

/**
 * Tint the world's backdrop for `weather` (0 Clear ... 8 Pitch Black). `veil`, where the scene
 * keeps its fog with the backdrop drawn and the fog is not a volume (the dark weathers), is the
 * fog's colour and how much of the backdrop it takes: `{ color: THREE.Color, amount }`.
 */
export function setBackdropWeather(world, weather, veil = null) {
  const uniforms = world?.getObjectByName("backdrops")?.userData.uniforms;
  if (!uniforms) return;
  const [tint, saturation] = BACKDROP_WEATHER[weather] ?? BACKDROP_WEATHER[0];
  uniforms.backdropTint.value.setHex(tint);
  uniforms.backdropSaturation.value = saturation;
  uniforms.backdropHaze.value = BACKDROP_HAZED.has(weather) ? 1 : 0;
  // The veil is mixed in after the picture's colours are encoded for where they are going, so its colour is encoded the same way.
  if (veil) screenColor(veil.color, _veil);
  uniforms.backdropVeil.value.set(veil ? _veil.r : 0, veil ? _veil.g : 0, veil ? _veil.b : 0, veil?.amount ?? 0);
}

/**
 * The world as a window around the camera: every block (a piece of ground, a block of scenery, an object that stands
 * by itself, the water) is moved by whole worlds to the copy nearest the camera. A block's place is its bounds'
 * centre, read each frame since what it holds may move (a train).
 */
export function placeBlocks(world, camera, viewRange = Infinity) {
  let blocks = world.userData.blocks;
  if (!blocks) {
    blocks = [];
    world.traverse((o) => { if (o.userData.block) blocks.push(o); });
    world.userData.blocks = blocks;
  }
  const cx = camera.position.x, cz = camera.position.z;
  let moved = false;
  for (const o of blocks) {
    let x, z;
    const held = o.userData.holds;
    if (held) {
      if (held.matrixAutoUpdate) { x = held.position.x; z = held.position.z; } else { x = held.matrix.elements[12]; z = held.matrix.elements[14]; }
    } else if (o.userData.blockAt) {
      [x, z] = o.userData.blockAt;
    } else {
      const sphere = o.boundingSphere ?? o.geometry?.boundingSphere;
      if (!sphere) continue;
      x = sphere.center.x; z = sphere.center.z;
    }
    const [dx, dz] = blockShift(x, z, cx, cz);
    if (o.position.x !== dx || o.position.z !== dz) { o.position.x = dx; o.position.z = dz; o.updateMatrix(); moved = true; }
    // A headset may draw the fog in. Do not submit a block wholly beyond that range; ordinary
    // flat rendering passes Infinity and leaves visibility to the camera frustum as before.
    const radius = (o.boundingSphere ?? o.geometry?.boundingSphere)?.radius ?? 300;
    const visible = Math.hypot(x + dx - cx, z + dz - cz) <= viewRange + radius;
    if (o.visible !== visible) { o.visible = visible; moved = true; }
  }
  if (moved) bumpShadowStatic(world);
}

/**
 * Where a top-crush cab stands among its `frames` (0 the first, intact; the last, flat) when it is crushed by `share`
 * of the most it can be (worker/sim-worker.js `crushShare`).
 */
export function crushFrame(share, frames) {
  return Math.max(0, Math.min(1, share)) * (frames - 1);
}

const _target = new THREE.Vector3();

/**
 * Once a frame: advance keyframe morphs, face the camera-facing objects and keep the backdrop
 * around the camera.
 *
 * `viewRange`, when given, is how far the eye can see, in feet (the fog's end): terrain chunks
 * wholly beyond it are not drawn, nor any copy of the world that lies wholly beyond it. A
 * headset uses it (docs/VR.md, "What it costs"); the flat screen draws everything in view, as
 * it always has. `fineRange` is how near a chunk of the drawn ground must be to be drawn fine.
 */
export function updateTrackWorld(world, camera, dt, { viewRange = Infinity, fineRange = FINE_RANGE_FT } = {}) {
  world.userData.animationTime = (world.userData.animationTime ?? 0) + dt;

  const parts = PARTS.get(world);
  // A world without recorded parts is drawn once, as a window around the camera: every block of
  // it is moved each frame to the copy nearest the camera (`placeBlocks`).
  if (!parts) placeBlocks(world, camera, viewRange);
  // The turn of the camera-facing models' shadows (race.js enableShadows sets the sun's).
  const sunTurn = world.userData.shadowTurn;
  if (sunTurn) SHADOW_TURN.value.copy(sunTurn);
  if (parts) {
    if (parts.grass) updateEvoGrass(parts.grass, camera, world.userData.grassPressers ?? null);
    if (parts.backdrops) parts.backdrops.position.copy(camera.position);
    for (const object of parts.placed) {
      if (!object.userData.billboard) continue;
      _target.set(camera.position.x, object.position.y, camera.position.z);
      object.lookAt(_target);
      // The copies that cast the shadow keep a fixed turn to the sun, whatever way the object turns (race.js enableShadows).
      const facing = world.userData.shadowFacing;
      if (facing) for (const child of object.children) if (child.userData.shadowProxy) child.quaternion.copy(object.quaternion).invert().multiply(facing);
    }
    for (const mesh of parts.morphing) {
      const n = mesh.userData.frameCount;
      const p = (world.userData.animationTime / (mesh.userData.frameSeconds || 0.5)) % n, from = Math.floor(p), to = (from + 1) % n, t = p - from;
      mesh.morphTargetInfluences.fill(0);
      if (from > 0) mesh.morphTargetInfluences[from - 1] += 1 - t;
      if (to > 0) mesh.morphTargetInfluences[to - 1] += t;
    }
    if (centreCopies(parts, camera)) bumpShadowStatic(world);
    if (showCopies(parts, camera, viewRange)) bumpShadowStatic(world);
    // The camera where the copies are, for the ground's chunks.
    const localX = camera.position.x - parts.lattice.position.x, localZ = camera.position.z - parts.lattice.position.z;
    if ((parts.forest || parts.falling.length) && placeForest(parts, camera, viewRange, parts.copies.length > 1)) bumpShadowStatic(world);
    for (const chunk of parts.chunks) {
      const dx = Math.abs(chunk.x - localX), dz = Math.abs(chunk.z - localZ);
      const seen = Math.hypot(dx, dz) < viewRange + chunk.radius;
      if (!chunk.fine) { chunk.mesh.visible = seen; continue; }
      // Fine within range of the chunk's nearest edge; both levels have the same border, so neighbours of either kind meet.
      chunk.near = Math.hypot(Math.max(0, dx - chunk.half), Math.max(0, dz - chunk.half)) < fineRange + (chunk.near ? FINE_PLAY_FT : 0);
      chunk.fine.visible = seen && chunk.near;
      chunk.mesh.visible = seen && !chunk.near;
    }
    return;
  }
  // A world without recorded parts: find everything by walking it.
  const target = new THREE.Vector3();
  world.traverse((object) => {
    if (object.name === "backdrops") object.position.copy(camera.position);
    if (object.userData.billboard) {
      target.set(camera.position.x, object.position.y, camera.position.z);
      object.lookAt(target);
      // The copies that cast the shadow keep a fixed turn to the sun, whatever way the object turns (race.js enableShadows).
      const facing = world.userData.shadowFacing;
      if (facing) for (const child of object.children) if (child.userData.shadowProxy) child.quaternion.copy(object.quaternion).invert().multiply(facing);
    }
    const n = object.userData.frameCount;
    if (!n || !object.morphTargetInfluences) return;
    // A top-crush car's cab is not played: its frames run from intact to flat, and it stands where its crush is.
    if (object.userData.crushCar !== undefined) {
      const at = crushFrame(world.userData.crush?.[object.userData.crushCar] ?? 0, n);
      // Between two frames the nearer weighs more; frame 0 is the mesh itself.
      for (let k = 1; k < n; k++) object.morphTargetInfluences[k - 1] = Math.max(0, 1 - Math.abs(at - k));
      return;
    }
    // As the game plays it (shared/keyframe-spline.js). Frame 0 is the mesh itself: it takes what the targets leave of 1.
    const weights = keyframeWeights(world.userData.animationTime, n, object.userData.frameSeconds || DEFAULT_FRAME_SECONDS);
    for (let k = 1; k < n; k++) object.morphTargetInfluences[k - 1] = weights[k];
  });
}

/** Sixteen sides, four rings (MONSTER_EXE_ANALYSIS.md 11c, 0x42bca0). */
const SKY_SIDES = 16;
/** Elevation of each ring: the first a hair over the horizon, then 22.5, 45 and 67.5 degrees. */
const SKY_RINGS = [0.019634955, Math.PI / 8, Math.PI / 4, (Math.PI * 3) / 8];
/** Where each ring reads the sky texture, in pixels of its 256 rows: bottom to top, clamped to 2..254. */
const SKY_ROWS = [254, 170 + 2 / 3, 85 + 1 / 3, 2];

/**
 * The sky dome the game draws (0x42bca0): a ring of 16 quads around the viewer for each band between
 * four rings of elevation. Each quad takes 64 texels of the texture across (so it repeats four times
 * around the horizon) and the rows run from the bottom of the texture at the horizon to its top at 67.5
 * degrees. Above that a flat cap (createSky) fills the hole.
 */
export function skyGeometry(radius = 6000) {
  const positions = [], uvs = [], index = [];
  for (let i = 0; i <= SKY_SIDES; i++) {
    const azimuth = (i / SKY_SIDES) * Math.PI * 2;
    SKY_RINGS.forEach((elevation, ring) => {
      // The game's axes are x right, y up, z forward; the scene mirrors z.
      positions.push(Math.sin(azimuth) * Math.cos(elevation) * radius, Math.sin(elevation) * radius, -Math.cos(azimuth) * Math.cos(elevation) * radius);
      uvs.push((i * 64) / 256, SKY_ROWS[ring] / 256);
    });
  }
  const at = (i, ring) => i * SKY_RINGS.length + ring;
  for (let i = 0; i < SKY_SIDES; i++) {
    for (let ring = 0; ring < SKY_RINGS.length - 1; ring++) {
      index.push(at(i, ring), at(i + 1, ring), at(i + 1, ring + 1), at(i, ring), at(i + 1, ring + 1), at(i, ring + 1));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/** The colour of the sky texture's top rows (the ring edge at 67.5 degrees reads row 2), for the cap over the dome's hole. */
export function skyCapColor(sky) {
  const row = Math.min(2, sky.height - 1) * sky.width * 4;
  let r = 0, g = 0, b = 0;
  for (let x = 0; x < sky.width; x++) { r += sky.rgba[row + x * 4]; g += sky.rgba[row + x * 4 + 1]; b += sky.rgba[row + x * 4 + 2]; }
  return new THREE.Color().setRGB(r / sky.width / 255, g / sky.width / 255, b / sky.width / 255, THREE.SRGBColorSpace);
}

/**
 * A sky dome around the camera, textured with the level's sky. The game fills what the rings leave open
 * above them with a flat square of one colour from the sky texture (0x42bca0, drawn first); the cap is that.
 */
/** MTM1's flat sky: how high over the camera it hangs, the feet one tile of its art spans, and its half width (JSTrackViewer's figures, in feet). */
const FLAT_SKY_HEIGHT_FT = 512, FLAT_SKY_TILE_FT = 2048, FLAT_SKY_HALF_FT = 16384;

/**
 * MTM1's own sky (worker/track-build.js `loadFlatSky`): a flat ceiling a fixed height over the camera, its art fixed to
 * the world so it slides past overhead, fading into the level's horizon colour with distance as the game's fog table
 * fades everything. `reach` is the view's range in feet.
 */
function createFlatSky(sky, look, reach) {
  const map = dataTexture(sky, look, true);
  const horizon = new THREE.Color().setRGB(sky.flat.horizon[0] / 255, sky.flat.horizon[1] / 255, sky.flat.horizon[2] / 255, THREE.SRGBColorSpace);
  const material = new THREE.ShaderMaterial({
    // `ceiling`: a sky fixed in the world at this height in feet (a Terminal Velocity or Hellbender level's, which can be
    // flown up to); below zero it hangs over the camera wherever it goes, as MTM1's does.
    uniforms: {
      map: { value: map }, horizon: { value: horizon }, fade: { value: new THREE.Vector2(reach * 0.4, reach) }, tile: { value: FLAT_SKY_TILE_FT },
      ceiling: { value: Number.isFinite(sky.flat.ceilingFt) ? sky.flat.ceilingFt - FLAT_SKY_HEIGHT_FT : -1e9 },
    },
    vertexShader: `
      uniform float tile;
      uniform float ceiling;
      varying vec2 vSkyUv;
      varying float vSkyDistance;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        world.y += ceiling < -1.0e8 ? cameraPosition.y : ceiling;
        vSkyUv = world.xz / tile;
        vSkyDistance = length(world.xz - cameraPosition.xz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 horizon;
      uniform vec2 fade;
      varying vec2 vSkyUv;
      varying float vSkyDistance;
      void main() {
        vec3 colour = texture2D(map, vSkyUv).rgb;
        gl_FragColor = vec4(mix(colour, horizon, smoothstep(fade.x, fade.y, vSkyDistance)), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, fog: false, depthTest: true, depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(FLAT_SKY_HALF_FT * 2, FLAT_SKY_HALF_FT * 2, 32, 32).rotateX(Math.PI / 2).translate(0, FLAT_SKY_HEIGHT_FT, 0);
  const plane = new THREE.Mesh(geometry, material);
  plane.name = "sky";
  plane.userData.flat = true;
  plane.userData.fixed = Number.isFinite(sky.flat.ceilingFt);
  plane.userData.reach = reach;
  plane.frustumCulled = false;
  // With the dome: after the world, so only the sky that shows is shaded (the cap is the dome's, at 1).
  plane.renderOrder = 2;
  return plane;
}

export function createSky(sky, look, radius = 6000) {
  if (!sky) return null;
  if (sky.flat) return createFlatSky(sky, look, radius);
  const map = dataTexture(sky, look, true);
  // The scene's fog leaves the sky alone; the fog as a volume veils it by how far through the layer each direction looks.
  // The sky art is shown as it is: no curve over it (render/light-rig.js).
  const material = veilSky(new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, fog: false, depthWrite: false, toneMapped: false }));
  const dome = new THREE.Mesh(skyGeometry(radius), material);
  dome.userData.radius = radius;
  dome.name = "sky";
  // After the opaque world, before anything see-through. Depth is tested and not written, so a fragment behind the
  // world is skipped and the sky does not hide what is drawn over it later.
  dome.renderOrder = 2;
  const half = radius * 0.5556;
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2).rotateX(Math.PI / 2),
    veilSky(new THREE.MeshBasicMaterial({ color: skyCapColor(sky), side: THREE.DoubleSide, fog: false, depthWrite: false, toneMapped: false })));
  cap.position.y = radius;
  cap.renderOrder = 1;
  dome.add(cap);
  dome.userData.cap = cap;
  return dome;
}

/** Put a new sky (another weather) on an existing dome. */
const SKIES = new WeakMap();

/** The world's sky (`createSky`), found once and kept until `updateSky` puts another in its place. */
export function skyOf(world) {
  let sky = SKIES.get(world);
  if (!sky || !sky.parent) {
    sky = world.getObjectByName("sky") ?? null;
    if (sky) SKIES.set(world, sky);
  }
  return sky;
}

export function updateSky(dome, sky, look) {
  if (!dome || !sky) return;
  // A flat sky and a dome are different objects: one takes the other's place (the weather changed).
  if (dome.userData.flat || sky.flat) {
    const fresh = createSky(sky, look, dome.userData.flat ? dome.userData.reach : dome.userData.radius);
    dome.parent?.add(fresh);
    dome.parent?.remove(dome);
    dome.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.uniforms?.map?.value?.dispose?.(); o.material?.dispose?.(); });
    return;
  }
  const old = dome.material.map;
  dome.material.map = dataTexture(sky, look, true);
  dome.material.needsUpdate = true;
  dome.userData.cap?.material.color.copy(skyCapColor(sky));
  old?.dispose();
}

/** The average colour of the sky art, for the clear colour and fog. */
export function skyColor(sky) {
  if (!sky) return new THREE.Color(0x8fb6d8);
  // A flat sky fades into its horizon colour, which is then the clear colour and the fog's.
  if (sky.flat) return new THREE.Color().setRGB(sky.flat.horizon[0] / 255, sky.flat.horizon[1] / 255, sky.flat.horizon[2] / 255, THREE.SRGBColorSpace);
  let r = 0, g = 0, b = 0;
  const n = sky.rgba.length / 4;
  for (let i = 0; i < sky.rgba.length; i += 4) { r += sky.rgba[i]; g += sky.rgba[i + 1]; b += sky.rgba[i + 2]; }
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

export function createWater(levelFt, reach = 3) {
  if (levelFt === null || levelFt === undefined) return null;
  // `reach`: how many worlds wide, for a level that is drawn once (its sea goes on past its edges); the texture keeps its size.
  const geometry = new THREE.PlaneGeometry(8192 * reach, 8192 * reach);
  if (reach !== 1) { const uv = geometry.getAttribute("uv"); for (let i = 0; i < uv.array.length; i++) uv.array[i] *= reach; }
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(4096, levelFt, -4096);
  // Seen from below as well: under the surface the water is the ceiling (it is drawn from both sides).
  const material = new THREE.MeshLambertMaterial({ color: 0x2b5f7a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  const water = new THREE.Mesh(geometry, material);
  water.name = "water";
  water.userData.levelFt = levelFt;
  // Three worlds wide and moved by whole worlds with the camera, so its edge is never in sight and its texture, which
  // repeats every world, stays where it was.
  water.userData.block = true;
  water.userData.blockAt = [4096, -4096];
  return water;
}

/**
 * A truck's parts as one group in body coordinates (scene frame): the body at the origin, a tire
 * at each wheel anchor (left model where x < 0), an axle model across each axle at hub height.
 */
export function createTruck(truck, look) {
  const library = createModelLibrary(
    Object.fromEntries(Object.values(truck.parts).filter(Boolean).map((m) => [m.name, m])), truck.textures, look);
  const group = new THREE.Group();
  group.name = truck.file;
  const add = (part, x, y, z) => {
    for (const { geometry, material } of library.get(part.name) ?? []) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, -z);
      group.add(mesh);
    }
  };
  if (truck.parts.body) add(truck.parts.body, 0, 0, 0);
  truck.anchors.forEach((a) => {
    if (!a) return;
    const tire = a[0] < 0 ? truck.parts.tireLeft : truck.parts.tireRight;
    if (tire) add(tire, a[0], a[1], a[2]);
  });
  if (truck.parts.axle) {
    for (const [right] of [[0], [2]]) {
      const a = truck.anchors[right];
      if (a) add(truck.parts.axle, 0, a[1], a[2]);
    }
  }
  return group;
}

/**
 * CART Precision Racing's road layer (worker/cpr-road.js): a mesh per texture, the road and curbs facing up, the walls
 * seen from both sides, the catch fence a cutout. Drawn a little towards the viewer in depth, since the road lies on
 * the ground it covers. The classic look draws it unlit, as it does the ground.
 */
export function createRoad(road, look) {
  const group = new THREE.Group();
  group.name = "road";
  const maps = new Map();
  const mapOf = (key) => {
    if (!maps.has(key)) {
      const image = key === "fence" ? road.fence : road.textures[key];
      maps.set(key, image ? dataTexture(image, look, true) : null);
    }
    return maps.get(key);
  };
  const Material = look === "classic" ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
  for (const mesh of road.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const map = mapOf(mesh.texture);
    const fence = mesh.texture === "fence";
    const material = new Material({
      map, color: map ? 0xffffff : fence ? 0x9a9a9a : 0x717178, side: THREE.DoubleSide,
      alphaTest: fence && map ? 0.5 : 0, transparent: fence && !map, opacity: fence && !map ? 0.3 : 1,
      polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2,
    });
    const object = new THREE.Mesh(geometry, material);
    // The surface casts no shadow (it would shade itself and the ground it lies on); the walls do.
    object.name = mesh.wall ? "roadWall" : "road";
    object.receiveShadow = true;
    group.add(geometry.getIndex() ? inBlocks(object) : object);
  }
  return group;
}

/** Everything static in a track: terrain, ground boxes, objects, water and sky. */
/**
 * `options.backdrops` draws the SIT's backdrop models (off unless asked), `options.drawDistance` the world's reach in feet
 * (the sky dome stays inside it), `options.naturalLight` lights camera-facing scenery as round things (docs/VISUALS.md, "Light").
 * `options.terrainDetail` and `options.reflections` are Community Patch 3's extras (the enhanced look only).
 */
export function createTrackWorld(build, look, { backdrops: showBackdrops = false, drawDistance = 20000, naturalLight = false, terrainDetail = true, reflections = true, grass: grassRadius = 16 } = {}) {
  const world = new THREE.Group();
  // The world wraps at 8192 ft, so its eight neighbouring copies are drawn too, kept around the camera (`centreCopies`);
  // a stadium stands alone, and so does a level whose edges do not meet (`noWrap`).
  const copies = build.stadium || build.noWrap ? WORLD_COPIES.slice(0, 1) : WORLD_COPIES;
  // What each copy has for itself: the ground, the water and the animated objects.
  const tile = new THREE.Group();
  tile.name = "tile";
  setReflectionSky(reflections && look !== "classic" && !build.stadium ? build.sky : null, look);
  const atlas = createTerrainAtlas(build.terrain.atlas, look);
  tile.add(createTerrain({ ...build.terrain, roadMask: build.road?.mask ?? null }, look, atlas, { detail: terrainDetail }));
  const boxes = build.groundBoxes ? createGroundBoxes(build.groundBoxes, atlas, look) : null;
  if (boxes) tile.add(boxes);
  if (build.road) tile.add(createRoad(build.road, look));
  const library = createModelLibrary(build.models, build.modelTextures, look, { cleanEdges: naturalLight });
  const animated = placeAnimatedObjects(library, build.objects);
  if (animated) tile.add(animated);
  const water = createWater(build.waterLevelFt, build.noWrap ? 5 : 1);
  if (water) tile.add(water);
  // The copies and the placed objects, moved together by whole worlds to stay around the camera (`centreCopies`).
  const lattice = new THREE.Group();
  lattice.name = "copies";
  lattice.matrixAutoUpdate = false;
  world.add(lattice);
  lattice.add(tile);
  // The copies share every geometry, material and texture with the original.
  const tiles = [tile];
  for (const [dx, dz] of copies.slice(1)) {
    const copy = tile.clone();
    copy.position.set(dx * WORLD_FT, 0, dz * WORLD_FT);
    copy.updateMatrix();
    copy.matrixAutoUpdate = false;
    lattice.add(copy);
    tiles.push(copy);
  }
  // Every other object, in all the copies at once; 4x4 Evolution's trees by chunks around the camera (`createForest`).
  const objects = placeObjects(library, build.objects.filter((o) => !o.forest), copies, { rounded: naturalLight });
  lattice.add(objects);
  const forest = createForest(library, build.objects.filter((o) => o.forest), { rounded: naturalLight });
  if (forest) world.add(forest);
  const backdrops = createBackdrops(build, look);
  if (backdrops && showBackdrops && !build.stadium) world.add(backdrops);
  if (!build.stadium) {
    // A stadium replaces the sky (MONSTER.EXE draws it instead).
    const sky = createSky(build.sky, look, Math.min(6000, drawDistance * 0.95));
    if (sky) world.add(sky);
  }
  // The ground each copy covers (scene x and z), for telling which copies are in view. The
  // terrain's chunks share their vertices, so any one of them has the whole ground's.
  const vertices = tile.getObjectByName("terrain")?.geometry.attributes.position;
  const ground = vertices ? new THREE.Box3().setFromBufferAttribute(vertices) : new THREE.Box3(new THREE.Vector3(0, 0, -WORLD_FT), new THREE.Vector3(WORLD_FT, 0, 0));
  // 4x4 Evolution's grass, around the camera (render/evo-grass.js).
  const grass = grassRadius > 0 && build.grass ? createEvoGrass(build.grass, terrainOfBuild(build), grassRadius) : null;
  if (grass) world.add(grass.mesh);
  if (backdrops && showBackdrops && !build.stadium) drawBackdropFirst(world);
  const parts = {
    grass, forest, falling: [], library, lattice,
    objects, byName: new Map(), placed: [], morphing: [], chunks: [], backdrops: backdrops && !build.stadium ? backdrops : null,
    copies: tiles.map((group) => ({
      group, shown: true,
      x0: ground.min.x + group.position.x, x1: ground.max.x + group.position.x, z0: ground.min.z + group.position.z, z1: ground.max.z + group.position.z,
    })),
  };
  for (const mesh of objects.children) {
    if (!parts.byName.has(mesh.name)) parts.byName.set(mesh.name, []);
    parts.byName.get(mesh.name).push(mesh);
  }
  const chunkOf = new Map();
  world.traverse((object) => {
    if (object.name === "placedObject") parts.placed.push(object);
    if (object.userData.frameCount && object.morphTargetInfluences) parts.morphing.push(object);
    if (object.name === "terrain") {
      const { center, radius } = object.geometry.boundingSphere;
      const copy = object.parent.parent;
      // The drawn ground has two meshes a chunk, one for each level of detail.
      const key = object.userData.chunk === undefined ? object : `${copy.id}|${object.userData.chunk}`;
      if (!chunkOf.has(key)) {
        chunkOf.set(key, { mesh: null, fine: null, near: false, x: center.x + copy.position.x, z: center.z + copy.position.z, radius, half: (CHUNK_CELLS * CELL_FT) / 2 });
        parts.chunks.push(chunkOf.get(key));
      }
      const chunk = chunkOf.get(key);
      if (object.userData.detail === "fine") chunk.fine = object; else chunk.mesh = object;
      chunk.radius = Math.max(chunk.radius, radius);
    }
  });
  PARTS.set(world, parts);
  return world;
}

/** The sky stays level with the ground until the camera is this high, feet, then rises with it. */
export const SKY_EYE_FT = 200;

/**
 * Keep the sky around the camera, and out of its reach: the dome goes with the camera across the world, and up with it
 * once the camera is SKY_EYE_FT high, so however high a truck is thrown or a camera flown the sky is never met. A sky
 * fixed in the world (a Terminal Velocity or Hellbender level's ceiling, `userData.fixed`) keeps its height: that one
 * can be reached.
 */
export function placeSky(sky, camera) {
  if (!sky) return;
  sky.position.set(camera.position.x, sky.userData.fixed ? 0 : Math.max(0, camera.position.y - SKY_EYE_FT), camera.position.z);
}

/** Dispose of a group's geometry, materials and textures. */
export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [o.material].flat()) { m?.map?.dispose?.(); m?.dispose?.(); }
  });
}
