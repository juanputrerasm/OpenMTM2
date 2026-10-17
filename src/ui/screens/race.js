/*
  The race (M7): the player's truck against the CPU trucks on a Circuit track.

  While the track builds, the loading screen (`ART\DATA480.RAW`) shows. The simulation runs in
  its own worker at a fixed 1/60 s; this screen sends the keys each frame and draws every truck
  between its last two simulated states. The HUD follows the game's (MONSTER_EXE_ANALYSIS.md
  11): lap time, best lap and clock, then place and lap. Through the 3 s countdown (6.1) every
  truck sits in Park and the start gantry's red lamps glow; at the start the green ones light. When the player finishes, the trucks still racing are fast-simulated
  ("Determining times for remaining trucks", section 5) and the results follow.

  Keys: arrows or WASD drive, Q / Z shift, H helicopter, Space horn, V camera, Esc or P pause.

  In a headset (docs/VR.md) the same race is drawn around the player: the camera key cycles the
  cab and chase views, C recentres, the HUD hangs from the seat as boards (render/xr/vr-hud.js),
  the pause menu is a board too, and the controllers drive (game/vr/controls.js). The renderer
  is the app's one shared renderer, so a headset session carries over from race to race.
*/
import { createMtm1Particles } from "../../render/mtm1-particles.js";
import { createTruckReflections } from "../../render/truck-reflection.js";
import { createWaterMirror } from "../../render/water-mirror.js";
import { dustLevel, sparkLevel } from "../../game/tire-effects.js";
import { WATERMARK } from "../../app/version.js";
import { TREX } from "../../game/cheats.js";
import { moveToEvent, runEvent } from "../../app/tournament.js";
import { keyframeWeights } from "../../shared/keyframe-spline.js";
import { createConsole, distanceCommand } from "../console.js";
import { simGroundOfBuild, terrainOfBuild } from "../../shared/build-terrain.js";
import * as THREE from "three";
import { el } from "../dom.js";
import { PHYSICS_MODELS, physicsModel, saveSettings } from "../../app/settings.js";
import { createFlyController } from "../fly-controller.js";
import { WorkerClient } from "../../shared/worker-client.js";
import { currentDriver, getProfiles } from "../../app/profile-store.js";
import { createKeyboardInput } from "../../game/input/keyboard.js";
import { mergeBindings } from "../../game/input/bindings.js";
import { SunFlare } from "../../render/sun-flare.js";
import { enableSunShadows } from "../../render/sun-shadows.js";
import { mtm2Sim } from "../../vendor/openphotex/index.js";
import { COCKPIT_EYE, CAMERA_CLEAR_FT, CAMERA_MODES, CAMERA_PITCH_MAX, CAMERA_PITCH_RATE, INERTIA_MODE, cameraMode, modeForShortcut, blimpCamera, blimpCameraNoCourse, courseCentroid, createChaseCamera, fovFor, groundHeightFn, nextInList, nextMode, raceCamera, shortViews, zoomToFov } from "../../game/cameras.js";
import { createBlimp, hasBlimp } from "../../game/blimp.js";
import { soundRange, surfaceFamily } from "../../game/sound-model.js";
import { createTireEffects } from "../../render/tire-effects.js";
import { createStartLamps } from "../../render/start-lamps.js";
import { createTrackLights } from "../../render/track-lights.js";
import { createHelicopters } from "../../render/heli-object.js";
import { createNameTags } from "../../render/name-tags.js";
import { nameLabel, nameLine, nextNamesMode } from "../../game/names.js";
import { createAudio } from "../../audio/audio-engine.js";
import { VOICE_COMMENTARY_ENABLED, createCommentaryAudio } from "../../audio/commentary-audio.js";
import { createAnnouncer } from "../../game/commentary.js";
import { createCommentaryWatcher } from "../../game/commentary-events.js";
import { createTruckAudio } from "../../audio/truck-audio.js";
import { createWorldAudio } from "../../audio/world-audio.js";
import { createWeatherScene } from "../../render/weather-scene.js";
import { WEATHER_LOOK, WEATHER_NAMES, isUnderwater, resolveWeather, waterOffsetFt } from "../../game/weather.js";
import { beamAir, headlightPool, lampsAtStart, toggleLamps } from "../../game/truck-lights.js";
import { createGoldMode } from "../gold-mode.js";
import { createGamepadInput } from "../../game/input/gamepad.js";
import { createTextPanel, loadFont } from "../../render/bitmap-text.js";
import { createRaceGauges } from "../../render/race-gauges.js";
import { createWaterEffects, createWaterSurface } from "../../render/water-effects.js";
import { createReplayRecorder } from "../../game/replay.js";
import { createRaceEnd } from "../../game/race-end.js";
import { createDragTree } from "../drag-tree.js";
import { DQ_CODE, OUT } from "../../game/drag-race.js";
import { createFpsCounter } from "../fps-counter.js";
import { createCrashDamage, crashDamageMessage } from "../../game/crash-damage.js";
import { createCaption } from "../../render/caption.js";
import { courseLoop, createCourseMap } from "../../render/minimap.js";
import { createCockpit, finderAngle } from "../../render/cockpit.js";
import { cpuNames, formatRaceTime, raceEntrants, summitBoard } from "../../game/race-setup.js";
import { createModelLibrary, createTrackWorld, disposeObject, moveObjects, setStartLights, skyColor, updateSky, updateTrackWorld, placeSky } from "../../render/track-scene.js";
import { createTruckObject, interpolatePose } from "../../render/truck-object.js";
import { nearestCopy, toSceneMatrix, wrapFt } from "../../shared/scene-frame.js";
import { conformPose, createRelief, tireRadiusFt } from "../../game/terrain-relief.js";
import { trackVisuals, visualSettings } from "../../game/visuals.js";
import { applyGraphics } from "../../game/graphics.js";
import { graphicsHardware } from "../../app/graphics-hardware.js";
import { createScenery } from "../../render/scenery.js";
import { setLightsInFog } from "../../render/atmosphere.js";
import { createMenu, cycle } from "../../game/vr/menu.js";
import { SEAT_STEP_FT } from "../../game/vr/seat.js";
import { CAB_STYLES, VIEW_DISTANCES, VR_VIEWS } from "../../game/vr/settings.js";
import { createRaceVr } from "../../render/xr/race-vr.js";
import { vrButton } from "../vr-button.js";

/** The race HUD text is a light grey with a one-pixel black shadow (the game's own look). */
const HUD_GREY = "#cfcfcf";
/** A headset draws everything twice: the smoothed ground is drawn fine less far out than on the flat screen (render/track-scene.js). */
const HEADSET_FINE_RANGE_FT = 800;
/** About how tall a headset's picture is for one eye, pixels: rain and snow are kept no thinner than one of them. */
const HEADSET_VIEW_HEIGHT = 1800;

const DEMO_CAPTION = "Demo mode. Press any key to begin", DEMO_CAMERA_S = 8;
/** Before the race's clock starts, this many frames in a row must each take less than `WARM_FRAME_S`; `WARM_LIMIT_MS` at most. */
const WARM_FRAMES = 6, WARM_FRAME_S = 0.08, WARM_LIMIT_MS = 15000;

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
      leave();
    }, { once: true });
    container.append(dialog);
    dialog.showModal();
  });
}

/**
 * The physics line of Z mode (MTM1_MONSTER_EXE_ANALYSIS.md 3): the player's forward speed in ft/s, gear, throttle and
 * brake, and the physics model. The game's line also has the control flag, the course and the substep count, which
 * the page is not told.
 */
export function zPhysicsLine(sound, physics) {
  if (!sound) return null;
  const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
  return `Vel ${sound.forward.toFixed(1)} Gear ${sound.gear} Thr ${pct(sound.throttle)} Brk ${pct(sound.brake)} ${physics}`;
}

