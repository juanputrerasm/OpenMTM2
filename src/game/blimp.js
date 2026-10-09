/*
  The blimp (`GOODY.BIN`, MONSTER_EXE_ANALYSIS.md 11, flight 0x533590, set-up 0x5334a0, existence
  0x533a70): on every Circuit and Rally track at detail level 2 or more it flies the course, over the
  start of each straight in turn at 20 ft/s. It turns toward the straight's start at 0.3927 (pi / 8)
  of the angle left each second, picks its next one when it is within 100 ft of it, and climbs or
  sinks at a rate equal to the distance to 100 ft above the highest ground it can see ahead (eleven
  samples at 20 ft steps, 200 ft, on the heading and a diagonal either side), sinking at 0.3 of that.
  Pure, so it runs under Node.
*/
export const BLIMP_SPEED_FT = 20, BLIMP_TURN_RATE = Math.PI / 8, BLIMP_REACH_FT = 100, BLIMP_CLEARANCE_FT = 100, BLIMP_SINK = 0.3;
const LOOK_STEPS = 11, LATERAL_FT = 25;

/** Whether this race has the blimp. */
export const hasBlimp = ({ detailLevel, raceType }) => detailLevel >= 2 && (raceType === "circuit" || raceType === "rally");

const wrap = (a) => {
  const w = a - Math.trunc(a / (2 * Math.PI)) * 2 * Math.PI;
  return w > Math.PI ? w - 2 * Math.PI : w < -Math.PI ? w + 2 * Math.PI : w;
};

/** `straights`: the course's straights (`startFt`); `height(x, z)` the ground. */
export function createBlimp(straights, height) {
  const first = straights[0]?.startFt ?? [0, 0, 0];
  const state = { pos: [first[0], height(first[0], first[2]) + BLIMP_CLEARANCE_FT, first[2]], heading: 0, vel: [0, 0, 0], target: Math.min(1, straights.length - 1) };
  return {
    state,
    /** Fly for `dt` seconds. */
    update(dt) {
      if (!straights.length || dt <= 0) return state;
      const goal = straights[state.target].startFt;
      const dx = goal[0] - state.pos[0], dz = goal[2] - state.pos[2];
      if (Math.hypot(dx, dz) < BLIMP_REACH_FT) state.target = (state.target + 1) % straights.length;
      // Turn toward the straight's start by a share of the angle left.
      const wanted = Math.atan2(dx, dz);
      state.heading = wrap(wrap(wanted - state.heading) * dt * BLIMP_TURN_RATE + state.heading);
      const sx = Math.sin(state.heading) * BLIMP_SPEED_FT, sz = Math.cos(state.heading) * BLIMP_SPEED_FT;
      const lateral = Math.sin(state.heading) * -LATERAL_FT;
      let top = -1e7;
      for (let i = 0; i < LOOK_STEPS; i++) {
        const x = state.pos[0] + i * sx, z = state.pos[2] + i * sz;
        top = Math.max(top, height(x, z), height(x + lateral, z + lateral), height(x - lateral, z - lateral));
      }
      let climb = top - state.pos[1] + BLIMP_CLEARANCE_FT;
      if (climb < 0) climb *= BLIMP_SINK;
      state.vel = [sx, climb, sz];
      state.pos = [state.pos[0] + sx * dt, state.pos[1] + climb * dt, state.pos[2] + sz * dt];
      return state;
    },
  };
}
