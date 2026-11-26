/*
  Community Patch 4 2.0.52.4's `.CPX` walls (docs/CP4_ENGINE_UPDATES.md 8.4): a path of points, each stretch to the next
  straight or bent (its midpoint pushed sideways by `bend`, toward (-dz, +dx) of the chord), a ribbon `thickness` wide
  centred on the path and `height` tall above each point's absolute base. A gap stretch has no wall; a closed wall joins
  its last point to its first.

  Contact is swept: a truck point (its body's hull points and its tyres) touches a wall when, this step, it entered the
  ribbon (within half the thickness of the path) or crossed the path, at a height between the base and the top. Passing
  under the base or over the top is no contact.

  In a drag any contact disqualifies (game/drag-race.js `dragWallTouch`). In a Parallel race each contact adds
  `penaltyMs`, and the same wall cannot penalise the same truck again until the truck has been clear of it for `rearmMs`.
  Pure: the tests use it.
*/

/** How many straight pieces a bent stretch is drawn and tested as. */
export const WALL_ARC_PIECES = 8;

/** The stretches of the walls as straight pieces: `{ wall, ax, az, bx, bz, baseA, baseB, half, height }` (feet). */
export function wallPieces(walls) {
  const pieces = [];
  walls.forEach((w, wall) => {
    const pts = w.points;
    const n = w.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (a.gap) continue;
      const dx = b.x - a.x, dz = b.z - a.z, chord = Math.hypot(dx, dz);
      if (!(chord > 0)) continue;
      const bend = Math.max(-chord / 2, Math.min(chord / 2, a.bendFt ?? 0));
      // The stretch through a, its bent midpoint and b: a circular arc when bent, sampled; else the chord.
      const at = (t) => {
        if (!bend) return [a.x + dx * t, a.z + dz * t];
        // A quadratic through the three points is close to the arc for a bend of at most half the chord.
        const mx = (a.x + b.x) / 2 + (-dz / chord) * bend, mz = (a.z + b.z) / 2 + (dx / chord) * bend;
        const u = 1 - t;
        const cx = 2 * mx - (a.x + b.x) / 2, cz = 2 * mz - (a.z + b.z) / 2;
        return [u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.z + 2 * u * t * cz + t * t * b.z];
      };
      const k = bend ? WALL_ARC_PIECES : 1;
      for (let j = 0; j < k; j++) {
        const [ax, az] = at(j / k), [bx, bz] = at((j + 1) / k);
        pieces.push({
          wall, ax, az, bx, bz,
          baseA: a.baseFt + ((b.baseFt - a.baseFt) * j) / k, baseB: a.baseFt + ((b.baseFt - a.baseFt) * (j + 1)) / k,
          half: w.thicknessFt / 2, height: w.heightFt,
        });
      }
    }
  });
  return pieces;
}

/**
 * The pieces as boxes for drawing (render/cpx-walls.js): `{ positions, index }`, triangles, game feet with z mirrored
 * for the scene. Each box is the piece's thickness wide, from its base to its top, its four sides and its top.
 */
export function wallGeometry(walls) {
  const positions = [], index = [];
  for (const p of wallPieces(walls ?? [])) {
    const dx = p.bx - p.ax, dz = p.bz - p.az, len = Math.hypot(dx, dz);
    if (!(len > 0)) continue;
    // Across the piece, half the thickness either way.
    const nx = (-dz / len) * p.half, nz = (dx / len) * p.half;
    const first = positions.length / 3;
    // Bottom then top of the four corners: a left, a right, b right, b left.
    const corners = [[p.ax + nx, p.az + nz, p.baseA], [p.ax - nx, p.az - nz, p.baseA], [p.bx - nx, p.bz - nz, p.baseB], [p.bx + nx, p.bz + nz, p.baseB]];
    for (const lift of [0, p.height]) for (const [x, z, base] of corners) positions.push(x, base + lift, -z);
    const quad = (a, b, c, d) => index.push(first + a, first + b, first + c, first + a, first + c, first + d);
    quad(0, 1, 5, 4); quad(1, 2, 6, 5); quad(2, 3, 7, 6); quad(3, 0, 4, 7); quad(4, 5, 6, 7);
  }
  return { positions, index };
}

/** Where on piece `p` the closest point to (x, z) lies: `{ t, d }`, t in 0..1 along it, d the distance. */
function nearest(p, x, z) {
  const dx = p.bx - p.ax, dz = p.bz - p.az, len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - p.ax) * dx + (z - p.az) * dz) / len2)) : 0;
  return { t, d: Math.hypot(x - (p.ax + dx * t), z - (p.az + dz * t)) };
}

/** Which side of piece `p` (x, z) is on: the sign of the cross product. */
const side = (p, x, z) => Math.sign((p.bx - p.ax) * (z - p.az) - (p.bz - p.az) * (x - p.ax));

