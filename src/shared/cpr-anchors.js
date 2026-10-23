/*
  A CPR car's wheel anchors for a vehicle model's springs (worker/foreign-truck-build.js `cprWheelPlaces` gives where
  its hubs rest). Pure, for the asset and simulation workers both.
*/

/**
 * A CPR car's anchors for a model whose springs sag `sagFt` (feet, one for both axles or `[front, rear]`) under its
 * weight, from where its hubs rest (`restHubs`, `cprWheelPlaces`): MTM2's model sags a car far more than CPR's does,
 * and the car is to rest at its ride height under either.
 */
export function cprAnchorsForSag(restHubs, sagFt) {
  const sag = (i) => (Array.isArray(sagFt) ? sagFt[i < 2 ? 0 : 1] : sagFt) ?? 0;
  return restHubs.map((h, i) => [h[0], h[1] - sag(i), h[2]]);
}
