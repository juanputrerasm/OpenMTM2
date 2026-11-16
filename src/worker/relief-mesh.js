/*
  The terrain mesh for the drawn ground (game/terrain-relief.js; docs/VISUALS.md, "Terrain"),
  in scene coordinates like terrain-mesh.js, whose textures and baked shade it keeps.

  A cell is cut as finely as its ground needs. The drawn surface is sampled across the cell
  every 4 ft, and the cell takes the coarsest cut (its side in 1, 2, 4 or 8 parts) that stays
  within a tolerance of those samples. A flat or evenly sloping cell stays the game's two
  triangles; a cliff takes all eight parts. The tolerance is the tightest whose mesh fits a
  budget of vertices, counted exactly, so a level that is rough everywhere is cut a little
  coarser instead of costing without limit.

  No cracks. Two cells share an edge, and the edge is cut as finely as the finer of them wants.
  Each cell has a lattice of its own inside, joined to the points on each edge by a strip of
  triangles, so a coarse cell beside a fine one still meets it point for point. Every point's
  height and normal is a function of where it is and nothing else, so the two cells agree to
  the last bit.

  Snow. Built for a race in Snow (`snow`, game/snow-cover.js), every vertex also carries how
  deep the snow lies on it once settled, and a cell is cut finely enough for the snow's surface
  as well as the ground's: the bank along the course's edge is a few feet wide.

  Two levels of detail, in chunks of 64 x 64 cells. `fine` is the above. `coarse` has every
  cell's inside as two triangles, with the edges that lie on a chunk's border cut as `fine`
  cuts them. A fine chunk and a coarse one therefore meet without a crack, and the renderer
  may draw each chunk at either level (render/track-scene.js draws the near ones fine).

  Pure; the result is typed arrays, ready to transfer.
*/
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";
import { CELL_FT, GRID, ROUND } from "../game/terrain-relief.js";
import { SNOW_DEPTH_SCALE_FT } from "../game/snow-cover.js";
import { cellTileUvs } from "./terrain-mesh.js";

/** A chunk's side in cells; render/track-scene.js draws the terrain in the same chunks. */
export const CHUNK_CELLS = 64;
/** The finest cut of a cell's side, and the samples' spacing in feet. */
const FINE = 8, SAMPLE_FT = CELL_FT / FINE;
/** The samples kept per rough cell: the cell's own 9 x 9 and one ring outside it, for the normals. */
const SIDE = FINE + 3;
/** The snow's depth is kept for the cell's own 9 x 9. */
const SNOW_SIDE = FINE + 1;
/**
 * How far a cut may stand off the drawn surface, feet, for a cell seen from `VIEW_NEAR_FT`: tried
 * in order until the mesh fits the budget. A cell seen from further off may stand off further in
 * proportion, which is the same on the screen.
 */
export const TOLERANCES_FT = Object.freeze([0.1, 0.15, 0.22, 0.33, 0.5, 0.75, 1.1, 1.7, 2.5]);
/**
 * A cell is taken to be seen from as far as it lies from the course, where the cameras are,
 * and from no nearer than this, feet: the chase camera is some way back from its truck.
 */
export const VIEW_NEAR_FT = 60;
export const DEFAULT_VERTEX_BUDGET = 900000;
const MASK = GRID - 1;
const LTE_BYTES_PER_POINT = 7;
/** How much of a face's baked brightness does not depend on which way it faces. */
const AMBIENT_SHARE = 0.45;

/** Vertices and triangles of a cell whose inside is cut in `inner` parts and whose edges in `eB`, `eR`, `eT`, `eL`. */
function cellCounts(inner, eB, eR, eT, eL) {
  if (inner === 1) return [4, 2];
  const n = inner - 1;
  return [n * n + eB + eR + eT + eL, 2 * (n - 1) * (n - 1) + eB + eR + eT + eL + 4 * (n - 1)];
}

