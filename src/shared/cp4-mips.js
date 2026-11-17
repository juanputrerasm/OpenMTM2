/*
  Community Patch 4's texture mipmaps (docs/CP4_EXE_ANALYSIS.md 15.13). Pure, so it runs under Node.
*/

/**
 * Community Patch 4's mipmaps for a picture with see-through texels (CP4_EXE_ANALYSIS.md 15.13; beta 0.53 hotfix 4
 * `trid3d11.dll`, every texture it uploads, the HD art among it): each level halves the last, a texel's colour the mean
 * of those of its four that are not black, its alpha the bitwise OR of their four alphas, down to 1 x 1. So a texel with
 * anything solid under it stays solid: a grass blade or a leaf a few texels thin keeps its cover at every distance, where
 * the GPU's own mipmaps (the alpha averaged) thin it away under the cut-out's 0.5. Null for a picture that is not a
 * square power of two, or that is opaque throughout (its mipmaps are the GPU's).
 */
export function cp4MipChain({ rgba, width, height }) {
  if (width !== height || width < 2 || (width & (width - 1)) !== 0 || rgba.length !== width * height * 4) return null;
  let seeThrough = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { seeThrough = true; break; }
  if (!seeThrough) return null;
  const levels = [{ data: rgba, width, height }];
  let src = rgba, side = width;
  while (side > 1) {
    const half = side >> 1, out = new Uint8Array(half * half * 4);
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const a = ((2 * y) * side + 2 * x) * 4, b = a + 4, c = a + side * 4, d = c + 4;
        let r = 0, g = 0, bl = 0, n = 0, alpha = 0;
        for (const t of [a, b, c, d]) {
          alpha |= src[t + 3];
          if (src[t] | src[t + 1] | src[t + 2]) { r += src[t]; g += src[t + 1]; bl += src[t + 2]; n++; }
        }
        const o = (y * half + x) * 4;
        if (n) { out[o] = Math.trunc(r / n); out[o + 1] = Math.trunc(g / n); out[o + 2] = Math.trunc(bl / n); }
        out[o + 3] = alpha;
      }
    }
    levels.push({ data: out, width: half, height: half });
    src = out; side = half;
  }
  return levels;
}
