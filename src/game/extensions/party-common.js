/*
  What the party modes' worker runtimes share (game/extensions/session-loader.js and the modes with modules of their own,
  Deathmatch): the common runtime (placing a truck, driving by point, the end), the ground the chase modes roam, and
  small figures of a truck's state.
*/
import * as S from "../../vendor/openphotex/sim/mtm2/index.js";
import { createRumbleDriver } from "../rumble-ai.js";
import { coverOf, movableOf, roamRect } from "./tag.js";

/** A blocker or a chase-mode truck stuck this long within 12 ft calls the helicopter (the worker's headway watch). */
export const PATIENT_HEADWAY_S = 15;

export const worldVelocity = (state) => {
  const matrix = state.matrix, [x, y, z] = state.bvel;
  return [matrix[0] * x + matrix[1] * y + matrix[2] * z, matrix[3] * x + matrix[4] * y + matrix[5] * z, matrix[6] * x + matrix[7] * y + matrix[8] * z];
};

export const roamPoints = (course) => {
  const points = [];
  for (const segment of course) {
    if (segment.start) points.push([segment.start[0], segment.start[2]]);
    if (segment.end) points.push([segment.end[0], segment.end[2]]);
    if (segment.centre) points.push([segment.centre[0], segment.centre[2]]);
  }
  return points;
};

export function endRace(race) {
  race.over = true;
  for (const truck of race.trucks) truck.finished = true;
}

export function commonRuntime(payload, env) {
  const { trucks, race, step } = env;
  const sinceStart = () => race.clock - race.startTime;
  const driveByPoint = (truck) => {
    truck.recovery.player = true;
    truck.recovery.autopilot = false;
  };
  const resetDriver = (truck) => { truck.extensionDriver = createRumbleDriver(truck.extensionDriver?.aggression ?? 0.6); };
  const placeTruck = (truck, spot) => {
    const fresh = S.createTruckState(spot.pos, spot.heading, S.GEAR.PARK, truck.params);
    for (const [key, value] of Object.entries(fresh)) {
      if (ArrayBuffer.isView(value)) truck.state[key].set(value);
      else truck.state[key] = value;
    }
    truck.state.heliVisual = null;
    truck.flight = null;
    truck.exit = null;
    truck.headway = null;
    resetDriver(truck);
  };
  trucks.forEach((truck, index) => { truck.extensionDriver = createRumbleDriver(0.5 + ((index * 0.37) % 0.3)); });
  return { payload, trucks, race, step, sinceStart, driveByPoint, resetDriver, placeTruck, end: () => endRace(race) };
}

export const following = (env) => env.net?.authority === "follower";

/**
 * The ground the chase modes roam (Tag, Cops & Robbers): their rectangle, the covers on it, and the objects a truck
 * would rather not hit (the covers and every movable object, which moves with the object).
 */
export function chaseField(env) {
  const { levelBoxes, walls, course, specs, worldFt } = env;
  const home = [specs.reduce((sum, spec) => sum + spec.start.pos[0], 0) / specs.length, specs.reduce((sum, spec) => sum + spec.start.pos[2], 0) / specs.length];
  const covers = [], avoid = [];
  for (const box of levelBoxes) {
    const cover = coverOf(box);
    if (cover) covers.push(cover);
    const movable = movableOf(box);
    if (movable && !cover) avoid.push(movable);
  }
  for (const wall of walls ?? []) {
    const cover = coverOf({ pos: wall.pos, reach: Math.hypot(wall.size[0], wall.size[2]) * 0.5, tall: wall.size[1] });
    if (cover) covers.push(cover);
  }
  return { rect: roamRect(roamPoints(course), home, worldFt), covers, avoid: [...covers, ...avoid] };
}

/** A truck's speed, ft/s. */
export const speedOf = (state) => Math.hypot(state.bvel[0], state.bvel[1], state.bvel[2]);

