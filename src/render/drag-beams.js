/*
  The drag strip's lines on the ground, as MTM1 draws them in a drag race (game/drag-race.js `dragStripLines`): every
  checkpoint in white, the prestage, stage, start and finish beams across the strip and each lane's centre line and
  outer edge down it. MTM1 draws one-pixel lines; here each is a band 0.4 ft wide laid 0.3 ft over the ground, so it
  holds up at any resolution. Options, Drag beam lines, and the Drag beam lines key.
*/
import * as THREE from "three";
import { dragStripLines } from "../game/drag-race.js";

const WIDTH_FT = 0.4, LIFT_FT = 0.3, PIECE_FT = 2;

/** @returns the lines, or null with none */
export function createDragBeams(checkpoints, heightAt) {
  const lines = dragStripLines(checkpoints);
  if (!lines.length) return null;
  const positions = [], index = [];
  for (const line of lines) {
    const dx = line.b[0] - line.a[0], dz = line.b[1] - line.a[1];
    const pieces = Math.max(1, Math.ceil(Math.hypot(dx, dz) / PIECE_FT));
    const half = [line.across[0] * WIDTH_FT / 2, line.across[1] * WIDTH_FT / 2];
    const first = positions.length / 3;
    for (let k = 0; k <= pieces; k++) {
      const x = line.a[0] + (dx * k) / pieces, z = line.a[1] + (dz * k) / pieces;
      for (const side of [-1, 1]) {
        const px = x + half[0] * side, pz = z + half[1] * side;
        // Game feet to the scene: z is mirrored.
        positions.push(px, heightAt(px, pz) + LIFT_FT, -pz);
      }
      const v = first + k * 2;
      if (k < pieces) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "dragBeams";
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { object: mesh, dispose() { geometry.dispose(); material.dispose(); } };
}
