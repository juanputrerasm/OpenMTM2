/*
  The tops of the level's ground boxes as ground (MTM2_PHYSICS.md 2.5 and 14.18). Some tracks build
  the course over a gully on ground boxes: Sidewinder Canyon's bridges are ground boxes with no
  textures of their own. A truck on one stands on its top, a deck, and what it leaves and throws
  belongs there, not on the terrain under the bridge.

  Whether a thing stands on a deck is the game's own rule (`groundBoxHeight`): the cell under it has a
  ground box whose underside is below the thing. So a wheel on the bridge is on the deck, and one in
  the gully under it is on the terrain.

  Pure, so it runs under Node.
*/
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";

/**
 * The decks of a level, or null for one without ground boxes. `ra0` and `ra1` are its lower and upper
 * ground-box heights, `heights` its terrain (the simulation's).
 */
export function createDecks({ heights, ra0, ra1 }) {
  if (!heights || !ra0 || !ra1 || !ra0.some((lower, i) => lower !== ra1[i])) return null;
  const terrain = mtm2Sim.createTerrain(heights);
  return {
    /**
     * The top of the ground box that something at game (x, y, z) stands on, feet, or null where it
     * stands on the terrain: no box in the cell, or the thing below the box's underside.
     */
    topAt(x, z, y) {
      if (!(y > -Infinity)) return null;
      const h = mtm2Sim.groundBoxHeightAt(terrain, ra0, ra1, x, z, y);
      return h === mtm2Sim.groundHeightAt(terrain, x, z) ? null : h;
    },
  };
}

/** How near a ground box the camera may come, feet: the camera's near plane must stay out of the box. */
export const CAMERA_BOX_MARGIN_FT = 1;

/**
 * Whether a point (game feet) is inside a ground box, within `margin` feet of one: the cell (32 ft, the world wrapping
 * as the game's grid does, MTM2_PHYSICS.md 14.18) has a box and the point is between its underside and its top. A
 * tunnel built of ground boxes is solid walls and a roof with room under it. For the chase camera, which the game keeps
 * only over the terrain: an OpenMTM2 addition, so it does not fly out through a tunnel's roof or into its walls. Null for
 * a level without ground boxes.
 */
export function createBoxSolid({ ra0, ra1 }, margin = CAMERA_BOX_MARGIN_FT) {
  if (!ra0 || !ra1 || !ra0.some((lower, i) => lower !== ra1[i])) return null;
  const cell = (x, z) => ((Math.trunc(z * 256) & 0x1fe000) >> 13) * 256 + ((Math.trunc(x * 256) & 0x1fe000) >> 13);
  const inside = (x, y, z) => {
    const i = cell(x, z);
    return ra0[i] !== ra1[i] && y > ra0[i] * 2 - margin && y < ra1[i] * 2 + margin;
  };
  return (x, y, z) => inside(x, y, z) || (margin > 0 && (inside(x + margin, y, z) || inside(x - margin, y, z) || inside(x, y, z + margin) || inside(x, y, z - margin)));
}
