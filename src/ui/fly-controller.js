/*
  The fly camera as a screen uses it: the keys and the mouse (game/input/fly-controls.js) driving the camera
  (game/fly-camera.js), the control scheme and its change, following the course, and the list of keys the O key shows.
  The fly-by screen flies with it throughout; a race watched in spectator mode switches it on and off.

  The owner calls `step(dt)` each frame and `apply(camera)` to place a three.js camera; it tells the controller when
  the keys are not its to take (`blocked`).
*/
import { el } from "./dom.js";
import { createTextPanel } from "../render/bitmap-text.js";
import {
  FLY_SCHEMES, FLY_SCHEME_NAMES, createCourseTour, createFlyCamera, flyForward, nextFlyScheme, startTourNear, stepCourseTour, stepFlyCamera,
} from "../game/fly-camera.js";
import { FLY_HELP, flyInput, flyKeyCodes, flyKeyLines, flyUsesMouse } from "../game/input/fly-controls.js";
import { createStrings, msg } from "../game/strings.js";

/** The keys the controller takes for itself whatever the scheme: the scheme, following the course (T, the tour: F is
 * Hellbender's turbo), the list. */
export const FLY_SCHEME_KEY = "KeyC", FLY_FOLLOW_KEY = "KeyT", FLY_LIST_KEY = "KeyO";

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas the mouse looks around over it
 * @param {object} options.settings `flyControls` is read and written
 * @param {() => void} options.save stores the settings
 * @param {object[]} options.course the track's course, to follow
 * @param {boolean} options.courseOpen a one-way course
 * @param {(x: number, z: number) => number} options.groundAt
 * @param {(text: string, seconds?: number) => void} options.say a line for the caption
 * @param {() => boolean} options.blocked whether the keys are someone else's now (a pause, the console)
 * @param {number} options.baseFov the view's field of view at zoom 1, degrees
 * @param {object} [options.font] the game's bitmap font (render/bitmap-text.js) the list of keys is drawn in, as the HUD is
 */
