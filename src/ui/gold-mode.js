/*
  GOLD mode in the race (MONSTER_EXE_ANALYSIS.md section 15). Typing GOLD during a race turns
  the game's debug keys on and off; typing FRAME shows the frame rate. With GOLD on:

    R        reverse the course (`0x647564`)
    Ctrl+T   the player's autopilot: off, auto throttle, full autopilot
    Ctrl+B   collision boxes: wireframe, solid, off
    Ctrl+Y   slew mode: the race stands still and the truck is moved by hand
             (arrows move, Q and A up and down, End and Page Down yaw, Home and Page Up roll,
             F5 and F8 pitch, Shift faster)
    Z        Z mode, on and off at any time (slew mode or not): the technical overlay (zoom, level,
             polygons), - and + zoom the view (0.5x to 16x), Ctrl+L loads a SIT by name, and X stops
             the computer trucks' autopilot and starts it again (a single-player race). The View keys
             (Insert and Delete) swing the chase camera round the truck in Z mode as in any race.
    0        a screenshot (4 in slew mode), saved as a PNG download
    Ctrl+W   the weather cycle, through the weathers the track allows

  Browsers keep Ctrl+T, Ctrl+W and Ctrl+L, so Alt works in place of Ctrl for every key.

  The Z-mode cameras option (Options, Advanced; not the game's) gives the zoom and Ctrl+L in any race, with no GOLD
  and no slew mode, without the overlay. With it the zoom is the port's own in three more ways: held down, - and +
  (with Shift) go on zooming smoothly after the game's first step; a gamepad's D-pad left and right zoom out and in;
  and the zoom is kept for the next races (`settings.zModeZoom`).
*/
import * as THREE from "three";
import { createCollisionOverlay } from "../render/collision-overlay.js";
import { createTextPanel } from "../render/bitmap-text.js";
import { cheatTyped, typeKey } from "../game/cheats.js";
import { nextWeather, weatherName } from "../game/weather.js";
import { createStrings, msg } from "../game/strings.js";

