/*
  A drivable truck for the scene: the body, and per tire a pivot that follows its axle's
  articulation and travel, turns with the steering and spins with the wheel.

  Poses come from the simulation in game axes (feet; shared/scene-frame.js). The scene mirrors z,
  which turns a rotation about x or y the other way and leaves one about z as it is.
*/
import * as THREE from "three";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { mtm2Sim } from "../vendor/openphotex/index.js";
import { BAR_HALF_WIDTH_FT, SHOCK_HALF_WIDTH_FT, ribbonCorners, suspensionParts } from "../game/suspension.js";
import { BRAKE_ON, beamShows, blinkOn, lampHeading, lightIntensity } from "../game/truck-lights.js";
import { createModelLibrary, dataTexture } from "./track-scene.js";
import { BEAM_AXIS, BEAM_INTENSITY, beamGeometry, beamMaterial } from "./light-beam.js";

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
  const bodyGroup = meshesOf(library, truck.parts.body);
  root.add(bodyGroup);
  // The body's vertices are copied so that damage can move them (and repair put them back).
  const bodyMeshes = bodyGroup.children.map((mesh) => {
    const original = Float32Array.from(mesh.geometry.getAttribute("position").array);
    mesh.geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(original), 3));
    return { mesh, original };
  });

  const corners = ["tireFR", "tireFL", "tireRR", "tireRL"];
  const tires = hubs.map((hub, index) => {
    const pivot = new THREE.Group();   // at the hub: travel, articulation, steering
    const spin = new THREE.Group();    // the wheel's roll
    spin.add(meshesOf(library, truck.parts[corners[index]] ?? (hub[0] < 0 ? truck.parts.tireLeft : truck.parts.tireRight)));
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin, hub };
  });
  const axles = [0, 2].map(() => {
    const g = meshesOf(library, truck.parts.axle);
    root.add(g);
    return g;
  });

  // The suspension parts between the axles and the body: bars and shocks are ribbons that face the
  // viewer, the driveshafts are a model stretched between the transfer case and each axle (game/suspension.js).
  const suspension = truck.suspension;
  const ribbons = (name, count, half) => {
    const data = truck.textures[name];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("uv", new THREE.BufferAttribute(Float32Array.from({ length: count * 8 }, (_, i) => [0, 0, 1, 0, 1, 1, 0, 1][i % 8]), 2));
    geometry.setIndex(Array.from({ length: count }, (_, q) => [q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3]).flat());
    const material = new THREE.MeshLambertMaterial({ map: data ? dataTexture(data, look) : null, color: data ? 0xffffff : 0x606060, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    root.add(mesh);
    return { mesh, half, count };
  };
  const bars = suspension ? ribbons(suspension.barTexture, 4, BAR_HALF_WIDTH_FT) : null;
  const shocks = suspension ? ribbons(suspension.shockTexture, 8, SHOCK_HALF_WIDTH_FT) : null;
  const shafts = suspension && truck.parts.driveshaft ? [0, 1].map(() => { const g = meshesOf(library, truck.parts.driveshaft); root.add(g); return g; }) : [];
  const eye = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, 1);

  // The lamps (game/truck-lights.js): a glowing lens decal on the body, and for a headlight or beacon a
  // six-sided cone of light that fades along its length. Both add light to what is behind them.
  const lamps = createLamps(truck, look);
  root.add(lamps.group);

  const scratch = new Array(16);
  const m4 = new THREE.Matrix4();
  return {
    object: root,
    /**
     * Crash damage to zone `zone` (1 to 12, the truck's hull points; docs section 10) at damage `level`:
     * the body's vertices near the point are pushed in along the zone's direction. Returns how many moved.
     */
    dent(zone, level, random = Math.random) {
      const point = truck.scrapePoints?.[zone - 1];
      if (!point) return 0;
      const { radiusFt, direction } = mtm2Sim.zoneDent(zone);
      // Body axes to the model's scene frame: z is mirrored.
      const center = [point[0], point[1], -point[2]], push = [direction[0], direction[1], -direction[2]];
      let moved = 0;
      for (const { mesh } of bodyMeshes) {
        const attribute = mesh.geometry.getAttribute("position");
        const count = mtm2Sim.dentVertices(attribute.array, center, push, radiusFt, level, random);
        if (!count) continue;
        moved += count;
        attribute.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
      return moved;
    },
    /** Put every vertex back: the damage is repaired. */
    repair() {
      for (const { mesh, original } of bodyMeshes) {
        const attribute = mesh.geometry.getAttribute("position");
        attribute.array.set(original);
        attribute.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
    },
    /** Where tire `i`'s hub is in the world, game feet `[x, y, z]` (after `update`). */
    tireHub(i) {
      root.updateMatrixWorld();
      tires[i].pivot.getWorldPosition(eye);
      return [eye.x, eye.y, -eye.z];
    },
    /** Where hull point `zone` (1 to 12) is in the world, game feet, or null. */
    hullPoint(zone) {
      const point = truck.scrapePoints?.[zone - 1];
      if (!point) return null;
      root.updateMatrixWorld();
      eye.set(point[0], point[1], -point[2]).applyMatrix4(root.matrixWorld);
      return [eye.x, eye.y, -eye.z];
    },
    /** Hide the truck's body but not its lamps: the player's headlights still shine from inside the cockpit. */
    setBodyHidden(hidden) {
      for (const child of root.children) child.visible = child === lamps.group || !hidden;
    },
    /**
     * Place the truck from a simulation snapshot (see worker/sim-worker.js). `env` says how the lamps
     * are used: `{ lamps, clockMs, night, cockpit }` (game/truck-lights.js).
     */
    update(pose, camera = null, env = {}) {
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
      let viewerLocal = [0, 8, -30];
      if (camera) {
        root.updateMatrixWorld();
        root.worldToLocal(eye.copy(camera.position));
        viewerLocal = [eye.x, eye.y, -eye.z];
      }
      lamps.update({
        lamps: env.lamps ?? 0, night: !!env.night, cockpit: !!env.cockpit,
        braking: (pose.brakeRear ?? 0) > BRAKE_ON, reverse: pose.gear === 2,
      }, env.clockMs ?? 0, viewerLocal);
      if (!suspension) return;
      const parts = suspensionParts({
        axles: [0, 1].map((k) => ({ z: tires[k * 2].hub[2], travel: pose.axles[k].travel, articulation: pose.axles[k].articulation })),
        axlebar: suspension.axlebar, driveshaft: suspension.driveshaft,
      });
      // The viewer in the body's own game axes (the scene's z is mirrored).
      const viewer = viewerLocal;
      for (const { mesh, half, count, list } of [{ ...bars, list: parts.bars }, { ...shocks, list: parts.shocks }]) {
        const array = mesh.geometry.getAttribute("position").array;
        list.forEach(([a, b], q) => {
          ribbonCorners(a, b, half, viewer).forEach((c, k) => array.set([c[0], c[1], -c[2]], (q * 4 + k) * 3));
        });
        mesh.geometry.getAttribute("position").needsUpdate = true;
      }
      parts.shafts.forEach((shaft, k) => {
        const g = shafts[k];
        if (!g) return;
        const mid = [(shaft.from[0] + shaft.to[0]) / 2, (shaft.from[1] + shaft.to[1]) / 2, (shaft.from[2] + shaft.to[2]) / 2];
        g.position.set(mid[0], mid[1], -mid[2]);
        up.set(shaft.to[0] - shaft.from[0], shaft.to[1] - shaft.from[1], -(shaft.to[2] - shaft.from[2])).normalize();
        g.quaternion.setFromUnitVectors(forward, up);
        g.scale.set(1, 1, Math.max(0.01, shaft.length));
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
    heli: a.heli && b.heli ? { ...b.heli, pos: [lerp(a.heli.pos[0], b.heli.pos[0]), lerp(a.heli.pos[1], b.heli.pos[1]), lerp(a.heli.pos[2], b.heli.pos[2])] } : b.heli ?? null,
  };
}

/*
  The lamps, drawn as JSTrackViewer's truck light rig draws them (src/drive/truck-lights.js there, from JSTruckViewer):
  - the lens is a soft camera-facing glow (the lamp's own bitmap, added to the view), fading in as the lamp turns toward the
    camera and pulled a little toward it so the body it sits on does not cut it in half;
  - a beam is an open cone of 24 sides, its fuzz texture repeated around and along it, brightest at the lamp and fading to
    nothing at the rim and toward its edges as seen, so it reads as light in the air rather than a solid cone.
*/
/** A lamp's direction in the body's game axes: heading about the vertical, pitch up from the horizon. */
function lampDirection(heading, pitch, out) {
  return out.set(Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(heading) * Math.cos(pitch));
}

const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function createLamps(truck, look) {
  const group = new THREE.Group();
  group.name = "lamps";
  const textures = new Map();
  const texture = (name, repeat = false) => {
    if (!name || !truck.lightTextures?.[name]) return null;
    const key = `${name}|${repeat}`;
    if (!textures.has(key)) {
      const t = dataTexture(truck.lightTextures[name], look === "classic" ? "enhanced" : look, repeat);
      textures.set(key, t);
    }
    return textures.get(key);
  };
  const items = (truck.lights ?? []).map((light) => {
    let lens = null, beam = null;
    const lensMap = texture(light.source);
    if (lensMap && light.radius > 0) {
      lens = new THREE.Sprite(new THREE.SpriteMaterial({
        map: lensMap, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false,
      }));
      lens.scale.setScalar(light.radius * 2);
      lens.renderOrder = 2;
      lens.visible = false;
      group.add(lens);
    }
    const fuzz = light.coneLength > 0 ? texture(light.coneTexture, true) : null;
    if (fuzz) {
      beam = new THREE.Mesh(beamGeometry(light.coneLength, light.coneBase, light.coneRim), beamMaterial(fuzz, light.coneLength));
      beam.position.set(light.pos[0], light.pos[1], -light.pos[2]);
      beam.renderOrder = 1;
      beam.visible = false;
      beam.frustumCulled = false;
      group.add(beam);
    }
    return { light, lens, beam };
  });
  const dir = new THREE.Vector3(), scene = new THREE.Vector3(), toward = new THREE.Vector3();
  return {
    group,
    /** `viewer` is the camera in the body's game axes. */
    update(state, clockMs, viewer) {
      const seconds = clockMs / 1000;
      for (const { light, lens, beam } of items) {
        const level = blinkOn(light, clockMs) ? lightIntensity(light, state) : 0;
        const heading = lampHeading(light, seconds);
        lampDirection(heading, light.pitch, dir);
        if (lens) {
          lens.visible = level > 0 && !state.cockpit;
          if (lens.visible) {
            toward.set(viewer[0] - light.pos[0], viewer[1] - light.pos[1], viewer[2] - light.pos[2]);
            const distance = toward.length() || 1;
            toward.divideScalar(distance);
            // Full when the lamp faces the camera, gone when it faces away.
            lens.material.opacity = level * smoothstep(-0.2, 0.35, dir.dot(toward));
            const pull = Math.min(light.radius * 0.6, distance * 0.5);
            lens.position.set(light.pos[0] + toward.x * pull, light.pos[1] + toward.y * pull, -(light.pos[2] + toward.z * pull));
          }
        }
        if (beam) {
          beam.visible = beamShows(light, level, state.night);
          if (beam.visible) {
            beam.material.uniforms.intensity.value = BEAM_INTENSITY * level;
            beam.quaternion.setFromUnitVectors(BEAM_AXIS, scene.set(dir.x, dir.y, -dir.z));
          }
        }
      }
    },
  };
}
