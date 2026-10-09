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
import { COCKPIT_EYE, CAMERA_MODES, blimpCamera, createChaseCamera, createRaceCamera, fovFor, groundHeightFn, nextMode } from "../../game/cameras.js";
import { createAudio } from "../../audio/audio-engine.js";
import { VOICE_COMMENTARY_ENABLED, createCommentaryAudio } from "../../audio/commentary-audio.js";
import { createAnnouncer } from "../../game/commentary.js";
import { createCommentaryWatcher } from "../../game/commentary-events.js";
import { createTruckAudio } from "../../audio/truck-audio.js";
import { createWorldAudio } from "../../audio/world-audio.js";
import { createWeatherScene } from "../../render/weather-scene.js";
import { isUnderwater, resolveWeather, waterOffsetFt } from "../../game/weather.js";
import { createGoldMode } from "../gold-mode.js";
import { createGamepadInput } from "../../game/input/gamepad.js";
import { createTextPanel, loadFont } from "../../render/bitmap-text.js";
import { createRaceGauges } from "../../render/race-gauges.js";
import { createWaterEffects, createWaterSurface } from "../../render/water-effects.js";
import { createCaption } from "../../render/caption.js";
import { courseLoop, createCourseMap } from "../../render/minimap.js";
import { createCockpit, finderAngle } from "../../render/cockpit.js";
import { formatRaceTime, raceEntrants } from "../../game/race-setup.js";
import { createTrackWorld, disposeObject, moveObjects, setStartLights, skyColor, updateSky, updateTrackWorld } from "../../render/track-scene.js";
import { createTruckObject, interpolatePose } from "../../render/truck-object.js";
import { toSceneMatrix } from "../../shared/scene-frame.js";

/** The race HUD text is a light grey with a one-pixel black shadow (the game's own look). */
const HUD_GREY = "#cfcfcf";

