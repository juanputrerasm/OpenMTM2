/*
  The ground as it is drawn with "Smooth terrain" on (docs/VISUALS.md, "Terrain").

  The game's ground is a 256 x 256 grid of 32 ft cells, two flat triangles each
  (MTM2_PHYSICS.md 2.1). The simulation keeps standing on exactly that. What is drawn is a
  second surface built on top of it at run time, a function of position:

      drawn = sim + w * (round(smooth) - sim) + w * detail

  - `sim` is the game's own surface, the two triangles.
  - `smooth` curves each of those triangles, and keeps the game's own way of cutting a cell in
    two, because that cut is often real: where a level floor meets a wall along a cell's
    diagonal, the floor's triangle must stay the floor. Each triangle becomes a cubic patch
    through its three corners that leaves each corner along the ground's slope there. That
    slope is the harmonic mean of the slopes either side along x and along z, and zero where
    they disagree in sign, and no edge of a patch leaves the range of its two ends. So a flat
    triangle stays flat, an even incline stays its plane and nothing overshoots.
  - `round` takes the edge off what that leaves. The patches meet along the cells' edges and
    diagonals, and where the ground turns there (a ridge, the foot of a bank, the brow of a
    hill) they meet at an angle: every hill had the outline of a thing cut from 32 ft
    facets. The smooth surface is therefore averaged over a few feet about each point (a bell
    of weights reaching 12 ft either way, `ROUND`), which rounds each such angle into a curve
    some 20 ft long and leaves flat and evenly sloping ground exactly as it was.
  - `detail` is fractal relief on ground too steep for a truck to hold. No tire grips better
    than 1.0 (MTM2_PHYSICS.md 2.3), which holds a slope of 1 in 1, and detail begins a little
    under that, measured on the game's own triangles: a triangle a truck can drive on gets
    none, however steep its neighbours, and detail fades out at the edge it shares with one.
    The course gets none whatever it crosses. Its character follows the ground type of the
    cell's texture: rock is craggy and layered, grass and dirt softer, sand and snow softer
    still, and made ground (cement, metal, wood) and water get none.
  - `w` keeps the drawn ground on the game's where something stands on it: 0 at the corners of
    a cell with a ground box and around every placed object, 1 elsewhere.

  Nothing here changes the simulation. `conformPose` moves a drawn truck by the difference
  between the two surfaces under its wheels, so it sits on the ground the player sees.

  Pure, with no allocation per query: the asset worker builds the mesh from it and the main
  thread asks it where the ground is.
*/

export const GRID = 256;
export const CELL_FT = 32;
export const STEP_FT = 2;
export const WORLD_FT = GRID * CELL_FT;
const MASK = GRID - 1;

/**
 * Detail begins at this slope of the game's ground (rise over run) and reaches its first measure
 * at the second. No tire holds a slope steeper than its grip (MTM2_PHYSICS.md 2.3: 1.0 at best),
 * so ground with detail on it is ground a truck falls down, not ground it drives on.
 */
export const DETAIL_SLOPE_START = 0.9, DETAIL_SLOPE_FULL = 1.5;
/** Ground steeper than the first of these is a cliff; by the second its detail has its full measure. */
export const CLIFF_SLOPE_START = 1.4, CLIFF_SLOPE_FULL = 2.4;
/** The detail's reach across the surface on full rock, feet: on a steep slope, more on a cliff, and its cap measured vertically. */
export const DETAIL_PERP_FT = 2.2, CLIFF_PERP_FT = 2.6, DETAIL_MAX_FT = 12;

/**
 * How craggy each ground type is, 0 to 1 (types: MTM2_PHYSICS.md 2.3). Cement, metal and wood
 * are made ground and water has a bed nobody sees: no detail.
 */
export const CRAG_BY_TYPE = Object.freeze({ 0: 0.8, 1: 0, 2: 0.8, 3: 0, 4: 0.55, 5: 0.35, 6: 0.6, 7: 0.8, 8: 0.3, 9: 0.3, 10: 0, 11: 0, 12: 1, 13: 0 });
const cragOf = (type) => CRAG_BY_TYPE[type] ?? 0.8;

/** How far past an object's footprint the ground is held to the game's, and where it is free again, feet. */
const KEEPOUT_MARGIN_FT = 6, KEEPOUT_BLEND_FT = 26;
/** Along the course: a point every so many feet, no detail within the track's half width and this much more, and full detail this far past that. */
const COURSE_STEP_FT = 16, COURSE_MARGIN_FT = 12, COURSE_BLEND_FT = 36, COURSE_MIN_HALF_FT = 24;

const smoothstep = (a, b, v) => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};
const wrapFt = (v) => {
  const w = v % WORLD_FT;
  return w < 0 ? w + WORLD_FT : w;
};

