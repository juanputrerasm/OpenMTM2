/*
  The frame rate tracker behind the FPS counter. Pure, so it runs under Node.

  Each drawn frame calls `update` with its length in seconds; the rate is one over the
  smoothed frame time, as the GOLD mode FRAME display reads it, so the two agree. The
  time is smoothed, not the rate: frames of 5 and 35 ms in turn are 50 a second, and
  smoothing their rates (200 and 29) read 114. The tracker
  also keeps the recent frame times so the debug view can show an average, the
  1% low and percentile frame times plus a graph.
*/

export function createFpsTracker({ initial = 60, smoothing = 0.1, history = 300 } = {}) {
  let frameS = 1 / initial;
  const frames = [];
  const limit = Math.max(10, Math.floor(history));
  const sortedMs = () => frames.map((dt) => dt * 1000).sort((a, b) => a - b);
  const percentileMs = (p) => {
    if (!frames.length) return 0;
    const sorted = sortedMs();
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[rank];
  };
  return {
    get fps() { return 1 / frameS; },
    /** How many frame times are kept for the average, lows and graph. */
    get count() { return frames.length; },
    /** The mean rate over the kept window: frames divided by their total time. */
    get average() {
      if (!frames.length) return 1 / frameS;
      let total = 0;
      for (const dt of frames) total += dt;
      return total > 0 ? frames.length / total : 1 / frameS;
    },
    /** The mean frame time over the kept window, milliseconds. */
    get avgMs() {
      if (!frames.length) return frameS * 1000;
      let total = 0;
      for (const dt of frames) total += dt;
      return (total / frames.length) * 1000;
    },
    /** The 95th and 99th percentile frame times, milliseconds. */
    get p95Ms() { return percentileMs(95); },
    get p99Ms() { return percentileMs(99); },
    /** The worst kept frame time, milliseconds. */
    get worstMs() {
      if (!frames.length) return 0;
      let worst = 0;
      for (const dt of frames) if (dt * 1000 > worst) worst = dt * 1000;
      return worst;
    },
    /**
     * The 1% low: the mean rate of the slowest 1% of kept frames (at least one
     * frame), so a single hitch reads as a dip. Zero with no frames yet.
     */
    get low1() {
      if (!frames.length) return 0;
      const sorted = sortedMs().reverse();
      const take = Math.max(1, Math.ceil(sorted.length * 0.01));
      let total = 0;
      for (let i = 0; i < take; i++) total += sorted[i] / 1000;
      return take / Math.max(1e-9, total);
    },
    /** The kept frame times in seconds, oldest first, for the graph. */
    samples() { return [...frames]; },
    update(dt) {
      if (!(dt > 0)) return 1 / frameS;
      frameS += (dt - frameS) * smoothing;
      frames.push(dt);
      while (frames.length > limit) frames.shift();
      return 1 / frameS;
    },
    reset() { frameS = 1 / initial; frames.length = 0; },
  };
}

/** The counter text for a rate: whole frames per second. */
export function formatFps(fps) {
  return `${Math.round(fps)} FPS`;
}
