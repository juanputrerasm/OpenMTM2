/*
  Community Patch 4's light on a Spline or Full Map track's 8 ft grid (docs/CP4_EXE_ANALYSIS.md 1.8; beta 0.53
  hotfix 4). The .LTE lights only the 32 ft corners, so the engine builds a light for each of the 1024 x 1024 fine
  points at load:

  1. At each 32 ft corner, how far the .LTE's light is from the engine's own sun light (a Lambert over the corner's
     32 ft normal) is kept: what the .LTE adds of shadow and shade.
  2. At each fine point, the sun light over the fine grid's own 8 ft normal, plus that difference between the four
     corners around it, bilinearly, from 0 to 255.

  So the light follows the spline's curves, and the .LTE's shadows stay. Without a .LTE the engine's corner light is the
  same Lambert, and the difference is nothing.

  The sun and its ambient floor are the level's (.LVL line 18, the sun vector, and the value after it), as the weather
  leaves them before the ground is loaded: Dusk halves the sun with an ambient of 0x8000, Night quarters it with 0x4000,
  Pitch Black takes an eighth with none. All of it is the engine's integer arithmetic.
*/

export const FINE_SIDE = 1024;
const COARSE = 256;

/** The sun (16.16, the light's travel) and the ambient floor (0..0xffff) the ground is lit with in `weather`. */
export function cp4GroundLight(weather, sunVector, ambient) {
  const [x = 0, y = 0, z = 0] = sunVector ?? [];
  let amb = ambient ?? 0, div = 1;
  if (weather === 6) { div = 2; amb = 0x8000; } else if (weather === 7) { div = 4; amb = 0x4000; } else if (weather === 8) { div = 8; amb = 0; }
  return { sun: [Math.trunc(x / div), Math.trunc(y / div), Math.trunc(z / div)], ambient: Math.min(0xffff, Math.max(0, amb | 0)) };
}

/** The engine's fixed-point product (a 64-bit product shifted down 16). */
const mul16 = (a, b) => Math.floor((a * b) / 65536);

/** A normal scaled to 65535, each part truncated. */
function unit(x, y, z) {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) return [0, 0, 0];
  return [Math.trunc((x / len) * 65535), Math.trunc((y / len) * 65535), Math.trunc((z / len) * 65535)];
}

/** The engine's light on a unit normal, 0..255: the ambient floor plus the rest by the sun's cosine. */
export function cp4LambertByte(light, [nx, ny, nz]) {
  const [sx, sy, sz] = light.sun;
  const d = Math.min(0xffff, Math.max(0, -(mul16(sx, nx) + mul16(sy, ny) + mul16(sz, nz))));
  const v = Math.min(0xffff, Math.max(0, mul16(0xffff - light.ambient, d) + light.ambient));
  return v >> 8;
}

/**
 * The fine grid's light, 1024 x 1024 bytes (rows along z), or null. `fineFt` the 8 ft heights in feet (the engine's
 * 1/64 ft steps), `lte` the level's .LTE (7 bytes a corner, the light first) or null, `light` from `cp4GroundLight`.
 */
export function cp4FineShade({ fineFt, lte = null, light }) {
  if (!fineFt || fineFt.length !== FINE_SIDE * FINE_SIDE) return null;
  const F = (r, c) => Math.round(fineFt[(r & 1023) * FINE_SIDE + (c & 1023)] * 64);
  // The 32 ft corners are the fine grid's every fourth point.
  const H = (r, c) => F((r & 255) * 4, (c & 255) * 4);
  const hasLte = !!lte && lte.length >= COARSE * COARSE * 7;
  const rest = new Int16Array(COARSE * COARSE);
  for (let r = 0; r < COARSE; r++) {
    for (let c = 0; c < COARSE; c++) {
      const nx = Math.trunc((Math.trunc((H(r, c + 1) - H(r, c - 1)) / 2) * -4) / 256);
      const nz = Math.trunc((Math.trunc((H(r + 1, c) - H(r - 1, c)) / 2) * -4) / 256);
      const own = cp4LambertByte(light, unit(nx, 32, nz));
      rest[r * COARSE + c] = (hasLte ? lte[(r * COARSE + c) * 7] : own) - own;
    }
  }
  const out = new Uint8Array(FINE_SIDE * FINE_SIDE);
  for (let r = 0; r < FINE_SIDE; r++) {
    const r0 = (r >> 2) * COARSE, r1 = (((r >> 2) + 1) & 255) * COARSE, fz = r & 3;
    for (let c = 0; c < FINE_SIDE; c++) {
      const c0 = c >> 2, c1 = (c0 + 1) & 255, fx = c & 3;
      const sum = ((4 - fx) * rest[r0 + c0] + fx * rest[r0 + c1]) * (4 - fz) + ((4 - fx) * rest[r1 + c0] + fx * rest[r1 + c1]) * fz;
      const between = sum < 0 ? -Math.trunc((8 - sum) / 16) : (sum + 8) >> 4;
      const lit = cp4LambertByte(light, unit((F(r, c - 1) - F(r, c + 1)) * 4, 0x1000, (F(r - 1, c) - F(r + 1, c)) * 4));
      out[r * FINE_SIDE + c] = Math.min(255, Math.max(0, between + lit));
    }
  }
  return out;
}
