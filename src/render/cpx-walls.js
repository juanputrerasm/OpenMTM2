/*
  A `.CPX` track's walls on show (Options, Race rule walls; the port's own). Community Patch 4 2.0.52.4 meets its walls
  but its notes do not say it draws them (docs/CP4_ENGINE_UPDATES.md 8.4), so they are hidden unless the option is on.
  Each wall is drawn as the contact test sees it (game/cpx-walls.js `wallGeometry`, from `wallPieces`): every straight piece a see-through
  box, the thickness wide, from its base to its top. Gap stretches are left out.
*/
import * as THREE from "three";
import { wallGeometry } from "../game/cpx-walls.js";

/** The walls' colour: the light red of a penalty. */
export const WALL_COLOR = 0xff5040;
const OPACITY = 0.28;

/** @returns the walls' mesh, or null for a track without walls */
export function createCpxWalls(walls) {
  const { positions, index } = wallGeometry(walls);
  if (!index.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const material = new THREE.MeshBasicMaterial({ color: WALL_COLOR, transparent: true, opacity: OPACITY, side: THREE.DoubleSide, fog: true, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "cpxWalls";
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return { object: mesh, dispose() { geometry.dispose(); material.dispose(); } };
}
