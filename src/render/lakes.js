/*
  Community Patch 4's lakes (docs/CP4_EXE_ANALYSIS.md 2; docs/VISUALS.md, "Lakes"): each lake a flat
  sheet at its own surface over its tiles (worker/cp4-world.js `buildLakeSheets`), drawn as the
  track's water is. Unlike the track's water a lake does not bob: the meshes are named "lake", not
  "water", so the screens' bob (which moves every "water" plane) leaves them where they are, and
  the water's look takes them by that name (render/water-surface.js `createWaterSystem`, or the
  game's animated surface, render/water-effects.js `createWaterSurface`).
*/
import * as THREE from "three";

/** Every lake sheet in a world (each copy of the world has its own). */
export function lakeMeshes(world) {
  const out = [];
  world?.traverse((object) => { if (object.name === "lake") out.push(object); });
  return out;
}

/** The lakes of a build (`build.lakes`) as a group of sheets, or null for a track without any. */
export function createLakes(lakes) {
  const bodies = (lakes?.bodies ?? []).filter((body) => body.sheet);
  if (!bodies.length) return null;
  const group = new THREE.Group();
  group.name = "lakes";
  // As the track's plain water (render/track-scene.js `createWater`), until a water look takes it over.
  const material = new THREE.MeshLambertMaterial({ color: 0x2b5f7a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  for (const body of bodies) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(body.sheet.positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(body.sheet.uvs, 2));
    const normals = new Float32Array(body.sheet.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(body.sheet.indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "lake";
    mesh.userData.levelFt = body.levelFt;
    mesh.userData.lakeId = body.id;
    mesh.userData.reflective = body.reflective !== false;
    group.add(mesh);
  }
  return group;
}
