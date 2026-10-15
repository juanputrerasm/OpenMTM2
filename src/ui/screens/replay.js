/*
  Instant replay (M14, MONSTER_EXE_ANALYSIS.md section 11 "Instant replay and demos"): a recorded
  race (game/replay.js, the `.rpl` format) played back in the race's own scene with the game's
  VCR controls: play, pause, rewind, fast forward, slow, frame step, zoom, rotate, save and open.
  The camera is any of the ten views on any truck. Damage is replayed from the damage codes.
*/
import { dustLevel, sparkLevel } from "../../game/tire-effects.js";
import { terrainOfBuild } from "../../shared/build-terrain.js";
import * as THREE from "three";
import { el } from "../dom.js";
import { mergeBindings } from "../../game/input/bindings.js";
import { DENT_STEPS, FRAME_SECONDS, RATES, createPlayback, damageZones, levelPath } from "../../game/replay.js";
import { mtm2Sim, parseMtmReplay, writeMtmReplay } from "../../vendor/openphotex/index.js";
import { COCKPIT_EYE, CAMERA_MODES, modeForShortcut, blimpCamera, blimpCameraNoCourse, courseCentroid, createChaseCamera, fovFor, groundHeightFn, nextMode, raceCamera, zoomToFov } from "../../game/cameras.js";
import { createWeatherScene } from "../../render/weather-scene.js";
import { WEATHER_LOOK, isUnderwater, waterOffsetFt } from "../../game/weather.js";
import { beamAir, lampsAtStart } from "../../game/truck-lights.js";
import { loadFont } from "../../render/bitmap-text.js";
import { createCaption } from "../../render/caption.js";
import { createWaterEffects, createWaterSurface } from "../../render/water-effects.js";
import { createTireEffects } from "../../render/tire-effects.js";
import { surfaceFamily } from "../../game/sound-model.js";
import { standOnFt } from "../../game/ice.js";
import { ON_GROUND_FT, replayContacts } from "../../game/replay-effects.js";
import { formatRaceTime } from "../../game/race-setup.js";
import { createTrackWorld, disposeObject, moveObjects, skyColor, updateTrackWorld, placeSky } from "../../render/track-scene.js";
import { createTruckObject } from "../../render/truck-object.js";
import { nearestCopy, toSceneMatrix, wrapFt } from "../../shared/scene-frame.js";
import { createStartLamps } from "../../render/start-lamps.js";
import { createTrackLights } from "../../render/track-lights.js";
import { conformPose, createRelief, tireRadiusFt } from "../../game/terrain-relief.js";
import { trackVisuals, visualSettings } from "../../game/visuals.js";
import { applyGraphics } from "../../game/graphics.js";
import { graphicsHardware } from "../../app/graphics-hardware.js";
import { createScenery } from "../../render/scenery.js";
import { setLightsInFog } from "../../render/atmosphere.js";
import { createFpsCounter } from "../fps-counter.js";
import { saveSettings } from "../../app/settings.js";
import { enableSunShadows } from "../../render/sun-shadows.js";
import { dressParty } from "../../render/party-scene.js";

