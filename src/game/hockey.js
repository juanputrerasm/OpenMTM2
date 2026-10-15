/*
  Hockey (docs/PLAN.md, "Party modes"): two teams of trucks and the puck on Breakneck Ridge's
  frozen lake in Snow, first to a number of goals. An addition; the game has the rink's puck and
  goals but no game on them.

  The rink is read from the level (`hockeyRink`): the puck, the two goal frames and the posts at
  their mouths, the ice from the water level, and boards round it 8 ft inside the shore. The rules
  (`createHockey`, `hockeyStep`) run in the simulation worker after the race tick; the screen
  draws the boards and tints the goals. Positions are game feet; the rink's own frame is `a` along
  the line from the red goal to the blue one and `b` across it. Pure, so it runs under Node.
*/

export const HOCKEY_TRACK = "ROCKQRY.SIT";
/** Whether `track` (a catalogue entry) can host Hockey: MTM2's own Breakneck Ridge. */
export function isHockeyTrack(track) {
  return !!track && String(track.file ?? "").toUpperCase() === HOCKEY_TRACK
    && (!track.game || track.game === "MTM2");
}
/** Snow: the lake is frozen. */
export const HOCKEY_WEATHER = 5;
export const DEFAULT_GOALS = 3;
export const PUCK_MODEL = "HPUCK.BIN";
export const GOAL_MODEL = "HPOST3.BIN";
export const TEAM_NAMES = Object.freeze(["Red", "Blue"]);
/** The teams' colours, for the labels over the trucks and the goal frames. */
export const TEAM_COLOURS = Object.freeze(["#ff4436", "#3f8cff"]);
/** Frozen water (ground type 8) and what the trucks take it as on the rink: gravel (type 7). */
export const FROZEN_SURFACE = 800;
export const RINK_SURFACE = 700;
export const BOARD_HEIGHT_FT = 8;
export const BOARD_THICK_FT = 2;
/** Play goes on this long after a goal, and the face-off holds the trucks this long. */
export const CELEBRATE_S = 2.5;
export const FACEOFF_HOLD_S = 3;
/** A truck's body origin over the ice at the face-off, as a grid slot holds it over the ground. */
export const RIDE_FT = 6;
/** A truck this far outside the boards for this long is put back at its face-off spot. */
export const ESCAPE_FT = 4, ESCAPE_S = 2;

const POST_REACH_FT = 45;
const POST_HALF_FT = 2;
const BOARD_INSET_FT = 8;
const CORNER_MIN_FT = 20, CORNER_MAX_FT = 120, CORNER_STEP_FT = 10;
const SCAN_STEP_FT = 2, SCAN_MAX_FT = 1500;
const PUCK_LIFT_FT = 0.3;
const OUT_PAST_FT = 20, OUT_UNDER_FT = 6, OUT_OVER_FT = 200;
/** A team's face-off spots, (along toward its own goal, across), feet from the centre. */
const SPOTS = [[40, 28], [40, -28], [95, 55], [95, -55]];
/** The computer trucks: the gap kept behind the puck, a defender's distance in front of its goal. */
const STAND_FT = 14;
const DEFEND_FT = 60;
/**
 * Lined up behind the puck: the cosine to start driving through it, and to keep on; the extra way back behind it per
 * unit of miss; below this cosine the truck is on the wrong side of it.
 */
const THROUGH_ENTER = 0.85, THROUGH_HOLD = 0.6;
/** And facing the puck: the cosine to start, and to keep on. */
const FACING_ENTER = 0.8, FACING_HOLD = 0.5;
/** The speed a truck carries the puck at, ft/s: faster, and the box-shaped puck flies off a face, wide. */
const CARRY_SPEED = 40;
/** The least share of its speed a truck keeps in a sharp turn on the ice (game/rumble-ai.js `driveToPoint`). */
export const TURN_FLOOR = 0.12;
const BACK_PER_MISS_FT = 40;
const WRONG_SIDE = 0;
/** A rink truck still under throttle this long gets `NUDGE_FT_S` the way its gear drives. */
export const NUDGE_AFTER_S = 0.5, NUDGE_FT_S = 0.6;
/** A wing waits this far behind the puck and this far to its side; the attack changes hands at this much nearer. */
const WING_BACK_FT = 70, WING_WIDE_FT = 55;
const ATTACK_SWAP_FT = 25;

const hyp = (x, z) => Math.hypot(x, z);

