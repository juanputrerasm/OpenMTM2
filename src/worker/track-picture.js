/*
  A track's picture on the Races screen: the art its SIT names after "Track Logo .BMP file" (worker/catalog.js
  `logoBmp`, the name's stem).

  CP3 2.0.52 (docs/CP3_EXE_ANALYSIS.md section 10) reads only that BMP. Traxx packs an HD picture beside it, a
  PNG or TGA with the same stem (UI\VALPO4S.BMP and UI\VALPO4S.PNG), and its notes say a later CP3 engine takes that
  first and falls back to the BMP (Traxx TrackPOD.h, "HD TRACK ART", citing cursh2 MenuDraw.cpp `hdSiblingName`). The
  port does the same now: the PNG, then the TGA, then the BMP. Each must be what its name says: a file that is not
  (a JPEG renamed .PNG, a TGA it cannot read) is passed over for the next, as CP3 passes over HD textures it cannot read.
  Pure apart from `encode`, so it runs under Node.
*/
import { decodeTga, detectImageFormat } from "./image-decoder.js";

/** The order the picture is looked for in, by extension. */
export const TRACK_PICTURE_ORDER = Object.freeze(["PNG", "TGA", "BMP"]);

/**
 * The picture for stem `stem`: `{ bytes, type }` for the browser to show (a TGA turned into a PNG by `encode`), or null.
 * `read(path)` gives a file's bytes from the mounted archives or null; `encode({ width, height, rgba })` gives PNG bytes,
 * or null where it cannot (no TGA is shown then).
 */
export async function readTrackPicture(read, stem, { encode = null } = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(stem ?? ""))) return null;
  const base = `UI\\${String(stem).toUpperCase()}`;
  for (const ext of TRACK_PICTURE_ORDER) {
    const bytes = await read(`${base}.${ext}`);
    if (!bytes?.length) continue;
    const format = detectImageFormat(bytes);
    if (ext === "PNG" && format === "PNG") return { bytes, type: "image/png" };
    if (ext === "BMP" && format === "BMP") return { bytes, type: "image/bmp" };
    // A TGA has no signature: anything that has one is not a TGA.
    if (ext === "TGA" && !format && encode) {
      try {
        const png = await encode(decodeTga(bytes, `${base}.TGA`));
        if (png?.length) return { bytes: png, type: "image/png" };
      } catch {
        // Not a TGA it can read: the BMP, if there is one.
      }
    }
  }
  return null;
}
