/*
  Community Patch 4 beta 0.53's waterfalls as OpenMTM2 draws them (docs/CP4_EXE_ANALYSIS.md 12.8, 12.9; docs/VISUALS.md,
  "Waterfalls"): which look a fall is drawn in, the shader's clock, the texture's frame and whether a fall is near enough
  to draw. The sheets themselves are built at load (OpenPhotex sim/cp4/falls.ts, worker/cp4-falls.js) and drawn by
  render/waterfalls.js. Pure: no three.js, so the tests use it.
*/
import {
  FALL_GPU_DRAW, FALL_GPU_ICE, FALL_GRAPHICS_DEFAULTS, FALL_LOOK_ICE, FALL_LOOK_ORIGINAL, FALL_RIPPLE_FRAMES, FALL_RIPPLE_FRAME_SEC, fallLook,
} from "../vendor/openphotex/sim/cp4/falls.js";

export { FALL_LOOK_ICE, FALL_LOOK_ORIGINAL };

/** The engine's clock: 65536 ticks a second. */
export const FALL_TICKS_PER_SECOND = 65536;
/** The shader's time a tick (the float 0x377fec73, 12.9), and where it wraps, seconds. */
export const FALL_SHADER_TIME_PER_TICK = Math.fround(1.5254237e-05);
export const FALL_SHADER_TIME_WRAP = 600;

/**
 * The renderer DLL's tuning keys at their defaults (12.0.1): the ragged edge's strength (`wfEdge` / 100), the draped
 * water's lift (`wfLift`, hundredths of a foot) and its pull toward the eye (`wfDepthPull`, per mille). The engine reads
 * them from monster.ini; OpenMTM2 has no ini, so they keep the defaults.
 */
export const WATERFALL_TUNING = Object.freeze({
  edge: FALL_GRAPHICS_DEFAULTS.wfEdge / 100,
  liftFt: FALL_GRAPHICS_DEFAULTS.wfLift / 100,
  depthPull: FALL_GRAPHICS_DEFAULTS.wfDepthPull / 1000,
});

/**
 * A fall's look in `weather` (12.8.3): Ice (3) in Snow on a FREEZE fall, else Original (0). Looks 1 and 2 are Community
 * Patch 4's own Enhanced and Realistic lake water, which OpenMTM2 does not have: its "Reflective water" is another
 * water, so a fall keeps the Original look under it too. The DLL of beta 0.53 has the ice look (bit 4).
 */
export function waterfallLook(weather, flags) {
  return fallLook({ waterRealism: false, enhancedWater: false, weather, flags, gpu: FALL_GPU_DRAW | FALL_GPU_ICE });
}

/** The shader's time after `seconds` of play (12.9): the ticks times 1.5254237e-05, wrapped at 600 s. */
export function waterfallShaderTime(seconds) {
  return (Math.floor(seconds * FALL_TICKS_PER_SECOND) * FALL_SHADER_TIME_PER_TICK) % FALL_SHADER_TIME_WRAP;
}

/**
 * Which of the eight `RIPPL` frames (0 for RIPPL100 .. 7 for RIPPL800) the default texture shows after `seconds` of its
 * clock (12.8.1): 1..8 then 7..2, a quarter second each. The caller holds the clock in Snow and in the mirror passes.
 */
export function waterfallRippleFrame(seconds) {
  const n = FALL_RIPPLE_FRAMES.length;
  const i = ((Math.floor(seconds / FALL_RIPPLE_FRAME_SEC) % n) + n) % n;
  return Number(FALL_RIPPLE_FRAMES[i].slice(5, 6)) - 1;
}

/** The frame an animated texture shows (12.8.2): clock / delay modulo the frames, the clock and delay in ticks. */
export function waterfallAnimationFrame(clockTicks, frames, delayTicks) {
  return Math.floor(clockTicks / delayTicks) % frames;
}

/** An animation's clock after `seconds` more, wrapping at frames * delay (12.8.2). */
export function advanceWaterfallClock(clockTicks, seconds, frames, delayTicks) {
  return (clockTicks + seconds * FALL_TICKS_PER_SECOND) % (frames * delayTicks);
}

/**
 * Whether a fall is near enough to draw (12.9): the horizontal distance from the eye to its bounds' centre, less half
 * their diagonal, under the draw range plus a tile. `dx`, `dz` from the eye to the centre (feet, the nearest copy's),
 * `bounds` the fall's in its vertex units (1/256 ft), `rangeFt` the draw range.
 */
export function waterfallInRange(dx, dz, bounds, rangeFt) {
  const [x0, y0, z0] = bounds.min, [x1, y1, z1] = bounds.max;
  const halfDiagonal = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 256 / 2;
  return Math.hypot(dx, dz) - halfDiagonal < rangeFt + 32;
}
