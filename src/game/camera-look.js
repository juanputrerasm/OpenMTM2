/*
  The port's own mouse on the external cameras (not the game's): moving the mouse looks round the truck, the wheel
  zooms, and Backspace held looks back. A look eases back to the view's own after LOOK_RETURN_S seconds without
  moving the mouse; the zoom stays, for each view on its own, until the view is chosen again with the wheel, and is
  kept for the next games (`settings.cameraZoom`, by view).
  Options, Advanced, Cameras: "Free look" off leaves the mouse's movement alone (the wheel still zooms), "Reverse free
  look" turns it the other way on both axes, and "Hold free look" keeps a look where it was left, with no easing back.
  Pure: the screen feeds it the mouse and the keys and reads `yaw`, `pitch`, `zoom` and `back` each frame.
*/

/** Radians of look per pixel of mouse movement. */
export const LOOK_PER_PIXEL = 0.006;
/** How far a look may turn up or down, radians (about 70 degrees). */
export const LOOK_PITCH_MAX = 1.2;
/** Seconds without mouse movement before the look eases back, and how fast it does (per second of the remaining). */
export const LOOK_RETURN_S = 2, LOOK_RETURN_RATE = 3;
/** The zoom a wheel notch changes by, and its range (a factor on the view's distance; under 1 is nearer). */
export const ZOOM_STEP = 1.1, ZOOM_MIN = 0.35, ZOOM_MAX = 4;
/** The key held to look back. */
export const LOOK_BACK_KEY = "Backspace";

/** The look's options from the settings: `freeLook` (default on), `freeLookInvert` and `freeLookHold` (default off). */
export function lookOptions(settings = {}) {
  return { enabled: settings.freeLook !== false, invert: settings.freeLookInvert === true, hold: settings.freeLookHold === true };
}

/** The zooms kept from the last games (`settings.cameraZoom`, `{ [view]: factor }`), each held to the range. */
export function storedZooms(stored) {
  const zooms = new Map();
  for (const [mode, value] of Object.entries(stored && typeof stored === "object" ? stored : {})) {
    const v = Number(value);
    if (Number.isFinite(v) && v > 0 && /^\d+$/.test(mode)) zooms.set(Number(mode), Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)));
  }
  return zooms;
}

/**
 * `options`: a function giving `lookOptions` now, read on every movement and step, so a change in Options applies at once.
 * `saved`: the zooms to start from (`storedZooms`' input), and `onZoom(zooms)`, told of each wheel change with every
 * view's zoom as `{ [view]: factor }`, to keep them.
 */
export function createCameraLook(options = () => ({ enabled: true, invert: false, hold: false }), { saved = null, onZoom = null } = {}) {
  let yaw = 0, pitch = 0, idle = Infinity, back = false;
  const zooms = storedZooms(saved);
  return {
    /** The mouse moved by `dx`, `dy` pixels: look round (right and down positive on the screen). */
    move(dx, dy) {
      if (!dx && !dy) return;
      const o = options();
      if (!o.enabled) return;
      if (o.invert) { dx = -dx; dy = -dy; }
      yaw -= dx * LOOK_PER_PIXEL;
      // Wrapped to a half turn either way, so the return is the short way round.
      yaw = ((yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      pitch = Math.max(-LOOK_PITCH_MAX, Math.min(LOOK_PITCH_MAX, pitch - dy * LOOK_PER_PIXEL));
      idle = 0;
    },
    /** A wheel turn on view `mode`: down (positive `deltaY`) draws the camera out, up brings it in. */
    wheel(mode, deltaY) {
      if (!deltaY) return;
      const now = zooms.get(mode) ?? 1;
      zooms.set(mode, Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, now * (deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP))));
      onZoom?.(Object.fromEntries(zooms));
    },
    /** Backspace down or up. */
    setBack(on) { back = !!on; },
    /** Ease the look back once the mouse has rested `LOOK_RETURN_S` seconds. */
    step(dt) {
      idle += dt;
      const o = options();
      // Free look off: a look left from before eases back at once; held: it stays.
      if (o.enabled && (o.hold || idle < LOOK_RETURN_S)) return;
      const k = Math.min(1, LOOK_RETURN_RATE * dt);
      yaw -= yaw * k;
      pitch -= pitch * k;
      if (Math.abs(yaw) < 1e-4) yaw = 0;
      if (Math.abs(pitch) < 1e-4) pitch = 0;
    },
    /** The look now, radians: `yaw` round the truck (with half a turn while looking back), `pitch` up. */
    get yaw() { return yaw + (back ? Math.PI : 0); },
    get pitch() { return pitch; },
    get back() { return back; },
    /** The zoom of view `mode`, 1 until the wheel changes it. */
    zoom(mode) { return zooms.get(mode) ?? 1; },
    /** The look let go at once (a new view, a new truck); the zooms stay. */
    reset() { yaw = 0; pitch = 0; idle = Infinity; },
  };
}

/**
 * A point to look at from `position` toward `target` (game feet), the direction turned by `yaw` round the vertical and
 * tilted by `pitch` (radians): the BlimpCam's and RaceCam's look, which stand still and turn their gaze.
 */
export function turnedTarget(position, target, yaw, pitch) {
  const d = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
  const length = Math.hypot(...d) || 1;
  const heading = Math.atan2(d[0], d[2]) + yaw;
  const up = Math.max(-1.5, Math.min(1.5, Math.atan2(d[1], Math.hypot(d[0], d[2])) + pitch));
  return [position[0] + Math.sin(heading) * Math.cos(up) * length, position[1] + Math.sin(up) * length, position[2] + Math.cos(heading) * Math.cos(up) * length];
}