/**
 * What the drawn surface needs besides the heights, from the level (plain typed arrays, so the
 * worker hands it to the main thread):
 * - `smooth`, per grid corner, 0 to 255: how far the corner follows the smooth surface. 0 at
 *   the corners of a cell holding a ground box and, in a stadium, on and outside its footprint.
 * - `crag`, per grid corner, 0 to 255: the mean cragginess of the four cells around it.
 * - `keepouts`, four numbers per placed object: x, z (game feet), the radius inside which the
 *   ground is the game's, and the radius beyond which it is free.
 * - `calm`, four numbers per point along the course, the same way: inside the first radius
 *   the ground has no detail (it is still smoothed), beyond the second it has all of it.
 *
 * @param {{ clr: Uint16Array, textureValues: ArrayLike<number>, ra0?: Uint8Array|null, ra1?: Uint8Array|null,
 *   footprint?: { col0: number, col1: number, row0: number, row1: number }|null,
 *   objects?: { x: number, z: number, radius: number }[],
 *   courses?: { startFt: number[], endFt: number[], trackWidthFt?: number }[][] }} level
 *   `courses`: each a SIT course's straights in order (MTM2_PHYSICS.md 12); the turns between
 *   them are taken as the line from one straight's end to the next one's start.
 */
export function buildReliefData({ clr, textureValues, ra0 = null, ra1 = null, footprint = null, objects = [], courses = [] }) {
  const cells = GRID * GRID;
  const cellCrag = new Float32Array(cells);
  const boxed = new Uint8Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    const value = textureValues?.[clr[cell] & 0x0fff] ?? 0;
    cellCrag[cell] = cragOf(Math.floor(value / 100));
    if (ra0 && ra1 && ra0[cell] !== ra1[cell]) boxed[cell] = 1;
  }
  const smooth = new Uint8Array(cells).fill(255);
  const crag = new Uint8Array(cells);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      // The four cells that meet at corner (row, col).
      const r0 = (row - 1) & MASK, c0 = (col - 1) & MASK;
      const a = r0 * GRID + c0, b = r0 * GRID + col, c = row * GRID + c0, d = row * GRID + col;
      const corner = row * GRID + col;
      crag[corner] = Math.round((cellCrag[a] + cellCrag[b] + cellCrag[c] + cellCrag[d]) * 0.25 * 255);
      if (boxed[a] || boxed[b] || boxed[c] || boxed[d]) smooth[corner] = 0;
      if (footprint && (col <= footprint.col0 || col >= footprint.col1 || row <= footprint.row0 || row >= footprint.row1)) smooth[corner] = 0;
    }
  }
  const keepouts = new Float32Array(objects.length * 4);
  objects.forEach((object, i) => {
    const inner = Math.max(0, object.radius) + KEEPOUT_MARGIN_FT;
    keepouts.set([wrapFt(object.x), wrapFt(object.z), inner, inner + KEEPOUT_BLEND_FT], i * 4);
  });
  const calm = [];
  const along = (from, to, half) => {
    const length = Math.hypot(to[0] - from[0], to[2] - from[2]), steps = Math.max(1, Math.ceil(length / COURSE_STEP_FT));
    const inner = Math.max(COURSE_MIN_HALF_FT, half) + COURSE_MARGIN_FT;
    for (let k = 0; k <= steps; k++) calm.push(wrapFt(from[0] + ((to[0] - from[0]) * k) / steps), wrapFt(from[2] + ((to[2] - from[2]) * k) / steps), inner, inner + COURSE_BLEND_FT);
  };
  for (const course of courses) {
    course.forEach((straight, i) => {
      const half = (straight.trackWidthFt ?? 0) / 2;
      along(straight.startFt, straight.endFt, half);
      const next = course[(i + 1) % course.length];
      if (course.length > 1) along(straight.endFt, next.startFt, Math.max(half, (next.trackWidthFt ?? 0) / 2));
    });
  }
  return { smooth, crag, keepouts, calm: Float32Array.from(calm) };
}

/**
 * Circles over the ground, `x, z, inner, outer` each, indexed by the cells they reach so that a
 * query looks only at those near it. `factor` is 0 inside a circle's inner radius, 1 beyond its
 * outer one, and the least of all circles in reach; `beyond` is how far a point lies outside the
 * nearest circle's inner radius, feet (negative inside it, Infinity out of every circle's reach).
 */
export function indexCircles(circles) {
  const cells = GRID * GRID, count = circles.length / 4;
  const starts = new Int32Array(cells + 1);
  const eachCell = (k, visit) => {
    const x = circles[k * 4], z = circles[k * 4 + 1], reach = circles[k * 4 + 3];
    const c0 = Math.floor((x - reach) / CELL_FT), c1 = Math.floor((x + reach) / CELL_FT);
    const r0 = Math.floor((z - reach) / CELL_FT), r1 = Math.floor((z + reach) / CELL_FT);
    // A circle wider than the world reaches every cell once.
    const cols = Math.min(GRID, c1 - c0 + 1), rows = Math.min(GRID, r1 - r0 + 1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) visit(((r0 + r) & MASK) * GRID + ((c0 + c) & MASK));
  };
  for (let k = 0; k < count; k++) eachCell(k, (cell) => { starts[cell + 1]++; });
  for (let cell = 0; cell < cells; cell++) starts[cell + 1] += starts[cell];
  const listed = new Int32Array(starts[cells]);
  const fill = starts.slice(0, cells);
  for (let k = 0; k < count; k++) eachCell(k, (cell) => { listed[fill[cell]++] = k; });
  return {
    /** Whether any circle reaches `cell`. */
    reaches: (cell) => starts[cell + 1] > starts[cell],
    beyond(cell, x, z) {
      let least = Infinity;
      for (let n = starts[cell]; n < starts[cell + 1]; n++) {
        const k = listed[n] * 4;
        let dx = Math.abs(x - circles[k]), dz = Math.abs(z - circles[k + 1]);
        if (dx > WORLD_FT / 2) dx = WORLD_FT - dx;
        if (dz > WORLD_FT / 2) dz = WORLD_FT - dz;
        const past = Math.hypot(dx, dz) - circles[k + 2];
        if (past < least) least = past;
      }
      return least;
    },
    factor(cell, x, z) {
      let least = 1;
      for (let n = starts[cell]; n < starts[cell + 1]; n++) {
        const k = listed[n] * 4;
        let dx = Math.abs(x - circles[k]), dz = Math.abs(z - circles[k + 1]);
        if (dx > WORLD_FT / 2) dx = WORLD_FT - dx;
        if (dz > WORLD_FT / 2) dz = WORLD_FT - dz;
        const free = smoothstep(circles[k + 2], circles[k + 3], Math.hypot(dx, dz));
        if (free < least) least = free;
      }
      return least;
    },
  };
}

