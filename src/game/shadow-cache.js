/*
  What the sun's shadow cascades keep of what never moves, when they draw it again, and how
  they are read (render/sun-shadows.js; docs/VISUALS.md, "Shadows").

  With Natural light each cascade keeps a copy of its map drawn with only what never moves in
  it: the ground and the placed objects. Two things make that copy wrong. A placed object a
  truck knocks about has moved; that is told by where it stood and where it stands now, and a
  cascade draws its copy again only if one of those lies in its circle and the object is wide
  enough to show in its texels. And the trucks, drawn over the copy each redraw, have to be
  taken off again before the next: only the patches of the map they were drawn in are put
  back from the copy, not the whole map.

  three.js's soft shadows (PCFSoftShadowMap) test the depth at sixteen texels about a point and
  weigh the tests as a box three texels wide of bilinear reads: along a row the four texels
  from the one left of the point's lower neighbour count 1 - f, 1, 1 and f, where f is how far
  the point lies past that neighbour's middle, and down a column the same. A graphics card
  asked to compare a depth texture with LINEAR filtering makes the four tests about a point
  and weighs them bilinearly itself. Two such reads along each axis, each placed between a pair
  of those texels as their weights stand to each other, give the same sum: four reads where
  three.js makes sixteen, and none of its unpacking of each depth (`softShadowReads`).

  Pure, so it runs under Node.
*/

/**
 * three.js's soft shadow along one axis of a map, as two bilinear reads: where each is made, in texels (texel k's
 * middle at k + 0.5), and its weight, the two summing to one. `t` is the point, in texels.
 */
export function softShadowReads(t) {
  const n = Math.floor(t + 0.5), f = t + 0.5 - n;
  // The pairs: texels n - 2 and n - 1 weighed 1 - f and 1, texels n and n + 1 weighed 1 and f.
  const first = 2 - f, second = 1 + f;
  return [
    { at: n - 1.5 + 1 / first, weight: first / 3 },
    { at: n + 0.5 + f / second, weight: second / 3 },
  ];
}

/** How many cascades may have their static copy drawn afresh in one frame, once each has been drawn once. */
export const REBUILDS_PER_FRAME = 1;
/** A knocked object this many of a cascade's texels across, or less, is not worth drawing that cascade's copy again for. */
export const SHOWS_TEXELS = 1.5;
/** What the trucks covered is put back from the static copy in patches; past this share of the map, all of it at once. */
export const PATCH_SHARE = 0.25;

/**
 * Whether anything that changed in what never moves, since a cascade last drew its static copy, shows in that cascade.
 *
 * `cascade` is `{ serial, radius, x, z, lx, ly }`: the change it last drew its copy with, the radius of its circle
 * (feet), where its middle lies in the scene (x and z) and across the light's way (lx, ly). `changes` are the changes as
 * the world keeps them (render/track-scene.js `bumpShadowStatic`), oldest first: `{ serial, spheres }`, each sphere
 * `[x, y, z, radius]` in scene feet, as an object stood and as it stands, or no spheres for a change that may be
 * anywhere. `serial` is the newest change; `toLight(x, y, z)` gives a point's place across the light's way, `[lx, ly]`;
 * the world repeats every `worldFt` feet, and the map is `mapSize` texels across.
 *
 * A change reaches the cascade where its place is unknown, where the changes it would have to look back over were not
 * all kept, or where a sphere wider than `SHOWS_TEXELS` texels lies within its circle in the copy of the world nearest
 * the cascade's middle.
 */
export function changeReaches(cascade, changes, serial, { toLight, worldFt, mapSize }) {
  if (!changes?.length || changes[0].serial > cascade.serial + 1) return true;
  const texel = (2 * cascade.radius) / mapSize;
  for (const change of changes) {
    if (change.serial <= cascade.serial || change.serial > serial) continue;
    if (!change.spheres) return true;
    for (const [x, y, z, r] of change.spheres) {
      if (2 * r <= texel * SHOWS_TEXELS) continue;
      const wx = x + Math.round((cascade.x - x) / worldFt) * worldFt, wz = z + Math.round((cascade.z - z) / worldFt) * worldFt;
      const [lx, ly] = toLight(wx, y, wz);
      if (Math.hypot(lx - cascade.lx, ly - cascade.ly) < cascade.radius + r) return true;
    }
  }
  return false;
}

/**
 * The square of a cascade's map, in texels `[x0, y0, x1, y1]`, that what lies in a sphere is drawn within: the sphere's
 * middle at `(u, v)` on the map (0 to 1), its radius `radiusShare` of the map's width, with two texels to spare, cut to
 * the map. Null where none of it is on the map.
 */
export function shadowPatch(u, v, radiusShare, mapSize) {
  const r = radiusShare * mapSize + 2, cx = u * mapSize, cy = v * mapSize;
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(mapSize, Math.ceil(cx + r)), y1 = Math.min(mapSize, Math.ceil(cy + r));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

/** The patches to put back before the next redraw: these, or null (the whole map) where they cover more than `PATCH_SHARE` of it. */
export function patchesToRestore(patches, mapSize) {
  let area = 0;
  for (const [x0, y0, x1, y1] of patches) area += (x1 - x0) * (y1 - y0);
  return area > PATCH_SHARE * mapSize * mapSize ? null : patches;
}
