/*
  The weather and water effect art in `STARTUP.POD` (MONSTER_EXE_ANALYSIS.md 13), each a 64 x 64
  indexed image: `SNOFLAKS` (a 4 x 4 sheet of snowflakes), `NDROP1-3` (two raindrops each),
  `SNOW0-3` (grey cloud noise, the ice drawn over water in Snow, one per cell parity),
  `WAKEBLOB` (the soft blob of a wheel's spray), `SPLATRIP` (a ripple's rings) and `SPLAT1-2`
  (splashes) and `RIPPL100-800` (the eight frames of the water surface), `PUFF2_01-12` and `PUFF3_01-12` (the twelve frames of a dust puff, two kinds) and `TREAD` (a tire's tread). Black is background: they are drawn added to the picture, so no alpha is made.
*/
import { decodeActPalette, decodeIndexedImage } from "../vendor/openphotex/index.js";

const SIDE = 64;
const NAMES = {
  flakes: ["SNOFLAKS"], drops: ["NDROP1", "NDROP2", "NDROP3"], ice: ["SNOW0", "SNOW1", "SNOW2", "SNOW3"],
  blob: ["WAKEBLOB"], ripple: ["SPLATRIP"], splash: ["SPLAT1", "SPLAT2"],
  puff2: Array.from({ length: 12 }, (_, i) => `PUFF2_${String(i + 1).padStart(2, "0")}`),
  puff3: Array.from({ length: 12 }, (_, i) => `PUFF3_${String(i + 1).padStart(2, "0")}`),
  tread: ["TREAD"],
  water: ["RIPPL100", "RIPPL200", "RIPPL300", "RIPPL400", "RIPPL500", "RIPPL600", "RIPPL700", "RIPPL800"],
};

/** `{ flakes, drops[], ice[], blob, ripple, splash[], puff2[12], puff3[12], tread, water[] }` of `{ width, height, rgba }`; a missing file is null. */
export async function loadEffectsArt(vfs) {
  const load = async (stem) => {
    const raw = await vfs.read(`ART\\${stem}.RAW`);
    const act = await vfs.read(`ART\\${stem}.ACT`);
    if (!raw || !act || raw.length < SIDE * SIDE) return null;
    const palette = decodeActPalette(act);
    return palette ? { width: SIDE, height: SIDE, rgba: decodeIndexedImage(raw, palette, SIDE, SIDE).rgba } : null;
  };
  const out = {};
  for (const [key, stems] of Object.entries(NAMES)) {
    const images = await Promise.all(stems.map(load));
    out[key] = key === "flakes" || key === "blob" || key === "ripple" || key === "tread" ? images[0] : images;
  }
  return out;
}
