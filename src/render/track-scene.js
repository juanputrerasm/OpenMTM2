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

export function createTerrain(terrain, look) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(terrain.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(terrain.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(terrain.uvs, 2));
  const colors = new Float32Array(terrain.shade.length * 3);
  for (let i = 0; i < terrain.shade.length; i++) colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = terrain.shade[i];
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(terrain.indices, 1));
  geometry.computeBoundingSphere();

  const map = dataTexture(terrain.atlas, look);
  // Mipmaps would blend neighbouring atlas tiles together.
  map.minFilter = look === "classic" ? THREE.NearestFilter : THREE.LinearFilter;
  map.generateMipmaps = false;
  const material = look === "classic"
    ? new THREE.MeshBasicMaterial({ map, vertexColors: terrain.hasLte })
    : new THREE.MeshLambertMaterial({ map });
  const mesh = new THREE.Mesh(geometry, material);
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

/** Every placed object, one InstancedMesh per model part. */
export function placeObjects(library, objects) {
  const byModel = new Map();
  for (const object of objects) {
    if (!library.has(object.model)) continue;
    if (!byModel.has(object.model)) byModel.set(object.model, []);
    byModel.get(object.model).push(object.matrix);
  }
  const group = new THREE.Group();
  group.name = "objects";
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

/** A sky dome around the camera, textured with the level's sky. */
export function createSky(sky, look) {
  if (!sky) return null;
  const map = dataTexture(sky, look, true);
  map.repeat.set(4, 2);
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