/** A terrain cell's side: the draw distance is set in cells. */
const TERRAIN_CELL_FT = 32;

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
  // Auto picks again for this machine. A stored preset writes its own switches (game/graphics.js).
  applyGraphics(context.settings, graphicsHardware());
  // Before any material is made: whether the light the port drew from the start is dimmed in the fog.
  setLightsInFog(visualSettings(context.settings).weather);
  // Dust, tracks, sparks and sun shadows read off the film ("Replay effects", docs/VISUALS.md); off, a replay is drawn as it first was.
  const replayFx = visualSettings(context.settings).replay;
  const build = await context.assets.call("trackRender", {
    mtm1: { sky: context.settings.mtm1EarthSky === true, overlap: !!context.settings.mtm1TerrainOverlap },
    path, scope: trackInfo.scope, detailLevel: replay.detailLevel ?? context.settings.detailLevel, raceType: trackInfo.raceType ?? "circuit", truckFiles, weather: replay.weather,
    // A replay's weather never changes, so the puddle map is built only for one recorded in Rain.
    visuals: trackVisuals(context.settings, { weather: replay.weather ?? 0, weatherMask: 0 }),
    smoothTiles: context.settings.look === "enhanced",
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
  const drawDistance = Math.max(16, Math.min(256, context.settings.drawCells ?? 128)) * TERRAIN_CELL_FT;
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
  // What "Natural light" changes of the world itself (docs/VISUALS.md, "Light"): it is the enhanced look's.
  const naturalLight = look === "enhanced" && visualSettings(context.settings).light;
  const world = createTrackWorld(build, look, {
    backdrops: !!context.settings.backdrops, drawDistance, naturalLight,
    terrainDetail: context.settings.terrainDetail !== false, reflections: context.settings.reflections !== false,
  });
  scene.add(world);
  // A party game's own scenery (render/party-scene.js): Hockey's boards and the teams' goals, as the race drew them.
  const partyScene = dressParty(scene, world, replay.party);
  cleanups.push(() => { partyScene.dispose(); disposeObject(scene); renderer.dispose(); });

  let shadows = null;
  const playback = createPlayback(replay, {});
  const drawn = replay.vehicles.map((vehicle) => {
    const model = build.truckModels[vehicle.truck.toUpperCase()];
    if (!model) return null;
    const object = createTruckObject(model, model.anchors, look, { richLamps: visualSettings(context.settings).lamps });
    scene.add(object.object);
    return { ...object, model, tireRadius: tireRadiusFt(model.parts.tireRight ?? model.parts.tireLeft) };
  });
  const terrain = terrainOfBuild(build);
  // With "Smooth terrain" the ground drawn is not quite the ground the trucks were recorded on (game/terrain-relief.js):
  // what follows the ground follows the drawn one, and the drawn trucks are seated on it.
  const relief = build.relief ? createRelief({ heights: build.heights, ...build.relief }) : null;
  const bareGround = relief ? relief.heightAt : groundHeightFn(terrain);
  const iceLevel = (replay.weather ?? 0) === 5 ? build.waterLevelFt ?? null : null;
  let seat = null;
  // The port's own weather, ground and water, each where its switch is on (render/scenery.js; docs/VISUALS.md).
  const scenery = createScenery({
    scene, camera, world, sun, build, settings: context.settings, ground: bareGround, relief,
    ambient: ambientLight, renderer, look,
  });
  for (const truck of drawn) if (truck) scenery.gloss?.dress(truck.object);
  // Seated on the ground as its mesh is drawn (render/scenery.js `groundAt`), against the game's own ground under the wheel.
  seat = relief ? { simAt: relief.simAt, simSlopeAt: relief.simSlopeAt, offsetAt: (x, z) => scenery.groundAt(x, z) - relief.simAt(x, z) } : null;
  // The shade each truck keeps the sky's light off (render/contact-shade.js); a truck whose model is missing has none.
  const shaded = drawn.map((truck, i) => (truck ? i : -1)).filter((i) => i >= 0);
  const contactShade = scenery.contactShade(shaded.map((i) => ({ hubs: drawn[i].model.anchors, radius: drawn[i].tireRadius })));
  if (contactShade) cleanups.push(() => contactShade.dispose());
  cleanups.push(() => scenery.dispose());
  // The drawn ground, and the snow lying on it.
  const ground = scenery.surfaceAt;
  const trackLights = createTrackLights(scene, build.trackLights, ground, { shafts: visualSettings(context.settings).lamps });
  if (trackLights) cleanups.push(() => trackLights.dispose());
  // The start gantry's lamps, with "Truck lamps" (render/start-lamps.js): a replay is of the race, so the green is lit.
  const startLamps = visualSettings(context.settings).lamps ? createStartLamps({ world, scene, dark: !!WEATHER_LOOK[replay.weather ?? 0]?.headlights }) : null;
  if (startLamps) { startLamps.set(false); cleanups.push(() => startLamps.dispose()); }
  const weatherScene = createWeatherScene({
    scene, camera, world, sun, ambient: ambientLight, skyAverage: background, look, drawDistance, backdrops: !!context.settings.backdrops, art: effectsArt,
    onSun: (_, shadow) => shadows?.follow(sun, shadow), onLightning: () => {},
    volume: scenery.volume, groundSurface: scenery.groundSurface, lightRig: scenery.lightRig,
    groundDetail: scenery.groundDetail, dressGround: scenery.dressGround, gloss: scenery.gloss, water: scenery.water,
  });
  weatherScene.set(replay.weather ?? 0);
  cleanups.push(() => weatherScene.dispose());
  // The enhanced look's sun shadows, as in the race.
  if (look === "enhanced" && replayFx) {
    shadows = enableSunShadows({ renderer, scene, camera, world, sun, trucks: drawn.filter(Boolean).map((truck) => truck.object), natural: !!scenery.lightRig });
    shadows.follow(sun, scenery.lightRig?.rig?.shadow ?? 1);
    cleanups.push(() => shadows?.dispose?.());
  }
  // Every copy of the world has its own water plane (render/track-scene.js): they bob and are surfaced together.
  const waters = [];
  world.traverse((object) => { if (object.name === "water") waters.push(object); });
  const waterFx = createWaterEffects({ scene, art: effectsArt, levelFt: build.waterLevelFt ?? null, ground, legacyIce: !scenery.water, blobs: !scenery.particles, rings: !scenery.particles && !scenery.water });
  cleanups.push(() => waterFx.dispose());
  /*
    Dust, tracks, spray and sparks, as in the race (render/tire-effects.js). A replay records where each truck was and
    how it lay, and nothing of its wheels or of what it struck (game/replay.js), so those are read off the picture: a
    wheel is on the ground when its tread is at it, and the hull scrapes where one of its points is down on the ground
    (game/replay-effects.js). What the ground is made of is the level's own.
  */
  // In the dark a shower of sparks lights what is about it.
  const tireFx = replayFx ? createTireEffects({ scene, art: effectsArt, ground, floor: scenery.floorAt, count: drawn.length, rich: scenery.particles, greyDust: !!context.settings.greyDust, dark: !!WEATHER_LOOK[replay.weather ?? 0]?.headlights }) : null;
  cleanups.push(() => tireFx?.dispose());
  window.__openmtm2Replay = { scene, camera, renderer, tireFx };
  cleanups.push(() => { delete window.__openmtm2Replay; });
  const surfaces = build.sim?.clr && build.sim?.textureValues ? mtm2Sim.createSurfaceMap(new Uint16Array(build.sim.clr), new Int32Array(build.sim.textureValues)) : null;
  const madeOf = surfaces ? mtm2Sim.createTerrainGround(terrain, surfaces, replay.weather ?? 0, build.waterLevelFt ?? null) : null;
  const effectFlags = () => ({ dust: dustLevel(context.settings), tracks: context.settings.tireTracks !== false, sparks: sparkLevel(context.settings), splash: context.settings.waterSplash !== false });
  const contacts = drawn.map(() => new Map());
  /** What a truck at game (x, y, z) stands on: a bridge's deck, the ground, or in Snow the ice over the level's water. */
  const standOn = (x, z, y) => standOnFt(scenery.floorAt(x, z, y), replay.weather ?? 0, build.waterLevelFt ?? null);
  let filmClock = null;
  const waterSurface = scenery.water ?? createWaterSurface(waters, effectsArt, look);
  if (!scenery.water) cleanups.push(() => waterSurface?.dispose());
  const caption = createCaption(messageFont);
  view.append(caption.element);
  // The toggleable FPS counter, in the top right.
  const fpsCounter = createFpsCounter({ visible: !!context.settings.fpsCounter });
  view.append(fpsCounter.element);

  const names = replay.vehicles.map((x) => x.driver);
  // The list names each driver with its truck ("Mark, Bigfoot").
  const truckTitle = (file) => catalog.trucks.find((item) => item.file.toUpperCase() === String(file ?? "").toUpperCase())?.name ?? String(file ?? "").replace(/\.TRK$/i, "");
  let focus = Math.max(0, Math.min(drawn.length - 1, 0));
  let viewMode = CAMERA_MODES[context.settings.view]?.id ?? 1;
  if (viewMode === 0) viewMode = 1;
  let turn = 0, zoom = 1;
  let clock = 0, rate = 1, playing = true;
  const chase = createChaseCamera();
  /** Where the watched truck was last drawn: the picture's place in its own unbroken space. */
  let drawAnchor = null;
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
    ...names.map((n, i) => el("option", { value: i }, `${i + 1}. ${n}, ${truckTitle(replay.vehicles[i].truck)}`)));
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
    else if (keyMap.fps?.includes(e.code) && !e.repeat) {
      context.settings.fpsCounter = fpsCounter.toggle();
      saveSettings(context.settings);
    }
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
    scenery.setSize(canvas.width, canvas.height);
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
    // The course is in the simulation's world: these cameras are found there, then moved to where the picture is.
    const sim = [wrapFt(pose.pos[0]), pose.pos[1], wrapFt(pose.pos[2])], off = [pose.pos[0] - sim[0], 0, pose.pos[2] - sim[2]];
    const stood = viewMode === 3 ? (centroid ? blimpCamera(sim, centroid) : blimpCameraNoCourse(sim, yaw, ground))
      : viewMode === 4 ? (raceCamera(straights, sim, pose.course ?? 0, ground) ?? blimpCameraNoCourse(sim, yaw, ground)) : null;
    const special = stood && { ...stood, position: stood.position.map((v, k) => v + off[k]), target: stood.target.map((v, k) => v + off[k]) };
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
    if (fpsCounter.visible !== !!context.settings.fpsCounter) fpsCounter.setVisible(!!context.settings.fpsCounter);
    fpsCounter.update(dt);
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
    // The world is a torus: every truck is drawn at the copy nearest the one the camera is on.
    // The watched truck where it was last drawn (the picture's space has no seam), and the others beside it.
    const watched = state.trucks[focus] ?? state.trucks.find(Boolean);
    if (watched) {
      watched.pos = drawAnchor = nearestCopy(watched.pos, drawAnchor ?? watched.pos);
      for (const pose of state.trucks) if (pose && pose !== watched) pose.pos = nearestCopy(pose.pos, watched.pos);
    }
    state.trucks.forEach((pose, i) => {
      if (!pose || !drawn[i]) return;
      // The axles rest on the truck's own hubs (the game does not record the suspension).
      const [fr, , rr] = drawn[i].model.anchors;
      pose.axles = [{ articulation: 0, travel: fr?.[1] ?? -4 }, { articulation: 0, travel: rr?.[1] ?? -4 }];
      const shown = seat ? conformPose(pose, seat, drawn[i].model.anchors, drawn[i].tireRadius, iceLevel) : pose;
      state.trucks[i] = shown;
      // The game records neither the brakes nor the lamp switch: the lamps are what the weather gave them.
      drawn[i].update(shown, camera, {
        lamps: lampsAtStart(headlights), clockMs: clock * 1000, night: headlights, cockpit: false,
        air: beamAir(replay.weather ?? 0), daylight: WEATHER_LOOK[replay.weather ?? 0]?.light ?? 1,
      });
    });
    contactShade?.update(shaded.map((i) => state.trucks[i] ?? null), scenery.lightRig?.rig?.shadow ?? 1, iceLevel);
    // What the trucks throw up and leave behind moves with the film, and only forward: played back, or jumped about
    // in, nothing new is thrown.
    const filmDt = filmClock !== null && playing && rate > 0 ? Math.min(0.25, Math.max(0, clock - filmClock)) : 0;
    filmClock = clock;
    const flags = effectFlags(), weatherNow = replay.weather ?? 0;
    if (tireFx) {
      tireFx.setWater(waters[0] ? waters[0].userData.levelFt + waters[0].position.y : null);
      tireFx.update({
        dt: filmDt, listener: [camera.position.x, camera.position.y, -camera.position.z], flags, noDust: weatherNow === 4 || weatherNow === 5,
        light: scenery.lightRig ? Math.min(1, weatherScene.lightLevel() * 1.15) : 1,
        weather: weatherNow, camera, lights: { sun, ambient: ambientLight, hemisphere: scenery.lightRig?.hemisphere ?? null },
        snowDown: scenery.groundSurface?.snowDown ?? 0, viewHeight: canvas.height,
        trucks: state.trucks.map((pose, i) => {
          if (!pose || !drawn[i]) return null;
          // A wheel is on the ground when its tread is at it, at the deck of a bridge it is on, or at the ice.
          const tires = pose.tires.map((tire, k) => { const hub = drawn[i].tireHub(k); return { ...tire, onGround: hub[1] - drawn[i].tireRadius - standOn(hub[0], hub[2], hub[1]) < ON_GROUND_FT }; });
          const type = madeOf ? mtm2Sim.surfaceType(madeOf.surface(pose.pos[0], pose.pos[1] + 100, pose.pos[2])) : 0;
          return { object: drawn[i], pose: { ...pose, tires, forward: pose.speed }, surface: { family: surfaceFamily(type), type }, tires: null, radius: drawn[i].tireRadius };
        }),
      });
      // Where a hull point is down on the ground while the truck moves, it scrapes: sparks, clods or chips by what it scrapes on.
      if (filmDt > 0) {
        state.trucks.forEach((pose, i) => {
          if (!pose || !drawn[i]) return;
          for (const contact of replayContacts({ hull: (zone) => drawn[i].hullPoint(zone), ground: standOn, last: contacts[i], dt: filmDt })) {
            tireFx.hit(i, drawn[i], contact.zone, contact.steps, contact.force, pose.speed ?? 0, flags);
          }
        });
      }
    }
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
    const water = waters[0];
    const bob = waterOffsetFt(waterClock, weatherScene.weather);
    for (const plane of waters) plane.position.y = bob;
    const under = isUnderwater(camera.position.y, water ? water.userData.levelFt + water.position.y : null, weatherScene.weather);
    weatherScene.setUnderwater(under);
    // How far under the eye is, for the lens: it comes on over the first half foot (docs/VISUALS.md, "Under water").
    scenery.underwater(under && water ? (water.userData.levelFt + water.position.y - camera.position.y) / 0.5 : 0);
    trackLights?.update(camera, !!WEATHER_LOOK[weatherScene.weather]?.headlights);
    startLamps?.update(camera, { daylight: WEATHER_LOOK[weatherScene.weather]?.light ?? 1 });
    weatherScene.update(dt, state.trucks.filter(Boolean).map((p) => ({ x: p.pos[0], y: p.pos[1], z: p.pos[2], heading: p.euler[2], lit: headlights })),
      { floorFt: water ? water.userData.levelFt + bob : null, viewHeight: canvas.height });
    const sky = world.getObjectByName("sky");
    if (sky) { placeSky(sky, camera); sky.visible = weatherScene.skyShown; }
    // After the sky is placed: the port's water shows it.
    // The wheels stir the water and the puddles (render/water-ripples.js), as the film runs.
    scenery.stir(state.trucks.map((pose, i) => (pose && drawn[i] ? { hubs: pose.tires.map((_, k) => drawn[i].tireHub(k)), radiusFt: drawn[i].tireRadius } : null)), filmDt);
    waterSurface?.update(dt, weatherScene.weather, { sun, light: weatherScene.lightLevel(), sky, fog: scene.fog, background, levelFt: water ? water.userData.levelFt + water.position.y : null });
    updateTrackWorld(world, camera, dt);
    if (shadows) {
      shadows.setupMaterials();
      shadows.invalidateDynamic();
      shadows.update();
    }
    caption.update(dt);
    scenery.draw(camera);
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
