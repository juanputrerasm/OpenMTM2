/*
  The race (M7): the player's truck against the CPU trucks on a Circuit track.

  While the track builds, the loading screen (`ART\DATA480.RAW`) shows. The simulation runs in
  its own worker at a fixed 1/60 s; this screen sends the keys each frame and draws every truck
  between its last two simulated states. The HUD follows the game's (MONSTER_EXE_ANALYSIS.md
  11): lap time, best lap and clock, then place and lap. The 3 s countdown (6.1) holds every
  truck on its brakes. When the player finishes, the trucks still racing are fast-simulated
  ("Determining times for remaining trucks", section 5) and the results follow.

  Keys: arrows or WASD drive, Q / Z shift, H helicopter, C camera, Esc or P pause.
*/
import * as THREE from "three";
import { el } from "../dom.js";
import { WorkerClient } from "../../shared/worker-client.js";
import { createKeyboardInput } from "../../game/input/keyboard.js";
import { createGamepadInput } from "../../game/input/gamepad.js";
import { formatRaceTime, raceEntrants } from "../../game/race-setup.js";
import { createTrackWorld, disposeObject, moveObjects, skyColor } from "../../render/track-scene.js";
import { createTruckObject, interpolatePose } from "../../render/truck-object.js";
import { toSceneMatrix } from "../../shared/scene-frame.js";

// Chase cameras: distance behind and height above the truck, feet (modes 1 and 2, section 11).
const CAMERAS = [{ name: "Chase Near", back: 30, up: 11 }, { name: "Chase Far", back: 55, up: 20 }];

