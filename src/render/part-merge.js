/*
  A model's parts drawn together (shared/part-layers.js): the textures of one size as the layers of a stack, the parts
  that differ only in their texture joined into one, and one material for every model's parts of a kind, so that the
  graphics card is handed far fewer draws and far fewer changes of material between them.

  A part is left as it is when anything but its texture is its own: a normal or occlusion map, a texture that runs
  through frames or that the port repaints (the start lights, a drag strip's tree), a shader of its own (Community
  Patch 3's glass), keyframes, an order among the see-through things.
*/
import * as THREE from "three";
import { groupParts, joinParts, planLayers } from "../shared/part-layers.js";
import { addShaderHook } from "./shader-hooks.js";

/** The textures the port repaints or swaps while a race runs (track-scene.js `setStartLights`, start-lamps.js, drag-tree-lamps.js): their parts stay apart. */
const LIVE_TEXTURES = new Set(["STRTRED.RAW", "STRTGRN.RAW", "TRLFACE.RAW"]);

/*
  Read a stack's layer in place of the material's texture: the layer a vertex names (`mapLayer`). The stack is the
  material's `mapLayers`, and its `map` is left empty: three.js hands a material's `map` to whatever else draws its mesh
  (the depth material of a shadow), which would read a stack as a flat texture.
*/
function readsLayers(material, stack) {
  material.mapLayers = stack;
  material.addEventListener("dispose", () => stack.dispose());
  const uniform = { value: stack };
  return addShaderHook(material, "map-layers", 5, (shader) => {
    shader.uniforms.mapLayers = uniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <uv_pars_vertex>", "#include <uv_pars_vertex>\nattribute float mapLayer;\nvarying vec3 vMapLayerUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvMapLayerUv = vec3( uv, mapLayer );");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nuniform mediump sampler2DArray mapLayers;\nvarying vec3 vMapLayerUv;")
      .replace("#include <map_fragment>", "\tdiffuseColor *= texture( mapLayers, vMapLayerUv );");
  });
}

const hex = (color) => (color ? color.getHexString() : "-");
/** What a part's material is, but for its texture: two parts with the same are drawn alike. */
function materialKind(m) {
  return [
    m.type, hex(m.color), m.side, m.transparent ? 1 : 0, m.opacity, m.alphaTest, m.depthWrite ? 1 : 0, m.depthTest ? 1 : 0, m.blending, m.flatShading ? 1 : 0,
    m.alphaToCoverage ? 1 : 0, m.shininess ?? "-", hex(m.specular), hex(m.emissive), m.emissiveIntensity ?? "-", m.envMap?.id ?? "-", m.combine ?? "-", m.reflectivity ?? "-",
    m.vertexColors ? 1 : 0, m.fog ? 1 : 0, m.toneMapped ? 1 : 0,
  ].join("|");
}

/** Whether a texture can be a stack's layer, and of which kind of stack: its size and the way it is read. */
function textureKind(map) {
  const image = map?.image;
  if (!map?.isDataTexture || map.userData.cycle || map.userData.grey || !image?.data || image.data.length !== image.width * image.height * 4) return null;
  if (map.format !== THREE.RGBAFormat || map.type !== THREE.UnsignedByteType) return null;
  return [image.width, image.height, map.magFilter, map.minFilter, map.wrapS, map.wrapT, map.anisotropy, map.colorSpace, map.generateMipmaps ? 1 : 0, map.flipY ? 1 : 0].join("|");
}

/** Whether a part can be joined with others: nothing but its texture is its own (see the top). */
function joins(part) {
  const { geometry, material: m } = part;
  if (!geometry || !m || part.frameCount > 1 || part.renderOrder !== undefined) return false;
  if (geometry.index || Object.keys(geometry.morphAttributes).length) return false;
  const names = Object.keys(geometry.attributes);
  if (names.length !== 3 || !geometry.attributes.position || !geometry.attributes.normal || !geometry.attributes.uv) return false;
  if (!(m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial)) return false;
  if (m.normalMap || m.aoMap || m.emissiveMap || m.alphaMap || m.specularMap || m.lightMap || m.bumpMap) return false;
  if (m.userData.shaderHooks || Object.prototype.hasOwnProperty.call(m, "onBeforeCompile")) return false;
  if (LIVE_TEXTURES.has(m.userData.textureName)) return false;
  return !m.map || textureKind(m.map) !== null;
}

/** A stack of textures of one kind as one texture, read as each of them was. */
function stackTexture(maps) {
  const first = maps[0], { width, height } = first.image, layer = width * height * 4;
  const data = new Uint8Array(layer * maps.length);
  maps.forEach((map, i) => data.set(map.image.data, i * layer));
  const stack = new THREE.DataArrayTexture(data, width, height, maps.length);
  stack.format = first.format;
  stack.type = first.type;
  stack.colorSpace = first.colorSpace;
  stack.flipY = first.flipY;
  stack.magFilter = first.magFilter;
  stack.minFilter = first.minFilter;
  stack.generateMipmaps = first.generateMipmaps;
  stack.anisotropy = first.anisotropy;
  stack.wrapS = first.wrapS;
  stack.wrapT = first.wrapT;
  stack.needsUpdate = true;
  return stack;
}

