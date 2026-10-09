/*
  The race (M7): the player's truck against the CPU trucks on a Circuit track.

  While the track builds, the loading screen (`ART\DATA480.RAW`) shows. The simulation runs in
  its own worker at a fixed 1/60 s; this screen sends the keys each frame and draws every truck
  between its last two simulated states. The HUD follows the game's (MONSTER_EXE_ANALYSIS.md
  11): lap time, best lap and clock, then place and lap. Through the 3 s countdown (6.1) every
  truck sits in Park and the start gantry's red lamps glow; at the start the green ones light. When the player finishes, the trucks still racing are fast-simulated
  ("Determining times for remaining trucks", section 5) and the results follow.

  Keys: arrows or WASD drive, Q / Z shift, H helicopter, Space horn, V camera, Esc or P pause.
*/
import * as THREE from "three";
import { el } from "../dom.js";
import { saveSettings } from "../../app/settings.js";
import { WorkerClient } from "../../shared/worker-client.js";
import { currentDriver, getProfiles } from "../../app/profile-store.js";
import { createKeyboardInput } from "../../game/input/keyboard.js";
import { mergeBindings } from "../../game/input/bindings.js";
import { SunFlare } from "../../render/sun-flare.js";
import { SunShadows } from "../../render/sun-shadows.js";
import { mtm2Sim } from "../../vendor/openphotex/index.js";
import { COCKPIT_EYE, CAMERA_MODES, modeForShortcut, blimpCamera, blimpCameraNoCourse, courseCentroid, createChaseCamera, fovFor, groundHeightFn, nextMode, raceCamera, zoomToFov } from "../../game/cameras.js";
import { createBlimp, hasBlimp } from "../../game/blimp.js";
import { soundRange, surfaceFamily } from "../../game/sound-model.js";
import { createTireEffects } from "../../render/tire-effects.js";
import { createTrackLights } from "../../render/track-lights.js";
import { createHelicopters } from "../../render/heli-object.js";
import { createNameTags } from "../../render/name-tags.js";
import { nameLabel, nextNamesMode } from "../../game/names.js";
import { createAudio } from "../../audio/audio-engine.js";
import { VOICE_COMMENTARY_ENABLED, createCommentaryAudio } from "../../audio/commentary-audio.js";
import { createAnnouncer } from "../../game/commentary.js";
import { createCommentaryWatcher } from "../../game/commentary-events.js";
import { createTruckAudio } from "../../audio/truck-audio.js";
import { createWorldAudio } from "../../audio/world-audio.js";
import { createWeatherScene } from "../../render/weather-scene.js";
import { WEATHER_LOOK, isUnderwater, resolveWeather, waterOffsetFt } from "../../game/weather.js";
import { lampsAtStart, toggleLamps } from "../../game/truck-lights.js";
import { createGoldMode } from "../gold-mode.js";
import { createGamepadInput } from "../../game/input/gamepad.js";
import { createTextPanel, loadFont } from "../../render/bitmap-text.js";
import { createRaceGauges } from "../../render/race-gauges.js";
import { createWaterEffects, createWaterSurface } from "../../render/water-effects.js";
import { createReplayRecorder } from "../../game/replay.js";
import { createRaceEnd } from "../../game/race-end.js";
import { createDragTree } from "../drag-tree.js";
import { createCrashDamage, crashDamageMessage } from "../../game/crash-damage.js";
import { createCaption } from "../../render/caption.js";
import { courseLoop, createCourseMap } from "../../render/minimap.js";
import { createCockpit, finderAngle } from "../../render/cockpit.js";
import { formatRaceTime, raceEntrants } from "../../game/race-setup.js";
import { createModelLibrary, createTrackWorld, disposeObject, moveObjects, setStartLights, skyColor, updateSky, updateTrackWorld } from "../../render/track-scene.js";
import { createTruckObject, interpolatePose } from "../../render/truck-object.js";
import { toSceneMatrix } from "../../shared/scene-frame.js";

/** The race HUD text is a light grey with a one-pixel black shadow (the game's own look). */
const HUD_GREY = "#cfcfcf";

