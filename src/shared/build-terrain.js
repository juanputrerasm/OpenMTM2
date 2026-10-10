/*
  The simulation's terrain from a track build (worker/track-build.js), for the screens' own ground queries:
  MTM's byte heightfield, or corner heights in feet where the level's is finer (CART Precision Racing).
*/
import { mtm2Sim } from "../vendor/openphotex/index.js";

export function terrainOfBuild(build) {
  return build.heightsFt
    ? mtm2Sim.createTerrainFt(new Float32Array(build.heightsFt), build.waterLevelFt ?? null)
    : mtm2Sim.createTerrain(new Uint8Array(build.heights), build.waterLevelFt ?? null);
}

/** The terrain and CPR's road and walls as the simulation worker's `init` takes them (worker/sim-worker.js). */
export function simGroundOfBuild(build) {
  return {
    heights: build.heights ? build.heights.slice().buffer : null,
    heightsFt: build.heightsFt ? build.heightsFt.slice().buffer : null,
    road: build.sim.road ?? null,
    walls: build.sim.walls ?? null,
    meshGround: build.sim.meshGround ?? null,
  };
}
