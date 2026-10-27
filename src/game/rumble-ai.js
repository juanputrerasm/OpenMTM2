/*
  Rumble (summit) driving for computer trucks: an addition, since the game's CPU trucks only follow
  the course. Each truck drives to the scoring zone, holds near its centre, pushes rivals that sit
  in the zone with it, comes back when it is knocked off, and backs out when it is stuck.

  Raised zones (a platform reached by a jump, a mountain top up one ramp) are found through a flow
  field built once per race (`buildRumbleField`): a grid around the zone whose steps a truck can
  climb, plus jumps off rising ground, searched back from the zone's cells.
  A ground box's edge is a face, climbed only under a wheel's hub (`BOX_STEP_FT`). A truck keeps its
  speed up a ramp, and on a big zone makes for the nearest flat holding spot well inside it, by a
  second search back from those spots, rather than creeping for the centre of a narrow top.

  `rumbleControls` writes the truck's pedals, steering and gear into `s.controls`, in place of the
  autopilot, once per step.
*/

const STEER_LOCK = 0.45;
const STEER_GAIN = 1.4;
const STEER_RATE = 6.66;
const SPEED_GAIN = 0.12;
/** Top approach speed in ft/s, and how quickly a truck slows as it nears the zone. */
const APPROACH_SPEED = 75;
const APPROACH_SLOPE = 0.55;
/** A climb: the way a few cells on rising more than this (ft) is driven at no less than this speed (ft/s), for momentum. */
export const CLIMB_RISE_FT = 3, CLIMB_SPEED = 45;
/** The last few feet up into the zone, ft/s. */
export const FINISH_SPEED = 25;
/**
 * Holding spots: zone cells whose ride stands at least `HOLD_DEPTH_FT` over the zone's floor, on ground no rougher than
 * `HOLD_FLAT_FT` (then twice that) from cell to cell. A truck stops within `HOLD_REACH_FT` of the nearest, and drives to it
 * at up to `HOLD_APPROACH` ft/s (`FINISH_SPEED` while it lies above the truck).
 */
export const HOLD_DEPTH_FT = 4, HOLD_FLAT_FT = 3, HOLD_REACH_FT = 10, HOLD_APPROACH = 15;
/** A holding spot stands at least this far inside the zone's sides, ft (a small zone's is its middle). */
export const HOLD_EDGE_FT = 20;
/** Holding spots are driven to on a zone with at least this many (a big one); a small zone's trucks make for its centre. */
export const HOLD_MIN = 4;
/** Held speed inside the zone, and the share of the zone counted as its centre. */
const HOLD_SPEED = 8;
const CENTRE_SHARE = 0.35;
/** A target behind and this close is reached in reverse, at up to this speed. */
const BACK_RANGE_FT = 45;
const BACK_SPEED = 12;
/** Backing that gets nowhere is given up for this long, s. */
const NO_BACK_S = 3;
/** A rival this close inside the zone is pushed rather than ignored (ft). */
const PUSH_RANGE = 70;
const PUSH_SPEED = 30;
/** Stuck: this slow for this long with the throttle down, then reverse for a while. */
const STUCK_SPEED = 3;
const STUCK_S = 1.5;
const REVERSE_S = 1.4;
/**
 * Circling: a truck whose target stays this near, this far off its nose, at under this speed, for this long, is going
 * round it inside its turning circle; with `orbitBreak` it backs up, turning the other way, to come at it again.
 */
const ORBIT_RANGE_FT = 40, ORBIT_ERR = 1.0, ORBIT_SPEED = 15, ORBIT_S = 1.5;
/** No headway: the path left must shrink this much within this time, or the truck backs off further. */
const HEADWAY_FT = 12;
const HEADWAY_S = 5;
const BACK_OFF_S = 2.5;
/**
 * Going round (`detour`): after backing out, a truck drives this long for a point this far off, turned this far
 * from its target to one side; the next time it is stopped within `AROUND_AGAIN_S` it tries the other side.
 */
