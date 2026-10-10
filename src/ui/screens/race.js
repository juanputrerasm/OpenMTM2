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
import { WATERMARK } from "../../app/version.js";
import { createConsole } from "../console.js";
import { simGroundOfBuild, terrainOfBuild } from "../../shared/build-terrain.js";
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
import { COCKPIT_EYE, CAMERA_MODES, INERTIA_MODE, cameraMode, modeForShortcut, blimpCamera, blimpCameraNoCourse, courseCentroid, createChaseCamera, fovFor, groundHeightFn, nextMode, raceCamera, zoomToFov } from "../../game/cameras.js";
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
import { WEATHER_LOOK, WEATHER_NAMES, isUnderwater, resolveWeather, waterOffsetFt } from "../../game/weather.js";
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

const DEMO_CAPTION = "Demo mode. Press any key to begin", DEMO_CAMERA_S = 8;
/** How much of the race the pause menu's instant replay shows. */
const INSTANT_REPLAY_S = 60;

/** A terrain cell's side: the draw distance is set in cells. */
const TERRAIN_CELL_FT = 32;

/**
 * The loading screen's report: what went wrong (a track that cannot be loaded) or what is missing (files the track
 * names that no archive has). Close goes back to the Races screen; when the race can still run, Race anyway goes on.
 * Resolves true to go on.
 */
function loadReport(container, context, track, { heading, lines, fatal }) {
  return new Promise((resolve) => {
    const shown = lines.slice(0, 14);
    const dialog = el("dialog", { class: "load-report", "aria-label": heading },
      el("h1", {}, heading),
      el("p", { class: "muted" }, track?.name ?? ""),
      el("ul", {}, ...shown.map((line) => el("li", {}, line)), ...(lines.length > shown.length ? [el("li", {}, `and ${lines.length - shown.length} more`)] : [])),
      el("div", { class: "screen-actions" },
        ...(fatal ? [] : [el("button", { onclick: () => { dialog.close("go"); } }, "Race anyway")]),
        el("button", { class: "primary", onclick: () => dialog.close("close") }, "Close")));
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (dialog.returnValue === "go") { resolve(true); return; }
      resolve(false);
      context.router.go("race-select", { mode: track?.raceType }, { replace: true });
    }, { once: true });
    container.append(dialog);
    dialog.showModal();
  });
}

export default async function mount(container, context, params) {
  try {
    return await mountRace(container, context, params);
  } catch (error) {
    console.error(error);
    container.replaceChildren();
    await loadReport(container, context, params.track, { heading: "This track could not be loaded", lines: [String(error?.message ?? error)], fatal: true });
    return {};
  }
}

