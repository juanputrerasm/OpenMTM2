/*
  Full-screen art from the install: the race loading screen (MONSTER_EXE_ANALYSIS.md section 2,
  "UI screens"). `ART\DATA<h>.RAW` (KOTH for Summit Rumbles) holds `width x h` palette indices,
  `ART\DATA<h>.ACT` the palette, for the screen heights 200, 400 and 480.
*/
import { decodeActPalette, decodeIndexedImage } from "../vendor/openphotex/index.js";

const SIZES = Object.freeze({ 480: [640, 480], 400: [640, 400], 200: [320, 200] });

/** The loading screen as `{ width, height, rgba }`, or null when the install has none. */
export async function loadingScreen(vfs, { raceType = "circuit", height = 480 } = {}) {
  const base = raceType === "summit" ? "KOTH" : "DATA";
  for (const h of [height, 480, 400, 200]) {
    const size = SIZES[h];
    if (!size) continue;
    const raw = await vfs.read(`ART\\${base}${h}.RAW`);
    const palette = decodeActPalette(await vfs.read(`ART\\${base}${h}.ACT`));
    if (!raw || !palette || raw.length < size[0] * size[1]) continue;
    const image = decodeIndexedImage(raw, palette, size[0], size[1]);
    return { width: image.width, height: image.height, rgba: image.rgba };
  }
  return null;
}
