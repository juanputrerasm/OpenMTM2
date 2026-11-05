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
  /*
    The world x, z and reach of each lost wheel's probe (`count` of them, three numbers each), worked out again only when
    the truck has moved or turned or lost another wheel since: the ground is asked many times a step from one place.
  */
  const spots = new Float64Array(12), seen = new Float64Array(9).fill(NaN), now = new Float64Array(9);
  let count = 0;
  const placeSpots = () => {
    const s = state(), m = s.matrix;
    let mask = 0;
    for (let i = 0; i < 4; i++) if (lost[i]) mask |= 1 << i;
    // What the places depend on: the lost wheels, the truck's x and z, and the matrix rows that give x and z.
    now[0] = mask; now[1] = s.pos[0]; now[2] = s.pos[2];
    now[3] = m[0]; now[4] = m[1]; now[5] = m[2]; now[6] = m[6]; now[7] = m[7]; now[8] = m[8];
    let same = true;
    for (let k = 0; k < 9; k++) if (now[k] !== seen[k]) { same = false; break; }
    if (same) return;
    seen.set(now);
    count = 0;
    for (let i = 0; i < 4; i++) {
      if (!lost[i]) continue;
      // The probe is half a tire width inward of the anchor (OpenPhotex postStepTruck); the hub is close enough.
      const sign = i % 2 === 0 ? -1 : 1;
      const [ax, ay, az] = params.hubs[i];
      const px = ax + sign * params.tireWidthFt * 0.5;
      spots[count * 3] = s.pos[0] + m[0] * px + m[1] * ay + m[2] * az;
      spots[count * 3 + 1] = s.pos[2] + m[6] * px + m[7] * ay + m[8] * az;
      spots[count * 3 + 2] = reach[i];
      count++;
    }
  };
  const hidden = (x, z) => {
    if (!(lost[0] || lost[1] || lost[2] || lost[3])) return false;
    placeSpots();
    for (let k = 0; k < count; k++) {
      const dx = x - spots[k * 3], dz = z - spots[k * 3 + 1], r = spots[k * 3 + 2];
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };
  const ground = Object.create(base);
  ground.height = (x, z) => base.height(x, z) - (hidden(x, z) ? drop : 0);
  ground.normal = (x, z, out) => base.normal(x, z, out);
  ground.surface = (x, y, z) => base.surface(x, y, z);
  ground.lostWheels = lost;
  return ground;
}