/**
 * The walls a moving point touches this step, from `[x0, y0, z0]` to `[x1, y1, z1]` (feet; `wrap(d)` the world's short
 * way of a difference): a set of wall indexes. `grid` from `wallGrid` narrows the pieces looked at.
 */
export function pointTouches(grid, from, to, out = new Set(), wrap = (d) => d) {
  const x1 = to[0], z1 = to[2], y1 = to[1];
  for (const p of grid.near(x1, z1)) {
    // The piece in the point's own copy of the world.
    const ox = wrap(p.ax - x1) - (p.ax - x1), oz = wrap(p.az - z1) - (p.az - z1);
    const q = { ...p, ax: p.ax + ox, bx: p.bx + ox, az: p.az + oz, bz: p.bz + oz };
    const { t, d } = nearest(q, x1, z1);
    const base = q.baseA + (q.baseB - q.baseA) * t;
    if (y1 < base || y1 > base + q.height) {
      continue;
    }
    if (d <= q.half) { out.add(p.wall); continue; }
    // Crossed the path between the steps: the two ends on either side, the crossing within the piece.
    const x0 = from[0] + (wrap(from[0] - x1) - (from[0] - x1)), z0 = from[2] + (wrap(from[2] - z1) - (from[2] - z1));
    const s0 = side(q, x0, z0), s1 = side(q, x1, z1);
    if (s0 && s1 && s0 !== s1) {
      const { t: t0 } = nearest(q, x0, z0);
      if ((t0 > 0 && t0 < 1) || (t > 0 && t < 1)) out.add(p.wall);
    }
  }
  return out;
}

/** The pieces by 64 ft cells, for `pointTouches`: `{ pieces, near(x, z) }`. */
export function wallGrid(pieces, { cellFt = 64, worldFt = 8192 } = {}) {
  const cells = new Map(), n = Math.max(1, Math.round(worldFt / cellFt));
  const key = (cx, cz) => (((cx % n) + n) % n) * 65536 + (((cz % n) + n) % n);
  for (const p of pieces) {
    const pad = p.half + 8;
    for (let cx = Math.floor((Math.min(p.ax, p.bx) - pad) / cellFt); cx <= Math.floor((Math.max(p.ax, p.bx) + pad) / cellFt); cx++) {
      for (let cz = Math.floor((Math.min(p.az, p.bz) - pad) / cellFt); cz <= Math.floor((Math.max(p.az, p.bz) + pad) / cellFt); cz++) {
        const k = key(cx, cz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(p);
      }
    }
  }
  return {
    pieces,
    near(x, z) {
      const list = cells.get(key(Math.floor(x / cellFt), Math.floor(z / cellFt)));
      return list ?? [];
    },
  };
}

/**
 * A Parallel race's penalties (CP4 2.0.52.4): `touch(truck, walls, nowMs)` with the walls a truck touches this tick
 * adds `penaltyMs` for each wall that is armed for it, and disarms it until the truck has been clear of it for
 * `rearmMs`. `totals[truck]` is each truck's penalty in ms; `set(truck, ms)` takes a remote owner's total.
 */
export function createPenalties(count, { penaltyMs = 5000, rearmMs = 1000 } = {}) {
  const totals = new Array(count).fill(0);
  // Per truck: wall index -> the last time it was touched (ms); a wall in the map is disarmed.
  const touched = Array.from({ length: count }, () => new Map());
  return {
    totals,
    touch(truck, walls, nowMs) {
      const mine = touched[truck];
      if (!mine) return 0;
      let added = 0;
      for (const w of walls) {
        if (!mine.has(w)) { totals[truck] += penaltyMs; added += penaltyMs; }
        mine.set(w, nowMs);
      }
      for (const [w, at] of mine) if (!walls.has(w) && nowMs - at >= rearmMs) mine.delete(w);
      return added;
    },
    set(truck, ms) { if (truck >= 0 && truck < count) totals[truck] = Math.max(0, ms | 0); },
  };
}

/** A Parallel race's order: by finish time plus penalties; unfinished trucks after, by progress. */
export function parallelOrder(rows) {
  return [...rows].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.time + a.penaltyMs / 1000 - (b.time + b.penaltyMs / 1000);
    return (b.progress ?? 0) - (a.progress ?? 0);
  });
}

/** Whether a truck lost on penalties: it crossed first but its penalties put another truck ahead. */
export function lostOnPenalties(rows, row) {
  if (!row.finished) return false;
  const order = parallelOrder(rows);
  const placeBy = (key) => order.indexOf(row) > [...rows].filter((r) => r.finished).sort((a, b) => a[key] - b[key]).indexOf(row);
  return placeBy("time");
}
