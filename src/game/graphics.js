/*
  Presets for the port's own scenery (docs/VISUALS.md, "The switches" and "Cost").

  Auto, Off, Low, High, Max and Custom. Off is the default and the game's own picture: every
  part is the player's to turn on. Auto picks Low, High or Max for this machine. Low keeps the parts that cost little, or that
  are faster than what they replace, and drops the passes the Cost section names first and
  the smoothed ground, the one part left that a small chip pays for on every frame.
  High drops only the lens. Max is every part. Custom leaves each switch as the player set it.

  The booleans in the settings stay the switches `visualSettings` reads. A preset writes them.
  Pure: no DOM and no three.js, so Node can test the choice. The browser fills in the hardware
  (app/graphics-hardware.js).
*/
import { VISUAL_OPTIONS } from "./visuals.js";
import { msg } from "./strings.js";

/** The choices, in the order Options lists them. */
export const GRAPHICS_PRESETS = Object.freeze([
  Object.freeze({ id: "auto", label: msg("Auto") }),
  Object.freeze({ id: "off", label: msg("Off") }),
  Object.freeze({ id: "low", label: msg("Low") }),
  Object.freeze({ id: "high", label: msg("High") }),
  Object.freeze({ id: "max", label: msg("Max") }),
  Object.freeze({ id: "custom", label: msg("Custom") }),
]);

/**
 * Past this many points a strong chip steps from Max down to High, an integrated one from
 * High down to Low, and an unnamed renderer from High down to Low. 2560 x 1440, the size the
 * Cost section measured, is under it. 3840 x 2160 is over it.
 */
export const GRAPHICS_MANY_POINTS = 5e6;

const DROP = Object.freeze({
  off: VISUAL_OPTIONS.map((option) => option.key),
  low: ["terrainSmoothing", "volumetricWeather", "groundDetail", "naturalLight", "lensEffects"],
  high: ["lensEffects"],
  max: [],
});

function flagSet(off) {
  const drop = new Set(off);
  const flags = Object.fromEntries(VISUAL_OPTIONS.map((option) => [option.key, !drop.has(option.key)]));
  // A part with a slider (Volumetric weather) is set to its default amount where the preset has it on, None where not.
  for (const option of VISUAL_OPTIONS) if (option.amountKey) flags[option.amountKey] = flags[option.key] ? option.defaultLevel : 0;
  return Object.freeze(flags);
}

/** The switches each named tier writes. Auto and Custom are not here: Auto copies one of these, Custom writes nothing. */
export const GRAPHICS_FLAGS = Object.freeze({
  off: flagSet(DROP.off),
  low: flagSet(DROP.low),
  high: flagSet(DROP.high),
  max: flagSet(DROP.max),
});

/** The line under the preset. A change still waits for the next race, which the screen adds. */
export const GRAPHICS_NOTES = Object.freeze({
  auto: msg("Picks Low, High or Max for this machine."),
  off: msg("The game's own picture, the default. None of the port's scenery."),
  low: msg("The water, puddles, snow, paint, lamps and rich dust. No smoothed ground, volumetric weather, ground detail, natural light or lens."),
  high: msg("Every part but the lens, the pass the picture can spare first."),
  max: msg("Every part, including the lens."),
  // Custom shows each part's switch under it, which says as much.
  custom: "",
});

/** Shown on the Options screen's Display page, on the Enhanced graphics preset row. */
export const GRAPHICS_HINT = msg("Off, the default, is the game's own picture. Auto picks Low, High or Max for this machine. Low keeps the water, puddles, snow, paint, lamps and rich dust, and drops the smoothed ground, volumetric weather, ground detail, natural light and the lens. High drops only the lens. Max is every part. Custom sets each part on its own. Takes effect from the next race.");

/** A known choice, or Off when `id` is missing or not one of them. */
export function graphicsChoice(id) {
  return GRAPHICS_PRESETS.some((preset) => preset.id === id) ? id : "off";
}

/** The name Options shows for a choice, including a tier Auto picked. */
export function graphicsLabel(id) {
  return GRAPHICS_PRESETS.find((preset) => preset.id === graphicsChoice(id)).label;
}

/**
 * Low, High or Max for a machine. Never Off: that is a player's choice. `hardware` is a plain
 * object, `{ renderer, deviceMemory, pixels }`, so this can run under Node.
 *
 * The name comes from the graphics driver's own string. A software renderer, a phone chip,
 * Intel HD or UHD, or under 4 GB of memory when the named chip is not a desktop one, is Low.
 * A strong desktop chip is Max up to `GRAPHICS_MANY_POINTS` and High past it. A lesser desktop
 * chip is High. An unnamed renderer is High, or Low on a picture that large: the lens is the
 * one pass to give up when the chip is not known, and the rest of Low's cuts follow only then.
 * A missing pixel count or memory figure is not held against the machine.
 */