export default async function mount(container, context, { track, laps, difficulty, opponents, truck: playerTruck, trucks: catalogTrucks, setup, weather: chosenWeather }) {
  const t = context.t;
  const weatherId = resolveWeather(chosenWeather ?? context.settings.weather ?? 0, track.weatherMask);
  const summit = track.raceType === "summit";
  const dragRace = track.raceType === "drag";
  const dragTree = createDragTree();
  const canvas = el("canvas", { class: "race-canvas" });
  const loading = el("div", { class: "race-loading" });
  const loadingText = el("p", { class: "race-loading-text" }, `Loading ${track.name}…`);
  loading.append(loadingText);
  // The HUD is drawn with the game's own fonts (ART\FNT1_480 for rows, FNT2_480 for messages).
  const [hudFont, messageFont, lcdFont, needle, cockpitArt, effectsArt] = await Promise.all([
    loadFont(context.assets, "FNT1_480"), loadFont(context.assets, "FNT2_480"), loadFont(context.assets, "FNTO_480"), context.assets.call("needle").catch(() => null),
    context.assets.call("cockpit").catch(() => null), context.assets.call("effectsArt").catch(() => null),
  ]);
  const scale = Math.max(1, window.innerHeight / 480);
  // The timing board is in the Small LCD font, whose digits all have the same width (the clock reads "0 1:04.91").
  const hud = createTextPanel(lcdFont ?? hudFont, { width: 206, scale, rowHeight: 15, labelColor: HUD_GREY, valueColor: HUD_GREY });
  hud.element.classList.add("race-hud");
  const gauges = createRaceGauges(hudFont, { needle, units: context.settings.units });
  gauges.setVisible(context.settings.dashboard !== false);
  const cockpit = createCockpit(cockpitArt, { needle, font: hudFont, units: context.settings.units });
  // The caption bar: the game's large font on a dark rectangle at the bottom, for every in-race message.
  const caption = createCaption(messageFont);
  const showMessage = (text) => caption.show(text, Infinity);
  const pauseMenu = el("div", { class: "race-pause", hidden: true });
  // The Names key (game/names.js): what the course map and the labels over the trucks say.
  let namesMode = 0;
  const view = el("section", { class: "race-view" }, canvas, ...(cockpit ? [cockpit.dashboard, cockpit.mirror, cockpit.finder] : []), hud.element, dragTree.element, gauges.element, caption.element, pauseMenu, loading);
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
    truckFiles: catalogTrucks.map((t) => t.file), weather: weatherId,
  });
  if (disposed) return { unmount };
  const driver = currentDriver(await getProfiles(context));
  // The course map (Map key), from the SIT's primary course.
  // Professional puts every truck on course 2 when the SIT has one (MONSTER_EXE_ANALYSIS.md 9); the map still draws course 1.
  const raceCourse = Number(difficulty) === 2 && build.sim.proCourse ? build.sim.proCourse : build.sim.course;
  const minimap = createCourseMap(build.sim.course, { font: hudFont });
  minimap.setVisible(!!context.settings.minimap);
  view.append(minimap.element);
  const grid = build.sim.grid;
  const usable = catalogTrucks.filter((t) => build.truckModels[t.file]);
  const entrants = raceEntrants({ playerTruck, trucks: usable, slots: grid.length, opponents, playerName: driver.name });
  const nameTags = createNameTags(entrants.length);
  view.append(nameTags.element);
  if (!grid.length || !build.truckModels[playerTruck]) {
    loadingText.textContent = `${track.name} has no start grid, or ${truckName(playerTruck)} could not be built.`;
    loading.append(el("button", { "data-menu-sound": "STARTOFF", onclick: () => context.router.back() }, "Back"));
    return { unmount };
  }

  const look = context.settings.look === "enhanced" ? "enhanced" : "classic";
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
  /** The way the sunlight travels, in the scene. */
  const sunTravel = sun.position.clone().negate();
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(sun, ambientLight);
  const world = createTrackWorld(build, look, { backdrops: !!context.settings.backdrops, drawDistance });
  scene.add(world);
  // Sound: the engines, skids and impacts of every truck, and the world's ambience and music.
  context.menuMusic?.stop();
  // Reuse the already unlocked menu context. A newly created context after the asynchronous
  // track load can be blocked by autoplay policy even though GO was clicked.
  const audio = context.menuAudio ?? createAudio(context.assets, context.settings.sound);
  const ownsAudio = !context.menuAudio;
  const ambience = await context.assets.call("ambience", { number: track.ambientSound ?? 0 }).catch(() => null);
  const musicName = context.settings.sound?.music > 0 ? (build.musicName ?? null) : null;
  const worldAudio = createWorldAudio(audio, {
    ambient: ambience, weather: weatherId, music: musicName, objects: build.soundObjects,
    hitInfo: new Map(build.sim.boxes.map((b) => [b.sitIndex, { hitSound: b.hitSound, type: b.type }])),
  });
  const truckAudio = createTruckAudio(audio, {
    count: entrants.length, player: 0, kookyHorn: !!context.settings.kookyHorn,
    onHit: (sitIndex, force, pos) => worldAudio.hit(sitIndex, force, pos),
  });
  // The announcer: phrases from events in the race, spoken in the drivers' own name clips.
  // Voice commentary is deliberately disabled until its clip sequencing is corrected.
  const commentaryOn = VOICE_COMMENTARY_ENABLED && !!context.settings.commentary;
  const announcer = createAnnouncer({ gap: 8 });
  const watcher = createCommentaryWatcher({ drivers: entrants.length, summit });
  const commentary = createCommentaryAudio(audio, {
    drivers: entrants.map((e) => ({ name: e.name, waves: catalogTrucks.find((c) => c.file === e.file)?.waves ?? [] })),
  });
  const speakEvents = (events, now) => {
    for (const event of events.sort((a, b) => b.priority - a.priority)) {
      const said = announcer.say(event.group, event.args, now, { priority: event.priority });
      if (!said) continue;
      commentary.speak(said).done.then(() => announcer.finished(performance.now() / 1000));
      break;
    }
  };
  audio.resume();
  const resumeAudio = () => audio.resume();
  window.addEventListener("keydown", resumeAudio);
  window.addEventListener("pointerdown", resumeAudio);
  cleanups.push(() => {
    commentary.dispose();
    window.removeEventListener("keydown", resumeAudio);
    window.removeEventListener("pointerdown", resumeAudio);
    worldAudio.dispose();
    truckAudio.dispose();
    if (ownsAudio) audio.dispose();
    context.menuMusic?.start();
  });
  const forwardVector = new THREE.Vector3();
  const terrain = mtm2Sim.createTerrain(new Uint8Array(build.heights), build.waterLevelFt ?? null);
  let shadows = null, flare = null, flareBlocked = () => false;
  audio.setRange?.(soundRange(weatherId));
  const weatherScene = createWeatherScene({
    scene, camera, world, sun, ambient: ambientLight, skyAverage: background, look, drawDistance, backdrops: !!context.settings.backdrops, art: effectsArt,
    onSun: (i) => shadows?.setIntensity(i), onLightning: () => worldAudio.thunder(),
  });
  weatherScene.set(weatherId);
  cleanups.push(() => weatherScene.dispose());
  /** GOLD mode's weather change: the grip, the sky, the fog and the light, at once. */
  const setWeather = async (next) => {
    await sim.call("command", { name: "weather", value: next });
    updateSky(world.getObjectByName("sky"), await context.assets.call("sky", { path: track.path, weather: next }), look);
    weatherScene.set(next);
    audio.setRange?.(soundRange(next));
    worldAudio.setWeather(next);
    flare?.setMode(celestialFor(next));
  };
  cleanups.push(() => { disposeObject(scene); renderer.dispose(); });

  // One drawn truck per entrant, at the TRK's own anchors (the simulation clamps the wheelbase, §3.1).
  const drawn = entrants.map((e) => {
    const model = build.truckModels[e.file];
    const object = createTruckObject(model, model.anchors, look);
    scene.add(object.object);
    return object;
  });

  // Crash damage (game/crash-damage.js): the hull contacts the simulation reports dent the bodies.
  const crash = createCrashDamage(entrants.length, { enabled: context.settings.crashDamage !== false });
  // Instant replay (game/replay.js): a frame every quarter second, kept for the results screen.
  const recorder = createReplayRecorder({
    level: track.path.split(/[\\/]/).pop().toLowerCase(), weather: weatherId, detailLevel: context.settings.detailLevel ?? 2,
    vehicles: entrants.map((e) => ({ truck: e.file, driver: e.name })), originals: build.originals ?? [],
  });

  // The enhanced look (settings.look): the sun's shadows, and the sun, moon and lens flare.
  if (look === "enhanced") {
    shadows = enableShadows({ renderer, scene, camera, world, sun, drawn });
    const data = await context.assets.call("flare").catch(() => null);
    if (data) {
      flare = new SunFlare(world, data);
      flare.setMode(celestialFor(weatherId));
      flareBlocked = (origin, direction) => sunBlocked(terrain, origin, direction);
    }
    cleanups.push(() => { shadows?.dispose?.(); flare?.dispose(); });
  }

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
    course: raceCourse,
    // The SIT's fly-by flag makes a track Sonic; on Professional the player can also ask for Sonic computer trucks anywhere.
    sonicTrack: build.sim.sonicTrack || (Number(difficulty) === 2 && !!context.settings.sonicTrucks),
    waterLevelFt: build.waterLevelFt,
    weather: weatherId,
    difficulty,
    autoShift: context.settings.autoShift !== false,
    trucks: entrants.map((e) => {
      const model = build.truckModels[e.file];
      return {
        truck: { anchors: model.anchors, scrapePoints: model.scrapePoints },
        start: { pos: grid[e.slot].pos, heading: grid[e.slot].heading },
        autopilot: !e.player || !!context.settings.fullAutopilot,
        // A drag strip's grid slot is the lane.
        lane: e.slot,
        // The player's Garage setup; the CPU trucks keep the defaults.
        setup: e.player ? setup : undefined,
      };
    }),
    race: { checkpoints: build.sim.checkpoints, laps: dragRace ? 1 : laps, mode: summit ? "summit" : dragRace ? "drag" : "circuit" },
  };
  await sim.call("init", init);
  if (disposed) return { unmount };
  loading.hidden = true;

  const keys = createKeyboardInput(window, context.settings.bindings);
  const pad = createGamepadInput();
  cleanups.push(() => keys.dispose());
  let gold = null;
  const sampleInput = () => {
    const held = keys.sample();
    const driving = held.accelerate || held.brake || held.left || held.right;
    return { ...held, joystick: driving ? null : pad.sample(), slew: gold?.slewing ? gold.slewInput() : null };
  };

  let viewMode = CAMERA_MODES[context.settings.view]?.id ?? 1, paused = false, finishing = false;
  // Each truck's lamp switch (game/truck-lights.js) and the clock the blinking lamps and beacons run on.
  const lamps = entrants.map(() => lampsAtStart(WEATHER_LOOK[weatherId]?.headlights));
  let lampClockMs = 0;
  const setPaused = async (on) => {
    if (finishing || paused === on) return;
    paused = on;
    pauseMenu.hidden = !on;
    if (on) audio.suspend(); else audio.resume();
    if (!on) await sim.call("resume");
  };
  pauseMenu.append(
    el("p", { class: "race-pause-title" }, t("Pause")),
    el("button", { class: "primary", onclick: () => setPaused(false) }, "Resume"),
    el("button", { onclick: (e) => {
      const sound = context.settings.sound = { ...context.settings.sound, muted: !context.settings.sound.muted };
      audio.setVolumes(sound);
      saveSettings(context.settings);
      e.target.textContent = sound.muted ? "Sound off" : "Sound on";
    } }, context.settings.sound.muted ? "Sound off" : "Sound on"),
    el("button", {
      "data-menu-sound": "STARTOFF",
      onclick: () => context.router.go("race-select", { mode: track.raceType }, { replace: true }),
    }, "End race"),
  );
  /** The cockpit view's G state (0 the cockpit, 1 no cockpit with the gauges, 2 neither). */
  const cockpitMode = () => context.settings.cockpitMode ?? 0;
  const keyMap = mergeBindings(context.settings.bindings);
  const onKey = (e) => {
    if (keyMap.horn.includes(e.code) && !e.repeat) truckAudio.horn(0, latest?.poses[0].current.pos);
    if (keyMap.yeehaw.includes(e.code) && !e.repeat) truckAudio.yeehaw(0, latest?.poses[0].current.pos);
    const shortcut = modeForShortcut(e);
    if (shortcut !== null) e.preventDefault();
    if ((keyMap.camera.includes(e.code) || shortcut !== null) && !e.repeat) {
      viewMode = shortcut ?? nextMode(viewMode, e.shiftKey);
      context.settings.view = viewMode;
      saveSettings(context.settings);
      // "Chase Far of Bear Foot": the view's name and the truck being watched (0x52d180).
      flash(`${t(CAMERA_MODES[viewMode].name)} of ${truckName(playerTruck)}`, performance.now(), 2);
    }
    if (keyMap.pause.includes(e.code)) setPaused(!paused);
    if (keyMap.dashboard.includes(e.code) && !e.repeat) {
      // In the cockpit the key goes round three states: the cockpit; no cockpit with the gauges of the other views; no cockpit and no gauges.
      if (viewMode === 0) context.settings.cockpitMode = (cockpitMode() + 1) % 3;
      else context.settings.dashboard = gauges.toggle();
      saveSettings(context.settings);
    }
    if (keyMap.names.includes(e.code) && !e.repeat) namesMode = nextNamesMode(namesMode);
    // The Headlights key (L) switches the player's lamps; every other truck keeps what the weather gave it.
    if (keyMap.headlights.includes(e.code) && !e.repeat && !e.ctrlKey) lamps[0] = toggleLamps(lamps[0]);
    if (keyMap.crashDamage.includes(e.code) && !e.repeat) {
      const on = crash.toggle((i) => drawn[i].repair());
      context.settings.crashDamage = on;
      saveSettings(context.settings);
      flash(t(crashDamageMessage(on, entrants.length)), performance.now(), 3);
    }
    if (keyMap.finder.includes(e.code) && !e.repeat) {
      context.settings.finder = context.settings.finder === false;
      saveSettings(context.settings);
    }
    if (keyMap.map.includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) {
        context.settings.minimap = minimap.toggle();
        saveSettings(context.settings);
      }
    }
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

  // The ten views (game/cameras.js): chase cameras as the exe places them, and the port's own BlimpCam and RaceCam.
  const ground = groundHeightFn(terrain);
  // Community Patch 3 track lights (box type 12), lit at night (render/track-lights.js).
  const trackLights = createTrackLights(scene, build.trackLights, ground);
  if (trackLights) cleanups.push(() => trackLights.dispose());
  // Ice over the water in Snow, and the spray and ripples of wheels in water (render/water-effects.js).
  const waterFx = createWaterEffects({ scene, art: effectsArt, levelFt: build.waterLevelFt ?? null, ground });
  cleanups.push(() => waterFx.dispose());
  // Dust, tire tracks and sparks (render/tire-effects.js), each switched in Options.
  const tireFx = createTireEffects({ scene, art: effectsArt, ground, count: entrants.length });
  cleanups.push(() => tireFx.dispose());
  const effectFlags = () => ({ dust: context.settings.dustEffects !== false, tracks: context.settings.tireTracks !== false, sparks: context.settings.sparks !== false, splash: context.settings.waterSplash !== false });
  const waterSurface = createWaterSurface(world.getObjectByName("water"), effectsArt, look);
  cleanups.push(() => waterSurface?.dispose());
  const chase = createChaseCamera();
  const straights = raceCourse, centroid = courseCentroid(straights);
  // The blimp flies the course (game/blimp.js); the BlimpCam hangs over the course's centre (game/cameras.js).
  const blimp = build.blimp && hasBlimp({ detailLevel: context.settings.detailLevel ?? 2, raceType: track.raceType }) && straights.length
    ? createBlimp(straights, ground) : null;
  // The recovery helicopter and the pterodactyl (game/heli-flight.js).
  const helicopters = createHelicopters(build.heli, look, scene);
  if (helicopters) cleanups.push(() => helicopters.dispose());
  let blimpObject = null, blimpHum = null;
  if (blimp) {
    const library = createModelLibrary({ [build.blimp.model.name]: build.blimp.model }, build.blimp.textures, look);
    blimpObject = new THREE.Group();
    for (const { geometry, material } of library.get(build.blimp.model.name) ?? []) blimpObject.add(new THREE.Mesh(geometry, material));
    scene.add(blimpObject);
    // Its engine hum (blimp2.wav) from where it is.
    blimpHum = audio.play("BLIMP2", { loop: true, gain: 1.4, rate: 1.5, position: blimp.state.pos });
    cleanups.push(() => { blimpHum?.then((v) => v?.stop()); disposeObject(blimpObject); });
  }
  // The rear-view mirror (cockpit only): a second view looking back, drawn small and turned by half a circle.
  const mirrorWindow = cockpit?.mirrorRect;
  const mirrorTarget = mirrorWindow ? new THREE.WebGLRenderTarget(mirrorWindow[2] * 2, mirrorWindow[3] * 2) : null;
  const mirrorCamera = new THREE.PerspectiveCamera(40, mirrorWindow ? mirrorWindow[2] / mirrorWindow[3] : 1, 0.5, drawDistance);
  const mirrorPixels = mirrorTarget ? new Uint8Array(mirrorTarget.width * mirrorTarget.height * 4) : null;
  const flipBack = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  let mirrorTick = 0;
  const renderMirror = () => {
    if (!mirrorTarget) return;
    if (viewMode !== 0 || cockpitMode() !== 0) { cockpit.setMirror(mirrorPixels, mirrorTarget.width, mirrorTarget.height, false); return; }
    if (mirrorTick++ % 2) return;
    mirrorCamera.position.copy(cockpitEye.position);
    mirrorCamera.quaternion.copy(cockpitEye.quaternion).multiply(flipBack);
    renderer.setRenderTarget(mirrorTarget);
    renderer.render(scene, mirrorCamera);
    renderer.readRenderTargetPixels(mirrorTarget, 0, 0, mirrorTarget.width, mirrorTarget.height, mirrorPixels);
    renderer.setRenderTarget(null);
    cockpit.setMirror(mirrorPixels, mirrorTarget.width, mirrorTarget.height);
  };
  cleanups.push(() => mirrorTarget?.dispose());
  let waterClock = 0, shownPoses = null;
  const raceEnd = createRaceEnd({ summit });
  let cameraTarget = 0;
  let lastView = -1;
  const cockpitEye = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, scratchScale = new THREE.Vector3();
  // Switching views changes the camera at once, as the game does: only a chase camera's heading takes time to catch up (game/cameras.js).
  const placeCamera = (p, dt) => {
    if (viewMode !== lastView) {
      lastView = viewMode;
      if (!CAMERA_MODES[viewMode].dist) chase.reset();
      camera.fov = fovFor(viewMode);
      camera.updateProjectionMatrix();
    }
    // The BlimpCam and RaceCam set their own zoom each frame, from their distance to the truck.
    const zoom = placeCameraNow(p, dt);
    if (zoom !== null) {
      const fov = zoomToFov(zoom);
      if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    }
  };
  const placeCameraNow = (p, dt) => {
    const yaw = p.euler[2];
    if (viewMode === 0) {
      // The cockpit: the eye 4 ft up and 1 ft ahead of the truck's origin, turning with the whole body (0x553cf0).
      const body = new THREE.Matrix4().fromArray(toSceneMatrix(p.matrix, p.pos));
      body.decompose(cockpitEye.position, cockpitEye.quaternion, scratchScale);
      camera.position.set(COCKPIT_EYE[0], COCKPIT_EYE[1], -COCKPIT_EYE[2]).applyMatrix4(body);
      camera.quaternion.copy(cockpitEye.quaternion);
      cockpitEye.position.copy(camera.position);
      return null;
    }
    const mode = viewMode;
    const special = mode === 3 ? (centroid ? blimpCamera(p.pos, centroid) : blimpCameraNoCourse(p.pos, yaw, ground))
      : mode === 4 ? (raceCamera(straights, p.pos, p.course ?? 0, ground) ?? blimpCameraNoCourse(p.pos, yaw, ground)) : null;
    const view = special ?? chase.update(mode, p.pos, yaw, ground, dt);
    // Game feet to the scene: z is mirrored.
    camera.position.set(view.position[0], view.position[1], -view.position[2]);
    camera.lookAt(view.target[0], view.target[1], -view.target[2]);
    return special ? special.zoom : null;
  };

  const flash = (text, now, seconds = 3) => caption.show(text, seconds);
  let lastLaps = 0, lastCheckpoint = 0;
  let wasMissed = false, finalLapShown = false, lightsOn = null, dragNoted = false;
  const showRace = (race, now) => {
    // The gantry's lamps change only when the countdown state does (6.1).
    if (lightsOn !== !race.started) {
      lightsOn = !race.started;
      setStartLights(world, lightsOn, build.startLightColours);
    }
    const me = race.trucks[0];
    // The level's own sounds for passing a checkpoint and closing a lap (SOUNDnnn.TXT).
    if (me.laps > lastLaps) worldAudio.lapDone();
    else if (me.checkpoint !== lastCheckpoint && !summit && race.started) worldAudio.checkpoint();
    lastLaps = me.laps;
    lastCheckpoint = me.checkpoint;
    if (race.drag) {
      // The tree, left lane first; the clock runs from the green; then the reaction time and the place.
      const byLane = [0, 0];
      race.drag.lamps.forEach((bits, i) => { byLane[race.drag.lane[i]] = bits; });
      dragTree.set(byLane, race.drag.lane[0]);
      hud.set([
        [t("Clock:"), formatRaceTime(me.finished && !me.dq ? me.raceTime : race.clock)],
        ["Reaction:", me.reaction === null ? "--.--" : me.reaction.toFixed(2)],
        ["", ""], [t("Place:"), `${me.place}/${race.trucks.length}`],
      ]);
      if (me.dq && !dragNoted) flash(me.dq === "red light" ? "Red light! Disqualified." : "Out of your lane! Disqualified.", now);
      else if (me.finished && !me.dq && !dragNoted) flash(`Elapsed time ${me.raceTime.toFixed(2)} s`, now);
      if (me.finished || me.dq) dragNoted = true;
      return;
    }
    if (summit) {
      // A Rumble: the score and the round's time left, then the place by score (6.3).
      hud.set([[t("Time Remaining:"), formatRaceTime(race.summit?.left ?? 0)], ["Score:", String(Math.round(me.score))], ["", ""], [t("Place:"), `${me.place}/${race.trucks.length}`]]);
      return;
    }
    hud.set([
      [t("Lap:"), formatRaceTime(me.lapTime)], [t("Best:"), formatRaceTime(me.best)], [t("Clock:"), formatRaceTime(race.clock)],
      ["", ""], [race.gap?.kind === "lead" ? t("Lead:") : t("Back:"), formatRaceTime(race.gap?.seconds ?? 0)],
      [t("Place:"), `${t("Lap:")} ${me.lap}/${race.laps}`, `${me.place}/${race.trucks.length}`],
    ]);
    if (me.missed && !wasMissed) flash("Missed checkpoint! Turn around.", now);
    wasMissed = me.missed;
    if (!finalLapShown && race.laps > 1 && me.lap === race.laps && race.started && !me.finished) {
      finalLapShown = true;
      flash("Final lap!", now);
    }
  };

  const finish = async () => {
    finishing = true;
    showMessage(t("Determining times for remaining trucks..."));
    const race = await sim.call("finish");
    if (disposed) return;
    context.lastReplay = recorder.build();
    const rows = race.trucks.map((t, i) => ({
      ...t, name: entrants[i].name, file: entrants[i].file, truckName: truckName(entrants[i].file), player: entrants[i].player,
    }));
    context.router.go("results", { track, laps, difficulty, rows, mode: track.raceType, truck: playerTruck }, { replace: true });
  };

  let frame = 0, last = performance.now(), busy = false, latest = null;
  const movedBoxes = new Set();
  const movedPositions = new Map();
  window.__openmtm2Race = { audio, scene, camera, renderer, sim, entrants, musicName, get latest() { return latest; } };
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
          if (r.race && r.time !== undefined) recorder.update(r.time, r.poses.map((p) => p.current), r.boxes ?? [], (i) => crash.code(i));
          if (r.boxes?.length) {
            moveObjects(world, r.boxes.map((b) => ({ sitIndex: b.sitIndex, matrix: toSceneMatrix(b.matrix, b.pos) })));
            for (const b of r.boxes) { movedBoxes.add(b.sitIndex); movedPositions.set(b.sitIndex, b.pos); }
          }
          // The race goes on after the player finishes: the RaceCam follows, and the results wait for the others (game/race-end.js).
          if (r.race) {
            const end = raceEnd.update(r.race);
            cameraTarget = end.target;
            if (end.justFinished) viewMode = 4;
            if (end.done && !finishing) finish();
          }
        })
        .catch((err) => { if (!disposed) showMessage(err.message); })
        .finally(() => { busy = false; });
    }
    if (latest) {
      const shown = latest.poses.map((p) => interpolatePose(p.previous, p.current, latest.alpha));
      shownPoses = shown;
      tireFx.update({
        dt: paused ? 0 : dt, listener: [camera.position.x, camera.position.y, -camera.position.z], flags: effectFlags(),
        noDust: weatherScene.weather === 4 || weatherScene.weather === 5,
        trucks: shown.map((p, i) => ({ object: drawn[i], pose: p, surface: latest.poses[i].sound ? { family: surfaceFamily(latest.poses[i].sound.surface), type: latest.poses[i].sound.surface } : null })),
      });
      helicopters?.update(shown.map((p) => p.heli ?? null), paused ? 0 : dt);
      lampClockMs += paused ? 0 : dt * 1000;
      const night = !!WEATHER_LOOK[weatherScene.weather]?.headlights;
      trackLights?.update(camera, night);
      shown.forEach((p, i) => drawn[i].update(p, camera, { lamps: lamps[i], clockMs: lampClockMs, night, cockpit: i === 0 && viewMode === 0 }));
      if (!latest.damageHandled) {
        latest.damageHandled = true;
        latest.poses.forEach((p, i) => {
          crash.contacts(i, p.damage, (zone, level) => drawn[i].dent(zone, level));
          if (p.touch) tireFx.touch(i, p.touch.pos, p.touch.steps, p.touch.force, p.current.speed ?? 0, effectFlags());
          for (const d of p.damage ?? []) tireFx.hit(i, drawn[i], d.zone, d.steps, d.force, p.current.speed ?? 0, effectFlags());
        });
      }
      const listener = [camera.position.x, camera.position.y, -camera.position.z];
      const raceNow = latest.race;
      const clock = raceNow ? (raceNow.started ? 3 + raceNow.clock : 3 - raceNow.countdown) : null;
      truckAudio.update(dt, latest.poses.map((p, i) => ({ ...p, current: shown[i] === undefined ? p.current : { ...p.current, pos: shown[i].pos } })), listener, clock, entrants.map((_, i) => crash.damaged(i)));
      worldAudio.update(dt, listener, movedPositions);
      {
        const now = performance.now() / 1000;
        if (raceNow && !paused && !finishing) {
          const events = watcher.update({
            now, race: raceNow,
            trucks: latest.poses.map((p, i) => ({ pos: shown[i].pos, up: p.current.matrix[4], sound: p.sound })),
          });
          if (commentaryOn && events.length) speakEvents(events, now);
        }
      }
      camera.getWorldDirection(forwardVector);
      audio.setListener(camera.position, forwardVector, camera.up);
      nameTags.update(camera, view.clientWidth, view.clientHeight, entrants.map((e, i) => nameLabel(namesMode, e, truckName)), shown.map((p) => p.pos), entrants.map((_, i) => i === 0 && viewMode === 0));
      weatherScene.update(dt, shown.map((p) => ({ x: p.pos[0], y: p.pos[1], z: p.pos[2], heading: p.euler[2] })));
      placeCamera(shown[cameraTarget] ?? shown[0], dt);
      // Your own truck is not drawn from inside it.
      drawn[0].setBodyHidden(viewMode === 0);
      const mine = latest.poses[0].current;
      gauges.setVisible(viewMode === 0 ? cockpitMode() === 1 : context.settings.dashboard !== false);
      gauges.set(mine);
      if (cockpit) {
        cockpit.setDashboard({ visible: viewMode === 0 && cockpitMode() === 0, speed: mine.speed, rpm: mine.rpm, gear: mine.gear, steer: mine.steer });
        const next = build.sim.checkpoints[latest.race?.trucks[0].checkpoint ?? 0];
        cockpit.setFinder({
          visible: context.settings.finder !== false && !!next && !summit,
          angle: next ? finderAngle(shown[0].pos, shown[0].euler[2], next.gate.position) : 90,
          number: (latest.race?.trucks[0].checkpoint ?? 0) + 1,
        });
      }
      if (minimap.visible) {
        minimap.set(shown.map((p, i) => ({ pos: p.pos, heading: p.euler[2], place: latest.race?.trucks[i]?.place ?? i + 1, label: nameLabel(namesMode, entrants[i], truckName) })), dt);
      }
      if (latest.race && !finishing) showRace(latest.race, now);
    }
    if (!paused) caption.update(dt);
    // The water bobs a quarter foot every eight seconds (frozen in Snow), and under it the world is fogged to 320 ft with no sky.
    if (blimp && !paused) {
      blimp.update(dt);
      blimpObject.position.set(blimp.state.pos[0], blimp.state.pos[1], -blimp.state.pos[2]);
      blimpObject.rotation.y = -blimp.state.heading;
      blimpObject.visible = viewMode !== 3;
      blimpHum?.then((v) => v?.setPosition(blimp.state.pos));
    }
    waterClock += dt;
    const water = world.getObjectByName("water");
    if (water) water.position.y = waterOffsetFt(waterClock, weatherScene.weather);
    waterSurface?.update(dt, weatherScene.weather);
    const under = isUnderwater(camera.position.y, water ? water.userData.levelFt + water.position.y : null, weatherScene.weather);
    weatherScene.setUnderwater(under);
    tireFx.setWater(water ? water.userData.levelFt + water.position.y : null);
    if (latest && shownPoses) {
      waterFx.update(dt, {
        trucks: shownPoses.map((p) => ({ pos: p.pos, yaw: p.euler[2] })),
        camera: [camera.position.x, camera.position.y, -camera.position.z],
        level: water ? water.userData.levelFt + water.position.y : null, weather: weatherScene.weather,
      });
    }
    const sky = world.getObjectByName("sky");
    if (sky) { sky.position.set(camera.position.x, 0, camera.position.z); sky.visible = !under; }
    updateTrackWorld(world, camera, dt);
    if (shadows) {
      shadows.setupMaterials();
      shadows.invalidateDynamic();
      shadows.update();
    }
    if (flare) flare.update(camera, sunTravel, true, weatherScene.weather <= 1, flareBlocked);
    renderer.render(scene, camera);
    renderMirror();
    flare?.render(renderer, camera);
    gold?.afterRender(dt, build.title ?? track.name);
  };
  frame = requestAnimationFrame(loop);
  gold = createGoldMode({
    window, sim, scene, camera, renderer, canvas, view, build, font: hudFont, scale, t, track, setWeather,
    getWeather: () => weatherScene.weather,
    flash: (text) => flash(text, performance.now()),
  });
  cleanups.push(() => gold.dispose());

  return { unmount };
}