export const AROUND_S = 2.4, AROUND_FT = 60, AROUND_TURN = 1.1, AROUND_AGAIN_S = 8;

/** Field cell size and reach (ft); the steepest climb per cell; how high and far a jump may reach. */
const CELL_FT = 16;
const FIELD_EXTENT_FT = 1024;
const CLIMB_FT = 9;
/** The tallest step up onto (or along) a ground box's top, ft: a wheel climbs an edge under its hub, not a taller face. */
export const BOX_STEP_FT = 3;
const JUMP_RISE_FT = 18;
const JUMP_CELLS = 4;
const JUMP_COST = 80;
/** Cells looked ahead along the field, and how far ahead a jump calls for speed. */
const LOOK_CELLS = 3;
const LAUNCH_LOOK_CELLS = 10;
const LAUNCH_SPEED = 75;
/** A jump wants a straight run: back this far behind the take-off, lined up within this angle. */
const RUNUP_FT = [140, 110, 80];
const RUNUP_ALIGN = 0.3;
const RUNUP_SPEED = 45;
const RUNUP_TIMEOUT_S = 12;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A truck's rumble memory; `aggression` 0..1 sets how readily it pushes rivals. */
export function createRumbleDriver(aggression = 0.5) {
  return {
    mode: "drive", timer: 0, stuck: 0, aggression, reverseSteer: STEER_LOCK, best: Infinity, since: 0, runup: null, backing: false,
    side: 0, around: null, lastStuck: -Infinity, clock: 0,
  };
}

/**
 * The flow field to a zone `{ pos, half }`. `layersAt(x, z)` gives the drivable heights there: the
 * ground, and the top of a ground box raised clear of it (a table or a bridge) as a second layer.
 * Each node (cell and layer) keeps its path length to the zone, the next node and whether that step
 * is a jump.
 */
