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
 * A track build's ground box layers and their scale (worker/track-build.js `sim`): `{ ra0, ra1, stepFt, baseFt, cells }`.
 * A track format version 6 track's may be u16 layers on a 512-cell world, its heights base + value x stepFt (the
 * specification's 8.3); every other track's are bytes, 2 ft a step, on 256 cells.
 */
export function groundBoxGrids(sim, cells = sim?.worldCells ?? 256) {
  const Grid = sim?.groundBoxDepth === 16 ? Uint16Array : Uint8Array;
  const grid = (g) => (!g ? null : g instanceof Grid ? g : new Grid(g.buffer ?? g));
  return {
    ra0: grid(sim?.ra0), ra1: grid(sim?.ra1),
    // Other levels' steps (Hellbender's 1.5 ft) are the simulation worker's alone; these readers keep MTM's 2 ft for them.
    stepFt: sim?.groundBoxDepth && sim.groundBoxStepFt > 0 ? sim.groundBoxStepFt : 2, baseFt: Number(sim?.groundBoxBaseFt) || 0, cells,
  };
}

/**
 * The decks of a level, or null for one without ground boxes. `ra0` and `ra1` are its lower and upper
 * ground-box heights, `heights` its terrain (the simulation's).
 */
export function createDecks({ heights, heightsFt = null, ra0, ra1, stepFt = 2, baseFt = 0, cells = 256 }) {
  // `heightsFt`, `cells`, `stepFt`, `baseFt`: a track format version 6 track's heights in feet, its world and box scale.
  if ((!heights && !heightsFt) || !ra0 || !ra1 || !ra0.some((lower, i) => lower !== ra1[i])) return null;
  const terrain = heights ? mtm2Sim.createTerrain(heights) : mtm2Sim.createTerrainFt(heightsFt, null, null, cells);
  const scale = { stepFt, baseFt };
  return {
    /**
     * The top of the ground box that something at game (x, y, z) stands on, feet, or null where it
     * stands on the terrain: no box in the cell, or the thing below the box's underside.
     */
    topAt(x, z, y) {
      if (!(y > -Infinity)) return null;
      const h = mtm2Sim.groundBoxHeightAt(terrain, ra0, ra1, x, z, y, false, scale);
      return h === mtm2Sim.groundHeightAt(terrain, x, z) ? null : h;
    },
  };
}

/** How near a ground box the camera may come, feet: the camera's near plane must stay out of the box. */
export const CAMERA_BOX_MARGIN_FT = 1;

/**
 * Whether a point (game feet) is under a ground box, as the echo asks it (MONSTER_EXE_ANALYSIS.md 12, "Echo under
 * cover"; `0x41d0c0`, `0x502510`): the point is below its 32 ft cell's lower layer (`.RA0`), compared in the game's
 * units, `trunc(y x 256) / 4` against the byte shifted left 7 (2 ft a step). `.RA1` is not looked at: a cell with no box
 * has both layers equal, normally 0, which nothing is under. A track format version 6 track's 16-bit layers (`ra0` a
 * Uint16Array) over their height base: covered only where the cell has a box. Null for a level without ground boxes.
 */
export function createCoverTest({ ra0, ra1, stepFt = 2, baseFt = 0, cells = 256 }) {
  if (!ra0 || !ra1 || !ra0.some((lower, i) => lower !== ra1[i])) return null;
  const mask = cells - 1, wide = ra0 instanceof Uint16Array;
  const cell = (x, z) => ((Math.trunc(z * 256) >> 13) & mask) * cells + ((Math.trunc(x * 256) >> 13) & mask);
  if (wide) return (x, y, z) => { const i = cell(x, z); return ra0[i] !== ra1[i] && y < baseFt + ra0[i] * stepFt; };
  return (x, y, z) => Math.trunc(Math.trunc(y * 256) / 4) < ra0[cell(x, z)] << 7;
}

/**
 * Whether a point (game feet) is inside a ground box, within `margin` feet of one: the cell (32 ft, the world wrapping
 * as the game's grid does, MTM2_PHYSICS.md 14.18) has a box and the point is between its underside and its top. A
 * tunnel built of ground boxes is solid walls and a roof with room under it. For the chase camera, which the game keeps
 * only over the terrain: an OpenMTM2 addition, so it does not fly out through a tunnel's roof or into its walls. Null for
 * a level without ground boxes.
 */
export function createBoxSolid({ ra0, ra1, stepFt = 2, baseFt = 0, cells = 256 }, margin = CAMERA_BOX_MARGIN_FT) {
  if (!ra0 || !ra1 || !ra0.some((lower, i) => lower !== ra1[i])) return null;
  // The view cell (x >> 13) & (N - 1), the specification's 8.1 (0x1fe000 on the retail 256-cell world).
  const mask = cells - 1;
  const cell = (x, z) => ((Math.trunc(z * 256) >> 13) & mask) * cells + ((Math.trunc(x * 256) >> 13) & mask);
  const inside = (x, y, z) => {
    const i = cell(x, z);
    return ra0[i] !== ra1[i] && y > baseFt + ra0[i] * stepFt - margin && y < baseFt + ra1[i] * stepFt + margin;
  };
  return (x, y, z) => inside(x, y, z) || (margin > 0 && (inside(x + margin, y, z) || inside(x - margin, y, z) || inside(x, y, z + margin) || inside(x, y, z - margin)));
}