/* Gradient noise that repeats with the world, so the drawn ground joins itself across the wrap. */
const GRADIENTS = (() => {
  const out = new Float32Array(64);
  for (let i = 0; i < 32; i++) {
    out[i * 2] = Math.cos((i / 32) * Math.PI * 2);
    out[i * 2 + 1] = Math.sin((i / 32) * Math.PI * 2);
  }
  return out;
})();

function latticeHash(ix, iz, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Gradient noise in about -1 to 1 with `periods` lattice cells across the world. The periods used
 * are not powers of two, so no lattice line lies along the terrain's own grid.
 */
export function worldNoise(x, z, periods, seed) {
  const fx = (x * periods) / WORLD_FT, fz = (z * periods) / WORLD_FT;
  const bx = Math.floor(fx), bz = Math.floor(fz);
  const tx = fx - bx, tz = fz - bz;
  const x0 = ((bx % periods) + periods) % periods, z0 = ((bz % periods) + periods) % periods;
  const x1 = x0 + 1 === periods ? 0 : x0 + 1, z1 = z0 + 1 === periods ? 0 : z0 + 1;
  const g00 = (latticeHash(x0, z0, seed) & 31) * 2, g10 = (latticeHash(x1, z0, seed) & 31) * 2;
  const g01 = (latticeHash(x0, z1, seed) & 31) * 2, g11 = (latticeHash(x1, z1, seed) & 31) * 2;
  const n00 = GRADIENTS[g00] * tx + GRADIENTS[g00 + 1] * tz;
  const n10 = GRADIENTS[g10] * (tx - 1) + GRADIENTS[g10 + 1] * tz;
  const n01 = GRADIENTS[g01] * tx + GRADIENTS[g01 + 1] * (tz - 1);
  const n11 = GRADIENTS[g11] * (tx - 1) + GRADIENTS[g11 + 1] * (tz - 1);
  const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10), sz = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
  const a = n00 + (n10 - n00) * sx, b = n01 + (n11 - n01) * sx;
  return (a + (b - a) * sz) * 1.5;
}

/* Twelve directions to the middles of a cube's edges: the gradients of the noise in space. */
const GRADIENTS_3 = new Int8Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

/**
 * Gradient noise in space, about -1 to 1: `periods` lattice cells across the world along x and
 * z, where it repeats, and cells of the same size up the height `y`, where it does not. Read at
 * a point of the ground and its height, it looks the same on a wall as on a floor, where noise
 * over x and z alone would be drawn out down a slope.
 */
export function worldNoise3(x, y, z, periods, seed) {
  const scale = periods / WORLD_FT;
  const fx = x * scale, fy = y * scale, fz = z * scale;
  const bx = Math.floor(fx), by = Math.floor(fy), bz = Math.floor(fz);
  const tx = fx - bx, ty = fy - by, tz = fz - bz;
  const x0 = ((bx % periods) + periods) % periods, z0 = ((bz % periods) + periods) % periods;
  const x1 = x0 + 1 === periods ? 0 : x0 + 1, z1 = z0 + 1 === periods ? 0 : z0 + 1;
  const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10), sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10), sz = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
  let total = 0;
  for (let corner = 0; corner < 8; corner++) {
    const cx = corner & 1, cy = (corner >> 1) & 1, cz = corner >> 2;
    const g = (latticeHash(cx ? x1 : x0, cz ? z1 : z0, seed + Math.imul(by + cy, 0x9e3779b1)) % 12) * 3;
    const dot = GRADIENTS_3[g] * (tx - cx) + GRADIENTS_3[g + 1] * (ty - cy) + GRADIENTS_3[g + 2] * (tz - cz);
    total += dot * (cx ? sx : 1 - sx) * (cy ? sy : 1 - sy) * (cz ? sz : 1 - sz);
  }
  return total * 1.1;
}

/** A ridge from noise: highest along the noise's zero lines, with the crest rounded so a mesh cut every few feet can follow it. */
const ridge = (n) => { const r = 1 - Math.sqrt(n * n + 0.03); return r * r; };

