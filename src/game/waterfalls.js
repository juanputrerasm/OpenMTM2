/*
  Community Patch 4 beta 0.53's waterfalls as OpenMTM2 draws them (docs/CP4_EXE_ANALYSIS.md 12.8, 12.9; docs/VISUALS.md,
  "Waterfalls"): which look a fall is drawn in, the shader's clock, the texture's frame and whether a fall is near enough
  to draw. The sheets themselves are built at load (OpenPhotex sim/cp4/falls.ts, worker/cp4-falls.js) and drawn by
  render/waterfalls.js. Pure: no three.js, so the tests use it.
*/
import {
  FALL_GPU_DRAW, FALL_GPU_ICE, FALL_GRAPHICS_DEFAULTS, FALL_LOOK_ENHANCED, FALL_LOOK_ICE, FALL_LOOK_ORIGINAL, FALL_RIPPLE_FRAMES, FALL_RIPPLE_FRAME_SEC,
  fallLook,
} from "../vendor/openphotex/sim/cp4/falls.js";

export { FALL_LOOK_ENHANCED, FALL_LOOK_ICE, FALL_LOOK_ORIGINAL };

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
 * A fall's look in `weather` (12.8.3): Ice (3) in Snow on a FREEZE fall, else Enhanced (1) when `enhanced` (OpenMTM2's
 * enhanced picture, which stands for the engine's `enhancedWater` rule: the look built on OpenMTM2's water,
 * render/waterfall-water.js), else Original (0). Community Patch 4's Realistic (2) has no counterpart. The DLL of beta
 * 0.53 has the ice look (bit 4).
 */
export function waterfallLook(weather, flags, enhanced = false) {
  return fallLook({ waterRealism: false, enhancedWater: enhanced === true, weather, flags, gpu: FALL_GPU_DRAW | FALL_GPU_ICE });
}

/**
 * Hotfix 3's whitewater on looks 1 and 2 (docs/CP4_EXE_ANALYSIS.md 16.7.2, 16.7.3) at the renderer DLL's defaults, for
 * the enhanced look (render/waterfall-water.js). The tuning keys (`[Graphics]`, 12.0.1): `white` wfWhite / 100,
 * `lipBlendFt` wfLipBlend / 10, `breakup` wfBreakup / 100, `flowCycleS` wfFlowCycle / 10, `foam` wfFoam / 100,
 * `depthScale` wfDepthScale / 100, `calmSpeed` / `roughSpeed` wfCalmSpeed / 10 and wfRoughSpeed / 10 (ft/s): OpenMTM2
 * has no ini, so they keep their defaults. W's own numbers: the speed whitewater from `roughFrom` (default 25 ft/s) over
 * `speedOverFt` ft/s, the drop's from `dropFromFt` over `dropOverFt` ft. The froth's constants are the DLL's table
 * (kWfCellA .. kGapClear) and `whiteRgb` its kWhite.
 */
export const FALL_WHITEWATER = Object.freeze({
  white: 1, lipBlendFt: 4, breakup: 1, flowCycleS: 0.8, foam: 1, depthScale: 1, calmSpeed: 4, roughSpeed: 16,
  roughFrom: 25, speedOverFt: 20, dropFromFt: 27, dropOverFt: 30,
  cellA: 1.0, aniso: 3.5, cellB: 0.8, wall: 0.22, frothMean: 0.577, cellAmp: 1.2, densityFt: Object.freeze([3.5, 8.0]), densityAmp: 1.3,
  soft: 0.22, foamAmbient: 0.65, foamAlpha: 0.95, gapAer: 0.25, gapClear: 0.25, whiteRgb: Object.freeze([0.86, 0.9, 0.94]),
});

/**
 * OpenMTM2's own numbers for the enhanced look's water (render/waterfall-water.js), the parts built on the Reflective
 * water and not taken from the engine. What to turn if a fall looks off:
 * - `rippleSlope`: how strongly the ripples riding down the sheet tip it (its sky and glint break up more), and
 *   `rippleFt` / `rippleStretch` their size across the flow and how much longer they are along it;
 * - `roughCalm` / `roughChurned`: the facets' spread (as the lake's roughness) on calm and on churned water: more blurs
 *   the sky in it and widens the glint;
 * - `churnMilk` / `churnHides`: how far churned water (between the engine's calm and rough speeds) goes toward the
 *   Reflective water's own churned colour (the wakes') and how much of what lies behind it it hides: the sheet's body;
 * - `belowDark`: how much darker what a reflection that looks down meets is than the sky (the ground and the pool);
 * - `glintRough`: the glint's share left on fully churned water (the engine's 0.35).
 */
export const FALL_WATER_LOOK = Object.freeze({
  rippleSlope: 0.05, rippleFt: 2.4, rippleStretch: 3, roughCalm: 0.003, roughChurned: 0.03, churnMilk: 0.65, churnHides: 0.55,
  belowDark: 0.55, glintRough: 0.35,
});

/**
 * A fall's roughFrom (16.2.2, 16.7.2) as the enhanced look's uniform takes it: `[vR, on]`, vR the speed (ft/s) where the
 * speed whitewater starts and `on` 0 when the drop and speed whitewater are off. 1..250 is the speed itself; 255 turns
 * them off (the impact's foam stays); 0, the engine's default, and anything else 25 ft/s. The loader has already made
 * 251..254 0 (OpenPhotex `readFallFile`); were one to come here it reads as 0 does, as the DLL's test has it.
 */
export function waterfallRough(roughFrom) {
  const r = Number(roughFrom) || 0;
  if (r > 254.5) return [FALL_WHITEWATER.roughFrom, 0];
  return [r > 0.5 && r < 250.5 ? r : FALL_WHITEWATER.roughFrom, 1];
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
