/*
  Anti-aliasing choices (docs/VISUALS.md, "Anti-aliasing").

  MSAA is the picture the port already drew: several samples a point, in hardware. The others
  are optional. Each costs a pass over the picture, or a copy of it, and none of them is used
  unless the player picks it. Off draws one sample a point, for the machines where even the
  hardware samples are too much.

  Pure: no three.js, so the tests and the options screen use it, and the renderer
  (render/aa.js, render/lens.js) takes its numbers from here.
*/

/** The choices, in the order Options lists them. `post` is the pass over the picture, or null. */
export const AA_MODES = Object.freeze([
  Object.freeze({ id: "off", label: "Off", post: null }),
  Object.freeze({ id: "msaa", label: "MSAA", post: null }),
  Object.freeze({ id: "fxaa", label: "FXAA", post: "fxaa" }),
  Object.freeze({ id: "smaa", label: "SMAA", post: "smaa" }),
  Object.freeze({ id: "taa", label: "TAA", post: "taa" }),
]);

/** What a race draws until the player picks otherwise: the hardware samples it already had. */
export const DEFAULT_AA = "msaa";

/**
 * Above this many points the hardware path takes two samples a point instead of four, so a
 * very large picture stays in reach. 2560 x 1440 is under it; 3840 x 2160 is over it.
 */
export const MSAA_MANY_POINTS = 5e6;

/** How much of the frame before TAA keeps. The rest is the frame just drawn. */
export const TAA_HISTORY = 0.9;

/** A camera that jumps further than this, feet, or turns further than this, radians, drops the frame TAA kept. */
export const TAA_RESET_FT = 40;
export const TAA_RESET_TURN = 0.2;

/**
 * A point whose distance does not agree with the frame before, by more than this many feet
 * or this share of its distance, is drawn from the new frame alone.
 */
export const TAA_DEPTH_FT = 0.5;
export const TAA_DEPTH_SHARE = 0.02;

/** Shown on the Options screen's Display page. */
export const AA_HINT = "Off draws each point once and is the fastest. MSAA is the hardware default: four samples a point, two when the picture is very large. FXAA, SMAA and TAA are optional passes over the picture, left off unless chosen. FXAA is the cheapest, SMAA keeps edges sharper, and TAA also steadies shimmer. A headset keeps its own sampling. Takes effect from the next race.";

/** A known choice, or the default when `id` is missing or not one of them. */
export function aaChoice(id) {
  return AA_MODES.some((mode) => mode.id === id) ? id : DEFAULT_AA;
}

/** The pass the choice asks for, or null when the picture is only sampled as it is drawn. */
export function aaPost(id) {
  return AA_MODES.find((mode) => mode.id === aaChoice(id)).post;
}

/**
 * How many samples a point the scene picture takes. Four for MSAA, two above
 * `MSAA_MANY_POINTS` points, and none for every other choice: those draw the point once
 * and, where they say so, run a pass afterwards. An id that is not a choice is MSAA.
 */
export function aaSamples(id, width, height) {
  if (aaChoice(id) !== "msaa") return 0;
  const points = Math.max(0, width) * Math.max(0, height);
  return points > MSAA_MANY_POINTS ? 2 : 4;
}

/**
 * Whether the screen's own picture (the canvas) is made with samples, for the settings as they are when the renderer is
 * made, which is once a session (render/xr/xr-host.js). Only MSAA without the lens draws the scene straight onto it;
 * every other choice draws into pictures of its own and puts the result on the screen in one last pass, where samples
 * smooth nothing and the browser resolves them every frame all the same (1.5 to 2 ms a frame on an Intel HD 630 at
 * 1920 x 1080). A race that later wants MSAA without the lens on a screen made without samples draws it into a picture
 * of its own that has them (render/scenery.js).
 */
export function screenSampled(settings = {}) {
  return aaChoice(settings.aa) === "msaa" && settings.lensEffects !== true;
}

/** The van der Corput radical inverse: the fractional part of `index` written in base `base` and mirrored. */
export function halton(index, base) {
  let f = 1, r = 0, i = Math.max(0, index | 0);
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/**
 * Where TAA puts the sample for `frame` (1, 2, 3, ...), in pixels, each within half a pixel
 * of the pixel's centre. Bases 2 and 3, so the points fill the pixel without repeating soon.
 */
export function taaJitter(frame) {
  const n = Math.max(1, frame | 0);
  return Object.freeze([halton(n, 2) - 0.5, halton(n, 3) - 0.5]);
}

/** Whether this frame's camera move, in feet and radians, is far enough that the kept frame is no use. */
export function aaResets(movedFt, turnedRad) {
  return movedFt > TAA_RESET_FT || turnedRad > TAA_RESET_TURN;
}