/**
 * The detail's shape at a point, about -1 to 1: `crag` 0 is soft ground, 1 is rock; `height` is
 * the smooth surface there. Nothing in it is finer than some twenty feet: the mesh is cut every
 * four at its finest, and finer relief than it can carry would only show as noise.
 */
function detailShape(x, z, height, crag) {
  const soft = 0.6 * worldNoise(x, z, 60, 11) + 0.3 * worldNoise(x, z, 130, 12);
  if (crag <= 0) return soft * 0.5;
  // Ridges, read in space so a wall has them as a slope does. The widest are buttresses and gullies, the narrowest spurs.
  const ridges = (ridge(worldNoise3(x, height, z, 50, 21)) * 0.42 + ridge(worldNoise3(x, height, z, 104, 22)) * 0.31
    + ridge(worldNoise3(x, height, z, 210, 23)) * 0.18 + ridge(worldNoise3(x, height, z, 390, 24)) * 0.09 - 0.49) * 2.6;
  // Layers: bands of harder and softer rock by height, which read as ledges along the contours.
  const band = height / 13 + 0.7 * worldNoise(x, z, 52, 31);
  const fold = Math.abs(band - Math.floor(band) - 0.5) * 2;
  const layers = smoothstep(0.2, 0.8, fold) - 0.5;
  const rock = ridges * 0.65 + layers * 1.0;
  return soft * 0.5 * (1 - crag) + rock * crag;
}

/**
 * The rounding: the smooth surface at a point is its weighted mean over a square of points
 * `stepFt` apart, `taps` either way, by `weights` along each axis (a bell: 1 6 15 20 15 6 1 over 64).
 * The mesh is cut on the same spacing (worker/relief-mesh.js), so it rounds on its own samples.
 */
export const ROUND = Object.freeze({ stepFt: CELL_FT / 8, taps: 3, weights: Object.freeze([1 / 64, 6 / 64, 15 / 64, 20 / 64, 15 / 64, 6 / 64, 1 / 64]) });

/** How far the detail reaches at a slope, feet measured vertically, before the ground type scales it. */
export function detailReachFt(slope) {
  if (slope <= DETAIL_SLOPE_START) return 0;
  const across = DETAIL_PERP_FT * smoothstep(DETAIL_SLOPE_START, DETAIL_SLOPE_FULL, slope) + CLIFF_PERP_FT * smoothstep(CLIFF_SLOPE_START, CLIFF_SLOPE_FULL, slope);
  // The same reach across the surface on any slope means more of it vertically on a steeper one.
  return Math.min(DETAIL_MAX_FT, across * Math.sqrt(1 + slope * slope));
}

/** The game's surface in a cell: corner heights, the place in the cell (0 to 1) and whether it splits along its main diagonal. */
export function triangleHeight(h00, h01, h10, h11, fx, fz, main) {
  if (main) return fz < fx ? h00 + (h01 - h00) * fx + (h11 - h01) * fz : h00 + (h11 - h10) * fx + (h10 - h00) * fz;
  return fz < 1 - fx ? h01 + (h00 - h01) * (1 - fx) + (h10 - h00) * fz : h01 + (h10 - h11) * (1 - fx) + (h11 - h01) * fz;
}

/**
 * The drawn surface over a level's heights.
 *
 * @param {{ heights: Uint8Array|Float32Array, smooth?: Uint8Array, crag?: Uint8Array, keepouts?: Float32Array, calm?: Float32Array }} level
 *   `heights` is the level .RAW (or corner heights in feet, a Float32Array, on a finer level); the rest is `buildReliefData`'s. Without it the drawn surface
 *   is the game's own.
 */
