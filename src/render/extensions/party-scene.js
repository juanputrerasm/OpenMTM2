/*
  What an extension adds to the drawn track (docs/EXTENSIONS.md): Hockey's boards round the
  rink, white with a rail along the top, and its two goal frames tinted in the teams' colours; Soccer's
  goal posts in the teams' colours and the walls that keep the ball on the pitch, drawn as faint glass.
  The race and its replay both draw them, from the rink or pitch the race was played on.
*/
import * as THREE from "three";
import * as mtm2Sim from "../../vendor/openphotex/sim/mtm2/index.js";
import { toSceneMatrix } from "../../shared/scene-frame.js";
import { TEAM_COLOURS } from "../../game/extensions/teams.js";
import { tintObjects } from "../track-scene.js";

/** The rail along the boards' top, feet. */
const RAIL_FT = 0.6;

/**
 * Dress `world` (in `scene`) for `extension` (`{ mode, rink }`; anything else adds nothing). Returns
 * `{ dispose }`.
 */
export function dressExtension(scene, world, extension) {
  if ((extension?.mode !== "hockey" && extension?.mode !== "soccer") || !extension.rink) return { dispose() {} };
  const group = new THREE.Group();
  group.name = "rinkBoards";
  const box = new THREE.BoxGeometry(1, 1, 1);
  const boardMaterial = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
  const railMaterial = new THREE.MeshLambertMaterial({ color: 0x1d3f9a });
  const glassMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const rotation = new Array(9);
  const place = (material, pos, size, psi, shadows = true) => {
    mtm2Sim.eulerToMatrix(0, 0, psi, rotation);
    const mesh = new THREE.Mesh(box, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(toSceneMatrix(rotation, pos)).multiply(new THREE.Matrix4().makeScale(size[0], size[1], size[2]));
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  };
  for (const b of extension.rink.boards) {
    const [x, y, z] = b.pos, [w, h, l] = b.size;
    place(boardMaterial, [x, y - RAIL_FT / 2, z], [w, h - RAIL_FT, l], b.psi);
    place(railMaterial, [x, y + h / 2 - RAIL_FT / 2, z], [w + 0.4, RAIL_FT, l], b.psi);
  }
  for (const w of extension.rink.ballWalls ?? []) place(glassMaterial, w.pos, w.size, w.psi, false);
  scene.add(group);
  tintObjects(world, new Map(extension.rink.goals.flatMap((g) => (g.tint ?? [g.sitIndex]).map((sitIndex) => [sitIndex, TEAM_COLOURS[g.team]]))));
  return {
    dispose() {
      scene.remove(group);
      box.dispose();
      boardMaterial.dispose();
      railMaterial.dispose();
      glassMaterial.dispose();
    },
  };
}
