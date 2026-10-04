/*
  The terrain as a GPU-ready mesh, in scene coordinates (feet; see shared/scene-frame.js).

  It is the same surface the simulation stands on (OpenPhotex mtm2Sim.terrainHeightAt):
  256 x 256 cells of 32 ft, rows along z, corner (row, col) at RAW[row * 256 + col] * 2 ft,
  each cell split along (r, c)-(r+1, c+1) when row + col is even and along the other diagonal
  when odd, and the far row and column joining the first (the world wraps at 8192 ft).

  Each cell has its own four vertices so it can carry its own texture tile. The tile comes
  from the cell's .CLR word: bits 0-11 the texture slot, 12-13 mirror, 14-15 quarter turns.
  Shading comes from the .LTE, whose first byte per grid point is the baked ground brightness
  (classic look); smooth normals are provided for the lit look.

  Pure; the result is plain typed arrays, ready to transfer to the main thread.
*/
import { decodeRawTexture, mtm2Sim, rawTextureSide } from "../vendor/openphotex/index.js";

const GRID = 256;
const CELL_FT = 32;
const STEP_FT = 2;
const LTE_BYTES_PER_POINT = 7;
const ATLAS_PADDING = 2;
const MAX_ATLAS_SIDE = 8192;

/** Decode the texture sources (see level-load.js) once each; a missing slot stays null. */
export function decodeTerrainTextures(sources) {
  return sources.map((source) => {
    if (!source || !rawTextureSide(source.raw.length) || !source.palette) return null;
    try {
      return decodeRawTexture(source.raw, source.palette);
    } catch {
      return null;
    }
  });
}

/**
 * Pack one tile per texture slot, so a slot index maps straight to a tile. Tiles get a
 * clamped 2-pixel skirt so linear filtering never reads a neighbour.
 */
export function buildTerrainAtlas(decoded) {
  let side = 64;
  for (const image of decoded) if (image && image.width > side) side = image.width;
  const slots = Math.max(1, decoded.length);
  let tile = side + ATLAS_PADDING * 2;
  let cols = Math.max(1, Math.min(slots, Math.floor(MAX_ATLAS_SIDE / tile)));
  while (Math.ceil(slots / cols) * tile > MAX_ATLAS_SIDE && side > 16) {
    side >>= 1;
    tile = side + ATLAS_PADDING * 2;
    cols = Math.max(1, Math.min(slots, Math.floor(MAX_ATLAS_SIDE / tile)));
  }
  const rows = Math.ceil(slots / cols);
  const width = cols * tile, height = rows * tile;
  const rgba = new Uint8Array(width * height * 4);
  const rects = [];
  for (let s = 0; s < slots; s++) {
    const image = decoded[s] ?? null;
    const ox = (s % cols) * tile, oy = Math.floor(s / cols) * tile;
    rects.push([ox + ATLAS_PADDING, oy + ATLAS_PADDING, side, side]);
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const sx = Math.max(0, Math.min(side - 1, x - ATLAS_PADDING));
        const sy = Math.max(0, Math.min(side - 1, y - ATLAS_PADDING));
        const d = ((oy + y) * width + ox + x) * 4;
        if (image) {
          const ix = Math.min(image.width - 1, Math.floor(sx * image.width / side));
          const iy = Math.min(image.height - 1, Math.floor(sy * image.height / side));
          const o = (iy * image.width + ix) * 4;
          rgba[d] = image.rgba[o]; rgba[d + 1] = image.rgba[o + 1]; rgba[d + 2] = image.rgba[o + 2];
        } else {
          // A missing texture shows as a grey checker rather than as black.
          const v = ((x >> 3) ^ (y >> 3)) & 1 ? 150 : 100;
          rgba[d] = rgba[d + 1] = rgba[d + 2] = v;
        }
        rgba[d + 3] = 255;
      }
    }
  }
  return { rgba, width, height, rects, tileSide: side };
}

/**
 * The terrain mesh. `heights` is the level .RAW, `clr` its 16-bit colour grid, `lte` the
 * lighting map or null, `atlas` from buildTerrainAtlas.
 */
export function buildTerrainMesh({ heights, clr, lte, atlas }) {
  const cells = GRID * GRID;
  const positions = new Float32Array(cells * 4 * 3);
  const normals = new Float32Array(cells * 4 * 3);
  const uvs = new Float32Array(cells * 4 * 2);
  const shade = new Float32Array(cells * 4);
  const indices = new Uint32Array(cells * 6);
  const hasLte = lte && lte.length >= cells * LTE_BYTES_PER_POINT;

  const h = (row, col) => heights[(row & 255) * GRID + (col & 255)] * STEP_FT;
  // Smooth normal at a grid corner, by central differences, in scene axes (z mirrored).
  const cornerNormal = (row, col, out, o) => {
    const dx = (h(row, col + 1) - h(row, col - 1)) / (2 * CELL_FT);
    const dz = (h(row + 1, col) - h(row - 1, col)) / (2 * CELL_FT);
    // Game-frame normal (-dx, 1, -dz); scene mirrors z.
    const len = Math.hypot(dx, 1, dz);
    out[o] = -dx / len; out[o + 1] = 1 / len; out[o + 2] = dz / len;
  };
  const corners = [[0, 0], [0, 1], [1, 1], [1, 0]]; // (dRow, dCol): v0..v3

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const cell = row * GRID + col;
      const v = cell * 4;
      for (let k = 0; k < 4; k++) {
        const r = row + corners[k][0], c = col + corners[k][1];
        const p = (v + k) * 3;
        positions[p] = c * CELL_FT;
        positions[p + 1] = h(r, c);
        positions[p + 2] = -(r * CELL_FT);
        cornerNormal(r, c, normals, p);
        shade[v + k] = hasLte ? lte[((r & 255) * GRID + (c & 255)) * LTE_BYTES_PER_POINT] / 255 : 1;
      }

      // Texture tile, turned and mirrored (corner order as JSTrackViewer and JTraxx map it).
      const word = clr[cell];
      const slot = Math.min(word & 0x0fff, atlas.rects.length - 1);
      const mirror = (word >> 12) & 3, rot = (word >> 14) & 3;
      const [rx, ry, rw, rh] = atlas.rects[slot];
      const u0 = rx / atlas.width, u1 = (rx + rw) / atlas.width;
      const t0 = ry / atlas.height, t1 = (ry + rh) / atlas.height;
      const cu = [u0, u1, u1, u0], cv = [t1, t1, t0, t0];
      for (let k = 0; k < 4; k++) {
        let corner = k;
        if (mirror & 1) corner = (3 - corner) & 3;
        if (mirror & 2) corner = (1 - corner) & 3;
        corner = (rot + corner) & 3;
        uvs[(v + k) * 2] = cu[corner];
        uvs[(v + k) * 2 + 1] = cv[corner];
      }

      const i = cell * 6;
      if (mtm2Sim.cellSplitsMainDiagonal(row, col)) {
        indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
        indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
      } else {
        indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 3;
        indices[i + 3] = v + 1; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
      }
    }
  }
  return { positions, normals, uvs, shade, indices, hasLte: !!hasLte };
}
