/*
  Which tracks a mode can be played on, shared by the extensions that race through checkpoints (Combat, Race &
  Rumble). A track with checkpoints is a circuit or a rally: MTM2's and MTM1's own, CART Precision Racing's tracks
  (listed as circuits) and 4x4 Evolution's circuits and rallies. Free roam tracks and levels, drag strips (two lanes,
  no course to race round) and Summit Rumbles have none.
*/

/** The race types that are raced through checkpoints. */
export const CHECKPOINT_RACE_TYPES = Object.freeze(["circuit", "rally"]);

/** Whether `track` (a catalog entry) is raced through checkpoints. */
export function hasCheckpoints(track) {
  return !!track && !track.freeRoamOnly && CHECKPOINT_RACE_TYPES.includes(track.raceType ?? "circuit");
}
