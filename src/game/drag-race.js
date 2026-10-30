/*
  One drag pass (MONSTER_EXE_ANALYSIS.md 6.4): prestaging, staging, the tree, the launch, the
  disqualifications and the timing. The rules are from the CP3 author's written description of
  drag racing; he provided no source code. Pure, so it runs under Node; the simulation worker feeds it
  each lane's truck and drives the trucks by what it says.

  A drag strip's SIT has eight checkpoints: the prestage, stage and start beams across both
  lanes, the finish beam, then each lane's centre line and outer edge (lane 0: 4 and 5, lane 1:
  6 and 7), which count only when crossed outward. Grid slot n races in lane n.

  The beams are broken by the front tyre alone, and only where the tyre passes through the beam
  itself, between its two ends: never by the bodywork, never by a truck that is merely beyond the
  beam's line somewhere else on the strip.

  `rules` "mtm1" runs the pass by the 1996 game's code where it differs and the difference is one
  of rules (MTM1_MONSTER_EXE_ANALYSIS.md 5 and 7.2): no backing-up rule, and the Disqualify lamp
  for a red light only. The simulation worker adds the third: the computer launches on the green.
  Not followed: the 1996 game breaks the beams with the hull points and judges the lane by the
  truck overlapping its boundary boxes; here both stay as described above.
*/

/** Seconds: the prestage and stage phases' limits, the wait after the last truck stages, the tree, the pass's limit. */
export const PRESTAGE_TIMEOUT_S = 30;
export const STAGE_TIMEOUT_S = 30;
export const TREE_DELAY_S = 2;
export const TREE_S = 0.5;
export const DRAG_MAX_S = 33;
/** The fastest a truck is staged at, ft/s. */
export const MAX_STAGE_SPEED = 2;
/** Backing up faster than this (ft/s) for this long (s) after the green, a wheel on the ground, disqualifies. */
export const REVERSE_SPEED = 2;
export const REVERSE_S = 0.5;
/** How far into the gap between the stage and start beams an auto-staged truck rolls, as a share of it. */
export const STAGE_DEPTH = 0.25;
/** How far past the prestage beam an auto-staged truck stops, ft. */
const PRESTAGE_PAST_FT = 0.25;
/** The staging speed law's gain: `(distance * 2 * k) ^ 1/4`. The game's `decel_k` is not known; 1 is the port's. */
const STAGE_DECEL_K = 1;

/** A truck's state in the pass (the game's `ap.staged`). */
export const STAGED = Object.freeze({ NONE: 0, PRESTAGED: 1, STAGED: 2, LAUNCHED: 3 });
/** What puts a truck out (the game's `ap.staged` codes from 95 up). 95 is not a disqualification: the pass is run again. */
export const OUT = Object.freeze({ RERUN: 95, TIMEOUT: 96, LANE: 97, NOT_STAGED: 98, RED_LIGHT: 99 });
/** The disqualifications by name, as the lanes carry them in `dq`. */
export const DQ_CODE = Object.freeze({
  "timeout": OUT.TIMEOUT, "out of lane": OUT.LANE, "reversing": OUT.LANE, "not staged": OUT.NOT_STAGED, "red light": OUT.RED_LIGHT,
});
/** The tree's lamp bits (0x548cb0), and the labels the HUD draws beside them (0x651700). */
export const LAMP = Object.freeze({ PRESTAGE: 1, STAGE: 2, AMBER1: 4, AMBER2: 8, AMBER3: 16, GO: 32, DQ: 64 });
export const LAMP_LABELS = Object.freeze(["Prestage", "Stage", "\\", " Get Set", "/", "Go", "Disqualify"]);

/** A checkpoint gate as a heading frame: position, forward and right on the ground, half width. */
function gateFrame(cp) {
  const g = cp.gate ?? cp;
  const pos = g.position ?? g.pos;
  const psi = g.angles?.[2] ?? 0;
  return { pos, heading: psi, f: [Math.sin(psi), Math.cos(psi)], r: [Math.cos(psi), -Math.sin(psi)], half: (g.size?.[0] ?? 0) / 2, depth: g.size?.[2] ?? 1 };
}

/** A point in a gate's frame: `z` along its forward axis, `x` across it. */
function local(gate, p) {
  const dx = p[0] - gate.pos[0], dz = p[2] - gate.pos[2];
  return { z: dx * gate.f[0] + dz * gate.f[1], x: dx * gate.r[0] + dz * gate.r[1] };
}

/**
 * Whether a point broke a beam this step, and when: the share of the step (0 to 1) that had gone
 * by, or null. `seen` keeps the point's last place by `key`. The point must pass through the
 * beam between its ends, from behind: a J-drag's finish beam faces the other way and lies across
 * the way out, where the trucks pass it from in front, and counts only on the way back. A point
 * first seen standing in the beam has broken it.
 */