/**
 * @param {{ heights: Uint8Array, clr: Uint16Array, lte: Uint8Array|null, atlas: object,
 *   footprint?: { col0: number, col1: number, row0: number, row1: number }|null,
 *   relief: ReturnType<import("../game/terrain-relief.js").createRelief>,
 *   snow?: ReturnType<import("../game/snow-cover.js").createSnowCover>|null,
 *   sunVector?: number[]|null, vertexBudget?: number, tileInset?: number }} level
 *   `sunVector` is the LVL's (the way the light travels, game frame): with it the baked shade of
 *   a rough cell follows the relief, so the classic look shows it too. `snow` is the snow that
 *   will lie on this ground: each level of detail then has `snow`, a byte a vertex, its settled
 *   depth over `SNOW_DEPTH_SCALE_FT`. `tileInset` is how many legacy pixels each ground tile is cropped by (terrain-mesh.js).
 */
export function buildReliefMesh({ heights, clr, lte, atlas, footprint = null, relief, snow = null, sunVector = null, courses = [], vertexBudget = DEFAULT_VERTEX_BUDGET, tileInset = 2 }) {
  const cells = GRID * GRID;
  const hasLte = !!lte && lte.length >= cells * LTE_BYTES_PER_POINT;
  const drawn = (row, col) => !footprint || (col >= footprint.col0 && col < footprint.col1 && row >= footprint.row0 && row < footprint.row1);

  // The samples of every cell that is not plain, and how far each cut of it would stand off them.
  const sampleBase = new Int32Array(cells).fill(-1);
  let rough = 0;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      // Rough: the drawn ground is not the game's plane here, or the snow's bank beside the course crosses the cell.
      if (drawn(row, col) && (!relief.cellIsPlain(row, col) || snow?.nearCourse(row, col))) sampleBase[row * GRID + col] = rough++ * SIDE * SIDE;
    }
  }
  const samples = new Float32Array(rough * SIDE * SIDE);
  // A cell's smooth surface before rounding: its samples, the ring about them, and the rounding's reach beyond that.
  const REACH = ROUND.taps, WIDE = SIDE + 2 * REACH;
  const smoothed = new Float64Array(WIDE * WIDE), across = new Float64Array(WIDE * SIDE);
  // The smooth surface at every sample place in the world that is asked for, kept: neighbouring cells ask for the same
  // places, and so agree on them to the last bit. (Sample (i, j) is at 4 ft times i and j; the world wraps.)
  // (Kept in full precision: where a rough cell meets a plain one, the rounded surface must come out as the plain one's own plane exactly.)
  const ACROSS = GRID * FINE, known = new Float64Array(ACROSS * ACROSS).fill(NaN);
  // And the drawn ground there, as the mesh keeps it.
  const drawnAt = new Float32Array(ACROSS * ACROSS).fill(NaN);
  const smoothAt = (i, j) => {
    const at = (((j % ACROSS) + ACROSS) % ACROSS) * ACROSS + (((i % ACROSS) + ACROSS) % ACROSS);
    let value = known[at];
    if (value !== value) value = known[at] = relief.baseAt(i * SAMPLE_FT, j * SAMPLE_FT);
    return value;
  };
  const snowSamples = snow ? new Float32Array(rough * SNOW_SIDE * SNOW_SIDE) : null;
  const snowBase = (base) => (base / (SIDE * SIDE)) * SNOW_SIDE * SNOW_SIDE;
  const standoff = new Float32Array(cells * 3);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const cell = row * GRID + col, base = sampleBase[cell];
      if (base < 0) continue;
      // The smooth surface on the cell's samples and far enough about them to round it (game/terrain-relief.js `ROUND`,
      // whose spacing is the samples' own), rounded along x and then along z, as `heightAt` rounds it at a point.
      for (let j = 0; j < WIDE; j++) {
        for (let i = 0; i < WIDE; i++) smoothed[j * WIDE + i] = smoothAt(col * FINE + i - REACH - 1, row * FINE + j - REACH - 1);
      }
      for (let j = 0; j < WIDE; j++) {
        for (let i = 0; i < SIDE; i++) {
          let line = 0;
          for (let k = 0; k <= 2 * REACH; k++) line += ROUND.weights[k] * smoothed[j * WIDE + i + k];
          across[j * SIDE + i] = line;
        }
      }
      for (let j = 0; j < SIDE; j++) {
        for (let i = 0; i < SIDE; i++) {
          // A place the cell beside this one has already worked out is not worked out again.
          const li = col * FINE + i - 1, lj = row * FINE + j - 1;
          const at = (((lj % ACROSS) + ACROSS) % ACROSS) * ACROSS + (((li % ACROSS) + ACROSS) % ACROSS);
          let height = drawnAt[at];
          if (height !== height) {
            let sum = 0;
            for (let k = 0; k <= 2 * REACH; k++) sum += ROUND.weights[k] * across[(j + k) * SIDE + i];
            height = drawnAt[at] = relief.finish(li * SAMPLE_FT, lj * SAMPLE_FT, sum);
          }
          samples[base + j * SIDE + i] = height;
        }
      }
      const main = mtm2Sim.cellSplitsMainDiagonal(row, col);
      const bare = (i, j) => samples[base + (j + 1) * SIDE + i + 1];
      for (let n = 0; n < 3; n++) standoff[cell * 3 + n] = cutStandoff(bare, 1 << n, main);
      if (!snow) continue;
      // The snow on each sample, by the ground's slope there; a cut has to follow the snow's surface as well as the ground's.
      const lying = snowBase(base);
      for (let j = 0; j <= FINE; j++) {
        for (let i = 0; i <= FINE; i++) {
          const at = base + (j + 1) * SIDE + i + 1;
          const tilt = Math.hypot((samples[at + 1] - samples[at - 1]) / (2 * SAMPLE_FT), (samples[at + SIDE] - samples[at - SIDE]) / (2 * SAMPLE_FT));
          snowSamples[lying + j * SNOW_SIDE + i] = snow.depthAt(col * CELL_FT + i * SAMPLE_FT, row * CELL_FT + j * SAMPLE_FT, tilt);
        }
      }
      const covered = (i, j) => samples[base + (j + 1) * SIDE + i + 1] + snowSamples[lying + j * SNOW_SIDE + i];
      for (let n = 0; n < 3; n++) standoff[cell * 3 + n] = Math.max(standoff[cell * 3 + n], cutStandoff(covered, 1 << n, main));
    }
  }

  const seenFrom = viewDistances(courses);

  /**
   * A way of cutting the level: every rough cell as its samples ask at `tolerance` (times how far
   * off it is seen, over `VIEW_NEAR_FT`), none finer than `finest`. An edge is cut as finely as the finer of the two cells it lies between:
   * `alongX[row][col]` is the edge from corner (row, col) to (row, col + 1), `alongZ[row][col]`
   * the one to (row + 1, col). `vertices` is what the fine mesh would have.
   */
  function plan(tolerance, finest) {
    const level = new Uint8Array(cells).fill(1);
    for (let cell = 0; cell < cells; cell++) {
      if (sampleBase[cell] < 0) continue;
      const here = tolerance * seenFrom[cell];
      const wanted = standoff[cell * 3] <= here ? 1 : standoff[cell * 3 + 1] <= here ? 2 : standoff[cell * 3 + 2] <= here ? 4 : FINE;
      level[cell] = Math.min(wanted, finest);
    }
    const alongX = new Uint8Array(cells), alongZ = new Uint8Array(cells);
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const cell = row * GRID + col;
        alongX[cell] = Math.max(level[cell], level[((row - 1) & MASK) * GRID + col]);
        alongZ[cell] = Math.max(level[cell], level[row * GRID + ((col - 1) & MASK)]);
      }
    }
    let vertices = 0;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        if (!drawn(row, col)) continue;
        const cell = row * GRID + col;
        const eB = alongX[cell], eT = alongX[((row + 1) & MASK) * GRID + col], eL = alongZ[cell], eR = alongZ[row * GRID + ((col + 1) & MASK)];
        vertices += cellCounts(level[cell] === 1 && (eB | eR | eT | eL) > 1 ? 2 : level[cell], eB, eR, eT, eL)[0];
      }
    }
    return { level, alongX, alongZ, vertices, tolerance, finest };
  }
  // The tightest tolerance whose mesh fits the budget; a level too rough for the loosest is cut no finer than it can afford.
  const loosest = TOLERANCES_FT.at(-1);
  let chosen = null;
  for (const [tolerance, finest] of [...TOLERANCES_FT.map((t) => [t, FINE]), [loosest, 4], [loosest, 2], [loosest, 1]]) {
    chosen = plan(tolerance, finest);
    if (chosen.vertices <= vertexBudget) break;
  }
  const { level, alongX, alongZ, tolerance } = chosen;
  const cuts = { 1: 0, 2: 0, 4: 0, 8: 0 };
  for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) if (drawn(row, col)) cuts[level[row * GRID + col]]++;

  // The light, for the baked shade: the way to the sun in the game's frame.
  let sun = null;
  if (sunVector) {
    const length = Math.hypot(sunVector[0], sunVector[1], sunVector[2]) || 1;
    sun = [-sunVector[0] / length, -sunVector[1] / length, -sunVector[2] / length];
  }
  // A sun below the horizon reaches no ground: the ray toward it meets the ground (Community Patch 4's bake, CP4_EXE_ANALYSIS.md 15.8).
  const sunUp = !!sun && sun[1] > 0;
  const lit = (dx, dz) => AMBIENT_SHARE + (sunUp ? (1 - AMBIENT_SHARE) * Math.max(0, (-dx * sun[0] + sun[1] - dz * sun[2]) / Math.hypot(dx, 1, dz)) : 0);

  const tile = new Float32Array(8), cornerShade = new Float32Array(4), cornerLit = new Float32Array(4);
  // Two numbers written by every slope and read straight after. A plain array's elements box; these do not.
  const slope = new Float64Array(2);
  /** The drawn surface's slope at sample (i, j) of the cell at (row, col), into `slope`: from the samples, or asked for. */
  function slopeAt(base, row, col, i, j) {
    if (base >= 0) {
      const at = base + (j + 1) * SIDE + i + 1;
      slope[0] = (samples[at + 1] - samples[at - 1]) / (2 * SAMPLE_FT);
      slope[1] = (samples[at + SIDE] - samples[at - SIDE]) / (2 * SAMPLE_FT);
    } else {
      const x = col * CELL_FT + i * SAMPLE_FT, z = row * CELL_FT + j * SAMPLE_FT;
      slope[0] = (relief.heightAt(x + SAMPLE_FT, z) - relief.heightAt(x - SAMPLE_FT, z)) / (2 * SAMPLE_FT);
      slope[1] = (relief.heightAt(x, z + SAMPLE_FT) - relief.heightAt(x, z - SAMPLE_FT)) / (2 * SAMPLE_FT);
    }
  }

  /** One level of detail: `edgeX` and `edgeZ` give each edge's cut, `inside` each cell's. */
  function build(inside, edgeX, edgeZ) {
    let vertexTotal = 0, triangleTotal = 0;
    const shape = (row, col) => {
      const cell = row * GRID + col;
      const eB = edgeX(row, col), eT = edgeX((row + 1) & MASK, col), eL = edgeZ(row, col), eR = edgeZ(row, (col + 1) & MASK);
      let inner = inside(cell);
      if (inner === 1 && (eB | eR | eT | eL) > 1) inner = 2;
      return [inner, eB, eR, eT, eL];
    };
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        if (!drawn(row, col)) continue;
        const [v, t] = cellCounts(...shape(row, col));
        vertexTotal += v; triangleTotal += t;
      }
    }
    const positions = new Float32Array(vertexTotal * 3), normals = new Int8Array(vertexTotal * 3);
    const uvs = new Float32Array(vertexTotal * 2), colors = new Uint8Array(vertexTotal * 3);
    const lying = snow ? new Uint8Array(vertexTotal) : null;
    const indices = new Uint32Array(triangleTotal * 3);
    const chunks = [];
    // The cell being cut, and how far the build has got. `put` and `tri` close over them, once a vertex: a `let`
    // there boxes every store, and a cell's cut does that for every point. Slots: row, col, base, vertex, index.
    const iv = new Int32Array(5);
    const fv = new Float64Array(2); // the chunk's lowest and highest vertex
    iv[2] = -1;
    fv[0] = Infinity;
    fv[1] = -Infinity;
    /** The vertex at sample (i, j) of the cell, 0 to 8 each way. */
    const put = (i, j) => {
      const row = iv[0], col = iv[1], base = iv[2], vertex = iv[3];
      const x = col * CELL_FT + i * SAMPLE_FT, z = row * CELL_FT + j * SAMPLE_FT;
      const y = base >= 0 ? samples[base + (j + 1) * SIDE + i + 1] : relief.heightAt(x, z);
      positions[vertex * 3] = x; positions[vertex * 3 + 1] = y; positions[vertex * 3 + 2] = -z;
      if (y < fv[0]) fv[0] = y;
      if (y > fv[1]) fv[1] = y;
      slopeAt(base, row, col, i, j);
      const dx = slope[0], dz = slope[1], length = Math.hypot(dx, 1, dz);
      // Game-frame normal (-dx, 1, -dz); the scene mirrors z.
      normals[vertex * 3] = Math.round((-dx / length) * 127);
      normals[vertex * 3 + 1] = Math.round((1 / length) * 127);
      normals[vertex * 3 + 2] = Math.round((dz / length) * 127);
      const u = i / FINE, v = j / FINE, un = 1 - u, vn = 1 - v;
      const w0 = un * vn, w1 = u * vn, w2 = u * v, w3 = un * v;
      uvs[vertex * 2] = w0 * tile[0] + w1 * tile[2] + w2 * tile[4] + w3 * tile[6];
      uvs[vertex * 2 + 1] = w0 * tile[1] + w1 * tile[3] + w2 * tile[5] + w3 * tile[7];
      let shade = w0 * cornerShade[0] + w1 * cornerShade[1] + w2 * cornerShade[2] + w3 * cornerShade[3];
      if (sun) {
        // The baked shade is the corners'; between them it follows how the relief faces the sun.
        const flat = w0 * cornerLit[0] + w1 * cornerLit[1] + w2 * cornerLit[2] + w3 * cornerLit[3];
        shade *= Math.min(1.6, Math.max(0.5, lit(dx, dz) / flat));
      }
      const byte = Math.max(0, Math.min(255, Math.round(shade)));
      colors[vertex * 3] = colors[vertex * 3 + 1] = colors[vertex * 3 + 2] = byte;
      // The settled snow here: from the cell's samples, or asked for (in single precision either way, so cells agree).
      if (lying) lying[vertex] = Math.min(255, Math.round((Math.fround(base >= 0 ? snowSamples[snowBase(base) + j * SNOW_SIDE + i] : snow.depthAt(x, z)) / SNOW_DEPTH_SCALE_FT) * 255));
      iv[3] = vertex + 1;
      return vertex;
    };
    const tri = (a, b, c) => {
      const index = iv[4];
      indices[index] = a; indices[index + 1] = b; indices[index + 2] = c;
      iv[4] = index + 3;
    };
    const height = (v) => positions[v * 3 + 1];

    for (let chunkRow = 0; chunkRow < GRID / CHUNK_CELLS; chunkRow++) {
      for (let chunkCol = 0; chunkCol < GRID / CHUNK_CELLS; chunkCol++) {
        const start = iv[4];
        fv[0] = Infinity; fv[1] = -Infinity;
        for (let row = chunkRow * CHUNK_CELLS; row < (chunkRow + 1) * CHUNK_CELLS; row++) {
          for (let col = chunkCol * CHUNK_CELLS; col < (chunkCol + 1) * CHUNK_CELLS; col++) {
            if (!drawn(row, col)) continue;
            const cell = row * GRID + col;
            const base = sampleBase[cell];
            iv[0] = row; iv[1] = col; iv[2] = base;
            const [inner, eB, eR, eT, eL] = shape(row, col);
            cellTileUvs(clr[cell], atlas, tile, tileInset);
            // Corners in the tile's order: (row, col), (row, col + 1), (row + 1, col + 1), (row + 1, col).
            for (let k = 0; k < 4; k++) {
              const r = (row + (k >> 1)) & MASK, c = (col + ((k === 1 || k === 2) ? 1 : 0)) & MASK;
              cornerShade[k] = hasLte ? lte[(r * GRID + c) * LTE_BYTES_PER_POINT] : 255;
              if (sun) {
                slopeAt(base, row, col, k === 1 || k === 2 ? FINE : 0, k >> 1 ? FINE : 0);
                cornerLit[k] = lit(slope[0], slope[1]);
              }
            }
            if (inner === 1) {
              const v0 = put(0, 0), v1 = put(FINE, 0), v2 = put(FINE, FINE), v3 = put(0, FINE);
              // The game's own two triangles.
              if (mtm2Sim.cellSplitsMainDiagonal(row, col)) { tri(v0, v1, v2); tri(v0, v2, v3); } else { tri(v0, v1, v3); tri(v1, v2, v3); }
              continue;
            }
            // The lattice inside, `n` points a side.
            const n = inner - 1, step = FINE / inner, first = iv[3];
            for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) put(i * step, j * step);
            const at = (i, j) => first + (j - 1) * n + (i - 1);
            for (let j = 1; j < n; j++) {
              for (let i = 1; i < n; i++) {
                const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
                // Split along the diagonal whose ends are nearer in height: the flatter fold.
                if (Math.abs(height(a) - height(c)) <= Math.abs(height(b) - height(d))) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
              }
            }
            // Around it, each side's strip: the edge's points on the outside, the lattice's rim on the inside,
            // walked together anticlockwise so every triangle faces up.
            const c00 = put(0, 0), c10 = put(FINE, 0), c11 = put(FINE, FINE), c01 = put(0, FINE);
            const strip = (e, from, to, edgePoint, rim) => {
              let a = 0, b = 0, outer = from;
              while (a < e || b < n - 1) {
                // The outside steps when the inside is used up, or when its next point is not ahead of the inside's next.
                if (a < e && (b === n - 1 || (a + 1) * inner <= (b + 2) * e)) {
                  const next = a + 1 === e ? to : edgePoint((a + 1) * (FINE / e));
                  tri(outer, next, rim(b));
                  outer = next; a++;
                } else {
                  tri(outer, rim(b + 1), rim(b));
                  b++;
                }
              }
            };
            strip(eB, c00, c10, (s) => put(s, 0), (m) => at(m + 1, 1));
            strip(eR, c10, c11, (s) => put(FINE, s), (m) => at(n, m + 1));
            strip(eT, c11, c01, (s) => put(FINE - s, FINE), (m) => at(n - m, n));
            strip(eL, c01, c00, (s) => put(0, FINE - s), (m) => at(1, n - m));
          }
        }
        if (iv[4] > start) chunks.push({ row: chunkRow, col: chunkCol, start, count: iv[4] - start, low: fv[0], high: fv[1] });
      }
    }
    return { positions, normals, uvs, colors, indices, chunks, ...(lying ? { snow: lying } : {}) };
  }

  const fine = build((cell) => level[cell], (row, col) => alongX[row * GRID + col], (row, col) => alongZ[row * GRID + col]);
  const coarse = build(() => 1,
    (row, col) => (row % CHUNK_CELLS === 0 ? alongX[row * GRID + col] : 1),
    (row, col) => (col % CHUNK_CELLS === 0 ? alongZ[row * GRID + col] : 1));
  /**
   * The drawn ground at game (x, z) from the samples already taken, where the point is one of them: for whoever
   * samples the ground on the same spacing (the ground map, game/ground-maps.js) and need not work it out again.
   */
  const heightAtSample = (x, z) => {
    const col = Math.floor(x / CELL_FT), row = Math.floor(z / CELL_FT);
    const base = col >= 0 && col < GRID && row >= 0 && row < GRID ? sampleBase[row * GRID + col] : -1;
    const i = (x - col * CELL_FT) / SAMPLE_FT, j = (z - row * CELL_FT) / SAMPLE_FT;
    if (base < 0 || i !== Math.round(i) || j !== Math.round(j)) return relief.heightAt(x, z);
    return samples[base + (j + 1) * SIDE + i + 1];
  };
  return { fine, coarse, hasLte, toleranceFt: tolerance, cuts, heightAtSample };
}

