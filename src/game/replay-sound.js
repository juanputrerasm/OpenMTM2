/*
  The sounds of a replay, rebuilt from what its records keep (MONSTER_EXE_ANALYSIS.md, "Instant replay and demos").

  A record keeps a truck's place, speed, throttle and gear, not its engine speed or what its tires stand on, so the port
  makes each truck's sound frame (the one the race's `audio/truck-audio.js` reads) from those:
  - the engine speed as the simulation's drive turns it (MTM2_PHYSICS.md 5.2): `|transfer * ratio * v * 60 / (r * 2 pi)|`
    for a wheel of radius `r`, at least idle, and in Park or Neutral the throttle's share of the top; it follows that
    target smoothly, as the simulation's does;
  - the throttle and the gear, so the engine pulls and the gears change as they did.
  Skids, splashes and hull knocks need what the records do not keep, and are left out. Pure, so it runs under Node.
*/
import { ENGINE, GEAR_RATIOS } from "../vendor/openphotex/sim/mtm2/constants.js";

/** The Garage's default transfer gear (setting 1500, A§8.5): a replay does not keep the truck's setup. */
const DEFAULT_TRANSFER = 1.185;
/** How quickly the engine speed follows its target, per second. */
const RPM_FOLLOW = 6;

/** The engine speed a truck's wheels turn it to at `speed` (ft/s) in `gear` (GEAR), with `throttle` for Park and Neutral. */
export function replayRpm(speed, gear, throttle, radiusFt, transfer = DEFAULT_TRANSFER) {
  const ratio = GEAR_RATIOS[gear] ?? 0;
  const target = ratio === 0
    ? (throttle ?? 0) * ENGINE.maxRpm
    : Math.abs((transfer * ratio * (speed ?? 0) * 60) / (Math.max(0.5, radiusFt ?? 2.75) * 2 * Math.PI));
  return Math.min(ENGINE.maxRpm, Math.max(ENGINE.idleRpm, target));
}

/** `radii`: each truck's wheel radius (ft). `frame` makes the trucks' sound frames for a moment of the film. */
export function createReplaySound(radii) {
  const rpm = radii.map(() => ENGINE.idleRpm);
  return {
    /** `trucks`: the playback's poses (null for one not in the film), `dt` the film's seconds since the last frame. */
    frame(trucks, dt, weather = 0) {
      return trucks.map((pose, i) => {
        if (!pose) return null;
        const target = replayRpm(pose.speed, pose.gear, pose.throttle, radii[i]);
        rpm[i] += (target - rpm[i]) * Math.min(1, dt * RPM_FOLLOW);
        return {
          rpm: rpm[i], throttle: pose.throttle ?? 0, brake: 0, gear: pose.gear ?? 0, speed: pose.speed ?? 0, forward: pose.speed ?? 0,
          airborne: 0, tires: [], weather, inWater: false, vy: 0, clearance: 0, impact: 0, hit: null, splash: false, heli: false,
        };
      });
    },
    /** A jump in the film: each engine starts from where its truck then is. */
    reset(trucks) {
      (trucks ?? []).forEach((pose, i) => { if (pose) rpm[i] = replayRpm(pose.speed, pose.gear, pose.throttle, radii[i]); });
    },
  };
}
