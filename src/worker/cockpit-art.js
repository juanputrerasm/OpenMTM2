/*
  The cockpit art and the finder from `COCKPIT.POD` (MONSTER_EXE_ANALYSIS.md 11), the 640 x 480
  set: the layout of `DATA\POWERBIG.480`, the four panels, the 15 steering wheel frames, the six
  shifter frames, the shift light, the mirror frame, and the finder's ring, arrows and dots.
  Every image is `{ width, height, rgba }` with pure black cut out. The shifter and mirror
  frames have no palette of their own and use METALCR2's.
*/
import { decodeActPalette, decodeIndexedImage, parseCockpitLayout } from "../vendor/openphotex/index.js";

const stemOf = (name) => name.replace(/\.raw$/i, "").toUpperCase();
const WHEEL_KEYS = ["C00", ...[5, 10, 15, 20, 25, 30, 35].flatMap((d) => [`L${String(d).padStart(2, "0")}`, `R${String(d).padStart(2, "0")}`])];
const SHIFTER_KEYS = ["P", "R", "N", "1", "2", "3"];

/** `{ layout, panels, wheel, shifter, shiftLight, mirror, finder }`, or null without the install's cockpit. */
export async function loadCockpit(vfs) {
  const layoutBytes = await vfs.read("DATA\\POWERBIG.480");
  const layout = layoutBytes && parseCockpitLayout(layoutBytes);
  if (!layout) return null;
  // The shifter and mirror frame have no .ACT of their own; they are drawn in the game's METALCR2 palette (STARTUP.POD).
  const metalBytes = await vfs.read("ART\\METALCR2.ACT");
  const fallback = metalBytes ? decodeActPalette(metalBytes) : null;
  const sprite = async (stem, width, height) => {
    const raw = await vfs.read(`ART\\${stem}.RAW`);
    const own = await vfs.read(`ART\\${stem}.ACT`);
    const palette = own ? decodeActPalette(own) : fallback;
    if (!raw || !palette || raw.length < width * height) return null;
    return { width, height, rgba: decodeIndexedImage(raw, palette, width, height, { cutout: true }).rgba };
  };
  const [, , wheelW, wheelH] = layout.steeringWheel, [, , shiftW, shiftH] = layout.shifterRect;
  const [, , lightW, lightH] = layout.shiftLightRect, [, , mirW, mirH] = layout.mirrors[0]?.bitmapRect ?? [0, 0, 0, 0];
  const out = { layout: { ...layout, sections: undefined }, panels: {}, wheel: {}, shifter: {}, finder: {}, shiftLight: null, mirror: null };
  const jobs = [];
  const put = (target, key, promise) => jobs.push(promise.then((image) => { target[key] = image; }));
  ["front", "left", "right", "back"].forEach((name, n) => layout.backgrounds[n] && put(out.panels, name, sprite(stemOf(layout.backgrounds[n]), 640, 480)));
  for (const key of WHEEL_KEYS) put(out.wheel, key, sprite(`${layout.steeringWheelBase.toUpperCase()}${key}`, wheelW, wheelH));
  for (const key of SHIFTER_KEYS) put(out.shifter, key, sprite(`${layout.shifter.toUpperCase()}${key}`, shiftW, shiftH));
  put(out, "shiftLight", sprite(stemOf(layout.shiftLight), lightW, lightH));
  if (mirW) put(out, "mirror", sprite(stemOf(layout.mirrors[0].bitmap), mirW, mirH));
  put(out.finder, "ring", sprite("FI480", 60, 60));
  put(out.finder, "arrowGreen", sprite("FI480GA", 12, 6));
  put(out.finder, "arrowRed", sprite("FI480RA", 12, 6));
  put(out.finder, "dotGreen", sprite("FI480GD", 6, 6));
  put(out.finder, "dotRed", sprite("FI480RD", 6, 6));
  await Promise.all(jobs);
  return out;
}