export default async function mount(container, context, { track, laps, difficulty, truck: playerTruck, trucks: catalogTrucks }) {
  const canvas = el("canvas", { class: "race-canvas" });
  const loading = el("div", { class: "race-loading" });
  const loadingText = el("p", { class: "race-loading-text" }, `Loading ${track.name}…`);
  loading.append(loadingText);
  const hudTimes = el("div", { class: "race-hud race-hud-times" });
  const hudPlace = el("div", { class: "race-hud race-hud-place" });
  const lights = el("div", { class: "race-lights", hidden: true });
  const message = el("p", { class: "race-message", hidden: true });
  const pauseMenu = el("div", { class: "race-pause", hidden: true });
  const view = el("section", { class: "race-view" }, canvas, hudTimes, hudPlace, lights, message, pauseMenu, loading);
  container.append(view);

  let disposed = false;
  const cleanups = [];
  const unmount = () => {
    disposed = true;
    for (const f of cleanups.reverse()) f();
  };

  // The loading screen art, scaled to the window.
  context.assets.call("loadingScreen", { raceType: track.raceType }).then((image) => {
    if (!image || disposed) return;
    const art = el("canvas", { class: "race-loading-art", width: image.width, height: image.height });
    art.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.rgba.buffer ?? image.rgba), image.width, image.height), 0, 0);
    loading.prepend(art);
  }).catch(() => {});

  const truckName = (file) => catalogTrucks.find((t) => t.file === file)?.name ?? file;
  const build = await context.assets.call("trackRender", {
    path: track.path, detailLevel: context.settings.detailLevel, raceType: track.raceType,
    truckFiles: catalogTrucks.map((t) => t.file),
  });
  if (disposed) return { unmount };
  const grid = build.sim.grid;
  const usable = catalogTrucks.filter((t) => build.truckModels[t.file]);
  const entrants = raceEntrants({ playerTruck, trucks: usable, slots: grid.length });
  if (!grid.length || !build.truckModels[playerTruck]) {
    loadingText.textContent = `${track.name} has no start grid, or ${truckName(playerTruck)} could not be built.`;
    loading.append(el("button", { onclick: () => context.router.back() }, "Back"));
    return { unmount };
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
  cleanups.push(() => { disposeObject(scene); renderer.dispose(); });

  // One drawn truck per entrant, at the TRK's own anchors (the simulation clamps the wheelbase, §3.1).
  const drawn = entrants.map((e) => {
    const model = build.truckModels[e.file];
    const object = createTruckObject(model, model.anchors, look);
    scene.add(object.object);
    return object;
  });

  const sim = new WorkerClient(new URL("../../worker/sim-worker.js", import.meta.url));
  cleanups.push(() => sim.terminate());
  const init = {
    heights: build.heights.slice().buffer,
    clr: build.sim.clr.buffer,
    textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0?.buffer ?? null,
    ra1: build.sim.ra1?.buffer ?? null,
    boxes: build.sim.boxes,
    ramps: build.sim.ramps,
    course: build.sim.course,
    sonicTrack: build.sim.sonicTrack,
    waterLevelFt: build.waterLevelFt,
    weather: 0,
    difficulty,
    trucks: entrants.map((e, i) => {
      const model = build.truckModels[e.file];
      return {
        truck: { anchors: model.anchors, scrapePoints: model.scrapePoints },
        start: { pos: grid[i].pos, heading: grid[i].heading },
        autopilot: !e.player || !!context.settings.fullAutopilot,
      };
    }),
    race: { checkpoints: build.sim.checkpoints, laps },
  };
  await sim.call("init", init);
  if (disposed) return { unmount };
  loading.hidden = true;

  const keys = createKeyboardInput(window);
  const pad = createGamepadInput();
  cleanups.push(() => keys.dispose());
  const sampleInput = () => {
    const held = keys.sample();
    const driving = held.accelerate || held.brake || held.left || held.right;
    return { ...held, joystick: driving ? null : pad.sample() };
  };

  let cameraIndex = 0, paused = false, finishing = false;
  const setPaused = async (on) => {
    if (finishing || paused === on) return;
    paused = on;
    pauseMenu.hidden = !on;
    if (!on) await sim.call("resume");
  };
  pauseMenu.append(
    el("p", { class: "race-pause-title" }, "Paused"),
    el("button", { class: "primary", onclick: () => setPaused(false) }, "Resume"),
    el("button", { onclick: () => context.router.go("race-select") }, "End race"),
  );
  const onKey = (e) => {
    if (e.code === "KeyC") cameraIndex = (cameraIndex + 1) % CAMERAS.length;
    if (e.code === "Escape" || e.code === "KeyP") setPaused(!paused);
  };
  window.addEventListener("keydown", onKey);
  cleanups.push(() => window.removeEventListener("keydown", onKey));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  cleanups.push(() => observer.disconnect());
  resize();

  // Chase camera: behind the player's truck along its heading, eased.
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

  const row = (label, value) => el("div", { class: "race-hud-row" }, el("span", {}, label), el("span", {}, value));
  let shownMessage = "", messageUntil = 0;
  const flash = (text, now, seconds = 3) => {
    shownMessage = text;
    messageUntil = now + seconds * 1000;
  };
  let wasMissed = false, finalLapShown = false;
  const showRace = (race, now) => {
    const me = race.trucks[0];
    hudTimes.replaceChildren(row("Lap:", formatRaceTime(me.lapTime)), row("Best:", formatRaceTime(me.best)), row("Clock:", formatRaceTime(race.clock)));
    hudPlace.replaceChildren(row("Place:", `${me.place}/${race.trucks.length}`), row("Lap:", `${me.lap}/${race.laps}`));
    // The start lights: red while counting down, green at the start.
    lights.hidden = race.started && race.clock > 1.5;
    lights.textContent = race.started ? "GO!" : String(Math.ceil(race.countdown));
    lights.className = race.started ? "race-lights go" : "race-lights";
    if (me.missed && !wasMissed) flash("Missed checkpoint! Turn around.", now);
    wasMissed = me.missed;
    if (!finalLapShown && race.laps > 1 && me.lap === race.laps && race.started && !me.finished) {
      finalLapShown = true;
      flash("Final lap!", now);
    }
    message.hidden = now > messageUntil;
    message.textContent = shownMessage;
  };

  const finish = async () => {
    finishing = true;
    message.hidden = false;
    message.textContent = "Determining times for remaining trucks";
    const race = await sim.call("finish");
    if (disposed) return;
    const rows = race.trucks.map((t, i) => ({
      ...t, name: entrants[i].name, truckName: truckName(entrants[i].file), player: entrants[i].player,
    }));
    context.router.go("results", { track, laps, rows });
  };

  let frame = 0, last = performance.now(), busy = false, latest = null;
  const movedBoxes = new Set();
  window.__openmtm2Race = { scene, camera, renderer, sim, entrants, get latest() { return latest; } };
  cleanups.push(() => { cancelAnimationFrame(frame); delete window.__openmtm2Race; });
  const loop = (now) => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!busy && !paused && !finishing) {
      busy = true;
      sim.call("tick", { tMs: now, input: sampleInput() })
        .then((r) => {
          latest = r;
          if (r.boxes?.length) {
            moveObjects(world, r.boxes.map((b) => ({ sitIndex: b.sitIndex, matrix: toSceneMatrix(b.matrix, b.pos) })));
            for (const b of r.boxes) movedBoxes.add(b.sitIndex);
          }
          if (r.race?.trucks[0].finished && !finishing) finish();
        })
        .catch((err) => { if (!disposed) { message.hidden = false; message.textContent = err.message; } })
        .finally(() => { busy = false; });
    }
    if (latest) {
      latest.poses.forEach((p, i) => drawn[i].update(interpolatePose(p.previous, p.current, latest.alpha)));
      placeCamera(interpolatePose(latest.poses[0].previous, latest.poses[0].current, latest.alpha), dt);
      if (latest.race && !finishing) showRace(latest.race, now);
    }
    const sky = world.getObjectByName("sky");
    if (sky) sky.position.set(camera.position.x, 0, camera.position.z);
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return { unmount };
}
