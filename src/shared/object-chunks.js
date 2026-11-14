/*
  The world in blocks, drawn as a window around the camera.

  The game draws no copies of its world. Its renderer walks the cells around the view's cell and draws each once,
  placed beside the view and read from the map modulo its size (MONSTER_EXE_ANALYSIS.md "The wrapping world",
  `0x5010f0`). Here everything that stands in the world (the ground, the ground boxes, a road, the scenery) is cut into
  blocks of OBJECT_CHUNK_FT, and each frame every block is moved by whole worlds to the copy nearest the camera
  (`blockShift`). With the view's range under half a world, that is the game's window: each thing once, beside the
  view, whichever side of the map's edge it is on.

  Scenery in blocks. A model placed in many places is drawn as instanced meshes, and an instanced mesh is drawn or
  skipped as a whole, by one bounding sphere: a forest of thousands of trees in a single mesh was drawn in full, in
  every copy of the world the view touched, whatever was in sight (4x4 Evolution 2's Pikes Peak has 11,342 pines,
  3.4 million triangles). Grouped by where they stand, the blocks behind the camera or past the draw distance are
  skipped, in the picture and in the shadow map. Pure: the renderer (render/track-scene.js) makes the meshes.
*/

/** A block's side in feet, and the retail world's (a track format version 6 world passes its own to `blockShift`). */
export const OBJECT_CHUNK_FT = 512, BLOCK_WORLD_FT = 8192;

/** The block a point (scene feet) stands in, as a key. */
export const blockKey = (x, z) => `${Math.floor(x / OBJECT_CHUNK_FT)},${Math.floor(z / OBJECT_CHUNK_FT)}`;

/** The block a placement's matrix (column-major, scene feet) stands in. Every model is in blocks, so that each can be placed. */
export function objectChunk(matrix) {
  return blockKey(matrix[12], matrix[14]);
}

/**
 * The whole worlds to move a thing centred at (x, z) by, `[dx, dz]`, so that it is the copy nearest the camera at
 * (cameraX, cameraZ). Scene feet; the camera may be any number of worlds from where the thing was made. `worldFt` the
 * world's size.
 */
export function blockShift(x, z, cameraX, cameraZ, worldFt = BLOCK_WORLD_FT) {
  return [Math.round((cameraX - x) / worldFt) * worldFt || 0, Math.round((cameraZ - z) / worldFt) * worldFt || 0];
}

/**
 * An indexed mesh's triangles by the block each begins in: a map from the block's key to its indices. `positions` are
 * the vertices (x, y, z a vertex, scene feet), `indices` three a triangle.
 */
export function chunkTriangles(positions, indices) {
  const lists = new Map();
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const v = indices[i] * 3, key = blockKey(positions[v], positions[v + 2]);
    let list = lists.get(key);
    if (!list) lists.set(key, (list = []));
    list.push(indices[i], indices[i + 1], indices[i + 2]);
  }
  return new Map([...lists].map(([key, list]) => [key, Uint32Array.from(list)]));
}

/**
 * Group placements (`{ model, matrix, sitIndex? }`) into the meshes to make: `{ meshes, slots }`, `meshes` a map from
 * a mesh's name (the model and `#<block>`) to `{ model, matrices }`, and `slots[sitIndex]` the
 * `[mesh name, index]` a SIT object is drawn at, for moving it later.
 */
export function groupObjects(objects) {
  const meshes = new Map(), slots = {};
  for (const object of objects) {
    const key = `${object.model}#${objectChunk(object.matrix)}`;
    if (!meshes.has(key)) meshes.set(key, { model: object.model, matrices: [] });
    const list = meshes.get(key).matrices;
    if (object.sitIndex !== undefined) slots[object.sitIndex] = [key, list.length];
    list.push(object.matrix);
  }
  return { meshes, slots };
}

/**
 * The bounds of the vertices a list of indices uses: `{ center: [x, y, z], radius }`. A block of a mesh shares the
 * mesh's vertices, so its bounds are those of its own triangles, not of the whole list of vertices.
 */
export function indexedBounds(positions, indices) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3;
    for (let k = 0; k < 3; k++) { const c = positions[v + k]; if (c < lo[k]) lo[k] = c; if (c > hi[k]) hi[k] = c; }
  }
  if (!indices.length) return { center: [0, 0, 0], radius: 0 };
  const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return { center, radius: Math.hypot(hi[0] - center[0], hi[1] - center[1], hi[2] - center[2]) };
}