export function createRelief({ heights, smooth = null, crag = null, keepouts = new Float32Array(0), calm = new Float32Array(0) }) {
  const cells = GRID * GRID;
  // A level finer than MTM's 2 ft steps (CART Precision Racing) gives its corner heights in feet.
  const stepFt = heights instanceof Float32Array || heights instanceof Float64Array ? 1 : STEP_FT;
  if (heights.length !== cells) throw new RangeError(`relief needs ${cells} heights, got ${heights.length}`);
  smooth ??= new Uint8Array(cells);
  crag ??= new Uint8Array(cells);
  const H = (row, col) => heights[(row & MASK) * GRID + (col & MASK)] * stepFt;
  const at = (row, col) => (row & MASK) * GRID + (col & MASK);

  // The ground's slope at each corner, feet per cell, along x (columns) and z (rows).
  const slopeX = new Float32Array(cells), slopeZ = new Float32Array(cells);
  const limited = (before, after) => (before * after <= 0 ? 0 : (2 * before * after) / (before + after));
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const h = H(row, col);
      slopeX[row * GRID + col] = limited(h - H(row, col - 1), H(row, col + 1) - h);
      slopeZ[row * GRID + col] = limited(h - H(row - 1, col), H(row + 1, col) - h);
    }
  }

  /*
    How steep the game's ground is, for the detail. Each cell's two triangles have a slope
    (`steep`, the triangle under the first corner's x edge first). From those, a value at every
    corner and on every edge: the least of the triangles that meet there. Inside a triangle the
    six are joined by the quadratic through them, so the steepness is continuous everywhere,
    is a triangle's own in its middle, and falls to the gentler neighbour's at a shared edge.
  */
  const steep = new Float32Array(cells * 2);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const h00 = H(row, col), h01 = H(row, col + 1), h10 = H(row + 1, col), h11 = H(row + 1, col + 1);
      const cell = row * GRID + col;
      if (((row ^ col) & 1) === 0) {
        steep[cell * 2] = Math.hypot(h01 - h00, h11 - h01) / CELL_FT;
        steep[cell * 2 + 1] = Math.hypot(h11 - h10, h10 - h00) / CELL_FT;
      } else {
        steep[cell * 2] = Math.hypot(h01 - h00, h10 - h00) / CELL_FT;
        steep[cell * 2 + 1] = Math.hypot(h11 - h10, h11 - h01) / CELL_FT;
      }
    }
  }
  const steepDiagonal = new Float32Array(cells), steepAlongX = new Float32Array(cells), steepAlongZ = new Float32Array(cells), steepCorner = new Float32Array(cells);
  for (let cell = 0; cell < cells; cell++) steepDiagonal[cell] = Math.min(steep[cell * 2], steep[cell * 2 + 1]);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      // The cells to the left and below are cut along the other diagonal, the one below and to the left along this one's.
      const cell = row * GRID + col, main = ((row ^ col) & 1) === 0;
      const below = at(row - 1, col), left = at(row, col - 1), belowLeft = at(row - 1, col - 1);
      // The edge to (row, col + 1): this cell's first triangle and the second of the cell below.
      steepAlongX[cell] = Math.min(steep[cell * 2], steep[below * 2 + 1]);
      // The edge to (row + 1, col): the triangle on this cell's x = 0 side and the one on the left cell's x = 1 side.
      steepAlongZ[cell] = Math.min(steep[cell * 2 + (main ? 1 : 0)], steep[left * 2 + (main ? 1 : 0)]);
      // The corner: every triangle around it. A cell's diagonal passes through two of its corners, which then touch both its triangles.
      steepCorner[cell] = Math.min(
        main ? steepDiagonal[cell] : steep[cell * 2],
        main ? steepDiagonal[left] : steep[left * 2],
        main ? steepDiagonal[below] : steep[below * 2 + 1],
        main ? steepDiagonal[belowLeft] : steep[belowLeft * 2 + 1]);
    }
  }

  const held = indexCircles(keepouts), calmed = indexCircles(calm);

  // A cell where the drawn surface is the game's: held there, or one plane its corners' slopes continue and too gentle for detail.
  // (`heldCell` says which of the two: a held cell is the game's whatever lies about it.)
  const plain = new Uint8Array(cells), heldCell = new Uint8Array(cells);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const i00 = row * GRID + col, i01 = at(row, col + 1), i10 = at(row + 1, col), i11 = at(row + 1, col + 1);
      if (!smooth[i00] && !smooth[i01] && !smooth[i10] && !smooth[i11]) { plain[i00] = 1; heldCell[i00] = 1; continue; }
      const h00 = heights[i00] * stepFt, h01 = heights[i01] * stepFt, h10 = heights[i10] * stepFt, h11 = heights[i11] * stepFt;
      if (h00 + h11 !== h01 + h10) continue;
      const sx = h01 - h00, sz = h10 - h00;
      // The quadratic may rise a third over its largest value, so this much under the start of detail is none anywhere in the cell.
      const steepest = Math.max(steepCorner[i00], steepCorner[i01], steepCorner[i10], steepCorner[i11], steepAlongX[i00], steepAlongX[i10], steepAlongZ[i00], steepAlongZ[i01], steepDiagonal[i00]);
      if (steepest * 1.34 > DETAIL_SLOPE_START) continue;
      if (slopeX[i00] === sx && slopeX[i01] === sx && slopeX[i10] === sx && slopeX[i11] === sx
        && slopeZ[i00] === sz && slopeZ[i01] === sz && slopeZ[i10] === sz && slopeZ[i11] === sz) plain[i00] = 1;
    }
  }

  function simAt(x, z) {
    const wx = wrapFt(x), wz = wrapFt(z);
    const col = Math.floor(wx / CELL_FT) & MASK, row = Math.floor(wz / CELL_FT) & MASK;
    const col1 = (col + 1) & MASK, row1 = (row + 1) & MASK;
    return triangleHeight(
      heights[row * GRID + col] * stepFt, heights[row * GRID + col1] * stepFt, heights[row1 * GRID + col] * stepFt, heights[row1 * GRID + col1] * stepFt,
      wx / CELL_FT - col, wz / CELL_FT - row, ((row ^ col) & 1) === 0);
  }

  /** The slope of the game's triangle under (x, z), rise over run. */
  function simSlopeAt(x, z) {
    const wx = wrapFt(x), wz = wrapFt(z);
    const col = Math.floor(wx / CELL_FT) & MASK, row = Math.floor(wz / CELL_FT) & MASK;
    const u = wx / CELL_FT - col, v = wz / CELL_FT - row;
    return steep[(row * GRID + col) * 2 + ((((row ^ col) & 1) === 0 ? v < u : v < 1 - u) ? 0 : 1)];
  }

  /** A patch edge's inner control height next to the corner at height `from`: along the corner's slope, kept between the edge's two ends. */
  const edgeControl = (from, to, slope) => {
    const control = from + slope / 3;
    return from < to ? (control < from ? from : control > to ? to : control) : (control > from ? from : control < to ? to : control);
  };

  // A cell whose drawn surface is the game's whatever the rounding reaches: held there, or one plane with every cell about it
  // (a held cell about it may be any shape, and the rounding would reach it).
  const flat = new Uint8Array(cells);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const cell = row * GRID + col;
      let all = plain[cell];
      for (let dr = -1; dr <= 1 && all && !heldCell[cell]; dr++) {
        for (let dc = -1; dc <= 1 && all; dc++) { const near = at(row + dr, col + dc); all = plain[near] && !heldCell[near] ? 1 : 0; }
      }
      flat[cell] = all;
    }
  }

  /*
    The place a query is at, worked out once by `locate` and read by what follows it: the cell's corners, the game's
    triangle under the point (its corners 1, 2, 3 anticlockwise, where they are in the cell, the point's weights and
    the steepness on its edges), and the game's own height there.

    A `let` closed over by every query is a boxed number, and a mesh asks for millions of them. The slots stay
    plain floats (small integers are exact): 0 wx, 1 wz, 2 u, 3 v, 4 i00, 5 i01, 6 i10, 7 i11, 8 i1, 9 i2, 10 i3,
    11 x1, 12 z1, 13 x2, 14 z2, 15 x3, 16 z3, 17 b1, 18 b2, 19 b3, 20 e12, 21 e23, 22 e31, 23 onMain (1 or 0).
  */
  const q = new Float64Array(24);
  function locate(x, z) {
    // (Most queries are inside the world already: the remainder that wraps the others is slow.)
    const wx = x >= 0 && x < WORLD_FT ? x : wrapFt(x), wz = z >= 0 && z < WORLD_FT ? z : wrapFt(z);
    const col = Math.floor(wx / CELL_FT) & MASK, row = Math.floor(wz / CELL_FT) & MASK;
    const col1 = (col + 1) & MASK, row1 = (row + 1) & MASK;
    const i00 = row * GRID + col, i01 = row * GRID + col1, i10 = row1 * GRID + col, i11 = row1 * GRID + col1;
    const u = wx / CELL_FT - col, v = wz / CELL_FT - row;
    const main = ((row ^ col) & 1) === 0;
    let i1, i2, i3, x1, z1, x2, z2, x3, z3, b1, b2, b3, e12, e23, e31;
    if (main) {
      if (v < u) {
        i1 = i00; x1 = 0; z1 = 0; i2 = i01; x2 = 1; z2 = 0; i3 = i11; x3 = 1; z3 = 1;
        b1 = 1 - u; b2 = u - v; b3 = v;
        e12 = steepAlongX[i00]; e23 = steepAlongZ[i01]; e31 = steepDiagonal[i00];
      } else {
        i1 = i00; x1 = 0; z1 = 0; i2 = i11; x2 = 1; z2 = 1; i3 = i10; x3 = 0; z3 = 1;
        b1 = 1 - v; b2 = u; b3 = v - u;
        e12 = steepDiagonal[i00]; e23 = steepAlongX[i10]; e31 = steepAlongZ[i00];
      }
    } else if (v < 1 - u) {
      i1 = i00; x1 = 0; z1 = 0; i2 = i01; x2 = 1; z2 = 0; i3 = i10; x3 = 0; z3 = 1;
      b1 = 1 - u - v; b2 = u; b3 = v;
      e12 = steepAlongX[i00]; e23 = steepDiagonal[i00]; e31 = steepAlongZ[i00];
    } else {
      i1 = i01; x1 = 1; z1 = 0; i2 = i11; x2 = 1; z2 = 1; i3 = i10; x3 = 0; z3 = 1;
      b1 = 1 - v; b2 = u + v - 1; b3 = 1 - u;
      e12 = steepAlongZ[i01]; e23 = steepAlongX[i10]; e31 = steepDiagonal[i00];
    }
    q[0] = wx; q[1] = wz; q[2] = u; q[3] = v;
    q[4] = i00; q[5] = i01; q[6] = i10; q[7] = i11;
    q[8] = i1; q[9] = i2; q[10] = i3;
    q[11] = x1; q[12] = z1; q[13] = x2; q[14] = z2; q[15] = x3; q[16] = z3;
    q[17] = b1; q[18] = b2; q[19] = b3;
    q[20] = e12; q[21] = e23; q[22] = e31; q[23] = main ? 1 : 0;
  }
  /** The game's own height at the place last located. The same arithmetic as `simAt`, so that where the drawn ground is held to the game's the two agree to the last bit. */
  const simHere = () => {
    const i00 = q[4], i01 = q[5], i10 = q[6], i11 = q[7];
    return triangleHeight(heights[i00] * stepFt, heights[i01] * stepFt, heights[i10] * stepFt, heights[i11] * stepFt, q[2], q[3], q[23]);
  };

  /** The smooth surface at game (x, z), before it is rounded: the cubic patch on the game's triangle there. */
  function baseAt(x, z) {
    locate(x, z);
    const i00 = q[4];
    // A plain cell is its own plane, which is its patch.
    if (plain[i00]) return simHere();
    const i1 = q[8], i2 = q[9], i3 = q[10];
    const x1 = q[11], z1 = q[12], x2 = q[13], z2 = q[14], x3 = q[15], z3 = q[16];
    const b1 = q[17], b2 = q[18], b3 = q[19];
    const h1 = heights[i1] * stepFt, h2 = heights[i2] * stepFt, h3 = heights[i3] * stepFt;
    // The triangle as a cubic patch: each edge leaves its corners along the ground's slope there.
    const c12 = edgeControl(h1, h2, slopeX[i1] * (x2 - x1) + slopeZ[i1] * (z2 - z1)), c21 = edgeControl(h2, h1, slopeX[i2] * (x1 - x2) + slopeZ[i2] * (z1 - z2));
    const c23 = edgeControl(h2, h3, slopeX[i2] * (x3 - x2) + slopeZ[i2] * (z3 - z2)), c32 = edgeControl(h3, h2, slopeX[i3] * (x2 - x3) + slopeZ[i3] * (z2 - z3));
    const c31 = edgeControl(h3, h1, slopeX[i3] * (x1 - x3) + slopeZ[i3] * (z1 - z3)), c13 = edgeControl(h1, h3, slopeX[i1] * (x3 - x1) + slopeZ[i1] * (z3 - z1));
    const edges = (c12 + c21 + c23 + c32 + c31 + c13) / 6;
    let middle = edges + (edges - (h1 + h2 + h3) / 3) / 2;
    const low = Math.min(h1, h2, h3), high = Math.max(h1, h2, h3);
    if (middle < low) middle = low; else if (middle > high) middle = high;
    return h1 * b1 * b1 * b1 + h2 * b2 * b2 * b2 + h3 * b3 * b3 * b3
      + 3 * (c12 * b1 * b1 * b2 + c21 * b1 * b2 * b2 + c23 * b2 * b2 * b3 + c32 * b2 * b3 * b3 + c31 * b3 * b3 * b1 + c13 * b1 * b1 * b3)
      + 6 * middle * b1 * b2 * b3;
  }

  const K = ROUND.weights, TAPS = ROUND.taps, STEP = ROUND.stepFt;
  /** The smooth surface at game (x, z), rounded: its weighted mean over the points about it (`ROUND`). */
  function roundedAt(x, z) {
    let sum = 0;
    for (let j = -TAPS; j <= TAPS; j++) {
      let line = 0;
      for (let i = -TAPS; i <= TAPS; i++) line += K[i + TAPS] * baseAt(x + i * STEP, z + j * STEP);
      sum += K[j + TAPS] * line;
    }
    return sum;
  }

  /**
   * The drawn ground at game (x, z) given the rounded smooth surface there (`rounded`): held to the game's where
   * something stands on it, and with its detail where it is steep. The mesh's builder rounds on its own samples and
   * asks for this; `heightAt` rounds for itself.
   */
  function finish(x, z, rounded) {
    locate(x, z);
    const wx = q[0], wz = q[1], u = q[2], v = q[3];
    const i00 = q[4], i01 = q[5], i10 = q[6], i11 = q[7];
    const i1 = q[8], i2 = q[9], i3 = q[10];
    const b1 = q[17], b2 = q[18], b3 = q[19];
    const e12 = q[20], e23 = q[21], e31 = q[22];
    const sim = simHere();
    if (flat[i00]) return sim;
    const un = 1 - u, vn = 1 - v;
    let weight = (smooth[i00] * un * vn + smooth[i01] * u * vn + smooth[i10] * un * v + smooth[i11] * u * v) / 255;
    if (weight <= 0) return sim;
    if (held.reaches(i00)) weight *= held.factor(i00, wx, wz);
    if (weight <= 0) return sim;
    let drawn = sim + weight * (rounded - sim);

    // Detail, by how steep the game's ground is here.
    const steepness = steepCorner[i1] * b1 * (2 * b1 - 1) + steepCorner[i2] * b2 * (2 * b2 - 1) + steepCorner[i3] * b3 * (2 * b3 - 1)
      + 4 * (e12 * b1 * b2 + e23 * b2 * b3 + e31 * b3 * b1);
    let reach = detailReachFt(steepness);
    if (reach > 0 && calmed.reaches(i00)) reach *= calmed.factor(i00, wx, wz);
    if (reach > 0) {
      const rock = (crag[i00] * un * vn + crag[i01] * u * vn + crag[i10] * un * v + crag[i11] * u * v) / 255;
      if (rock > 0) drawn += weight * reach * Math.min(1, rock * 1.25) * detailShape(wx, wz, rounded, rock);
    }
    return drawn;
  }

  function heightAt(x, z) {
    locate(x, z);
    const i00 = q[4], i01 = q[5], i10 = q[6], i11 = q[7];
    // Flat, or held to the game's here: nothing to round.
    if (flat[i00] || (!smooth[i00] && !smooth[i01] && !smooth[i10] && !smooth[i11])) return simHere();
    return finish(x, z, roundedAt(x, z));
  }

  return {
    /** The drawn ground's height at game (x, z), feet. Any x and z: the world wraps. */
    heightAt,
    /** The game's own ground there (MTM2_PHYSICS.md 2.1), without the Snow rule. */
    simAt,
    simSlopeAt,
    /** How far the drawn ground stands above the game's there, feet. */
    offsetAt: (x, z) => heightAt(x, z) - simAt(x, z),
    /** Whether the drawn surface is the game's over the whole of cell (row, col): its own plane, and so is every cell about it, so that no rounding reaches it. */
    cellIsPlain: (row, col) => flat[at(row, col)] === 1,
    /** The smooth surface before it is rounded, and the drawn ground from the rounded one: for the mesh's builder, which rounds on its own samples (`ROUND`). */
    baseAt, finish,
  };
}

