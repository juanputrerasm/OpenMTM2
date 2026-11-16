/*
  Community Patch 4's generated detail normal (docs/CP4_EXE_ANALYSIS.md 15.2.2): the 256 x 256 map Normal-Water draws
  when a track supplies no `<level>_WDTL` of its own. Five octaves of value noise from one xorshift32 stream, its slopes
  turned into a tangent-space normal. Pure and deterministic, so it runs under Node and is built once per session.
*/

/** The map's side, texels. */
export const DETAIL_NORMAL_SIDE = 256;
/** The xorshift32 stream's seed. */
export const DETAIL_NORMAL_SEED = 0x92d68ca2;
/** The octaves' lattice sizes; the amplitude halves from 1 with each. */
const OCTAVES = Object.freeze([4, 8, 16, 32, 64]);
/** The slope's gain before it is made a normal. */
const SLOPE_GAIN = 20;

const f32 = Math.fround;

/** The height field before it is made a normal, row y and column x at `y * 256 + x` (float32, as the engine keeps it). */
export function detailNoiseHeights() {
  const side = DETAIL_NORMAL_SIDE;
  const h = new Float32Array(side * side);
  let s = DETAIL_NORMAL_SEED >>> 0;
  OCTAVES.forEach((g, octave) => {
    // The lattice, drawn in order (index row * g + column), the stream carrying on from the octave before.
    const lattice = new Float32Array(g * g);
    for (let i = 0; i < lattice.length; i++) {
      s = (s ^ (s << 13)) >>> 0;
      s = (s ^ (s >>> 17)) >>> 0;
      s = (s ^ (s << 5)) >>> 0;
      lattice[i] = f32((s & 0xffff) / 65535);
    }
    const cell = side / g, amplitude = f32(1 / (1 << octave));
    const blend = (n) => { const f = f32((n % cell) / cell); return f32(f32(f32(3 - f32(f + f)) * f) * f); };
    for (let y = 0; y < side; y++) {
      const r0 = Math.floor(y / cell) * g, r1 = ((Math.floor(y / cell) + 1) % g) * g, wy = blend(y);
      for (let x = 0; x < side; x++) {
        const c0 = Math.floor(x / cell), c1 = (c0 + 1) % g, wx = blend(x);
        const top = f32(f32(f32(lattice[r0 + c1] - lattice[r0 + c0]) * wx) + lattice[r0 + c0]);
        const bottom = f32(f32(f32(lattice[r1 + c1] - lattice[r1 + c0]) * wx) + lattice[r1 + c0]);
        const at = y * side + x;
        h[at] = f32(f32(f32(f32(bottom - top) * wy) + top) * amplitude + h[at]);
      }
    }
  });
  return h;
}

/** A unit slope component as a byte: int((v * 0.5 + 0.5) * 255 + 0.5). */
const toByte = (v) => Math.trunc((v * 0.5 + 0.5) * 255 + 0.5);

/**
 * The generated detail normal, `{ width, height, rgba }` (256 x 256, RGBA8): R and G the normal's x and y, B and A 255.
 * The slopes wrap at the edges, so the map tiles.
 */
export function buildDetailNormal() {
  const side = DETAIL_NORMAL_SIDE, mask = side - 1;
  const h = detailNoiseHeights();
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const dx = -f32(h[y * side + ((x + 1) & mask)] - h[y * side + ((x + mask) & mask)]) * SLOPE_GAIN;
      const dy = -f32(h[((y + 1) & mask) * side + x] - h[((y + mask) & mask) * side + x]) * SLOPE_GAIN;
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * side + x) * 4;
      rgba[o] = toByte(dx / length);
      rgba[o + 1] = toByte(dy / length);
      rgba[o + 2] = rgba[o + 3] = 255;
    }
  }
  return { width: side, height: side, rgba };
}

let cached = null;
/** The generated detail normal, built the first time it is asked for and kept (never hand it to a transfer). */
export function generatedDetailNormal() {
  cached ??= buildDetailNormal();
  return cached;
}