/**
 * The rink from the level's collision boxes (`{ modelName, type, positionFt, sizeFt, bounds, sitIndex }`,
 * worker/track-build.js `sim.boxes`), the ground's height without Snow's ice `groundAt(x, z)` and the
 * water level. Null when the level has no puck, not two goal frames, or no water.
 */
export function hockeyRink(boxes, groundAt, iceFt) {
  if (iceFt === null || iceFt === undefined) return null;
  const puckBox = boxes.find((b) => b.modelName === PUCK_MODEL && b.positionFt);
  const frames = boxes.filter((b) => b.modelName === GOAL_MODEL && b.positionFt).sort((p, q) => p.positionFt[0] - q.positionFt[0]);
  if (!puckBox || frames.length !== 2) return null;
  const [f0, f1] = frames.map((f) => f.positionFt);
  const centre = [(f0[0] + f1[0]) / 2, (f0[2] + f1[2]) / 2];
  const length = hyp(f1[0] - f0[0], f1[2] - f0[2]);
  if (!(length > 0)) return null;
  const u = [(f1[0] - f0[0]) / length, (f1[2] - f0[2]) / length];
  const v = [-u[1], u[0]];
  const frame = { centre, u, v };
  const local = (x, z) => toLocal(frame, x, z);
  const world = (a, b) => toWorld(frame, a, b);

  // The goals: red (team 0) defends the one at the low-x end, whose outside is toward -a.
  const goals = frames.map((f, team) => {
    const at = local(f.positionFt[0], f.positionFt[2]);
    const posts = boxes.filter((b) => !b.modelName && b.type === 0 && b.positionFt
      && hyp(b.positionFt[0] - f.positionFt[0], b.positionFt[2] - f.positionFt[2]) < POST_REACH_FT)
      .map((b) => local(b.positionFt[0], b.positionFt[2]).b);
    const half = f.bounds ? (f.bounds.max[0] - f.bounds.min[0]) * 0.4 : 25;
    const mouth = posts.length >= 2
      ? [Math.min(...posts) + POST_HALF_FT, Math.max(...posts) - POST_HALF_FT]
      : [at.b - half, at.b + half];
    return {
      team, along: at.a, out: team === 0 ? -1 : 1, mouth,
      top: f.positionFt[1] + (f.bounds?.max[1] ?? 20), pos: [f.positionFt[0], f.positionFt[2]], sitIndex: f.sitIndex,
    };
  });

  // How far the ice reaches from the centre each way, and the boards that far less the inset.
  const onIce = (a, b) => { const [x, z] = world(a, b); return groundAt(x, z) < iceFt; };
  const reach = (da, db) => {
    let d = 0;
    while (d < SCAN_MAX_FT && onIce(da * d, db * d)) d += SCAN_STEP_FT;
    return d - BOARD_INSET_FT;
  };
  const extent = { minA: -reach(-1, 0), maxA: reach(1, 0), minB: -reach(0, -1), maxB: reach(0, 1) };
  // Each corner cut at 45 degrees, as far as needed for the cut's middle to lie on the ice.
  const corner = (a, b, sa, sb) => {
    let c = CORNER_MIN_FT;
    while (c < CORNER_MAX_FT && !onIce(a - sa * c / 2, b - sb * c / 2)) c += CORNER_STEP_FT;
    return c;
  };
  const { minA, maxA, minB, maxB } = extent;
  const c0 = corner(minA, minB, -1, -1), c1 = corner(maxA, minB, 1, -1), c2 = corner(maxA, maxB, 1, 1), c3 = corner(minA, maxB, -1, 1);
  const outline = [
    [minA + c0, minB], [maxA - c1, minB], [maxA, minB + c1], [maxA, maxB - c2],
    [maxA - c2, maxB], [minA + c3, maxB], [minA, maxB - c3], [minA, minB + c0],
  ];
  const boards = outline.map((p, i) => board(frame, p, outline[(i + 1) % outline.length], iceFt));

  const bounds = puckBox.bounds ?? { min: [-12, -4, -12], max: [12, 4, 12] };
  const puckHalf = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[1] - bounds.min[1]) / 2, (bounds.max[2] - bounds.min[2]) / 2];
  return {
    frame, centre, iceFt, goals, extent, boards,
    puck: {
      sitIndex: puckBox.sitIndex, radius: Math.max(puckHalf[0], puckHalf[2]), psi: puckBox.psi ?? 0,
      start: [centre[0], iceFt + puckHalf[1] + PUCK_LIFT_FT, centre[1]],
    },
  };
}

