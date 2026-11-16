/*
  The light, by weather, for "Natural light" (docs/VISUALS.md, "Light"). The game lit its models
  with one white sun and a white ambient term, and its ground not at all (the .LTE's baked
  brightness). What is here is the port's: a sun with the colour of its hour, the sky's light
  from above and the ground's from below, each in the colours of the level's own sky and
  ground, and a curve that rolls bright light off instead of clipping it.

  The game's own facts are kept: the level's sun direction (the LVL's sun vector), each
  weather's sky art, and how dark the port already drew each weather (game/weather.js).

  Colours are linear RGB, 0 to 1. Pure, so it runs under Node.
*/
import { WEATHER_LOOK } from "./weather.js";

/*
  Per weather:
   - `sun`: the sun's colour and its strength as three.js counts a directional light (a face
     square to it is lit by `strength / pi` of its colour). At Night it is the moon, which the
     game draws where the sun stands.
   - `sky`: the strength of the light from the sky dome, and `tint` how much of the sky art's
     own colour it takes (the rest is white).
   - `bounce`: how much of the light that falls on level ground comes back up off it, in the
     ground's own colour.
   - `shadow`: how dark a shadow is, 0 to 1. Under an overcast sky the sun's light is spread
     over the whole sky and shadows are faint.
   - `elevationDeg`: where the port puts the sun instead of the level's own height, keeping
     its bearing. Dusk has it low, so shadows are long; the game says nothing about where the
     sun is at Dusk, and draws no disc for it.
*/
const RIGS = Object.freeze({
  0: Object.freeze({ sun: [1, 0.94, 0.82], sunStrength: 3.7, skyStrength: 0.95, tint: 0.7, bounce: 0.34, shadow: 1 }),
  1: Object.freeze({ sun: [1, 0.97, 0.92], sunStrength: 1.7, skyStrength: 1.45, tint: 0.35, bounce: 0.3, shadow: 0.62 }),
  2: Object.freeze({ sun: [1, 0.97, 0.9], sunStrength: 1.15, skyStrength: 1.6, tint: 0.2, bounce: 0.28, shadow: 0.4 }),
  3: Object.freeze({ sun: [1, 0.97, 0.92], sunStrength: 0.6, skyStrength: 1.7, tint: 0.15, bounce: 0.26, shadow: 0.22 }),
  4: Object.freeze({ sun: [0.82, 0.88, 1], sunStrength: 0.5, skyStrength: 1.05, tint: 0.45, bounce: 0.2, shadow: 0.3 }),
  5: Object.freeze({ sun: [1, 0.98, 0.95], sunStrength: 0.95, skyStrength: 1.7, tint: 0.25, bounce: 0.5, shadow: 0.4 }),
  6: Object.freeze({ sun: [1, 0.5, 0.2], sunStrength: 2.9, skyStrength: 0.62, tint: 0.85, bounce: 0.3, shadow: 1, elevationDeg: 11 }),
  7: Object.freeze({ sun: [0.5, 0.64, 1], sunStrength: 0.85, skyStrength: 0.2, tint: 0.8, bounce: 0.25, shadow: 0.9 }),
  8: Object.freeze({ sun: [0.5, 0.64, 1], sunStrength: 0, skyStrength: 0.055, tint: 0.5, bounce: 0.2, shadow: 0 }),
});

/**
 * A stadium has a roof and no sky (the game draws the stadium in the sky's place): it is lit by
 * its floodlights, whatever the weather outside. White light from all round, a white lamp
 * along the level's sun direction so that things still stand on a shadow, and that shadow soft,
 * as under many lamps.
 */
const FLOODLIT = Object.freeze({ sun: [1, 0.98, 0.94], sunStrength: 1.9, skyStrength: 1.75, tint: 0, bounce: 0.3, shadow: 0.55 });

/** The sky's colours when the level has no sky art to take them from (a stadium): a clear day's. */
export const DEFAULT_TONES = Object.freeze({ zenith: Object.freeze([0.22, 0.4, 0.62]), horizon: Object.freeze([0.55, 0.7, 0.84]) });
/** The ground's colour when there is no ground art to take it from. */
export const DEFAULT_GROUND = Object.freeze([0.2, 0.16, 0.12]);

const toLinear = (byte) => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The mean colour of rows `from` to `to` (shares of the height) of an RGBA image, linear. */
function meanOfRows({ rgba, width, height }, from, to) {
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(from * height))), y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(to * height)));
  const sum = [0, 0, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      sum[0] += toLinear(rgba[o]); sum[1] += toLinear(rgba[o + 1]); sum[2] += toLinear(rgba[o + 2]);
    }
  }
  const n = (y1 - y0) * width;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/**
 * The sky art's colours overhead and at the horizon. The dome reads the picture's top rows at
 * 67.5 degrees and its bottom rows at the horizon (MONSTER_EXE_ANALYSIS.md 11c), so the top
 * quarter is the zenith and the bottom fifth the horizon.
 */
