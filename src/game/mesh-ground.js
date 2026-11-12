/*
  The ground a computer racer sees on a track built of meshes (an addition, not the game's): where placed models
  collide by their triangles (Community Patch 4's collision, OpenPhotex sim/cp4), a model's box is no block to steer
  round, as it is on a classic track; the truck drives on it. What stands in its way there is the mesh itself: a wall
  (a steep face at wheel height) or a drop (the drivable surface falling away: a deck's edge, a bridge over water).
  Read with the same ray queries the collision uses. Pure, so it runs under Node.

  `boxes` are the session's level boxes with a usable triangle shape (`box.shape`); `terrainHeight(x, z)` the
  terrain under a point; `wrapDelta` the world's wrap for a difference of positions.
*/
import { buildCollShape, rayQuery, shapeUsable } from "../vendor/openphotex/sim/cp4/coll-shape.js";
import { createLevelBox } from "../vendor/openphotex/sim/mtm2/collide/box.js";

export const MESH_LOOK = Object.freeze({
  /** A face this steep (its up component under this) is a wall; flatter faces are driven over. */
  wallUp: 0.7,
  /** The wall ray runs this far over the wheels' contact, feet: over a curb, under a deck. */
  wallRayFt: 2.5,
  /** A surface found from this far over the last one is climbed onto (a curb, a ramp); feet. */
  climbFt: 4,
  /** Down to this far under the last surface is still the way (a ramp, a step down); further is a drop. */
  dropFt: 10,
  /** How deep a down ray looks, feet. */
  probeFt: 40,
  /** Samples along the look, feet. */
  sampleFt: 16,
  /** A drop or a wall as an obstacle: a circle this wide, feet. */
  dropRadiusFt: 9, wallRadiusFt: 3,
});

const toBody = (m, x, y, z) => [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
const upOf = (m, n) => m[3] * n[0] + m[4] * n[1] + m[5] * n[2];

/** The side of a cell of the grid the boxes are found through, feet. */
const CELL_FT = 128;
const NO_WRAP = (d) => d;
const NO_BOXES = Object.freeze([]);

/**
 * The boxes by the ground they stand over: each box is listed, in the list's order, in every cell its bounding circle
 * touches. A ray straight down meets only boxes listed in the cell it falls through, and a search around a point only
 * boxes listed in the cells the search's square touches, so neither tries the whole city's boxes for each question
 * (a city track has a thousand, and the views and the tire effects ask hundreds of times a frame). `worldFt` is the
 * side of a world that wraps (cells are then counted round it), 0 for one that does not.
 */
function boxGrid(list, worldFt) {
  const across = worldFt > 0 ? Math.max(1, Math.round(worldFt / CELL_FT)) : 0;
  const cell = across ? worldFt / across : CELL_FT;
  const wrap = (c) => (across ? ((c % across) + across) % across : c);
  const key = (cx, cz) => wrap(cx) * 65536 + wrap(cz);
  const cells = new Map();
  list.forEach((box, index) => {
    box.gridIndex = index;
    let x0 = Math.floor((box.pos[0] - box.radius) / cell), x1 = Math.floor((box.pos[0] + box.radius) / cell);
    let z0 = Math.floor((box.pos[2] - box.radius) / cell), z1 = Math.floor((box.pos[2] + box.radius) / cell);
    // A box as wide as the world is in every cell across it, once.
    if (across && x1 - x0 >= across) { x0 = 0; x1 = across - 1; }
    if (across && z1 - z0 >= across) { z0 = 0; z1 = across - 1; }
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = key(cx, cz), have = cells.get(k);
      if (have) have.push(box); else cells.set(k, [box]);
    }
  });
  const stamp = new Uint32Array(list.length);
  let round = 0;
  return {
    /** The boxes that can stand over (x, z), in the list's order. Not to be changed. */
    over: (x, z) => cells.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? NO_BOXES,
    /** The boxes listed within `reach` of (x, z) on either axis, each once, in the list's order. A new array. */
    around(x, z, reach) {
      let x0 = Math.floor((x - reach) / cell), x1 = Math.floor((x + reach) / cell);
      let z0 = Math.floor((z - reach) / cell), z1 = Math.floor((z + reach) / cell);
      if (across && x1 - x0 >= across) { x0 = 0; x1 = across - 1; }
      if (across && z1 - z0 >= across) { z0 = 0; z1 = across - 1; }
      if (++round > 0xfffffff0) { stamp.fill(0); round = 1; }
      const found = [];
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const have = cells.get(key(cx, cz));
        if (!have) continue;
        for (let i = 0; i < have.length; i++) {
          const box = have[i];
          if (stamp[box.gridIndex] === round) continue;
          stamp[box.gridIndex] = round;
          found.push(box);
        }
      }
      return found.sort((p, q) => p.gridIndex - q.gridIndex);
    },
  };
}