/**
 * The boxes `hockeyRink` reads, from a track build (worker/track-build.js): the collision boxes (the
 * puck, the posts) and the goal frames, which never collide and so are only among the drawn objects.
 */
export function rinkBoxes(build) {
  const frames = (build.objects ?? []).filter((o) => o.model === GOAL_MODEL && build.originals?.[o.sitIndex]).map((o) => {
    const [x, y, z, , , psi] = build.originals[o.sitIndex];
    return { modelName: o.model, type: o.type, sitIndex: o.sitIndex, positionFt: [x, y, z], psi, bounds: build.models?.[o.model]?.bounds ?? null };
  });
  return [...(build.sim?.boxes ?? []), ...frames];
}

/** A point in the rink's frame: `{ a, b }`. */
export function toLocal(frame, x, z) {
  const dx = x - frame.centre[0], dz = z - frame.centre[1];
  return { a: dx * frame.u[0] + dz * frame.u[1], b: dx * frame.v[0] + dz * frame.v[1] };
}

/** A point of the rink's frame in the world, `[x, z]`. */
export function toWorld(frame, a, b) {
  return [frame.centre[0] + frame.u[0] * a + frame.v[0] * b, frame.centre[1] + frame.u[1] * a + frame.v[1] * b];
}

/**
 * One board from `p` to `q` (rink frame), its inner face on that line: a wall as the simulation takes
 * it (`{ pos, size, psi }`, the box's z along the board) and the ends, for drawing.
 */
function board(frame, p, q, iceFt) {
  const [x0, z0] = toWorld(frame, p[0], p[1]), [x1, z1] = toWorld(frame, q[0], q[1]);
  const length = hyp(x1 - x0, z1 - z0);
  const dir = [(x1 - x0) / length, (z1 - z0) / length];
  // Outward: away from the rink's centre.
  let n = [dir[1], -dir[0]];
  const mid = [(x0 + x1) / 2, (z0 + z1) / 2];
  if (n[0] * (mid[0] - frame.centre[0]) + n[1] * (mid[1] - frame.centre[1]) < 0) n = [-n[0], -n[1]];
  return {
    from: [x0, z0], to: [x1, z1],
    pos: [mid[0] + n[0] * BOARD_THICK_FT / 2, iceFt + BOARD_HEIGHT_FT / 2, mid[1] + n[1] * BOARD_THICK_FT / 2],
    size: [BOARD_THICK_FT, BOARD_HEIGHT_FT, length + BOARD_THICK_FT],
    psi: Math.atan2(dir[0], dir[1]),
  };
}

/**
 * The teams of `count` trucks, the player's (truck 0) first: red (0) or blue (1) by `random`, then the
 * others alternate, the other team first.
 */
export function hockeyTeams(count, random = Math.random) {
  const mine = random() < 0.5 ? 0 : 1;
  return Array.from({ length: count }, (_, i) => (mine + i) % 2);
}

/** Where truck `i` of `teams` faces off: `{ pos, heading }`, on its own half facing the other goal. */
export function hockeySpot(rink, teams, i) {
  const team = teams[i];
  const nth = teams.slice(0, i).filter((t) => t === team).length;
  const [back, across] = SPOTS[nth] ?? [150, (nth - SPOTS.length) * 30 - 30];
  const own = rink.goals[team];
  // Toward its own goal is `own.out` along the rink.
  const [x, z] = toWorld(rink.frame, own.out * back, across);
  const facing = [-own.out * rink.frame.u[0], -own.out * rink.frame.u[1]];
  return { pos: [x, rink.iceFt + RIDE_FT, z], heading: Math.atan2(facing[0], facing[1]) };
}

/** A game of Hockey: `teams[i]` the team of truck i, `target` the goals that win it. */
export function createHockey(rink, teams, target = DEFAULT_GOALS) {
  return {
    rink, teams: [...teams], target: Math.max(1, Math.trunc(target) || DEFAULT_GOALS),
    score: [0, 0], goals: teams.map(() => 0), phase: "play", timer: 0,
    /** The truck that touched the puck last, or -1. */
    lastTouch: -1,
    /** The last event (`{ kind: "goal", team, scorer, own }` or `{ kind: "out" }`) and how many there have been. */
    event: null, events: 0,
    prev: null,
  };
}

/**
 * One step of play once the race runs, with the puck's position: goals, the pause after one, the
 * face-off. Returns "reset" when the trucks and the puck go back to the face-off, "over" when the game
 * ends, else null.
 */
