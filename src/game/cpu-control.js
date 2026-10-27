/*
  A computer truck keeping control (an addition, not the game's): the course autopilot steers for its line, weaves
  at speed and never catches a slide, so a truck turning too fast slides, spins and ends up facing back down the
  course. This runs after the autopilot, on its controls:

  - **Damping the weave**: the wheel is turned against the truck's yaw rate a little, more at speed.
  - **Catching a slide**: when the truck's travel is more than `slipOk` off its nose at speed, the wheel turns
    toward the travel (counter-steer) and the throttle eases, fully at `slipFull`. Never in the air or on two
    wheels (a wheel turned on landing trips the truck), and never by braking (a truck braked sideways rolls).
  - **Facing the wrong way**: a slow truck whose way down the course lies more than `wrongWay` off its nose backs
    round (a three-point turn) instead of driving a wide circle.

  The figures were tuned on the stock circuits, eight computer trucks for 4 minutes (docs/PLAN.md): on
  Professional the field covers about 13 percent more laps with half the spins, on Intermediate about 4 percent.
  The steering added is taken back before the next autopilot step (the autopilot's steering is smoothed from its
  last value). Pure, so it runs under Node.
*/

/** Steering lock, radians. */
const LOCK = 0.45;
/**
 * The figures:
 * - `slipOk`, `slipFull`: travel this far off the nose (radians) starts a catch, and is caught fully;
 * - `slipGain`, `slipEase`: counter-steer per radian of slip, and how much the throttle eases in a full catch;
 * - `yawDamp`: steering against the yaw rate per rad/s, scaled by speed over 100 ft/s;
 * - `minSpeed`: below this speed (ft/s) the truck is left to the autopilot; `minWheels` on the ground to steer it;
 * - `wrongWay`, `wrongSpeed`, `turned`, `turnS`: the course this far off the nose (radians) under this speed starts a
 *   three-point turn, which ends inside `turned` or after `turnS` seconds.
 */
export const CPU_CONTROL = Object.freeze({
  slipOk: 0.18, slipFull: 0.5, slipGain: 1.3, slipEase: 0.5, yawDamp: 0.08, minSpeed: 25, minWheels: 3,
  wrongWay: 2.1, wrongSpeed: 25, turned: 1.0, turnS: 3,
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};

/** A truck's memory: the steering added last step, and a three-point turn under way. */
export function createCpuControl() {
  return { bias: 0, turn: null };
}

/** Take back the steering added last step, before the autopilot runs. */
export function cpuControlBefore(m, controls) {
  if (m.bias) controls.steer -= m.bias;
  m.bias = 0;
}

/**
 * One step after the autopilot. `state` is the truck (bvel, rates, euler, pos, tires, controls), `aim` a point down
 * the course (its segment's end) or null, `gears` { FIRST, REVERSE }. Returns "turn" while it backs round, else null.
 */
export function cpuControlStep(m, state, dt, aim, gears, T = CPU_CONTROL) {
  const c = state.controls;
  const [vx, , vz] = state.bvel;
  const speed = Math.hypot(vx, vz);
  // Facing the wrong way, slow: back round.
  if (aim) {
    const err = wrapPi(Math.atan2(aim[0] - state.pos[0], aim[2] - state.pos[2]) - state.euler[2]);
    if (m.turn) {
      m.turn.time += dt;
      if (Math.abs(err) < T.turned || m.turn.time > T.turnS) {
        m.turn = null;
        c.gear = gears.FIRST;
      } else {
        c.gear = gears.REVERSE;
        c.throttle = 0.7;
        c.brakeFront = c.brakeRear = 0;
        // Backing with the wheel turned away from the course swings the nose toward it.
        const before = c.steer;
        c.steer = -Math.sign(err || 1) * LOCK;
        c.rearSteer = -c.steer * 0.33;
        m.bias = c.steer - before;
        return "turn";
      }
    } else if (Math.abs(err) > T.wrongWay && speed < T.wrongSpeed && c.gear !== gears.REVERSE) {
      m.turn = { time: 0 };
      return "turn";
    }
  }
  if (speed < T.minSpeed || vz < 0) return null;
  // In the air, or on two wheels: the wheel does nothing, and a turned wheel on landing trips the truck.
  if ((state.tires?.filter((tire) => tire.onGround).length ?? 4) < T.minWheels) return null;
  const slip = Math.atan2(vx, vz);
  const before = c.steer;
  // The weave, damped (`rates[2]` is the yaw rate, positive turning right, as positive steering turns).
  let steer = c.steer - T.yawDamp * state.rates[2] * (speed / 100);
  // A slide: toward the travel, off the throttle.
  const over = Math.abs(slip) - T.slipOk;
  if (over > 0) {
    const w = Math.min(1, over / (T.slipFull - T.slipOk));
    steer = steer * (1 - w) + clamp(slip * T.slipGain, -LOCK, LOCK) * w;
    c.throttle *= 1 - T.slipEase * w;
    c.brakeFront = Math.min(c.brakeFront, 0.2);
    c.brakeRear = Math.min(c.brakeRear, 0.2);
  }
  c.steer = clamp(steer, -LOCK, LOCK);
  c.rearSteer = -c.steer * 0.33;
  m.bias = c.steer - before;
  return null;
}
