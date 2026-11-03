/*
  4x4 Evolution's trees when a truck hits them (docs/EVO2_EXE_ANALYSIS.md 2.5), drawn. The game does not knock a tree
  over: it leans it away from the truck and lets it spring back (`0x5461e0`). While a truck touches the tree (each
  frame of contact sets the tree's state to 1 again, `0x545db0`) its lean eases toward

      10 degrees x min(truck speed / 44 ft/s, 1) x (1 - min(k / 3, 1))

  at 7 of the remaining a second; once the truck has left, back toward upright at 3 a second, and the tree is let go
  (drawn in the forest again) under 1 degree. `k` is a figure of the tree's collision object that is not traced: the
  port takes 0, the fullest lean. The lean is along the truck's velocity.

  The port once had them fall flat; the game never did.

  Pure (no three.js): column-major 4x4 scene matrices in and out, as render/track-scene.js `moveObjects` takes them.
*/
/** The traced lean: its most (radians), the speed that gives all of it (ft/s), and the two easing rates (per second). */
export const LEAN_MAX = 0.174533, LEAN_FULL_SPEED_FT = 44, LEAN_RATE_IN = 7, LEAN_RATE_OUT = 3, LEAN_DONE = Math.PI / 180;
const CONTACT_S = 0.1;

/** The game's easing (`0x54d2d0`): `rate * dt` of the way from `now` to `target`, or all of it once that is 1 or more. */
export const ease = (target, rate, now, dt) => (rate * dt < 1 && rate > 0 ? (target - now) * rate * dt + now : target);

/** A lean of the tree drawn with `matrix` (scene, column-major) from `base`, game feet. */
export function createLean(id, matrix, base) {
  return { id, matrix: matrix.slice(), base: [base[0], base[1], -base[2]], axis: [0, 0, -1], angle: 0, target: 0, contact: 0, done: false };
}

/** A truck touches the leaning tree this frame: `dir` its velocity (x, z, game feet a second). */
export function touchLean(lean, dir) {
  const speed = Math.hypot(dir[0], dir[1]);
  lean.target = LEAN_MAX * Math.min(speed / LEAN_FULL_SPEED_FT, 1);
  if (speed > 1) {
    // The scene mirrors z: a game direction (x, z) is (x, -z) there; the axis is up x dir.
    const dx = dir[0] / speed, dz = -dir[1] / speed;
    lean.axis = [dz, 0, -dx];
  }
  // The simulation's replies and the frames do not come one for one: a touch counts for a tenth of a second.
  lean.contact = CONTACT_S;
}

/** Advance a lean by `dt`: its current matrix (column-major, scene); `done` once it is upright again. */
export function stepLean(lean, dt) {
  if (lean.done) return null;
  const touched = lean.contact > 0;
  lean.contact -= dt;
  lean.angle = touched ? ease(lean.target, LEAN_RATE_IN, lean.angle, dt) : ease(0, LEAN_RATE_OUT, lean.angle, dt);
  if (!touched && dt > 0 && lean.angle < LEAN_DONE) { lean.done = true; return lean.matrix.slice(); }
  return turnedAbout(lean.matrix, lean.base, lean.axis, lean.angle);
}

/** `m` (column-major, scene) turned by `angle` about `axis` through `base`. */
function turnedAbout(m, base, axis, angle) {
  const [ax, ay, az] = axis, c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  // Rotation about the axis (Rodrigues), row-major R[r][c].
  const R = [
    [c + ax * ax * k, ax * ay * k - az * s, ax * az * k + ay * s],
    [ay * ax * k + az * s, c + ay * ay * k, ay * az * k - ax * s],
    [az * ax * k - ay * s, az * ay * k + ax * s, c + az * az * k],
  ];
  const out = new Array(16).fill(0);
  // out = T(base) R T(-base) M: the linear part R M, the translation R (t - base) + base.
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 4 + row] = R[row][0] * m[col * 4] + R[row][1] * m[col * 4 + 1] + R[row][2] * m[col * 4 + 2];
    }
  }
  const [bx, by, bz] = base, tx = m[12] - bx, ty = m[13] - by, tz = m[14] - bz;
  out[12] = R[0][0] * tx + R[0][1] * ty + R[0][2] * tz + bx;
  out[13] = R[1][0] * tx + R[1][1] * ty + R[1][2] * tz + by;
  out[14] = R[2][0] * tx + R[2][1] * ty + R[2][2] * tz + bz;
  out[15] = 1;
  return out;
}