async function mountRace(container, context, params) {
  const { track, laps, difficulty, truck: playerTruck, trucks: catalogTrucks, setup, weather: chosenWeather } = params;
  /** Free roam: the track with no race on it (no checkpoints, laps, places or results) and the player alone. */
  const freeRoam = !!params.freeRoam && !params.demo;
  const opponents = freeRoam ? [] : params.opponents;
  /** Monster Demo: every truck drives itself, the RaceCam moves from truck to truck, and any key goes back to the start screen. */
  const demo = !!params.demo;
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
  hud.element.hidden = context.settings.timingHud === false;
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
  // Every cleanup runs, whatever another one throws (a skipped one leaves the track's music and the simulation running
  // under the menus); and what is set up after the screen was left is released at once.
  const release = (f) => { try { f(); } catch (error) { console.error(error); } };
  cleanups.push = (...fns) => {
    if (disposed) { fns.forEach(release); return cleanups.length; }
    return Array.prototype.push.apply(cleanups, fns);
  };
  const unmount = () => {
    if (disposed) return;
    disposed = true;
    for (const f of cleanups.splice(0).reverse()) release(f);
  };

  // The loading screen art, scaled to the window.
  context.assets.call("loadingScreen", { raceType: track.raceType }).then((image) => {
    if (!image || disposed) return;
    const art = el("canvas", { class: "race-loading-art", width: image.width, height: image.height });
    art.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.rgba.buffer ?? image.rgba), image.width, image.height), 0, 0);
    loading.prepend(art);
  }).catch(() => {});

  const truckName = (file) => catalogTrucks.find((t) => t.file === file)?.name ?? file;
  const mtm1Options = { sky: context.settings.mtm1EarthSky !== false, overlap: !!context.settings.mtm1TerrainOverlap };
  const build = await context.assets.call("trackRender", {
    path: track.path, scope: track.scope, detailLevel: context.settings.detailLevel, raceType: track.raceType,
    truckFiles: catalogTrucks.map((t) => t.file), weather: weatherId, mtm1: mtm1Options, tileOverlap: params.tileOverlap,
  });
  if (disposed) return { unmount };
  if (build.problems?.length && !demo) {
    const go = await loadReport(view, context, track, { heading: "Files this track names are missing", lines: build.problems, fatal: false });
    if (!go || disposed) return { unmount };
  }
  const driver = currentDriver(await getProfiles(context));
  // The course map (Map key), from the SIT's primary course.
  // Professional puts every truck on course 2 when the SIT has one (MONSTER_EXE_ANALYSIS.md 9); the map still draws course 1.
  const raceCourse = Number(difficulty) === 2 && build.sim.proCourse ? build.sim.proCourse : build.sim.course;
  const minimap = createCourseMap(build.sim.course, { font: hudFont, open: !!build.sim.courseOpen });
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
  const drawDistance = Math.max(16, Math.min(256, context.settings.drawCells ?? 128)) * TERRAIN_CELL_FT;
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
  const world = createTrackWorld(build, look, {
    backdrops: !!context.settings.backdrops, drawDistance,
    terrainDetail: context.settings.terrainDetail !== false, reflections: context.settings.reflections !== false,
  });
  scene.add(world);
  // Sound: the engines, skids and impacts of every truck, and the world's ambience and music.
  context.menuMusic?.stop();
  // Reuse the already unlocked menu context. A newly created context after the asynchronous
  // track load can be blocked by autoplay policy even though GO was clicked.
  const audio = context.menuAudio ?? createAudio(context.assets, context.settings.sound);
  const ownsAudio = !context.menuAudio;
  const ambience = await context.assets.call("ambience", { number: track.ambientSound ?? 0 }).catch(() => null);
  // Started whatever the music's level, which alone makes it heard: the console's `music 1` then needs no restart.
  const musicName = build.musicName ?? null;
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
  // The mixer is the menus' too: a race left while paused (End race, Restart race) must not leave it silenced.
  audio.setEffectsPaused?.(false);
  cleanups.push(() => {
    audio.setEffectsPaused?.(false);
    commentary.dispose();
    window.removeEventListener("keydown", resumeAudio);
    window.removeEventListener("pointerdown", resumeAudio);
    worldAudio.dispose();
    truckAudio.dispose();
    if (ownsAudio) audio.dispose();
    context.menuMusic?.start();
  });
  const forwardVector = new THREE.Vector3();
  const terrain = terrainOfBuild(build);
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
    updateSky(world.getObjectByName("sky"), await context.assets.call("sky", { path: track.path, scope: track.scope, weather: next, mtm1: mtm1Options }), look);
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
      flareBlocked = (origin, direction) => sunBlocked(terrain, origin, direction, !build.noWrap);
    }
    cleanups.push(() => { shadows?.dispose?.(); flare?.dispose(); });
  }

  const sim = new WorkerClient(new URL("../../worker/sim-worker.js", import.meta.url));
  cleanups.push(() => sim.terminate());
  const init = {
    ...simGroundOfBuild(build),
    startOnNearestSegment: !!build.sim.startOnNearestSegment,
    opponentFps: context.settings.opponentFps ?? 30,
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
        autopilot: !e.player || !!context.settings.fullAutopilot || demo,
        // A drag strip's grid slot is the lane.
        lane: e.slot,
        // The player's Garage setup; the CPU trucks keep the defaults.
        setup: e.player ? setup : undefined,
      };
    }),
    race: freeRoam ? null : { checkpoints: build.sim.checkpoints, laps: dragRace ? 1 : laps, mode: summit ? "summit" : dragRace ? "drag" : "circuit" },
  };
  await sim.call("init", init);
  if (disposed) return { unmount };
  loading.hidden = true;

  const keys = createKeyboardInput(window, context.settings.bindings);
  const pad = createGamepadInput();
  cleanups.push(() => keys.dispose());
  let gold = null, gameConsole = null;
  const sampleInput = () => {
    const held = keys.sample();
    const driving = held.accelerate || held.brake || held.left || held.right;
    return { ...held, joystick: driving ? null : pad.sample(), slew: gold?.slewing ? gold.slewInput() : null };
  };

  // The Inertia view (the Z-mode cameras option) comes after the game's ten.
  const zCameras = () => !!context.settings.zModeCameras;
  let viewMode = demo ? 4 : (zCameras() ? cameraMode(context.settings.view) : CAMERA_MODES[context.settings.view])?.id ?? 1, paused = false, finishing = false;
  // Each truck's lamp switch (game/truck-lights.js) and the clock the blinking lamps and beacons run on.
  const lamps = entrants.map(() => lampsAtStart(WEATHER_LOOK[weatherId]?.headlights));
  let lampClockMs = 0;
  const setPaused = async (on) => {
    if (finishing || paused === on) return;
    paused = on;
    pauseMenu.hidden = !on;
    // Every sound stops but the music.
    audio.setEffectsPaused?.(on);
    if (!on) await sim.call("resume");
  };
  pauseMenu.append(
    el("p", { class: "race-pause-title" }, t("Pause")),
    el("button", { class: "primary", onclick: () => setPaused(false) }, "Resume"),
    el("button", { "data-menu-sound": "STARTOFF", onclick: () => context.router.go("race", params, { replace: true }) }, "Restart race"),
    el("button", { onclick: () => showInstantReplay() }, "Instant replay"),
    // The console, for a keyboard whose key for it is hard to find; the race stays paused under it.
    el("button", { hidden: demo, onclick: () => gameConsole?.setOpen(true) }, "Console"),
    el("button", { onclick: async () => {
      const { openOptionsModal } = await import("./options.js");
      await openOptionsModal(context);
      // The sound sliders take effect at once; the rest applies to the next race.
      context.optionsDialog?.addEventListener("close", () => audio.setVolumes(context.settings.sound), { once: true });
    } }, "Options"),
    el("button", {
      "data-menu-sound": "STARTOFF",
      onclick: () => context.router.go("race-select", { mode: track.raceType }, { replace: true }),
    }, "End race"),
  );
  /**
   * The pause menu's instant replay: the last minute of the race, played over the paused race in the replay screen's own
   * scene. Its Back returns to the pause menu, the race as it was.
   */
  let replaying = null;
  async function showInstantReplay() {
    if (replaying) return;
    const replay = recorder.build({ lastSeconds: INSTANT_REPLAY_S });
    const overlay = el("div", { class: "race-replay-overlay" });
    view.append(overlay);
    const close = () => {
      replaying?.screen?.unmount?.();
      replaying = null;
      overlay.remove();
    };
    replaying = { screen: null };
    const { default: mountReplay } = await import("./replay.js");
    const inner = Object.create(context);
    inner.router = { back: close, go: (...args) => { close(); return context.router.go(...args); }, stack: context.router.stack };
    const screen = await mountReplay(overlay, inner, { replay });
    if (replaying) replaying.screen = screen; else screen?.unmount?.();
  }
  cleanups.push(() => replaying?.screen?.unmount?.());
  /** The cockpit view's G state (0 the cockpit, 1 no cockpit with the gauges, 2 neither). */
  const cockpitMode = () => context.settings.cockpitMode ?? 0;
  const keyMap = mergeBindings(context.settings.bindings);
  const onKey = (e) => {
    // The Options dialog and the instant replay take the keys while they are up.
    if (replaying || context.optionsDialog?.isConnected) return;
    if (demo) { leaveDemo(); return; }
    if (keyMap.horn.includes(e.code) && !e.repeat) truckAudio.horn(0, latest?.poses[0].current.pos);
    if (keyMap.yeehaw.includes(e.code) && !e.repeat) truckAudio.yeehaw(0, latest?.poses[0].current.pos);
    const shortcut = modeForShortcut(e);
    if (shortcut !== null) e.preventDefault();
    if ((keyMap.camera.includes(e.code) || shortcut !== null) && !e.repeat) {
      // The short cycle (Options, Game): the cockpit, Chase Near and Chase Far, which are the first three views.
      const views = context.settings.shortViewCycle ? 3 : zCameras() ? INERTIA_MODE.id + 1 : CAMERA_MODES.length;
      viewMode = shortcut ?? nextMode(viewMode, e.shiftKey, views);
      context.settings.view = viewMode;
      saveSettings(context.settings);
      // "Chase Far of Bear Foot": the view's name and the truck being watched (0x52d180).
      flash(`${t(cameraMode(viewMode).name)} of ${truckName(playerTruck)}`, performance.now(), 2);
    }
    if (keyMap.pause.includes(e.code)) setPaused(!paused);
    if (keyMap.dashboard.includes(e.code) && !e.repeat) {
      // In the cockpit the key goes round three states: the cockpit; no cockpit with the gauges of the other views; no cockpit and no gauges.
      if (viewMode === 0) context.settings.cockpitMode = (cockpitMode() + 1) % 3;
      else context.settings.dashboard = gauges.toggle();
      saveSettings(context.settings);
    }
    if (keyMap.names.includes(e.code) && !e.repeat) namesMode = nextNamesMode(namesMode);
    // The Timing display key (O) hides the times, laps and place, in every view.
    if (keyMap.hud.includes(e.code) && !e.repeat) {
      context.settings.timingHud = context.settings.timingHud === false;
      hud.element.hidden = context.settings.timingHud === false;
      saveSettings(context.settings);
    }
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
      if (!cameraMode(viewMode).dist) chase.reset();
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
    // Z mode's orbit swings the chase views; the Inertia view follows the watched truck's speed.
    const view = special ?? chase.update(mode, p.pos, yaw, ground, dt, {
      turn: gold?.cameraTurn ?? 0, speedFt: latest?.poses[cameraTarget]?.current.speed ?? latest?.poses[0]?.current.speed ?? 0,
    });
    // Game feet to the scene: z is mirrored.
    camera.position.set(view.position[0], view.position[1], -view.position[2]);
    camera.lookAt(view.target[0], view.target[1], -view.target[2]);
    return special ? special.zoom : view.zoom ?? null;
  };

  // The demo keeps its own caption up.
  const flash = (text, now, seconds = 3) => { if (!demo) caption.show(text, seconds); };
  // A function declaration: the key handler above may call it before this line runs.
  function leaveDemo() { if (!leaveDemo.done) { leaveDemo.done = true; context.router.go("start", {}, { replace: true }); } }
  if (demo) {
    showMessage(DEMO_CAPTION);
    window.addEventListener("pointerdown", leaveDemo);
    cleanups.push(() => window.removeEventListener("pointerdown", leaveDemo));
  }
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
    context.router.go("results", { track, laps: race.laps ?? laps, difficulty, rows, mode: track.raceType, truck: playerTruck }, { replace: true });
  };

  let frame = 0, last = performance.now(), busy = false, latest = null;
  let drawnCells = drawDistance / TERRAIN_CELL_FT;
  const movedBoxes = new Set();
  const movedPositions = new Map();
  window.__openmtm2Race = { audio, scene, camera, renderer, sim, entrants, musicName, get latest() { return latest; } };
  let frameTimer = 0;
  cleanups.push(() => { cancelAnimationFrame(frame); clearTimeout(frameTimer); delete window.__openmtm2Race; });
  // V-sync (Options, Display): with the display's refresh, or as fast as the browser's timer runs (about 250 a second).
  // A browser shows no more frames than the display has, so without it the extra frames are only simulated and drawn.
  const nextFrame = () => {
    if (context.settings.vsync === false) frameTimer = setTimeout(() => loop(performance.now()), 0);
    else frame = requestAnimationFrame(loop);
  };
  const loop = (now) => {
    nextFrame();
    // The frame rate limit: a frame that comes too soon is left out (a millisecond of slack for the timer's jitter).
    if (context.settings.fpsLimit && now - last < 1000 / Math.max(10, context.settings.fpsLimitValue ?? 60) - 1) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (replaying) return;
    // The draw distance follows the Options at once (Apply in the pause menu's dialog).
    const cells = Math.max(16, Math.min(256, context.settings.drawCells ?? 128));
    if (cells !== drawnCells) {
      drawnCells = cells;
      const feet = cells * TERRAIN_CELL_FT;
      camera.far = mirrorCamera.far = feet;
      camera.updateProjectionMatrix();
      mirrorCamera.updateProjectionMatrix();
      weatherScene.setDrawDistance(feet);
      const dome = world.getObjectByName("sky");
      if (dome?.userData.radius) dome.scale.setScalar(Math.min(6000, feet * 0.95) / dome.userData.radius);
    }
    if (!busy && !paused && !finishing) {
      busy = true;
      sim.call("tick", { tMs: now, input: sampleInput() })
        .then((r) => {
          latest = r;
          if ((r.race || freeRoam) && r.time !== undefined) recorder.update(r.time, r.poses.map((p) => p.current), r.boxes ?? [], (i) => crash.code(i));
          if (r.boxes?.length) {
            moveObjects(world, r.boxes.map((b) => ({ sitIndex: b.sitIndex, matrix: toSceneMatrix(b.matrix, b.pos) })));
            for (const b of r.boxes) { movedBoxes.add(b.sitIndex); movedPositions.set(b.sitIndex, b.pos); }
          }
          // The race goes on after the player finishes: the RaceCam follows, and the results wait for the others (game/race-end.js).
          if (r.race) {
            const end = raceEnd.update(r.race);
            if (demo) {
              // The RaceCam moves on to the next truck every few seconds; when the race is over the demo starts again.
              cameraTarget = Math.floor(r.time / DEMO_CAMERA_S) % r.race.trucks.length;
              if (end.done && !leaveDemo.done) { leaveDemo.done = true; context.router.go("race", params, { replace: true }); }
            } else {
              cameraTarget = end.target;
              if (end.justFinished) viewMode = 4;
              if (end.done && !finishing) finish();
            }
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
          visible: context.settings.finder !== false && !!next && !summit && !freeRoam,
          angle: next ? finderAngle(shown[0].pos, shown[0].euler[2], next.gate.position) : 90,
          number: (latest.race?.trucks[0].checkpoint ?? 0) + 1,
        });
      }
      if (minimap.visible) {
        minimap.set(shown.map((p, i) => ({ pos: p.pos, heading: p.euler[2], place: latest.race?.trucks[i]?.place ?? i + 1, label: nameLabel(namesMode, entrants[i], truckName) })), dt);
      }
      if (latest.race && !finishing) showRace(latest.race, now);
      // Free roam has only the clock.
      else if (freeRoam && !latest.race) hud.set([[t("Clock:"), formatRaceTime(latest.time ?? 0)]]);
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
    if (sky) { sky.position.set(camera.position.x, 0, camera.position.z); sky.visible = weatherScene.skyShown; }
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
  nextFrame();
  gold = createGoldMode({
    window, sim, scene, camera, renderer, canvas, view, build, font: hudFont, scale, t, track, setWeather,
    getWeather: () => weatherScene.weather,
    flash: (text) => flash(text, performance.now()),
    zCameras,
    // Ctrl+L (Z mode): another track by its SIT's name, with the same trucks and settings.
    loadSit: async () => {
      const name = window.prompt("Load a track by its .SIT name:", track.file);
      if (!name) return;
      const said = await loadTrackByName(name);
      if (said) flash(said, performance.now());
    },
  });
  cleanups.push(() => gold.dispose());

  /** Another track by its SIT's name (or its title), with the same trucks and settings. Returns what went wrong, or null. */
  async function loadTrackByName(name) {
    const wanted = name.trim().toUpperCase().replace(/\.SI[T2]$/, "");
    const catalog = await context.assets.call("catalog").catch(() => ({ tracks: [] }));
    const stem = (item) => item.file.toUpperCase().replace(/\.SI[T2]$/, "");
    const next = catalog.tracks.find((item) => stem(item) === wanted) ?? catalog.tracks.find((item) => item.name.toUpperCase() === wanted)
      ?? catalog.tracks.find((item) => item.name.toUpperCase().includes(wanted));
    if (!next) return `No track named ${wanted}.`;
    context.router.go("race", { ...params, track: next, mode: next.raceType, laps: next.defaultLaps, freeRoam: !!params.freeRoam || !!next.freeRoamOnly }, { replace: true });
    return null;
  }

  // The console (ui/console.js, the backquote key). What changes who races or where starts the race again with it.
  if (!demo) {
    const restart = (changes) => { context.router.go("race", { ...params, ...changes }, { replace: true }); };
    const bare = (file) => file.toUpperCase().replace(/\.TRK$/, "");
    const findTruck = (text) => {
      const w = bare(text.trim());
      return catalogTrucks.find((item) => bare(item.file) === w) ?? catalogTrucks.find((item) => item.name.toUpperCase() === w)
        ?? catalogTrucks.find((item) => item.name.toUpperCase().includes(w));
    };
    const truckNames = () => catalogTrucks.map((item) => bare(item.file).toLowerCase());
    const bots = () => entrants.filter((e) => !e.player);
    const onOff = (word) => (/^(1|on)$/i.test(word ?? "") ? true : /^(0|off)$/i.test(word ?? "") ? false : null);
    const said = (on) => (on ? "on" : "off");
    const weatherNow = () => weatherScene.weather ?? weatherId;
    /** The lines the console opens with, and `info`'s first ones. */
    const summary = () => {
      const pos = latest?.poses[0]?.current.pos ?? [0, 0, 0];
      const me = latest?.race?.trucks[0];
      const lap = freeRoam || !latest?.race ? "free roam" : summit ? "Rumble" : `Lap ${me?.lap ?? 1}/${latest.race.laps}`;
      return [
        `Track: ${track.name} (${track.file}), Truck: ${truckName(playerTruck)} (${playerTruck})`,
        `Position X:${Math.round(pos[0])} Y:${Math.round(pos[1])} Z:${Math.round(pos[2])}, ${lap}, Weather: ${t(WEATHER_NAMES[weatherNow()])}, Backdrop: ${said(!!context.settings.backdrops)}, Bots: ${bots().length}`,
      ].join("\n");
    };
    const SKILLS = ["rookie", "intermediate", "professional", "sonic"];
    const weatherNames = WEATHER_NAMES.map((n) => n.toLowerCase().replace(/\s+/g, ""));
    const commands = {
      info: {
        help: "the track, the truck and the simulation, as they are now",
        run: () => {
          const now = latest?.poses[0]?.current, me = latest?.race?.trucks[0];
          const sound = context.settings.sound ?? {};
          return [
            WATERMARK, summary(),
            `Game: ${build.game ?? track.game ?? "MTM2"}, Type: ${track.typeLabel ?? track.raceType}, Skill: ${SKILLS[Math.min(2, Number(difficulty))]}${Number(difficulty) === 2 && context.settings.sonicTrucks ? " (sonic)" : ""}, Look: ${look}`,
            `Speed: ${Math.round((now?.speed ?? 0) * 0.6818)} mph, Gear: ${now?.gear ?? "-"}, RPM: ${Math.round(now?.rpm ?? 0)}, Heading: ${Math.round((((shownPoses?.[0]?.euler[2] ?? 0) * 180) / Math.PI + 360) % 360)} deg`,
            `Clock: ${formatRaceTime(latest?.race?.clock ?? latest?.time ?? 0)}, Place: ${me ? `${me.place}/${latest.race.trucks.length}` : "-"}, Checkpoint: ${me ? `${me.checkpoint + 1}/${build.sim.checkpoints.length}` : "-"}`,
            `Overlap: ${said(build.tileOverlap !== false)}, Music: ${said((sound.music ?? 0.8) > 0)}, Sound: ${said(!sound.muted)}, Trucks: ${entrants.length}, Objects: ${build.objects?.length ?? 0}`,
          ].join("\n");
        },
      },
      bots: {
        help: "lists the computer opponents: number, driver, truck",
        run: () => (bots().length ? bots().map((e, i) => `${i + 1}  ${e.name.padEnd(10)} ${truckName(e.file)} (${e.file})`).join("\n") : "There are no computer opponents."),
      },
      backdrop: {
        usage: "backdrop <0|1>", help: "the track's backdrop models on or off (restarts the race)",
        run: ([word]) => {
          const on = onOff(word);
          if (on === null) return `Usage: backdrop <0|1>. Now ${said(!!context.settings.backdrops)}.`;
          context.settings.backdrops = on;
          saveSettings(context.settings);
          restart({});
          return `Backdrop ${said(on)}.`;
        },
      },
      overlap: {
        usage: "overlap <0|1>", help: "the ground tiles' two-pixel overlap on or off, for this race (restarts it)",
        run: ([word]) => {
          const on = onOff(word);
          if (on === null) return `Usage: overlap <0|1>. Now ${said(build.tileOverlap !== false)}.`;
          restart({ tileOverlap: on });
          return `Overlap ${said(on)}.`;
        },
      },
      music: {
        usage: "music <0|1>", help: "the music on or off",
        run: ([word]) => {
          const on = onOff(word);
          const sound = context.settings.sound ?? {};
          if (on === null) return `Usage: music <0|1>. Now ${said((sound.music ?? 0.8) > 0)}.`;
          if (!on && (sound.music ?? 0.8) > 0) context.musicLevelBefore = sound.music ?? 0.8;
          context.settings.sound = { ...sound, music: on ? ((sound.music ?? 0) > 0 ? sound.music : context.musicLevelBefore ?? 0.8) : 0 };
          saveSettings(context.settings);
          audio.setVolumes(context.settings.sound);
          return `Music ${said(on)}.`;
        },
      },
      sound: {
        usage: "sound <0|1>", help: "all sound on or off",
        run: ([word]) => {
          const on = onOff(word);
          if (on === null) return `Usage: sound <0|1>. Now ${said(!context.settings.sound?.muted)}.`;
          context.settings.sound = { ...context.settings.sound, muted: !on };
          saveSettings(context.settings);
          audio.setVolumes(context.settings.sound);
          return `Sound ${said(on)}.`;
        },
      },
      addbot: {
        usage: "addbot [truck]", help: "adds a computer opponent (restarts the race)", complete: truckNames,
        run: (args, rest) => {
          if (freeRoam) return "Free roam has no opponents (freeroam 0 first).";
          if (entrants.length >= Math.min(8, grid.length)) return "The grid is full.";
          const racing = new Set(entrants.map((e) => e.file));
          const pick = rest ? findTruck(rest) : usable.find((item) => !racing.has(item.file)) ?? usable[0];
          if (!pick) return `No truck named ${rest}.`;
          if (racing.has(pick.file)) return `${pick.name} is already racing.`;
          restart({ opponents: [...bots().map((e) => e.file), pick.file] });
          return `Adding ${pick.name}.`;
        },
      },
      kickbot: {
        usage: "kickbot [n|name]", help: "removes a computer opponent by its number in `bots` or its name, the last one by default (restarts the race)",
        complete: () => bots().map((e) => e.name.toLowerCase()),
        run: (args, rest) => {
          const list = bots();
          if (!list.length) return "There are no computer opponents.";
          const w = rest.trim().toUpperCase();
          const out = /^\d+$/.test(w) ? list[Number(w) - 1]
            : w ? list.find((e) => e.name.toUpperCase() === w || bare(e.file) === bare(w) || truckName(e.file).toUpperCase().includes(w)) : list[list.length - 1];
          if (!out) return `No opponent named ${rest}.`;
          restart({ opponents: list.filter((e) => e !== out).map((e) => e.file) });
          return `Removing ${out.name}.`;
        },
      },
      laps: {
        usage: "laps <n>", help: "sets the race's laps, from now on",
        run: async ([n]) => {
          const value = Math.trunc(Number(n));
          if (!(value >= 1)) return "Usage: laps <n>";
          const set = await sim.call("command", { name: "laps", value });
          return set ? `${set} laps.` : "This race has no laps.";
        },
      },
      finish: {
        help: "ends the race now: the times of the trucks still racing are worked out",
        run: () => { if (freeRoam) return "Free roam has no race to finish."; if (finishing) return "The race is finishing."; finish(); return "Finishing."; },
      },
      map: {
        usage: "map <sit>", help: "changes the track, by its SIT's name or its title",
        complete: async () => ((await context.assets.call("catalog").catch(() => ({ tracks: [] }))).tracks.map((item) => item.file.replace(/\.SI[T2]$/i, "").toLowerCase())),
        run: async (args, rest) => (rest ? (await loadTrackByName(rest)) ?? `Loading ${rest}.` : `Usage: map <sit>. Now on ${track.file}.`),
      },
      weather: {
        usage: "weather <n|name>", help: `changes the weather: ${weatherNames.map((n, i) => `${i} ${n}`).join(", ")}`, complete: () => weatherNames,
        run: async ([name]) => {
          const index = /^\d+$/.test(name ?? "") ? Number(name) : weatherNames.findIndex((n) => n.startsWith((name ?? "").toLowerCase()));
          if (!name || index < 0 || index >= WEATHER_NAMES.length) return `Usage: weather <0-${WEATHER_NAMES.length - 1}|${weatherNames.join("|")}>. Now ${weatherNow()} ${weatherNames[weatherNow()]}.`;
          await setWeather(index);
          return `Weather: ${t(WEATHER_NAMES[index])}.`;
        },
      },
      skill: {
        usage: "skill <n|level>", help: `the opponents' difficulty: ${SKILLS.map((n, i) => `${i} ${n}`).join(", ")} (restarts the race)`, complete: () => SKILLS,
        run: ([name]) => {
          const index = /^[0-3]$/.test(name ?? "") ? Number(name) : SKILLS.findIndex((n) => n.startsWith((name ?? "").toLowerCase()));
          if (!name || index < 0) return `Usage: skill <0-3|${SKILLS.join("|")}>`;
          // Sonic is Professional with the computer trucks driving as on a Sonic track (Options, Game).
          if (index >= 2) { context.settings.sonicTrucks = index === 3; saveSettings(context.settings); }
          restart({ difficulty: Math.min(2, index) });
          return `Skill: ${SKILLS[index]}.`;
        },
      },
      truck: {
        usage: "truck <name>", help: "changes your truck (restarts the race)", complete: truckNames,
        run: (args, rest) => {
          const pick = rest ? findTruck(rest) : null;
          if (!pick) return rest ? `No truck named ${rest}.` : `Usage: truck <name>. Now in ${truckName(playerTruck)}.`;
          restart({ truck: pick.file, opponents: bots().map((e) => e.file).filter((file) => file !== pick.file) });
          return `Truck: ${pick.name}.`;
        },
      },
      freeroam: {
        usage: "freeroam <0|1>", help: "free roam on or off (restarts the race)",
        run: ([on]) => {
          if (on !== "0" && on !== "1") return `Usage: freeroam <0|1>. Now ${freeRoam ? 1 : 0}.`;
          if (on === "0" && track.freeRoamOnly) return "This track has no checkpoints: free roam only.";
          restart({ freeRoam: on === "1" });
          return `Free roam ${on === "1" ? "on" : "off"}.`;
        },
      },
      exit: { help: "closes the console", run: () => { gameConsole?.setOpen(false); } },
      restart: { help: "starts the race again", run: () => { restart({}); } },
      quit: { help: "leaves the race for the Races screen", run: () => { context.router.go("race-select", { mode: track.raceType }, { replace: true }); } },
    };
    context.consoleHistory ??= [];
    gameConsole = createConsole({
      parent: view, window, commands, history: context.consoleHistory,
      banner: () => `${WATERMARK}\n${summary()}\nType help for commands`,
    });
    cleanups.push(() => gameConsole.dispose());
  }

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
    if (o.isMesh && o.name !== "terrain" && o.name !== "water" && o.name !== "road" && casts(o)) o.castShadow = true;
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
function sunBlocked(terrain, origin, direction, wraps = true) {
  // As far as the far corner of the world: a mountain across the map hides the sun too.
  for (let t = 16; t < 12000; t += 16 + t * 0.02) {
    const x = origin.x + direction.x * t, y = origin.y + direction.y * t, z = -(origin.z + direction.z * t);
    // A level drawn once has nothing past its edges.
    if (!wraps && (x < 0 || x >= 8192 || z < 0 || z >= 8192)) return false;
    const wrap = (v) => ((v % 8192) + 8192) % 8192;
    if (y < mtm2Sim.groundHeightAt(terrain, wrap(x), wrap(z))) return true;
  }
  return false;
}
