/*
  Instant replay (M14, MONSTER_EXE_ANALYSIS.md section 11 "Instant replay and demos"): a recorded
  race (game/replay.js, the `.rpl` format) played back in the race's own scene with the game's
  VCR controls: play, pause, rewind, fast forward, slow, frame step, zoom, rotate, save and open.
  The camera is any of the ten views on any truck. Damage is replayed from the damage codes.
*/
import * as THREE from "three";
import { el } from "../dom.js";
import { mergeBindings } from "../../game/input/bindings.js";
import { DENT_STEPS, FRAME_SECONDS, RATES, createPlayback, damageZones, levelPath } from "../../game/replay.js";
import { mtm2Sim, parseMtmReplay, writeMtmReplay } from "../../vendor/openphotex/index.js";
import { COCKPIT_EYE, CAMERA_MODES, modeForShortcut, blimpCamera, blimpCameraNoCourse, courseCentroid, createChaseCamera, fovFor, groundHeightFn, nextMode, raceCamera, zoomToFov } from "../../game/cameras.js";
import { createWeatherScene } from "../../render/weather-scene.js";
import { WEATHER_LOOK, isUnderwater, waterOffsetFt } from "../../game/weather.js";
import { lampsAtStart } from "../../game/truck-lights.js";
import { loadFont } from "../../render/bitmap-text.js";
import { createCaption } from "../../render/caption.js";
import { createWaterEffects, createWaterSurface } from "../../render/water-effects.js";
import { formatRaceTime } from "../../game/race-setup.js";
import { createTrackWorld, disposeObject, moveObjects, skyColor, updateTrackWorld } from "../../render/track-scene.js";
import { createTruckObject } from "../../render/truck-object.js";
import { toSceneMatrix } from "../../shared/scene-frame.js";
import { createTrackLights } from "../../render/track-lights.js";

