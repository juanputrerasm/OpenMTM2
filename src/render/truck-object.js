/*
  A drivable truck for the scene: the body, and per tire a pivot that follows its axle's
  articulation and travel, turns with the steering and spins with the wheel.

  Poses come from the simulation in game axes (feet; shared/scene-frame.js). The scene mirrors z,
  which turns a rotation about x or y the other way and leaves one about z as it is.
*/
import * as THREE from "three";
import { toSceneMatrix, nearestCopy } from "../shared/scene-frame.js";
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";
import { smoothNormals } from "../shared/smooth-normals.js";
import { BAR_HALF_WIDTH_FT, SHOCK_HALF_WIDTH_FT, ribbonCorners, ribbonNormal, suspensionParts } from "../game/suspension.js";
import { EVO_BAR_HALF_FT, EVO_SHOCK_HALF_FT, evoSuspensionParts, stripCorners } from "../game/evo-suspension.js";
import { BRAKE_ON, beamShows, blinkOn, freshKnock, knockLamp, lampHeading, lampLevel, lampTone, lensGlow, lightIntensity, throwsBeam } from "../game/truck-lights.js";
import { createModelLibrary, dataTexture } from "./track-scene.js";
import { BEAM_AXIS, BEAM_INTENSITY, SHAFT_INTENSITY, aimShaft, beamGeometry, beamMaterial, shaftGeometry, shaftMaterial } from "./light-beam.js";
import { GLOSS } from "./gloss.js";
import { classicFogDims, fogDims } from "./atmosphere.js";

function meshesOf(library, model) {
  const group = new THREE.Group();
  for (const { geometry, material } of library.get(model?.name) ?? []) group.add(new THREE.Mesh(geometry, material));
  return group;
}

/**
 * @param {object} truck the asset worker's truck build (worker/truck-build.js)
 * @param {[number, number, number][]} hubs wheel anchors used by the simulation (FR, FL, RR, RL)
 * @param {string} look the look (settings.look)
 * @param {{ richLamps?: boolean }} [options] `richLamps` draws the lamps as the port's own ("Truck lamps", docs/VISUALS.md)
 */
