/*
  The course map (the Map key), an overlay on the 3D window (MONSTER_EXE_ANALYSIS.md 11, routine
  0x4e2410): the primary course drawn as a road outline, centred on the player's truck (a little right of and below the screen's middle, where the
  game puts it) and turning with its heading, so the truck always points up. Each truck is a small plus with a
  label under it: the Map key cycles off, place numbers, truck names and places, driver names and places
  (game/course-map-labels.js); the player's own label is dark red. The road is the straights' end points joined in order into a closed loop (0x4e1e90),
  with a second outline 48 ft either side of it along each corner's bisector (0x4e2160).
  A Summit Rumble has no course to show: its map is the summit and the scoring zone (6.3) round the trucks.
*/
import { drawText, textWidth } from "./bitmap-text.js";
import { MAP_OFF, mapLabel, mapLabelColor, mapMode, nextMapMode } from "../game/course-map-labels.js";

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

/**
 * A box's four corners `[x, z]` feet, the box's angles left out as the scoring test leaves them (6.3): a simulation box
 * (`{ pos, half }`) or a track build's checkpoint gate (`{ position, size }`, full sizes).
 */
export function boxCorners(box) {
  const pos = box.pos ?? box.position, half = box.half ?? box.size.map((v) => v / 2);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [pos[0] + sx * half[0], pos[2] + sz * half[2]]);
}

/**
 * `open`: a one-way course (a rally from A to B) is drawn with its start and its end closed off, not joined.
 * `areas`: a Summit Rumble's `{ zone, summit }` boxes (`{ pos, half }`, feet), drawn in place of the course.
 */
