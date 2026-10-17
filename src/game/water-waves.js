/*
  The water's own waves (docs/VISUALS.md, "Water", "Waves"), for "Reflective water": a field of
  wind waves worked out once, as waves on water are, and laid over the water at three sizes.

  The field is a square of `side` points that repeats every way, and runs through `frames`
  pictures that loop. It is a sum of waves, one for each whole number of waves across the
  square (so it repeats), from `bandLow` to `bandHigh` across, each of its own height, running
  its own way at its own speed:

   - how high: as the wind's waves are, so that each band of an octave holds as much slope as
     the next (a height falling as the fourth power of the number across), shaded in and out at
     the band's ends (`bandFade`) so that three sizes of it, `sizeRatio` apart, add up to one
     even spread of waves from the longest of the largest to the shortest of the smallest;
   - which way: mostly with the wind, less across it and none against it (`spread`, the power
     of the cosine of half the angle off the wind, each way);
   - how fast: as deep water's waves run, a wave's speed growing as the square root of its
     length. In a loop each wave must come round a whole number of times: the longest
     `slowest` times, a shorter one more, as its frequency has it, to the nearest whole number.

  Each picture holds the field's slope along both axes, its height, and the square of its
  slope, for the graphics card to filter: where the water is too far off for its waves to be
  drawn, the mean of the squares less the square of the mean is how rough it is
  (game/water.js and render/water-surface.js read it so). The slopes are those of the field
  laid one size of square to the foot: the same at any size it is laid at.

  Pure, so it runs under Node.
*/

export const WATER_WAVES = Object.freeze({
  side: 128, frames: 32, bandLow: 12 / (2 * Math.SQRT2), bandHigh: 12 * 2 * Math.SQRT2, sizeRatio: 2 * Math.SQRT2,
  spread: 3, slowest: 2,
  /** The field's slope, its root mean square along each axis. */
  slopeRms: 0.1,
  /** What a byte of slope spans either way (bytes 0 to 255 for -slopeRange to slopeRange), and of height, in the field's root mean squares. */
  slopeRange: 0.45, heightRange: 4,
  seed: 20251016,
});

/** A small random generator, the same numbers for the same seed. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How much of a wave `across` waves across the square the band holds, 0 to 1: shaded in and out by octaves either side of its middle. */
export function bandShare(across, { bandLow = WATER_WAVES.bandLow, bandHigh = WATER_WAVES.bandHigh } = {}) {
  if (!(across >= bandLow && across <= bandHigh)) return 0;
  const middle = Math.sqrt(bandLow * bandHigh), half = Math.log(bandHigh / middle);
  return Math.cos((Math.PI / 2) * (Math.log(across / middle) / half)) ** 2;
}

/**
 * The waves of the field: each `{ x, y, height, phase, turns }`, `x` and `y` how many waves
 * across the square along each axis (it runs that way), `height` its height (the square's side
 * is 1), `phase` where it starts (radians), and `turns` how many times it comes round in a loop.
 * Its height at a point `u` (0 to 1 along each axis) in the loop at `t` (0 to 1) is
 * `height * cos(2 pi (x u.x + y u.y - turns t) + phase)`.
 */
export function waveComponents(spec = WATER_WAVES) {
  const { side, bandLow, bandHigh, spread, slowest, slopeRms, seed } = { ...WATER_WAVES, ...spec };
  const next = random(seed), half = side >> 1, out = [];
  let slopeSum = 0;
  for (let y = -half + 1; y < half; y++) {
    for (let x = -half + 1; x < half; x++) {
      const across = Math.hypot(x, y), share = bandShare(across, { bandLow, bandHigh });
      if (share <= 0) continue;
      // With the wind (along x) most, across it less, against it nothing.
      const off = Math.atan2(y, x), towards = Math.cos(off / 2) ** (2 * spread);
      if (towards < 1e-4) continue;
      // Each band of an octave as much slope as the next: a height square falling as the fourth power of the number across.
      const weight = share * towards / across ** 4;
      // A random height and phase: the height drawn as the length of a pair of normal numbers (Rayleigh).
      const u1 = Math.max(1e-12, next()), u2 = next();
      const height = Math.sqrt(weight) * Math.sqrt(-2 * Math.log(u1)) / Math.SQRT2, phase = 2 * Math.PI * u2;
      const turns = Math.max(1, Math.round(slowest * Math.sqrt(across / bandLow)));
      out.push({ x, y, height, phase, turns });
      slopeSum += (2 * Math.PI * height * across) ** 2 / 2;
    }
  }
  // The slope's mean square over both axes is the sum of each wave's: as many as `slopeRms` asks.
  const scale = Math.sqrt((2 * slopeRms * slopeRms) / slopeSum);
  for (const wave of out) wave.height *= scale;
  return out;
}