/** What the sky shows besides the weather's art: the sun with its flare, the moon, or nothing. */
function celestialFor(weather) {
  return weather <= 1 ? "sun" : weather === 7 ? "moon" : "none";
}

/**
 * Turn on the sun's shadows: the cascades replace the plain sun light, the world's models and
 * the trucks cast, and everything lit receives. Only the middle copy of the wrapped world casts.
 */
function enableShadows({ renderer, scene, camera, world, sun, drawn }) {
  renderer.shadowMap.enabled = true;
  // Soft-edged shadows (PCFSoft), as JSTrackViewer's scene draws them with its cascades.
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  const tile = world.getObjectByName("tile");
  world.traverse((o) => {
    if (!o.isMesh || o.name === "sky") return;
    o.receiveShadow = true;
  });
  // Solid things cast, ground boxes among them; terrain and water do not, nor do blended (see-through) surfaces. A caster
  // is drawn into the shadow map on the same side it is drawn on, which keeps thin walls from leaking light.
  const casts = (o) => {
    const m = o.material;
    if (!m || (m.transparent && !(m.alphaTest > 0))) return false;
    m.shadowSide = m.side;
    return true;
  };
  tile?.traverse((o) => {
    if (o.isMesh && o.name !== "terrain" && o.name !== "water" && casts(o)) o.castShadow = true;
  });
  for (const truck of drawn) truck.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.shadowSide = o.material.side; } });
  // A facing object (type 8 and 9 billboards) turns to the camera, which would swing its shadow around with the
  // view. Its shadow comes from an invisible copy held square to the sun instead (updateTrackWorld keeps it there).
  world.userData.shadowFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(sun.position.x, sun.position.z));
  tile?.traverse((group) => {
    if (group.name !== "placedObject" || !group.userData.billboard) return;
    for (const mesh of [...group.children]) {
      if (!mesh.isMesh) continue;
      mesh.castShadow = false;
      const source = mesh.material;
      const proxy = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
        map: source.map ?? null, alphaTest: source.alphaTest ?? 0, transparent: !!source.transparent,
        side: THREE.DoubleSide, colorWrite: false, depthWrite: false,
      }));
      proxy.castShadow = true;
      proxy.userData.shadowProxy = true;
      group.add(proxy);
    }
  });
  const shadows = new SunShadows({ scene, camera, color: 0xffffff, intensity: sun.intensity, maxFar: 10240 });
  shadows.setDirection(sun.position.clone().negate());
  shadows.setEnabled(true);
  sun.visible = false;
  return shadows;
}

/** Whether the ground between a point and the horizon toward the sun hides the sun (scene frame in, game frame out). */
function sunBlocked(terrain, origin, direction) {
  for (let t = 16; t < 4000; t += 16 + t * 0.02) {
    const x = origin.x + direction.x * t, y = origin.y + direction.y * t, z = -(origin.z + direction.z * t);
    const wrap = (v) => ((v % 8192) + 8192) % 8192;
    if (y < mtm2Sim.groundHeightAt(terrain, wrap(x), wrap(z))) return true;
  }
  return false;
}