export function buildRumbleField(zone, layersAt, { extent = FIELD_EXTENT_FT, cell = CELL_FT } = {}) {
  const n = Math.floor((extent * 2) / cell) + 1;
  const x0 = zone.pos[0] - extent, z0 = zone.pos[2] - extent;
  const count = n * n;
  // Node i is cell i's lower (or only) layer, node count + i its upper one when it has one. The
  // heights are also sampled halfway between cells, so a step is judged at its middle too.
  const m = n * 2 - 1;
  const fine = [new Float32Array(m * m), new Float32Array(m * m).fill(NaN)];
  // Which heights are a ground box's top (`layersAt`'s `box` flags), whose edge is a face, not a slope.
  const fineBox = [new Uint8Array(m * m), new Uint8Array(m * m)];
  for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
    const layers = layersAt(x0 + (c * cell) / 2, z0 + (r * cell) / 2);
    const [lo, hi] = layers;
    fine[0][r * m + c] = lo;
    if (hi !== undefined) fine[1][r * m + c] = hi;
    if (layers.box) { fineBox[0][r * m + c] = layers.box[0] ? 1 : 0; fineBox[1][r * m + c] = layers.box[1] ? 1 : 0; }
  }
  // Walls grow by half a truck's width (one fine step), so a path keeps clear of them.
  fine.forEach((layer, l) => {
    const raw = layer.slice(), rawBox = fineBox[l].slice();
    for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
      let top = raw[r * m + c], box = rawBox[r * m + c];
      if (Number.isNaN(top)) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= m || cc >= m) continue;
        const v = raw[rr * m + cc];
        if (v > top) { top = v; box = rawBox[rr * m + cc]; }
      }
      layer[r * m + c] = top;
      fineBox[l][r * m + c] = box;
    }
  });
  const h = new Float32Array(count * 2);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    h[r * n + c] = fine[0][r * 2 * m + c * 2];
    h[count + r * n + c] = fine[1][r * 2 * m + c * 2];
  }
  /** The height halfway between two nodes, on the layer nearest the pair's mean, and whether it is a box's top. */
  const midHeight = (c, r, dc, dr, ya, yb) => {
    const k = (r * 2 + dr) * m + c * 2 + dc;
    const lo = fine[0][k], hi = fine[1][k], y = (ya + yb) / 2;
    const low = Number.isNaN(hi) || Math.abs(lo - y) < Math.abs(hi - y);
    midBox = fineBox[low ? 0 : 1][k];
    return low ? lo : hi;
  };
  let midBox = 0;
  const nodeBox = new Uint8Array(count * 2);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    nodeBox[r * n + c] = fineBox[0][r * 2 * m + c * 2];
    nodeBox[count + r * n + c] = fineBox[1][r * 2 * m + c * 2];
  }
  const nodes = (i) => (Number.isNaN(h[count + i]) ? [i] : [i, count + i]);
  const goal = new Uint8Array(count * 2);
  const inXZ = (i) => Math.abs(x0 + (i % n) * cell - zone.pos[0]) < zone.half[0] && Math.abs(z0 + Math.floor(i / n) * cell - zone.pos[2]) < zone.half[2];
  let goals = 0;
  for (let i = 0; i < count; i++) {
    if (!inXZ(i)) continue;
    for (const k of nodes(i)) if (Math.abs(h[k] + 4 - zone.pos[1]) < zone.half[1]) { goal[k] = 1; goals++; }
  }
  // A zone floating above everything under it still has its cells as the goal: trucks get as close as they can.
  if (!goals) for (let i = 0; i < count; i++) if (inXZ(i)) for (const k of nodes(i)) goal[k] = 1;

  // Edges into each node, for the search back from the zone: [from, cost, jump].
  const into = Array.from({ length: count * 2 }, () => []);
  const at = (c, r) => (c >= 0 && r >= 0 && c < n && r < n ? r * n + c : -1);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    for (const a of nodes(r * n + c)) {
      for (const [dc, dr] of DIRS) {
        const len = Math.hypot(dc, dr);
        const b = at(c + dc, r + dr);
        if (b < 0) continue;
        for (const bb of nodes(b)) {
          const mid = midHeight(c, r, dc, dr, h[a], h[bb]);
          // A box's edge is a face: only a step under a wheel's hub is climbed onto it.
          const half = nodeBox[a] || midBox || nodeBox[bb] ? BOX_STEP_FT : (CLIMB_FT * len) / 2;
          if (mid - h[a] <= half && h[bb] - mid <= half) into[bb].push([a, len * cell, 0]);
        }
        // A jump: off ground rising toward it, onto ground up to JUMP_RISE_FT higher a few cells on.
        // Only off a ramp rising toward the jump for two cells, straight along the jump's line.
        const p = at(c - dc, r - dr), p2 = at(c - dc * 2, r - dr * 2);
        if (p < 0 || p2 < 0) continue;
        const rising = (from, to) => nodes(from).some((x) => nodes(to).some((y) => h[y] - h[x] >= 2 && h[y] - h[x] <= CLIMB_FT * len * 1.5));
        if (!rising(p, r * n + c) || !rising(p2, p)) continue;
        for (let k = 2; k <= JUMP_CELLS; k++) {
          const t = at(c + dc * k, r + dr * k);
          if (t < 0) break;
          for (const tt of nodes(t)) {
            const rise = h[tt] - h[a];
            if (rise <= JUMP_RISE_FT && rise > -JUMP_RISE_FT) into[tt].push([a, len * k * cell + JUMP_COST, 1]);
          }
        }
      }
    }
  }

  const { dist, next, jump } = searchBack(count * 2, into, goal);
  // The zone's nodes a truck can reach: entered from outside it, or from another reached by a drivable step.
  const reached = new Uint8Array(count * 2);
  const out = new Map();
  const queue = [];
  for (let b = 0; b < count * 2; b++) {
    if (!goal[b]) continue;
    for (const [a] of into[b]) {
      if (!goal[a] && dist[a] < Infinity && !reached[b]) { reached[b] = 1; queue.push(b); }
      if (goal[a]) { if (!out.has(a)) out.set(a, []); out.get(a).push(b); }
    }
  }
  while (queue.length) for (const b of out.get(queue.pop()) ?? []) if (!reached[b]) { reached[b] = 1; queue.push(b); }
  // The holding spots, with how rough the ground round each is (the most a neighbour, on its nearest layer, differs).
  const floor = zone.pos[1] - zone.half[1];
  const holds = [];
  for (let k = 0; k < count * 2; k++) {
    if (!goal[k] || !reached[k] || h[k] + 4 < floor + HOLD_DEPTH_FT) continue;
    const ci = k % count, c = ci % n, r = Math.floor(ci / n);
    const edge = Math.min(zone.half[0] - Math.abs(x0 + c * cell - zone.pos[0]), zone.half[2] - Math.abs(z0 + r * cell - zone.pos[2]));
    if (edge <= Math.min(HOLD_EDGE_FT, Math.max(zone.half[0], zone.half[2]) - cell)) continue;
    let rough = 0;
    for (const [dc, dr] of DIRS) {
      const b = at(c + dc, r + dr);
      if (b < 0) { rough = Infinity; break; }
      rough = Math.max(rough, Math.min(...nodes(b).map((x) => Math.abs(h[x] - h[k]))));
    }
    holds.push({ k, pos: [x0 + c * cell, h[k], z0 + r * cell], rough });
  }
  // The way to the flattest holding spots (then the rougher ones), as the way to the zone is found.
  const holdSet = new Uint8Array(count * 2);
  for (const most of [HOLD_FLAT_FT, HOLD_FLAT_FT * 2]) {
    for (const hold of holds) if (hold.rough <= most) holdSet[hold.k] = 1;
    if (holdSet.some((x) => x)) break;
  }
  const hold = holdSet.reduce((a, b) => a + b, 0) >= HOLD_MIN ? { ...searchBack(count * 2, into, holdSet), goal: holdSet } : null;
  return { n, cell, count, x0, z0, h, nodeBox, dist, next, jump, goal, holds, hold };
}

