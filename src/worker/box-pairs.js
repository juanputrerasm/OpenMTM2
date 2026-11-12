// The box against box pairs of a step (MTM2_PHYSICS.md 14.21), found through a grid instead of tried all against all.
//
// The step tries every moving box against each later moving box, then against every still box; OpenPhotex
// `collideBoxes` returns at once for a pair whose bounding spheres do not overlap. A city track lists thousands of
// boxes, most of them props far apart, so nearly every pair tried does nothing. `forEachBoxPair` hands over only the
// pairs whose spheres' squares overlap on x and z (every pair whose spheres overlap among them), in the order the full
// loops would: the same calls that do anything, in the same order, so the same result.

const CELL_FT = 64;

/**
 * @param moving  boxes that move (`dynamic`), in list order
 * @param still   boxes that do not, in list order
 * @param fn      called as fn(first, second): moving[i] with moving[j] (j > i), then moving[i] with each still box
 */
export function forEachBoxPair(moving, still, fn) {
  if (!moving.length) return;
  const grid = new Map();
  const huge = [];
  const add = (box, tag, index) => {
    const r = box.radius;
    const x0 = Math.floor((box.pos[0] - r) / CELL_FT), x1 = Math.floor((box.pos[0] + r) / CELL_FT);
    const z0 = Math.floor((box.pos[2] - r) / CELL_FT), z1 = Math.floor((box.pos[2] + r) / CELL_FT);
    const entry = { box, tag, index };
    // A box over more than 64 cells a side (4,096 ft) is tried against every mover, as before.
    if (x1 - x0 > 64 || z1 - z0 > 64 || !Number.isFinite(x0 + x1 + z0 + z1)) { huge.push(entry); return; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = x * 1048576 + z;
      const list = grid.get(k);
      if (list) list.push(entry); else grid.set(k, [entry]);
    }
  };
  moving.forEach((b, i) => add(b, 0, i));
  still.forEach((b, i) => add(b, 1, i));
  const seen = new Set();
  for (let i = 0; i < moving.length; i++) {
    const m = moving[i], r = m.radius;
    const x0 = Math.floor((m.pos[0] - r) / CELL_FT), x1 = Math.floor((m.pos[0] + r) / CELL_FT);
    const z0 = Math.floor((m.pos[2] - r) / CELL_FT), z1 = Math.floor((m.pos[2] + r) / CELL_FT);
    seen.clear();
    const movers = [], stills = [];
    const take = (e) => {
      if (seen.has(e)) return;
      seen.add(e);
      if (e.tag === 0) { if (e.index > i) movers.push(e.index); } else stills.push(e.index);
    };
    for (const e of huge) take(e);
    if (x1 - x0 > 64 || z1 - z0 > 64 || !Number.isFinite(x0 + x1 + z0 + z1)) {
      // A huge mover: every box, as the full loops.
      for (let j = i + 1; j < moving.length; j++) fn(m, moving[j]);
      for (const b of still) fn(m, b);
      continue;
    }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (const e of grid.get(x * 1048576 + z) ?? []) take(e);
    movers.sort((a, b) => a - b);
    stills.sort((a, b) => a - b);
    for (const j of movers) fn(m, moving[j]);
    for (const j of stills) fn(m, still[j]);
  }
}