export function skyTones(image) {
  if (!image?.rgba?.length) return { zenith: [...DEFAULT_TONES.zenith], horizon: [...DEFAULT_TONES.horizon] };
  return { zenith: meanOfRows(image, 0, 0.25), horizon: meanOfRows(image, 0.8, 1) };
}

/** The mean colour of an RGBA image, linear: the ground art's, for the light the ground throws back. */
export function meanTone(image) {
  if (!image?.rgba?.length) return [...DEFAULT_GROUND];
  // A large atlas is read every few texels: its mean does not need them all.
  const { rgba } = image, step = Math.max(1, Math.floor(rgba.length / 4 / 65536)) * 4;
  const sum = [0, 0, 0];
  let n = 0;
  for (let o = 0; o < rgba.length; o += step) { sum[0] += toLinear(rgba[o]); sum[1] += toLinear(rgba[o + 1]); sum[2] += toLinear(rgba[o + 2]); n++; }
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/**
 * The mean colour of each tile of the terrain's atlas (worker/terrain-mesh.js `buildTerrainAtlas`:
 * `slots` tiles of `tileSide` texels, `padding` round each, in rows), linear: what each of the
 * level's ground textures looks like on the whole, for the dust raised off it.
 */
export function tileTones({ rgba, width, tileSide = 64, padding = 0, slots = 1 }) {
  const pitch = tileSide + padding * 2, columns = Math.max(1, Math.round(width / pitch));
  const step = Math.max(1, tileSide >> 4);
  return Array.from({ length: slots }, (_, slot) => {
    const x0 = (slot % columns) * pitch + padding, y0 = Math.floor(slot / columns) * pitch + padding;
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < tileSide; y += step) {
      for (let x = 0; x < tileSide; x += step) {
        const o = ((y0 + y) * width + x0 + x) * 4;
        if (o + 2 >= rgba.length) continue;
        sum[0] += toLinear(rgba[o]); sum[1] += toLinear(rgba[o + 1]); sum[2] += toLinear(rgba[o + 2]); n++;
      }
    }
    return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : [...DEFAULT_GROUND];
  });
}

/**
 * A colour's hue at a luminance of 1, mixed with white: `amount` 0 is white, 1 the hue itself.
 * A colour next to black has no hue to speak of (a night sky's art is black overhead), and
 * gives white.
 */
function hueOf(color, amount) {
  const l = luma(color), has = Math.min(1, l / 0.02);
  return color.map((c) => 1 + ((c / Math.max(l, 1e-4)) - 1) * amount * has);
}

/**
 * The way to the sun for a weather: the level's own (`toSun`, a unit vector with y up), or
 * that bearing at the weather's own height above the horizon.
 */
export function sunDirection(weather, toSun, { indoor = false } = {}) {
  const rig = indoor ? FLOODLIT : RIGS[weather] ?? RIGS[0];
  const length = Math.hypot(toSun[0], toSun[1], toSun[2]) || 1;
  const unit = [toSun[0] / length, toSun[1] / length, toSun[2] / length];
  if (rig.elevationDeg === undefined) return unit;
  const flat = Math.hypot(unit[0], unit[2]);
  // A sun straight overhead has no bearing to keep: it comes down toward +x.
  const bx = flat > 1e-4 ? unit[0] / flat : 1, bz = flat > 1e-4 ? unit[2] / flat : 0;
  const elevation = (rig.elevationDeg * Math.PI) / 180;
  return [bx * Math.cos(elevation), Math.sin(elevation), bz * Math.cos(elevation)];
}

/**
 * Whether the sun is below the horizon (`toSun`, the way to it, y up): then it gives no direct light. Community Patch 4's
 * own formulas give none there (docs/CP4_EXE_ANALYSIS.md 15.8): its bake marches each texel's ray toward the sun, which
 * meets the ground, and its glint is Blinn about the way to the sun.
 */
export const sunBelowHorizon = (toSun) => !(toSun[1] > 0);

/**
 * The lights for a weather.
 *
 * @param {number} weather
 * @param {{ zenith?: number[], horizon?: number[], ground?: number[], toSun?: number[], flash?: number, indoor?: boolean }} [scene]
 *   `zenith` and `horizon` the sky art's colours (`skyTones`), `ground` the ground art's mean
 *   colour (`meanTone`), `toSun` the way to the sun, `flash` lightning's extra light (the
 *   weather scene's, 0 when there is none), `indoor` a stadium, lit by its floodlights.
 * @returns {{ sun: { color: number[], strength: number }, sky: number[], ground: number[], shadow: number }}
 *   `sky` and `ground` are the colours of a hemisphere light of strength 1: what a face
 *   looking straight up and one looking straight down receive.
 */
