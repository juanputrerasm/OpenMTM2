/*
  The ten camera views (MONSTER_EXE_ANALYSIS.md 11): the chase cameras of 0x52b780 (their
  distance, pitch, heading offset and zoom) positioned as 0x52b110 does, with its terrain
  avoidance. Angles are the game's, 65536 to the turn; distances are in 1/256 ft there and in
  feet here. The cockpit (0), BlimpCam (3) and RaceCam (4) are not chase views; the port draws
  the latter two its own way (see `blimpCamera`, `raceCamera`).
*/
import { terrainHeightAt } from "../vendor/openphotex/sim/mtm2/world/terrain.js";

const TURN = 65536;
const ANGLE = (units) => (units / TURN) * Math.PI * 2;

/** Modes in the order the View key steps through them. `dist`, `pitch`, `offset`, `zoom` are the exe's raw values. */
export const CAMERA_MODES = Object.freeze([
  { id: 0, name: "Cockpit" },
  { id: 1, name: "Chase Near", dist: 0x1555, pitch: 0x800, offset: 0, zoom: 0xc000 },
  { id: 2, name: "Chase Far", dist: 0x2aaa, pitch: 0x800, offset: 0, zoom: 0x10000 },
  { id: 3, name: "BlimpCam" },
  { id: 4, name: "RaceCam" },
  { id: 5, name: "Chase Front", dist: 0x1555, pitch: 0x800, offset: 0x8000, zoom: 0xc000 },
  { id: 6, name: "Chase Left", dist: 0x1555, pitch: 0x800, offset: 0x4000, zoom: 0xc000 },
  { id: 7, name: "Chase Right", dist: 0x1555, pitch: 0x800, offset: 0xc000, zoom: 0xc000 },
  { id: 8, name: "Chase Big Rear", dist: 0x1555, pitch: 0xa00, offset: 0, zoom: 0x6000 },
  { id: 9, name: "Chase Big Front", dist: 0x1555, pitch: 0x800, offset: 0x8000, zoom: 0x6000 },
]);

/**
 * The Inertia view (not the game's; the Z-mode cameras option adds it after the ten): a chase camera from behind whose
 * distance follows the speed, Chase Near's when slow, Chase Far's at speed and half as far again flat out.
 */
export const INERTIA_MODE = Object.freeze({ id: 10, name: "Inertia", dist: 0x1555, pitch: 0x800, offset: 0, zoom: 0xc000, inertia: true });
/** Feet per second at which the Inertia view sits at Chase Near, at Chase Far, and at its farthest (1.5 x Chase Far). */
export const INERTIA_SPEEDS_FT = Object.freeze([15, 75, 140]);
const smooth = (t) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
/** The Inertia view's distance in feet and its zoom factor at a speed (feet per second), before easing. */
export function inertiaView(speedFt) {
  const [slow, fast, top] = INERTIA_SPEEDS_FT;
  const near = 0x1555 / 256, far = 0x2aaa / 256;
  const a = smooth((speedFt - slow) / (fast - slow)), b = smooth((speedFt - fast) / (top - fast));
  return { dist: near + (far - near) * a + far * 0.5 * b, zoom: (0xc000 + (0x10000 - 0xc000) * a) / 0x10000 };
}

/** A view by its number: the game's ten, or the Inertia view. */
export const cameraMode = (id) => CAMERA_MODES[id] ?? (id === INERTIA_MODE.id ? INERTIA_MODE : undefined);

/** The mode after `mode` going forward (View) or back (Shift + View), wrapping 0 to 9 (`count` 11 takes the Inertia view in). */
export const nextMode = (mode, back = false, count = CAMERA_MODES.length) => (Math.min(mode, count - 1) + (back ? count - 1 : 1)) % count;

/**
 * The view a shortcut key picks: Ctrl (or Alt) with 1 to 9 and 0 picks the ten views in order, 1 the
 * cockpit, 2 Chase Near, 3 Chase Far, 4 BlimpCam, 5 RaceCam, 6 Chase Front, 7 Chase Left, 8 Chase Right,
 * 9 Chase Big Rear, 0 Chase Big Front. Returns null for any other key. `e` is a keyboard event.
 */
export function modeForShortcut(e) {
  if (!(e.ctrlKey || e.altKey) || e.metaKey) return null;
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return n === 0 ? 9 : n - 1;
}

/** The vertical field of view of a mode, degrees; the game's zoom factor scales the view plane. */
export const fovFor = (mode, baseDegrees = 60) => {
  // The cockpit's 3D window is 90 degrees across 640 pixels: 73.7 degrees over the 480 of the screen.
  if (mode === 0) return 73.74;
  const zoom = (cameraMode(mode)?.zoom ?? 0x10000) / 0x10000;
  return (2 * Math.atan(Math.tan((baseDegrees * Math.PI) / 360) * zoom) * 180) / Math.PI;
};

