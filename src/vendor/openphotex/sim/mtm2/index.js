/*
  The Monster Truck Madness 2 simulation, as specified in OpenMTM2's docs/MTM2_PHYSICS.md.
  Exported from the package root as the `mtm2Sim` namespace; see docs/SIM_MTM2.md.
*/
export * from "./constants.js";
export * from "./math.js";
export * from "./time.js";
export * from "./world/terrain.js";
export * from "./world/surface.js";
export * from "./world/water.js";
export * from "./world/course.js";
export * from "./world/ground.js";
export { CHECKPOINT_TYPE, DETECTOR_WIDTH_SCALE, DETECTOR_HEIGHT_SCALE, SPHERE_PRETEST_FACTOR, buildCheckpoints, withinCheckpointReach, speedThroughCheckpoint, checkpointCrossingTime, pointInCheckpointBox, } from "./world/checkpoints.js";
export * from "./truck/params.js";
export * from "./truck/state.js";
export * from "./truck/controls.js";
export * from "./truck/drivetrain.js";
export { stepTruck, postStepTruck, tireGeometry, probeGround, lateralCoefficient, truckWeight } from "./truck/dynamics.js";
export { solveHullContacts } from "./truck/contacts.js";
export { fluidAreas, hullFaceWaterArea, wheelWaterAreas, SPLASH_SPEED } from "./truck/water-drag.js";
export * from "./truck/recovery.js";
export * from "./collide/box.js";
export { collideTruckBox, collideTruckImmovableBox, truckBoxSeparated } from "./collide/truck-box.js";
export { stepBox, postStepBox, boxInertia } from "./collide/box-step.js";
export { moveTrain, groundBoxHeightAt } from "./collide/train.js";
export { createRamp, rampHeightAt } from "./collide/ramp.js";
export { collideTrucks } from "./collide/truck-truck.js";
