/*
  Ground boxes (.RA0/.RA1/.CL0) as one mesh in scene coordinates (feet).

  Each box fills one 32 ft cell from its lower to its upper height (2 ft steps), with six faces
  textured from the terrain's texture slots by .CLR-style words. The simulation treats them as
  solid (MTM2_PHYSICS.md section 2.5).

  As the game draws them (MONSTER.EXE 0x4fcbe0): a side face is drawn only where the neighbouring
  cell's box does not cover it (box lower < neighbour lower, or neighbour upper < box upper), and
  from the terrain up where the box starts below the ground; the bottom face only where the box
  floats above the ground.

  Face order and corner mapping follow JSTrackViewer's ground-box builder (taken from Traxx),
  whose scene shares this one's orientation (rows run towards -z):
    .CL0 face 0 = south (+z in the scene, the lower row), 1 = north, 2 = east (+x), 3 = west,
    4 = top, 5 = bottom.
*/
import { decodeGroundBoxes } from "../vendor/openphotex/index.js";

const CELL_FT = 32;
const STEP_FT = 2;

// Scene faces in the order +X, -X, +Y, -Y, +Z, -Z, and the .CL0 face each one draws.
const FACE_TO_CL0 = [2, 3, 4, 5, 0, 1];
// Corner orders (TL, TR, BL, BR as seen from outside) to the tile's base corners.
const SIDE_CORNERS = [3, 2, 0, 1];
const FLAT_CORNERS = [0, 1, 3, 2];
const TOP_CORNERS = [3, 2, 0, 1];

function faceVertices(x0, x1, y0, y1, z0, z1) {
  return [
    [[x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0]],
    [[x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1]],
    [[x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y0, z1], [x1, y0, z1], [x0, y0, z0], [x1, y0, z0]],
    [[x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1]],
    [[x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0]],
  ];
}

const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * The game's ground boxes for a level, or null when it has none. `atlas` is the terrain's
 * (buildTerrainAtlas), whose tiles are the texture slots the faces name.
 */
export function buildGroundBoxMesh({ ra0, ra1, cl0 }, atlas, lte = null, heights = null, cells = null) {
  if (!ra0 || !ra1) return null;
  // Ground boxes are drawn with their terrain cell, so a stadium's footprint limits them too.
  const boxes = decodeGroundBoxes(ra0, ra1, cl0, 256).filter((b) => !cells
    || (b.x >= cells.col0 && b.x < cells.col1 && b.y >= cells.row0 && b.y < cells.row1));
  if (!boxes.length) return null;
  const quads = boxes.length * 6;
  const positions = new Float32Array(quads * 4 * 3);
  const normals = new Float32Array(quads * 4 * 3);
  const uvs = new Float32Array(quads * 4 * 2);
  const indices = new Uint32Array(quads * 6);
  // Baked brightness, from the .LTE's ground-box-upper byte (byte 2 of 7) at the cell's corner.
  const shade = new Float32Array(quads * 4).fill(1);
  const hasLte = !!lte && lte.length >= 256 * 256 * 7;
  let q = 0;
  const cell = (x, y) => ((y & 255) * 256 + (x & 255));
  const ground = (x, y) => (heights ? heights[cell(x, y)] * STEP_FT : -Infinity);
  // Side faces in scene order +X (east, col + 1), -X (west, col - 1), +Z (south, row - 1), -Z (north, row + 1).
  const NEIGHBOUR = { 0: [1, 0], 1: [-1, 0], 4: [0, -1], 5: [0, 1] };
  // The two grid corners along each side, for where the terrain meets it.
  const EDGE = { 0: [[1, 0], [1, 1]], 1: [[0, 0], [0, 1]], 4: [[0, 0], [1, 0]], 5: [[0, 1], [1, 1]] };
  for (const box of boxes) {
    const x0 = box.x * CELL_FT, x1 = x0 + CELL_FT;
    // Scene z of the cell's rows: row r sits at -r * 32.
    const z1 = -box.y * CELL_FT, z0 = z1 - CELL_FT;
    const y0 = box.lower * STEP_FT, y1 = Math.max(y0 + 0.01, box.upper * STEP_FT);
    const visible = (face) => {
      if (face === 2) return true;
      if (face === 3) {
        const low = Math.min(ground(box.x, box.y), ground(box.x + 1, box.y), ground(box.x, box.y + 1), ground(box.x + 1, box.y + 1));
        return y0 > low;
      }
      const [dx, dy] = NEIGHBOUR[face];
      const n = cell(box.x + dx, box.y + dy);
      const nLower = ra0[n], nUpper = ra1[n];
      if (nUpper < 1 || nUpper === nLower) return true;
      return box.lower < nLower || nUpper < box.upper;
    };
    const faces = faceVertices(x0, x1, y0, y1, z0, z1);
    // Side faces start at the terrain where the box goes below it.
    for (const face of [0, 1, 4, 5]) {
      const bottom = Math.max(y0, Math.min(...EDGE[face].map(([dx, dy]) => ground(box.x + dx, box.y + dy))));
      if (bottom > y0 && bottom < y1) for (const k of [2, 3]) faces[face][k][1] = bottom;
    }
    const light = hasLte ? lte[(box.y * 256 + box.x) * 7 + 2] / 255 : 1;
    for (let face = 0; face < 6; face++) {
      if (!visible(face)) continue;
      const v = q * 4;
      q++;
      faces[face].forEach((p, k) => positions.set(p, (v + k) * 3));
      for (let k = 0; k < 4; k++) { normals.set(NORMALS[face], (v + k) * 3); shade[v + k] = light; }
      const i = (v / 4) * 6;
      indices.set([v, v + 2, v + 1, v + 2, v + 3, v + 1], i);

      const slot = box.faceTexture[FACE_TO_CL0[face]];
      const rect = atlas.rects[Math.max(0, Math.min(slot, atlas.rects.length - 1))];
      const u0 = rect[0] / atlas.width, u1 = (rect[0] + rect[2]) / atlas.width;
      const t0 = rect[1] / atlas.height, t1 = (rect[1] + rect[3]) / atlas.height;
      const cu = [u0, u1, u1, u0], cv = [t1, t1, t0, t0];
      const base = face === 2 ? TOP_CORNERS : face === 3 ? FLAT_CORNERS : SIDE_CORNERS;
      const rot = box.faceRotation[FACE_TO_CL0[face]];
      const mirror = box.faceMirror[FACE_TO_CL0[face]];
      for (let k = 0; k < 4; k++) {
        let corner = base[k];
        if (mirror & 1) corner = (3 - corner) & 3;
        if (mirror & 2) corner = (1 - corner) & 3;
        corner = face === 2 || face === 3 ? (corner + rot) & 3 : (corner - rot + 4) & 3;
        uvs[(v + k) * 2] = cu[corner];
        uvs[(v + k) * 2 + 1] = cv[corner];
      }
    }
  }
  const used = q;
  return {
    positions: positions.slice(0, used * 12), normals: normals.slice(0, used * 12), uvs: uvs.slice(0, used * 8),
    indices: indices.slice(0, used * 6), shade: shade.slice(0, used * 4), hasLte, count: boxes.length, faces: used,
  };
}
