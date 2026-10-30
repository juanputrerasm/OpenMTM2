/*
  The sounds of a replay, rebuilt from what its records keep (MONSTER_EXE_ANALYSIS.md, "Instant replay and demos").

  A record keeps a truck's place, velocity, throttle, brakes and gear, not its engine speed or what its tires stand on,
  so the port makes each truck's sound frame (the one the race's `audio/truck-audio.js` reads) from those:
  - the engine speed as the simulation's drive turns it (MTM2_PHYSICS.md 5.2): `|transfer * ratio * v * 60 / (r * 2 pi)|`
    for a wheel of radius `r` at the body-forward speed `v`, at least idle, and in Park or Neutral (or with every wheel
    off the ground) the throttle's share of the top; it follows that target smoothly, as the simulation's does;
  - the throttle, the brakes and the gear, so the engine pulls and the gears change as they did;
  - what the screen finds from the picture (`extras`, per truck): each wheel on the ground or not and the surface under
    it (wheelspin, bridges, the airborne free-rev), the truck's vertical speed and whether it is in water (splashes and
    wading), and a hull's hard landing (`impact`, the knock).
  Corner skids need the tires' grip, which nothing keeps, and are left out. Pure, so it runs under Node.
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
    /**
     * `extras[i]`: `{ tires: [{ onGround, surface }] x4, vy, inWater, clearance, impact }` for truck i, any left out.
     */
    frame(trucks, dt, weather = 0, extras = []) {
      return trucks.map((pose, i) => {
        if (!pose) return null;
        const x = extras[i] ?? {};
        const tires = x.tires ?? [];
        const airborne = tires.length ? 4 - tires.filter((t) => t.onGround).length : 0;
        const forward = pose.forward ?? pose.speed ?? 0;
        // All four wheels in the air: nothing turns the engine but the throttle.
        const target = airborne === 4 ? replayRpm(0, 0, pose.throttle, radii[i]) : replayRpm(forward, pose.gear, pose.throttle, radii[i]);
        rpm[i] += (target - rpm[i]) * Math.min(1, dt * RPM_FOLLOW);
        return {
          rpm: rpm[i], throttle: pose.throttle ?? 0, brake: pose.brake ?? 0, gear: pose.gear ?? 0, speed: pose.speed ?? 0, forward,
          airborne, tires, weather, inWater: !!x.inWater, vy: x.vy ?? 0, clearance: x.clearance ?? 0, impact: x.impact ?? 0,
          hit: null, splash: false, heli: false,
        };
      });
    },
    /** A jump in the film: each engine starts from where its truck then is. */
    reset(trucks) {
      (trucks ?? []).forEach((pose, i) => { if (pose) rpm[i] = replayRpm(pose.forward ?? pose.speed, pose.gear, pose.throttle, radii[i]); });
    },
  };
}