/**
 * @param worldFt  the side of the world `wrapDelta` wraps at, feet; needed for the boxes to be found through a grid on
 *                 a world that wraps (without it every box is tried, with the same answers)
 * @returns `{ boxes, near(pos, reach), surfaceBelow(x, y, z, depth, list), wallAlong(origin, dir, len, list) }` or null
 *          when no box has a usable shape (a classic track).
 */
export function createMeshGround(boxes, { terrainHeight, wrapDelta = NO_WRAP, worldFt = 0 }) {
  const list = boxes.filter((b) => !b.ghost && shapeUsable(b.shape));
  if (!list.length) return null;
  const grid = worldFt > 0 || wrapDelta === NO_WRAP ? boxGrid(list, worldFt) : null;
  const within = (b, pos, reach) => {
    const dx = wrapDelta(b.pos[0] - pos[0]), dz = wrapDelta(b.pos[2] - pos[2]), r = b.radius + reach;
    return dx * dx + dz * dz <= r * r;
  };
  /** The boxes whose reach comes within `reach` feet of `pos` (x, z). */
  const near = (pos, reach) => (grid ? grid.around(pos[0], pos[2], reach) : list).filter((b) => within(b, pos, reach));
  /** A ray through `boxes`: `visit(hit, box, t, up)` for each face met in order of box; returns the nearest kept. */
  const cast = (o, d, len, boxesNear, keep) => {
    let best = null;
    for (let n = 0; n < boxesNear.length; n++) {
      const box = boxesNear[n];
      const rx = wrapDelta(o[0] - box.pos[0]), ry = o[1] - box.pos[1], rz = wrapDelta(o[2] - box.pos[2]);
      // The segment's nearest approach to the box's centre against its radius.
      const along = Math.max(0, Math.min(len, -(rx * d[0] + ry * d[1] + rz * d[2])));
      const cx = rx + d[0] * along, cy = ry + d[1] * along, cz = rz + d[2] * along;
      if (cx * cx + cy * cy + cz * cz > box.radius * box.radius) continue;
      const m = box.matrix;
      let ob = toBody(m, rx, ry, rz);
      const db = toBody(m, d[0], d[1], d[2]);
      let left = len, gone = 0;
      for (let k = 0; k < 6 && left > 0; k++) {
        const hit = rayQuery(box.shape, ob, db, left);
        if (!hit) break;
        const t = gone + hit.t;
        if (best && t >= best.t) break;
        if (keep(upOf(m, hit.normal))) { best = { t, up: upOf(m, hit.normal) }; break; }
        const step = hit.t + 0.05;
        ob = [ob[0] + db[0] * step, ob[1] + db[1] * step, ob[2] + db[2] * step];
        left -= step; gone += step;
      }
    }
    return best;
  };
  const DOWN = [0, -1, 0], drivable = (up) => Math.abs(up) >= 0.25;
  return {
    boxes: list,
    near,
    /**
     * The drivable surface under (x, y, z) within `depth` feet down: a mesh face or the terrain, whichever is higher.
     * Without `boxesNear`, among the boxes that stand over the point.
     */
    surfaceBelow(x, y, z, depth, boxesNear = grid ? grid.over(x, z) : list) {
      const hit = cast([x, y, z], DOWN, depth, boxesNear, drivable);
      const mesh = hit ? y - hit.t : -Infinity;
      const terrain = terrainHeight(x, z);
      const ground = terrain <= y ? terrain : -Infinity;
      const h = Math.max(mesh, ground);
      return h >= y - depth ? h : null;
    },
    /**
     * The share (0 to 1) of the way from `from` to `to` at which the line first meets a face, either side, or null when
     * nothing stands between them: what a camera sees through.
     */
    segmentHit(from, to) {
      const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len < 1e-6) return null;
      const dir = [d[0] / len, d[1] / len, d[2] / len];
      const mid = [from[0] + d[0] / 2, from[1] + d[1] / 2, from[2] + d[2] / 2];
      const hit = cast(from, dir, len, near(mid, len / 2), () => true);
      return hit ? hit.t / len : null;
    },
    /** The distance along `dir` (a unit vector, level) from `origin` to the first wall face within `len`, or null. */
    wallAlong(origin, dir, len, boxesNear = list) {
      const hit = cast(origin, dir, len, boxesNear, (up) => Math.abs(up) < MESH_LOOK.wallUp);
      return hit ? hit.t : null;
    },
  };
}

/**
 * The walls and drops down a truck's way as obstacles (`{ pos, radius }`, for game/obstacle-avoid.js): along three
 * lanes (its middle and either side, `side` feet out), a wall ray at wheel height and the drivable surface every
 * `sampleFt`, each sample against the last, so a ramp is followed and a deck's edge is a drop. `feet` is the height of
 * the truck's wheels' contact.
 */
