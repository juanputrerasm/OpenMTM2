/*
  Developer screen: drive one truck on a track (milestone M4). The simulation runs in its own
  worker at a fixed 1/60 s; this screen sends the keys each frame and draws between the last two
  simulated states. Arrows or WASD drive, Q / Z shift, C switches the camera, R restarts.
*/
import * as THREE from "three";
import { el } from "../dom.js";
import { WorkerClient } from "../../shared/worker-client.js";
import { createKeyboardInput } from "../../game/input/keyboard.js";
import { createGamepadInput } from "../../game/input/gamepad.js";
import { createTrackWorld, disposeObject, skyColor } from "../../render/track-scene.js";
import { createTruckObject, interpolatePose } from "../../render/truck-object.js";
import { toSceneMatrix } from "../../shared/scene-frame.js";

const GEAR_NAMES = { 1: "P", 2: "R", 3: "N", 4: "1", 5: "2", 6: "3" };
// Chase cameras: distance behind and height above the truck, feet.
const CAMERAS = [{ name: "Chase near", back: 30, up: 11 }, { name: "Chase far", back: 55, up: 20 }];

export default async function mount(container, context, { track, truckFile }) {
  const status = el("p", { class: "dev-status" }, `Loading ${track.name}…`);
  const hud = el("p", { class: "dev-hud" });
  const canvas = el("canvas", { class: "dev-canvas" });
  const back = el("button", { class: "dev-back", onclick: () => context.router.back() }, "Back");
  container.append(el("section", { class: "dev-view" }, canvas, hud, status, back));

  const build = await context.assets.call("trackRender", {
    path: track.path, detailLevel: context.settings.detailLevel, raceType: track.raceType,
  });
  const start = build.sim.start;
  const file = truckFile ?? start?.file;
  const truck = build.truckModels[file];
  if (!start?.pos || !truck) {
    status.textContent = `${track.name} has no start grid truck to drive.`;
    return {};
  }
  const look = context.settings.look === "enhanced" ? "enhanced" : "classic";

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 20000);
  const background = skyColor(build.sky);
  scene.background = background;
  scene.fog = new THREE.Fog(background, 2500, 7000);
  const v = build.sunVector ?? [46333, -46333, 0];
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-v[0], -v[1], v[2]).normalize();
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.9));
  const world = createTrackWorld(build, look);
  scene.add(world);

  const sim = new WorkerClient(new URL("../../worker/sim-worker.js", import.meta.url));
  const init = {
    heights: build.heights.slice().buffer,
    clr: build.sim.clr.buffer,
    textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0?.buffer ?? null,
    ra1: build.sim.ra1?.buffer ?? null,
    boxes: build.sim.boxes,
    waterLevelFt: build.waterLevelFt,
    weather: 0,
    difficulty: 1,
    truck: { anchors: truck.anchors, scrapePoints: truck.scrapePoints },
    start: { pos: start.pos, heading: start.heading },
  };
  let pose = await sim.call("init", init);
  // Drawn at the TRK's own anchors (the game keeps them for drawing; the simulation clamps the
  // wheelbase, §3.1).
  const truckObject = createTruckObject(truck, truck.anchors, look);
  scene.add(truckObject.object);
  status.textContent = `${build.trackName}: ${truck.name}. Arrows or a gamepad drive, Q / Z shift, H helicopter, C camera, R restart.`;

  const keys = createKeyboardInput(window);
  const pad = createGamepadInput();
  // A held drive key wins over a connected pad, so both can be used (the game picks one in setup).
  const sampleInput = () => {
    const held = keys.sample();
    const driving = held.accelerate || held.brake || held.left || held.right;
    return { ...held, joystick: driving ? null : pad.sample() };
  };
  let cameraIndex = 0;
  const onKey = async (e) => {
    if (e.code === "KeyC") cameraIndex = (cameraIndex + 1) % CAMERAS.length;
    if (e.code === "KeyR") pose = await sim.call("init", init);
  };
  window.addEventListener("keydown", onKey);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // Chase camera: behind the truck along its heading, eased.
  const camTarget = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  let camReady = false;
  const placeCamera = (p, dt) => {
    const m = new THREE.Matrix4().fromArray(toSceneMatrix(p.matrix, p.pos));
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const psi = p.euler[2];
    const { back: dist, up } = CAMERAS[cameraIndex];
    // Game heading psi faces (sin psi, cos psi) in x, z; the scene mirrors z.
    const want = new THREE.Vector3(pos.x - Math.sin(psi) * dist, pos.y + up, pos.z + Math.cos(psi) * dist);
    const k = camReady ? 1 - Math.exp(-dt * 6) : 1;
    camPos.lerp(want, k);
    camTarget.lerp(pos.clone().add(new THREE.Vector3(0, 4, 0)), camReady ? 1 - Math.exp(-dt * 12) : 1);
    camReady = true;
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  };

  let frame = 0, last = performance.now(), busy = false, latest = { previous: pose, current: pose, alpha: 1 };
  window.__openmtm2Drive = { scene, camera, renderer, sim, get pose() { return latest.current; } };
  const loop = async (now) => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!busy) {
      busy = true;
      sim.call("tick", { tMs: now, input: sampleInput() })
        .then((r) => { latest = r; })
        .finally(() => { busy = false; });
    }
    const drawn = interpolatePose(latest.previous, latest.current, latest.alpha);
    truckObject.update(drawn);
    placeCamera(drawn, dt);
    const sky = world.getObjectByName("sky");
    if (sky) sky.position.set(camera.position.x, 0, camera.position.z);
    const c = latest.current;
    hud.textContent = `${(c.speed / 1.4667).toFixed(0)} mph   gear ${GEAR_NAMES[c.gear] ?? c.gear}   ${c.rpm.toFixed(0)} rpm   `
      + `${CAMERAS[cameraIndex].name}`
      + (c.heliTimer > 0 ? `   helicopter ${c.heliTimer.toFixed(1)} s` : c.heliTimer < 0 ? `   stuck ${(-c.heliTimer).toFixed(1)} s` : "");
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return {
    unmount() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      keys.dispose();
      sim.terminate();
      disposeObject(scene);
      renderer.dispose();
      delete window.__openmtm2Drive;
    },
  };
}