export default async function mount(container, context, { replay }) {
  const t = context.t;
  const back = () => context.router.back();
  const view = el("section", { class: "race-view replay-view" });
  container.append(view);
  let disposed = false;
  const cleanups = [];
  const unmount = () => { disposed = true; for (const f of cleanups.reverse()) f(); };
  if (!replay?.records?.length) {
    view.append(el("p", { class: "race-loading-text" }, "There is no replay to show."), el("button", { onclick: back }, "Back"));
    return { unmount };
  }
  const loading = el("div", { class: "race-loading" }, el("p", { class: "race-loading-text" }, "Loading the replay…"));
  view.append(loading);

  const catalog = await context.assets.call("catalog").catch(() => ({ tracks: [], trucks: [] }));
  const path = levelPath(replay.level);
  const trackInfo = catalog.tracks.find((x) => x.path?.toUpperCase() === path) ?? { name: replay.level, path, raceType: "circuit" };
  const truckFiles = replay.vehicles.map((v) => v.truck.toUpperCase());
  const build = await context.assets.call("trackRender", {
    path, detailLevel: replay.detailLevel ?? context.settings.detailLevel, raceType: trackInfo.raceType ?? "circuit", truckFiles, weather: replay.weather,
  }).catch((err) => { loading.textContent = `The replay's track could not be built: ${err.message}`; return null; });
  if (disposed || !build) return { unmount };
  loading.hidden = true;

  const [messageFont, effectsArt] = await Promise.all([loadFont(context.assets, "FNT2_480"), context.assets.call("effectsArt").catch(() => null)]);
  const look = context.settings.look === "enhanced" ? "enhanced" : "classic";
  const canvas = el("canvas", { class: "race-canvas" });
  view.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene();
  const drawDistance = context.settings.drawDistance ?? 20000;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, drawDistance);
  const background = skyColor(build.sky);
  scene.background = background;
  scene.fog = new THREE.Fog(background, 2500, 7000);
  const v = build.sunVector ?? [46333, -46333, 0];
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-v[0], -v[1], v[2]).normalize();
  const sunTravel = sun.position.clone().negate();
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(sun, ambientLight);
  const world = createTrackWorld(build, look, { backdrops: !!context.settings.backdrops, drawDistance });
  scene.add(world);
  cleanups.push(() => { disposeObject(scene); renderer.dispose(); });

  const playback = createPlayback(replay, {});
  const drawn = replay.vehicles.map((vehicle) => {
    const model = build.truckModels[vehicle.truck.toUpperCase()];
    if (!model) return null;
    const object = createTruckObject(model, model.anchors, look);
    scene.add(object.object);
    return { ...object, model };
  });
  const terrain = mtm2Sim.createTerrain(new Uint8Array(build.heights), build.waterLevelFt ?? null);
  const ground = groundHeightFn(terrain);
  const trackLights = createTrackLights(scene, build.trackLights, ground);
  if (trackLights) cleanups.push(() => trackLights.dispose());
  const weatherScene = createWeatherScene({ scene, camera, world, sun, ambient: ambientLight, skyAverage: background, look, drawDistance, backdrops: !!context.settings.backdrops, art: effectsArt, onSun: () => {}, onLightning: () => {} });
  weatherScene.set(replay.weather ?? 0);
  cleanups.push(() => weatherScene.dispose());
  const waterFx = createWaterEffects({ scene, art: effectsArt, levelFt: build.waterLevelFt ?? null, ground });
  cleanups.push(() => waterFx.dispose());
  const waterSurface = createWaterSurface(world.getObjectByName("water"), effectsArt, look);
  cleanups.push(() => waterSurface?.dispose());
  const caption = createCaption(messageFont);
  view.append(caption.element);

  const names = replay.vehicles.map((x) => x.driver);
  let focus = Math.max(0, Math.min(drawn.length - 1, 0));
  let viewMode = CAMERA_MODES[context.settings.view]?.id ?? 1;
  if (viewMode === 0) viewMode = 1;
  let turn = 0, zoom = 1;
  let clock = 0, rate = 1, playing = true;
  const chase = createChaseCamera();
  const straights = build.sim.course, centroid = courseCentroid(straights);
  const cockpitEye = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, scratchScale = new THREE.Vector3();

  // Damage is replayed from the codes: a zone that appears or worsens is pushed in; going back repairs the body first.
  const applied = replay.vehicles.map(() => 0);
  function syncDamage(i, code) {
    const truck = drawn[i];
    if (!truck || code === applied[i]) return;
    const worse = damageZones(code).some(([zone, level]) => level > mtm2Sim.zoneLevel(applied[i], zone));
    const better = damageZones(applied[i]).some(([zone, level]) => level > mtm2Sim.zoneLevel(code, zone));
    if (better) { truck.repair(); applied[i] = 0; }
    if (worse || better) {
      for (const [zone, level] of damageZones(code)) {
        if (level <= mtm2Sim.zoneLevel(applied[i], zone)) continue;
        for (let n = 0; n < DENT_STEPS; n++) truck.dent(zone, level);
      }
    }
    applied[i] = code;
  }

  const say = (text, seconds = 2) => caption.show(text, seconds);
  const announceView = () => say(`${t(CAMERA_MODES[viewMode].name)} of ${names[focus] ?? ""}`);

  // The VCR controls.
  const time = el("span", { class: "replay-time" }, "00:00.00");
  const speed = el("span", { class: "replay-speed" }, "");
  const scrub = el("input", { type: "range", min: 0, max: 1000, value: 0, "aria-label": "Position", class: "replay-scrub" });
  scrub.addEventListener("input", () => { clock = (Number(scrub.value) / 1000) * playback.duration; playing = false; refreshButtons(); });
  const button = (label, title, onclick) => el("button", { type: "button", title, "aria-label": title, onclick }, label);
  const playButton = button("⏸", "Play or pause (Space)", () => toggle());
  const toggle = () => { playing = !playing; if (playing && clock >= playback.duration) clock = 0; refreshButtons(); };
  const setRate = (step) => {
    const index = RATES.indexOf(Math.abs(rate)) + step;
    rate = Math.sign(rate || 1) * RATES[Math.max(0, Math.min(RATES.length - 1, index))];
    refreshButtons();
  };
  const rewind = () => { rate = -Math.abs(rate); playing = true; refreshButtons(); };
  const forward = () => { rate = Math.abs(rate); playing = true; refreshButtons(); };
  const stepFrame = (n) => { playing = false; clock = Math.max(0, Math.min(playback.duration, (Math.round(clock / FRAME_SECONDS) + n) * FRAME_SECONDS)); refreshButtons(); };
  function refreshButtons() {
    playButton.textContent = playing ? "⏸" : "▶";
    speed.textContent = playing ? `${rate < 0 ? "◀" : "▶"} ${Math.abs(rate)}x` : "paused";
  }
  const truckSelect = el("select", { "aria-label": "Truck", onchange: (e) => { focus = Number(e.target.value); chase.reset(); announceView(); } },
    ...names.map((n, i) => el("option", { value: i }, `${i + 1}. ${n}`)));
  const viewSelect = el("select", { "aria-label": "Camera", onchange: (e) => { viewMode = Number(e.target.value); announceView(); } },
    ...CAMERA_MODES.map((m) => el("option", { value: m.id, selected: m.id === viewMode }, t(m.name))));
  const save = () => {
    const link = el("a", { href: URL.createObjectURL(new Blob([writeMtmReplay(replay)], { type: "text/plain" })), download: `${replay.level.replace(/\.sit$/i, "")}.rpl` });
    document.body.append(link); link.click(); link.remove();
    say(t("Replay saved"));
  };
  const controls = el("div", { class: "replay-controls" },
    button("⏮", "To the start (Home)", () => { clock = 0; }),
    button("⏪", "Rewind (R)", rewind),
    button("◀|", "Frame back (,)", () => stepFrame(-1)),
    playButton,
    button("|▶", "Frame forward (.)", () => stepFrame(1)),
    button("⏩", "Fast forward (F)", forward),
    button("⏭", "To the end (End)", () => { clock = playback.duration; }),
    button("−", "Slower ([)", () => setRate(-1)), button("+", "Faster (])", () => setRate(1)),
    scrub, time, speed, truckSelect, viewSelect,
    button("Save", "Save the replay as a .rpl file", save),
    button("Close", "Back (Esc)", back));
  view.append(controls);
  refreshButtons();

  const keyMap = mergeBindings(context.settings.bindings);
  const held = new Set();
  const onKey = (e) => {
    held.add(e.code);
    if (e.code === "Escape") back();
    else if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.code === "Comma") stepFrame(-1);
    else if (e.code === "Period") stepFrame(1);
    else if (e.code === "BracketLeft") setRate(-1);
    else if (e.code === "BracketRight") setRate(1);
    else if (e.code === "KeyR") rewind();
    else if (e.code === "KeyF") forward();
    else if (e.code === "Home") clock = 0;
    else if (e.code === "End") clock = playback.duration;
    else if (e.code === "Tab") { e.preventDefault(); focus = (focus + (e.shiftKey ? drawn.length - 1 : 1)) % drawn.length; truckSelect.value = String(focus); chase.reset(); announceView(); }
    else if ((keyMap.camera.includes(e.code) || modeForShortcut(e) !== null) && !e.repeat) { if (modeForShortcut(e) !== null) e.preventDefault(); viewMode = modeForShortcut(e) ?? nextMode(viewMode, e.shiftKey); viewSelect.value = String(viewMode); announceView(); }
  };
  const onKeyUp = (e) => held.delete(e.code);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  cleanups.push(() => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); });
  const onWheel = (e) => { zoom = Math.max(0.4, Math.min(6, zoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1))); };
  canvas.addEventListener("wheel", onWheel, { passive: true });

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

  let lastView = -1, waterClock = 0, last = performance.now(), frameId = 0;
  const placeCamera = (pose, dt) => {
    if (viewMode !== lastView) {
      lastView = viewMode;
      chase.reset();
      camera.fov = fovFor(viewMode);
      camera.updateProjectionMatrix();
    }
    if (viewMode === 0) {
      const body = new THREE.Matrix4().fromArray(toSceneMatrix(pose.matrix, pose.pos));
      body.decompose(cockpitEye.position, cockpitEye.quaternion, scratchScale);
      camera.position.set(COCKPIT_EYE[0], COCKPIT_EYE[1], -COCKPIT_EYE[2]).applyMatrix4(body);
      camera.quaternion.copy(cockpitEye.quaternion);
      return;
    }
    const yaw = pose.euler[2];
    const special = viewMode === 3 ? (centroid ? blimpCamera(pose.pos, centroid) : blimpCameraNoCourse(pose.pos, yaw, ground))
      : viewMode === 4 ? (raceCamera(straights, pose.pos, pose.course ?? 0, ground) ?? blimpCameraNoCourse(pose.pos, yaw, ground)) : null;
    const result = special ?? chase.update(viewMode, pose.pos, yaw, ground, dt, { turn, scale: zoom });
    if (special) {
      const fov = zoomToFov(special.zoom);
      if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    }
    camera.position.set(result.position[0], result.position[1], -result.position[2]);
    camera.lookAt(result.target[0], result.target[1], -result.target[2]);
  };

  const loop = (now) => {
    frameId = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      clock += rate * dt;
      if (clock >= playback.duration) { clock = playback.duration; if (rate > 0) { playing = false; refreshButtons(); } }
      if (clock <= 0) { clock = 0; if (rate < 0) { playing = false; rate = Math.abs(rate); refreshButtons(); } }
    }
    // Arrow keys turn the camera round the truck and zoom it.
    if (held.has("ArrowLeft")) turn -= dt * 1.2;
    if (held.has("ArrowRight")) turn += dt * 1.2;
    if (held.has("ArrowUp")) zoom = Math.max(0.4, zoom / (1 + dt * 1.5));
    if (held.has("ArrowDown")) zoom = Math.min(6, zoom * (1 + dt * 1.5));
    const headlights = !!WEATHER_LOOK[replay.weather ?? 0]?.headlights;
    const state = playback.at(clock);
    state.trucks.forEach((pose, i) => {
      if (!pose || !drawn[i]) return;
      // The axles rest on the truck's own hubs (the game does not record the suspension).
      const [fr, , rr] = drawn[i].model.anchors;
      pose.axles = [{ articulation: 0, travel: fr?.[1] ?? -4 }, { articulation: 0, travel: rr?.[1] ?? -4 }];
      // The game records neither the brakes nor the lamp switch: the lamps are what the weather gave them.
      drawn[i].update(pose, camera, { lamps: lampsAtStart(headlights), clockMs: clock * 1000, night: headlights, cockpit: false });
    });
    state.damage.forEach((code, i) => syncDamage(i, code));
    if (state.objects.length) moveObjects(world, state.objects.map((o) => ({ sitIndex: o.sitIndex, matrix: toSceneMatrix(o.matrix, o.pos) })));
    const target = state.trucks[focus] ?? state.trucks.find(Boolean);
    if (target) {
      placeCamera(target, dt);
      drawn.forEach((d, i) => { if (d) d.setBodyHidden(viewMode === 0 && i === focus); });
    }
    time.textContent = formatRaceTime(clock);
    if (document.activeElement !== scrub) scrub.value = String(Math.round((clock / Math.max(playback.duration, 1e-6)) * 1000));
    waterClock += playing ? dt * Math.abs(rate) : 0;
    const water = world.getObjectByName("water");
    if (water) water.position.y = waterOffsetFt(waterClock, weatherScene.weather);
    waterSurface?.update(dt, weatherScene.weather);
    const under = isUnderwater(camera.position.y, water ? water.userData.levelFt + water.position.y : null, weatherScene.weather);
    weatherScene.setUnderwater(under);
    trackLights?.update(camera, !!WEATHER_LOOK[weatherScene.weather]?.headlights);
    weatherScene.update(dt, state.trucks.filter(Boolean).map((p) => ({ x: p.pos[0], y: p.pos[1], z: p.pos[2], heading: p.euler[2] })));
    const sky = world.getObjectByName("sky");
    if (sky) { sky.position.set(camera.position.x, 0, camera.position.z); sky.visible = !under; }
    updateTrackWorld(world, camera, dt);
    caption.update(dt);
    renderer.render(scene, camera);
  };
  frameId = requestAnimationFrame(loop);
  cleanups.push(() => cancelAnimationFrame(frameId));
  announceView();
  return { unmount };
}

/** Pick a `.rpl` file and return its parsed replay, or null when none was chosen or it is not a replay. */
export function pickReplayFile() {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept: ".rpl,text/plain" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      resolve(file ? parseMtmReplay(new Uint8Array(await file.arrayBuffer())) : null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
