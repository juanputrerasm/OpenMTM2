/*
  Weather (MONSTER_EXE_ANALYSIS.md section 13). A track's weather mask allows weather n with
  bit n; the game draws a random one from the allowed set when asked to. What each weather
  does to the picture is in WEATHER_LOOK: the fog colours and distances are from the code
  (0x5753b0, 0x5745e0, 0x503210); the brightness, precipitation and light levels are the
  port's approximation of what the software renderer's fog tables did. Pure, so it runs under
  Node.
*/
export const WEATHER_NAMES = Object.freeze([
  "Clear", "Cloudy", "Foggy", "Dense Fog", "Rain", "Snow", "Dusk", "Night", "Pitch Black",
]);
export const WEATHER_COUNT = WEATHER_NAMES.length;

/**
 * Per weather:
 *  - `fogColor`: RGB 0..255 (code). `fogEndFt`: the fog's end distance in feet, or null for
 *    none. Foggy 320 ft, Dense Fog 128 ft and Snow 512 ft come from `viewRange * k * 8192 / 256`
 *    with k 10/16, 4/16 and 1; Rain, Dusk, Night and Pitch Black cut the view at 1024 ft
 *    (`0x503290`), which is softened here to a fade from `fogStartFt`.
 *  - `light`: the world's brightness, 1 is the daylight picture (it scales the ambient light);
 *    `sun`: the share of the sun's light that gets through.
 *  - `precipitation`: "rain", "snow" or null. `lightning`: rain only.
 *  - `headlights`: the trucks' lamps are lit (Dusk, Night and Pitch Black).
 */
export const WEATHER_LOOK = Object.freeze([
  { fogColor: [140, 140, 140], fogEndFt: null, light: 1, sun: 1, precipitation: null, lightning: false, headlights: false },
  { fogColor: [140, 140, 140], fogEndFt: null, light: 0.85, sun: 0.55, precipitation: null, lightning: false, headlights: false },
  { fogColor: [140, 140, 140], fogStartFt: 0, fogEndFt: 320, light: 0.9, sun: 0.6, precipitation: null, lightning: false, headlights: false },
  { fogColor: [139, 139, 139], fogStartFt: 0, fogEndFt: 128, light: 0.85, sun: 0.5, precipitation: null, lightning: false, headlights: false },
  { fogColor: [72, 74, 72], fogStartFt: 300, fogEndFt: 1024, light: 0.6, sun: 0.35, precipitation: "rain", lightning: true, headlights: false },
  { fogColor: [192, 192, 192], fogStartFt: 0, fogEndFt: 512, light: 0.95, sun: 0.6, precipitation: "snow", lightning: false, headlights: false },
  { fogColor: [0, 0, 0], fogStartFt: 400, fogEndFt: 1024, light: 0.5, sun: 0.5, precipitation: null, lightning: false, headlights: true },
  { fogColor: [0, 0, 0], fogStartFt: 250, fogEndFt: 1024, light: 0.25, sun: 0.15, precipitation: null, lightning: false, headlights: true },
  { fogColor: [0, 0, 0], fogStartFt: 120, fogEndFt: 800, light: 0.1, sun: 0, precipitation: null, lightning: false, headlights: true },
]);

/** The weather's name. */
export const weatherName = (weather) => WEATHER_NAMES[weather] ?? WEATHER_NAMES[0];

/** The weathers a track's mask allows, in order; clear when the mask allows none. */
export function allowedWeathers(mask) {
  const m = Number.isInteger(mask) ? mask : 0xffff;
  const out = WEATHER_NAMES.map((_, i) => i).filter((i) => (m >> i) & 1);
  return out.length ? out : [0];
}

/** A random allowed weather (`useRandomWeather`), `random()` in [0, 1). */
export function pickWeather(mask, random = Math.random) {
  const list = allowedWeathers(mask);
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** The weather to use: the chosen one if the track allows it, else the first it allows. "random" draws. */
export function resolveWeather(choice, mask, random = Math.random) {
  if (choice === "random") return pickWeather(mask, random);
  const list = allowedWeathers(mask);
  return list.includes(choice) ? choice : list[0];
}

/** The next allowed weather after `current` (GOLD mode's Ctrl+W), wrapping. */
export function nextWeather(current, mask) {
  const list = allowedWeathers(mask);
  return list[(Math.max(0, list.indexOf(current)) + 1) % list.length];
}

/** The sky art for a weather and the level's own sky stem (A section 13, 0x42b430). */
export function weatherSkyStem(weather, levelStem) {
  return { 4: "CCLOUDS", 6: "DUSKSKY", 7: "NITESKY", 8: "NITESKY" }[weather] ?? levelStem;
}
