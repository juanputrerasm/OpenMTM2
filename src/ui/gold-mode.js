/*
  GOLD mode in the race (MONSTER_EXE_ANALYSIS.md section 15). Typing GOLD during a race turns
  the game's debug keys on and off; typing FRAME shows the frame rate. With GOLD on:

    R        reverse the course (`0x647564`)
    Ctrl+T   the player's autopilot: off, auto throttle, full autopilot
    Ctrl+B   collision boxes: wireframe, solid, off
    Ctrl+Y   slew mode: the race stands still and the truck is moved by hand
             (arrows move, Q and A up and down, End and Page Down yaw, Home and Page Up roll,
             F5 and F8 pitch, Shift faster)
    Z        in slew mode, Z mode: the technical overlay (zoom, level, polygons), - and + zoom the view
             (0.5x to 16x), Insert and Delete swing the camera round the truck, Ctrl+L loads a SIT by
             name. Z mode stays on when slew mode is left (Ctrl+Y again), so the race is driven with
             its zoom and its camera; Z in slew mode turns it off.
    0        a screenshot (4 in slew mode), saved as a PNG download
    Ctrl+W   the weather cycle, through the weathers the track allows

  Browsers keep Ctrl+T, Ctrl+W and Ctrl+L, so Alt works in place of Ctrl for every key.

  The Z-mode cameras option (Options, Advanced; not the game's) gives the zoom, the orbit and Ctrl+L in
  any race, with no GOLD and no slew mode, without the overlay.
*/
import * as THREE from "three";
import { createCollisionOverlay } from "../render/collision-overlay.js";
import { createTextPanel } from "../render/bitmap-text.js";
import { cheatTyped, typeKey } from "../game/cheats.js";
import { nextWeather, weatherName } from "../game/weather.js";
import { createStrings, msg } from "../game/strings.js";

const AUTOPILOT_NAMES = [msg("off"), msg("auto throttle"), msg("full autopilot")];
const OVERLAY_NAMES = { off: msg("off"), wireframe: msg("wireframe"), solid: msg("solid") };
/** How fast Insert and Delete swing the camera. */
const ORBIT_RAD_PER_S = 1.2;

/**
 * @param {{ window: Window, sim: { call: Function }, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
 *   renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, view: HTMLElement, build: object,
 *   font: object|null, scale: number, flash: (text: string) => void, t: (tag: string) => string,
 *   track: { weatherMask: number }, setWeather: (weather: number) => Promise<void>, getWeather: () => number }} env
 */
