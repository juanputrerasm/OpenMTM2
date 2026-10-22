/*
  The player's VR preferences (docs/VR.md, "Options"), kept under `vr` in the settings
  (app/settings.js). Pure, so it runs under Node.
*/
import { cleanSeatOffset } from "./seat.js";
import { msg } from "../strings.js";

/** The views the camera key cycles through in a headset, with the chase seats' places, feet. */
export const VR_VIEWS = Object.freeze([
  Object.freeze({ id: "cab", name: msg("Cab") }),
  Object.freeze({ id: "chaseNear", name: msg("Chase Near"), back: 28, up: 8 }),
  Object.freeze({ id: "chaseFar", name: msg("Chase Far"), back: 50, up: 14 }),
]);

/**
 * How far a headset draws, by the option's name: the weather's own range, or a nearer one for a
 * headset that cannot keep its frame rate (docs/VR.md, "What it costs"). Feet.
 */
export const VIEW_DISTANCES = Object.freeze([
  Object.freeze({ id: "full", name: msg("Full"), feet: Infinity }),
  Object.freeze({ id: "medium", name: msg("Medium"), feet: 4000 }),
  Object.freeze({ id: "short", name: msg("Short"), feet: 2500 }),
]);

/** What the cab view shows around the driver: the modelled cage, or the stock panels. */
export const CAB_STYLES = Object.freeze([
  Object.freeze({ id: "model", name: msg("Modelled") }),
  Object.freeze({ id: "panels", name: msg("Stock panels") }),
]);

export const DEFAULT_VR = Object.freeze({
  view: "cab",          // the view a race opens in, one of VR_VIEWS
  horizonLock: true,    // cab view: the horizon stays level and the truck pitches and rolls around the driver
  hud: true,            // the timing panel and gauges
  cab: true,            // something around the driver in the cab view
  cabStyle: "model",    // what it is, one of CAB_STYLES: the modelled cage, or the stock panels
  steering: "stick",    // "stick", or "wheel": the hands held as on a steering wheel
  renderScale: 1,       // the eye buffers' size against the headset's own, 0.5 to 1.5
  foveation: 1,         // 0 none to 1 most: how far the edges of the view drop in resolution
  viewDistance: "full", // how far the headset draws, one of VIEW_DISTANCES
  seats: Object.freeze({}), // per truck file: feet [right, up, forward] added to the eye point
});

const clamp = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);

/** Stored preferences brought into shape; anything unusable becomes the default. */
export function vrSettings(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  const seats = {};
  for (const [file, offset] of Object.entries(s.seats && typeof s.seats === "object" ? s.seats : {})) {
    const clean = cleanSeatOffset(offset);
    if (clean.some((v) => v !== 0)) seats[file.toUpperCase()] = clean;
  }
  return {
    view: VR_VIEWS.some((v) => v.id === s.view) ? s.view : DEFAULT_VR.view,
    horizonLock: typeof s.horizonLock === "boolean" ? s.horizonLock : DEFAULT_VR.horizonLock,
    hud: typeof s.hud === "boolean" ? s.hud : DEFAULT_VR.hud,
    cab: typeof s.cab === "boolean" ? s.cab : DEFAULT_VR.cab,
    cabStyle: CAB_STYLES.some((v) => v.id === s.cabStyle) ? s.cabStyle : DEFAULT_VR.cabStyle,
    steering: s.steering === "wheel" ? "wheel" : "stick",
    renderScale: clamp(s.renderScale, 0.5, 1.5, DEFAULT_VR.renderScale),
    foveation: clamp(s.foveation, 0, 1, DEFAULT_VR.foveation),
    viewDistance: VIEW_DISTANCES.some((v) => v.id === s.viewDistance) ? s.viewDistance : DEFAULT_VR.viewDistance,
    seats,
  };
}

/**
 * How far the eye sees, feet, for a weather whose fog starts at `near` and ends at `far`, with the
 * headset's view distance `id`: `{ near, far }` for the fog. A nearer limit draws the fog in,
 * keeping its proportions, so nothing is seen to end; it never lets the eye see further than the
 * weather does.
 */
export function viewRange(id, near, far) {
  const limit = (VIEW_DISTANCES.find((v) => v.id === id) ?? VIEW_DISTANCES[0]).feet;
  if (!(far > 0) || limit >= far) return { near, far };
  return { near: near * limit / far, far: limit };
}

/** The view after `id` in the cycle. */
export function nextVrView(id) {
  const i = VR_VIEWS.findIndex((v) => v.id === id);
  return VR_VIEWS[(i + 1) % VR_VIEWS.length].id;
}

export const vrView = (id) => VR_VIEWS.find((v) => v.id === id) ?? VR_VIEWS[0];

/** The player's seat offset for a truck, feet [right, up, forward]. */
export function seatOffsetFor(vr, truckFile) {
  return cleanSeatOffset(vr?.seats?.[String(truckFile).toUpperCase()]);
}

/** The preferences with a truck's seat offset replaced (dropped when it is zero). */
export function withSeatOffset(vr, truckFile, offset) {
  const seats = { ...(vr?.seats ?? {}) };
  const clean = cleanSeatOffset(offset);
  const key = String(truckFile).toUpperCase();
  if (clean.some((v) => v !== 0)) seats[key] = clean; else delete seats[key];
  return { ...vr, seats };
}