/** Along the course, a point every so many feet for `viewDistances`: a cell's distance is good to half of it. */
const VIEW_STEP_FT = 48;

/**
 * How far off each cell is seen, over `VIEW_NEAR_FT`: its middle's distance from the nearest
 * point of any of `courses` (each a list of straights, `{ startFt, endFt }` in game feet), the
 * shorter way round the wrapped world, and at least 1. With no course every cell is 1.
 */
export function viewDistances(courses) {
  const cells = GRID * GRID, out = new Float32Array(cells).fill(1);
  const xs = [], zs = [];
  for (const segments of courses ?? []) {
    for (const { startFt: [x0, , z0], endFt: [x1, , z1] } of segments ?? []) {
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / VIEW_STEP_FT));
      for (let i = 0; i <= steps; i++) { xs.push(x0 + ((x1 - x0) * i) / steps); zs.push(z0 + ((z1 - z0) * i) / steps); }
    }
  }
  if (!xs.length) return out;
  const world = GRID * CELL_FT, near2 = VIEW_NEAR_FT * VIEW_NEAR_FT;
  const across = (a, b) => { const d = Math.abs(a - b) % world; return d > world / 2 ? world - d : d; };
  for (let row = 0; row < GRID; row++) {
    const z = (row + 0.5) * CELL_FT;
    const dz = zs.map((pz) => across(z, pz) ** 2);
    for (let col = 0; col < GRID; col++) {
      const x = (col + 0.5) * CELL_FT;
      let nearest = Infinity;
      for (let p = 0; p < xs.length; p++) {
        const d2 = dz[p];
        if (d2 >= nearest) continue;
        const dx = across(x, xs[p]), both = d2 + dx * dx;
        if (both < nearest) nearest = both;
      }
      out[row * GRID + col] = nearest <= near2 ? 1 : Math.sqrt(nearest) / VIEW_NEAR_FT;
    }
  }
  return out;
}

