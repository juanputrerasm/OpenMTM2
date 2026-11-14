/*
  A level's moving objects (trains and the like: type 10 boxes with a velocity, MTM2_PHYSICS.md
  14.18) run without a race: the fly-by has no simulation worker, so it steps them itself, with
  the simulation's own routine and its 1/60 s step. Pure, so it runs under Node.
*/
import * as S from "../vendor/openphotex/sim/mtm2/index.js";
import { groundBoxGrids } from "./ground-boxes.js";

const STEP = 1 / 60;
/** No more than this much time is caught up in one call (a tab that was in the background). */
const MAX_CATCH_UP = 0.25;

/**
 * @param {object} sim a track build's `sim` (worker/track-build.js): its `boxes`, `ra0` and `ra1`
 * @param {object} terrain the simulation's terrain (shared/build-terrain.js `terrainOfBuild`)
 * @returns {{ count: number, update(dt: number, snow?: boolean): { sitIndex: number, pos: number[], matrix: number[] }[] }}
 *   `update` advances the objects by `dt` seconds and returns where each now is (nothing when no step was due)
 */
export function createLevelMovers(sim, terrain) {
  // A track format version 6 track's layers may be u16, on its own height scale (game/ground-boxes.js `groundBoxGrids`).
  const { ra0, ra1, stepFt, baseFt } = groundBoxGrids(sim);
  const movers = [];
  for (const b of sim.boxes ?? []) {
    if (!b.bvel) continue;
    const box = S.createLevelBox(b, b.bounds);
    if (box) { box.sitIndex = b.sitIndex; movers.push({ box, bvel: b.bvel }); }
  }
  let owed = 0;
  return {
    count: movers.length,
    update(dt, snow = false) {
      if (!movers.length) return [];
      owed = Math.min(MAX_CATCH_UP, owed + dt);
      let stepped = false;
      while (owed >= STEP) {
        owed -= STEP;
        stepped = true;
        for (const { box, bvel } of movers) S.stepMovingObject(box, bvel, terrain, ra0, ra1, STEP, snow, { stepFt, baseFt });
      }
      return stepped ? movers.map(({ box }) => ({ sitIndex: box.sitIndex, pos: [...box.pos], matrix: Array.from(box.matrix) })) : [];
    },
  };
}