export function hockeyStep(h, puckPos, dt) {
  const { rink } = h;
  const at = toLocal(rink.frame, puckPos[0], puckPos[2]);
  const prev = h.prev;
  h.prev = at;
  if (h.phase === "over") return null;
  if (h.phase === "goal") {
    h.timer -= dt;
    if (h.timer > 0) return null;
    if (h.score.some((s) => s >= h.target)) { h.phase = "over"; return "over"; }
    return faceOff(h);
  }
  if (h.phase === "faceoff") {
    h.timer -= dt;
    if (h.timer <= 0) h.phase = "play";
    return null;
  }
  const r = rink.puck.radius;
  if (prev) {
    for (const g of rink.goals) {
      const past = (at.a - g.along) * g.out, before = (prev.a - g.along) * g.out;
      if (!(before < r && past >= r && at.b > g.mouth[0] && at.b < g.mouth[1] && puckPos[1] < g.top)) continue;
      const team = 1 - g.team;
      const toucher = h.lastTouch;
      const scorer = toucher >= 0 && h.teams[toucher] === team ? toucher : -1;
      h.score[team]++;
      if (scorer >= 0) h.goals[scorer]++;
      h.event = { kind: "goal", team, scorer, own: toucher >= 0 && scorer < 0 ? toucher : -1 };
      h.events++;
      h.phase = "goal";
      h.timer = CELEBRATE_S;
      return null;
    }
  }
  const { minA, maxA, minB, maxB } = rink.extent;
  const out = at.a < minA - OUT_PAST_FT || at.a > maxA + OUT_PAST_FT || at.b < minB - OUT_PAST_FT || at.b > maxB + OUT_PAST_FT
    || puckPos[1] < rink.iceFt - OUT_UNDER_FT || puckPos[1] > rink.iceFt + OUT_OVER_FT;
  if (out) {
    h.event = { kind: "out" };
    h.events++;
    return faceOff(h);
  }
  return null;
}

function faceOff(h) {
  h.phase = "faceoff";
  h.timer = FACEOFF_HOLD_S;
  h.lastTouch = -1;
  h.prev = null;
  return "reset";
}

/** Whether a position is outside the boards by more than `margin` feet (the cut corners count as square). */
export function outsideRink(rink, pos, margin = ESCAPE_FT) {
  const { a, b } = toLocal(rink.frame, pos[0], pos[2]);
  const { minA, maxA, minB, maxB } = rink.extent;
  return a < minA - margin || a > maxA + margin || b < minB - margin || b > maxB + margin;
}

/** Whether the trucks are held (the face-off). */
export const hockeyHeld = (h) => h.phase === "faceoff";

/** Each truck's place: by its team's score, then its own goals, then the entry order. */
export function hockeyPlaces(h) {
  const order = h.teams.map((_, i) => i).sort((i, j) =>
    (h.score[h.teams[j]] - h.score[h.teams[i]]) || (h.goals[j] - h.goals[i]) || (i - j));
  const places = new Array(h.teams.length);
  order.forEach((i, k) => { places[i] = k + 1; });
  return places;
}

/**
 * Each truck's part in its team this step, `{ role, side }`: the truck nearest the puck attacks (the
 * player's too, whose computer teammates then play round it), a team of three or more keeps its last
 * computer truck back as `defend`, and the rest are wings, on alternate sides behind the attack. The
 * attacker stays so until a teammate is 25 ft nearer the puck. `cpu[i]` says which trucks are driven.
 */
export function hockeyRoles(h, positions, cpu, puckPos) {
  h.attackers ??= [-1, -1];
  const roles = h.teams.map(() => ({ role: "attack", side: 1 }));
  const near = (i) => hyp(positions[i][0] - puckPos[0], positions[i][2] - puckPos[2]);
  for (const team of [0, 1]) {
    const mine = h.teams.map((t, i) => (t === team ? i : -1)).filter((i) => i >= 0);
    const cpus = mine.filter((i) => cpu[i]);
    const defender = mine.length >= 3 && cpus.length ? cpus[cpus.length - 1] : -1;
    const field = mine.filter((i) => i !== defender);
    let attacker = field.includes(h.attackers[team]) ? h.attackers[team] : -1;
    for (const i of field) if (attacker < 0 || near(i) < near(attacker) - ATTACK_SWAP_FT) attacker = i;
    h.attackers[team] = attacker;
    let side = 1;
    for (const i of mine) {
      if (i === defender) roles[i] = { role: "defend", side: 1 };
      else if (i !== attacker) { roles[i] = { role: "wing", side }; side = -side; }
    }
  }
  return roles;
}