const AUTOPILOT_NAMES = [msg("off"), msg("auto throttle"), msg("full autopilot")];
export { ZOOM_ONE, ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, zoomFactor, heldZoom, keptZoom } from "../game/z-zoom.js";
import { ZOOM_ONE, ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, ZOOM_HOLD_S, zoomFactor, heldZoom, keptZoom } from "../game/z-zoom.js";
const OVERLAY_NAMES = { off: msg("off"), wireframe: msg("wireframe"), solid: msg("solid") };

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
  // `zoomValue`: the camera's zoom as the game keeps it (16.16, 0x10000 the view's own; MONSTER_EXE_ANALYSIS.md 11), `zoom` the factor it gives.
  const state = { gold: false, fps: false, slew: false, zMode: false, zoom: 1, zoomValue: ZOOM_ONE, screenshot: false, dance: false };
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
  let typed = "", shots = 0, frameS = 1 / 60;
  const down = new Set();

  const command = async (name) => sim.call("command", { name });
  const setZoom = (value, { keep = true } = {}) => {
    state.zoomValue = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
    state.zoom = zoomFactor(state.zoomValue);
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix();
    // The option's zoom is kept for the next races; Z mode's own is not.
    if (keep && env.zCameras?.()) env.onZoom?.(state.zoomValue);
  };
  // The zoom kept from the last race, with the option.
  if (env.zCameras?.() && keptZoom(env.savedZoom) !== null) setZoom(env.savedZoom, { keep: false });
  /** The zoom held: -1 out, +1 in, 0 none; and for how long. The pad's D-pad (`padZoom`) is read each frame. */
  let holdWay = 0, heldFor = 0, padWay = 0, padFor = 0;
  const isZoomOut = (code) => code === "Minus" || code === "NumpadSubtract";
  const isZoomIn = (code) => code === "Equal" || code === "NumpadAdd";

  function onKeyDown(e) {
    down.add(e.code);
    // A held zoom key's repeats are the hold's (`stepHold`), not more steps.
    if (e.repeat) return holdWay !== 0 && (isZoomOut(e.code) || isZoomIn(e.code));
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
      // The game's steps: - widens by 0x1000, = narrows by 0x1000 (0x52cd90).
      const shown = () => flash(t("Zoom <<1>>x", Math.round(state.zoom * 100) / 100));
      if (zoomKey && isZoomOut(e.code)) { setZoom(state.zoomValue + ZOOM_STEP); holdWay = -1; heldFor = 0; shown(); return true; }
      if (zoomKey && isZoomIn(e.code)) { setZoom(state.zoomValue - ZOOM_STEP); holdWay = 1; heldFor = 0; shown(); return true; }
      if (chord && e.code === "KeyL" && env.loadSit) { e.preventDefault(); env.loadSit(); return true; }
    }
    // X in Z mode: every computer truck's autopilot off, or on again (0x585da0); X alone is Crash Damage.
    if (state.zMode && !chord && e.code === "KeyX") {
      e.preventDefault();
      command("cpuStop").then((on) => { if (on !== null) flash(t("Computer trucks: <<1>>", on ? t("stopped") : t("driving"))); });
      return true;
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
    if (e.code === "KeyZ" && !chord) {
      state.zMode = !state.zMode;
      zPanel.element.hidden = !state.zMode;
      // Leaving Z mode puts the view's own zoom back, unless the option keeps its keys.
      if (!state.zMode && !env.zCameras?.()) setZoom(ZOOM_ONE);
      flash(t("Z mode: <<1>>", onOff(state.zMode)));
      return true;
    }
    return false;
  }
  const onKeyUp = (e) => {
    down.delete(e.code);
    if ((holdWay < 0 && isZoomOut(e.code)) || (holdWay > 0 && isZoomIn(e.code)) || e.code.startsWith("Shift")) holdWay = 0;
  };
  /** The hold's zoom, per frame: a key held past ZOOM_HOLD_S, or the D-pad, zooms on smoothly. */
  const stepHold = (dt) => {
    if (!(dt > 0)) return;
    const shiftHeld = down.has("ShiftLeft") || down.has("ShiftRight");
    if (holdWay && !(zKeys() && (state.zMode || shiftHeld))) holdWay = 0;
    let way = 0;
    if (holdWay) { heldFor += dt; if (heldFor > ZOOM_HOLD_S) way = holdWay; }
    if (padWay && zKeys()) {
      // The D-pad's first touch is one of the game's steps, as a key's; held, it goes on as a key does.
      if (padFor === 0) setZoom(state.zoomValue - padWay * ZOOM_STEP);
      padFor += dt;
      if (padFor > ZOOM_HOLD_S) way = padWay;
    } else padFor = 0;
    if (!way) return;
    setZoom(heldZoom(state.zoomValue, way, dt));
    flash(t("Zoom <<1>>x", Math.round(state.zoom * 100) / 100));
  };
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
    stepHold(dt);
    // The frame time smoothed, not the rate (game/fps.js): uneven frames read at their true rate.
    if (dt > 0) frameS += (dt - frameS) * 0.1;
    if (state.fps) fpsPanel.set([`fps : ${(1 / frameS).toFixed(1)}`]);
    if (state.dance) drawScope();
    if (state.zMode) {
      // MTM1's Z mode adds a physics line under the overlay (0x44a1b0); `env.physicsLine` gives what the page knows of it.
      const physics = env.physicsLine?.();
      zPanel.set([t("Zoom <<1>>x", Math.round(state.zoom * 100) / 100), t("Level <<1>>", levelName), t("Polygons <<1>>/<<2>>", renderer.info.render.triangles, totalTriangles), t("Models <<1>>", build.objects?.length ?? 0), ...(physics ? [physics] : [])]);
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
    /** The gamepad's zoom this frame: -1 (D-pad left, out), +1 (right, in) or 0. */
    padZoom(way) { padWay = Math.sign(way || 0); },
    /** The sim polling needs the slew keys only while slewing. */
    get slewing() { return state.slew; },
    /** Whether GOLD mode takes this key itself (0, and 4 in slew mode, are its screenshot), so a number key picks no view. */
    claims: (e) => state.gold && !e.ctrlKey && !e.altKey && (e.code === "Digit0" || (state.slew && e.code === "Digit4")),
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