function breaks(gate, seen, key, p) {
  const now = local(gate, p), was = seen[key];
  seen[key] = now;
  if (Math.abs(now.x) > gate.half) return null;
  if (!was) return Math.abs(now.z) <= gate.depth / 2 ? 0 : null;
  if (Math.abs(was.x) > gate.half) return null;
  return was.z < 0 && now.z >= 0 ? was.z / (was.z - now.z) : null;
}

/** Whether a SIT's checkpoints make a drag strip this module can run. */
export function isDragStrip(checkpoints) {
  return (checkpoints?.length ?? 0) >= 4;
}

/**
 * A drag pass over the strip's checkpoints (raw SIT gates). `used` says which of the two lanes
 * has a truck; an empty lane is left out of every rule, so one truck can run alone.
 */
export function createDrag(checkpoints, used = [true, true], rules = "cp3") {
  const frames = checkpoints.map(gateFrame);
  return {
    rules,
    phase: "prestage", clock: 0, phaseTime: 0, tree: 0, greenAt: null,
    prestage: frames[0], stage: frames[1], start: frames[2], finish: frames[3],
    /** The staging gap: from the stage beam to the start beam, measured on this strip. */
    gap: Math.max(0, local(frames[1], frames[2].pos).z),
    bounds: [frames.slice(4, 6), frames.slice(6, 8)],
    lanes: used.map((u) => ({
      empty: !u, state: STAGED.NONE, stagedAt: null, dq: null, line: null, rerun: false, reaction: null, et: null, seen: {}, side: [], reverse: 0,
    })),
  };
}

const out = (lane) => !!lane.dq || lane.rerun;
/** Whether a lane's truck has nothing left to do: no truck, out, or timed. */
const settled = (lane) => lane.empty || out(lane) || lane.et !== null;

/** Whether the pass has ended: every truck is finished or out. */
export function dragOver(drag) {
  return drag.lanes.every(settled);
}

/**
 * One step. `trucks[i]` is lane i's truck, or null: `front` its front tyre's leading point,
 * `centre` its body's centre, `reversing` whether it is backing up faster than REVERSE_SPEED with
 * a wheel on the ground. Returns "go" on the step the tree turns green.
 */
export function dragTick(drag, trucks, dt) {
  const before = drag.clock;
  drag.clock += dt;
  drag.phaseTime += dt;
  const green = drag.phase === "go";
  let event = null;
  drag.lanes.forEach((lane, i) => {
    const truck = trucks[i];
    if (lane.empty || !truck) return;
    // A truck that is out is judged no more; its beams are still followed, so nothing is re-read later.
    const at = (key, gate) => {
      const share = breaks(gate, lane.seen, key, truck.front);
      return share === null ? null : before + share * dt;
    };
    const pre = at("prestage", drag.prestage), stage = at("stage", drag.stage), start = at("start", drag.start);
    const finish = at("finish", drag.finish);
    if (settled(lane)) return;
    if (pre !== null && lane.state < STAGED.PRESTAGED) lane.state = STAGED.PRESTAGED;
    if (stage !== null && lane.state < STAGED.STAGED) { lane.state = STAGED.STAGED; lane.stagedAt = drag.clock; }
    if (start !== null && lane.state < STAGED.LAUNCHED) {
      // The start beam before the green is the red light; after it, the reaction time.
      if (!green || start < drag.greenAt) { lane.dq = "red light"; return; }
      lane.state = STAGED.LAUNCHED;
      lane.reaction = start - drag.greenAt;
    }
    if (!green) return;
    if (finish !== null && lane.state === STAGED.LAUNCHED) { lane.et = finish - drag.greenAt; return; }
    // Outward over the lane's own centre line (the first bound) or edge (the second); `line` says which, for CP3's announcer.
    for (const [k, gate] of (drag.bounds[i] ?? []).entries()) {
      const l = local(gate, truck.centre);
      const inside = Math.abs(l.x) <= gate.half;
      if (inside && lane.side[k] !== undefined && lane.side[k] < 0 && l.z >= 0) { lane.dq = "out of lane"; lane.line = k === 0 ? "centre" : "edge"; }
      lane.side[k] = inside ? l.z : undefined;
    }
    lane.reverse = truck.reversing && drag.rules !== "mtm1" ? lane.reverse + dt : 0;
    if (lane.reverse >= REVERSE_S) lane.dq = "reversing";
    if (!lane.dq && drag.clock - drag.greenAt >= DRAG_MAX_S) lane.dq = "timeout";
  });

  const running = drag.lanes.filter((l) => !l.empty && !out(l));
  const move = (phase) => { drag.phase = phase; drag.phaseTime = 0; };
  /** Leave a staging phase: every truck there, or one there and the phase's limit gone by. Those not there are out. */
  const advance = (state, limit, next, wait = 0) => {
    const there = running.filter((l) => l.state >= state);
    if (!there.length) return;
    const all = there.length === running.length;
    if (all ? wait > 0 && drag.clock - Math.max(...there.map((l) => l.stagedAt ?? 0)) < wait : drag.phaseTime < limit) return;
    for (const l of running) if (l.state < state) l.dq = "not staged";
    move(next);
  };
  if (drag.phase === "prestage") advance(STAGED.PRESTAGED, PRESTAGE_TIMEOUT_S, "stage");
  else if (drag.phase === "stage") advance(STAGED.STAGED, STAGE_TIMEOUT_S, "tree", TREE_DELAY_S);
  else if (drag.phase === "tree") {
    drag.tree += dt;
    if (drag.tree >= TREE_S) { move("go"); drag.greenAt = drag.clock; event = "go"; }
  }
  return event;
}