export function createGoldMode(env) {
  const { window: win, sim, scene, camera, renderer, canvas, view, build, font, scale, flash } = env;
  // The codes typed (GOLD, FRAME, DANCE, TREX) are the game's and stay; what they say is translated.
  const t = env.t ?? createStrings();
  const onOff = (on) => (on ? t("on") : t("off"));
  const totalTriangles = countTriangles(scene);
  const overlay = createCollisionOverlay(build.sim.boxes, build.sim.ramps);
  scene.add(overlay.object);
  const fpsPanel = createTextPanel(font, { width: 80, scale });
  const zPanel = createTextPanel(font, { width: 150, scale });
  for (const [panel, cls] of [[fpsPanel, "gold-fps"], [zPanel, "gold-z"]]) {
    panel.element.classList.add("gold-overlay", cls);
    panel.element.hidden = true;
    view.append(panel.element);
  }
  const state = { gold: false, fps: false, slew: false, zMode: false, zoom: 1, turn: 0, screenshot: false, dance: false };
  // DANCE: the mixer's output as a line across the view, over three guide lines (the middle and 64 lines either side of 480).
  const scope = win.document.createElement("canvas");
  scope.className = "gold-scope";
  scope.hidden = true;
  view.append(scope);
  const scopeData = new Uint8Array(1024);
  const drawScope = () => {
    const w = view.clientWidth, h = view.clientHeight;
    if (scope.width !== w || scope.height !== h) { scope.width = w; scope.height = h; }
    const g = scope.getContext("2d"), mid = h / 2, k = h / 480;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(160, 160, 160, 0.8)";
    g.beginPath();
    for (const y of [mid - 64 * k, mid, mid + 64 * k]) { g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
    env.audio?.waveform?.(scopeData);
    g.strokeStyle = "#fff";
    g.beginPath();
    // A quarter of the sample's swing, as the game draws it: full scale reaches the guide lines.
    for (let x = 0; x < w; x++) {
      const y = mid + ((scopeData[Math.floor((x / w) * scopeData.length)] - 128) / 2) * k;
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  };
  /** Whether the Z-mode keys act: in Z mode, or always with the option. */
  const zKeys = () => state.zMode || !!env.zCameras?.();
  let typed = "", shots = 0, fps = 60;
  const down = new Set();

  const command = async (name) => sim.call("command", { name });
  const setZoom = (z) => {
    state.zoom = Math.max(0.5, Math.min(16, z));
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix();
  };

  function onKeyDown(e) {
    down.add(e.code);
    if (e.repeat) return false;
    if (!e.ctrlKey && !e.altKey) {
      typed = typeKey(typed, e.code);
      const code = cheatTyped(typed);
      if (code === "GOLD") { state.gold = !state.gold; typed = ""; flash(`GOLD ${onOff(state.gold)}`); }
      if (code === "FRAME") { state.fps = !state.fps; typed = ""; fpsPanel.element.hidden = !state.fps; }
      // Monster Truck Madness 1's two (MTM1_MONSTER_EXE_ANALYSIS.md 3).
      if (code === "DANCE") { state.dance = !state.dance; typed = ""; scope.hidden = !state.dance; }
      if (code === "TREX") { typed = ""; const said = env.trex?.(); if (said) flash(t(said)); }
    }
    const chord = e.ctrlKey || e.altKey;
    if (zKeys()) {
      // In Z mode - and + zoom, as in the game. With only the Z-mode cameras option they zoom with Shift: alone they
      // tilt the chase camera (the Camera up and down keys).
      const zoomKey = !chord && (state.zMode || e.shiftKey);
      if (zoomKey && (e.code === "Minus" || e.code === "NumpadSubtract")) { setZoom(state.zoom / 2); flash(t("Zoom <<1>>x", state.zoom)); return true; }
      if (zoomKey && (e.code === "Equal" || e.code === "NumpadAdd")) { setZoom(state.zoom * 2); flash(t("Zoom <<1>>x", state.zoom)); return true; }
      if (chord && e.code === "KeyL" && env.loadSit) { e.preventDefault(); env.loadSit(); return true; }
    }
    if (!state.gold) return false;
    const done = (promise) => { e.preventDefault(); return promise; };
    if (e.code === "KeyR" && !chord) {
      done(command("reverse").then((on) => flash(t("Reverse course: <<1>>", onOff(on)))));
      return false;
    }
    if (chord && e.code === "KeyT") { done(command("autopilot").then((n) => flash(t("Autopilot: <<1>>", t(AUTOPILOT_NAMES[n]))))); return true; }
    if (chord && e.code === "KeyB") { done(Promise.resolve(overlay.cycle()).then((m) => flash(t("Collision boxes: <<1>>", t(OVERLAY_NAMES[m] ?? m))))); return true; }
    if (chord && e.code === "KeyW") {
      const next = nextWeather(env.getWeather(), env.track.weatherMask);
      done(env.setWeather(next).then(() => flash(t("Weather: <<1>>.", t(weatherName(next))))));
      return true;
    }
    if (chord && e.code === "KeyY") {
      done(command("slew").then((on) => {
        state.slew = on;
        // Z mode outlives slew mode, as in the game: its zoom and camera go on while driving.
        flash(t("Slew mode: <<1>>", onOff(on)));
      }));
      return true;
    }
    if (e.code === "Digit0" || (state.slew && e.code === "Digit4")) { state.screenshot = true; return true; }
    if (state.slew && e.code === "KeyZ") {
      state.zMode = !state.zMode;
      zPanel.element.hidden = !state.zMode;
      // Leaving Z mode puts the view back, unless the option keeps its keys.
      if (!state.zMode && !env.zCameras?.()) { setZoom(1); state.turn = 0; }
      flash(t("Z mode: <<1>>", onOff(state.zMode)));
      return true;
    }
    return false;
  }
  const onKeyUp = (e) => down.delete(e.code);
  win.addEventListener("keydown", onKeyDown);
  win.addEventListener("keyup", onKeyUp);

  /** The slew input for the simulation: held keys as -1, 0 or 1 per axis. */
  function slewInput() {
    const axis = (plus, minus) => (plus.some((c) => down.has(c)) ? 1 : 0) - (minus.some((c) => down.has(c)) ? 1 : 0);
    return {
      forward: axis(["ArrowUp"], ["ArrowDown"]), right: axis(["ArrowRight"], ["ArrowLeft"]), up: axis(["KeyQ"], ["KeyA"]),
      yaw: axis(["PageDown"], ["End"]), roll: axis(["PageUp"], ["Home"]), pitch: axis(["F8"], ["F5"]),
      fast: down.has("ShiftLeft") || down.has("ShiftRight"),
    };
  }

  /** Per frame, after the world is drawn. */
  function afterRender(dt, levelName) {
    if (dt > 0) fps += (1 / dt - fps) * 0.1;
    // Insert and Delete swing the camera round the truck while held (the chase views).
    if (zKeys() && dt > 0) state.turn += ((down.has("Insert") ? 1 : 0) - (down.has("Delete") ? 1 : 0)) * ORBIT_RAD_PER_S * Math.min(dt, 0.1);
    if (state.fps) fpsPanel.set([`fps : ${fps.toFixed(1)}`]);
    if (state.dance) drawScope();
    if (state.zMode) {
      // MTM1's Z mode adds a physics line under the overlay (0x44a1b0); `env.physicsLine` gives what the page knows of it.
      const physics = env.physicsLine?.();
      zPanel.set([t("Zoom <<1>>x", state.zoom), t("Level <<1>>", levelName), t("Polygons <<1>>/<<2>>", renderer.info.render.triangles, totalTriangles), t("Models <<1>>", build.objects?.length ?? 0), ...(physics ? [physics] : [])]);
    }
    if (state.screenshot) {
      state.screenshot = false;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `vel${String(++shots).padStart(4, "0")}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        flash(t("Saved <<1>>", link.download));
      }, "image/png");
    }
  }

  return {
    state, slewInput, afterRender,
    /** Whether - and + are Z mode's zoom just now, and not the camera's tilt. */
    get zooming() { return state.zMode; },
    /** How far Z mode has swung the chase camera round the truck, radians. */
    get cameraTurn() { return zKeys() ? state.turn : 0; },
    /** The sim polling needs the slew keys only while slewing. */
    get slewing() { return state.slew; },
    dispose() {
      scope.remove();
      win.removeEventListener("keydown", onKeyDown);
      win.removeEventListener("keyup", onKeyUp);
      scene.remove(overlay.object);
      overlay.dispose();
    },
  };
}

function countTriangles(scene) {
  let n = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const per = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
    n += per * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(n);
}
