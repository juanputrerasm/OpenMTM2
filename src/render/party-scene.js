/*
  What a party mode adds to the drawn track (docs/PLAN.md, "Party modes"): Hockey's boards round the
  rink, white with a rail along the top, and its two goal frames tinted in the teams' colours. The race
  and its replay both draw them, from the rink the race was played on.
*/
import * as THREE from "three";
import { mtm2Sim } from "../vendor/openphotex/index.js";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { TEAM_COLOURS } from "../game/hockey.js";
import { tintObjects } from "./track-scene.js";

/** The rail along the boards' top, feet. */
const RAIL_FT = 0.6;

/**
 * Dress `world` (in `scene`) for `party` (`{ mode, rink }`; anything else adds nothing). Returns
 * `{ dispose }`.
 */
export function dressParty(scene, world, party) {
  if (party?.mode !== "hockey" || !party.rink) return { dispose() {} };
  const group = new THREE.Group();
  group.name = "rinkBoards";
  const box = new THREE.BoxGeometry(1, 1, 1);
  const boardMaterial = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
  const railMaterial = new THREE.MeshLambertMaterial({ color: 0x1d3f9a });
  const rotation = new Array(9);
  const place = (material, pos, size, psi) => {
    mtm2Sim.eulerToMatrix(0, 0, psi, rotation);
    const mesh = new THREE.Mesh(box, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(toSceneMatrix(rotation, pos)).multiply(new THREE.Matrix4().makeScale(size[0], size[1], size[2]));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (const b of party.rink.boards) {
    const [x, y, z] = b.pos, [w, h, l] = b.size;
    place(boardMaterial, [x, y - RAIL_FT / 2, z], [w, h - RAIL_FT, l], b.psi);
    place(railMaterial, [x, y + h / 2 - RAIL_FT / 2, z], [w + 0.4, RAIL_FT, l], b.psi);
  }
  scene.add(group);
  tintObjects(world, new Map(party.rink.goals.map((g) => [g.sitIndex, TEAM_COLOURS[g.team]])));
  return {
    dispose() {
      scene.remove(group);
      box.dispose();
      boardMaterial.dispose();
      railMaterial.dispose();
    },
  };
}
