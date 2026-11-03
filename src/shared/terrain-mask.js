/*
  Community Patch 3's painted terrain detail mask (`<level>_MASK`), read where the ground's vertices are
  (render/track-scene.js `addTerrainDetail`). Pure, so it runs under Node.
*/

/** The feet the mask spans before it repeats: the world's width. */
export const TERRAIN_MASK_FT = 8192;

/**
 * The painted mask read at each of the ground's vertices, 0 to 255 (`positions` in scene feet, whose z is the game's
 * mirrored). The mask is a top-down picture of the level, in the level's own orientation, repeating every
 * TERRAIN_MASK_FT; read between its texels as a graphics card would.
 */
export function terrainMaskShares(positions, mask) {
  const { width, height, rgba } = mask;
  const shares = new Uint8Array(positions.length / 3);
  const texel = (x, y) => rgba[((((y % height) + height) % height) * width + (((x % width) + width) % width)) * 4];
  for (let v = 0; v < shares.length; v++) {
    const fx = (positions[v * 3] / TERRAIN_MASK_FT) * width - 0.5;
    const fy = (-positions[v * 3 + 2] / TERRAIN_MASK_FT) * height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const top = texel(x0, y0) * (1 - tx) + texel(x0 + 1, y0) * tx;
    const bottom = texel(x0, y0 + 1) * (1 - tx) + texel(x0 + 1, y0 + 1) * tx;
    shares[v] = Math.round(top * (1 - ty) + bottom * ty);
  }
  return shares;
}
