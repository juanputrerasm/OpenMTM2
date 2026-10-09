/*
  Truck previews on small canvases of their own (MONSTER_EXE_ANALYSIS.md, "Truck previews"):
  - "orbit" (Driver Check-in): the camera circles the truck standing in the mini garage (`MODELS\GARAGE.BIN`,
    ART\GARAGE1 to GARAGE4), with the truck's shadow on the floor.
  - "still" (the Winner's Circle's second place): the same garage seen from one fixed place, drawn once.
  - "crown" (first place and the Hall of Fame): the truck on top of the globe with the crown over it
    (`MODELS\WINNER.BIN`), turning slowly, on black.
*/
import * as THREE from "three";
import { createTruckObject } from "./truck-object.js";
import { createModelLibrary, disposeObject } from "./track-scene.js";

/** Radians a second the camera goes round the truck, or the crowned stage turns. */
const ORBIT_RATE = 0.3;
const TURN_RATE = 0.5;
/** The truck stands here in the garage's own (game) axes; the camera circles it inside the room. */
const STAND = [2, 0, 3];
const ORBIT_RADIUS_FT = 20;
const CAMERA_HEIGHT_FT = 11.5;
/** The still shot's camera angle round the truck. */
/** The still shot looks at the truck's side, a little from the front: the truck faces -z, the camera stands on +x. */
const STILL_ANGLE = Math.PI / 2 + 0.4;

/** The tire's radius in feet from its model, for standing the truck on the floor. */
function tireRadius(truck) {
  const b = (truck.parts.tireLeft ?? truck.parts.tireRight)?.bounds;
  return b ? (b.max[1] - b.min[1]) / 2 : 2.5;
}

/**
 * @param {{ width: number, height: number, look: "classic"|"enhanced", mode?: "orbit"|"still"|"crown" }} options canvas size in pixels
 * @returns {{ canvas: HTMLCanvasElement, show(build: object|null): void, dispose(): void }}
 */
export function createTruckPreview({ width, height, look, mode = "orbit" }) {
  const canvas = document.createElement("canvas");
  canvas.className = "truck-preview-canvas";
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(width, height, false);
  const crown = mode === "crown";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(crown ? 0x000000 : 0x101010);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x808080, crown ? 1.6 : 1.8));
  let catcher = null;
  if (crown) {
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(14, 24, 20);
    scene.add(key);
  } else {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The lamp over the truck casts its shadow on the floor, which an invisible plane catches.
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(STAND[0] + 7, 22, -STAND[2] + 5);
    sun.target.position.set(STAND[0], 0, -STAND[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.55 }));
    catcher.position.set(STAND[0], 0.04, -STAND[2]);
    catcher.receiveShadow = true;
    scene.add(catcher);
  }
  const camera = new THREE.PerspectiveCamera(crown ? 38 : 60, width / height, 0.5, 300);

  const stage = new THREE.Group();
  scene.add(stage);
  let truck = null, pose = null, orbit = 0.8, turn = 0.6, request = 0, disposed = false, last = performance.now();

  function clear() {
    for (const child of [...stage.children]) { stage.remove(child); disposeObject(child); }
    truck = null;
  }

  function placeCamera() {
    if (crown) {
      camera.position.set(0, 12, 40);
      camera.lookAt(0, 7.5, 0);
    } else {
      const a = mode === "still" ? STILL_ANGLE : orbit;
      camera.position.set(STAND[0] + Math.sin(a) * ORBIT_RADIUS_FT, CAMERA_HEIGHT_FT, -STAND[2] + Math.cos(a) * ORBIT_RADIUS_FT);
      camera.lookAt(STAND[0], 2.5, -STAND[2]);
    }
  }

  function draw() {
    placeCamera();
    if (crown) stage.rotation.y = turn;
    if (truck && pose) truck.update(pose, camera, {});
    renderer.render(scene, camera);
  }

  function frame(now) {
    if (disposed) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    orbit += dt * ORBIT_RATE;
    turn += dt * TURN_RATE;
    draw();
    requestAnimationFrame(frame);
  }
  if (mode !== "still") requestAnimationFrame(frame);

  return {
    canvas,
    show(build) {
      const mine = ++request;
      clear();
      if (!build || mine !== request) return;
      const library = (model, textures) => createModelLibrary({ [model.name]: model }, textures, look);
      const addModel = (model, textures) => {
        const group = new THREE.Group();
        for (const { geometry, material } of library(model, textures).get(model.name) ?? []) {
          material.side = THREE.DoubleSide;
          group.add(new THREE.Mesh(geometry, material));
        }
        stage.add(group);
        return group;
      };
      if (crown) {
        if (build.winner) addModel(build.winner.model, build.winner.textures);
      } else if (build.garage) addModel(build.garage.model, build.garage.textures);
      if (build.truck) {
        truck = createTruckObject(build.truck, build.truck.anchors, look);
        truck.object.traverse((o) => { if (o.isMesh) o.castShadow = !crown; });
        stage.add(truck.object);
        const [fr, , rr] = build.truck.anchors;
        const frontY = fr?.[1] ?? -4, rearY = rr?.[1] ?? frontY;
        const at = crown ? [0, 0] : [STAND[0], STAND[2]];
        const heading = crown ? 0.5 : mode === "still" ? 0 : 0.6;
        pose = {
          pos: [at[0], tireRadius(build.truck) - frontY, at[1]],
          matrix: [Math.cos(heading), 0, -Math.sin(heading), 0, 1, 0, Math.sin(heading), 0, Math.cos(heading)],
          axles: [{ articulation: 0, travel: frontY }, { articulation: 0, travel: rearY }],
          tires: [0, 1, 2, 3].map(() => ({ angle: 0 })), steer: 0, rearSteer: 0,
        };
      }
      draw();
    },
    dispose() {
      disposed = true;
      request++;
      clear();
      renderer.dispose();
    },
  };
}
