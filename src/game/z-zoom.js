/* Z mode's zoom, and the Z-mode cameras option's hold of it (ui/gold-mode.js). Pure, so it runs under Node. */

/** Z mode's zoom (MONSTER_EXE_ANALYSIS.md 11): the camera's 16.16 zoom value moves by 0x1000 within 0x1000..0x20000. */
export const ZOOM_ONE = 0x10000, ZOOM_STEP = 0x1000, ZOOM_MIN = 0x1000, ZOOM_MAX = 0x20000;
/** How much nearer a zoom value brings the view: 16 at 0x1000, a half at 0x20000. */
export const zoomFactor = (value) => ZOOM_ONE / value;
/**
 * A zoom key held (the port's own): after ZOOM_HOLD_S seconds the zoom goes on at ZOOM_HOLD_DOUBLINGS a second (from 1x
 * to 0.5x in one second), changing by the same proportion all the way.
 */
export const ZOOM_HOLD_S = 0.25, ZOOM_HOLD_DOUBLINGS = 1;
/** The next zoom value for a hold of `way` (-1 out, +1 in) over `dt` seconds, held to the game's range. */
export function heldZoom(value, way, dt) {
  if (!way || !(dt > 0)) return value;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value * 2 ** (-way * ZOOM_HOLD_DOUBLINGS * dt)));
}
/** A kept zoom value (`settings.zModeZoom`) if it is one, else null. */
export const keptZoom = (value) => (Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX ? value : null);
