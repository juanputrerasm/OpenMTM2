/*
  The water's own waves (docs/VISUALS.md, "Water", "Waves"), with "Reflective water": a field of
  wind waves that repeats across its square and around its loop, run as deep water's waves run,
  and laid over the water at four sizes in gusts.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { WATER_WAVES, WATER_WAVE_LAYOUT, bandShare, waveComponents, waveLoopSeconds, waveTile } from "../src/game/water-waves.js";

const waves = waveComponents();
const tile = waveTile();
const { side, frames, slopeRange, heightRange } = WATER_WAVES;
const decodeSlope = (byte) => (byte / 255 - 0.5) * 2 * slopeRange;

test("the field repeats across its square and around its loop: whole waves across, whole turns in a loop", () => {
  assert.ok(waves.length > 1000, `${waves.length} waves`);
  for (const w of waves) {
    assert.ok(Number.isInteger(w.x) && Number.isInteger(w.y) && Number.isInteger(w.turns), JSON.stringify(w));
    assert.ok(w.turns >= 1);
  }
  assert.equal(tile.data.length, side * side * frames * 4);
});

test("the waves run with the wind, less across it, and none against it", () => {
  let down = 0, against = 0, all = 0;
  for (const w of waves) {
    const e = w.height * w.height;
    all += e;
    if (w.x > 0) down += e;
    // Within 30 degrees of straight into the wind.
    if (Math.cos(Math.atan2(w.y, w.x)) < -Math.cos(Math.PI / 6)) against += e;
  }
  assert.ok(down / all > 0.9, `downwind share ${down / all}`);
  assert.ok(against / all < 2e-3, `into the wind ${against / all}`);
  // So the slope along the wind is the steeper.
  let sx = 0, sy = 0;
  for (let k = 0; k < side * side; k++) { sx += decodeSlope(tile.data[k * 4]) ** 2; sy += decodeSlope(tile.data[k * 4 + 1]) ** 2; }
  assert.ok(sx > sy * 1.2, `along ${Math.sqrt(sx / (side * side))} across ${Math.sqrt(sy / (side * side))}`);
});

test("longer waves run slower: each comes round its loop as often as deep water's frequency has it, to the nearest whole turn", () => {
  for (const w of waves) {
    const across = Math.hypot(w.x, w.y), exact = WATER_WAVES.slowest * Math.sqrt(across / WATER_WAVES.bandLow);
    assert.ok(Math.abs(w.turns - Math.max(1, exact)) <= 0.5 + 1e-9, `${across} across: ${w.turns} turns for ${exact}`);
  }
  // A wave's speed is its turns over its waves across: the longest run the fastest.
  const speed = (w) => w.turns / Math.hypot(w.x, w.y);
  const longest = waves.reduce((a, b) => (Math.hypot(a.x, a.y) < Math.hypot(b.x, b.y) ? a : b));
  const shortest = waves.reduce((a, b) => (Math.hypot(a.x, a.y) > Math.hypot(b.x, b.y) ? a : b));
  assert.ok(speed(longest) > speed(shortest) * 1.5);
});

test("each octave of the band holds about as much slope as the next, so the sizes add up to one even spread", () => {
  const octave = new Map();
  for (const w of waves) {
    const across = Math.hypot(w.x, w.y), band = Math.floor(Math.log2(across / WATER_WAVES.bandLow) * 2);
    octave.set(band, (octave.get(band) ?? 0) + (2 * Math.PI * w.height * across) ** 2 / 2);
  }
  // The four sizes, `sizeRatio` apart, share every wavelength between them: their shares of it add up to one.
  const sizes = WATER_WAVE_LAYOUT.sizesFt;
  for (let i = 0; i + 1 < sizes.length; i++) assert.ok(Math.abs(sizes[i] / sizes[i + 1] - WATER_WAVES.sizeRatio) < 1e-9);
  for (let lengthFt = sizes[0] / (WATER_WAVES.bandLow * WATER_WAVES.sizeRatio); lengthFt > sizes.at(-1) / WATER_WAVES.bandHigh * WATER_WAVES.sizeRatio; lengthFt *= 0.93) {
    const total = sizes.reduce((sum, size) => sum + bandShare(size / lengthFt), 0);
    assert.ok(Math.abs(total - 1) < 1e-6, `a wave ${lengthFt.toFixed(2)} ft long: ${total}`);
  }
  // The middle of the band: no half octave more than about twice another (each wave's height is drawn at random).
  const middle = [...octave.entries()].filter(([band]) => band >= 1 && band <= 4).map(([, v]) => v);
  assert.ok(Math.max(...middle) / Math.min(...middle) < 2.5, middle.join(" "));
});

test("the field's slope is as steep as it is told to be, and its slopes are its height's", () => {
  const n = side * side;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += decodeSlope(tile.data[k * 4]) ** 2 + decodeSlope(tile.data[k * 4 + 1]) ** 2;
  const rms = Math.sqrt(sum / (2 * n));
  assert.ok(Math.abs(rms - WATER_WAVES.slopeRms) < 0.15 * WATER_WAVES.slopeRms, `slope ${rms}`);
  // The slope along x against the height's change from the point before to the point after.
  const height = (i, j) => (tile.data[(((j + side) % side) * side + ((i + side) % side)) * 4 + 2] / 255 - 0.5) * 2 * heightRange * tile.heightRms;
  let off = 0, size = 0;
  for (let j = 0; j < side; j += 3) {
    for (let i = 0; i < side; i += 3) {
      const slope = decodeSlope(tile.data[(j * side + i) * 4]), differs = ((height(i + 1, j) - height(i - 1, j)) * side) / 2;
      off += (slope - differs) ** 2;
      size += slope * slope;
    }
  }
  assert.ok(Math.sqrt(off / size) < 0.15, `slope against the height's: ${Math.sqrt(off / size)}`);
  // The square of the slope is kept, for the graphics card to filter into roughness.
  const k = 1234, sx = decodeSlope(tile.data[k * 4]), sy = decodeSlope(tile.data[k * 4 + 1]);
  assert.ok(Math.abs((tile.data[k * 4 + 3] / 255) * 2 * slopeRange * slopeRange - (sx * sx + sy * sy)) < 0.003);
});

test("a size's loop is as long as its longest wave takes to pass `slowest` times at deep water's pace", () => {
  for (const size of WATER_WAVE_LAYOUT.sizesFt) {
    const k = (2 * Math.PI * WATER_WAVES.bandLow) / size, omega = Math.sqrt(32.17 * k);
    assert.ok(Math.abs(omega * waveLoopSeconds(size) - 2 * Math.PI * WATER_WAVES.slowest) < 1e-9);
  }
  // A size twice as large takes the square root of two as long.
  assert.ok(Math.abs(waveLoopSeconds(200) / waveLoopSeconds(100) - Math.SQRT2) < 1e-9);
});

test("the wind drops in the fogs, which lie on still air, and rises in Rain; gusts raise the waves and calm between them", () => {
  const [clear, , foggy, dense, rain] = WATER_WAVE_LAYOUT.weather;
  assert.equal(clear, 1);
  assert.ok(foggy < 0.6 && dense < foggy && rain > 1);
  const [least, most] = WATER_WAVE_LAYOUT.gustReach;
  assert.ok(least < 0.5 && most > 1);
  // The finest size is drawn near the eye only.
  assert.ok(WATER_WAVE_LAYOUT.finestFt > 50 && WATER_WAVE_LAYOUT.finestFt < 500);
  assert.ok(WATER_WAVE_LAYOUT.roughness > 0 && WATER_WAVE_LAYOUT.roughness < 0.02);
});
