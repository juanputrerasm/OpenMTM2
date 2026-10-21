/*
  Frames held back while the graphics card is behind (docs/ARCHITECTURE.md, "Frame pacing").

  The browser asks for a frame at the display's rate and takes what a frame draws as fast as
  it is drawn, whether or not the graphics card has finished the frames before it. Where the
  card needs longer than the display's interval, the frames queue up in front of it: measured
  on an Intel HD 630 at 1920 x 1080, in a window on Wayland, a frame was finished 200 to
  400 ms after it was drawn, and every half second the browser stopped asking for frames for
  80 to 150 ms while the queue ran down. Those stops were the frames the FPS counter showed as
  its 1% low of 10, at an average of 50.

  So a frame is skipped while the card has `depth` frames still to finish: a fence is set
  behind each frame's draws, and a frame is drawn only once the oldest but `depth - 1` of
  them has passed. Two keep the card busy (one frame being drawn while the next waits) and the
  picture at most two frames behind; the frame rate is then what the card can draw, its
  frames evenly spaced, with no queue to run down.

  A fence is read without waiting (the browser updates its state between tasks), and one that
  has not passed in `MAX_WAIT_MS` is let go, so a driver that never signals one costs the
  pacing and not the game. Plain WebGL 2, so it runs under Node against a stand-in context.
*/

/** The frames the graphics card may have to finish before another is drawn. */
export const PACE_DEPTH = 2;
/** A fence older than this is given up on, ms. */
export const MAX_WAIT_MS = 1000;

/**
 * @param {WebGL2RenderingContext} gl
 * @param {{ depth?: number, maxWaitMs?: number }} [options]
 */
export function createGpuPacer(gl, { depth = PACE_DEPTH, maxWaitMs = MAX_WAIT_MS } = {}) {
  const usable = !!gl && typeof gl.fenceSync === "function" && typeof gl.getSyncParameter === "function";
  /** The fences not yet seen to pass, oldest first: `{ sync, at }`. */
  const fences = [];
  const drop = () => {
    const { sync } = fences.shift();
    try { gl.deleteSync(sync); } catch { /* a lost context has no syncs to delete */ }
  };
  const clear = () => { while (fences.length) drop(); };
  return {
    /** How many frames the card has still to finish. */
    get pending() { return fences.length; },
    /** Whether the card is too far behind for a frame to be drawn now (`now` in ms, performance.now()). */
    behind(now) {
      if (!usable) return false;
      if (gl.isContextLost?.()) { clear(); return false; }
      // Fences pass in the order they were set: the oldest first.
      while (fences.length) {
        const { sync, at } = fences[0];
        const status = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.SIGNALED || status === null || now - at > maxWaitMs) drop();
        else break;
      }
      return fences.length >= depth;
    },
    /** After a frame's draws: the fence the next frames wait on. */
    drawn(now) {
      if (!usable || gl.isContextLost?.()) return;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) return;
      fences.push({ sync, at: now });
      // Sent to the card now, not when the frame's task ends, so it passes as soon as the frame is drawn.
      gl.flush();
    },
    /** Forget every fence: the frames are drawn somewhere else for a while (a headset's session). */
    reset: clear,
  };
}