/**
 * The shortest way from every node to the nearest of `sources` (a flag per node), along the edges `into` (into each
 * node: `[from, cost, jump]`): each node's path length, the next node, and whether that step is a jump.
 */
function searchBack(size, into, sources) {
  const dist = new Float64Array(size).fill(Infinity);
  const next = new Int32Array(size).fill(-1);
  const jump = new Uint8Array(size);
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    for (let k = heap.length - 1; k > 0;) {
      const up = (k - 1) >> 1;
      if (heap[up][0] <= heap[k][0]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = k * 2 + 1, rr = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (let i = 0; i < size; i++) if (sources[i]) { dist[i] = 0; push(0, i); }
  while (heap.length) {
    const [d, b] = pop();
    if (d > dist[b]) continue;
    for (const [a, cost, j] of into[b]) {
      const nd = d + cost;
      if (nd < dist[a]) { dist[a] = nd; next[a] = b; jump[a] = j; push(nd, a); }
    }
  }
  return { dist, next, jump };
}

/** The node a truck at `y` stands on in cell i: the upper layer when it is up there. */
function nodeAt(field, i, y) {
  const up = field.h[field.count + i];
  return !Number.isNaN(up) && y > up - 6 ? field.count + i : i;
}

/**
 * Where the field leads from a position: a point a few cells on, the path length left, and whether
 * a jump is coming up. Null off the field or where no path reaches the zone.
 */
export function fieldGuide(field, pos, way = field) {
  const { n, cell, x0, z0 } = field;
  const { dist, next, jump, goal } = way;
  const c = Math.round((pos[0] - x0) / cell), r = Math.round((pos[2] - z0) / cell);
  let i = -1, best = Infinity;
  // The truck's own cell, or the best of its neighbours when it stands on a wall or a ledge.
  // A cell only counts on the truck's own level, not the top of a wall beside it (its own cell neither: a truck
  // against a wall may round onto it). With none on its level, its own cell as it is.
  for (const level of [true, false]) {
    for (const [dc, dr] of [[0, 0], ...DIRS]) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= n || rr >= n) continue;
      if (!level && (dc || dr)) continue;
      const k = nodeAt(field, rr * n + cc, pos[1]);
      // On its level: within 10 ft, or a step under a hub when the neighbour is a box's top.
      const reach = (dc || dr) && field.nodeBox?.[k] ? BOX_STEP_FT + 1 : 10;
      if (level && Math.abs(field.h[k] + 4 - pos[1]) > reach) continue;
      const d = dist[k] + (dc || dr ? cell : 0);
      if (d < best) { best = d; i = k; }
    }
    if (i >= 0) break;
  }
  if (i < 0 || best === Infinity) return null;
  const here = field.h[i];
  let at = i, launch = null;
  let point = null;
  for (let step = 0; step < LAUNCH_LOOK_CELLS && !goal[at] && next[at] >= 0; step++) {
    if (jump[at] && !launch) launch = { from: nodePos(field, at), to: nodePos(field, next[at]), cells: step };
    at = next[at];
    if (step + 1 === LOOK_CELLS || jump[at] || goal[at]) point ??= at;
  }
  point ??= at;
  const to = nodePos(field, point);
  return { point: to, dist: dist[i], launch, rise: to[1] - here };
}

