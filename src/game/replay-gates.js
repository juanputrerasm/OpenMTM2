/*
  The checkpoint and lap sounds of a replay. A replay file keeps no checkpoint passes, so they are found from the film:
  a truck passes its next checkpoint when its centre goes forward through the gate's middle plane (the box's local
  z = 0, +z being the way through, MTM2_PHYSICS.md 14.24) inside the gate's width and height. The checkpoints are
  passed in order, as in the race, and the last one closes a lap. After a jump in the film the order is not known:
  the first gate a truck then goes through sets it, silently. Pure, so it runs under Node.
*/

/** A point in a gate's own frame (`{ position, matrix }`, matrix rows as the simulation keeps them). */
function local(gate, p) {
  const m = gate.matrix, dx = p[0] - gate.position[0], dy = p[1] - gate.position[1], dz = p[2] - gate.position[2];
  return [m[0] * dx + m[3] * dy + m[6] * dz, m[1] * dx + m[4] * dy + m[7] * dz, m[2] * dx + m[5] * dy + m[8] * dz];
}

/** Whether going from `from` to `to` (game feet) crosses `gate` forward, within its width and height. */
export function crossesGate(gate, from, to) {
  if (!gate?.matrix || !gate.position || !gate.size) return false;
  const a = local(gate, from), b = local(gate, to);
  if (!(a[2] < 0 && b[2] >= 0)) return false;
  const k = -a[2] / (b[2] - a[2]);
  const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
  return Math.abs(x) <= gate.size[0] / 2 && Math.abs(y) <= gate.size[1] / 2;
}

/**
 * `checkpoints`: the level's (`{ gate }` each). `pass(trucks)` with each truck's position (null for none) returns per
 * truck null, "checkpoint" or "lap". `reset(known)` after a jump: `known` true at the film's start (every truck's next
 * gate is the first), false elsewhere (unknown until one is passed).
 */
export function createReplayGates(checkpoints) {
  const gates = (checkpoints ?? []).map((c) => c?.gate).filter(Boolean);
  const n = gates.length;
  let next = [], last = [];
  return {
    reset(known = true) { next = known ? [] : null; last = []; },
    /** The film moved without playing forward (paused, rewound): the positions taken, nothing passed. */
    follow(trucks) { last = trucks.map((pos) => (pos ? [...pos] : null)); },
    pass(trucks) {
      if (next === null) next = trucks.map(() => -1);
      return trucks.map((pos, i) => {
        const from = last[i];
        last[i] = pos ? [...pos] : null;
        if (!n || !pos || !from) return null;
        const want = next[i] ?? 0;
        if (want < 0) {
          // Not known: whichever gate is gone through sets the order.
          const k = gates.findIndex((gate) => crossesGate(gate, from, pos));
          if (k >= 0) next[i] = (k + 1) % n;
          return null;
        }
        if (!crossesGate(gates[want], from, pos)) return null;
        next[i] = (want + 1) % n;
        return want === n - 1 ? "lap" : "checkpoint";
      });
    },
  };
}
