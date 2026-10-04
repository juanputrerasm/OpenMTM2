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

function dataTexture({ rgba, width, height }, look, repeat = false) {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Texture rows are stored top first; three.js reads the first row as the bottom.
  texture.flipY = false;
  const nearest = look === "classic";
  texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = nearest ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
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

export function createTerrain(terrain, look, map = createTerrainAtlas(terrain.atlas, look)) {
  const mesh = new THREE.Mesh(meshGeometry(terrain), surfaceMaterial(map, look, terrain.hasLte));
  mesh.name = "terrain";
  return mesh;
}

/** One geometry and material set per model, shared by every object that uses it. */
export function createModelLibrary(models, modelTextures, look) {
  const textures = new Map();
  const textureFor = (name) => {
    if (!textures.has(name)) textures.set(name, modelTextures[name] ? dataTexture(modelTextures[name], look, true) : null);
    return textures.get(name);
  };
  const library = new Map();
  for (const [name, model] of Object.entries(models)) {
    if (!model?.meshes?.length) continue;
    const parts = model.meshes.map((mesh) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
      const map = mesh.textureName ? textureFor(mesh.textureName) : null;
      const params = {
        map,
        color: map ? 0xffffff : new THREE.Color((mesh.color ?? 0x808080) & 0xffffff),
        transparent: mesh.blended,
        alphaTest: mesh.cutout ? 0.5 : 0,
        side: THREE.FrontSide,
      };
      const material = new THREE.MeshLambertMaterial(params);
      material.userData.textureName = mesh.textureName?.toUpperCase() ?? null;
      // Self-lit faces (lamps, signs) ignore the scene's lighting.
      if (mesh.emissive) {
        material.emissive = new THREE.Color(0xffffff);
        material.emissiveMap = map;
      }
      return { geometry, material };
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

/** A sky dome around the camera, textured with the level's sky. */
export function createSky(sky, look) {
  if (!sky) return null;
  const map = dataTexture(sky, look, true);
  // Rows are stored top first and the dome's v runs upward, so the texture is flipped in v.
  map.repeat.set(4, -2);
  const geometry = new THREE.SphereGeometry(6000, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(geometry, material);
  dome.name = "sky";
  dome.renderOrder = -1;
  return dome;
}

/** The average colour of the sky art, for the clear colour and fog. */
export function skyColor(sky) {
  if (!sky) return new THREE.Color(0x8fb6d8);
  let r = 0, g = 0, b = 0;
  const n = sky.rgba.length / 4;
  for (let i = 0; i < sky.rgba.length; i += 4) { r += sky.rgba[i]; g += sky.rgba[i + 1]; b += sky.rgba[i + 2]; }
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

export function createWater(levelFt) {
  if (levelFt === null || levelFt === undefined) return null;
  const geometry = new THREE.PlaneGeometry(8192, 8192);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(4096, levelFt, -4096);
  const material = new THREE.MeshLambertMaterial({ color: 0x2b5f7a, transparent: true, opacity: 0.6, depthWrite: false });
  const water = new THREE.Mesh(geometry, material);
  water.name = "water";
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

/** Everything static in a track: terrain, ground boxes, objects, water and sky. */
export function createTrackWorld(build, look) {
  const world = new THREE.Group();
  const tile = new THREE.Group();
  tile.name = "tile";
  const atlas = createTerrainAtlas(build.terrain.atlas, look);
  tile.add(createTerrain(build.terrain, look, atlas));
  const boxes = createGroundBoxes(build.groundBoxes, atlas, look);
  if (boxes) tile.add(boxes);
  tile.add(placeObjects(createModelLibrary(build.models, build.modelTextures, look), build.objects));
  const water = createWater(build.waterLevelFt);
  if (water) tile.add(water);
  world.add(tile);
  if (!build.stadium) {
    // The world wraps at 8192 ft: draw the eight neighbouring copies, which share every geometry,
    // material and texture with the original.
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      if (!dx && !dz) continue;
      const copy = tile.clone();
      copy.position.set(dx * WORLD_FT, 0, dz * WORLD_FT);
      world.add(copy);
    }
    // A stadium replaces the sky (MONSTER.EXE draws it instead).
    const sky = createSky(build.sky, look);
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