/** A node's position: its cell's corner and its layer's height. */
function nodePos(field, k) {
  const c = k % field.count;
  return [field.x0 + (c % field.n) * field.cell, field.h[k], field.z0 + Math.floor(c / field.n) * field.cell];
}

/** Whether a position is inside a box, with a margin on x and z as a share of its size. */
function within(box, pos, share = 1) {
  return Math.abs(pos[0] - box.pos[0]) < box.half[0] * share && Math.abs(pos[2] - box.pos[2]) < box.half[2] * share
    && Math.abs(pos[1] - box.pos[1]) < box.half[1];
}

/**
 * Where a truck heads and how fast it wants to go there: the zone's centre, or a rival inside the
 * zone when this truck is in it too and is minded to push.
 */
export function rumbleTarget(pos, zone, rivals, aggression, field = null) {
  const inZone = within(zone, pos);
  if (inZone && aggression > 0) {
    let best = null, bestD = PUSH_RANGE * aggression + 20;
    for (const r of rivals) {
      if (!within(zone, r)) continue;
      const d = Math.hypot(r[0] - pos[0], r[2] - pos[2]);
      if (d < bestD) { best = r; bestD = d; }
    }
    if (best) return { point: best, speed: PUSH_SPEED, push: true, left: 0 };
  }
  const d = Math.hypot(zone.pos[0] - pos[0], zone.pos[2] - pos[2]);
  // A level with holding spots: the way to the nearest, stopped on it; up to one it is driven, not crept.
  const toHold = (left) => {
    const g = fieldGuide(field, pos, field.hold);
    if (!g) return null;
    if (g.dist < HOLD_REACH_FT && inZone) return { point: g.point, speed: 0, push: false, left: 0 };
    const up = g.point[1] + 4 > pos[1] || g.rise > CLIMB_RISE_FT;
    return { point: g.point, speed: up ? FINISH_SPEED : Math.min(HOLD_APPROACH, 4 + g.dist * 0.3), push: false, left };
  };
  const hold = !!field?.hold;
  if (inZone && hold) { const t = toHold(0); if (t) return t; }
  if (within(zone, pos, CENTRE_SHARE)) return { point: zone.pos, speed: 0, push: false, left: 0 };
  if (inZone) return { point: zone.pos, speed: HOLD_SPEED, push: false, left: 0 };
  const guide = field && fieldGuide(field, pos);
  // On the field's goal but not yet in the zone (a cell on a steep ramp spans several feet): on into it, at a climb's
  // speed while the zone's floor is still above the truck.
  if (guide && guide.dist < field.cell * 1.5) {
    const below = pos[1] < zone.pos[1] - zone.half[1] + 2;
    return (hold && toHold(d)) || { point: zone.pos, speed: below ? FINISH_SPEED : Math.min(APPROACH_SPEED, HOLD_SPEED + d * APPROACH_SLOPE), push: false, left: d };
  }
  if (guide) {
    let speed = Math.min(APPROACH_SPEED, HOLD_SPEED + guide.dist * APPROACH_SLOPE);
    // Up a ramp the truck keeps its momentum: slowing on it for the zone stalls it.
    if (guide.rise > CLIMB_RISE_FT) speed = Math.max(speed, CLIMB_SPEED);
    return { point: guide.point, speed: guide.launch ? Math.max(speed, LAUNCH_SPEED) : speed, push: false, left: guide.dist, launch: guide.launch };
  }
  return { point: zone.pos, speed: Math.min(APPROACH_SPEED, HOLD_SPEED + d * APPROACH_SLOPE), push: false, left: d };
}

