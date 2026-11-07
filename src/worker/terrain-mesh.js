/*
  The terrain as a GPU-ready mesh, in scene coordinates (feet; see shared/scene-frame.js).

  It is the same surface the simulation stands on (OpenPhotex mtm2Sim.terrainHeightAt):
  256 x 256 cells of 32 ft, rows along z, corner (row, col) at RAW[row * 256 + col] * 2 ft,
  each cell split along (r, c)-(r+1, c+1) when row + col is even and along the other diagonal
  when odd, and the far row and column joining the first (the world wraps at 8192 ft).

  Each cell has its own four vertices so it can carry its own texture tile. The tile comes
  from the cell's .CLR word: bits 0-11 the texture slot, 12-13 mirror, 14-15 quarter turns.
  `footprint`, when given, limits the drawn cells to a stadium's footprint (MONSTER.EXE 0x4f9ff0).
  Shading comes from the .LTE, whose first byte per grid point is the baked ground brightness
  (classic look); smooth normals are provided for the lit look.

  Pure; the result is plain typed arrays, ready to transfer to the main thread.
*/
import { decodeRawTexture, rawTextureSide } from "../vendor/openphotex/texture/raw.js";
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";

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
 * clamped 2-pixel skirt so linear filtering never reads a neighbour. Every slot is as wide as the
 * widest tile: a smaller tile is scaled up to it, texel by texel, or with `smooth` (the smooth
 * textures of the enhanced look) blended between its texels, as linear filtering would draw it at
 * its own size. A level that mixes 64 and 256 texel tiles otherwise shows its 64s in blocks.
 */
