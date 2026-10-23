/*
  An extension's arrow over one truck (docs/EXTENSIONS.md): Tag's It, Cops and Robbers' robber. A flat
  arrow above the truck, turned to face the camera, drawn in the world over everything else so it can be
  found from anywhere on the track. Far away it keeps a least size on the screen, and past the camera's
  far plane it is drawn along the same line of sight just inside it. The outline is
  game/extensions/tag.js `IT_ARROW`, tip down, in the marker's own XY plane; copying the camera's
  quaternion puts that plane's +Z toward the camera and its down toward the bottom of the picture (a
  camera's local -Y).
*/
import * as THREE from "three";
import { IT_ARROW, IT_COLOUR } from "../../game/extensions/tag.js";

/** Feet above the truck's origin where the arrow's centre hangs. */
const ABOVE_FT = 15;
/** The arrow's height in feet, and the least share of the picture's height it keeps far away. */
const ARROW_FT = 6.45;
const MIN_SCREEN = 0.035;
/** Past this share of the far plane the arrow is drawn nearer, on the same line of sight. */
const FAR_SHARE = 0.9;

export function createItMarker(color = IT_COLOUR) {
  const shape = new THREE.Shape();
  shape.moveTo(IT_ARROW[0][0], IT_ARROW[0][1]);
  for (let i = 1; i < IT_ARROW.length; i++) shape.lineTo(IT_ARROW[i][0], IT_ARROW[i][1]);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const material = (c) => new THREE.MeshBasicMaterial({
    color: c,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    fog: false,
    toneMapped: false,
  });
  const face = material(color);
  const edge = material(0x1a1008);
  const arrow = new THREE.Mesh(geometry, face);
  const backing = new THREE.Mesh(geometry, edge);
  // Drawn after the world, the dark rim first and the colour over it.
  backing.renderOrder = 998;
  arrow.renderOrder = 999;
  backing.position.z = -0.01;
  backing.scale.set(1.14, 1.14, 1);
  const group = new THREE.Group();
  group.name = "itMarker";
  group.add(backing, arrow);
  group.visible = false;
  group.frustumCulled = false;
  arrow.frustumCulled = false;
  backing.frustumCulled = false;
  // A marker, not a thing a pointer can hit.
  arrow.raycast = () => {};
  backing.raycast = () => {};
  const at = new THREE.Vector3();
  return {
    object: group,
    /**
     * `pos` is the marked truck in game feet, or null to hide it. `camera` is the one the frame is
     * drawn with. `time` is seconds, for a small bob.
     */
    update(pos, camera, time) {
      if (!pos) { group.visible = false; return; }
      group.visible = true;
      const bob = Math.sin(time * 2.4) * 0.55;
      // Game feet to the scene: z is mirrored, the same as the trucks.
      at.set(pos[0], pos[1] + ABOVE_FT + bob, -pos[2]);
      let distance = at.distanceTo(camera.position);
      let scale = 1;
      const limit = (camera.far ?? Infinity) * FAR_SHARE;
      if (distance > limit && distance > 0) {
        // Beyond the far plane: the same direction, nearer, and as big on the screen as it would be there.
        at.sub(camera.position).multiplyScalar(limit / distance).add(camera.position);
        scale = limit / distance;
        distance = limit;
      }
      group.position.copy(at);
      const tanHalf = Math.tan(THREE.MathUtils.degToRad((camera.fov ?? 60) / 2));
      const least = (MIN_SCREEN * 2 * distance * tanHalf) / ARROW_FT;
      group.scale.setScalar(Math.max(scale, least));
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