/**
 * One step of rumble driving. `s` is the truck state (pos, euler, bvel, controls), `zone` the
 * scoring box `{ pos, half }`, `rivals` the other trucks' positions, `gears` the gear numbers
 * `{ FIRST, REVERSE }`, `field` the zone's flow field when there is one.
 */
export function rumbleControls(s, driver, zone, rivals, gears, dt, field = null) {
  let { point, speed, left, launch } = rumbleTarget(s.pos, zone, rivals, driver.aggression, field);
  if (driver.mode === "drive" && launch && field && !driver.runup) driver.runup = planRunup(s, launch, field);
  const run = driver.runup;
  if (run && driver.mode === "drive") {
    run.time += dt;
    const toStage = Math.hypot(run.stage[0] - s.pos[0], run.stage[2] - s.pos[2]);
    if (!run.charging && toStage < 35) run.charging = true;
    // Past the take-off, or taking too long: back to the field.
    const along = (s.pos[0] - run.from[0]) * run.dir[0] + (s.pos[2] - run.from[2]) * run.dir[1];
    if (along > 30 || run.time > RUNUP_TIMEOUT_S) driver.runup = null;
    else if (run.charging) {
      point = [run.from[0] + run.dir[0] * 200, 0, run.from[2] + run.dir[1] * 200];
      speed = LAUNCH_SPEED;
      left = driver.best;
    } else {
      point = run.stage;
      speed = Math.min(RUNUP_SPEED, 8 + toStage * 0.5);
      left = driver.best;
    }
  }
  driveToPoint(s, driver, point, speed, left, gears, dt);
}

/**
 * The pedals, steering and gear toward `point` at up to `speed` ft/s (0 stops there), with the
 * Rumble driver's backing up to a near target behind, and its backing out when pinned. `left` is
 * the path left to the goal for the headway watch; 0 turns that watch off. `back: false` never backs up
 * to a target (Hockey's, which moves and is best come round to); `turnFloor` is the least share of the
 * speed kept in a sharp turn (lower on ice, where a fast truck slides wide). `detour: true` goes round what
 * stopped the truck once it has backed out (`AROUND_S`). Also extension driving; `driver` is a `createRumbleDriver`
 * memory.
 */