/**
 * The discrete Fourier sum over `n` numbers (a power of two) with e^(+i...), the field from its waves, as a function that
 * works in place on `re` and `im`: its reordering and its turns worked out once.
 */
function fourier(n) {
  const order = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    order[i] = j;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos((2 * Math.PI * k) / n); sin[k] = Math.sin((2 * Math.PI * k) / n); }
  return (re, im) => {
    for (let i = 1; i < n; i++) {
      const j = order[i];
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let length = 2, stride = n >> 1; length <= n; length <<= 1, stride >>= 1) {
      const half = length >> 1;
      for (let start = 0; start < n; start += length) {
        for (let k = 0; k < half; k++) {
          const a = start + k, b = a + half, wr = cos[k * stride], wi = sin[k * stride];
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

/** The field from its waves, in place: a sum over the square's rows and then its columns. */
function field(re, im, side, sum) {
  const rowRe = new Float64Array(side), rowIm = new Float64Array(side);
  for (let j = 0; j < side; j++) {
    const o = j * side;
    for (let i = 0; i < side; i++) { rowRe[i] = re[o + i]; rowIm[i] = im[o + i]; }
    sum(rowRe, rowIm);
    for (let i = 0; i < side; i++) { re[o + i] = rowRe[i]; im[o + i] = rowIm[i]; }
  }
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) { rowRe[j] = re[j * side + i]; rowIm[j] = im[j * side + i]; }
    sum(rowRe, rowIm);
    for (let j = 0; j < side; j++) { re[j * side + i] = rowRe[j]; im[j * side + i] = rowIm[j]; }
  }
}

/**
 * The field's pictures: `side` by `side` by `frames` points, four bytes each, row by row and
 * picture by picture. Red and green are the slope along x and y (`slopeRange` either way of
 * 128), blue the height (`heightRange` of its root mean square either way), alpha the slope's
 * square summed over both axes (0 to twice `slopeRange` squared). Also the field's heights'
 * root mean square, in the square's side.
 * @returns {{ data: Uint8Array, side: number, frames: number, heightRms: number, waves: object[] }}
 */
export function waveTile(spec = WATER_WAVES) {
  const options = { ...WATER_WAVES, ...spec }, { side, frames, slopeRange, heightRange } = options;
  const waves = waveComponents(options), count = side * side;
  const heightRms = Math.sqrt(waves.reduce((sum, w) => sum + (w.height * w.height) / 2, 0));
  const aRe = new Float64Array(count), aIm = new Float64Array(count), bRe = new Float64Array(count), bIm = new Float64Array(count);
  const data = new Uint8Array(count * frames * 4), sum = fourier(side);
  // Where each wave and its conjugate lie in the sums, and its slope's factor along each axis.
  const at = new Uint32Array(waves.length * 2), kx = new Float64Array(waves.length), ky = new Float64Array(waves.length);
  waves.forEach((w, i) => {
    at[2 * i] = ((w.y + side) % side) * side + ((w.x + side) % side);
    at[2 * i + 1] = ((side - w.y) % side) * side + ((side - w.x) % side);
    kx[i] = 2 * Math.PI * w.x; ky[i] = 2 * Math.PI * w.y;
  });
  const toSlope = 255 / (2 * slopeRange), toHeight = 255 / (2 * heightRange * heightRms), toSquare = 255 / (2 * slopeRange * slopeRange);
  const byte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0);
  for (let f = 0; f < frames; f++) {
    aRe.fill(0); aIm.fill(0); bRe.fill(0); bIm.fill(0);
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      // This wave now, c, as half its height at its number across and its conjugate at the opposite one, which sum to a
      // real field. A is the height and i times the slope along x, (1 - i i k) c = (1 - k) c with k the slope's factor
      // (i k c); B the slope along y, i k c. At the opposite number the factors and the imaginary part change sign.
      const angle = w.phase - 2 * Math.PI * w.turns * (f / frames), re = (w.height / 2) * Math.cos(angle), im = (w.height / 2) * Math.sin(angle);
      const p = at[2 * i], q = at[2 * i + 1], gx = kx[i], gy = ky[i];
      aRe[p] += (1 - gx) * re; aIm[p] += (1 - gx) * im;
      bRe[p] -= gy * im; bIm[p] += gy * re;
      aRe[q] += (1 + gx) * re; aIm[q] -= (1 + gx) * im;
      bRe[q] -= gy * im; bIm[q] -= gy * re;
    }
    field(aRe, aIm, side, sum);
    field(bRe, bIm, side, sum);
    for (let k = 0, o = f * count * 4; k < count; k++, o += 4) {
      const h = aRe[k], sx = aIm[k], sy = bRe[k];
      data[o] = byte(127.5 + sx * toSlope);
      data[o + 1] = byte(127.5 + sy * toSlope);
      data[o + 2] = byte(127.5 + h * toHeight);
      data[o + 3] = byte((sx * sx + sy * sy) * toSquare);
    }
  }
  return { data, side, frames, heightRms, waves };
}