/**
 * How far a cut of a cell's side in `parts` stands off its samples at the worst, feet: `sample(i, j)`
 * is the surface at the cell's sample (i, j), 0 to 8 each way. One part is the game's two
 * triangles through the cell's corners; more are taken as flat between their own points.
 */
function cutStandoff(sample, parts, main) {
  const step = FINE / parts;
  let worst = 0;
  for (let j = 0; j <= FINE; j++) {
    const j0 = Math.min(parts - 1, Math.floor(j / step)) * step, v = (j - j0) / step;
    for (let i = 0; i <= FINE; i++) {
      const i0 = Math.min(parts - 1, Math.floor(i / step)) * step, u = (i - i0) / step;
      const h00 = sample(i0, j0), h01 = sample(i0 + step, j0), h10 = sample(i0, j0 + step), h11 = sample(i0 + step, j0 + step);
      const flat = parts === 1
        ? (main
          ? (v < u ? h00 + (h01 - h00) * u + (h11 - h01) * v : h00 + (h11 - h10) * u + (h10 - h00) * v)
          : (v < 1 - u ? h01 + (h00 - h01) * (1 - u) + (h10 - h00) * v : h01 + (h10 - h11) * (1 - u) + (h11 - h01) * v))
        : h00 * (1 - u) * (1 - v) + h01 * u * (1 - v) + h10 * (1 - u) * v + h11 * u * v;
      const off = Math.abs(flat - sample(i, j));
      if (off > worst) worst = off;
    }
  }
  return worst;
}