export function detectGraphics(hardware = {}) {
  const renderer = typeof hardware?.renderer === "string" ? hardware.renderer.toLowerCase() : "";
  const pixels = typeof hardware?.pixels === "number" && Number.isFinite(hardware.pixels) ? hardware.pixels : null;
  const memory = typeof hardware?.deviceMemory === "number" && Number.isFinite(hardware.deviceMemory) ? hardware.deviceMemory : null;
  const kind = gpuKind(renderer);
  const huge = pixels !== null && pixels > GRAPHICS_MANY_POINTS;
  // Chrome reports memory in buckets, and under 4 means 2 GB or less. A named desktop chip
  // wins over a low figure, and a missing figure (Firefox) is not a reason to step down.
  const tight = memory !== null && memory < 4;
  if (kind === "software" || kind === "weak" || kind === "integrated" || kind === "mobile") return "low";
  if (tight && kind !== "strong" && kind !== "discrete") return "low";
  if (kind === "integrated-strong") return huge ? "low" : "high";
  if (kind === "strong") return huge ? "high" : "max";
  if (kind === "discrete") return "high";
  return huge ? "low" : "high";
}

/**
 * Write the preset's switches onto `settings` and return it. Custom is left alone. Auto writes
 * the tier `detectGraphics` picks and leaves `settings.graphics` as "auto", so the next launch
 * picks again. The object must not be the frozen defaults.
 */
export function applyGraphics(settings, hardware = {}) {
  if (!settings || typeof settings !== "object") return settings;
  const choice = graphicsChoice(settings.graphics);
  if (choice === "custom") return settings;
  const tier = choice === "auto" ? detectGraphics(hardware) : choice;
  const flags = GRAPHICS_FLAGS[tier];
  if (!flags) return settings;
  for (const key of Object.keys(flags)) settings[key] = flags[key];
  return settings;
}

/** What kind of chip the driver's string names, or "unknown" when it names none. */
function gpuKind(renderer) {
  if (!renderer) return "unknown";
  if (/swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic/.test(renderer)) return "software";
  if (/adreno|mali-|powervr|videocore|immortalis/.test(renderer)) return "mobile";
  if (renderer.includes("apple gpu")) return "mobile";
  const apple = renderer.match(/\bapple\s+m(\d+)\b/);
  if (apple) {
    const generation = Number(apple[1]);
    if (/\b(?:pro|max|ultra)\b/.test(renderer) || generation >= 3) return "strong";
    return "discrete";
  }
  const intel = intelKind(renderer);
  if (intel) return intel;
  const nvidia = nvidiaKind(renderer);
  if (nvidia) return nvidia;
  const amd = amdKind(renderer);
  if (amd) return amd;
  return "unknown";
}

function intelKind(renderer) {
  if (!/\bintel\b/.test(renderer)) return null;
  if (/\biris\b/.test(renderer)) return "integrated-strong";
  if (/\buhd\b|\bhd graphics\b/.test(renderer)) return "integrated";
  if (/\barc\b/.test(renderer)) {
    const model = renderer.match(/\ba(\d)\d*/);
    if (model && (model[1] === "5" || model[1] === "7")) return "strong";
    return "discrete";
  }
  return "integrated";
}

function nvidiaKind(renderer) {
  if (!/nvidia|geforce|quadro/.test(renderer)) return null;
  const rtx = renderer.match(/\brtx\s*(\d{3,4})\b/);
  if (rtx) {
    const n = Number(rtx[1]);
    const rest = n % 100;
    const generation = n - rest;
    // 3050, 4050 and 5050 are the cut-down cards. 2060 and anything 60 and above is the full one.
    if (generation >= 3000 && rest < 60) return "discrete";
    if (rest >= 60) return "strong";
    return "discrete";
  }
  const gtx = renderer.match(/\bgtx\s*(\d{3,4})\b/);
  if (gtx) {
    const n = Number(gtx[1]);
    // 1070 and 1080, and not the 16 series, which is numbered above them and is a step down.
    if (n >= 1070 && n < 1650) return "strong";
    if (n >= 960) return "discrete";
    return "weak";
  }
  if (/\bgt\s*\d/.test(renderer)) return "weak";
  return "discrete";
}

function amdKind(renderer) {
  if (!/radeon|\bamd\b/.test(renderer)) return null;
  const rx = renderer.match(/\brx\s*(\d{3,4})\b/);
  if (rx) {
    const n = Number(rx[1]);
    if (n >= 6700) return "strong";
    if (n >= 470) return "discrete";
    return "weak";
  }
  // The name of a Ryzen's own graphics, which carries no RX number.
  if (/radeon(?:\s*\(tm\))?\s+graphics\b/.test(renderer)) return "integrated-strong";
  if (/vega/.test(renderer)) return "discrete";
  if (/radeon\s+hd\b|\br5\b|\br7\b/.test(renderer)) return "weak";
  if (/radeon/.test(renderer)) return "discrete";
  return null;
}
