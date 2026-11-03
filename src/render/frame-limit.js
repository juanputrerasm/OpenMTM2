/*
  The frame rate limit (Options, Display, "Frame rate limit"). Pure, so it runs under Node.

  Each frame is given a due time one interval after the last one's due time, not after the
  moment it happened to be drawn. Frames then come evenly spaced at the chosen rate even when
  the clock that asks for them (the display's refresh, or the timer with V-sync off) ticks at a
  rate that does not divide it: 60 on a 75 Hz display draws four refreshes of five. A frame
  that comes later than a whole interval starts the schedule again from itself, so a stall is
  not followed by a burst of catch-up frames.
*/

/** The rates offered, frames a second. */
export const FPS_LIMITS = [24, 30, 45, 60, 75, 90, 120, 144, 240];
/** A tick this close to its due time is taken (ms): the timer and the refresh both jitter. */
const SLACK_MS = 0.75;

/** The interval the settings ask for in ms, or 0 for no limit. */
export function limitIntervalMs(settings) {
  if (!settings?.fpsLimit) return 0;
  const fps = Math.max(10, Math.min(1000, Number(settings.fpsLimitValue) || 60));
  return 1000 / fps;
}

export function createFrameLimiter() {
  let due = -Infinity;
  return {
    /** Whether a frame asked for at `now` (ms) is drawn under an interval of `intervalMs` (0: always). */
    take(now, intervalMs) {
      if (!(intervalMs > 0)) { due = -Infinity; return true; }
      if (now < due - SLACK_MS) return false;
      due = now - due > intervalMs ? now + intervalMs : due + intervalMs;
      return true;
    },
    /** Milliseconds until the next frame is due (0 when one is due now). */
    wait(now) { return Math.max(0, due - SLACK_MS - now); },
    reset() { due = -Infinity; },
  };
}