/** The shortest signed turn from `from` to `to`, radians. */
const turnBetween = (from, to) => ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/**
 * A chase camera's state: the smoothed heading. `update` places the camera for a truck at `pos`
 * (game feet) heading `yaw`, and returns the camera's `position` and the point it `target`s.
 * `height(x, z)` is the ground's height; the camera stays above it, first by tilting up and then
 * by moving in, as the game does.
 */
export function createChaseCamera() {
  let heading = null, lastMode = -1, settle = 0, inertia = null;
  return {
    reset() { heading = null; lastMode = -1; inertia = null; },
    /**
     * `turn` (radians) swings the camera round the truck and `scale` stretches its distance: the replay's rotate and zoom,
     * and Z mode's orbit. `speedFt` is the truck's speed, which the Inertia view's distance follows; that view's result
     * carries its `zoom` factor too.
     */
    update(mode, pos, yaw, height, dt, { turn = 0, scale = 1, speedFt = 0 } = {}) {
      const m = cameraMode(mode);
      if (!m?.dist) throw new RangeError(`camera mode ${mode} is not a chase view`);
      // Choosing a view arms a two second timer (0x52b780); nothing else is blended: the distance, pitch
      // and zoom change at once and only the heading, which follows the truck's, takes time.
      if (mode !== lastMode) { lastMode = mode; settle = 2; }
      const wanted = yaw + ANGLE(m.offset) + turn;
      if (heading === null) heading = wanted;
      else if (m.id === 5 || m.id === 9) {
        // The front views ease the heading only until the timer runs out or it has nearly caught up;
        // after that they hold it rigidly (0x52b110).
        settle -= dt;
        const gap = turnBetween(heading, wanted);
        if (settle > 0 && Math.abs(gap) >= (0x100 / 65536) * Math.PI * 2) heading += gap * Math.min(1, 4 * dt);
        else { settle = 0; heading = wanted; }
      } else {
        // The others follow the truck's heading by 4 per second of the remaining difference, always.
        heading += turnBetween(heading, wanted) * Math.min(1, 4 * dt);
      }
      let dist = (m.dist / 256) * scale, zoom = null;
      if (m.inertia) {
        // Eased, about a second to settle: the camera drifts out as the truck gathers speed and back in as it slows.
        const want = inertiaView(speedFt);
        if (!inertia) inertia = { ...want };
        const k = Math.min(1, 1.5 * dt);
        inertia.dist += (want.dist - inertia.dist) * k;
        inertia.zoom += (want.zoom - inertia.zoom) * k;
        dist = inertia.dist * scale;
        zoom = inertia.zoom;
      }
      const pitch = ANGLE(m.pitch);
      const at = (t, p) => [pos[0] - Math.sin(heading) * Math.cos(p) * t, pos[1] + Math.sin(p) * t, pos[2] - Math.cos(heading) * Math.cos(p) * t];
      // Tilt up in 0x200 steps (at most 0x3fff) until the camera at full distance is over the ground.
      let tilt = pitch;
      for (let i = 0, extra = 0; i < 32; i++, extra += 0x200) {
        tilt = pitch + ANGLE(extra);
        const c = at(dist, tilt);
        if (height(c[0], c[2]) <= c[1] || extra + 0x200 > 0x3fff) break;
      }
      // Then the largest of 32 steps along the ray that is still over it.
      let t = dist;
      for (let i = 1; i <= 32; i++) {
        const c = at((dist * i) / 32, tilt);
        if (c[1] < height(c[0], c[2])) { t = (dist * (i - 1)) / 32; break; }
      }
      return zoom === null ? { position: at(t, tilt), target: [...pos] } : { position: at(t, tilt), target: [...pos], zoom };
    },
  };
}

/** The cockpit's eye in the truck's own frame, feet: 4 up and 1 forward of the truck's origin (0x553cf0). */
export const COCKPIT_EYE = Object.freeze([0, 4, 1]);

/** Ground height for a camera, from the simulation's terrain. */
export const groundHeightFn = (terrain) => (x, z) => terrainHeightAt(terrain, x, z);

/** The field of view that goes with the game's zoom factor (16.16, 0x1000 to 0x8000) in the two special views. */
export const zoomToFov = (zoom, baseDegrees = 60) => (2 * Math.atan(Math.tan((baseDegrees * Math.PI) / 360) * zoom) * 180) / Math.PI;
/** The special views' zoom from their horizontal distance to the truck: 65536 / (distance x 0.0625), held to 0x1000..0x8000, as a factor. */
export const distanceZoom = (horizontalFt) => Math.max(0x1000, Math.min(0x8000, 65536 / Math.max(horizontalFt * 0.0625, 1e-9))) / 65536;

