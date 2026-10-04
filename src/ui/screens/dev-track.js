/*
  Developer screen: look around a track (milestone M3). Drag to orbit, right-drag to pan,
  wheel to zoom; L switches between the classic and enhanced looks.
*/
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { el } from "../dom.js";
import { createModelLibrary, createSky, createTerrain, createWater, placeObjects, skyColor } from "../../render/track-scene.js";

export default async function mount(container, context, { track }) {
  const status = el("p", { class: "dev-status" }, `Loading ${track.name}…`);
  const canvas = el("canvas", { class: "dev-canvas" });
  const back = el("button", { class: "dev-back", onclick: () => context.router.back() }, "Back");
  container.append(el("section", { class: "dev-view" }, canvas, status, back));

  const build = await context.assets.call("trackRender", {
    path: track.path, detailLevel: context.settings.detailLevel, raceType: track.raceType,
  });
  let look = context.settings.look === "enhanced" ? "enhanced" : "classic";

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 20000);
  const background = skyColor(build.sky);
  scene.background = background;
  scene.fog = new THREE.Fog(background, 2500, 7000);

  // The level's sun (LVL lines 17-21, 16.16): a direction in the game frame, mirrored in z.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  const v = build.sunVector ?? [46333, -46333, 0];
  sun.position.set(-v[0], -v[1], v[2]).normalize();
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.9));

  let world = null;
  const assemble = () => {
    if (world) {
      scene.remove(world);
      world.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
    }
    world = new THREE.Group();
    world.add(createTerrain(build.terrain, look));
    world.add(placeObjects(createModelLibrary(build.models, build.modelTextures, look), build.objects));
    const water = createWater(build.waterLevelFt);
    if (water) world.add(water);
    const sky = createSky(build.sky, look);
    if (sky) world.add(sky);
    scene.add(world);
    status.textContent = `${build.trackName}: ${build.objects.length} objects, ${look} look (L to switch)`;
  };
  assemble();

  const controls = new OrbitControls(camera, canvas);
  const start = build.viewpoint?.start ?? [4096, 0, 4096];
  const ahead = build.viewpoint?.end ?? [start[0], start[1], start[2] + 100];
  controls.target.set(ahead[0], ahead[1], -ahead[2]);
  camera.position.set(start[0], start[1] + 60, -start[2]);
  controls.update();

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const onKey = (e) => {
    if (e.key === "l" || e.key === "L") {
      look = look === "classic" ? "enhanced" : "classic";
      assemble();
    }
  };
  window.addEventListener("keydown", onKey);

  // For debugging from the console and from automated checks.
  window.__openmtm2Dev = { THREE, scene, camera, renderer, controls, build, render: () => renderer.render(scene, camera) };

  let frame = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    const sky = world.getObjectByName("sky");
    if (sky) sky.position.set(camera.position.x, 0, camera.position.z);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    unmount() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      controls.dispose();
      renderer.dispose();
      delete window.__openmtm2Dev;
    },
  };
}