/** A wheel this far above the game's ground (feet, under the tread) is fully seated, and beyond the second not at all. */
const SEATED_FT = 1, AIRBORNE_FT = 5;
/** No wheel is moved further than this, feet. */
export const SEAT_LIMIT_FT = 2.5;
/** A wheel on ground steeper than the first of these (the game's own slope, rise over run) is seated less, and past the second not at all. */
const SEAT_SLOPE_START = 0.75, SEAT_SLOPE_END = 1.05;

/**
 * A truck's pose as it is drawn on the drawn ground: the body lifted by the mean of what the
 * drawn ground differs by under its four wheels (`seatLift`, feet), and each axle's travel and
 * articulation changed by its own wheels' remainder, so the drawn suspension takes it up and
 * every wheel stands on the ground the player sees. A wheel in the air is left alone, and so is
 * a truck standing on something above the ground (a ramp, a ground box, a bridge) or sliding
 * down ground too steep to hold.
 *
 * @param {{ pos: number[], matrix: number[], axles: { articulation: number, travel: number }[] }} pose
 *   from the simulation (game frame; `matrix` is row-major, body to world)
 * @param {{ simAt: Function, offsetAt: Function, simSlopeAt?: Function }} relief
 * @param {number[][]} hubs the wheel anchors in body feet, FR FL RR RL
 * @param {number} tireRadiusFt
 * @param {number|null} [iceLevelFt] in Snow, the water's level: ground under it is under the
 *   ice the trucks drive on (MTM2_PHYSICS.md 2.1), which is level, so a wheel over it is left alone
 */
