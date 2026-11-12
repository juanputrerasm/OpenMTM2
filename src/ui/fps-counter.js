/*
  The toggleable FPS counter: a small debug panel in the corner of a race or replay.
  The rate itself is tracked by the pure game/fps.js tracker; this only owns the
  element, its text and the frame time graph. The flat screen only: a headset draws
  to its own display.
*/
import { createFpsTracker, formatFps } from "../game/fps.js";
import { el } from "./dom.js";

/** Frame times at or under this read as good (60 FPS) on the graph, milliseconds. */
export const FPS_GOOD_MS = 1000 / 60;
/** Frame times at or under this read as okay (30 FPS) on the graph, milliseconds. */
export const FPS_OKAY_MS = 1000 / 30;
/** The graph clips frame times above this, milliseconds. */
export const FPS_GRAPH_MAX_MS = 50;
const GRAPH_WIDTH = 200, GRAPH_HEIGHT = 48, TEXT_MS = 250;

function barColor(ms) {
  if (ms <= FPS_GOOD_MS) return "#7fd67f";
  if (ms <= FPS_OKAY_MS) return "#f2c14e";
  return "#e05555";
}

/**
 * `title` is the panel's hint (translated by the caller). `report()`, when given, returns lines about the race (the
 * track, the settings, the graphics chip) that a click on the panel copies with its figures: what a player can paste
 * into a report of a slow race.
 */
export function createFpsCounter({ visible = false, title = null, report = null } = {}) {
  const main = el("div", { class: "fps-main" }, formatFps(60));
  const sub = el("div", { class: "fps-sub" }, "warming up");
  // The simulation's side, where a screen reports it (`noteSim`): a truck that moves in jumps while the frames come
  // steadily shows here, as replies that come late or few steps a second.
  const simLine = el("div", { class: "fps-sub", hidden: true });
  // What the frame cost to draw, where a screen reports it (`noteDraw`): a frame held up by the number of things drawn
  // rather than by the points filled shows here.
  const drawLine = el("div", { class: "fps-sub", hidden: true });
  const text = el("div", { class: "fps-counter-text" }, main, sub, simLine, drawLine);
  const graph = el("canvas", { class: "fps-graph", width: GRAPH_WIDTH, height: GRAPH_HEIGHT });
  graph.setAttribute("aria-hidden", "true");
  const element = el("div", { class: "fps-counter", hidden: !visible }, text, graph);
  if (title) element.title = title;
  /** The panel's figures and the screen's own lines, as text. */
  const reportText = () => [main, sub, simLine, drawLine].filter((line) => !line.hidden).map((line) => line.textContent)
    .concat(report ? report() : []).filter(Boolean).join("\n");
  element.addEventListener("click", () => {
    const copied = globalThis.navigator?.clipboard?.writeText?.(reportText());
    if (!copied) return;
    copied.then(() => {
      element.classList.add("fps-copied");
      setTimeout(() => element.classList.remove("fps-copied"), 600);
    }, () => { /* the browser would not hand over the clipboard: nothing to say */ });
  });
  const tracker = createFpsTracker();
  const ctx = graph.getContext("2d");
  let shown = !!visible;
  let lastText = -TEXT_MS;

  const drawGraph = () => {
    const samples = tracker.samples();
    ctx.clearRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);
    // Guide lines for 60 FPS and 30 FPS.
    for (const ms of [FPS_GOOD_MS, FPS_OKAY_MS]) {
      const y = Math.round(GRAPH_HEIGHT - (Math.min(ms, FPS_GRAPH_MAX_MS) / FPS_GRAPH_MAX_MS) * GRAPH_HEIGHT) + 0.5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(GRAPH_WIDTH, y);
      ctx.stroke();
    }
    if (!samples.length) return;
    // One column per pixel: the worst frame in the column, so hitches stay visible.
    for (let x = 0; x < GRAPH_WIDTH; x++) {
      const from = Math.floor((x / GRAPH_WIDTH) * samples.length);
      const to = Math.max(from + 1, Math.floor(((x + 1) / GRAPH_WIDTH) * samples.length));
      let worst = 0;
      for (let i = from; i < to; i++) {
        const ms = samples[i] * 1000;
        if (ms > worst) worst = ms;
      }
      const h = Math.max(1, Math.round((Math.min(worst, FPS_GRAPH_MAX_MS) / FPS_GRAPH_MAX_MS) * GRAPH_HEIGHT));
      ctx.fillStyle = barColor(worst);
      ctx.fillRect(x, GRAPH_HEIGHT - h, 1, h);
    }
  };

  // One second's simulation replies: how many, the steps they carried, the longest wait between two, the slowest round trip.
  let simFrom = 0, simReplies = 0, simSteps = 0, simGap = 0, simTrip = 0, simLast = 0;
  const noteSim = (now, steps, tripMs) => {
    if (simLast) simGap = Math.max(simGap, now - simLast);
    simLast = now;
    simReplies++; simSteps += steps; simTrip = Math.max(simTrip, tripMs);
    if (now - simFrom < 1000) return;
    const secs = (now - simFrom) / 1000;
    simLine.hidden = false;
    simLine.textContent = `sim ${Math.round(simSteps / secs)} steps/s, ${Math.round(simReplies / secs)} replies/s, gap ${simGap.toFixed(0)} ms, trip ${simTrip.toFixed(1)} ms`;
    simFrom = now; simReplies = 0; simSteps = 0; simGap = 0; simTrip = 0;
  };

  // The last second's draws: three.js's count of draw calls and triangles for a frame's picture, averaged.
  let drawFrom = 0, drawFrames = 0, drawCalls = 0, drawTriangles = 0;
  const noteDraw = (now, calls, triangles) => {
    drawFrames++; drawCalls += calls; drawTriangles += triangles;
    if (now - drawFrom < 1000) return;
    drawLine.hidden = false;
    drawLine.textContent = `draw ${Math.round(drawCalls / drawFrames)} calls, ${Math.round(drawTriangles / drawFrames / 1000)}k triangles`;
    drawFrom = now; drawFrames = 0; drawCalls = 0; drawTriangles = 0;
  };

  const writeText = () => {
    main.textContent = `${Math.round(tracker.fps)} FPS avg ${Math.round(tracker.average)} 1% low ${Math.round(tracker.low1)}`;
    sub.textContent = `${tracker.avgMs.toFixed(1)} ms avg ${tracker.p99Ms.toFixed(1)} ms p99 ${tracker.worstMs.toFixed(1)} ms worst (${tracker.count})`;
  };

  return {
    element, noteSim, noteDraw, reportText,
    get visible() { return shown; },
    get stats() {
      return {
        fps: tracker.fps, average: tracker.average, low1: tracker.low1,
        avgMs: tracker.avgMs, p95Ms: tracker.p95Ms, p99Ms: tracker.p99Ms,
        worstMs: tracker.worstMs, count: tracker.count,
      };
    },
    setVisible(on) {
      shown = !!on;
      element.hidden = !shown;
      if (shown) { lastText = -TEXT_MS; drawGraph(); writeText(); }
    },
    toggle() {
      this.setVisible(!shown);
      return shown;
    },
    /** A drawn frame of `dt` seconds: smooth the rate, draw the graph and refresh the text when shown. */
    update(dt, now) {
      const fps = tracker.update(dt);
      if (!shown) return fps;
      drawGraph();
      const t = now ?? (typeof performance === "undefined" ? Date.now() : performance.now());
      if (t - lastText < TEXT_MS) return fps;
      lastText = t;
      writeText();
      return fps;
    },
  };
}
