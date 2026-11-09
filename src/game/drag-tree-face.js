/*
  The Christmas tree model's lamps (TREE.BIN, texture TRLFACE.RAW), painted as MTM1 paints them each frame of a drag
  race (MTM1_MONSTER_EXE_ANALYSIS.md 5.6, `0x41d490`): the 64 x 64 texture cleared to palette index 0, then a filled
  rectangle of each lit lamp's colour over its row, grid slot 0's lamps at x 36-63 and slot 1's at x 0-27.
  The lamp bits are game/drag-race.js `LAMP`, one word a lane.
*/

export const TREE_FACE_SIZE = 64;
/** Each lamp's rows, top to bottom (y first and last, inclusive), in `LAMP` bit order. */
export const TREE_FACE_ROWS = Object.freeze([[0, 6], [9, 16], [19, 26], [30, 36], [39, 46], [49, 54], [57, 63]]);
/** Each lamp's level palette index, in the same order. */
export const TREE_FACE_COLOURS = Object.freeze([0x69, 0x69, 0x6f, 0x6f, 0x6f, 0xd6, 0x9c]);
/** The columns (first and last, inclusive) of each grid slot's lamps. */
export const TREE_FACE_COLUMNS = Object.freeze([[36, 63], [0, 27]]);
/** Every palette index the face uses: unlit first. */
export const TREE_FACE_INDICES = Object.freeze([0, ...new Set(TREE_FACE_COLOURS)]);

/**
 * The face's palette indices, row by row from the top, for `bySlot` (the lamp word of grid slot 0 and 1). `out` is
 * reused when given.
 */
export function treeFace(bySlot, out = new Uint8Array(TREE_FACE_SIZE * TREE_FACE_SIZE)) {
  out.fill(0);
  TREE_FACE_COLUMNS.forEach(([x0, x1], slot) => {
    const bits = bySlot?.[slot] ?? 0;
    TREE_FACE_ROWS.forEach(([y0, y1], k) => {
      if (!(bits & (1 << k))) return;
      for (let y = y0; y <= y1; y++) out.fill(TREE_FACE_COLOURS[k], y * TREE_FACE_SIZE + x0, y * TREE_FACE_SIZE + x1 + 1);
    });
  });
  return out;
}