export function conformPose(pose, relief, hubs, tireRadiusFt, iceLevelFt = null) {
  const m = pose.matrix, lifts = [0, 0, 0, 0];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const hub = hubs[i];
    if (!hub) continue;
    const axle = pose.axles?.[i < 2 ? 0 : 1];
    const a = axle?.articulation ?? 0;
    // The hub in the body's frame, as render/truck-object.js places it: the axle's travel is its height there.
    const bx = hub[0] * Math.cos(a), by = hub[0] * Math.sin(a) + (axle?.travel ?? hub[1]), bz = hub[2];
    const x = pose.pos[0] + m[0] * bx + m[1] * by + m[2] * bz;
    const y = pose.pos[1] + m[3] * bx + m[4] * by + m[5] * bz;
    const z = pose.pos[2] + m[6] * bx + m[7] * by + m[8] * bz;
    const groundFt = relief.simAt(x, z);
    if (iceLevelFt !== null && groundFt < iceLevelFt) continue;
    const clear = y - tireRadiusFt - groundFt;
    // Seated when the tread is at the ground, and the ground is ground a truck holds: one sliding down a cliff is left where it is.
    const seated = (1 - smoothstep(SEATED_FT, AIRBORNE_FT, Math.abs(clear))) * (1 - smoothstep(SEAT_SLOPE_START, SEAT_SLOPE_END, relief.simSlopeAt?.(x, z) ?? 0));
    lifts[i] = seated > 0 ? seated * Math.max(-SEAT_LIMIT_FT, Math.min(SEAT_LIMIT_FT, relief.offsetAt(x, z))) : 0;
    sum += lifts[i];
  }
  const lift = sum / 4;
  if (!lifts.some((v) => v !== 0)) return pose;
  const axles = (pose.axles ?? []).map((axle, k) => {
    const right = hubs[k * 2], left = hubs[k * 2 + 1];
    const span = right && left ? right[0] - left[0] : 0;
    return {
      ...axle,
      // The axle rises by its wheels' mean beyond the body's lift, and tilts by their difference across its width.
      travel: axle.travel + (lifts[k * 2] + lifts[k * 2 + 1]) / 2 - lift,
      articulation: axle.articulation + (Math.abs(span) > 1e-6 ? (lifts[k * 2] - lifts[k * 2 + 1]) / span : 0),
    };
  });
  return { ...pose, pos: [pose.pos[0], pose.pos[1] + lift, pose.pos[2]], axles, seatLift: lift };
}

/** A tire's radius from its model's bounds (worker/truck-build.js `parts.tireRight`), feet; the game's 66 inch tire without them. */
export function tireRadiusFt(tire) {
  const bounds = tire?.bounds;
  return bounds ? Math.max(Math.abs(bounds.min[1]), Math.abs(bounds.max[1]), 0.5) : 2.75;
}
