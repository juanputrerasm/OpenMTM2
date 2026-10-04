/*
  A drivable truck for the scene: the body, and per tire a pivot that follows its axle's
  articulation and travel, turns with the steering and spins with the wheel.

  Poses come from the simulation in game axes (feet; shared/scene-frame.js). The scene mirrors z,
  which turns a rotation about x or y the other way and leaves one about z as it is.
*/
import * as THREE from "three";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { createModelLibrary } from "./track-scene.js";

function meshesOf(library, model) {
  const group = new THREE.Group();
  for (const { geometry, material } of library.get(model?.name) ?? []) group.add(new THREE.Mesh(geometry, material));
  return group;
}

/**
 * @param {object} truck the asset worker's truck build (worker/truck-build.js)
 * @param {[number, number, number][]} hubs wheel anchors used by the simulation (FR, FL, RR, RL)
 */
export function createTruckObject(truck, hubs, look) {
  const library = createModelLibrary(
    Object.fromEntries(Object.values(truck.parts).filter(Boolean).map((m) => [m.name, m])), truck.textures, look);
  const root = new THREE.Group();
  root.name = truck.file;
  root.matrixAutoUpdate = false;
  root.add(meshesOf(library, truck.parts.body));

  const tires = hubs.map((hub) => {
    const pivot = new THREE.Group();   // at the hub: travel, articulation, steering
    const spin = new THREE.Group();    // the wheel's roll
    spin.add(meshesOf(library, hub[0] < 0 ? truck.parts.tireLeft : truck.parts.tireRight));
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin, hub };
  });
  const axles = [0, 2].map(() => {
    const g = meshesOf(library, truck.parts.axle);
    root.add(g);
    return g;
  });

  const scratch = new Array(16);
  const m4 = new THREE.Matrix4();
  return {
    object: root,
    /** Place the truck from a simulation snapshot (see worker/sim-worker.js). */
    update(pose) {
      m4.fromArray(toSceneMatrix(pose.matrix, pose.pos, scratch));
      root.matrix.copy(m4);
      root.matrixWorldNeedsUpdate = true;
      tires.forEach((t, i) => {
        const axle = pose.axles[i < 2 ? 0 : 1];
        const a = axle.articulation;
        const [ax, , az] = t.hub;
        t.pivot.position.set(ax * Math.cos(a), ax * Math.sin(a) + axle.travel, -az);
        const steer = i < 2 ? pose.steer : pose.rearSteer;
        t.pivot.rotation.set(0, -steer, a, "ZYX");
        t.spin.rotation.x = -pose.tires[i].angle;
      });
      axles.forEach((g, k) => {
        const axle = pose.axles[k];
        g.position.set(0, axle.travel, -tires[k * 2].hub[2]);
        g.rotation.set(0, 0, axle.articulation);
      });
    },
  };
}

/** Blend two snapshots for drawing: positions linearly, orientations by quaternion. */
export function interpolatePose(a, b, alpha) {
  const t = Math.min(1, Math.max(0, alpha));
  const qa = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(toSceneMatrix(a.matrix, [0, 0, 0])));
  const qb = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(toSceneMatrix(b.matrix, [0, 0, 0])));
  const q = qa.slerp(qb, t);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  // Back to a game-frame row-major matrix: scene R = S M S, so M = S R S.
  const e = m.elements; // column-major scene rotation
  const r = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
  const matrix = [r[0], r[1], -r[2], r[3], r[4], -r[5], -r[6], -r[7], r[8]];
  const lerp = (x, y) => x + (y - x) * t;
  return {
    ...b,
    pos: [lerp(a.pos[0], b.pos[0]), lerp(a.pos[1], b.pos[1]), lerp(a.pos[2], b.pos[2])],
    matrix,
    axles: b.axles.map((ax, i) => ({
      articulation: lerp(a.axles[i].articulation, ax.articulation), travel: lerp(a.axles[i].travel, ax.travel),
    })),
    steer: lerp(a.steer, b.steer),
    rearSteer: lerp(a.rearSteer, b.rearSteer),
  };
}
