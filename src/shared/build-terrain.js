/*
  The simulation's terrain from a track build (worker/track-build.js), for the screens' own ground queries:
  MTM's byte heightfield, or corner heights in feet where the level's is finer (CART Precision Racing), with 4x4
  Evolution 2's smoothed fine grid where it was built (`fineFt`).
*/
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";

export function terrainOfBuild(build) {
  const terrain = build.heightsFt
    ? mtm2Sim.createTerrainFt(new Float32Array(build.heightsFt), build.waterLevelFt ?? null, build.fineFt ? new Float32Array(build.fineFt) : null)
    : mtm2Sim.createTerrain(new Uint8Array(build.heights), build.waterLevelFt ?? null);
  return withLakes(terrain, build.lakes);
}

/**
 * Community Patch 4's lakes on a terrain (docs/CP4_EXE_ANALYSIS.md 2): `lakes` is a build's `{ tileMap, levelFt }`
 * (worker/track-build.js), or null for none.
 */
export function withLakes(terrain, lakes) {
  return lakes ? mtm2Sim.setTerrainLakes(terrain, new Uint8Array(lakes.tileMap), new Float32Array(lakes.levelFt)) : terrain;
}

/** The terrain and CPR's road and walls as the simulation worker's `init` takes them (worker/sim-worker.js). */
export function simGroundOfBuild(build) {
  return {
    heights: build.heights ? build.heights.slice().buffer : null,
    heightsFt: build.heightsFt ? build.heightsFt.slice().buffer : null,
    fineFt: build.fineFt ? build.fineFt.slice().buffer : null,
    lakes: build.lakes ? { tileMap: build.lakes.tileMap.slice().buffer, levelFt: build.lakes.levelFt.slice().buffer } : null,
    road: build.sim.road ?? null,
    walls: build.sim.walls ?? null,
    // CPR: the track's centreline, which its cars' computer drivers follow (game/cpr-driver.js).
    cprLine: build.sim.cprLine ?? null,
    meshGround: build.sim.meshGround ?? null,
    faces: build.sim.faces ?? null,
  };
}