export function buildTerrainAtlas(decoded, forcedSide = 0, { smooth = false } = {}) {
  // `forcedSide` lays a second atlas (the tiles' normal maps) out exactly as the first.
  let side = forcedSide || 64;
  if (!forcedSide) for (const image of decoded) if (image && image.width > side) side = image.width;
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
  // Atlas texels to one of the tile's legacy pixels: a slot is `side` wide whatever its tile, so a 64 px tile in an
  // atlas of 256 px slots spans four texels a pixel. An HD tile counts the legacy tile it replaces (`legacyWidth`).
  const texelsPerPixel = [];
  for (let s = 0; s < slots; s++) {
    const image = decoded[s] ?? null;
    const ox = (s % cols) * tile, oy = Math.floor(s / cols) * tile;
    rects.push([ox + ATLAS_PADDING, oy + ATLAS_PADDING, side, side]);
    texelsPerPixel.push(image ? side / (image.legacyWidth || image.width || side) : 1);
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const sx = Math.max(0, Math.min(side - 1, x - ATLAS_PADDING));
        const sy = Math.max(0, Math.min(side - 1, y - ATLAS_PADDING));
        const d = ((oy + y) * width + ox + x) * 4;
        if (image && smooth && image.width < side) {
          sampleBilinear(image, ((sx + 0.5) * image.width) / side - 0.5, ((sy + 0.5) * image.height) / side - 0.5, rgba, d);
        } else if (image) {
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
  return { rgba, width, height, rects, texelsPerPixel, tileSide: side, padding: ATLAS_PADDING };
}

/**
 * Which stack each tile goes in (render/ground-detail.js): one stack for each tile width, so a 1024 px building front
 * and a 64 px patch of grass each keep their own size. A tile's width is its own, rounded down to a power of two and
 * at most `maxSide`; a missing tile goes with the narrowest. While all of them would take more than `budgetBytes`
 * (before mipmaps) the widest are halved; while there are more than `maxStacks` widths the narrowest go up to the next.
 * `{ sides, slotSide }`: the stacks' sides, narrowest first, and each slot's. null when nothing is wider than
 * `minSide`: the stack is then copied from the atlas, as before.
 */
export function planTileStacks(images, { minSide = 0, maxSide = 1024, budgetBytes = 512 * 1024 * 1024, maxStacks = 4 } = {}) {
  let widest = 0;
  for (const image of images) if (image && image.width > widest) widest = image.width;
  if (Math.min(maxSide, widest) <= minSide || !images.length) return null;
  const own = images.map((image) => (image ? Math.min(maxSide, 2 ** Math.floor(Math.log2(Math.max(1, image.width)))) : 0));
  const narrowest = Math.min(...own.filter((side) => side > 0));
  const slotSide = own.map((side) => side || narrowest);
  const bytes = () => slotSide.reduce((sum, side) => sum + side * side * 4, 0);
  while (bytes() > budgetBytes) {
    const top = Math.max(...slotSide);
    if (top <= 1) break;
    slotSide.forEach((side, slot) => { if (side === top) slotSide[slot] = top >> 1; });
  }
  let sides = [...new Set(slotSide)].sort((a, b) => a - b);
  while (sides.length > maxStacks) {
    const [low, next] = sides;
    slotSide.forEach((side, slot) => { if (side === low) slotSide[slot] = next; });
    sides = sides.slice(1);
  }
  return { sides, slotSide };
}

/**
 * The texture slots a level draws: those its .CLR cells name and those its ground boxes' faces name (`boxSlots`). A slot
 * named by neither (a picture kept in the list for later, or for a track's other version) needs no room in the stacks.
 */
export function slotsInUse(clr, boxSlots = []) {
  const used = new Set(boxSlots);
  for (let i = 0; i < clr.length; i++) used.add(clr[i] & 0x0fff);
  return used;
}

/**
 * The tiles as stacks at their own size (`planTileStacks`): `{ stacks, place }`, each stack `{ data, side, slots }`
 * (buildTileStack) and `place` four bytes a slot: its stack, then its layer there, low byte first. null as the plan is.
 */
export function buildTileStacks(images, { smooth = false, ...limits } = {}) {
  const plan = planTileStacks(images, limits);
  if (!plan) return null;
  const place = new Uint8Array(images.length * 4);
  const stacks = plan.sides.map((side, index) => {
    const members = [];
    plan.slotSide.forEach((s, slot) => { if (s === side) members.push(slot); });
    members.forEach((slot, layer) => place.set([index, layer & 255, layer >> 8, 0], slot * 4));
    return buildTileStack(members.map((slot) => images[slot] ?? null), side, { smooth });
  });
  return { stacks, place };
}

/** How much the ground's tile stacks may take before mipmaps (worker/track-build.js, render/ground-detail.js). */
export const TILE_STACK_BUDGET = 512 * 1024 * 1024;

/**
 * The stacks (`buildTileStacks`) with two neighbouring widths made one, for a graphics card that cannot give the ground's
 * shader a texture for each stack (render/ground-detail.js). The pair that grows the least is joined at the wider side,
 * its narrower tiles scaled up, while all of them stay within `budgetBytes`; past that the two widest are joined, at the
 * widest side between theirs that keeps within it. `{ stacks, place }` as buildTileStacks gives them; null with fewer than two stacks.
 */
export function mergeTileStacks({ stacks, place }, { smooth = false, budgetBytes = TILE_STACK_BUDGET } = {}) {
  if (!stacks || stacks.length < 2) return null;
  const bytes = stacks.reduce((sum, s) => sum + s.side * s.side * 4 * s.slots, 0);
  let pick = 0, growth = Infinity;
  for (let i = 0; i + 1 < stacks.length; i++) {
    const grow = stacks[i].slots * (stacks[i + 1].side ** 2 - stacks[i].side ** 2) * 4;
    if (grow < growth) { growth = grow; pick = i; }
  }
  if (bytes + growth > budgetBytes) pick = stacks.length - 2;
  const low = stacks[pick], high = stacks[pick + 1];
  // The widest side between the two that keeps all of them within the budget.
  const others = bytes - (low.side ** 2 * low.slots + high.side ** 2 * high.slots) * 4;
  let side = high.side;
  while (side > low.side && others + side * side * 4 * (low.slots + high.slots) > budgetBytes) side >>= 1;
  const layersOf = (s) => Array.from({ length: s.slots }, (_, l) => ({
    width: s.side, height: s.side, rgba: s.data.subarray(l * s.side * s.side * 4, (l + 1) * s.side * s.side * 4),
  }));
  const joined = buildTileStack([...layersOf(low), ...layersOf(high)], side, { smooth });
  const moved = new Uint8Array(place.length);
  for (let at = 0; at < place.length; at += 4) {
    const stack = place[at], layer = place[at + 1] | (place[at + 2] << 8);
    const [s, l] = stack < pick ? [stack, layer] : stack === pick ? [pick, layer] : stack === pick + 1 ? [pick, layer + low.slots] : [stack - 1, layer];
    moved.set([s, l & 255, l >> 8, 0], at);
  }
  return { stacks: [...stacks.slice(0, pick), joined, ...stacks.slice(pick + 2)], place: moved };
}

/**
 * One stack with its layers moved so that slot n is layer n, as its table (`place`) says where each is now; the stack
 * itself where they already are. Every slot has a layer of its own (`buildTileStacks`); render/ground-detail.js reads one stack without the table.
 */
export function inSlotOrder(stack, place) {
  const slots = place.length / 4, size = stack.side * stack.side * 4;
  let ordered = slots === stack.slots;
  for (let slot = 0; ordered && slot < slots; slot++) ordered = (place[slot * 4 + 1] | (place[slot * 4 + 2] << 8)) === slot;
  if (ordered) return stack;
  const data = new Uint8Array(size * slots);
  for (let slot = 0; slot < slots; slot++) {
    const layer = place[slot * 4 + 1] | (place[slot * 4 + 2] << 8);
    data.set(stack.data.subarray(layer * size, (layer + 1) * size), slot * size);
  }
  return { data, side: stack.side, slots };
}

/**
 * The tiles as a stack at `side` texels a layer, one layer a slot, from the images at their own size: an HD tile keeps
 * its detail rather than the atlas's copy of it. A wider image is box-filtered down, a narrower one scaled up in
 * blocks or, with `smooth`, blended; a missing slot is the atlas's grey checker. `{ data, side, slots }`.
 */
export function buildTileStack(images, side, { smooth = false } = {}) {
  const slots = Math.max(1, images.length);
  const data = new Uint8Array(side * side * 4 * slots);
  for (let s = 0; s < slots; s++) {
    const image = images[s] ?? null;
    const base = s * side * side * 4;
    if (!image) {
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const d = base + (y * side + x) * 4, v = ((x >> 3) ^ (y >> 3)) & 1 ? 150 : 100;
        data[d] = data[d + 1] = data[d + 2] = v; data[d + 3] = 255;
      }
      continue;
    }
    const step = image.width / side;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const d = base + (y * side + x) * 4;
      if (step > 1) {
        // Box filter: the mean of the image texels under this one.
        const n = Math.max(1, Math.round(step)), x0 = Math.floor(x * step), y0 = Math.floor(y * step);
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const o = (Math.min(image.height - 1, y0 + j) * image.width + Math.min(image.width - 1, x0 + i)) * 4;
          r += image.rgba[o]; g += image.rgba[o + 1]; b += image.rgba[o + 2];
        }
        data[d] = r / (n * n); data[d + 1] = g / (n * n); data[d + 2] = b / (n * n);
      } else if (smooth && step < 1) {
        sampleBilinear(image, (x + 0.5) * step - 0.5, (y + 0.5) * step - 0.5, data, d);
      } else {
        const o = (Math.min(image.height - 1, Math.floor(y * step)) * image.width + Math.min(image.width - 1, Math.floor(x * step))) * 4;
        data[d] = image.rgba[o]; data[d + 1] = image.rgba[o + 1]; data[d + 2] = image.rgba[o + 2];
      }
      data[d + 3] = 255;
    }
  }
  return { data, side, slots };
}