/*
  How the field is laid over the water (render/water-surface.js):

   - `sizesFt`: four sizes of the square, each `sizeRatio` the next, so that their waves meet
     end to end: from two inches to 28 feet long. Each is turned a little off the wind (`turns`,
     radians) so that no two line up, and laid as strongly as `gains` says (its slope against
     the field's own). The smallest is drawn only within `finestFt` of the eye, and fades out
     over the last third of that: past it, its waves are too fine to draw, and their slope is
     roughness, as a filtered picture of them would have it.
   - `roughness`: the mean square slope, over both axes, of the waves too short for the field:
     what blurs the sky in the water and spreads the sun's glint.
   - The wind blows the way the fog drifts (render/atmosphere.js), `windWay` on the map, and in
     gusts: patches `gustFt` across that run with it at `gustFtPerS`, in which the waves rise and
     out of which they lie down. The short waves follow a gust at once (`gustReach`, the least and
     the most of their strength); the longest less, as the square root of it; the roughness
     below the field as its square, so the water between gusts is glassy.
   - Each weather's wind, as a share of a clear day's (`weather`).
*/
export const WATER_WAVE_LAYOUT = Object.freeze({
  sizesFt: Object.freeze([120, 120 / WATER_WAVES.sizeRatio, 120 / WATER_WAVES.sizeRatio ** 2, 120 / WATER_WAVES.sizeRatio ** 3]),
  turns: Object.freeze([0, 0.35, -0.42, 0.61]),
  gains: Object.freeze([0.66, 0.6, 0.54, 0.45]),
  finestFt: 180,
  roughness: 0.004,
  windWay: Object.freeze([-0.93, 0.37]),
  gustFt: 900, gustFtPerS: 6, gustReach: Object.freeze([0.25, 1.45]),
  // Clear, Cloudy, Foggy, Dense Fog, Rain, Snow (frozen), Dusk, Night, Pitch Black: fog lies on still air.
  weather: Object.freeze([1, 1.1, 0.45, 0.35, 1.35, 1, 0.8, 0.75, 0.75]),
});

/** Feet a second squared. */
const G = 32.17;

/**
 * How long the field, laid at `sizeFt` a side, takes to come round its loop, seconds: as long as
 * its longest wave takes to pass `slowest` times, at deep water's pace (the wave's frequency
 * the square root of g times its wavenumber).
 */
export function waveLoopSeconds(sizeFt, { bandLow = WATER_WAVES.bandLow, slowest = WATER_WAVES.slowest } = {}) {
  return (slowest * 2 * Math.PI) / Math.sqrt((G * 2 * Math.PI * bandLow) / sizeFt);
}
