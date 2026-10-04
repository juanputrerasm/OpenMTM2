/*
  Box objects for collisions (MTM2_PHYSICS.md §7.3, §14.14).

  A box is centred on its position, with half extents along its own x, y and z, a rotation
  (body to world, row-major, like the truck's) and a world velocity. A mass of 0 is immovable.
  Ground boxes are rebuilt around each truck every frame from the level's .RA0 / .RA1 layers.
*/
import { eulerToMatrix } from "../math.js";
/** A box from its centre, full sizes (x, y, z) and angles (theta, phi, psi). */
export function createBox(pos, size, mass = 0, angles = [0, 0, 0]) {
    const half = [size[0] * 0.5, size[1] * 0.5, size[2] * 0.5];
    const matrix = new Float64Array(9);
    eulerToMatrix(angles[0], angles[1], angles[2], matrix);
    return {
        pos: [pos[0], pos[1], pos[2]], matrix, vel: [0, 0, 0], half, mass,
        radius: Math.hypot(half[0], half[1], half[2]),
    };
}
export const GROUND_BOX_CELL_FT = 32;
export const MAX_GROUND_BOXES = 600;
/**
 * The ground boxes around a point (§14.14): every cell of the 3 x 3 around it whose lower
 * (`ra0`) and upper (`ra1`) heights differ. Heights are 2 ft steps; neighbours wrap at the map
 * edge, and so do the boxes' positions (as in the game).
 */
export function groundBoxesAround(ra0, ra1, x, z, out = []) {
    const col = (Math.trunc(x * 256) >> 13) & 255;
    const row = (Math.trunc(z * 256) >> 13) & 255;
    for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
            const c = (col + dc) & 255, r = (row + dr) & 255;
            const i = r * 256 + c;
            const lo = ra0[i] * 2, hi = ra1[i] * 2;
            if (lo === hi)
                continue;
            const h = hi - lo;
            out.push(createBox([c * GROUND_BOX_CELL_FT + 16, lo + Math.trunc(h / 2), r * GROUND_BOX_CELL_FT + 16], [GROUND_BOX_CELL_FT, h, GROUND_BOX_CELL_FT]));
            if (out.length > MAX_GROUND_BOXES)
                throw new Error("Too many ground boxes.");
        }
    }
    return out;
}
