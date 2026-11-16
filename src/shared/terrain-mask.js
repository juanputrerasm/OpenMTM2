/*
  Community Patch 3's painted terrain detail mask (`<level>_MASK`), read where the ground's vertices are
  (render/track-scene.js `addTerrainDetail`). Pure, so it runs under Node.
*/

/** The feet the mask spans before it repeats: the world's width (the retail world's; a track format version 6 world passes its own). */
export const TERRAIN_MASK_FT = 8192;

/**
 * The painted mask read at each of the ground's vertices, 0 to 255 (`positions` in scene feet, whose z is the game's
 * mirrored). The mask is a top-down picture of the level, in the level's own orientation, repeating every
 * `worldFt` (TERRAIN_MASK_FT); read between its texels as a graphics card would.
 */
export function terrainMaskShares(positions, mask, worldFt = TERRAIN_MASK_FT) {
  const { width, height, rgba } = mask;
  const shares = new Uint8Array(positions.length / 3);
  const texel = (x, y) => rgba[((((y % height) + height) % height) * width + (((x % width) + width) % width)) * 4];
  for (let v = 0; v < shares.length; v++) {
    const fx = (positions[v * 3] / worldFt) * width - 0.5;
    const fy = (-positions[v * 3 + 2] / worldFt) * height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const top = texel(x0, y0) * (1 - tx) + texel(x0 + 1, y0) * tx;
    const bottom = texel(x0, y0 + 1) * (1 - tx) + texel(x0 + 1, y0 + 1) * tx;
    shares[v] = Math.round(top * (1 - ty) + bottom * ty);
  }
  return shares;
}

/*
  Community Patch 4's Always On Normal-Terrain (docs/CP4_EXE_ANALYSIS.md 15.3): a track without a painted mask is given
  one, a texel for each ground tile, from how bright the tile's texture is: dark ground takes the detail at twice the
  base strength, ground brighter than about luma 130 at the base strength. Strength v, mask byte (v - 1) / 4, so that
  the shader's 1 + 4 * mask is v.
*/

/** The detail strength (1 to 2) for a tile texture whose average colour has luma `luma` (0 to 255, 0.299 R + 0.587 G + 0.114 B). */
export function defaultMaskStrength(luma) {
  const v = luma <= 75 ? 2 : luma < 109 ? 2 - ((luma - 75) * 0.58) / 34 : 1.42 * (109 / luma) ** 2;
  return Math.max(v, 1);
}

/** The mask byte for a strength: int((v - 1) * 0.25 * 255 + 0.5). */
export const defaultMaskByte = (strength) => Math.trunc((strength - 1) * 0.25 * 255 + 0.5);

/**
 * The plain average of an image's colour, bytes `[r, g, b]` (sRGB, as the engine averages the decoded art), or null for
 * none. A large image is read every few texels.
 */
export function averageColor(image) {
  if (!image?.rgba?.length) return null;
  const { rgba } = image, texels = rgba.length >> 2, step = Math.max(1, Math.floor(texels / 65536)) * 4;
  let r = 0, g = 0, b = 0, n = 0;
  for (let o = 0; o < rgba.length; o += step) { r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n++; }
  return [r / n, g / n, b / n];
}

/**
 * The Always On default mask, `{ width, height, rgba }` (grey, `cells` x `cells`, row = tile z, column = tile x): each
 * tile's byte from the average colour of the texture its `.CLR` word names (bits 0-11), `colors[slot]` `[r, g, b]`
 * bytes; a slot without one counts as black.
 */
export function defaultTerrainMask(clr, colors, cells = 256) {
  const bySlot = colors.map((c) => defaultMaskByte(defaultMaskStrength(c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : 0)));
  const black = defaultMaskByte(defaultMaskStrength(0));
  const rgba = new Uint8ClampedArray(cells * cells * 4);
  for (let i = 0; i < cells * cells; i++) {
    const v = bySlot[clr[i] & 0x0fff] ?? black;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return { width: cells, height: cells, rgba };
}