export function lightRig(weather, { zenith = DEFAULT_TONES.zenith, ground = DEFAULT_GROUND, toSun = [0, 1, 0], flash = 0, indoor = false } = {}) {
  const look = WEATHER_LOOK[weather] ?? WEATHER_LOOK[0];
  const rig = indoor ? FLOODLIT : RIGS[weather] ?? RIGS[0];
  // Lightning lifts everything for an instant, as the weather scene lifts its own lights: by the flash over the weather's own light.
  const lift = Math.min(3, look.light + flash) / look.light;
  const way = sunDirection(weather, toSun, { indoor });
  // A sun below the horizon lights nothing (`sunBelowHorizon`).
  const sunStrength = sunBelowHorizon(way) ? 0 : rig.sunStrength * lift;
  const sky = hueOf(zenith, rig.tint).map((c) => c * rig.skyStrength * lift);
  // What level ground receives, which it throws back in its own colour.
  const height = Math.max(0, way[1]);
  const falling = rig.sun.map((c, i) => c * sunStrength * height + sky[i]);
  return {
    sun: { color: [...rig.sun], strength: sunStrength },
    sky,
    ground: ground.map((c, i) => c * falling[i] * rig.bounce),
    // A flash is the sky's own light: for its instant the sun's shadows fade.
    shadow: rig.shadow / lift,
  };
}

/**
 * The curve bright light is rolled off by. Up to the knee a colour is shown as it is, so the
 * game's art keeps its colours; above it the brightest channel is eased toward 1, which it
 * reaches only at infinity, and the colour pales as it nears it, as a bright light does on
 * film. `toneCurve` is the same arithmetic as the shader's (render/light-rig.js).
 */
export const TONE_KNEE = 0.7, TONE_PALE = 0.18;
export function toneCurve(color) {
  const peak = Math.max(color[0], color[1], color[2]);
  if (peak <= TONE_KNEE) return [...color];
  const room = 1 - TONE_KNEE;
  const eased = 1 - (room * room) / (peak + room - TONE_KNEE);
  const pale = 1 - 1 / (TONE_PALE * (peak - eased) + 1);
  return color.map((c) => { const scaled = (c * eased) / peak; return scaled + (eased - scaled) * pale; });
}

/**
 * Where the sun's shadow cascades end, feet from the eye (render/sun-shadows.js); the last
 * runs on to `SHADOW_FAR_FT`. The first is short, so a truck's shadow is sharp enough to show
 * its tires.
 */
export const SHADOW_CASCADE_ENDS_FT = Object.freeze([150, 560, 1900]);
export const SHADOW_FAR_FT = 6400;

/**
 * The shade under a truck (render/contact-shade.js): the sky lights the ground from every
 * side, and a truck keeps a good part of it off the ground beneath. How dark the patch is at
 * its middle, 0 to 1: `SHADE_DARKEST` under a truck standing on the ground where the sun casts
 * no shadow of its own, less where it does (`sunShadow`, a rig's `shadow`), and less as the
 * wheels' undersides leave the ground (`clearFt`), none from `SHADE_GONE_FT`.
 */
export const SHADE_DARKEST = 0.5, SHADE_GONE_FT = 9;
export function contactShade(clearFt, sunShadow = 1) {
  const near = Math.max(0, 1 - Math.max(0, clearFt) / SHADE_GONE_FT);
  return SHADE_DARKEST * (1 - 0.45 * Math.min(1, Math.max(0, sunShadow))) * near * near;
}

/**
 * Paint that shines (render/gloss.js). `faceOn` and `glancing` are the share of its
 * surroundings paint mirrors seen square on and at a glancing angle; `wet` how many times as
 * strongly everything shines in Rain; `parts` how strongly each part of a truck shines against
 * its body's paint (a part's glint goes by the square of that). Rubber does not shine at all:
 * a tire is matt.
 *
 * The trucks are a few flat faces each, and a flat face mirrors one thing all over: seen from
 * a chase camera a whole side panel took on the ground's colour, or the sky's, at once. So a
 * face is taken as `round` of the way from flat to the bulge of a body that size (`bulge`, a
 * truck's half width, height and length, feet): what it mirrors then changes across it, as
 * across a real panel, which is never flat, and the sun's glint is a highlight on it and not
 * the whole face lit. `broadGlint` is the strength of the wide glint round the sharp one.
 */
export const PAINT = Object.freeze({
  faceOn: 0.04, glancing: 0.26, wet: 1.5, round: 0.5, bulge: Object.freeze([3.4, 3, 9.2]), broadGlint: 0.03,
  parts: Object.freeze({ body: 1, tire: 0, gear: 0.3 }),
});

/**
 * The lens (render/lens.js). Light begins to glow at `glowFrom` (1 is the screen's white) and
 * glows in full from `glowFull`; `corners` is how much darker the picture's corners are;
 * nothing in the picture is kept brighter than `brightest` times white.
 */
export const LENS = Object.freeze({ glowFrom: 0.95, glowFull: 1.5, corners: 0.16, brightest: 24 });