export default async function mount(container, context, { track, laps, difficulty, opponents, truck: playerTruck, trucks: catalogTrucks, setup, weather: chosenWeather }) {
  const t = context.t;
  const weatherId = resolveWeather(chosenWeather ?? context.settings.weather ?? 0, track.weatherMask);
  const summit = track.raceType === "summit";
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
  const view = el("section", { class: "race-view" }, canvas, ...(cockpit ? [cockpit.dashboard, cockpit.mirror, cockpit.finder] : []), hud.element, gauges.element, caption.element, pauseMenu, loading);
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
  const minimap = createCourseMap(build.sim.course, { font: hudFont });
  minimap.setVisible(!!context.settings.minimap);
  view.append(minimap.element);
  const grid = build.sim.grid;
  const usable = catalogTrucks.filter((t) => build.truckModels[t.file]);
  const entrants = raceEntrants({ playerTruck, trucks: usable, slots: grid.length, opponents, playerName: driver.name });
  if (!grid.length || !build.truckModels[playerTruck]) {
    loadingText.textContent = `${track.name} has no start grid, or ${truckName(playerTruck)} could not be built.`;
    loading.append(el("button", { "data-menu-sound": "STARTOFF", onclick: () => context.router.back() }, "Back"));
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
  /** The way the sunlight travels, in the scene. */
  const sunTravel = sun.position.clone().negate();
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(sun, ambientLight);
  const world = createTrackWorld(build, look);
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
  const weatherScene = createWeatherScene({
    scene, camera, world, sun, ambient: ambientLight, skyAverage: background, look, art: effectsArt,
    onSun: (i) => shadows?.setIntensity(i), onLightning: () => worldAudio.thunder(),
  });
  weatherScene.set(weatherId);
  cleanups.push(() => weatherScene.dispose());
  /** GOLD mode's weather change: the grip, the sky, the fog and the light, at once. */
  const setWeather = async (next) => {
    await sim.call("command", { name: "weather", value: next });
    updateSky(world.getObjectByName("sky"), await context.assets.call("sky", { path: track.path, weather: next }), look);
    weatherScene.set(next);
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
    course: build.sim.course,
    sonicTrack: build.sim.sonicTrack,
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
        // The player's Garage setup; the CPU trucks keep the defaults.
        setup: e.player ? setup : undefined,
      };
    }),
    race: { checkpoints: build.sim.checkpoints, laps, mode: summit ? "summit" : "circuit" },
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
  const keyMap = mergeBindings(context.settings.bindings);
  const onKey = (e) => {
    if (keyMap.horn.includes(e.code) && !e.repeat) truckAudio.horn(0, latest?.poses[0].current.pos);
    if (keyMap.yeehaw.includes(e.code) && !e.repeat) truckAudio.yeehaw(0, latest?.poses[0].current.pos);
    if (keyMap.camera.includes(e.code) && !e.repeat) {
      viewMode = nextMode(viewMode, e.shiftKey);
      context.settings.view = viewMode;
      saveSettings(context.settings);
      // "Chase Far of Bear Foot": the view's name and the truck being watched (0x52d180).
      flash(`${t(CAMERA_MODES[viewMode].name)} of ${truckName(playerTruck)}`, performance.now(), 2);
    }
    if (keyMap.pause.includes(e.code)) setPaused(!paused);
    if (keyMap.dashboard.includes(e.code) && !e.repeat) {
      context.settings.dashboard = gauges.toggle();
      saveSettings(context.settings);
    }
    if (keyMap.names.includes(e.code) && !e.repeat) minimap.toggleNames();
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
  // Ice over the water in Snow, and the spray and ripples of wheels in water (render/water-effects.js).
  const waterFx = createWaterEffects({ scene, art: effectsArt, levelFt: build.waterLevelFt ?? null, ground });
  cleanups.push(() => waterFx.dispose());
  const waterSurface = createWaterSurface(world.getObjectByName("water"), effectsArt, look);
  cleanups.push(() => waterSurface?.dispose());
  const chase = createChaseCamera(), raceCam = createRaceCamera(courseLoop(build.sim.course));
  // The rear-view mirror (cockpit only): a second view looking back, drawn small and turned by half a circle.
  const mirrorWindow = cockpit?.mirrorRect;
  const mirrorTarget = mirrorWindow ? new THREE.WebGLRenderTarget(mirrorWindow[2] * 2, mirrorWindow[3] * 2) : null;
  const mirrorCamera = new THREE.PerspectiveCamera(40, mirrorWindow ? mirrorWindow[2] / mirrorWindow[3] : 1, 0.5, 20000);
  const mirrorPixels = mirrorTarget ? new Uint8Array(mirrorTarget.width * mirrorTarget.height * 4) : null;
  const flipBack = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  let mirrorTick = 0;
  const renderMirror = () => {
    if (!mirrorTarget) return;
    if (viewMode !== 0) { cockpit.setMirror(mirrorPixels, mirrorTarget.width, mirrorTarget.height, false); return; }
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
  let lastView = -1;
  const cockpitEye = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, scratchScale = new THREE.Vector3();
  // Switching views changes the camera at once, as the game does: only a chase camera's heading takes time to catch up (game/cameras.js).
  const placeCamera = (p, dt) => {
    if (viewMode !== lastView) {
      lastView = viewMode;
      raceCam.reset();
      if (!CAMERA_MODES[viewMode].dist) chase.reset();
      camera.fov = fovFor(viewMode);
      camera.updateProjectionMatrix();
    }
    placeCameraNow(p, dt);
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
      return;
    }
    const mode = viewMode;
    const view = mode === 3 ? blimpCamera(p.pos, yaw, ground) : mode === 4 ? raceCam.update(p.pos, ground) : chase.update(mode, p.pos, yaw, ground, dt);
    // Game feet to the scene: z is mirrored.
    camera.position.set(view.position[0], view.position[1], -view.position[2]);
    camera.lookAt(view.target[0], view.target[1], -view.target[2]);
  };

  const flash = (text, now, seconds = 3) => caption.show(text, seconds);
  let lastLaps = 0, lastCheckpoint = 0;
  let wasMissed = false, finalLapShown = false, lightsOn = null;
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
    const rows = race.trucks.map((t, i) => ({
      ...t, name: entrants[i].name, truckName: truckName(entrants[i].file), player: entrants[i].player,
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
          if (r.boxes?.length) {
            moveObjects(world, r.boxes.map((b) => ({ sitIndex: b.sitIndex, matrix: toSceneMatrix(b.matrix, b.pos) })));
            for (const b of r.boxes) { movedBoxes.add(b.sitIndex); movedPositions.set(b.sitIndex, b.pos); }
          }
          if (r.race?.trucks[0].finished && !finishing) finish();
        })
        .catch((err) => { if (!disposed) showMessage(err.message); })
        .finally(() => { busy = false; });
    }
    if (latest) {
      const shown = latest.poses.map((p) => interpolatePose(p.previous, p.current, latest.alpha));
      shownPoses = shown;
      shown.forEach((p, i) => drawn[i].update(p));
      const listener = [camera.position.x, camera.position.y, -camera.position.z];
      const raceNow = latest.race;
      const clock = raceNow ? (raceNow.started ? 3 + raceNow.clock : 3 - raceNow.countdown) : null;
      truckAudio.update(dt, latest.poses.map((p, i) => ({ ...p, current: shown[i] === undefined ? p.current : { ...p.current, pos: shown[i].pos } })), listener, clock);
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
      weatherScene.update(dt, shown.map((p) => ({ x: p.pos[0], y: p.pos[1], z: p.pos[2], heading: p.euler[2] })));
      placeCamera(shown[0], dt);
      // Your own truck is not drawn from inside it.
      drawn[0].object.visible = viewMode !== 0;
      const mine = latest.poses[0].current;
      gauges.setVisible(context.settings.dashboard !== false && viewMode !== 0);
      gauges.set(mine);
      if (cockpit) {
        cockpit.setDashboard({ visible: viewMode === 0, speed: mine.speed, rpm: mine.rpm, gear: mine.gear, steer: mine.steer });
        const next = build.sim.checkpoints[latest.race?.trucks[0].checkpoint ?? 0];
        cockpit.setFinder({
          visible: context.settings.finder !== false && !!next && !summit,
          angle: next ? finderAngle(shown[0].pos, shown[0].euler[2], next.gate.position) : 90,
          number: (latest.race?.trucks[0].checkpoint ?? 0) + 1,
        });
      }
      if (minimap.visible) {
        minimap.set(shown.map((p, i) => ({ pos: p.pos, heading: p.euler[2], place: latest.race?.trucks[i]?.place ?? i + 1, name: entrants[i]?.name })), dt);
      }
      if (latest.race && !finishing) showRace(latest.race, now);
    }
    if (!paused) caption.update(dt);
    // The water bobs a quarter foot every eight seconds (frozen in Snow), and under it the world is fogged to 320 ft with no sky.
    waterClock += dt;
    const water = world.getObjectByName("water");
    if (water) water.position.y = waterOffsetFt(waterClock, weatherScene.weather);
    waterSurface?.update(dt, weatherScene.weather);
    const under = isUnderwater(camera.position.y, water ? water.userData.levelFt + water.position.y : null, weatherScene.weather);
    weatherScene.setUnderwater(under);
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
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = true;
  const tile = world.getObjectByName("tile");
  world.traverse((o) => {
    if (!o.isMesh || o.name === "sky") return;
    o.receiveShadow = true;
  });
  tile?.traverse((o) => {
    if (o.isMesh && o.name !== "terrain" && o.name !== "groundBoxes" && o.name !== "water") o.castShadow = true;
    if (o.isInstancedMesh) o.castShadow = true;
  });
  for (const truck of drawn) truck.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
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