export function createFlyController({ canvas, settings, save, course = [], courseOpen = false, groundAt, say = () => {}, blocked = () => false, baseFov = 60, font = null, t = createStrings() }) {
  const fly = createFlyCamera();
  const tour = createCourseTour(course, { open: courseOpen });
  let scheme = FLY_SCHEMES.includes(settings.flyControls) ? settings.flyControls : "traxx";
  let enabled = false, following = false, lookX = 0, lookY = 0, zoomSteps = 0, dragging = false, lastMouse = null;
  const held = new Set();
  const list = el("div", { class: font ? "fly-keys fly-keys-font" : "fly-keys", hidden: true });
  // In the game's font the keys are its yellow and what they do white, a row each, under the scheme's name.
  const panel = font ? createTextPanel(font, { fit: true, scale: Math.max(1, Math.round(window.innerHeight / 480)), labelColor: "#f2c14e", valueColor: "#ffffff" }) : null;
  if (panel) list.append(panel.element);

  const drawList = () => {
    const title = following ? t("<<1>>, following the course", FLY_SCHEME_NAMES[scheme]) : FLY_SCHEME_NAMES[scheme];
    const lines = flyKeyLines(scheme, { following, course: !!tour, t }).map((line) => {
      const [key, ...rest] = line.split(": ");
      return [key, rest.join(": ")];
    });
    if (panel) { panel.set([title, "", ...lines]); return; }
    list.replaceChildren(
      el("p", { class: "fly-keys-title" }, title),
      ...lines.map(([key, what]) => el("p", {}, el("span", { class: "fly-key" }, key), what)));
  };
  const announce = () => say(`${FLY_SCHEME_NAMES[scheme]}. ${t(FLY_HELP[scheme])}. ${t("O: keys")}`, 5);
  const setScheme = (next) => {
    if (!FLY_SCHEMES.includes(next)) return;
    scheme = next;
    settings.flyControls = next;
    save?.();
    held.clear();
    drawList();
    announce();
  };
  const setFollowing = (on) => {
    if (on && !tour) { say(t("This track has no course to follow"), 3); return false; }
    following = !!on;
    if (following) startTourNear(tour, fly.pos[0], fly.pos[2]);
    drawList();
    say(following ? t("Following the course. Up and Down change the speed, T stops") : t("Flying free"), 4);
    return following;
  };

  const onKeyDown = (event) => {
    if (!enabled || blocked() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === FLY_SCHEME_KEY && !event.repeat) { setScheme(nextFlyScheme(scheme)); event.stopImmediatePropagation(); return; }
    if (event.code === FLY_FOLLOW_KEY && !event.repeat) { setFollowing(!following); event.stopImmediatePropagation(); return; }
    if (event.code === FLY_LIST_KEY && !event.repeat) { list.hidden = !list.hidden; event.stopImmediatePropagation(); return; }
    if (flyKeyCodes(scheme).has(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); held.add(event.code); }
  };
  const onKeyUp = (event) => held.delete(event.code);
  const onBlur = () => { held.clear(); dragging = false; };
  const onMouseDown = (event) => { if (enabled && event.button === 0 && flyUsesMouse(scheme) && !blocked()) { dragging = true; lastMouse = [event.clientX, event.clientY]; } };
  const onMouseMove = (event) => {
    if (!dragging) return;
    lookX += event.clientX - lastMouse[0];
    lookY += event.clientY - lastMouse[1];
    lastMouse = [event.clientX, event.clientY];
  };
  const onMouseUp = () => { dragging = false; };
  // Scrolling down (toward the player) zooms out, as in JSTrackViewer.
  const onWheel = (event) => { if (enabled && flyUsesMouse(scheme) && !blocked()) { event.preventDefault(); zoomSteps += event.deltaY > 0 ? -1 : 1; } };
  // Capturing, so a screen with keys of its own (a race) does not also act on a key the camera took.
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  drawList();

  return {
    fly, element: list,
    get scheme() { return scheme; },
    get enabled() { return enabled; },
    get following() { return following; },
    get hasCourse() { return !!tour; },
    setScheme, setFollowing, announce,
    /** Whether the list of keys is shown. */
    get listShown() { return !list.hidden; },
    showList(on) { list.hidden = !on; },
    /** Take the keys and the mouse, or give them back. Switched off, nothing is held and the list is put away. */
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) { held.clear(); dragging = false; list.hidden = true; }
    },
    /** Put the camera at `pos` (game feet), looking along `yaw`. */
    place(pos, yaw = fly.yaw, pitch = fly.pitch) {
      fly.pos[0] = pos[0]; fly.pos[1] = pos[1]; fly.pos[2] = pos[2];
      fly.yaw = yaw; fly.pitch = pitch; fly.roll = 0;
      if (following && tour) startTourNear(tour, pos[0], pos[2]);
    },
    /** Let go of every key (a pause began). */
    release() { held.clear(); dragging = false; },
    /** Move the camera by `dt` seconds of what is held. */
    step(dt) {
      if (enabled && !blocked()) {
        const input = flyInput(scheme, held);
        if (following && tour) stepCourseTour(tour, fly, dt, input, groundAt);
        else stepFlyCamera(fly, { ...input, lookX, lookY, zoom: zoomSteps }, dt, scheme, groundAt);
        // The camera's place runs on without a seam; the world is drawn around it wherever it is
        // (render/track-scene.js `placeBlocks`), so flying on one way comes round to the same ground for ever.
      }
      lookX = lookY = zoomSteps = 0;
    },
    /** Place a three.js camera where the fly camera is (the scene mirrors the game's z). Returns whether its lens changed. */
    apply(camera, target) {
      const f = flyForward(fly);
      camera.position.set(fly.pos[0], fly.pos[1], -fly.pos[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(target.set(fly.pos[0] + f[0], fly.pos[1] + f[1], -(fly.pos[2] + f[2])));
      if (fly.roll) camera.rotateZ(-fly.roll);
      const fov = 2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / fly.zoom) * (180 / Math.PI);
      if (Math.abs(fov - camera.fov) < 1e-3) return false;
      camera.fov = fov;
      return true;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      list.remove();
    },
  };
}