/** An image's colour at texel coordinates (x, y), blended from the four texels about it, clamped at its edges, into `out` at `at`. */
function sampleBilinear(image, x, y, out, at) {
  const { width, height, rgba } = image;
  const cx = Math.max(0, Math.min(width - 1, x)), cy = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  for (let c = 0; c < 3; c++) {
    const top = rgba[(y0 * width + x0) * 4 + c] * (1 - fx) + rgba[(y0 * width + x1) * 4 + c] * fx;
    const bottom = rgba[(y1 * width + x0) * 4 + c] * (1 - fx) + rgba[(y1 * width + x1) * 4 + c] * fx;
    out[at + c] = Math.round(top * (1 - fy) + bottom * fy);
  }
}

/**
 * How many atlas texels a tile in `slot` is cropped by at each edge for an overlap of `tileInset` legacy pixels,
 * kept under half the tile.
 */
export function tileCropTexels(atlas, slot, tileInset = 2) {
  const [, , rw, rh] = atlas.rects[slot];
  const scale = atlas.texelsPerPixel?.[slot] ?? 1;
  return Math.min(tileInset * scale, Math.max(0, (Math.min(rw, rh) - 1) / 2));
}

/**
 * A cell's texture coordinates from its .CLR word: u, v for its four corners v0..v3, that is
 * (row, col), (row, col + 1), (row + 1, col + 1), (row + 1, col), into `out`. The tile is turned
 * and mirrored as the word says (corner order as JSTrackViewer and JTraxx map it).
 */
