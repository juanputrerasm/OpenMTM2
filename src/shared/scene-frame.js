/*
  Game frame to scene frame: the one conversion between the simulation and three.js.

  The game frame (docs/MTM2_PHYSICS.md section 1) is feet with x right, y up and z forward. For
  a viewer facing +z with y up, right is +x, so the frame is left-handed; three.js is
  right-handed. One reflection fixes it: the scene keeps feet and mirrors z,

      scene = (x, y, -z),   R_scene = S R S,   S = diag(1, 1, -1).

  Everything the game positions in feet (terrain corners, model vertices, SIT objects, trucks)
  goes through here. Pure: no three.js, so the worker and the tests use it too.
*/

/** A game-frame point (feet) to scene coordinates, into `out` at `offset`. */
export function toScene(x, y, z, out, offset = 0) {
  out[offset] = x;
  out[offset + 1] = y;
  out[offset + 2] = -z;
  return out;
}

/** A scene point back to the game frame: the mirror is its own inverse. */
export const fromScene = toScene;

/**
 * A row-major game-frame rotation (body to world) to a column-major 4x4 scene matrix
 * (three.js Matrix4.elements layout), with translation `pos` in game feet.
 */
export function toSceneMatrix(m, pos, out = new Array(16)) {
  // S M S negates the entries that mix z with x or y; the scene's matrix is the result by columns.
  out[0] = m[0]; out[1] = m[3]; out[2] = -m[6]; out[3] = 0;
  out[4] = m[1]; out[5] = m[4]; out[6] = -m[7]; out[7] = 0;
  out[8] = -m[2]; out[9] = -m[5]; out[10] = m[8]; out[11] = 0;
  out[12] = pos[0]; out[13] = pos[1]; out[14] = -pos[2]; out[15] = 1;
  return out;
}

/** The world size in feet; the terrain wraps at it. */
export const WORLD_FT = 8192;

/**
 * Scene units (feet) in a metre. A headset reports its poses in metres (docs/VR.md); the tracking
 * space is scaled by this once, where it is placed in the scene, so the world is life size.
 */
export const FEET_PER_METRE = 1 / 0.3048;

/**
 * `pos` (game feet, `[x, y, z]`) moved by whole worlds to the copy nearest `to`: the world is a torus (the game wraps a
 * truck's position every frame, and draws it at the copy nearest the view: MONSTER_EXE_ANALYSIS.md "The wrapping world").
 * Returns `pos` itself when it is already the nearest.
 */
export function nearestCopy(pos, to) {
  const shift = (v, ref) => {
    const d = ((v - ref + WORLD_FT / 2) % WORLD_FT + WORLD_FT) % WORLD_FT - WORLD_FT / 2;
    return d - (v - ref);
  };
  const dx = shift(pos[0], to[0]), dz = shift(pos[2], to[2]);
  return dx || dz ? [pos[0] + dx, pos[1], pos[2] + dz] : pos;
}

/**
 * A difference of world coordinates folded into one world, [-WORLD_FT / 2, WORLD_FT / 2): the shorter way across the
 * world edge (beta 0.53's course map fold, CP4_EXE_ANALYSIS.md 14: a C remainder, then one world added or taken off).
 */
export function mapWrap(d) {
  let r = d % WORLD_FT;
  if (r >= WORLD_FT / 2) r -= WORLD_FT;
  else if (r < -WORLD_FT / 2) r += WORLD_FT;
  return r;
}

/** A coordinate brought into the world, [0, WORLD_FT). */
export function wrapFt(v) {
  const w = v % WORLD_FT;
  return w < 0 ? w + WORLD_FT : w;
}
