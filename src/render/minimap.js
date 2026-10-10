/*
  The course map (the Map key), an overlay on the 3D window (MONSTER_EXE_ANALYSIS.md 11, routine
  0x4e2410): the primary course drawn as a road outline, centred on the player's truck (a little right of and below the screen's middle, where the
  game puts it) and turning with its heading, so the truck always points up. Each truck is a small plus with its
  place number beside it (its name too when the Names key is on); the player's label is
  brighter. The road is the straights' end points joined in order into a closed loop (0x4e1e90),
  with a second outline 48 ft either side of it along each corner's bisector (0x4e2160).
*/
import { drawText, textWidth } from "./bitmap-text.js";

/** Half the road's drawn width, feet (3072 in the map's 1/64 ft units). */
export const MAP_HALF_WIDTH_FT = 48;
/** Map pixels per foot at 480 lines; the game's projection is fixed, so is this. */
export const MAP_PIXELS_PER_FOOT = 0.09;
/** Where the player sits on the screen, as fractions of its width and height: measured in two retail screenshots. */
export const MAP_ORIGIN = Object.freeze([0.75, 0.52]);
const MAX_POINTS = 512;

/** The centre line, `[x, z]` feet: each straight's start then end, in course order. */
export function courseLoop(course) {
  const points = [];
  for (const g of course) {
    if (g.ctype !== undefined && g.ctype !== 1) continue;
    if (!g.startFt || !g.endFt) continue;
    points.push([g.startFt[0], g.startFt[2]], [g.endFt[0], g.endFt[2]]);
    if (points.length >= MAX_POINTS) break;
  }
  return points;
}

const unit = (x, z) => { const l = Math.hypot(x, z); return l ? [x / l, z / l] : [0, 0]; };

/** Each point's offset vector (length `MAP_HALF_WIDTH_FT`): the bisector of the two edges, or the path's normal when they are almost in line, always on the same side of the path. */
export function edgeOffsets(points, half = MAP_HALF_WIDTH_FT, open = false) {
  const n = points.length;
  return points.map((p, i) => {
    let prev = points[(i + n - 1) % n], next = points[(i + 1) % n];
    // A one-way course has two ends, which carry on straight: the missing neighbour is the other one mirrored.
    if (open && i === 0) prev = [2 * p[0] - next[0], 2 * p[1] - next[1]];
    if (open && i === n - 1) next = [2 * p[0] - prev[0], 2 * p[1] - prev[1]];
    const a = unit(prev[0] - p[0], prev[1] - p[1]), b = unit(next[0] - p[0], next[1] - p[1]);
    const dot = a[0] * b[0] + a[1] * b[1];
    let v = unit(a[0] + b[0], a[1] + b[1]);
    if (Math.abs(dot) > 0.98 || (v[0] === 0 && v[1] === 0)) {
      const along = unit(next[0] - prev[0], next[1] - prev[1]);
      v = [-along[1], along[0]];
    }
    // Every offset is turned to the same side of the path: the bisector must lie clockwise (a positive
    // 16-bit angle, from +z) of the edge back to the previous point, or it is reversed (0x4e2160).
    const turn = Math.atan2(v[0], v[1]) - Math.atan2(prev[0] - p[0], prev[1] - p[1]);
    const signed = ((turn + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (signed < 0) v = [-v[0], -v[1]];
    return [v[0] * half, v[1] * half];
  });
}

/**
 * A point on the map for a player at `(px, pz)` heading `psi` (the truck faces `(sin psi, cos psi)`):
 * forward is up. Returns offsets in feet `[right, up]`.
 */
export function toMapFrame(x, z, px, pz, psi) {
  const dx = x - px, dz = z - pz;
  const s = Math.sin(psi), c = Math.cos(psi);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** `open`: a one-way course (a rally from A to B) is drawn with its start and its end closed off, not joined. */
export function createCourseMap(course, { font = null, open = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "race-minimap";
  canvas.hidden = true;
  const ctx = canvas.getContext("2d");
  const loop = courseLoop(course);
  const offsets = loop.length > 2 ? edgeOffsets(loop, MAP_HALF_WIDTH_FT, open) : [];
  let shown = false, blink = 0;

  function fit() {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 640, h = canvas.clientHeight || canvas.parentElement?.clientHeight || 480;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return [w, h];
  }

  return {
    element: canvas,
    get visible() { return shown; },
    toggle() { shown = !shown; canvas.hidden = !shown; return shown; },
    setVisible(on) { shown = !!on; canvas.hidden = !shown; },
    /**
     * `trucks`: `{ pos, heading, place, label }` in game feet, the player first; `label` (a truck's or a driver's
     * name, or null) is shown with the place (the Names key, game/names.js).
     */
    set(trucks, dt = 0.016) {
      if (!shown) return;
      const [w, h] = fit();
      ctx.clearRect(0, 0, w, h);
      const me = trucks[0];
      if (!me) return;
      const k = (h / 480) * MAP_PIXELS_PER_FOOT, cx = w * MAP_ORIGIN[0], cy = h * MAP_ORIGIN[1];
      const px = (x, z) => { const [r, u] = toMapFrame(x, z, me.pos[0], me.pos[2], me.heading); return [cx + r * k, cy - u * k]; };
      if (loop.length > 2) {
        ctx.lineWidth = Math.max(1, h / 480);
        ctx.strokeStyle = "rgba(225,225,225,.85)";
        for (const sign of [1, -1]) {
          ctx.beginPath();
          loop.forEach((p, i) => {
            const [x, y] = px(p[0] + sign * offsets[i][0], p[1] + sign * offsets[i][1]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          if (!open) ctx.closePath();
          ctx.stroke();
        }
        if (open) {
          // The start and the finish: a line across the road at each end.
          for (const i of [0, loop.length - 1]) {
            const a = px(loop[i][0] + offsets[i][0], loop[i][1] + offsets[i][1]), b = px(loop[i][0] - offsets[i][0], loop[i][1] - offsets[i][1]);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
          }
        }
      }
      // The plus pulses between two greys, as the game cycles a palette ramp (0x4e1b30).
      blink = (blink + dt * 2) % 2;
      const pulse = Math.round(120 + 135 * (blink < 1 ? blink : 2 - blink));
      const unitPx = Math.max(1, h / 480);
      for (let i = trucks.length - 1; i >= 0; i--) {
        const t = trucks[i];
        const [x, y] = px(t.pos[0], t.pos[2]);
        if (x < 6 * unitPx || y < 7 * unitPx || x > w - 6 * unitPx || y > h - 7 * unitPx) continue;
        ctx.fillStyle = `rgb(${pulse},${pulse},${pulse})`;
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) ctx.fillRect(x + (dx - 0.5) * unitPx, y + (dy - 0.5) * unitPx, unitPx, unitPx);
        const label = t.label ? `${t.label} (${t.place})` : String(t.place);
        const colour = i === 0 ? "#ffffff" : "#b5b5b5";
        if (font) {
          const s = unitPx * 0.6, width = textWidth(font, label, s), left = x - width / 2, top = y + 3 * unitPx;
          drawText(ctx, font, label, left + unitPx, top + unitPx, { color: "#000", scale: s });
          drawText(ctx, font, label, left, top, { color: colour, scale: s });
        } else {
          ctx.fillStyle = colour;
          ctx.font = `${10 * unitPx}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText(label, x, y + 12 * unitPx);
        }
      }
    },
  };
}