export function cellTileUvs(word, atlas, out, tileInset = 2) {
  const slot = Math.min(word & 0x0fff, atlas.rects.length - 1);
  const mirror = (word >> 12) & 3, rot = (word >> 14) & 3;
  const [rx, ry, rw, rh] = atlas.rects[slot];
  // MTM2 overlaps neighbouring terrain tiles by cropping two legacy pixels at each edge: two of the tile's own
  // pixels, however many atlas texels that is (a track that mixes 64 and 256 px tiles scales the small ones up).
  // The atlas skirt outside this rectangle remains available to linear filtering.
  // (`tileInset`: 4x4 Evolution cuts its tiles from one painted map with no border ring, and crops nothing.)
  const inset = tileCropTexels(atlas, slot, tileInset);
  const u0 = (rx + inset) / atlas.width, u1 = (rx + rw - inset) / atlas.width;
  const t0 = (ry + inset) / atlas.height, t1 = (ry + rh - inset) / atlas.height;
  for (let k = 0; k < 4; k++) {
    let corner = k;
    if (mirror & 1) corner = (3 - corner) & 3;
    if (mirror & 2) corner = (1 - corner) & 3;
    corner = (rot + corner) & 3;
    out[k * 2] = corner === 0 || corner === 3 ? u0 : u1;
    out[k * 2 + 1] = corner < 2 ? t1 : t0;
  }
  return out;
}

/**
 * The terrain mesh. `heights` is the level .RAW, `clr` its 16-bit colour grid, `lte` the
 * lighting map or null, `atlas` from buildTerrainAtlas.
 */