export function meshObstacles(mesh, pos, feet, heading, lookFt, side, out = [], T = MESH_LOOK) {
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const boxesNear = mesh.near(pos, lookFt + side);
  if (!boxesNear.length) return out;
  for (const off of [-side, 0, side]) {
    const x0 = pos[0] + cos * off, z0 = pos[2] - sin * off;
    const wall = mesh.wallAlong([x0, feet + T.wallRayFt, z0], [sin, 0, cos], lookFt, boxesNear);
    if (wall !== null) out.push({ pos: [x0 + sin * wall, feet, z0 + cos * wall], radius: T.wallRadiusFt });
    const until = wall ?? lookFt;
    let last = feet;
    for (let d = T.sampleFt; d <= until; d += T.sampleFt) {
      const x = x0 + sin * d, z = z0 + cos * d;
      const h = mesh.surfaceBelow(x, last + T.climbFt, z, T.climbFt + T.probeFt, boxesNear);
      if (h === null || h < last - T.dropFt) { out.push({ pos: [x, last, z], radius: T.dropRadiusFt }); break; }
      last = h;
    }
  }
  return out;
}

/**
 * The meshes of a track made for Community Patch 4 (`build.sim.cp4Track`), for what is drawn rather than simulated: the
 * cameras and the tire effects stand on the street, the freeway deck or the tunnel floor, not on the terrain under the
 * city. The same boxes and shapes the session builds (worker/sim-worker.js), from the track build's triangles; static
 * solid models only. Null on any other track.
 */
export function meshGroundFromBuild(build, { terrainHeight, wrapDelta = NO_WRAP, worldFt = 0 }) {
  const soups = build?.sim?.collisionSoups;
  if (!build?.sim?.cp4Track || !soups) return null;
  const shapes = new Map();
  const boxes = [];
  for (const b of build.sim.boxes ?? []) {
    if (!b.modelName || !soups[b.modelName] || b.mass > 0 || !(b.type <= 5) || b.bvel) continue;
    const box = createLevelBox(b, b.bounds);
    if (!box) continue;
    if (!shapes.has(b.modelName)) shapes.set(b.modelName, buildCollShape(soups[b.modelName].positions));
    box.shape = shapes.get(b.modelName);
    boxes.push(box);
  }
  return createMeshGround(boxes, { terrainHeight, wrapDelta, worldFt });
}

/**
 * A ground for a view (a camera, the tire effects) on meshes: the drivable surface under (x, z) from a little over
 * `refY()`, the height of what is watched (a truck's middle), else `fallback(x, z)`. `refY` is read at each call. Read
 * from just over the truck, so a roof (a tunnel's, 26 ft over Beaver City's tunnel floor) is never taken for the
 * ground; what stands between the truck and the camera is `viewBlocked`'s.
 */
export function viewGroundOn(mesh, fallback, refY, { above = 6, depth = 120 } = {}) {
  if (!mesh) return fallback;
  return (x, z) => mesh.surfaceBelow(x, refY() + above, z, depth) ?? fallback(x, z);
}

/** How far in front of a face a camera stops, feet: past the picture's near plane, so the face is not cut open. */
export const VIEW_MARGIN_FT = 1.5;

/**
 * The line of sight of a view on meshes (game/cameras.js `blocked`): the share of the way from `from` (the truck) to
 * `to` (the camera) at which a mesh face stands, or null. Null without meshes.
 */
export function viewBlocked(mesh) {
  return mesh ? (from, to) => mesh.segmentHit(from, to) : null;
}

/**
 * A view that stands still and frames the truck (the BlimpCam, the RaceCam; `{ position, target, zoom }`) moved in
 * front of the first mesh face between it and the truck at `truckPos`, its zoom changed as the game's `distanceZoom`
 * changes it for the nearer distance. The view as it is when nothing is in the way.
 */
export function clearStandingView(blocked, truckPos, view, distanceZoom, margin = VIEW_MARGIN_FT) {
  if (!blocked || !view) return view;
  const f = blocked(truckPos, view.position);
  if (f === null) return view;
  const d = view.position.map((v, k) => v - truckPos[k]);
  const len = Math.hypot(d[0], d[1], d[2]);
  const keep = Math.max(0, f * len - margin) / len;
  const position = truckPos.map((v, k) => v + d[k] * keep);
  const offset = view.target.map((v, k) => v - view.position[k]);
  const zoom = view.zoom * distanceZoom(Math.hypot(d[0], d[2]) * keep) / distanceZoom(Math.hypot(d[0], d[2]));
  return { ...view, position, target: position.map((v, k) => v + offset[k]), zoom };
}
