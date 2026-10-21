/*
  The recovery helicopter (HELI.BIN) and the pterodactyl (TERYL.BIN, an animated BIN of four wing
  frames, TERYL1 to TERYL4, blended through morph targets like every animated model). One of each
  per truck, hidden until a truck needs it; `update` places them from the trucks' `heli` poses
  (game/heli-flight.js). The game draws them at the heading plus half a turn.

  They are all made with the scene, `count` of each, so that the shaders built ahead of the race
  (render/weather-scene.js `warmPools`) include theirs: made when first needed, the first rescue
  stopped the picture to build the rotors' shaders. A truck past `count` has its own made then.

  HELI.BIN has the airframe only, so the port adds the rotors: a main rotor over the cabin and a tail
  rotor, turning fast, each with a faint disc for the blur.
*/
import * as THREE from "three";
import { keyframeWeights } from "../shared/keyframe-spline.js";
import { createModelLibrary, disposeObject } from "./track-scene.js";

/** A wing frame's time when the control file gives none: the stock TERYL.BIN's, four frames to the second-long flap. */
const DEFAULT_FLAP_FRAME_SECONDS = 0.25;
const MAIN_ROTOR = { pos: [0, 4.9, 0.4], radius: 11, chord: 0.7, rate: 36 };
const TAIL_ROTOR = { pos: [0.55, 2.9, -9.7], radius: 2.2, chord: 0.35, rate: 60 };

function rotor({ radius, chord, rate }, axis) {
  const group = new THREE.Group();
  const blades = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2, 0.06, chord),
    new THREE.MeshBasicMaterial({ color: 0x1c1c1c }));
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x909090, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  group.add(blades, disc);
  const wrap = new THREE.Group();
  wrap.add(group);
  if (axis === "x") wrap.rotation.z = Math.PI / 2;
  return { wrap, spin: group, rate };
}

/**
 * @param {{ heli: object|null, teryl: object|null, textures: object }} build `build.heli` of the track build
 * @param {number} [count] how many trucks there are: a helicopter and a pterodactyl are made for each at once
 */
export function createHelicopters(build, look, scene, count = 0) {
  if (!build) return null;
  const models = Object.fromEntries([build.heli, build.teryl].filter(Boolean).map((m) => [m.name, m]));
  const library = createModelLibrary(models, build.textures, look);
  const make = (model) => {
    const group = new THREE.Group();
    const meshes = [];
    for (const { geometry, material } of library.get(model.name) ?? []) {
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      meshes.push(mesh);
    }
    return { group, meshes };
  };
  const pool = [];
  function slot(i) {
    if (pool[i]) return pool[i];
    const root = new THREE.Group();
    const heli = build.heli ? make(build.heli) : null;
    const teryl = build.teryl ? make(build.teryl) : null;
    const rotors = [];
    if (heli) {
      root.add(heli.group);
      for (const [spec, axis] of [[MAIN_ROTOR, "y"], [TAIL_ROTOR, "x"]]) {
        const r = rotor(spec, axis);
        r.wrap.position.set(spec.pos[0], spec.pos[1], -spec.pos[2]);
        heli.group.add(r.wrap);
        rotors.push(r);
      }
    }
    if (teryl) root.add(teryl.group);
    root.visible = false;
    scene.add(root);
    return (pool[i] = { root, heli, teryl, rotors });
  }
  for (let i = 0; i < count; i++) slot(i);
  let clock = 0;
  return {
    /** `helis[i]` is truck i's `{ pos, heading, teryl }` or null. */
    update(helis, dt) {
      clock += dt;
      helis.forEach((h, i) => {
        const s = slot(i);
        const wings = !!h?.teryl && !!s.teryl;
        s.root.visible = !!h && (wings || !!s.heli);
        if (!h) return;
        s.root.position.set(h.pos[0], h.pos[1], -h.pos[2]);
        s.root.rotation.y = -(h.heading + Math.PI);
        if (s.heli) s.heli.group.visible = !wings;
        if (s.teryl) s.teryl.group.visible = wings;
        if (!wings) {
          for (const r of s.rotors) r.spin.rotation.y = (clock * r.rate) % (Math.PI * 2);
          return;
        }
                const frames = build.teryl.keyframes?.length ?? 0;
        if (frames < 2) return;
        // As every animated model (shared/keyframe-spline.js): TERYL.BIN's own frame time, a quarter of a second.
        const weights = keyframeWeights(clock, frames, build.teryl.frameSeconds || DEFAULT_FLAP_FRAME_SECONDS);
        for (const mesh of s.teryl.meshes) {
          const influences = mesh.morphTargetInfluences;
          if (!influences) continue;
          for (let f = 1; f < frames; f++) influences[f - 1] = weights[f];
        }
      });
    },
    dispose() { for (const { root } of pool) { scene.remove(root); disposeObject(root); } },
  };
}