export function buildTerrainMesh({ heights, heightsFt = null, clr, lte, atlas, footprint = null, tileInset = 2 }) {
  const cells = GRID * GRID;
  const positions = new Float32Array(cells * 4 * 3);
  const normals = new Float32Array(cells * 4 * 3);
  const uvs = new Float32Array(cells * 4 * 2);
  const shade = new Float32Array(cells * 4);
  const indices = new Uint32Array(cells * 6);
  const hasLte = lte && lte.length >= cells * LTE_BYTES_PER_POINT;

  // `heightsFt` (corner heights in feet) stands in for the byte heightfield on levels that are finer than 2 ft steps.
  const h = heightsFt
    ? (row, col) => heightsFt[(row & 255) * GRID + (col & 255)]
    : (row, col) => heights[(row & 255) * GRID + (col & 255)] * STEP_FT;
  // Smooth normal at a grid corner, by central differences, in scene axes (z mirrored).
  const cornerNormal = (row, col, out, o) => {
    const dx = (h(row, col + 1) - h(row, col - 1)) / (2 * CELL_FT);
    const dz = (h(row + 1, col) - h(row - 1, col)) / (2 * CELL_FT);
    // Game-frame normal (-dx, 1, -dz); scene mirrors z.
    const len = Math.hypot(dx, 1, dz);
    out[o] = -dx / len; out[o + 1] = 1 / len; out[o + 2] = dz / len;
  };
  const corners = [[0, 0], [0, 1], [1, 1], [1, 0]]; // (dRow, dCol): v0..v3
  const tile = new Float32Array(8);

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

      cellTileUvs(clr[cell], atlas, tile, tileInset);
      for (let k = 0; k < 4; k++) {
        uvs[(v + k) * 2] = tile[k * 2];
        uvs[(v + k) * 2 + 1] = tile[k * 2 + 1];
      }

      const i = cell * 6;
      const f = footprint;
      if (f && (col < f.col0 || col >= f.col1 || row < f.row0 || row >= f.row1)) {
        // Outside a stadium's footprint: the vertices stay, the triangles collapse.
        indices.fill(v, i, i + 6);
        continue;
      }
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

/**
 * The terrain mesh over a fine grid (4x4 Evolution 2's smoothed ground, docs/EVO2_EXE_ANALYSIS.md 5a): `fineFt` has
 * `sub` heights a cell side, rows along z, as `mtm2Sim.createTerrainFt`'s fine grid. Each 32 ft cell is `sub` x `sub`
 * sub-cells of two triangles each, split by the sub-cell's parity as the game splits them, its tile stretched over the
 * cell as on the coarse mesh. Normals by central differences over the fine grid. The same shape of result as
 * `buildTerrainMesh`.
 */
export function buildFineTerrainMesh({ fineFt, sub = 4, clr, atlas, tileInset = 2 }) {
  const side = GRID * sub, mask = side - 1, step = CELL_FT / sub, n = sub + 1;
  const perCell = n * n, cells = GRID * GRID;
  const positions = new Float32Array(cells * perCell * 3);
  const normals = new Float32Array(cells * perCell * 3);
  const uvs = new Float32Array(cells * perCell * 2);
  const shade = new Float32Array(cells * perCell).fill(1);
  const indices = new Uint32Array(cells * sub * sub * 6);
  const h = (r, c) => fineFt[(r & mask) * side + (c & mask)];
  const tile = new Float32Array(8);
  let ii = 0;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const cell = row * GRID + col, base = cell * perCell;
      // The tile's corners v0..v3 at (row, col), (row, col + 1), (row + 1, col + 1), (row + 1, col), stretched bilinearly.
      cellTileUvs(clr[cell], atlas, tile, tileInset);
      for (let j = 0; j <= sub; j++) {
        for (let i = 0; i <= sub; i++) {
          const v = base + j * n + i, r = row * sub + j, c = col * sub + i, a = i / sub, b = j / sub;
          positions[v * 3] = c * step;
          positions[v * 3 + 1] = h(r, c);
          positions[v * 3 + 2] = -(r * step);
          const dx = (h(r, c + 1) - h(r, c - 1)) / (2 * step), dz = (h(r + 1, c) - h(r - 1, c)) / (2 * step);
          const len = Math.hypot(dx, 1, dz);
          normals[v * 3] = -dx / len; normals[v * 3 + 1] = 1 / len; normals[v * 3 + 2] = dz / len;
          for (let k = 0; k < 2; k++) {
            const top = tile[k] * (1 - a) + tile[2 + k] * a, bottom = tile[6 + k] * (1 - a) + tile[4 + k] * a;
            uvs[v * 2 + k] = top * (1 - b) + bottom * b;
          }
        }
      }
      for (let j = 0; j < sub; j++) {
        for (let i = 0; i < sub; i++) {
          const v00 = base + j * n + i, v01 = v00 + 1, v10 = v00 + n, v11 = v10 + 1;
          if ((((row * sub + j) ^ (col * sub + i)) & 1) === 0) {
            indices[ii++] = v00; indices[ii++] = v01; indices[ii++] = v11;
            indices[ii++] = v00; indices[ii++] = v11; indices[ii++] = v10;
          } else {
            indices[ii++] = v00; indices[ii++] = v01; indices[ii++] = v10;
            indices[ii++] = v01; indices[ii++] = v11; indices[ii++] = v10;
          }
        }
      }
    }
  }
  return {
    positions, normals, uvs, shade, indices, hasLte: false, indicesPerCell: sub * sub * 6,
    // The levels drawn further off (render/track-scene.js): a sub-cell of 2 x 2 in the middle distance, the cell far off.
    levels: sub % 2 === 0 ? { mid: fineTerrainLevel({ sub, step: sub / 2 }), coarse: fineTerrainLevel({ sub, step: sub }) } : null,
  };
}

