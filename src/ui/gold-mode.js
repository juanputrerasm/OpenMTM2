/*
  GOLD mode in the race (MONSTER_EXE_ANALYSIS.md section 15). Typing GOLD during a race turns
  the game's debug keys on and off; typing FRAME shows the frame rate. With GOLD on:

    R        reverse the course (`0x647564`)
    Ctrl+T   the player's autopilot: off, auto throttle, full autopilot
    Ctrl+B   collision boxes: wireframe, solid, off
    Ctrl+Y   slew mode: the race stands still and the truck is moved by hand
             (arrows move, Q and A up and down, End and Page Down yaw, Home and Page Up roll,
             F5 and F8 pitch, Shift faster)
    Z        in slew mode, the technical overlay: zoom (- and + change it), level, polygons
    0        a screenshot (4 in slew mode), saved as a PNG download
    Ctrl+W   the weather cycle, through the weathers the track allows

  Browsers keep Ctrl+T and Ctrl+W, so Alt works in place of Ctrl for every key.
*/
import * as THREE from "three";
import { createCollisionOverlay } from "../render/collision-overlay.js";
import { createTextPanel } from "../render/bitmap-text.js";
import { cheatTyped, typeKey } from "../game/cheats.js";
import { nextWeather, weatherName } from "../game/weather.js";

const AUTOPILOT_NAMES = ["off", "auto throttle", "full autopilot"];

/**
 * @param {{ window: Window, sim: { call: Function }, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
 *   renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, view: HTMLElement, build: object,
 *   font: object|null, scale: number, flash: (text: string) => void, t: (tag: string) => string,
 *   track: { weatherMask: number }, setWeather: (weather: number) => Promise<void>, getWeather: () => number }} env
 */
export function createGoldMode(env) {
  const { window: win, sim, scene, camera, renderer, canvas, view, build, font, scale, flash } = env;
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
  const state = { gold: false, fps: false, slew: false, zMode: false, zoom: 1, screenshot: false };
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
      if (code === "GOLD") { state.gold = !state.gold; typed = ""; flash(`GOLD ${state.gold ? "on" : "off"}`); }
      if (code === "FRAME") { state.fps = !state.fps; typed = ""; fpsPanel.element.hidden = !state.fps; }
    }
    if (!state.gold) return false;
    const chord = e.ctrlKey || e.altKey;
    const done = (promise) => { e.preventDefault(); return promise; };
    if (e.code === "KeyR" && !chord) {
      done(command("reverse").then((on) => flash(`Reverse course: ${on ? "on" : "off"}`)));
      return false;
    }
    if (chord && e.code === "KeyT") { done(command("autopilot").then((n) => flash(`Autopilot: ${AUTOPILOT_NAMES[n]}`))); return true; }
    if (chord && e.code === "KeyB") { done(Promise.resolve(overlay.cycle()).then((m) => flash(`Collision boxes: ${m}`))); return true; }
    if (chord && e.code === "KeyW") {
      const next = nextWeather(env.getWeather(), env.track.weatherMask);
      done(env.setWeather(next).then(() => flash(`Weather: ${env.t(weatherName(next))}`)));
      return true;
    }
    if (chord && e.code === "KeyY") {
      done(command("slew").then((on) => {
        state.slew = on;
        if (!on) { state.zMode = false; zPanel.element.hidden = true; setZoom(1); }
        flash(`Slew mode: ${on ? "on" : "off"}`);
      }));
      return true;
    }
    if (e.code === "Digit0" || (state.slew && e.code === "Digit4")) { state.screenshot = true; return true; }
    if (state.slew && e.code === "KeyZ") { state.zMode = !state.zMode; zPanel.element.hidden = !state.zMode; return true; }
    if (state.slew && state.zMode && (e.code === "Minus" || e.code === "NumpadSubtract")) { setZoom(state.zoom / 2); return true; }
    if (state.slew && state.zMode && (e.code === "Equal" || e.code === "NumpadAdd")) { setZoom(state.zoom * 2); return true; }
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
    if (state.fps) fpsPanel.set([`fps : ${fps.toFixed(1)}`]);
    if (state.zMode) {
      zPanel.set([`Zoom ${state.zoom}x`, `Level ${levelName}`, `Polygons ${renderer.info.render.triangles}/${totalTriangles}`, `Models ${build.objects?.length ?? 0}`]);
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
        flash(`Saved ${link.download}`);
      }, "image/png");
    }
  }

  return {
    state, slewInput, afterRender,
    /** The sim polling needs the slew keys only while slewing. */
    get slewing() { return state.slew; },
    dispose() {
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
