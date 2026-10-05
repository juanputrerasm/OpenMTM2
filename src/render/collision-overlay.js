/*
  The collision boxes and ramps drawn over the world (the GOLD key Ctrl+B: solid, wireframe,
  off). Each is the box the simulation collides with: centred on its position, rotated by its
  angles, sized by its model's vertex bounds when it has one, else by the SIT.
*/
import * as THREE from "three";
import { mtm2Sim } from "../vendor/openphotex/index.js";
import { toSceneMatrix } from "../shared/scene-frame.js";

export const OVERLAY_MODES = Object.freeze(["off", "wireframe", "solid"]);

/** A box's full size in feet: its model's bounds, else the SIT's size. */
export function overlaySize(box) {
  const b = box.bounds;
  if (b) return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  return box.sizeFt ?? [0, 0, 0];
}

/** A group with one wireframe and one solid mesh per box; `setMode` shows one of them. */
export function createCollisionOverlay(boxes, ramps) {
  const group = new THREE.Group();
  group.name = "collision-overlay";
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(unit);
  const wire = new THREE.Group(), solid = new THREE.Group();
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffe14d });
  const rampLine = new THREE.LineBasicMaterial({ color: 0x4dd2ff });
  const fill = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.35, depthWrite: false });
  const rampFill = new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.35, depthWrite: false });
  const place = (object, box) => {
    const size = overlaySize(box);
    if (!box.positionFt || size.every((v) => v === 0)) return false;
    const m = mtm2Sim.eulerToMatrix(box.theta ?? 0, box.phi ?? 0, box.psi ?? 0, new Array(9));
    object.matrixAutoUpdate = false;
    object.matrix.fromArray(toSceneMatrix(m, box.positionFt));
    object.matrix.scale(new THREE.Vector3(size[0], size[1], size[2]));
    return true;
  };
  const add = (box, lineMat, fillMat) => {
    const line = new THREE.LineSegments(edges, lineMat), mesh = new THREE.Mesh(unit, fillMat);
    if (place(line, box) && place(mesh, box)) { wire.add(line); solid.add(mesh); }
  };
  for (const box of boxes) add(box, lineMaterial, fill);
  for (const ramp of ramps) add(ramp, rampLine, rampFill);
  group.add(wire, solid);
  let mode = 0;
  const setMode = (next) => {
    mode = next % OVERLAY_MODES.length;
    wire.visible = mode === 1;
    solid.visible = mode === 2;
    group.visible = mode !== 0;
    return OVERLAY_MODES[mode];
  };
  setMode(0);
  return {
    object: group,
    cycle: () => setMode(mode + 1),
    dispose() { unit.dispose(); edges.dispose(); for (const m of [lineMaterial, rampLine, fill, rampFill]) m.dispose(); },
  };
}