const depthMaterials = new WeakMap();
/**
 * The depth material for the shadow of a cut-out part that reads a stack: the shadow is cut out by the same layers.
 * Without one three.js draws the shadow with its own depth material, which is right for a part with no cut-out and
 * would make a cut-out's shadow whole. Null for a part that needs none.
 */
function layersDepthMaterial(material) {
  if (!(material.alphaTest > 0) && !material.alphaToCoverage) return null;
  if (!depthMaterials.has(material)) depthMaterials.set(material, readsLayers(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), material.mapLayers));
  return depthMaterials.get(material);
}

/** A material like `source` that reads `stack` in place of its texture. */
function layersMaterial(source, stack) {
  const material = source.clone();
  material.map = null;
  material.userData = { textureName: null, mapLayers: true };
  // What the source was told to be drawn as (render/atmosphere.js `fadesToBackdrop`), but for the sun's shadows, which
  // each material is set up for by itself (render/sun-shadows.js).
  const defines = Object.entries(source.defines ?? {}).filter(([name]) => !/CSM|SHADOW/.test(name));
  if (defines.length) material.defines = Object.fromEntries(defines);
  return readsLayers(material, stack);
}

/**
 * Join the parts of each model in `models` (an iterable of a model's parts, `[{ geometry, material, frameCount }]`,
 * from track-scene.js `createModelLibrary`). Returns a map from each model's parts to the parts to draw it with: the
 * joined ones, `{ geometry, material, depthMaterial }` (`depthMaterial`, where not null, to be the mesh's `customDepthMaterial`), and
 * those left as they were. The models' own parts are not changed.
 *
 * `apart` gives each model materials of its own, where otherwise every model's parts of a kind share one: for models
 * that are dressed apart afterwards (a truck's body, tires and gear, each with its own shine: render/gloss.js).
 */
export function mergeModelParts(models, { apart = false } = {}) {
  const lists = [...new Set(models)];
  // Every texture a part that joins reads, in stacks by kind.
  const maps = [];
  for (const parts of lists) for (const part of parts) if (joins(part) && part.material.map) maps.push(part.material.map);
  const { stacks, where } = planLayers(maps, textureKind);
  const textures = stacks.map((stack) => stackTexture(stack.items));
  const materials = new Map();
  const merged = new Map();
  lists.forEach((parts, index) => {
    const groups = groupParts(parts, (part) => {
      if (!joins(part)) return null;
      const map = part.material.map;
      return `${apart ? `${index}#` : ""}${materialKind(part.material)}#${map ? where.get(map).stack : "none"}`;
    });
    merged.set(parts, groups.map(({ key, parts: group }) => {
      const first = group[0], map = first.material.map;
      // Nothing to join, and no texture to share a material by: the part as it is.
      if (key === null || (group.length === 1 && !map)) return first;
      const joined = joinParts(group.map((part) => ({
        positions: part.geometry.attributes.position.array, normals: part.geometry.attributes.normal.array, uvs: part.geometry.attributes.uv.array,
        layer: part.material.map ? where.get(part.material.map).layer : 0,
      })));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(joined.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(joined.normals, 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(joined.uvs, 2));
      if (!map) return { geometry, material: first.material, frameCount: first.frameCount, frameSeconds: first.frameSeconds };
      geometry.setAttribute("mapLayer", new THREE.BufferAttribute(joined.layers, 1));
      if (!materials.has(key)) materials.set(key, layersMaterial(first.material, textures[where.get(map).stack]));
      const material = materials.get(key);
      return { geometry, material, depthMaterial: layersDepthMaterial(material), frameCount: first.frameCount, frameSeconds: first.frameSeconds };
    }));
  });
  return merged;
}

/**
 * A material that reads a stack (`mergeModelParts`), with the stack made grey, from half to full brightness: for
 * track-scene.js `tintObjects`, whose colours then show whatever the textures' own. A material of its own, since the
 * one it is made from is drawn by other models too. `{ material, depthMaterial }`.
 */
export function greyLayersMaterial(source) {
  const map = source.mapLayers, image = map.image;
  const data = new Uint8Array(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = 128 + luma / 2;
    data[i + 3] = image.data[i + 3];
  }
  const grey = new THREE.DataArrayTexture(data, image.width, image.height, image.depth);
  for (const name of ["format", "type", "colorSpace", "flipY", "magFilter", "minFilter", "generateMipmaps", "anisotropy", "wrapS", "wrapT"]) grey[name] = map[name];
  grey.needsUpdate = true;
  const material = layersMaterial(source, grey);
  material.userData.grey = true;
  return { material, depthMaterial: layersDepthMaterial(material) };
}
