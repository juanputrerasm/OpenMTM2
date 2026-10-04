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

/**
 * A row-major game-frame rotation (body to world) to a column-major 4x4 scene matrix
 * (three.js Matrix4.elements layout), with translation `pos` in game feet.
 */
export function toSceneMatrix(m, pos, out = new Array(16)) {
  // S M S negates the entries that mix z with x or y.
  const r = [
    m[0], m[1], -m[2],
    m[3], m[4], -m[5],
    -m[6], -m[7], m[8],
  ];
  out[0] = r[0]; out[1] = r[3]; out[2] = r[6]; out[3] = 0;
  out[4] = r[1]; out[5] = r[4]; out[6] = r[7]; out[7] = 0;
  out[8] = r[2]; out[9] = r[5]; out[10] = r[8]; out[11] = 0;
  out[12] = pos[0]; out[13] = pos[1]; out[14] = -pos[2]; out[15] = 1;
  return out;
}

/** The world size in feet; the terrain wraps at it. */
export const WORLD_FT = 8192;