/** A chunk's side in cells, as render/track-scene.js draws the terrain. */
const CHUNK_CELLS = 64;

/**
 * A level of detail of `buildFineTerrainMesh`'s ground, in that mesh's own vertices, by chunks of `chunkCells` cells a
 * side, in the order render/track-scene.js draws them (rows of chunks along z, then along x). Inside a chunk a cell is
 * cut in `sub / step` parts a side (`step` = `sub`: the cell's two triangles). The cells along the chunk's border keep
 * every point of the border, as the fine level has it, and are fanned from their centre point to it and to their inner
 * sides, which are cut as the inside is. Chunks at any two levels therefore meet point for point, without a crack.
 * `step` divides `sub`, which is even (a cell has a centre point).
 */
export function fineTerrainLevel({ sub, step, chunkCells = CHUNK_CELLS, grid = GRID }) {
  const n = sub + 1, perCell = n * n, parts = sub / step, centre = (sub / 2) * n + sub / 2;
  const chunksPerSide = grid / chunkCells;
  const border = 4 * (chunkCells - 1);
  // A border cell has at most two sides of `sub` points and two of `parts`, each giving a triangle per point.
  const perChunk = ((chunkCells * chunkCells - border) * parts * parts * 2 + border * (2 * sub + 2 * parts)) * 3;
  const indices = new Uint32Array(chunksPerSide * chunksPerSide * perChunk);
  const chunks = [];
  const loop = [];
  let ii = 0;
  for (let chunkRow = 0; chunkRow < chunksPerSide; chunkRow++) {
    for (let chunkCol = 0; chunkCol < chunksPerSide; chunkCol++) {
      const start = ii;
      for (let row = chunkRow * chunkCells; row < (chunkRow + 1) * chunkCells; row++) {
        for (let col = chunkCol * chunkCells; col < (chunkCol + 1) * chunkCells; col++) {
          const base = (row * grid + col) * perCell;
          const at = (j, i) => base + j * n + i;
          const r = row - chunkRow * chunkCells, c = col - chunkCol * chunkCells;
          const bottom = r === 0, top = r === chunkCells - 1, left = c === 0, right = c === chunkCells - 1;
          if (!(bottom || top || left || right)) {
            // Inside the chunk: a lattice of `parts` x `parts`, each split by its parity as the fine level splits it.
            for (let j = 0; j < sub; j += step) {
              for (let i = 0; i < sub; i += step) {
                const v00 = at(j, i), v01 = at(j, i + step), v10 = at(j + step, i), v11 = at(j + step, i + step);
                if (((((row * sub + j) / step) ^ ((col * sub + i) / step)) & 1) === 0) {
                  indices[ii++] = v00; indices[ii++] = v01; indices[ii++] = v11;
                  indices[ii++] = v00; indices[ii++] = v11; indices[ii++] = v10;
                } else {
                  indices[ii++] = v00; indices[ii++] = v01; indices[ii++] = v10;
                  indices[ii++] = v01; indices[ii++] = v11; indices[ii++] = v10;
                }
              }
            }
            continue;
          }
          // On the border: round the cell the way the fine level's triangles turn, every point on a side along the
          // chunk's edge and every `step` on the others, and a fan from the centre.
          loop.length = 0;
          for (let i = 0; i < sub; i += bottom ? 1 : step) loop.push(at(0, i));
          for (let j = 0; j < sub; j += right ? 1 : step) loop.push(at(j, sub));
          for (let i = sub; i > 0; i -= top ? 1 : step) loop.push(at(sub, i));
          for (let j = sub; j > 0; j -= left ? 1 : step) loop.push(at(j, 0));
          for (let k = 0; k < loop.length; k++) {
            indices[ii++] = base + centre; indices[ii++] = loop[k]; indices[ii++] = loop[(k + 1) % loop.length];
          }
        }
      }
      chunks.push({ row: chunkRow, col: chunkCol, start, count: ii - start });
    }
  }
  return { indices: indices.slice(0, ii), chunks };
}