export function createTruckObject(truck, hubs, look, { richLamps = false } = {}) {
  const library = createModelLibrary(
    Object.fromEntries(Object.values(truck.parts).filter(Boolean).map((m) => [m.name, m])), truck.textures, look);
  const root = new THREE.Group();
  root.name = truck.file;
  root.matrixAutoUpdate = false;
  const bodyGroup = meshesOf(library, truck.parts.body);
  // How strongly each part shines with "Glossy paint" (render/gloss.js): the body's paint in full.
  bodyGroup.userData.gloss = GLOSS.body;
  // The body, which "MTM2 Truck reflections" draws again (render/truck-reflection.js).
  bodyGroup.userData.body = true;
  root.add(bodyGroup);
  // The body's vertices are copied so that damage can move them (and repair put them back).
  const bodyMeshes = bodyGroup.children.map((mesh) => {
    const original = Float32Array.from(mesh.geometry.getAttribute("position").array);
    const originalNormals = Float32Array.from(mesh.geometry.getAttribute("normal").array);
    mesh.geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(original), 3));
    mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(originalNormals), 3));
    return { mesh, original, originalNormals };
  });
  // After a dent the body's normals are smoothed again as a whole, as the worker did (shared/smooth-normals.js).
  const smoothBody = () => {
    smoothNormals(bodyMeshes.map(({ mesh }) => ({
      positions: mesh.geometry.getAttribute("position").array, normals: mesh.geometry.getAttribute("normal").array,
    })));
    for (const { mesh } of bodyMeshes) mesh.geometry.getAttribute("normal").needsUpdate = true;
  };

  let standIn = null;
  const corners = ["tireFR", "tireFL", "tireRR", "tireRL"];
  const tires = hubs.map((hub, index) => {
    const pivot = new THREE.Group();   // at the hub: travel, articulation, steering
    const spin = new THREE.Group();    // the wheel's roll
    spin.add(meshesOf(library, truck.parts[corners[index]] ?? (hub[0] < 0 ? truck.parts.tireLeft : truck.parts.tireRight)));
    pivot.add(spin);
    pivot.userData.gloss = GLOSS.tire;
    root.add(pivot);
    return { pivot, spin, hub, wobble: 0 };
  });
  // An Evolution truck's own axle models, front and rear (game/evo-suspension.js), else MTM's one axle model for both.
  const axles = [0, 2].map((_, k) => {
    const g = meshesOf(library, (k === 0 ? truck.parts.axleFront : truck.parts.axleRear) ?? truck.parts.axle);
    g.userData.gloss = GLOSS.gear;
    root.add(g);
    return g;
  });

  // The suspension parts between the axles and the body: bars and shocks are ribbons that face the
  // viewer, the driveshafts are a model stretched between the transfer case and each axle (game/suspension.js).
  const suspension = truck.suspension;
  // 4x4 Evolution 2's bars and shocks: flat strips, not ribbons that face the viewer.
  const evoSuspension = !suspension ? truck.evoSuspension ?? null : null;
  const ribbons = (name, count, half) => {
    const data = truck.textures[name];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 12), 3).setUsage(THREE.DynamicDrawUsage));
    // Lit as the rods they stand for (game/suspension.js `ribbonNormal`). Without a normal the light's sum is not a number,
    // which no fog can veil: the ribbons then stand black under a truck at any distance.
    geometry.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from({ length: count * 12 }, (_, i) => (i % 3 === 1 ? 1 : 0)), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("uv", new THREE.BufferAttribute(Float32Array.from({ length: count * 8 }, (_, i) => [0, 0, 1, 0, 1, 1, 0, 1][i % 8]), 2));
    geometry.setIndex(Array.from({ length: count }, (_, q) => [q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3]).flat());
    const material = new THREE.MeshLambertMaterial({ map: data ? dataTexture(data, look) : null, color: data ? 0xffffff : 0x606060, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    root.add(mesh);
    return { mesh, half, count };
  };
  const bars = suspension ? ribbons(suspension.barTexture, 4, BAR_HALF_WIDTH_FT) : evoSuspension ? ribbons(evoSuspension.barTexture, 4, EVO_BAR_HALF_FT) : null;
  const shocks = suspension ? ribbons(suspension.shockTexture, 8, SHOCK_HALF_WIDTH_FT) : evoSuspension ? ribbons(evoSuspension.shockTexture, 8, EVO_SHOCK_HALF_FT) : null;
  const shafts = suspension && truck.parts.driveshaft ? [0, 1].map(() => { const g = meshesOf(library, truck.parts.driveshaft); root.add(g); return g; }) : [];
  /** Axles a mode has taken off (Combat's wrecks, `setAxle`): front, rear. Their model, bars, shocks and shaft are gone. */
  const axleGone = [false, false];
  const eye = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, 1);
  // `update` moves the root once a frame, and sparks then ask where a dozen hull points are. Each ask used to
  // walk the whole truck. The walk is skipped while this frame's pose is the one already in the world matrices.
  let worldStamp = 0, worldReady = -1;
  const ensureWorld = () => {
    if (worldReady === worldStamp && !root.matrixWorldNeedsUpdate) return;
    root.updateMatrixWorld();
    worldReady = worldStamp;
  };

  // The lamps (game/truck-lights.js): a glowing lens decal on the body, and for a headlight or beacon a
  // six-sided cone of light that fades along its length. Both add light to what is behind them.
  const lamps = createLamps(truck, look, richLamps);
  root.add(lamps.group);

  /*
    The body as it stands now, dents and all, for whoever needs a place on it: the lamps, which a dent carries with
    the panel they sit on, and sparks, which fly from where the body is and not from where the simulation's hull
    points say a box round it would be. Places are in the body's own frame as the scene has it (z mirrored).
  */
  const _local = new THREE.Vector3();
  /** The body vertex nearest a place: `{ part, vertex, away }`, searched in the body as built (`original`) or as it is. */
  function nearestVertex(x, y, z, original = false) {
    let best = null, least = Infinity;
    bodyMeshes.forEach((part, index) => {
      const array = original ? part.original : part.mesh.geometry.getAttribute("position").array;
      for (let v = 0; v < array.length; v += 3) {
        const d = (array[v] - x) ** 2 + (array[v + 1] - y) ** 2 + (array[v + 2] - z) ** 2;
        if (d < least) { least = d; best = { part: index, vertex: v }; }
      }
    });
    return best && { ...best, away: Math.sqrt(least) };
  }
  /** How far a dent has moved the body where a place on it was, as built: `[dx, dy, dz]`. Nothing for a place off the body. */
  function shiftAt(x, y, z) {
    const near = nearestVertex(x, y, z, true);
    if (!near || near.away > LAMP_REACH_FT) return [0, 0, 0];
    const { original, mesh } = bodyMeshes[near.part], now = mesh.geometry.getAttribute("position").array;
    return [now[near.vertex] - original[near.vertex], now[near.vertex + 1] - original[near.vertex + 1], now[near.vertex + 2] - original[near.vertex + 2]];
  }
  /** Each hull point's place on the body as it is, found when first asked for and again after the body changes. */
  const hullOnBody = new Map();
  const bodyChanged = () => { hullOnBody.clear(); lamps.fit?.(shiftAt); };

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
        mesh.geometry.computeBoundingSphere();
      }
      if (moved) { smoothBody(); bodyChanged(); }
      // The same damage call knocks the lamps near the zone's point askew (11b), whatever was dented.
      lamps.knock?.(point, direction, random);
      return moved;
    },
    /** Put every vertex back: the damage is repaired. */
    repair() {
      for (const { mesh, original, originalNormals } of bodyMeshes) {
        const attribute = mesh.geometry.getAttribute("position");
        attribute.array.set(original);
        attribute.needsUpdate = true;
        const normal = mesh.geometry.getAttribute("normal");
        normal.array.set(originalNormals);
        normal.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
      }
      lamps.unknock?.();
      bodyChanged();
    },
    /**
     * A mode's say over tire `i` (Combat's): `hidden` takes the wheel off (the hub and its parts stay), `wobble` (0 to 1)
     * makes it wobble on its hub as it turns.
     */
    setTire(i, { hidden = false, wobble = 0 } = {}) {
      const t = tires[i];
      if (!t) return;
      t.pivot.visible = !hidden;
      t.wobble = Math.max(0, Math.min(1, wobble));
    },
    /** A mode's say over axle `k` (0 front, 1 rear; Combat's wrecks): `hidden` takes it off, its bars, shocks and shaft too. */
    setAxle(k, { hidden = false } = {}) {
      if (k !== 0 && k !== 1) return;
      axleGone[k] = !!hidden;
      axles[k].visible = !hidden;
      if (shafts[k]) shafts[k].visible = !hidden;
    },
    /** A copy of tire `i`'s wheel to draw on its own (it shares the truck's geometry and materials), or null. */
    tireModel(i) {
      const t = tires[i];
      return t ? t.spin.clone(true) : null;
    },
    /** Where tire `i`'s hub is in the world, game feet `[x, y, z]` (after `update`). */
    tireHub(i) {
      ensureWorld();
      tires[i].pivot.getWorldPosition(eye);
      return [eye.x, eye.y, -eye.z];
    },
    /**
     * Where hull point `zone` (1 to 12) is in the world, game feet, or null. The simulation's hull points are the
     * corners of a box round the truck; with `onBody` the place is the body's own nearest point to that corner, as the
     * body is now, dents and all: where something that strikes that corner is seen to strike.
     */
    hullPoint(zone, onBody = false) {
      const point = truck.scrapePoints?.[zone - 1];
      if (!point) return null;
      ensureWorld();
      eye.set(point[0], point[1], -point[2]);
      if (onBody) {
        if (!hullOnBody.has(zone)) {
          const near = nearestVertex(eye.x, eye.y, eye.z);
          const array = near && bodyMeshes[near.part].mesh.geometry.getAttribute("position").array;
          hullOnBody.set(zone, near ? [array[near.vertex], array[near.vertex + 1], array[near.vertex + 2]] : [eye.x, eye.y, eye.z]);
        }
        eye.fromArray(hullOnBody.get(zone));
      }
      eye.applyMatrix4(root.matrixWorld);
      return [eye.x, eye.y, -eye.z];
    },
    /** The point of the body, as it is now, nearest a place in the world (game feet), as a place in the world; null without a body. */
    nearestBodyPoint(x, y, z) {
      ensureWorld();
      root.worldToLocal(_local.set(x, y, -z));
      const near = nearestVertex(_local.x, _local.y, _local.z);
      if (!near) return null;
      const array = bodyMeshes[near.part].mesh.geometry.getAttribute("position").array;
      _local.set(array[near.vertex], array[near.vertex + 1], array[near.vertex + 2]).applyMatrix4(root.matrixWorld);
      return [_local.x, _local.y, -_local.z];
    },
    /** Hide the truck's body but not its lamps: the player's headlights still shine from inside the cockpit. */
    setBodyHidden(hidden) {
      for (const child of root.children) child.visible = child === lamps.group || !hidden;
      // A body drawn in the truck's place (the TREX code) stands in for the truck's own.
      if (standIn) { bodyGroup.visible = false; standIn.visible = !hidden; }
    },
    /** Draw `object` (in the truck's frame) in place of the body, or with null the body again. */
    setStandIn(object) {
      if (standIn) root.remove(standIn);
      standIn = object ?? null;
      if (standIn) root.add(standIn);
      bodyGroup.visible = !standIn;
    },
    /**
     * Place the truck from a simulation snapshot (see worker/sim-worker.js). `env` says how the lamps
     * are used: `{ lamps, clockMs, night, cockpit }` (game/truck-lights.js), and for the port's own
     * lamps `air` (how much there is in the air to show a beam, 0 to 1) and `daylight` (the
     * weather's brightness).
     */
    update(pose, camera = null, env = {}) {
      worldStamp++;
      m4.fromArray(toSceneMatrix(pose.matrix, pose.pos, scratch));
      root.matrix.copy(m4);
      root.matrixWorldNeedsUpdate = true;
      tires.forEach((t, i) => {
        const axle = pose.axles[i < 2 ? 0 : 1];
        const a = axle.articulation;
        const [ax, , az] = t.hub;
        // A wheel drawn bigger or smaller than the simulation's tire stands higher or lower by the difference (a CPR car's
        // front wheels: worker/foreign-truck-build.js `cprWheelPlaces`).
        t.pivot.position.set(ax * Math.cos(a), ax * Math.sin(a) + axle.travel + (truck.tireLift?.[i] ?? 0), -az);
        const steer = i < 2 ? pose.steer : pose.rearSteer;
        // A damaged wheel (a mode's, Combat's `setTire`) wobbles on its hub as it turns.
        const spin = pose.tires[i].angle, wob = t.wobble;
        t.pivot.rotation.set(0, -steer + wob * 0.07 * Math.sin(spin), a + wob * 0.09 * Math.sin(spin + 1.3), "ZYX");
        t.spin.rotation.x = -pose.tires[i].angle;
      });
      axles.forEach((g, k) => {
        const axle = pose.axles[k];
        g.position.set(0, axle.travel, -tires[k * 2].hub[2]);
        g.rotation.set(0, 0, axle.articulation);
      });
      let viewerLocal = [0, 8, -30];
      if (camera) {
        ensureWorld();
        root.worldToLocal(eye.copy(camera.position));
        viewerLocal = [eye.x, eye.y, -eye.z];
      }
      lamps.update({
        lamps: env.lamps ?? 0, night: !!env.night, cockpit: !!env.cockpit,
        braking: (pose.brakeRear ?? 0) > BRAKE_ON, reverse: pose.gear === 2,
        air: env.air ?? (env.night ? 1 : 0), daylight: env.daylight ?? (env.night ? 0.25 : 1),
      }, env.clockMs ?? 0, viewerLocal, camera?.position ?? null);
      if (!suspension && !evoSuspension) return;
      const axleNow = [0, 1].map((k) => ({ z: tires[k * 2].hub[2], travel: pose.axles[k].travel, articulation: pose.axles[k].articulation }));
      const parts = suspension
        ? suspensionParts({ axles: axleNow, axlebar: suspension.axlebar, driveshaft: suspension.driveshaft })
        : { ...evoSuspensionParts({ axles: axleNow, ...evoSuspension }), shafts: [] };
      // The viewer in the body's own game axes (the scene's z is mirrored).
      const viewer = viewerLocal;
      for (const { mesh, half, list, plane } of [{ ...bars, list: parts.bars, plane: "xy" }, { ...shocks, list: parts.shocks, plane: "xz" }]) {
        const array = mesh.geometry.getAttribute("position").array, normals = mesh.geometry.getAttribute("normal").array;
        list.forEach(([a, b], q) => {
          // The parts come axle by axle, front first: a lost axle's are folded to nothing.
          if (axleGone[q < list.length / 2 ? 0 : 1]) { array.fill(0, q * 12, q * 12 + 12); return; }
          (suspension ? ribbonCorners(a, b, half, viewer) : stripCorners(a, b, half, plane)).forEach((c, k) => array.set([c[0], c[1], -c[2]], (q * 4 + k) * 3));
          const n = ribbonNormal(a, b, viewer);
          for (let k = 0; k < 4; k++) normals.set([n[0], n[1], -n[2]], (q * 4 + k) * 3);
        });
        mesh.geometry.getAttribute("position").needsUpdate = true;
        mesh.geometry.getAttribute("normal").needsUpdate = true;
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

const ORIGIN = [0, 0, 0];
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _ma = new THREE.Matrix4(), _mb = new THREE.Matrix4();
const _sa = new Array(16), _sb = new Array(16);

/** Blend two snapshots for drawing: positions linearly, orientations by quaternion. */
export function interpolatePose(a, b, alpha) {
  const t = Math.min(1, Math.max(0, alpha));
  // Every truck, every frame: the working matrices and turns are kept (the pose made is new, as callers may keep it).
  _qa.setFromRotationMatrix(_ma.fromArray(toSceneMatrix(a.matrix, ORIGIN, _sa)));
  _qb.setFromRotationMatrix(_mb.fromArray(toSceneMatrix(b.matrix, ORIGIN, _sb)));
  // Back to a game-frame row-major matrix: scene R = S M S, so M = S R S.
  const e = _ma.makeRotationFromQuaternion(_qa.slerp(_qb, t)).elements; // column-major scene rotation
  const matrix = [e[0], e[4], -e[8], e[1], e[5], -e[9], -e[2], -e[6], e[10]];
  const lerp = (x, y) => x + (y - x) * t;
  // A truck that was wrapped across the world between the two (a replay's frames either side of the seam) is blended
  // from the copy of where it was that is beside where it is.
  const from = nearestCopy(a.pos, b.pos);
  return {
    ...b,
    pos: [lerp(from[0], b.pos[0]), lerp(from[1], b.pos[1]), lerp(from[2], b.pos[2])],
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

/** A dent carries a lamp with it when the lamp sits within this of the body, feet. */
const LAMP_REACH_FT = 2;

/** A lamp's lens as the port draws it: a small hot middle in a wide soft glow. One picture for every lamp, tinted by each. */
let lensPicture = null;
export function lensTexture() {
  if (lensPicture) return lensPicture;
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const v = Math.round(255 * Math.min(1, Math.exp(-((r / 0.17) ** 2)) + 0.3 * Math.max(0, 1 - r) ** 2.5));
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  }
  lensPicture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  lensPicture.magFilter = lensPicture.minFilter = THREE.LinearFilter;
  lensPicture.needsUpdate = true;
  return lensPicture;
}

/** The colour a lamp's own art glows in, linear: the mean of its lit texels, for a lamp the port has no colour of its own for. */
function artTone(image) {
  if (!image?.rgba) return [1, 1, 1];
  const toLinear = (byte) => (byte / 255) ** 2.2;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < image.rgba.length; i += 4) {
    if (Math.max(image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]) < 60) continue;
    r += toLinear(image.rgba[i]); g += toLinear(image.rgba[i + 1]); b += toLinear(image.rgba[i + 2]); n++;
  }
  const most = Math.max(r, g, b) || 1;
  return n ? [r / most, g / most, b / most] : [1, 1, 1];
}

/*
  The lamps as the port draws them ("Truck lamps", docs/VISUALS.md; game/truck-lights.js has the rules): a lens that
  glows in the lamp's own bitmap, as large as the TRK makes it, far brighter than white, so the lens flares it (a soft
  round glow only for a lamp without a bitmap); a headlight's beam as light in the air
  (render/light-beam.js), seen by what the weather puts in the air; tail lamps that run dim and brake bright; and lamps
  that a dent carries with the panel they sit on.
*/
function createRichLamps(truck) {
  const group = new THREE.Group();
  group.name = "lamps";
  const bitmaps = new Map();
  const bitmap = (name) => {
    if (!name || !truck.lightTextures?.[name]) return null;
    if (!bitmaps.has(name)) bitmaps.set(name, dataTexture(truck.lightTextures[name], "enhanced", false));
    return bitmaps.get(name);
  };
  const items = (truck.lights ?? []).map((light) => {
    const tone = lampTone(light) ?? artTone(truck.lightTextures?.[light.source]);
    // The lens glows in the lamp's own picture and colours; the port's tone is for a lamp without one.
    const own = bitmap(light.source);
    let lens = null, beam = null;
    if (light.radius > 0) {
      lens = new THREE.Sprite(fogDims(new THREE.SpriteMaterial({ map: own ?? lensTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })));
      lens.scale.setScalar(light.radius * (own ? 2 : 2.6));
      lens.renderOrder = 2;
      lens.visible = false;
      group.add(lens);
    }
    if (throwsBeam(light)) {
      beam = new THREE.Mesh(shaftGeometry(light.coneLength, light.coneBase, light.coneRim), shaftMaterial(light.coneLength, light.coneBase, light.coneRim, tone));
      beam.renderOrder = 1;
      beam.visible = false;
      beam.frustumCulled = false;
      group.add(beam);
    }
    // Where the lamp is now, body axes: where the TRK has it, until a dent moves the panel it sits on.
    return { light, lens, beam, tone, lensTone: own ? [1, 1, 1] : tone, at: [...light.pos], knock: freshKnock() };
  });
  const dir = new THREE.Vector3(), scene = new THREE.Vector3(), toward = new THREE.Vector3();
  return {
    group,
    /** The body changed: `shiftAt(x, y, z)` says how far it has moved where a place on it was (the scene's local frame). */
    fit(shiftAt) {
      for (const item of items) {
        const [dx, dy, dz] = shiftAt(item.light.pos[0], item.light.pos[1], -item.light.pos[2]);
        const k = item.knock.pos;
        item.at = [item.light.pos[0] + dx + k[0], item.light.pos[1] + dy + k[1], item.light.pos[2] - dz + k[2]];
      }
    },
    /** A damage call at zone point `point` (body axes): the lamps near it are knocked askew (game/truck-lights.js). */
    knock(point, direction, random) {
      for (const item of items) {
        const before = [...item.knock.pos];
        if (!knockLamp(item.knock, item.light, point, direction, random)) continue;
        for (let k = 0; k < 3; k++) item.at[k] += item.knock.pos[k] - before[k];
      }
    },
    unknock() { for (const item of items) item.knock = freshKnock(); },
    /** `viewer` is the camera in the body's game axes, `eyeWorld` in the scene's. */
    update(state, clockMs, viewer, eyeWorld) {
      const seconds = clockMs / 1000;
      for (const { light, lens, beam, tone, lensTone, at, knock } of items) {
        const level = blinkOn(light, clockMs) ? lampLevel(light, state) : 0;
        lampDirection(lampHeading(light, seconds) + knock.heading, light.pitch + knock.pitch, dir);
        if (lens) {
          toward.set(viewer[0] - at[0], viewer[1] - at[1], viewer[2] - at[2]);
          const distance = toward.length() || 1;
          toward.divideScalar(distance);
          // Full when the lamp faces the eye, gone when it faces away.
          const glow = lensGlow(light, level, state.daylight) * smoothstep(-0.15, 0.4, dir.dot(toward));
          lens.visible = glow > 0.01 && !state.cockpit;
          if (lens.visible) {
            lens.material.color.setRGB(lensTone[0] * glow, lensTone[1] * glow, lensTone[2] * glow);
            const pull = Math.min(light.radius * 0.5, distance * 0.5);
            lens.position.set(at[0] + toward.x * pull, at[1] + toward.y * pull, -(at[2] + toward.z * pull));
          }
        }
        if (beam) {
          beam.visible = level > 0 && state.air > 0.01;
          if (beam.visible) {
            beam.position.set(at[0], at[1], -at[2]);
            beam.quaternion.setFromUnitVectors(BEAM_AXIS, scene.set(dir.x, dir.y, -dir.z));
            beam.material.uniforms.intensity.value = SHAFT_INTENSITY * level * state.air;
            if (eyeWorld) aimShaft(beam, eyeWorld);
          }
        }
      }
    },
  };
}

function createLamps(truck, look, rich = false) {
  if (rich) return createRichLamps(truck);
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
      // A lens's glow is light added to the view: with "Volumetric weather" fog dims it (render/atmosphere.js `classicFogDims`).
      lens = new THREE.Sprite(classicFogDims(new THREE.SpriteMaterial({
        map: lensMap, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false,
      })));
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
    return { light, lens, beam, knock: freshKnock() };
  });
  const dir = new THREE.Vector3(), scene = new THREE.Vector3(), toward = new THREE.Vector3();
  return {
    group,
    /** A damage call at zone point `point` (body axes): the lamps near it are knocked askew (game/truck-lights.js). */
    knock(point, direction, random) {
      for (const item of items) {
        if (!knockLamp(item.knock, item.light, point, direction, random) || !item.beam) continue;
        item.beam.position.set(item.light.pos[0] + item.knock.pos[0], item.light.pos[1] + item.knock.pos[1], -(item.light.pos[2] + item.knock.pos[2]));
      }
    },
    unknock() {
      for (const item of items) {
        item.knock = freshKnock();
        item.beam?.position.set(item.light.pos[0], item.light.pos[1], -item.light.pos[2]);
      }
    },
    /** `viewer` is the camera in the body's game axes. */
    update(state, clockMs, viewer) {
      const seconds = clockMs / 1000;
      for (const { light, lens, beam, knock } of items) {
        const level = blinkOn(light, clockMs) ? lightIntensity(light, state) : 0;
        const heading = lampHeading(light, seconds) + knock.heading;
        lampDirection(heading, light.pitch + knock.pitch, dir);
        const p = [light.pos[0] + knock.pos[0], light.pos[1] + knock.pos[1], light.pos[2] + knock.pos[2]];
        if (lens) {
          lens.visible = level > 0 && !state.cockpit;
          if (lens.visible) {
            toward.set(viewer[0] - p[0], viewer[1] - p[1], viewer[2] - p[2]);
            const distance = toward.length() || 1;
            toward.divideScalar(distance);
            // Full when the lamp faces the camera, gone when it faces away.
            lens.material.opacity = level * smoothstep(-0.2, 0.35, dir.dot(toward));
            const pull = Math.min(light.radius * 0.6, distance * 0.5);
            lens.position.set(p[0] + toward.x * pull, p[1] + toward.y * pull, -(p[2] + toward.z * pull));
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
