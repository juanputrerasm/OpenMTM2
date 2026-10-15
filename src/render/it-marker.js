/*
  The It arrow (docs/PLAN.md, "Party modes"): a flat arrow above the It truck, turned to face the
  camera, drawn in the world. It is an ordinary mesh, so a wall or the ground between it and the
  camera hides it. The outline is game/tag.js `IT_ARROW`, tip down, in the marker's own XY plane;
  copying the camera's quaternion puts that plane's +Z toward the camera and its down toward the
  bottom of the picture (a camera's local -Y).
*/
import * as THREE from "three";
import { IT_ARROW, IT_COLOUR } from "../game/tag.js";

/** Feet above the truck's origin where the arrow's centre hangs. */
const ABOVE_FT = 15;

export function createItMarker() {
  const shape = new THREE.Shape();
  shape.moveTo(IT_ARROW[0][0], IT_ARROW[0][1]);
  for (let i = 1; i < IT_ARROW.length; i++) shape.lineTo(IT_ARROW[i][0], IT_ARROW[i][1]);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const face = new THREE.MeshBasicMaterial({
    color: IT_COLOUR,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    fog: false,
    toneMapped: false,
  });
  const edge = new THREE.MeshBasicMaterial({
    color: 0x1a1008,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    fog: false,
    toneMapped: false,
  });
  const arrow = new THREE.Mesh(geometry, face);
  const backing = new THREE.Mesh(geometry, edge);
  // Farther from a camera the marker faces (+Z toward it): a dark rim around the orange.
  backing.position.z = -0.3;
  backing.scale.set(1.14, 1.14, 1);
  const group = new THREE.Group();
  group.name = "itMarker";
  group.add(backing, arrow);
  group.visible = false;
  // A marker, not a thing a pointer can hit.
  arrow.raycast = () => {};
  backing.raycast = () => {};
  return {
    object: group,
    /**
     * `pos` is the It truck in game feet, or null to hide it. `camera` is the one the frame is
     * drawn with. `time` is seconds, for a small bob.
     */
    update(pos, camera, time) {
      if (!pos) { group.visible = false; return; }
      group.visible = true;
      const bob = Math.sin(time * 2.4) * 0.55;
      // Game feet to the scene: z is mirrored, the same as the trucks.
      group.position.set(pos[0], pos[1] + ABOVE_FT + bob, -pos[2]);
      group.quaternion.copy(camera.quaternion);
    },
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      face.dispose();
      edge.dispose();
    },
  };
}
