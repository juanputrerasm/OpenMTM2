/*
  Combat (docs/EXTENSIONS.md): the ground a truck that has lost wheels drives on. The simulation (OpenPhotex, left as it
  is) finds a wheel's ground by probing a tire's radius under its anchor; for a wheel that is gone this ground answers
  lower there by the tire's radius less the stub's, so the corner comes down until the bare axle end (the stub) meets the
  ground. The stub carries the corner but has no grip (the runtime takes the wheel off the ground before each step)
  and drags: that is where the sparks come from. Everywhere else it is the truck's ground as it was. Pure, so it runs
  under Node.
*/

/** The bare axle end's radius, feet: a lost wheel's corner rides this high over the ground. */
export const STUB_RADIUS_FT = 0.6;
/** The hidden patch's radius round a lost wheel's probe, feet, never more than this share of the way to a scrape point. */
export const LOST_REACH_FT = 1.6, LOST_REACH_SHARE = 0.45;

/**
 * Wrap `base` for one truck. `state()` gives its live state (pos, matrix), `params` its figures (hubs, tireWidthFt,
 * scrapePoints, tireRadiusFt) and `lost` an array of four booleans (FR, FL, RR, RL) that the caller keeps current.
 */
export function lostWheelGround(base, state, params, lost) {
  const drop = Math.max(0, params.tireRadiusFt - STUB_RADIUS_FT);
  // The patch round each wheel: no wider than a share of the way to the nearest scrape point, so the body still meets the ground.
  const reach = params.hubs.map((hub) => {
    let nearest = Infinity;
    for (const point of params.scrapePoints ?? []) nearest = Math.min(nearest, Math.hypot(point[0] - hub[0], point[2] - hub[2]));
    return Math.max(0.4, Math.min(LOST_REACH_FT, nearest * LOST_REACH_SHARE));
  });
  /** The world x, z of each lost wheel's probe, worked out once per call batch. */
  const spots = () => {
    const s = state(), m = s.matrix, out = [];
    for (let i = 0; i < 4; i++) {
      if (!lost[i]) continue;
      // The probe is half a tire width inward of the anchor (OpenPhotex postStepTruck); the hub is close enough.
      const sign = i % 2 === 0 ? -1 : 1;
      const [ax, ay, az] = params.hubs[i];
      const px = ax + sign * params.tireWidthFt * 0.5;
      out.push([s.pos[0] + m[0] * px + m[1] * ay + m[2] * az, s.pos[2] + m[6] * px + m[7] * ay + m[8] * az, reach[i]]);
    }
    return out;
  };
  const hidden = (x, z) => {
    if (!lost.some(Boolean)) return false;
    for (const [sx, sz, r] of spots()) if ((x - sx) ** 2 + (z - sz) ** 2 < r * r) return true;
    return false;
  };
  const ground = Object.create(base);
  ground.height = (x, z) => base.height(x, z) - (hidden(x, z) ? drop : 0);
  ground.normal = (x, z, out) => base.normal(x, z, out);
  ground.surface = (x, y, z) => base.surface(x, y, z);
  ground.lostWheels = lost;
  return ground;
}