export function driveToPoint(s, driver, point, speed, left, gears, dt, { back = true, turnFloor = 0.35, orbitBreak = false, detour = false } = {}) {
  const c = s.controls;
  const forward = s.bvel[2];
  driver.clock = (driver.clock ?? 0) + dt;
  const aimed = Math.atan2(point[0] - s.pos[0], point[2] - s.pos[2]);

  if (driver.mode === "reverse") {
    driver.timer -= dt;
    c.gear = gears.REVERSE;
    c.throttle = 0.8;
    c.brakeFront = c.brakeRear = 0;
    steerTo(c, driver.reverseSteer, dt);
    if (driver.timer <= 0) {
      driver.mode = "drive";
      driver.stuck = 0;
      c.gear = gears.FIRST;
      c.throttle = 0;
      if (detour) driver.around = { until: driver.clock + AROUND_S, heading: aimed + driver.side * AROUND_TURN };
    }
    return;
  }
  // Going round: a point off to the chosen side stands in for the target for a while.
  if (driver.around && driver.clock >= driver.around.until) driver.around = null;
  if (driver.around) {
    point = [s.pos[0] + Math.sin(driver.around.heading) * AROUND_FT, point[1], s.pos[2] + Math.cos(driver.around.heading) * AROUND_FT];
    speed = Math.max(speed, 25);
  }
  const dx = point[0] - s.pos[0], dz = point[2] - s.pos[2];
  const err = wrapPi(Math.atan2(dx, dz) - s.euler[2]);

  // A close target behind: back up to it rather than circle (a truck turns wider than the zone).
  const near = Math.hypot(dx, dz);
  driver.backing = back && near < BACK_RANGE_FT && Math.abs(err) > (driver.backing ? 1.3 : 1.9) && driver.clock >= (driver.noBackUntil ?? 0);
  if (driver.backing) {
    // Backing into something: give it up for a while and come round forward instead.
    driver.stuck = speed > 0 && Math.abs(forward) < STUCK_SPEED ? driver.stuck + dt : Math.max(0, driver.stuck - dt);
    if (driver.stuck > STUCK_S) {
      driver.stuck = 0;
      driver.backing = false;
      driver.noBackUntil = driver.clock + NO_BACK_S;
      c.gear = gears.FIRST;
      return;
    }
    const back = wrapPi(err - Math.PI);
    c.gear = gears.REVERSE;
    steerTo(c, clamp(-back * STEER_GAIN, -STEER_LOCK, STEER_LOCK), dt);
    const u = (Math.min(speed, BACK_SPEED) * Math.max(0.35, Math.cos(back)) + forward) * SPEED_GAIN;
    if (speed === 0 && Math.abs(forward) < 4) {
      c.throttle = 0;
      c.brakeFront = c.brakeRear = 1;
    } else if (u >= 0) {
      c.throttle = Math.min(1, u);
      c.brakeFront = c.brakeRear = 0;
    } else {
      c.throttle = 0;
      c.brakeFront = c.brakeRear = Math.min(1, -u);
    }
    return;
  }
  if (c.gear === gears.REVERSE) c.gear = gears.FIRST;
  // Slow for a sharp turn so the truck comes round instead of circling.
  const want = speed * Math.max(turnFloor, Math.cos(err));
  steerTo(c, clamp(err * STEER_GAIN, -STEER_LOCK, STEER_LOCK), dt);
  const u = (want - forward) * SPEED_GAIN;
  if (speed === 0 && Math.abs(forward) < 4) {
    c.throttle = 0;
    c.brakeFront = c.brakeRear = 1;
  } else if (u >= 0) {
    c.throttle = Math.min(1, u);
    c.brakeFront = c.brakeRear = 0;
  } else {
    c.throttle = 0;
    c.brakeFront = c.brakeRear = Math.min(1, -u);
  }

  if (orbitBreak) {
    const circling = near < ORBIT_RANGE_FT && Math.abs(err) > ORBIT_ERR && Math.abs(forward) < ORBIT_SPEED && speed > 0;
    driver.orbit = circling ? (driver.orbit ?? 0) + dt : 0;
    if (driver.orbit > ORBIT_S) {
      driver.orbit = 0;
      driver.mode = "reverse";
      driver.timer = REVERSE_S;
      driver.reverseSteer = err >= 0 ? -STEER_LOCK : STEER_LOCK;
      return;
    }
  }

  // Pinned against something: back out, turning the other way.
  if (c.throttle > 0.5 && Math.abs(forward) < STUCK_SPEED) driver.stuck += dt;
  else driver.stuck = Math.max(0, driver.stuck - dt);
  // No headway toward the zone for a while (a climb too steep, a missed jump): back off for a run-up.
  driver.since += dt;
  if (left < driver.best - HEADWAY_FT || left === 0) { driver.best = left; driver.since = 0; }
  const noHeadway = driver.since > HEADWAY_S;
  if (driver.stuck > STUCK_S || noHeadway) {
    driver.mode = "reverse";
    driver.timer = noHeadway ? BACK_OFF_S : REVERSE_S;
    // Going round: the side the target lies on first, the other side when stopped again soon after.
    const again = driver.clock - (driver.lastStuck ?? -Infinity) < AROUND_AGAIN_S && driver.side;
    driver.side = again ? -driver.side : (err >= 0 ? 1 : -1);
    driver.lastStuck = driver.clock;
    driver.around = null;
    // Backing up with the wheel turned away from the side to go round swings the nose toward it.
    driver.reverseSteer = detour ? -driver.side * STEER_LOCK : (err >= 0 ? -STEER_LOCK : STEER_LOCK);
    driver.best = Infinity;
    driver.since = 0;
  }
}