/** The key that switches a watched race's free camera on and off. */
export const SPECTATOR_FLY_KEY = "KeyB";
export const SPECTATOR_CAPTION = "Spectator mode. Left, Right: another truck. V: view. B: free camera";

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
  // Spectator mode (the port's): the computer's trucks race and nobody drives. Not free roam, which has no race.
  const spectator = !!params.spectator && !freeRoam && !demo;
  /**
   * A pass run for a drag weekend (ui/screens/drag-event.js): `entrants` says who is in which lane (`slot`), a player or not,
   * each with its `driver` in the event. The pass's results go back to the weekend's screen, not to the Winner's Circle.
   */
  const eventPass = params.drag ?? null;
  /** Where leaving the race goes: back to the weekend, or the Races screen. */
  const leave = () => (params.tournament ? context.router.go("tournament", {}, { replace: true }) : eventPass
    ? context.router.go("drag-event", {}, { replace: true })
    : context.router.go("race-select", { mode: track?.raceType }, { replace: true }));
  const t = context.t;
  const weatherId = resolveWeather(chosenWeather ?? context.settings.weather ?? 0, track.weatherMask);
  const summit = track.raceType === "summit";
  const dragRace = track.raceType === "drag";
  const dragTree = createDragTree();
  // The toggleable FPS counter, in the top right (below the drag tree on a drag strip).
  const fpsCounter = createFpsCounter({ visible: !!context.settings.fpsCounter });
  // The app's one renderer and its canvas (render/xr/xr-host.js); a headset shows this note meanwhile.
  context.xr.setBoard(createMenu({ title: "Loading", lines: [track.name] }));
  const host = await context.xr.host();
  const { renderer, canvas } = host;
  canvas.className = "race-canvas";
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
  // The headset's own copies of the rows and messages, at a size it shows sharply (render/xr/vr-hud.js).
  const vrTiming = createTextPanel(lcdFont ?? hudFont, { width: 206, scale: 3, rowHeight: 15, labelColor: HUD_GREY, valueColor: HUD_GREY, backing: "rgba(0, 0, 0, 0.34)" });
  const vrMessage = createTextPanel(messageFont, { width: 360, scale: 2, align: "center", backing: "rgba(0, 0, 0, 0.42)" });
  const setHud = (rows) => { hud.set(rows); vrTiming.set(rows); };
  const showMessage = (text) => { caption.show(text, Infinity); vrMessage.set([text]); };
  host.menu.setFonts(messageFont, hudFont);
  const pauseMenu = el("div", { class: "race-pause", hidden: true });
  // The Names key (game/names.js): what the course map and the labels over the trucks say.
  let namesMode = 0;
  const enterVr = vrButton(context, "race-vr");
  const view = el("section", { class: "race-view" }, canvas, ...(cockpit ? [cockpit.dashboard, cockpit.mirror, cockpit.finder] : []), hud.element, dragTree.element, fpsCounter.element, gauges.element, caption.element, enterVr.element, pauseMenu, loading);
  container.append(view);

  let disposed = false;
  const cleanups = [() => { enterVr.dispose(); context.xr.setBoard(null); }];
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
  const mtm1Options = { sky: context.settings.mtm1EarthSky === true, overlap: !!context.settings.mtm1TerrainOverlap };
  // Auto picks again for this machine. A stored preset writes its own switches (game/graphics.js).
  applyGraphics(context.settings, graphicsHardware());
  // Before any material is made: whether the light the port drew from the start is dimmed in the fog.
  setLightsInFog(visualSettings(context.settings).weather);
  const build = await context.assets.call("trackRender", {
    path: track.path, scope: track.scope, detailLevel: context.settings.detailLevel, raceType: track.raceType,
    truckFiles: catalogTrucks.map((t) => t.file), weather: weatherId, mtm1: mtm1Options, tileOverlap: params.tileOverlap,
    // The port's own scenery, each part as Options has it (game/visuals.js; docs/VISUALS.md).
    visuals: trackVisuals(context.settings, { weather: weatherId, weatherMask: track.weatherMask }),
    smoothTiles: context.settings.look === "enhanced",
  });
  if (disposed) return { unmount };
  if (build.problems?.length && !demo) {
    const go = await loadReport(view, context, track, { heading: "Files this track names are missing", lines: build.problems, fatal: false });
    if (!go || disposed) return { unmount };
  }
  const driver = currentDriver(await getProfiles(context));
  // The course map (Map key), from the SIT's primary course.
  // Professional puts every truck on course 2 when the SIT has one (MONSTER_EXE_ANALYSIS.md 9); the map still draws course 1.
  // A drag strip's courses are its lanes instead (6.4): course 1 is lane 0's, whatever the difficulty.
  const raceCourse = Number(difficulty) === 2 && build.sim.proCourse && track.raceType !== "drag" ? build.sim.proCourse : build.sim.course;
  const minimap = createCourseMap(build.sim.course, { font: hudFont, open: !!build.sim.courseOpen });
  minimap.setVisible(!!context.settings.minimap);
  view.append(minimap.element);
  const grid = build.sim.grid;
  const usable = catalogTrucks.filter((t) => build.truckModels[t.file]);
  const entrants = eventPass
    ? eventPass.entrants.filter((e) => build.truckModels[e.file] && e.slot < grid.length)
    : raceEntrants({ playerTruck, trucks: usable, slots: grid.length, opponents, playerName: driver.name, spectator, names: cpuNames(context.settings.aiNames) });
  // A little smaller than the HUD's text, in whole pixels so the glyphs stay sharp.
  const nameTags = createNameTags(entrants.length, hudFont, Math.max(1, Math.round(scale * 0.75)));
  view.append(nameTags.element);
  if (!grid.length || !build.truckModels[playerTruck]) {
    loadingText.textContent = `${track.name} has no start grid, or ${truckName(playerTruck)} could not be built.`;
    loading.append(el("button", { "data-menu-sound": "STARTOFF", onclick: () => context.router.back() }, "Back"));
    return { unmount };
  }

  const look = context.settings.look === "enhanced" ? "enhanced" : "classic";
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
  // What "Natural light" changes of the world itself (docs/VISUALS.md, "Light"): it is the enhanced look's.
  const naturalLight = look === "enhanced" && visualSettings(context.settings).light;
  const world = createTrackWorld(build, look, {
    backdrops: !!context.settings.backdrops, drawDistance, naturalLight,
    terrainDetail: context.settings.terrainDetail !== false, reflections: context.settings.reflections !== false,
  });
  scene.add(world);
  // Sound: the engines, skids and impacts of every truck, and the world's ambience and music.
  context.menuMusic?.stop();
  // Reuse the already unlocked menu context. A newly created context after the asynchronous
  // track load can be blocked by autoplay policy even though GO was clicked.
  const sharedAudio = context.menuAudio ?? createAudio(context.assets, context.settings.sound);
  const ownsAudio = !context.menuAudio;
  // The race's own view of the mixer: what it started is stopped when it ends, one-shots included.
  const audio = sharedAudio.scoped?.() ?? sharedAudio;
  const ambience = await context.assets.call("ambience", { number: track.ambientSound ?? 0 }).catch(() => null);
  // Started whatever the music's level, which alone makes it heard: the console's `music 1` then needs no restart.
  const musicName = build.musicName ?? null;
  const worldAudio = createWorldAudio(audio, {
    ambient: ambience, weather: weatherId, music: musicName, objects: build.soundObjects,
    hitInfo: new Map(build.sim.boxes.map((b) => [b.sitIndex, { hitSound: b.hitSound, type: b.type }])),
  });
  const truckAudio = createTruckAudio(audio, {
    count: entrants.length, player: 0, kookyHorn: !!context.settings.kookyHorn, mtm1Sounds: !!context.settings.mtm1Sounds,
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
    audio.stopAll?.();
    if (ownsAudio) sharedAudio.dispose();
    context.menuMusic?.start();
  });
  const forwardVector = new THREE.Vector3();
  const terrain = terrainOfBuild(build);
  // With "Smooth terrain" the ground drawn is not quite the ground driven on (game/terrain-relief.js).
  const relief = build.relief ? createRelief({ heights: build.heights, ...build.relief }) : null;
  let shadows = null, flare = null, flareBlocked = () => false;
  audio.setRange?.(soundRange(weatherId));
  // The port's own weather, ground and water, each where its switch is on (render/scenery.js; docs/VISUALS.md).
  const scenery = createScenery({
    scene, camera, world, sun, build, settings: context.settings, ground: relief ? relief.heightAt : groundHeightFn(terrain), relief,
    ambient: ambientLight, renderer, look,
  });
  cleanups.push(() => scenery.dispose());
  // What follows the ground (cameras, lights, dust, tracks, spray) follows what is drawn: the drawn ground, and the snow lying on it.
  const ground = scenery.surfaceAt;
  const weatherScene = createWeatherScene({
    scene, camera, world, sun, ambient: ambientLight, skyAverage: background, look, drawDistance, backdrops: !!context.settings.backdrops, art: effectsArt,
    onSun: (_, shadow) => shadows?.follow(sun, shadow), onLightning: () => worldAudio.thunder(),
    volume: scenery.volume, groundSurface: scenery.groundSurface, lightRig: scenery.lightRig,
    groundDetail: scenery.groundDetail, dressGround: scenery.dressGround, gloss: scenery.gloss, water: scenery.water, richLamps: visualSettings(context.settings).lamps,
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
    if (truckReflections) truckReflections.setImage(await context.assets.call("envMap", { weather: next }).catch(() => null));
  };
  // The renderer is the app's: it is handed back, with the headset's rig taken out of the scene first.
  cleanups.push(() => { host.release(); disposeObject(scene); });

  // The lamps as the port draws them, where "Truck lamps" is on (docs/VISUALS.md, "Lamps").
  const richLamps = visualSettings(context.settings).lamps;
  // MTM2's truck reflections (Options, Display; render/truck-reflection.js): CLOUDENV over the bodies.
  const truckReflections = context.settings.truckReflections
    ? createTruckReflections(await context.assets.call("envMap", { weather: weatherId }).catch(() => null)) : null;
  if (truckReflections) cleanups.push(() => truckReflections.dispose());
  // The light each truck's own lamps throw on the ground, with "Truck lamps" (game/truck-lights.js `headlightPool`).
  const pools = entrants.map((e) => headlightPool(build.truckModels[e.file]?.lights ?? []));
  // One drawn truck per entrant, at the TRK's own anchors (the simulation clamps the wheelbase, §3.1).
  const drawn = entrants.map((e) => {
    const model = build.truckModels[e.file];
    const object = createTruckObject(model, model.anchors, look, { richLamps });
    scenery.gloss?.dress(object.object);
    truckReflections?.dress(object.object);
    scene.add(object.object);
    return object;
  });

  // Crash damage (game/crash-damage.js): the hull contacts the simulation reports dent the bodies.
  // The physics model (Options, Game; the console's `physics`): the 1996 game has no crash damage.
  const physics = physicsModel(params.physics ?? context.settings.physics).id;
  const crash = createCrashDamage(entrants.length, { enabled: context.settings.crashDamage !== false && physics !== "mtm1" });
  // Instant replay (game/replay.js): a frame every quarter second, kept for the results screen.
  const recorder = createReplayRecorder({
    level: track.path.split(/[\\/]/).pop().toLowerCase(), weather: weatherId, detailLevel: context.settings.detailLevel ?? 2,
    vehicles: entrants.map((e) => ({ truck: e.file, driver: e.name })), originals: build.originals ?? [],
  });

  // The enhanced look (settings.look): the sun's shadows, and the sun, moon and lens flare.
  if (look === "enhanced") {
    shadows = enableSunShadows({ renderer, scene, camera, world, sun, trucks: drawn.map((truck) => truck.object), natural: !!scenery.lightRig });
    shadows.follow(sun, scenery.lightRig?.rig?.shadow ?? 1);
    const data = await context.assets.call("flare").catch(() => null);
    if (data) {
      flare = new SunFlare(world, data);
      flare.setMode(celestialFor(weatherId));
      flareBlocked = (origin, direction) => sunBlocked(terrain, origin, direction, true);
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
    groundBoxStepFt: build.sim.groundBoxStepFt ?? null,
    ra0: build.sim.ra0?.buffer ?? null,
    ra1: build.sim.ra1?.buffer ?? null,
    boxes: build.sim.boxes,
    ramps: build.sim.ramps,
    topCrush: build.sim.topCrush ?? [],
    course: raceCourse,
    // The SIT's fly-by flag makes a track Sonic; on Professional the player can also ask for Sonic computer trucks anywhere.
    sonicTrack: build.sim.sonicTrack || (Number(difficulty) === 2 && !!context.settings.sonicTrucks),
    // A level of a game without water gives its own value, so that low ground is not read as deep water.
    waterLevelFt: build.sim.waterLevelFt !== undefined ? build.sim.waterLevelFt : build.waterLevelFt,
    weather: weatherId,
    rules: physics,
    difficulty,
    autoShift: context.settings.autoShift !== false,
    trucks: entrants.map((e) => {
      const model = build.truckModels[e.file];
      return {
        truck: { anchors: model.anchors, scrapePoints: model.scrapePoints, tire: model.tire ?? null },
        start: { pos: grid[e.slot].pos, heading: grid[e.slot].heading },
        autopilot: !e.player || !!context.settings.fullAutopilot || demo,
        // A drag strip's grid slot is the lane.
        lane: e.slot,
        // A drag weekend's computer driver: its launch and how deep it stages.
        launch: e.launch, stageDepth: e.stageDepth,
        // The player's Garage setup; the CPU trucks keep the defaults.
        setup: e.player ? setup : undefined,
      };
    }),
    race: freeRoam ? null : {
      checkpoints: build.sim.checkpoints, laps: dragRace ? 1 : laps, mode: summit ? "summit" : dragRace ? "drag" : "circuit",
      // A drag pass: lane 1's course (the SIT's course 2), and whether the player's truck stages itself.
      laneCourse: dragRace ? build.sim.proCourse : null, autoStage: context.settings.autoStage !== false,
    },
  };
  // Where the player's truck starts, for the frames before the simulation's first reply.
  const startPose = await sim.call("init", init);
  const vrCockpit = await context.assets.call("cockpitPanel").catch(() => null);
  if (disposed) return { unmount };
  if (spectator) caption.show(SPECTATOR_CAPTION, 8);
  // The loading screen stays until the first frames have been drawn at an even pace (`ready` in the frame loop below):
  // the race's clock starts only then, so the countdown is not spent while shaders compile and textures go up.
  loadingText.textContent = `${t("Getting ready")}…`;

  // The race in a headset: the seat, the boards, the cab and the controllers.
  const vr = createRaceVr(host, {
    settings: context.settings, save: () => saveSettings(context.settings), truckFile: playerTruck,
    body: build.truckModels[playerTruck].parts.body, truckObject: drawn[0].object, scene,
    panels: { timing: vrTiming, message: vrMessage, gauges }, cockpit: vrCockpit, stock: cockpitArt, needleArt: needle, look,
  });
  cleanups.push(() => vr.dispose());

  const keys = createKeyboardInput(window, context.settings.bindings);
  const pad = createGamepadInput();
  cleanups.push(() => keys.dispose());
  let gold = null, gameConsole = null;
  /** The controllers' joystick, and their presses since the simulation last took the input. */
  let hands = null;
  const handPresses = { shiftUp: false, shiftDown: false, helicopter: false };
  const sampleInput = () => {
    const held = keys.sample();
    const driving = held.accelerate || held.brake || held.left || held.right;
    // A gamepad at rest leaves the driving to the controllers in the player's hands.
    const stick = pad.sample();
    const stickBusy = stick && (Math.abs(stick.x) > stick.deadZone || Math.abs(stick.y) > stick.deadZone || stick.shiftUp || stick.shiftDown);
    const joystick = stickBusy || !hands ? stick : { ...hands, shiftUp: handPresses.shiftUp, shiftDown: handPresses.shiftDown };
    const helicopter = held.helicopter || handPresses.helicopter;
    handPresses.shiftUp = handPresses.shiftDown = handPresses.helicopter = false;
    return { ...held, helicopter, joystick: driving ? null : joystick, slew: gold?.slewing ? gold.slewInput() : null };
  };

  // The Inertia view (the Z-mode cameras option) comes after the game's ten.
  const zCameras = () => !!context.settings.zModeCameras;
  let viewMode = demo || spectator ? 4 : (zCameras() ? cameraMode(context.settings.view) : CAMERA_MODES[context.settings.view])?.id ?? 1, paused = false, finishing = false;
  // Each truck's lamp switch (game/truck-lights.js) and the clock the blinking lamps and beacons run on.
  const lamps = entrants.map(() => lampsAtStart(WEATHER_LOOK[weatherId]?.headlights));
  let lampClockMs = 0;
  const setPaused = async (on) => {
    if (finishing || paused === on) return;
    paused = on;
    pauseMenu.hidden = !on;
    showVrMenu();
    // Every sound stops but the music.
    audio.setEffectsPaused?.(on);
    if (!on) await sim.call("resume");
  };
  // Spectator mode: once the race is over, the way on to its results (`watchedOver`).
  const resultsButton = el("button", { class: "primary", hidden: true, "data-menu-sound": "STARTOFF", onclick: async () => { if (finishing) return; await setPaused(false); finish(); } }, "Results");
  let overShown = false;
  const watchedOver = () => {
    if (overShown) return;
    overShown = true;
    resultsButton.hidden = false;
    caption.show("The race is over. Esc: the pause menu, and Results", 8);
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
    resultsButton,
    el("button", {
      "data-menu-sound": "STARTOFF",
      onclick: leave,
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

  /*
    The pause menu as the headset shows it (render/xr/vr-panel.js): the same choices as the flat
    one, and the headset's own (docs/VR.md, "Options"). Values change at once, so the seat can be
    set by eye.
  */
  const onOff = (on) => (on ? "On" : "Off");
  const feet = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} ft`;
  const toggle = (label, key) => ({ label, value: () => onOff(vr.prefs[key]), change: () => vr.set(key, !vr.prefs[key]) });
  const seatRow = (label, axis) => ({
    label, value: () => feet(vr.seatOffset[axis]),
    change: (d) => vr.moveSeat([0, 0, 0].map((_, i) => (i === axis ? d * SEAT_STEP_FT : 0))),
  });
  const viewIds = VR_VIEWS.map((v) => v.id), distanceIds = VIEW_DISTANCES.map((v) => v.id), cabIds = CAB_STYLES.map((v) => v.id);
  const vrOptionsMenu = () => createMenu({
    title: "VR options",
    items: [
      toggle("Horizon lock", "horizonLock"),
      seatRow("Seat forward", 2), seatRow("Seat height", 1), seatRow("Seat sideways", 0),
      { label: "Reset seat", action: () => vr.moveSeat(null) },
      toggle("Cab", "cab"), toggle("HUD", "hud"),
      {
        label: "Cab style", value: () => CAB_STYLES.find((v) => v.id === vr.prefs.cabStyle).name,
        change: (d) => vr.set("cabStyle", cycle(cabIds, vr.prefs.cabStyle, d)),
      },
      {
        label: "Steering", value: () => (vr.prefs.steering === "wheel" ? "Hands as a wheel" : "Thumbstick"),
        change: () => vr.set("steering", vr.prefs.steering === "wheel" ? "stick" : "wheel"),
      },
      {
        label: "View distance", value: () => VIEW_DISTANCES.find((v) => v.id === vr.prefs.viewDistance).name,
        change: (d) => vr.set("viewDistance", cycle(distanceIds, vr.prefs.viewDistance, d)),
      },
      { label: "Back", action: () => host.menu.open(vrPauseMenu()) },
    ],
    back: () => host.menu.open(vrPauseMenu()),
  });
  const vrPauseMenu = () => createMenu({
    title: t("Pause"),
    items: [
      { label: "Resume", action: () => setPaused(false) },
      { label: "Recentre view", action: () => host.recenter() },
      { label: "View", value: () => vr.view.name, change: (d) => vr.set("view", cycle(viewIds, vr.prefs.view, d)) },
      { label: "VR options", action: () => host.menu.open(vrOptionsMenu()) },
      { label: "End race", action: leave },
      { label: "Leave VR", action: () => host.exit() },
    ],
    back: () => setPaused(false),
  });
  /** The headset's pause menu is up exactly while the race is paused in a headset. */
  function showVrMenu() {
    if (paused && host.presenting) {
      if (!host.menu.isOpen) host.menu.open(vrPauseMenu());
    } else host.menu.close();
  }
  cleanups.push(host.on("start", showVrMenu));
  // Taking the headset off, or the headset's own menu coming up over the game, pauses the race.
  cleanups.push(host.on("visibility", (state) => { if (state !== "visible") setPaused(true); }));

  const keyMap = mergeBindings(context.settings.bindings);
  const playerPosition = () => latest?.poses[0].current.pos;
  /** The camera key (or a controller's button): the headset's next view, or the window's next camera. */
  const nextView = (shortcut = null, back = false) => {
    if (host.presenting) flash(vr.nextView().name, performance.now(), 1.5);
    else {
      // The short cycle (Options, Advanced): the views the player listed, the cockpit, Chase Near and Chase Far unless changed.
      const views = zCameras() ? INERTIA_MODE.id + 1 : CAMERA_MODES.length;
      viewMode = shortcut ?? (context.settings.shortViewCycle
        ? nextInList(viewMode, shortViews(context.settings.shortViews), back)
        : nextMode(viewMode, back, views));
      context.settings.view = viewMode;
      saveSettings(context.settings);
      // "Chase Far of Bear Foot": the view's name and the truck being watched (0x52d180).
      flash(`${t(cameraMode(viewMode).name)} of ${truckName(spectator ? entrants[cameraTarget].file : playerTruck)}`, performance.now(), 2);
    }
  };
  const onKey = (e) => {
    // The Options dialog and the instant replay take the keys while they are up.
    if (replaying || context.optionsDialog?.isConnected) return;
    if (demo) { leaveDemo(); return; }
    if (spectator && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !paused) {
      // B: the free camera. Left and Right: the truck watched (the free camera has those keys while it flies).
      if (e.code === SPECTATOR_FLY_KEY) { setFlying(!flyer.enabled); return; }
      if (e.code === "ArrowRight" || e.code === "ArrowLeft") { watch(cameraTarget + (e.code === "ArrowRight" ? 1 : -1)); return; }
    }
    if (keyMap.horn.includes(e.code) && !e.repeat) truckAudio.horn(0, playerPosition());
    if (keyMap.yeehaw.includes(e.code) && !e.repeat) truckAudio.yeehaw(0, playerPosition());
    const shortcut = modeForShortcut(e);
    if (shortcut !== null) e.preventDefault();
    if ((keyMap.camera.includes(e.code) || shortcut !== null) && !e.repeat) nextView(shortcut, e.shiftKey);
    if (keyMap.recenter.includes(e.code) && !e.repeat) host.recenter();
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
    // The FPS counter key switches the frames per second in the corner.
    if (keyMap.fps?.includes(e.code) && !e.repeat) {
      context.settings.fpsCounter = fpsCounter.toggle();
      saveSettings(context.settings);
    }
    // The Headlights key (L) switches the player's lamps; every other truck keeps what the weather gave it.
    if (keyMap.headlights.includes(e.code) && !e.repeat && !e.ctrlKey) lamps[0] = toggleLamps(lamps[0]);
    if (keyMap.crashDamage.includes(e.code) && !e.repeat && physics === "mtm1") flash("No crash damage in Monster Truck Madness physics", performance.now(), 3);
    else if (keyMap.crashDamage.includes(e.code) && !e.repeat) {
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
  // The keys held down, for the Camera up and down keys, which tilt the chase camera while held.
  const held = new Set();
  const onHold = (e) => { if (e.type === "keydown") held.add(e.code); else held.delete(e.code); };
  const letGo = () => held.clear();
  window.addEventListener("keydown", onHold);
  window.addEventListener("keyup", onHold);
  window.addEventListener("blur", letGo);
  cleanups.push(() => { window.removeEventListener("keydown", onHold); window.removeEventListener("keyup", onHold); window.removeEventListener("blur", letGo); });
  /** What the controllers' buttons do, once per press (game/vr/controls.js). */
  const actOnHands = ({ joystick, actions }) => {
    hands = host.presenting ? joystick : null;
    if (!host.presenting) return;
    if (actions.pause) setPaused(!paused);
    // The rest belongs to the race; a paused one leaves the buttons to the menu.
    if (paused) return;
    handPresses.shiftUp ||= !!joystick?.shiftUp;
    handPresses.shiftDown ||= !!joystick?.shiftDown;
    handPresses.helicopter ||= actions.helicopter;
    if (actions.horn) truckAudio.horn(0, playerPosition());
    if (actions.yeehaw) truckAudio.yeehaw(0, playerPosition());
    if (actions.camera) nextView();
    if (actions.recenter) host.recenter();
  };

  const resize = () => {
    // A headset sizes its own pictures; the canvas is left alone while it is drawn to.
    if (host.presenting) return;
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
  // In a headset the flat camera stands in for the head; afterwards it is the chase camera again.
  cleanups.push(host.on("end", () => {
    camera.fov = 60;
    lastView = -1;
    showVrMenu();
    resize();
  }));

  // The ten views (game/cameras.js): chase cameras as the exe places them, and the port's own BlimpCam and RaceCam.
  // A drawn truck is seated on the drawn ground, wheel by wheel; the simulation's truck stays where it is.
  const seats = entrants.map((e) => {
    const model = build.truckModels[e.file];
    return { hubs: model.anchors, radius: tireRadiusFt(model.parts.tireRight ?? model.parts.tireLeft) };
  });
  // The shade each truck keeps the sky's light off (render/contact-shade.js): strongest where the sun's own shadow is faint.
  const contactShade = scenery.contactShade(seats);
  if (contactShade) cleanups.push(() => contactShade.dispose());
  // Seated on the ground as its mesh is drawn (render/scenery.js `groundAt`), against the game's own ground under the wheel.
  const seat = relief ? { simAt: relief.simAt, simSlopeAt: relief.simSlopeAt, offsetAt: (x, z) => scenery.groundAt(x, z) - relief.simAt(x, z) } : null;
  const seated = (pose, i) => (seat ? conformPose(pose, seat, seats[i].hubs, seats[i].radius, weatherScene.weather === 5 ? build.waterLevelFt ?? null : null) : pose);
  // Community Patch 3 track lights (box type 12), lit at night (render/track-lights.js).
  const trackLights = createTrackLights(scene, build.trackLights, ground, { shafts: richLamps });
  if (trackLights) cleanups.push(() => trackLights.dispose());
  // The start gantry's lamps as lamps, with "Truck lamps" (render/start-lamps.js); else the game's coloured faces.
  const startLamps = richLamps ? createStartLamps({ world, scene, dark: !!WEATHER_LOOK[weatherId]?.headlights }) : null;
  if (startLamps) cleanups.push(() => startLamps.dispose());
  // Ice over the water in Snow, and the spray and ripples of wheels in water (render/water-effects.js).
  // Every copy of the world has its own water plane (render/track-scene.js): they bob and are surfaced together.
  const waters = [];
  world.traverse((object) => { if (object.name === "water") waters.push(object); });
  const waterFx = createWaterEffects({ scene, art: effectsArt, levelFt: build.waterLevelFt ?? null, ground, legacyIce: !scenery.water, blobs: !scenery.particles, rings: !scenery.particles && !scenery.water });
  cleanups.push(() => waterFx.dispose());
  // Dust, tire tracks and sparks (render/tire-effects.js), each switched in Options.
  // In the dark a shower of sparks lights what is about it.
  const tireFx = createTireEffects({ scene, art: effectsArt, ground, floor: scenery.floorAt, count: entrants.length, rich: scenery.particles, greyDust: !!context.settings.greyDust, dark: !!WEATHER_LOOK[weatherId]?.headlights });
  cleanups.push(() => tireFx.dispose());
  // MTM1 particles (Options, Advanced; render/mtm1-particles.js) take the place of the dust, the spray and the tracks.
  const mtm1Particles = context.settings.mtm1Particles
    ? createMtm1Particles({ scene, ground, atlas: build.terrain?.atlas ?? null, clr: build.sim?.clr ? new Uint16Array(build.sim.clr) : null }) : null;
  if (mtm1Particles) cleanups.push(() => mtm1Particles.dispose());
  const effectFlags = () => (mtm1Particles
    ? { dust: 0, tracks: false, sparks: sparkLevel(context.settings), splash: false }
    : { dust: dustLevel(context.settings), tracks: context.settings.tireTracks !== false, sparks: sparkLevel(context.settings), splash: context.settings.waterSplash !== false });
  // The water's surface: the port's own (render/water-surface.js) or the game's frames.
  const waterSurface = scenery.water ?? createWaterSurface(waters, effectsArt, look);
  if (!scenery.water) cleanups.push(() => waterSurface?.dispose());
  // MTM2's water reflections (Options, Display; render/water-mirror.js), on the game's own water: "Reflective water" has
  // its own. Not in Snow, where the water is ice.
  const waterMirror = context.settings.waterReflections && !scenery.water && waterSurface?.material && waters.length
    ? createWaterMirror({ renderer, scene, levelAt: () => (weatherScene.weather === 5 ? null : waterLevelNow), hide: () => waters }) : null;
  if (waterMirror) { waterMirror.dress(waterSurface.material); cleanups.push(() => waterMirror.dispose()); }
  /** The water's level as it stands this frame, bob included, or null. */
  let waterLevelNow = build.waterLevelFt ?? null;
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
  let mirrorTick = 0, mirrorReading = false, mirrorWarmed = false;
  const renderMirror = () => {
    if (!mirrorTarget) return;
    if (viewMode !== 0 || cockpitMode() !== 0) { cockpit.setMirror(mirrorPixels, mirrorTarget.width, mirrorTarget.height, false); return; }
    // Every other frame, and not while the picture before is still on its way back.
    if (mirrorTick++ % 2 || mirrorReading) return;
    mirrorCamera.position.copy(cockpitEye.position);
    mirrorCamera.quaternion.copy(cockpitEye.quaternion).multiply(flipBack);
    renderer.setRenderTarget(mirrorTarget);
    // The first time the mirror is drawn: the scene's shaders for the mirror's picture, which are not the screen's,
    // all built now and not one by one as each thing first comes into the mirror (render/weather-scene.js `warmPools`).
    if (!mirrorWarmed) {
      mirrorWarmed = true;
      weatherScene.warmPools(() => renderer.compile(scene, mirrorCamera));
      if (scenery.particles?.over) renderer.compile(scenery.particles.over.scene, mirrorCamera);
    }
    renderer.render(scene, mirrorCamera);
    // The dust and smoke drawn over the scene (render/over-scene.js).
    scenery.drawOver(mirrorCamera);
    // The picture is asked for and not waited for: the graphics card hands it over once it has drawn it, a frame or
    // two on, and the mirror shows it then. Waiting here held every other frame for as long as the card was behind,
    // 15 to 50 ms on a small chip.
    mirrorReading = true;
    renderer.readRenderTargetPixelsAsync(mirrorTarget, 0, 0, mirrorTarget.width, mirrorTarget.height, mirrorPixels)
      .then(() => { if (!disposed && viewMode === 0 && cockpitMode() === 0) cockpit.setMirror(mirrorPixels, mirrorTarget.width, mirrorTarget.height); })
      .catch(() => {})
      .finally(() => { mirrorReading = false; });
    renderer.setRenderTarget(null);
  };
  cleanups.push(() => mirrorTarget?.dispose());
  let waterClock = 0, shownPoses = null;
  /** Where the watched truck was last drawn, game feet: the picture's place in its own unbroken space. */
  let drawAnchor = null;
  /** A drawn position (which may be worlds from the simulation's) as the simulation has it, for what is placed in the world. */
  const inWorld = (pos) => [wrapFt(pos[0]), pos[1], wrapFt(pos[2])];
  const raceEnd = createRaceEnd({ summit, spectator });
  let cameraTarget = 0;
  // A watched race: the truck the camera is on is the spectator's to choose, and the camera can be flown free
  // (ui/fly-controller.js, the fly-by's own).
  const flyer = spectator ? createFlyController({
    canvas, settings: context.settings, save: () => saveSettings(context.settings), course: build.sim.course, courseOpen: !!build.sim.courseOpen,
    groundAt: groundHeightFn(terrain), say: (text, seconds) => caption.show(text, seconds ?? 4), baseFov: fovFor(1),
    blocked: () => paused || finishing || !!gameConsole?.open || !!replaying || !!context.optionsDialog?.isConnected,
  }) : null;
  if (flyer) { view.append(flyer.element); cleanups.push(() => flyer.dispose()); }
  const flyTarget = new THREE.Vector3();
  const watch = (index) => {
    cameraTarget = ((index % entrants.length) + entrants.length) % entrants.length;
    caption.show(`Watching ${truckName(entrants[cameraTarget].file)} (${entrants[cameraTarget].name})`, 2);
  };
  /** The free camera on or off, in a watched race: it starts where the race's camera is, looking the same way. */
  const setFlying = (on) => {
    if (!flyer || flyer.enabled === !!on) return !!flyer?.enabled;
    if (on) {
      camera.getWorldDirection(flyTarget);
      flyer.place([camera.position.x, camera.position.y, -camera.position.z], Math.atan2(flyTarget.x, -flyTarget.z), Math.asin(Math.max(-1, Math.min(1, flyTarget.y))));
      flyer.setEnabled(true);
      flyer.announce();
    } else {
      flyer.setEnabled(false);
      // The race's camera takes its own lens back.
      lastView = -1;
      caption.show(`${t(cameraMode(viewMode).name)} of ${truckName(entrants[cameraTarget].file)}`, 2);
    }
    return flyer.enabled;
  };
  let lastView = -1;
  /** How far the player has tilted the chase camera from its view's own pitch (game angle units); a new view starts level. */
  let pitchBy = 0;
  /** Tilt the chase camera while Camera up or down is held, at the game's rate, held within the pitches it allows. */
  const tiltCamera = (dt) => {
    const base = cameraMode(viewMode)?.pitch;
    if (base === undefined || dt <= 0 || replaying || context.optionsDialog?.isConnected) return;
    // Z mode's - and + zoom; Shift with them zooms with the Z-mode cameras option.
    if (gold?.zooming || held.has("ShiftLeft") || held.has("ShiftRight")) return;
    const down = (codes) => codes.some((code) => held.has(code));
    const way = (down(keyMap.cameraUp ?? []) ? 1 : 0) - (down(keyMap.cameraDown ?? []) ? 1 : 0);
    if (way) pitchBy = Math.max(-base, Math.min(CAMERA_PITCH_MAX - base, pitchBy + way * CAMERA_PITCH_RATE * dt));
  };
  const cockpitEye = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, scratchScale = new THREE.Vector3();
  // Switching views changes the camera at once, as the game does: only a chase camera's heading takes time to catch up (game/cameras.js).
  const placeCamera = (p, dt) => {
    if (viewMode !== lastView) {
      lastView = viewMode;
      pitchBy = 0;
      if (!cameraMode(viewMode).dist) chase.reset();
      camera.fov = fovFor(viewMode);
      camera.updateProjectionMatrix();
    }
    tiltCamera(dt);
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
    // The BlimpCam and the RaceCam stand by the course, which is in the simulation's world: found there, then moved by
    // the whole worlds the picture is from it.
    const sim = inWorld(p.pos), off = [p.pos[0] - sim[0], 0, p.pos[2] - sim[2]];
    const stood = mode === 3 ? (centroid ? blimpCamera(sim, centroid) : blimpCameraNoCourse(sim, yaw, ground))
      : mode === 4 ? (raceCamera(straights, sim, p.course ?? 0, ground) ?? blimpCameraNoCourse(sim, yaw, ground)) : null;
    const special = stood && { ...stood, position: stood.position.map((v, k) => v + off[k]), target: stood.target.map((v, k) => v + off[k]) };
    // Z mode's orbit swings the chase views; the Inertia view follows the watched truck's speed.
    const view = special ?? chase.update(mode, p.pos, yaw, ground, dt, {
      turn: gold?.cameraTurn ?? 0, speedFt: latest?.poses[cameraTarget]?.current.speed ?? latest?.poses[0]?.current.speed ?? 0,
      pitchBy, clearFt: context.settings.cameraClearance ? CAMERA_CLEAR_FT : 0,
    });
    // Game feet to the scene: z is mirrored.
    camera.position.set(view.position[0], view.position[1], -view.position[2]);
    camera.lookAt(view.target[0], view.target[1], -view.target[2]);
    return special ? special.zoom : view.zoom ?? null;
  };

  // The demo keeps its own caption up.
  const flash = (text, now, seconds = 3) => { if (!demo) { caption.show(text, seconds); vrMessage.set([text]); } };
  // A function declaration: the key handler above may call it before this line runs.
  function leaveDemo() { if (!leaveDemo.done) { leaveDemo.done = true; context.router.go("start", {}, { replace: true }); } }
  if (demo) {
    showMessage(DEMO_CAPTION);
    window.addEventListener("pointerdown", leaveDemo);
    cleanups.push(() => window.removeEventListener("pointerdown", leaveDemo));
  }
  let lastLaps = 0, lastCheckpoint = 0;
  let wasMissed = false, finalLapShown = false, lightsOn = null, dragNoted = false;
  /** What the player is told when a drag pass puts them out (game/drag-race.js `DQ_CODE`). */
  const DRAG_OUT = {
    "red light": "Red light! Disqualified.", "out of lane": "Out of your lane! Disqualified.", "reversing": "Backing up! Disqualified.",
    "not staged": "Not staged in time! Disqualified.", "timeout": "Out of time! Disqualified.",
  };
  const showRace = (race, now) => {
    // The gantry's lamps change only when the countdown state does (6.1).
    if (lightsOn !== !race.started) {
      lightsOn = !race.started;
      if (startLamps) startLamps.set(lightsOn);
      else setStartLights(world, lightsOn, build.startLightColours);
    }
    // A watched race shows the watched truck's times.
    const me = race.trucks[spectator ? cameraTarget : 0] ?? race.trucks[0];
    // The level's own sounds for passing a checkpoint and closing a lap (SOUNDnnn.TXT).
    if (me.laps > lastLaps) worldAudio.lapDone();
    else if (me.checkpoint !== lastCheckpoint && !summit && race.started) worldAudio.checkpoint();
    lastLaps = me.laps;
    lastCheckpoint = me.checkpoint;
    if (race.drag) {
      // The tree, left lane first, with the timing slip under it; the clock runs from the green; then the reaction time and the place.
      const byLane = [0, 0], slip = [null, null];
      race.drag.lamps.forEach((bits, i) => {
        byLane[race.drag.lane[i]] = bits;
        const row = race.trucks[i];
        slip[race.drag.lane[i]] = { reaction: row.reaction, et: row.finished && !row.dq && !row.rerun ? row.raceTime : null, out: row.rerun ? "RERUN" : row.dq ? "DQ" : null };
      });
      dragTree.set(byLane, entrants[0].player ? race.drag.lane[0] : null, slip);
      setHud([
        [t("Clock:"), formatRaceTime(me.finished && !me.dq ? me.raceTime : race.clock)],
        ["Reaction:", me.reaction === null ? "--.--" : me.reaction.toFixed(2)],
        ["", ""], [t("Place:"), `${me.place}/${race.trucks.length}`],
      ]);
      if (me.dq && !dragNoted) flash(DRAG_OUT[me.dq] ?? "Disqualified.", now);
      else if (me.rerun && !dragNoted) flash("Hit by a disqualified truck: the pass will be run again.", now);
      else if (me.finished && !dragNoted) flash(`Elapsed time ${me.raceTime.toFixed(2)} s`, now);
      if (me.finished || me.dq) dragNoted = true;
      return;
    }
    if (summit) {
      // A Rumble: the score and the round's time left, then the place by score (6.3).
      // Under them every driver with their score, the leader first, as the game lists them (from play; its drawing
      // code was not traced).
      setHud([
        [t("Time Remaining:"), formatRaceTime(race.summit?.left ?? 0)], ["Score:", String(Math.round(me.score))], [t("Place:"), `${me.place}/${race.trucks.length}`], ["", ""],
        ...summitBoard(race.trucks, entrants.map((e) => e.name)),
      ]);
      return;
    }
    setHud([
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
    // The game leaves the race for its loading screen while it works out the times; a headset keeps the message.
    const determining = t("Determining times for remaining trucks...");
    caption.clear();
    vrMessage.set([determining]);
    loadingText.textContent = determining;
    loading.hidden = false;
    const race = await sim.call("finish");
    if (disposed) return;
    context.lastReplay = recorder.build();
    const rows = race.trucks.map((t, i) => ({
      ...t, name: entrants[i].name, file: entrants[i].file, truckName: truckName(entrants[i].file), player: entrants[i].player,
    }));
    if (eventPass) {
      // What each truck made of the pass, by its driver in the event (game/drag-race.js `DQ_CODE`; not finished is the timeout).
      const results = rows.map((row, i) => ({
        driver: entrants[i].driver ?? null, lane: entrants[i].slot,
        et: row.finished && !row.dq && !row.rerun ? row.raceTime : null,
        code: row.rerun ? OUT.RERUN : row.dq ? DQ_CODE[row.dq] : row.finished ? null : OUT.TIMEOUT,
      }));
      context.router.go("drag-event", { pass: { kind: eventPass.kind, results } }, { replace: true });
      return;
    }
    context.router.go("results", { track, laps: race.laps ?? laps, difficulty, rows, mode: track.raceType, truck: playerTruck, tournament: !!params.tournament }, { replace: true });
  };

  let busy = false, latest = null, drawnAt = performance.now(), poolsWarmed = false;
  // Held until the frames come steadily: `WARM_FRAMES` in a row each shorter than `WARM_FRAME_S`, or `WARM_LIMIT_MS` at most.
  let ready = false, steadyFrames = 0;
  const warmStart = performance.now();
  let drawnCells = drawDistance / TERRAIN_CELL_FT;
  const movedBoxes = new Set();
  const movedPositions = new Map();
  window.__openmtm2Race = { audio, scene, camera, renderer, sim, entrants, musicName, host, vr, scenery, tireFx, get latest() { return latest; } };
  cleanups.push(() => { delete window.__openmtm2Race; });
  /** One frame, from the window or from the headset (the host's loop): `now` as performance.now(). */
  const loop = (_dt, now) => {
    // The frame rate limit (the window's frames only: a headset keeps to its own rate): a frame that comes too soon is
    // left out (a millisecond of slack for the timer's jitter).
    if (!host.presenting && context.settings.fpsLimit && now - drawnAt < 1000 / Math.max(10, context.settings.fpsLimitValue ?? 60) - 1) return;
    const dt = Math.min(0.1, Math.max(0, (now - drawnAt) / 1000));
    drawnAt = now;
    // The FPS counter follows the Options at once (Save in the pause menu's dialog).
    if (fpsCounter.visible !== !!context.settings.fpsCounter) fpsCounter.setVisible(!!context.settings.fpsCounter);
    fpsCounter.update(dt);
    if (replaying) return;
    // The draw distance follows the Options at once (Save in the pause menu's dialog).
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
    actOnHands(vr.drive());
    if (!ready) {
      steadyFrames = dt > 0 && dt < WARM_FRAME_S ? steadyFrames + 1 : 0;
      if ((poolsWarmed && steadyFrames >= WARM_FRAMES) || now - warmStart > WARM_LIMIT_MS) {
        ready = true;
        loading.hidden = true;
      }
    }
    if (ready && !busy && !paused && !finishing) {
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
              if (!spectator) cameraTarget = end.target;
              if (end.justFinished) viewMode = 4;
              // A watched race stays on screen when it is over, to be looked round as long as the spectator likes: the
              // pause menu's Results goes on to them.
              if (end.done && !finishing && spectator) watchedOver();
              else if (end.done && !finishing) finish();
            }
          }
        })
        .catch((err) => { if (!disposed) showMessage(err.message); })
        .finally(() => { busy = false; });
    }
    if (latest) {
      const shown = latest.poses.map((p, i) => seated(interpolatePose(p.previous, p.current, latest.alpha), i));
      // The world is a torus (MONSTER_EXE_ANALYSIS.md "The wrapping world"): every truck is drawn, heard and labelled
      // at the copy nearest the one the camera is on, as the game draws each at the copy nearest the view.
      // The picture's own space runs on without a seam: the watched truck is drawn at the copy nearest where it was drawn
      // last, so it, the camera and the marks it leaves never jump a world when the simulation wraps it. The world is
      // then placed around the camera (render/track-scene.js `placeBlocks`).
      const watchedPose = shown[cameraTarget] ?? shown[0];
      // The free camera (spectator mode) flies where it likes: the trucks are drawn at the copy nearest it, or they would
      // stay behind on the world it left.
      const flown = flyer?.enabled ? [camera.position.x, camera.position.y, -camera.position.z] : null;
      watchedPose.pos = drawAnchor = nearestCopy(watchedPose.pos, flown ?? drawAnchor ?? watchedPose.pos);
      for (const p of shown) {
        if (p !== watchedPose) p.pos = nearestCopy(p.pos, watchedPose.pos);
        if (p.heli?.pos) p.heli.pos = nearestCopy(p.heli.pos, watchedPose.pos);
      }
      shownPoses = shown;
      tireFx.update({
        dt: paused ? 0 : dt, listener: [camera.position.x, camera.position.y, -camera.position.z], flags: effectFlags(),
        noDust: weatherScene.weather === 4 || weatherScene.weather === 5,
        // With the light as the weather has it, dust is as dim as the ground it rose from.
        light: scenery.lightRig ? Math.min(1, weatherScene.lightLevel() * 1.15) : 1,
        // For "Rich particles": what each wheel stands on follows the weather and the snow, and what is thrown takes the scene's lights.
        weather: weatherScene.weather, camera, lights: { sun, ambient: ambientLight, hemisphere: scenery.lightRig?.hemisphere ?? null },
        snowDown: scenery.groundSurface?.snowDown ?? 0, viewHeight: host.presenting ? HEADSET_VIEW_HEIGHT : canvas.height, lite: host.presenting,
        trucks: shown.map((p, i) => ({
          object: drawn[i], pose: p, surface: latest.poses[i].sound ? { family: surfaceFamily(latest.poses[i].sound.surface), type: latest.poses[i].sound.surface } : null,
          // What the simulation says of each tire (its grip, the force through it, how fast it turns), for sliding and spinning.
          tires: latest.poses[i].sound?.tires ?? null, radius: seats[i].radius,
        })),
      });
      mtm1Particles?.update({
        dt: paused ? 0 : dt, camera, pixelSize: Math.max(1, Math.round((host.presenting ? HEADSET_VIEW_HEIGHT : canvas.height) / 480)),
        trucks: shown.map((p, i) => ({ object: drawn[i], pose: p, tires: latest.poses[i].sound?.tires ?? null, radius: seats[i].radius })),
      });
      contactShade?.update(shown, scenery.lightRig?.rig?.shadow ?? 1, weatherScene.weather === 5 ? build.waterLevelFt ?? null : null);
      helicopters?.update(shown.map((p) => p.heli ?? null), paused ? 0 : dt);
      lampClockMs += paused ? 0 : dt * 1000;
      const night = !!WEATHER_LOOK[weatherScene.weather]?.headlights;
      trackLights?.update(camera, night);
      const lampWeather = weatherScene.weather;
      startLamps?.update(camera, { daylight: WEATHER_LOOK[lampWeather]?.light ?? 1 });
      shown.forEach((p, i) => drawn[i].update(p, camera, {
        lamps: lamps[i], clockMs: lampClockMs, night, cockpit: i === 0 && viewMode === 0,
        // For the port's own lamps: what there is in the air to show a beam, and how light the day is.
        air: beamAir(lampWeather), daylight: WEATHER_LOOK[lampWeather]?.light ?? 1,
      }));
      if (!latest.damageHandled) {
        latest.damageHandled = true;
        latest.poses.forEach((p, i) => {
          crash.contacts(i, p.damage, (zone, level) => drawn[i].dent(zone, level));
          if (p.touch) tireFx.touch(i, p.touch.pos, p.touch.steps, p.touch.force, p.current.speed ?? 0, effectFlags(), p.touch.hull !== false);
          for (const d of p.damage ?? []) tireFx.hit(i, drawn[i], d.zone, d.steps, d.force, p.current.speed ?? 0, effectFlags());
        });
      }
      const listener = [camera.position.x, camera.position.y, -camera.position.z];
      const raceNow = latest.race;
      const clock = raceNow ? (raceNow.started ? 3 + raceNow.clock : 3 - raceNow.countdown) : null;
      truckAudio.update(dt, latest.poses.map((p, i) => ({ ...p, current: shown[i] === undefined ? p.current : { ...p.current, pos: shown[i].pos } })), listener, clock, entrants.map((_, i) => crash.damaged(i)));
      // The level's own sounds are placed in the simulation's world.
      worldAudio.update(dt, inWorld(listener), movedPositions);
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
      weatherScene.update(dt, shown.map((p, i) => ({ x: p.pos[0], y: p.pos[1], z: p.pos[2], heading: p.euler[2], lit: lamps[i] === 2, pool: pools[i], matrix: p.matrix })),
        { floorFt: waterLevelNow, viewHeight: host.presenting ? HEADSET_VIEW_HEIGHT : canvas.height, lite: host.presenting });
      // In a headset the seat follows the player's truck and the flat camera takes the head's place. The
      // RaceCam's truck (cameraTarget, another one once the player has finished) is the flat camera's only:
      // the cab and the seat's settings are the player's truck's, and a headset is never moved without warning.
      if (host.presenting) vr.place(shown[0], dt, camera);
      else if (flyer?.enabled) {
        flyer.step(paused ? 0 : dt);
        if (flyer.apply(camera, flyTarget)) camera.updateProjectionMatrix();
      } else placeCamera(shown[cameraTarget] ?? shown[0], dt);
      // Your own truck is not drawn from inside it.
      drawn[0].object.visible = viewMode !== 0 || host.presenting;
      const mine = latest.poses[0].current;
      gauges.setVisible(viewMode === 0 ? cockpitMode() === 1 : context.settings.dashboard !== false);
      gauges.set(mine);
      if (cockpit) {
        cockpit.setDashboard({ visible: viewMode === 0 && cockpitMode() === 0 && !host.presenting, speed: mine.speed, rpm: mine.rpm, gear: mine.gear, steer: mine.steer });
        const next = build.sim.checkpoints[latest.race?.trucks[0].checkpoint ?? 0];
        cockpit.setFinder({
          visible: context.settings.finder !== false && !!next && !summit && !freeRoam,
          angle: next ? finderAngle(inWorld(shown[0].pos), shown[0].euler[2], next.gate.position) : 90,
          number: (latest.race?.trucks[0].checkpoint ?? 0) + 1,
        });
      }
      if (minimap.visible) {
        minimap.set(shown.map((p, i) => ({ pos: inWorld(p.pos), heading: p.euler[2], place: latest.race?.trucks[i]?.place ?? i + 1, label: nameLine(nameLabel(namesMode, entrants[i], truckName)) })), dt);
      }
      if (latest.race && !finishing) showRace(latest.race, now);
      // Free roam has only the clock.
      else if (freeRoam && !latest.race) hud.set([[t("Clock:"), formatRaceTime(latest.time ?? 0)]]);
    } else if (host.presenting) vr.place(startPose, dt, camera);
    vr.update({ state: latest?.poses[0].current ?? startPose, timing: !!latest?.race, message: caption.active, light: weatherScene.lightLevel() });
    host.menu.update(now);
    if (!paused) caption.update(dt);
    // The water bobs a quarter foot every eight seconds (frozen in Snow), and under it the world is fogged to 320 ft with no sky.
    if (blimp && !paused) {
      blimp.update(dt);
      // The blimp flies in the simulation's world: drawn at the copy nearest the camera.
      const blimpAt = nearestCopy(blimp.state.pos, [camera.position.x, 0, -camera.position.z]);
      blimpObject.position.set(blimpAt[0], blimpAt[1], -blimpAt[2]);
      blimpObject.rotation.y = -blimp.state.heading;
      blimpObject.visible = viewMode !== 3;
      blimpHum?.then((v) => v?.setPosition(blimp.state.pos));
    }
    waterClock += dt;
    const water = waters[0];
    const bob = waterOffsetFt(waterClock, weatherScene.weather);
    for (const plane of waters) plane.position.y = bob;
    waterLevelNow = water ? water.userData.levelFt + bob : null;
    const under = isUnderwater(camera.position.y, water ? water.userData.levelFt + water.position.y : null, weatherScene.weather);
    weatherScene.setUnderwater(under);
    // How far under the eye is, for the lens: it comes on over the first half foot (docs/VISUALS.md, "Under water").
    scenery.underwater(under && water ? (water.userData.levelFt + water.position.y - camera.position.y) / 0.5 : 0, {
      dt: paused ? 0 : dt, levelFt: water ? water.userData.levelFt + water.position.y : null, viewHeight: host.presenting ? HEADSET_VIEW_HEIGHT : canvas.height,
    });
    tireFx.setWater(water ? water.userData.levelFt + water.position.y : null);
    if (latest && shownPoses) {
      waterFx.update(dt, {
        trucks: shownPoses.map((p) => ({ pos: p.pos, yaw: p.euler[2] })),
        camera: [camera.position.x, camera.position.y, -camera.position.z],
        level: water ? water.userData.levelFt + water.position.y : null, weather: weatherScene.weather,
      });
    }
    const sky = world.getObjectByName("sky");
    // The sky goes with the camera, up as well as across: it is never reached (render/track-scene.js `placeSky`).
    if (sky) { placeSky(sky, camera); sky.visible = weatherScene.skyShown; }
    if (latest?.crush) world.userData.crush = latest.crush;
    // After the sky is placed: the port's water shows it.
    // The wheels stir the water and the puddles (render/water-ripples.js).
    // How fast each wheel turns, as the simulation says: its tread beats the water white (game/water.js `wheelStir`).
    if (shownPoses) scenery.stir(shownPoses.map((p, i) => (p && drawn[i] ? { hubs: p.tires.map((_, k) => drawn[i].tireHub(k)), radiusFt: seats[i].radius, spins: latest?.poses[i]?.sound?.tires?.map((tire) => tire.spin) ?? null } : null)), paused ? 0 : dt);
    waterSurface?.update(dt, weatherScene.weather, { sun, light: weatherScene.lightLevel(), sky, fog: scene.fog, background, levelFt: water ? water.userData.levelFt + water.position.y : null });
    // A headset draws everything twice: terrain past the fog's end, which nothing can be seen of, is left out.
    const sight = vr.sight(scene.fog);
    updateTrackWorld(world, camera, dt, { viewRange: host.presenting ? sight : undefined, fineRange: host.presenting ? HEADSET_FINE_RANGE_FT : undefined });
    animateRex(paused ? 0 : dt);
    if (shadows) {
      shadows.setupMaterials();
      shadows.invalidateDynamic();
      shadows.update();
    }
    if (flare) {
      // A headset has no frame to draw the flare over: it stands in the scene instead.
      flare.setStereo(host.presenting);
      flare.update(camera, sunTravel, true, weatherScene.weather <= 1, flareBlocked);
    }
    // The lens is the flat screen's (render/lens.js): a headset draws each eye straight to its display.
    truckReflections?.update(camera, weatherScene.weather);
    // The world mirrored in the water, drawn first, without the trucks' reflections (the game draws none in it).
    if (waterMirror && !host.presenting) {
      truckReflections?.setVisible(false);
      waterMirror.render(camera);
      truckReflections?.setVisible(true);
    }
    if (host.presenting) scenery.draw(host.camera, { plain: true }); else scenery.draw(camera);
    // Once the scene has been drawn with the trucks in it, so every material is as it will be and what waits unseen
    // (the helicopters) is there: the shaders of all of it, and for the headlights' pools shown and hidden, built
    // before a rescue or the Headlights key needs them (render/weather-scene.js `warmPools`).
    if (!poolsWarmed) { poolsWarmed = true; weatherScene.warmPools(() => scenery.compile(camera)); }
    if (!host.presenting) renderMirror();
    flare?.render(renderer, camera);
    gold?.afterRender(dt, build.title ?? track.name);
  };
  // MTM1's TREX code (game/cheats.js): the player's truck drawn as the dinosaur, its four frames looping, until the race ends.
  let rex = null, rexClock = 0;
  const becomeRex = () => {
    if (rex) return null;
    if (!build.rex) return "TREX: REX.BIN is not in any mounted archive (it is in Monster Truck Madness 1's GAME.POD).";
    const library = createModelLibrary({ [build.rex.model.name]: build.rex.model }, build.rex.textures, look);
    const group = new THREE.Group(), meshes = [];
    for (const { geometry, material } of library.get(build.rex.model.name) ?? []) { const mesh = new THREE.Mesh(geometry, material); group.add(mesh); meshes.push(mesh); }
    // The game sets the tires 24 ft under the truck's origin: here the wheels stay and the dinosaur stands that high over their hubs.
    const hubs = build.truckModels[entrants[0].file].anchors;
    group.position.y = TREX.tireDropFt + hubs.reduce((sum, hub) => sum + hub[1], 0) / hubs.length;
    drawn[0].setStandIn(group);
    rex = { meshes, frames: build.rex.model.keyframes?.length ?? 0, seconds: build.rex.model.frameSeconds || 1 };
    return "TREX";
  };
  const animateRex = (dt) => {
    if (!rex || rex.frames < 2) return;
    rexClock += dt;
    const weights = keyframeWeights(rexClock, rex.frames, rex.seconds);
    for (const mesh of rex.meshes) if (mesh.morphTargetInfluences) for (let f = 1; f < rex.frames; f++) mesh.morphTargetInfluences[f - 1] = weights[f];
  };
  host.start(scene, loop);
  showVrMenu();
  gold = createGoldMode({
    window, sim, scene, camera, renderer, canvas, view, build, font: hudFont, scale, t, track, setWeather, audio, trex: becomeRex,
    getWeather: () => weatherScene.weather,
    flash: (text) => flash(text, performance.now()),
    zCameras,
    physicsLine: () => zPhysicsLine(latest?.poses[0]?.sound, physics),
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
      ...(spectator ? {
        fly: {
          usage: "fly <0|1>", help: "the free camera in a watched race (the B key)",
          run: ([word]) => {
            const on = onOff(word);
            if (on === null) return `Usage: fly <0|1>. Now ${said(!!flyer.enabled)}.`;
            return `Free camera ${said(setFlying(on))}.`;
          },
        },
        watch: {
          usage: "watch <n>", help: `the truck the camera is on, 1 to ${entrants.length}`,
          run: ([word]) => {
            const n = Math.trunc(Number(word));
            if (!(n >= 1 && n <= entrants.length)) return `Usage: watch <1-${entrants.length}>. Now ${cameraTarget + 1}, ${truckName(entrants[cameraTarget].file)}.`;
            watch(n - 1);
            return `Watching ${truckName(entrants[cameraTarget].file)}.`;
          },
        },
      } : {}),
      physics: {
        usage: "physics <model>", help: `the physics model: ${PHYSICS_MODELS.map((m) => `${m.id} ${m.label}`).join(", ")} (restarts the race)`,
        complete: () => PHYSICS_MODELS.map((m) => m.id),
        run: ([word]) => {
          const model = PHYSICS_MODELS.find((m) => m.id === (word ?? "").toLowerCase());
          if (!model) return `Usage: physics <${PHYSICS_MODELS.map((m) => m.id).join("|")}>. Now ${physics} (${physicsModel(physics).label}).`;
          context.settings.physics = model.id;
          saveSettings(context.settings);
          restart({ physics: model.id });
          return `Physics: ${model.label}.`;
        },
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
      fps: {
        usage: "fps <0|1>", help: "the FPS counter on or off",
        run: ([word]) => {
          const on = onOff(word);
          if (on === null) return `Usage: fps <0|1>. Now ${said(!!context.settings.fpsCounter)}.`;
          context.settings.fpsCounter = on;
          fpsCounter.setVisible(on);
          saveSettings(context.settings);
          return `FPS counter ${said(on)}.`;
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
          // Sonic is Professional with the computer trucks driving as on a Sonic track (Options, Advanced).
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
      quit: { help: "leaves the race for the Races screen", run: () => { leave(); } },
    };
    context.consoleHistory ??= [];
    commands.distance = distanceCommand(context);
    // A tournament under way (app/tournament.js): where it stands, and moving between its events.
    commands.tourney = {
      usage: "tourney [next|prev|goto <n>]", help: "the tournament's events: the status, or another event (one passed over scores nothing)",
      complete: () => ["next", "prev", "goto"],
      run: async ([word, number]) => {
        const tournament = context.tournament;
        if (!tournament) return "No tournament is under way. Start one from the Races screen.";
        const { run } = tournament, list = () => run.events.map((e, i) => `${i === run.current ? ">" : " "} ${i + 1}. ${e.name}${e.points ? " (run)" : e.skipped ? " (passed over)" : ""}`).join("\n");
        const to = word === "next" ? run.current + 1 : word === "prev" ? run.current - 1 : word === "goto" ? Number(number) - 1 : null;
        if (to === null || !Number.isInteger(to)) return `${run.name}\n${list()}\nUsage: tourney [next|prev|goto <n>]`;
        if (to < 0 || to > run.events.length) return `The tournament has events 1 to ${run.events.length}.`;
        const event = await moveToEvent(context, to);
        if (!event) { context.router.go("tournament", {}, { replace: true }); return "The tournament is over."; }
        await runEvent(context);
        return `Event ${to + 1}: ${event.name}.`;
      },
    };
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
