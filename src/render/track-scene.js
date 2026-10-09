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
      return { geometry, material, frameCount: model.keyframes?.length ?? 0 };
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
export function createSky(sky, look, radius = 6000) {
  if (!sky) return null;
  const map = dataTexture(sky, look, true);
  const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(skyGeometry(radius), material);
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
  const old = dome.material.map;
  dome.material.map = dataTexture(sky, look, true);
  dome.material.needsUpdate = true;
  dome.userData.cap?.material.color.copy(skyCapColor(sky));
  old?.dispose();
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

/** Everything static in a track: terrain, ground boxes, objects, water and sky. */
/** `options.backdrops` draws the SIT's backdrop models (off unless asked), `options.drawDistance` the world's reach in feet (the sky dome stays inside it). */
export function createTrackWorld(build, look, { backdrops: showBackdrops = false, drawDistance = 20000 } = {}) {
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
  const backdrops = createBackdrops(build, look);
  if (backdrops && showBackdrops && !build.stadium) world.add(backdrops);
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