/**
 * Two trucks touched. A truck already disqualified that runs into a clean one before it has
 * finished spoils that truck's pass: the clean truck is out with a re-run to come (code 95).
 */
export function dragCollision(drag, a, b) {
  for (const [guilty, wronged] of [[drag.lanes[a], drag.lanes[b]], [drag.lanes[b], drag.lanes[a]]]) {
    if (guilty?.dq && wronged && !settled(wronged)) wronged.rerun = true;
  }
}

/** A lane's lamp bits for the tree. The Disqualify lamp stands alone; a truck that never staged gets none. */
export function dragLamps(drag, i) {
  const lane = drag.lanes[i];
  if (!lane || lane.empty) return 0;
  if (lane.dq && drag.rules === "mtm1") return lane.dq === "red light" ? LAMP.DQ : 0;
  if (lane.dq) return lane.dq === "not staged" ? 0 : LAMP.DQ;
  let bits = (lane.state >= STAGED.PRESTAGED ? LAMP.PRESTAGE : 0) | (lane.state >= STAGED.STAGED ? LAMP.STAGE : 0);
  // The game's `1 << (int(timer * 8) + 1)`: the Stage lamp's own bit for the first eighth, then the three ambers.
  if (drag.phase === "tree") bits |= 1 << (Math.min(3, Math.floor(drag.tree * 8)) + 1);
  if (drag.phase === "go") bits |= LAMP.GO;
  return bits;
}

/**
 * How far (ft) a staging truck's front tyre still has to roll, or null when it is to hold: while
 * prestaging to just past the prestage beam, while staging to `depth` of the staging gap past the
 * stage beam.
 */
export function stagingDistance(drag, i, front, depth = STAGE_DEPTH) {
  const lane = drag.lanes[i];
  if (!lane || settled(lane)) return null;
  if (drag.phase === "prestage" && lane.state < STAGED.PRESTAGED) return PRESTAGE_PAST_FT - local(drag.prestage, front).z;
  if (drag.phase === "stage" && lane.state < STAGED.STAGED) return Math.min(0.85, Math.max(0, depth)) * drag.gap - local(drag.stage, front).z;
  return null;
}

/** The speed (ft/s) a staging truck is driven at, `distance` feet short of where it stops. */
export function stageSpeed(distance) {
  if (!(distance > 0)) return 0;
  return Math.min(MAX_STAGE_SPEED, (distance * 2 * STAGE_DECEL_K) ** 0.25);
}

/** Whether a lane's truck is still on its way to a staging beam. */
export function stillStaging(drag, i) {
  const lane = drag.lanes[i];
  return !!lane && !settled(lane) && ((drag.phase === "prestage" && lane.state < STAGED.PRESTAGED) || (drag.phase === "stage" && lane.state < STAGED.STAGED));
}

/** What each lane's truck made of the pass: the timing slip's lines, and what a drag event settles a pairing by. */
export function dragResults(drag) {
  return drag.lanes.map((lane) => (lane.empty ? null : {
    reaction: lane.reaction, et: lane.et, dq: lane.dq, code: lane.rerun ? OUT.RERUN : lane.dq ? DQ_CODE[lane.dq] : null, rerun: lane.rerun,
  }));
}

/**
 * A computer truck's pedals through its pass, once launched and until the finish beam (an addition: the autopilot's
 * speed control holds the strip's course speed and brakes over its bumps, so a computer truck coasted much of the
 * pass). On the straight (the autopilot's wheel within `DRAG_STRAIGHT` of centre, the truck sliding no more than
 * `DRAG_SLIP` radians) the throttle stays down; only a nose stood up past `WHEELIE_PITCH` (radians, positive nose up)
 * eases it to `WHEELIE_THROTTLE`, before the truck goes over backwards. Through a bend the autopilot's pedals stand:
 * flat out there slides the truck out of its lane.
 */
export const WHEELIE_PITCH = 0.35, WHEELIE_THROTTLE = 0.5, DRAG_STRAIGHT = 0.08, DRAG_SLIP = 0.12;
export function dragPedals(controls, pitch, slip = 0) {
  if (Math.abs(controls.steer) > DRAG_STRAIGHT || Math.abs(slip) > DRAG_SLIP) return;
  controls.throttle = pitch > WHEELIE_PITCH ? WHEELIE_THROTTLE : 1;
  controls.brakeFront = controls.brakeRear = 0;
}

/**
 * The places: finishers by time, then trucks still running, then those that are out. `rows` are
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
