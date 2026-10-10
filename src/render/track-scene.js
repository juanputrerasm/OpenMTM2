/*
  A track as three.js objects, from the asset worker's build (worker/track-build.js).

  Everything arrives in scene coordinates already (shared/scene-frame.js), so this module only
  makes geometry, textures and materials.

  Looks (settings.look):
  - "classic": as the 1998 software renderer shaded it. Terrain is unlit and darkened by the
    .LTE's baked ground brightness; textures are point-sampled.
  - "enhanced": the same art, lit by the level's sun with smooth normals and filtered textures.
*/
import * as THREE from "three";
import { WORLD_FT } from "../shared/scene-frame.js";

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
export function createTerrainAtlas(atlas, look) {
  const map = dataTexture(atlas, look);
  // Mipmaps would blend neighbouring atlas tiles together.
  map.minFilter = look === "classic" ? THREE.NearestFilter : THREE.LinearFilter;
  map.generateMipmaps = false;
  return map;
}

function surfaceMaterial(map, look, hasShade) {
  return look === "classic"
    ? new THREE.MeshBasicMaterial({ map, vertexColors: hasShade })
    : new THREE.MeshLambertMaterial({ map });
}

export function createGroundBoxes(boxes, map, look) {
  if (!boxes) return null;
  const mesh = new THREE.Mesh(meshGeometry(boxes), surfaceMaterial(map, look, boxes.hasLte));
  mesh.name = "groundBoxes";
  return mesh;
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

/**
 * `detail`: whether Community Patch 3's terrain extras are drawn (the enhanced look only): the HD tiles' normal maps
 * and, on a track with a painted mask, the detail normals.
 */
export function createTerrain(terrain, look, map = createTerrainAtlas(terrain.atlas, look), { detail = true } = {}) {
  const material = surfaceMaterial(map, look, terrain.hasLte);
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
  const mesh = new THREE.Mesh(meshGeometry(terrain), material);
  mesh.name = "terrain";
  return mesh;
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

/** One geometry and material set per model, shared by every object that uses it. */
export function createModelLibrary(models, modelTextures, look) {
  const textures = new Map();
  const textureFor = (name) => {
    if (!textures.has(name)) textures.set(name, modelTextures[name] ? dataTexture(modelTextures[name], look, true) : null);
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
      material.userData.textureName = mesh.textureName?.toUpperCase() ?? null;
      return { geometry, material, frameCount: model.keyframes?.length ?? 0 };
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

/** Every placed object, one InstancedMesh per model part. */
export function placeObjects(library, objects) {
  const byModel = new Map();
  // Where each SIT box is drawn, for moving it later (plain data: clones copy userData as JSON).
  const slots = {};
  for (const object of objects) {
    if (!library.has(object.model)) continue;
    const animated = library.get(object.model).some((part) => part.frameCount > 1);
    if (object.billboard || animated) continue;
    if (!byModel.has(object.model)) byModel.set(object.model, []);
    if (object.sitIndex !== undefined) slots[object.sitIndex] = [object.model, byModel.get(object.model).length];
    byModel.get(object.model).push(object.matrix);
  }
  const group = new THREE.Group();
  group.name = "objects";
  group.userData.slots = slots;
  const m = new THREE.Matrix4();
  for (const [name, matrices] of byModel) {
    for (const { geometry, material } of library.get(name)) {
      const instanced = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((elements, i) => instanced.setMatrixAt(i, m.fromArray(elements)));
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere();
      instanced.name = name;
      group.add(instanced);
    }
  }
  // Facing and keyframed objects need their own Object3D state. Static scenery stays instanced.
  for (const object of objects) {
    const parts = library.get(object.model);
    if (!parts) continue;
    const animated = parts.some((part) => part.frameCount > 1);
    if (!object.billboard && !animated) continue;
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
      if (part.frameCount > 1) {
        mesh.updateMorphTargets();
        mesh.userData.frameCount = part.frameCount;
      }
      placed.add(mesh);
    }
    group.add(placed);
  }
  return group;
}

/**
 * Move drawn SIT boxes: `moves` is `[{ sitIndex, matrix }]` with scene-frame matrices. Every
 * wrapped copy of the tile is updated.
 */
export function moveObjects(world, moves) {
  if (!moves.length) return;
  const m = new THREE.Matrix4();
  world.traverse((group) => {
    if (group.name === "placedObject") {
      const moved = moves.find((item) => item.sitIndex === group.userData.sitIndex);
      if (moved) {
        m.fromArray(moved.matrix);
        if (group.userData.billboard) group.position.setFromMatrixPosition(m);
        else { group.matrix.copy(m); group.matrixWorldNeedsUpdate = true; }
      }
      return;
    }
    if (group.name !== "objects") return;
    const slots = group.userData.slots ?? {};
    for (const { sitIndex, matrix } of moves) {
      const slot = slots[sitIndex];
      if (!slot) continue;
      m.fromArray(matrix);
      for (const mesh of group.children) {
        if (mesh.name !== slot[0]) continue;
        mesh.setMatrixAt(slot[1], m);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.moved = true;
      }
    }
    for (const mesh of group.children) {
      if (!mesh.userData.moved) continue;
      mesh.computeBoundingSphere();
      mesh.userData.moved = false;
    }
  });
}

/** Draw the SIT backdrop models as camera-centred scenery behind the world. */
export function createBackdrops(build, look) {
  if (!build.backdrops?.length) return null;
  const library = createModelLibrary(build.models, build.modelTextures, look);
  const group = new THREE.Group();
  group.name = "backdrops";
  const uniforms = { backdropTint: { value: new THREE.Color(0xffffff) }, backdropSaturation: { value: 1 } };
  // After the sky dome, before ordinary depth-writing world geometry. three.js sorts by the nearest Group's renderOrder
  // first (the sky dome counts as part of `world`, order 0), so this group keeps 0 and its meshes carry the -0.5; a group
  // order below the sky's would draw the backdrop first and the dome would paint over it.
  group.renderOrder = 0;
  for (const name of build.backdrops) {
    for (const part of library.get(name) ?? []) {
      const source = part.material;
      const material = new THREE.MeshBasicMaterial({
        map: source.map, color: source.color, transparent: source.transparent,
        alphaTest: source.alphaTest, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
        fog: false,
      });
      installBackdropShader(material, uniforms);
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.renderOrder = -0.5;
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

function installBackdropShader(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 backdropTint;\nuniform float backdropSaturation;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float backdropGrey = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(backdropGrey), diffuseColor.rgb, backdropSaturation) * backdropTint;`);
  };
  material.customProgramCacheKey = () => "backdrop-weather";
}

/** Tint the world's backdrop for `weather` (0 Clear ... 8 Pitch Black). */
export function setBackdropWeather(world, weather) {
  const uniforms = world?.getObjectByName("backdrops")?.userData.uniforms;
  if (!uniforms) return;
  const [tint, saturation] = BACKDROP_WEATHER[weather] ?? BACKDROP_WEATHER[0];
  uniforms.backdropTint.value.setHex(tint);
  uniforms.backdropSaturation.value = saturation;
}

/** Face billboards, advance keyframe morphs and keep the backdrop around the camera. */
export function updateTrackWorld(world, camera, dt) {
  world.userData.animationTime = (world.userData.animationTime ?? 0) + dt;
  const phase = world.userData.animationTime / 0.5;
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
    const p = phase % n, from = Math.floor(p), to = (from + 1) % n, t = p - from;
    object.morphTargetInfluences.fill(0);
    if (from > 0) object.morphTargetInfluences[from - 1] += 1 - t;
    if (to > 0) object.morphTargetInfluences[to - 1] += t;
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
    uniforms: { map: { value: map }, horizon: { value: horizon }, fade: { value: new THREE.Vector2(reach * 0.4, reach) }, tile: { value: FLAT_SKY_TILE_FT } },
    vertexShader: `
      uniform float tile;
      varying vec2 vSkyUv;
      varying float vSkyDistance;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        world.y += cameraPosition.y;
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
    side: THREE.DoubleSide, fog: false, depthTest: false, depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(FLAT_SKY_HALF_FT * 2, FLAT_SKY_HALF_FT * 2, 32, 32).rotateX(Math.PI / 2).translate(0, FLAT_SKY_HEIGHT_FT, 0);
  const plane = new THREE.Mesh(geometry, material);
  plane.name = "sky";
  plane.userData.flat = true;
  plane.userData.reach = reach;
  plane.frustumCulled = false;
  plane.renderOrder = -1;
  return plane;
}

export function createSky(sky, look, radius = 6000) {
  if (!sky) return null;
  if (sky.flat) return createFlatSky(sky, look, radius);
  const map = dataTexture(sky, look, true);
  const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(skyGeometry(radius), material);
  dome.userData.radius = radius;
  dome.name = "sky";
  dome.renderOrder = -1;
  const half = radius * 0.5556;
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: skyCapColor(sky), side: THREE.DoubleSide, fog: false, depthWrite: false }));
  cap.position.y = radius;
  cap.renderOrder = -2;
  dome.add(cap);
  dome.userData.cap = cap;
  return dome;
}

/** Put a new sky (another weather) on an existing dome. */
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

export function createWater(levelFt, reach = 1) {
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
    group.add(object);
  }
  return group;
}

/** Everything static in a track: terrain, ground boxes, objects, water and sky. */
/** `options.backdrops` draws the SIT's backdrop models (off unless asked), `options.drawDistance` the world's reach in feet (the sky dome stays inside it). */
export function createTrackWorld(build, look, { backdrops: showBackdrops = false, drawDistance = 20000, terrainDetail = true, reflections = true } = {}) {
  const world = new THREE.Group();
  const tile = new THREE.Group();
  tile.name = "tile";
  setReflectionSky(reflections && look !== "classic" && !build.stadium ? build.sky : null, look);
  const atlas = createTerrainAtlas(build.terrain.atlas, look);
  tile.add(createTerrain({ ...build.terrain, roadMask: build.road?.mask ?? null }, look, atlas, { detail: terrainDetail }));
  const boxes = build.groundBoxes ? createGroundBoxes(build.groundBoxes, atlas, look) : null;
  if (boxes) tile.add(boxes);
  if (build.road) tile.add(createRoad(build.road, look));
  tile.add(placeObjects(createModelLibrary(build.models, build.modelTextures, look), build.objects));
  const water = createWater(build.waterLevelFt, build.noWrap ? 5 : 1);
  if (water) tile.add(water);
  world.add(tile);
  const backdrops = createBackdrops(build, look);
  if (backdrops && showBackdrops && !build.stadium) world.add(backdrops);
  if (!build.stadium) {
    // The world wraps at 8192 ft: draw the eight neighbouring copies, which share every geometry,
    // material and texture with the original. (Not a level whose edges do not meet, `noWrap`.)
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      if ((!dx && !dz) || build.noWrap) continue;
      const copy = tile.clone();
      copy.position.set(dx * WORLD_FT, 0, dz * WORLD_FT);
      world.add(copy);
    }
    // A stadium replaces the sky (MONSTER.EXE draws it instead).
    const sky = createSky(build.sky, look, Math.min(6000, drawDistance * 0.95));
    if (sky) world.add(sky);
  }
  return world;
}

/** Dispose of a group's geometry, materials and textures. */
export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [o.material].flat()) { m?.map?.dispose?.(); m?.dispose?.(); }
  });
}
