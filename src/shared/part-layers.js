/*
  A model's parts drawn together.

  A model is cut into parts by texture, and each part is a draw of its own: a city block of eight textures is eight
  draws wherever it stands, and a track of a hundred such models is drawn in hundreds of them. Textures of one size
  can be kept as the layers of one stack instead, and a vertex can say which layer it reads: the parts that differ in
  nothing but their texture then become one part, and one draw.

  Pure: what goes in which stack, and the joined vertices. The renderer (render/part-merge.js) makes the textures,
  materials and meshes.
*/

/** The most layers a stack is given: what every WebGL 2 graphics card takes. */
export const MAX_LAYERS = 256;

/**
 * Put `items` in stacks: those of one `kind(item)` share a stack until it has `maxLayers`, then the next of that kind
 * begins. An item of kind null goes in none.
 * @returns {{ stacks: { kind: string, items: any[] }[], where: Map<any, { stack: number, layer: number }> }}
 */
export function planLayers(items, kind, maxLayers = MAX_LAYERS) {
  const stacks = [], open = new Map(), where = new Map();
  for (const item of items) {
    if (where.has(item)) continue;
    const k = kind(item);
    if (k === null || k === undefined) continue;
    let stack = open.get(k);
    if (stack === undefined || stacks[stack].items.length >= maxLayers) {
      stack = stacks.length;
      stacks.push({ kind: k, items: [] });
      open.set(k, stack);
    }
    where.set(item, { stack, layer: stacks[stack].items.length });
    stacks[stack].items.push(item);
  }
  return { stacks, where };
}

/**
 * Join parts' vertices, in order: `parts` are `{ positions, normals, uvs, layer }` (three, three and two numbers a
 * vertex, not indexed). Returns the joined `{ positions, normals, uvs, layers }`, `layers` a number a vertex: its
 * part's `layer`.
 */
export function joinParts(parts) {
  let count = 0;
  for (const part of parts) count += part.positions.length / 3;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = new Float32Array(count * 2), layers = new Float32Array(count);
  let at = 0;
  for (const part of parts) {
    const n = part.positions.length / 3;
    positions.set(part.positions, at * 3);
    normals.set(part.normals, at * 3);
    uvs.set(part.uvs, at * 2);
    layers.fill(part.layer ?? 0, at, at + n);
    at += n;
  }
  return { positions, normals, uvs, layers };
}

/**
 * Group a model's parts by `key(part)`, in the order each group first appears: `[{ key, parts }]`. A part whose key is
 * null is a group of its own, where it stood.
 */
export function groupParts(parts, key) {
  const groups = [], byKey = new Map();
  for (const part of parts) {
    const k = key(part);
    if (k === null || k === undefined) { groups.push({ key: null, parts: [part] }); continue; }
    let group = byKey.get(k);
    if (!group) { group = { key: k, parts: [] }; byKey.set(k, group); groups.push(group); }
    group.parts.push(part);
  }
  return groups;
}
