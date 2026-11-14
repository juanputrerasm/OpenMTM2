/*
  The ground a party mode sets a truck down on (Deathmatch's spawn spots, the filled start grid, a respawn): the
  highest drivable surface at a point, not only the terrain. The same surfaces the simulation stands a truck on
  (worker/sim-worker.js): the terrain, the level's ground boxes (MTM2_PHYSICS.md 2.5 and 14.18: Sidewinder Canyon's
  bridges), CPR's road, 4x4 Evolution's rocks and decks (`meshGround`), and a track made for CP4's meshes (its streets,
  freeway decks and tunnel floors, game/mesh-ground.js). An OpenMTM2 addition: the game has no deathmatch.

  `heightAt(x, z, refY)` takes the highest surface at or under `refY + REF_ABOVE_FT` (a course point's height, so a spot
  on a street under an overpass stays on the street), else the highest surface there is. Without `refY`, the highest.

  Pure, so it runs under Node.
*/
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";
import { groundBoxGrids } from "./ground-boxes.js";
import { meshGroundFromBuild } from "./mesh-ground.js";

/** How far over the reference height a surface may be and still be the one meant, feet. */
export const REF_ABOVE_FT = 15;

/**
 * The spawn ground of a track build (worker/track-build.js) over its simulation terrain (shared/build-terrain.js
 * `terrainOfBuild`): `(x, z, refY?) => feet`.
 */
export function createSpawnGround(build, terrain) {
  const sim = build?.sim ?? {};
  const worldCells = build?.worldCells ?? 256;
  const worldFt = worldCells * 32;
  const terrainAt = (x, z) => mtm2Sim.groundHeightAt(terrain, x, z);

  const boxes = groundBoxGrids(sim, worldCells);
  const hasBoxes = !!boxes.ra0 && !!boxes.ra1 && boxes.ra0.some((lower, i) => lower !== boxes.ra1[i]);
  const boxScale = { stepFt: boxes.stepFt, baseFt: boxes.baseFt };

  const base = { worldFt, height: terrainAt, normal: (x, z, out) => out, surface: () => 0, ramps: [] };
  const layers = [sim.road, sim.meshGround].filter((r) => r?.positions?.length >= 9).map((r) => mtm2Sim.createRoadGround(base, r));

  const wrapDelta = (d) => d - worldFt * Math.round(d / worldFt);
  const mesh = meshGroundFromBuild(build, { terrainHeight: terrainAt, wrapDelta, worldFt });
  const meshTop = mesh ? mesh.boxes.reduce((top, b) => Math.max(top, b.pos[1] + b.radius), -Infinity) + 1 : -Infinity;

  /** The highest drivable surface at or under `y` (Infinity: the highest of all), or null for none. */
  function surfaceUnder(x, z, y) {
    const t = terrainAt(x, z);
    let best = t <= y ? t : -Infinity;
    if (hasBoxes) {
      // A box whose underside is under `y` is stood on: its top (moving-object.js `groundBoxHeightAt`).
      const h = mtm2Sim.groundBoxHeightAt(terrain, boxes.ra0, boxes.ra1, x, z, Number.isFinite(y) ? y : 1e6, false, boxScale);
      if (h !== t) best = Math.max(best, h);
    }
    for (const layer of layers) {
      const h = layer.below(() => y).height(x, z);
      if (h <= y) best = Math.max(best, h);
    }
    if (mesh) {
      const from = Math.min(y, meshTop);
      if (from > -Infinity) {
        const h = mesh.surfaceBelow(x, from, z, Math.max(1, from - Math.min(t, from) + 50));
        if (h !== null) best = Math.max(best, h);
      }
    }
    return best > -Infinity ? best : null;
  }

  return (x, z, refY) => {
    if (Number.isFinite(refY)) {
      const near = surfaceUnder(x, z, refY + REF_ABOVE_FT);
      if (near !== null) return near;
    }
    return surfaceUnder(x, z, Infinity) ?? terrainAt(x, z);
  };
}
