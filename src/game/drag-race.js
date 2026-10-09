/*
  Drag races: an addition rebuilt from what the retail game kept of MTM1's drag strip
  (MONSTER_EXE_ANALYSIS.md 6.4). The exe still has the Christmas tree's lamps and their labels
  ("Prestage", "Stage", the three ambers, "Go", "Disqualify"), the tree's lamp bits (0x548cb0:
  1 prestaged, 3 staged, 0x40 disqualified, the ambers by the tree timer, 0x20 Go) and the
  staging globals, but nothing in 2.00.42 advances them.

  A drag strip's SIT has eight checkpoints: the prestage, stage and start beams across both
  lanes, the finish line, then each lane's two boundaries (lane 1: 4 and 5, lane 2: 6 and 7),
  which count only when crossed outward. Grid slot n races in lane n.

  - Staging: each truck creeps forward until its front breaks the prestage and then the stage
    beam, and holds there (auto-staging, for every truck).
  - The tree: with both lanes staged (or after STAGE_TIMEOUT_S), the three ambers light in turn,
    AMBER_S apart, then Go.
  - A truck whose front crosses the start beam before Go is red-lighted; one that crosses its
    lane's boundary before the finish is disqualified. Either way the other lane wins.
*/

export const AMBER_S = 0.5;
export const STAGE_TIMEOUT_S = 12;
/** Creeping speed while staging, ft/s. */
export const CREEP_SPEED = 6;
/** The tree's lamp bits (0x548cb0), and the labels the HUD draws beside them (0x651700). */
export const LAMP = Object.freeze({ PRESTAGE: 1, STAGE: 2, AMBER1: 4, AMBER2: 8, AMBER3: 16, GO: 32, DQ: 64 });
export const LAMP_LABELS = Object.freeze(["Prestage", "Stage", "\\", " Get Set", "/", "Go", "Disqualify"]);

/** A checkpoint gate as a heading frame: position, forward and right on the ground, half width. */
function gateFrame(cp) {
  const g = cp.gate ?? cp;
  const pos = g.position ?? g.pos;
  const psi = g.angles?.[2] ?? 0;
  return { pos, heading: psi, f: [Math.sin(psi), Math.cos(psi)], r: [Math.cos(psi), -Math.sin(psi)], half: (g.size?.[0] ?? 0) / 2 };
}

/** A point in a gate's frame: `z` along its forward axis, `x` across it. */
function local(gate, p) {
  const dx = p[0] - gate.pos[0], dz = p[2] - gate.pos[2];
  return { z: dx * gate.f[0] + dz * gate.f[1], x: dx * gate.r[0] + dz * gate.r[1] };
}

const beyond = (gate, p) => {
  const l = local(gate, p);
  return l.z >= 0 && Math.abs(l.x) <= gate.half;
};

/** Whether a SIT's checkpoints make a drag strip this module can run. */
export function isDragStrip(checkpoints) {
  return (checkpoints?.length ?? 0) >= 4;
}

/**
 * A drag race over the strip's checkpoints (raw SIT gates). `used` says which of the two lanes
 * has a truck; an empty lane counts as staged.
 */
export function createDrag(checkpoints, used = [true, true]) {
  const frames = checkpoints.map(gateFrame);
  return {
    phase: "staging", time: 0, tree: 0, elapsed: 0,
    prestage: frames[0], stage: frames[1], start: frames[2], finish: frames[3],
    bounds: [frames.slice(4, 6), frames.slice(6, 8)],
    lanes: used.map((u) => ({ prestaged: !u, staged: !u, dq: null, reaction: null, side: [], empty: !u })),
  };
}

/**
 * One step. `fronts` and `centres` are each lane's truck front and centre, `finished` whether
 * each has crossed the finish, `launched` whether each truck's driver has put its foot down
 * (for the reaction time). Returns "go" on the step the tree turns green.
 */
export function dragTick(drag, fronts, centres, finished, launched, dt) {
  drag.time += dt;
  if (drag.phase === "go") drag.elapsed += dt;
  let event = null;
  drag.lanes.forEach((lane, i) => {
    if (lane.dq) return;
    const front = fronts[i];
    if (!front) return;
    if (drag.phase !== "go") {
      if (beyond(drag.prestage, front)) lane.prestaged = true;
      if (beyond(drag.stage, front)) lane.staged = lane.prestaged = true;
      if (beyond(drag.start, front)) lane.dq = "red light";
      return;
    }
    if (lane.reaction === null && launched[i]) lane.reaction = drag.elapsed;
    if (finished[i]) return;
    // Outward over the lane's own boundary.
    for (const [k, gate] of (drag.bounds[i] ?? []).entries()) {
      const l = local(gate, centres[i]);
      const inside = Math.abs(l.x) <= gate.half;
      if (inside && lane.side[k] !== undefined && lane.side[k] < 0 && l.z >= 0) lane.dq = "out of lane";
      lane.side[k] = inside ? l.z : undefined;
    }
  });
  if (drag.phase === "staging") {
    const ready = drag.lanes.every((l) => l.staged || l.dq);
    if (ready || drag.time >= STAGE_TIMEOUT_S) { drag.phase = "tree"; drag.tree = 0; }
  } else if (drag.phase === "tree") {
    drag.tree += dt;
    if (drag.tree >= AMBER_S * 3) { drag.phase = "go"; event = "go"; }
  }
  return event;
}

/** A lane's lamp bits for the tree. */
export function dragLamps(drag, i) {
  const lane = drag.lanes[i];
  if (!lane) return 0;
  let bits = (lane.prestaged ? LAMP.PRESTAGE : 0) | (lane.staged ? LAMP.STAGE : 0);
  if (lane.dq) return bits | LAMP.DQ;
  if (drag.phase === "tree") bits |= LAMP.AMBER1 << Math.min(2, Math.floor(drag.tree / AMBER_S));
  if (drag.phase === "go") bits |= LAMP.GO;
  return bits;
}

/** Whether a lane's truck should still be creeping toward the stage beam. */
export function stillStaging(drag, i) {
  const lane = drag.lanes[i];
  return drag.phase === "staging" && !!lane && !lane.staged && !lane.dq;
}

/**
 * The places: finishers by time, then trucks still running, then the disqualified. `rows` are
 * `{ finished, raceTime, dq }`, one per truck.
 */
export function dragPlaces(rows) {
  const order = rows.map((r, i) => ({ r, i, dq: r.dq }));
  order.sort((a, b) => {
    if (!!a.dq !== !!b.dq) return a.dq ? 1 : -1;
    if (!!a.r.finished !== !!b.r.finished) return a.r.finished ? -1 : 1;
    if (a.r.finished) return a.r.raceTime - b.r.raceTime;
    return 0;
  });
  const places = new Array(rows.length);
  order.forEach((o, k) => { places[o.i] = k + 1; });
  return places;
}

/** The mirror of a course for the other lane: reflected across the strip's centre line. */
export function mirrorCourse(course, centre, heading) {
  const d = [Math.sin(heading), Math.cos(heading)];
  const flip = (p) => {
    if (!p) return p;
    const rx = p[0] - centre[0], rz = p[2] - centre[2];
    const along = rx * d[0] + rz * d[1];
    return [2 * (centre[0] + d[0] * along) - p[0], p[1], 2 * (centre[2] + d[1] * along) - p[2]];
  };
  return course.map((seg) => ({ ...seg, startFt: flip(seg.startFt), endFt: flip(seg.endFt) }));
}
