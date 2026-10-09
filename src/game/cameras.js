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

/** The mode after `mode` going forward (View) or back (Shift + View), wrapping 0 to 9. */
export const nextMode = (mode, back = false) => (mode + (back ? 9 : 1)) % CAMERA_MODES.length;

/** The vertical field of view of a mode, degrees; the game's zoom factor scales the view plane. */
export const fovFor = (mode, baseDegrees = 60) => {
  // The cockpit's 3D window is 90 degrees across 640 pixels: 73.7 degrees over the 480 of the screen.
  if (mode === 0) return 73.74;
  const zoom = (CAMERA_MODES[mode]?.zoom ?? 0x10000) / 0x10000;
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
  let heading = null, lastMode = -1, settle = 0;
  return {
    reset() { heading = null; lastMode = -1; },
    update(mode, pos, yaw, height, dt) {
      const m = CAMERA_MODES[mode];
      if (!m?.dist) throw new RangeError(`camera mode ${mode} is not a chase view`);
      // Choosing a view arms a two second timer (0x52b780); nothing else is blended: the distance, pitch
      // and zoom change at once and only the heading, which follows the truck's, takes time.
      if (mode !== lastMode) { lastMode = mode; settle = 2; }
      const wanted = yaw + ANGLE(m.offset);
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
      const dist = m.dist / 256, pitch = ANGLE(m.pitch);
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
      return { position: at(t, tilt), target: [...pos] };
    },
  };
}

/** The cockpit's eye in the truck's own frame, feet: 4 up and 1 forward of the truck's origin (0x553cf0). */
export const COCKPIT_EYE = Object.freeze([0, 4, 1]);

/** Ground height for a camera, from the simulation's terrain. */
export const groundHeightFn = (terrain) => (x, z) => terrainHeightAt(terrain, x, z);

/**
 * BlimpCam: the port's own view from above and behind (the game's follows a blimp that is not
 * modelled yet): 250 ft up and 160 ft back, looking down at the truck.
 */
export function blimpCamera(pos, yaw, height) {
  const position = [pos[0] - Math.sin(yaw) * 160, pos[1] + 250, pos[2] - Math.cos(yaw) * 160];
  position[1] = Math.max(position[1], height(position[0], position[2]) + 40);
  return { position, target: [...pos] };
}

/**
 * RaceCam: the port's own trackside view. The camera stands beside the course a little ahead of
 * the truck and watches it go by; it moves on to the next spot once the truck is past it or far from it.
 * `loop` is the course's centre line, `[x, z]` points (see render/minimap.js `courseLoop`).
 */
export function createRaceCamera(loop) {
  let spot = null;
  return {
    reset() { spot = null; },
    update(pos, height) {
      if (loop.length < 3) return blimpCamera(pos, 0, height);
      if (spot) {
        const d = Math.hypot(pos[0] - spot.at[0], pos[2] - spot.at[1]);
        const ahead = (spot.at[0] - pos[0]) * spot.dir[0] + (spot.at[1] - pos[2]) * spot.dir[1];
        if (d > 700 || ahead < -60) spot = null;
      }
      if (!spot) {
        let best = 0, bestD = Infinity;
        loop.forEach((p, i) => { const d = Math.hypot(p[0] - pos[0], p[1] - pos[2]); if (d < bestD) { bestD = d; best = i; } });
        const target = loop[(best + 2) % loop.length], next = loop[(best + 3) % loop.length];
        const dx = next[0] - target[0], dz = next[1] - target[1], len = Math.hypot(dx, dz) || 1;
        const dir = [dx / len, dz / len];
        spot = { at: [target[0] - dir[1] * 110, target[1] + dir[0] * 110], dir };
      }
      return { position: [spot.at[0], height(spot.at[0], spot.at[1]) + 14, spot.at[1]], target: [...pos] };
    },
  };
}