/** The camera's view of `target` from `position`: yaw and pitch clamped as the game does, as a point to look at, plus the zoom. */
function lookFrom(position, target, maxPitch, extraZoom = null) {
  const dx = target[0] - position[0], dy = target[1] - position[1], dz = target[2] - position[2];
  const horizontal = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.max(-maxPitch, Math.min(maxPitch, Math.atan2(-dy, horizontal)));
  const reach = 100;
  return {
    position, zoom: extraZoom ?? distanceZoom(horizontal),
    target: [position[0] + Math.sin(yaw) * Math.cos(pitch) * reach, position[1] - Math.sin(pitch) * reach, position[2] + Math.cos(yaw) * Math.cos(pitch) * reach],
  };
}

/** The average of the course's straights' midpoints, feet (the game's `0x730728`, read as the course loads). */
export function courseCentroid(course) {
  const segments = course.filter((g) => g.startFt && g.endFt);
  if (!segments.length) return null;
  const sum = [0, 0, 0];
  for (const g of segments) for (let k = 0; k < 3; k++) sum[k] += (g.startFt[k] + g.endFt[k]) / 2;
  return sum.map((v) => v / segments.length);
}

/**
 * BlimpCam (0x52c280): the camera hangs 100 ft from the truck on the line to a point 1000 ft above the
 * course's centre, looking back at it (pitch within 67.5 degrees), zoomed by its horizontal distance.
 */
export const BLIMP_CAM_HEIGHT_FT = 1000, BLIMP_CAM_REACH_FT = 100;
export function blimpCamera(truckPos, centroid) {
  const high = [centroid[0], centroid[1] + BLIMP_CAM_HEIGHT_FT, centroid[2]];
  const d = [high[0] - truckPos[0], high[1] - truckPos[1], high[2] - truckPos[2]];
  const length = Math.hypot(...d);
  const k = length > BLIMP_CAM_REACH_FT ? BLIMP_CAM_REACH_FT / length : 1;
  const position = [truckPos[0] + d[0] * k, truckPos[1] + d[1] * k, truckPos[2] + d[2] * k];
  return lookFrom(position, truckPos, (0x3000 / 65536) * Math.PI * 2);
}

/** Without a course the BlimpCam has no centre to hang over: it looks down from above and behind. */
export function blimpCameraNoCourse(pos, yaw, height) {
  const position = [pos[0] - Math.sin(yaw) * 160, Math.max(pos[1] + 250, height(pos[0], pos[2]) + 40), pos[2] - Math.cos(yaw) * 160];
  return { position, target: [...pos], zoom: 1 };
}

/**
 * RaceCam (0x52ba90): the camera stands on the straight the truck is heading for, a quarter of the way along
 * it (the middle of a straight longer than 320 ft when the truck is nearer the middle than the start), held at
 * least 14 ft over the highest ground between it and the truck, and no farther than the view allows.
 * `straights` are the course's straights (`startFt`, `endFt`); the truck's `segment` is its index in the course
 * with the arcs in (straights at the even places); `height(x, z)` the ground; `viewCells` the view range in cells.
 */
export function raceCamera(straights, truckPos, segment, height, viewCells = 32) {
  if (!straights.length) return null;
  const k = (segment % 2 === 0 ? segment / 2 : (segment + 1) / 2) % straights.length;
  const { startFt: a, endFt: b } = straights[k];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  let spot = [a[0] + d[0] * 0.25, a[1] + d[1] * 0.25, a[2] + d[2] * 0.25];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (Math.hypot(...d) > 320) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    if (dist(truckPos, mid) < dist(truckPos, a)) spot = mid;
  }
  // Over the highest ground along the line of sight, plus 14 ft.
  let top = -Infinity;
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    top = Math.max(top, height(spot[0] + (truckPos[0] - spot[0]) * t, spot[2] + (truckPos[2] - spot[2]) * t));
  }
  if (spot[1] < top + 14) spot = [spot[0], top + 14, spot[2]];
  const v = [spot[0] - truckPos[0], spot[1] - truckPos[1], spot[2] - truckPos[2]];
  const horizontal = Math.hypot(v[0], v[2]), limit = (viewCells - 2) * 32;
  if (horizontal > limit) { const s = limit / horizontal; spot = [truckPos[0] + v[0] * s, truckPos[1] + v[1] * s, truckPos[2] + v[2] * s]; }
  return lookFrom(spot, truckPos, (0x37ff / 65536) * Math.PI * 2);
}