export function createCourseMap(course, { font = null, open = false, areas = null, summit = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "race-minimap";
  canvas.hidden = true;
  const ctx = canvas.getContext("2d");
  // A box with neither shape is left out, so a level whose gates are missing still draws its trucks.
  const usable = (box) => !!(box && (box.pos ?? box.position) && (box.half ?? box.size));
  if (areas) areas = { zone: usable(areas.zone) ? areas.zone : null, summit: usable(areas.summit) ? areas.summit : null };
  const zoneMap = !!(areas?.zone || areas?.summit);
  const loop = zoneMap ? [] : courseLoop(course);
  const offsets = loop.length > 2 ? edgeOffsets(loop, MAP_HALF_WIDTH_FT, open) : [];
  let mode = MAP_OFF, blink = 0;

  // The map's size on the page, read again only when it or its frame changes size: a read each frame, after the name tags
  // have moved, would make the browser lay the page out again then and there.
  let measured = null;
  const measure = () => [canvas.clientWidth || canvas.parentElement?.clientWidth || 640, canvas.clientHeight || canvas.parentElement?.clientHeight || 480];
  let watching = null;
  function fit() {
    if (!watching && typeof ResizeObserver === "function" && canvas.parentElement) {
      watching = new ResizeObserver(() => { measured = null; });
      watching.observe(canvas);
      watching.observe(canvas.parentElement);
    }
    if (!watching || !measured) measured = measure();
    const [w, h] = measured;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return [w, h];
  }

  return {
    element: canvas,
    get visible() { return mode !== MAP_OFF; },
    get mode() { return mode; },
    /** The Map key: the next mode, which is returned. */
    cycle() { return this.setMode(nextMapMode(mode)); },
    setMode(value) { mode = mapMode(value); canvas.hidden = mode === MAP_OFF; measured = null; return mode; },
    /** Stops watching the map's size. */
    dispose() { watching?.disconnect(); watching = null; },
    /**
     * `trucks`: `{ pos, heading, place, truck, driver, color?, marker? }` in game feet; `truck` and `driver` are its
     * names, written as the mode says. `player`: the local player's index, whose label is dark red (-1 for none, a
     * spectator). An extension mode may give a truck
     * a `color` (its team) and a `marker` (`"arrow"`: Tag's It, the robber), drawn larger and kept at the map's edge when
     * the truck is off it. `focus`: the truck the map centres on (the watched one in spectator mode). `state`: on a
     * Rumble, the focused truck's scoring state (2 in the zone). `points`: other things an extension marks
     * (`{ pos, color }`, a ball).
     */
    set(trucks, dt = 0.016, { focus = 0, player = 0, state = 0, points = [] } = {}) {
      if (mode === MAP_OFF) return;
      const [w, h] = fit();
      ctx.clearRect(0, 0, w, h);
      const me = trucks[focus] ?? trucks[0];
      if (!me) return;
      const k = (h / 480) * MAP_PIXELS_PER_FOOT, cx = w * MAP_ORIGIN[0], cy = h * MAP_ORIGIN[1];
      const px = (x, z) => { const [r, u] = toMapFrame(x, z, me.pos[0], me.pos[2], me.heading); return [cx + r * k, cy - u * k]; };
      if (zoneMap) {
        ctx.lineWidth = Math.max(1, h / 480);
        const outline = (box) => {
          ctx.beginPath();
          boxCorners(box).forEach(([x, z], i) => { const [sx, sy] = px(x, z); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
          ctx.closePath();
        };
        if (areas.summit) {
          outline(areas.summit);
          ctx.fillStyle = state === 1 ? "rgba(225,225,225,.28)" : "rgba(225,225,225,.12)";
          ctx.fill();
          ctx.strokeStyle = "rgba(225,225,225,.85)";
          ctx.stroke();
        }
        if (areas.zone) {
          outline(areas.zone);
          ctx.fillStyle = state === 2 ? "rgba(255,214,64,.55)" : "rgba(255,214,64,.25)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,214,64,.95)";
          ctx.stroke();
        }
      }
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
      for (const p of points ?? []) {
        const [x, y] = px(p.pos[0], p.pos[2]);
        if (x < 4 * unitPx || y < 4 * unitPx || x > w - 4 * unitPx || y > h - 4 * unitPx) continue;
        ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.arc(x, y, 3 * unitPx, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.color ?? "#ffffff";
        ctx.beginPath(); ctx.arc(x, y, 2 * unitPx, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = trucks.length - 1; i >= 0; i--) {
        const t = trucks[i];
        let [x, y] = px(t.pos[0], t.pos[2]);
        const off = x < 6 * unitPx || y < 7 * unitPx || x > w - 6 * unitPx || y > h - 7 * unitPx;
        if (off && t.marker !== "arrow") continue;
        if (t.marker === "arrow") {
          // A marked truck is never lost: off the map it stays at the edge, on the line from the map's centre to it.
          if (off) {
            const ex = x - cx, ey = y - cy, edge = 10 * unitPx;
            const f = Math.min((ex > 0 ? w - edge - cx : cx - edge) / Math.max(1e-6, Math.abs(ex)), (ey > 0 ? h - edge - cy : cy - edge) / Math.max(1e-6, Math.abs(ey)));
            x = cx + ex * f; y = cy + ey * f;
          }
          const r = (blink < 1 ? 5 : 4) * unitPx;
          ctx.beginPath(); ctx.moveTo(x, y - r - unitPx); ctx.lineTo(x + r + unitPx, y); ctx.lineTo(x, y + r + unitPx); ctx.lineTo(x - r - unitPx, y); ctx.closePath();
          ctx.fillStyle = "#000"; ctx.fill();
          ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
          ctx.fillStyle = t.color ?? "#ffa21f"; ctx.fill();
          if (off) continue;
        } else {
          ctx.fillStyle = t.color ?? `rgb(${pulse},${pulse},${pulse})`;
          for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) ctx.fillRect(x + (dx - 0.5) * unitPx, y + (dy - 0.5) * unitPx, unitPx, unitPx);
        }
        // A truck with no place (a Race & Rumble blocker) shows its name alone, or nothing.
        const label = mapLabel(mode, { truck: t.truck, driver: t.driver, place: t.place, summit });
        if (!label) continue;
        const colour = mapLabelColor(i, player);
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