/**
 * A run-up for a jump coming up, unless the truck is already lined up and fast: a stage point on
 * the field behind the take-off, along the jump's line.
 */
function planRunup(s, launch, field) {
  const jx = launch.to[0] - launch.from[0], jz = launch.to[2] - launch.from[2];
  const jl = Math.hypot(jx, jz) || 1;
  const dir = [jx / jl, jz / jl];
  const heading = Math.atan2(dir[0], dir[1]);
  const aligned = Math.abs(wrapPi(heading - s.euler[2])) < RUNUP_ALIGN;
  if (aligned && s.bvel[2] > LAUNCH_SPEED * 0.6) return null;
  for (const back of RUNUP_FT) {
    const stage = [launch.from[0] - dir[0] * back, 0, launch.from[2] - dir[1] * back];
    const g = fieldGuide(field, [stage[0], launch.from[1] + 50, stage[2]]);
    // The stage must lie on open ground no higher than the take-off.
    const c = Math.round((stage[0] - field.x0) / field.cell), r = Math.round((stage[2] - field.z0) / field.cell);
    if (c < 0 || r < 0 || c >= field.n || r >= field.n) continue;
    const hs = field.h[r * field.n + c];
    if (!g || hs > launch.from[1] + 2 || launch.from[1] - hs > 30) continue;
    // The straight line back to the take-off must be drivable: no wall in between.
    let clear = true;
    for (let d = field.cell; d < back && clear; d += field.cell) {
      const cc = Math.round((launch.from[0] - dir[0] * d - field.x0) / field.cell);
      const rr = Math.round((launch.from[2] - dir[1] * d - field.z0) / field.cell);
      const hh = field.h[rr * field.n + cc];
      if (hh > launch.from[1] + 2 || launch.from[1] - hh > 30) clear = false;
    }
    if (!clear) continue;
    stage[1] = hs;
    return { stage, from: launch.from, dir, charging: false, time: 0 };
  }
  return null;
}

function steerTo(c, cmd, dt) {
  c.steer += (cmd - c.steer) * Math.min(1, STEER_RATE * dt);
  c.steer = clamp(c.steer, -STEER_LOCK, STEER_LOCK);
  c.rearSteer = -c.steer * 0.33;
}