/**
 * Where a computer truck of `team` (`truck`, `{ pos, heading }`) drives, and how fast (`{ point, speed }`,
 * ft/s), with the puck at `puckPos`, for its `role` (`hockeyRoles`). The attack gets behind the puck on the line from the
 * goal it attacks, the farther back the worse it lines up, then once lined up and facing it carries it
 * on its nose into the goal (and on until either is lost by more); from the wrong side it goes round, wide. `memo` keeps that between
 * steps. A wing waits behind the play on its `side`. A defender stays in front of its own goal while the puck is in the other half.
 */
export function hockeyAim(rink, team, role, truck, puckPos, side = 1, memo = {}) {
  const { frame, extent } = rink;
  const { pos, heading } = truck;
  const p = toLocal(frame, puckPos[0], puckPos[2]), t = toLocal(frame, pos[0], pos[2]);
  const own = rink.goals[team], attack = rink.goals[1 - team];
  const at = (a, b) => {
    const [x, z] = toWorld(frame, Math.max(extent.minA + 10, Math.min(extent.maxA - 10, a)), Math.max(extent.minB + 10, Math.min(extent.maxB - 10, b)));
    return [x, rink.iceFt, z];
  };
  /** Up to `top` ft/s toward a place to wait at, stopping there. */
  const waitAt = (a, b, top) => {
    const d = hyp(a - t.a, b - t.b);
    return { point: at(a, b), speed: d < 12 ? 0 : Math.max(10, Math.min(top, d * 0.5)) };
  };
  if (role === "defend" && p.a * own.out < 0) return waitAt(own.along - own.out * DEFEND_FT, (own.mouth[0] + own.mouth[1]) / 2, 45);
  const goalB = (attack.mouth[0] + attack.mouth[1]) / 2;
  const toGoal = hyp(attack.along - p.a, goalB - p.b) || 1;
  const ua = (attack.along - p.a) / toGoal, ub = (goalB - p.b) / toGoal;
  if (role === "wing") return waitAt(p.a - ua * WING_BACK_FT - ub * side * WING_WIDE_FT, p.b - ub * WING_BACK_FT + ua * side * WING_WIDE_FT, 55);
  // How well the truck lines up behind the puck: 1 straight behind it, facing the goal through it.
  const da = p.a - t.a, db = p.b - t.b, dist = hyp(da, db) || 1;
  const align = (da * ua + db * ub) / dist;
  // And how the truck faces the puck.
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const facing = ((fx * frame.u[0] + fz * frame.u[1]) * da + (fx * frame.v[0] + fz * frame.v[1]) * db) / dist;
  const [enter, hold] = memo.through ? [THROUGH_HOLD, FACING_HOLD] : [THROUGH_ENTER, FACING_ENTER];
  if (align > enter && facing > hold) {
    // Carried on the truck's nose, the puck goes where the truck steers: at the goal's mouth.
    memo.through = true;
    return { point: at(attack.along + attack.out * 10, goalB), speed: CARRY_SPEED };
  }
  memo.through = false;
  // Behind the puck on its line to the goal, the farther back the worse the truck lines up (a truck slides wide on
  // the ice); from the wrong side, round it, wide, on the truck's own side.
  const back = STAND_FT + rink.puck.radius + BACK_PER_MISS_FT * (1 - align);
  let a = p.a - ua * back, b = p.b - ub * back;
  if (align < WRONG_SIDE) {
    const way = -da * ub + db * ua <= 0 ? 1 : -1;
    const wide = rink.puck.radius + STAND_FT + 10;
    a -= ub * way * wide;
    b += ua * way * wide;
  }
  return { point: at(a, b), speed: Math.max(30, Math.min(60, hyp(a - t.a, b - t.b) * 0.6)) };
}

/**
 * The ground as the trucks feel it on the rink: the frozen water as gravel, the rest as it is. Every
 * other property is the ground's own (the weather read through, since GOLD mode can change it).
 */
export function rinkGround(ground) {
  return {
    height: ground.height, normal: ground.normal, ramps: ground.ramps, waterLevelFt: ground.waterLevelFt,
    get weather() { return ground.weather; },
    surface: (x, y, z) => {
      const value = ground.surface(x, y, z);
      return value === FROZEN_SURFACE ? RINK_SURFACE : value;
    },
  };
}
