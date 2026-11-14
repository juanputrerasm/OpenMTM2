/*
  The course map (the Map key), an overlay on the 3D window (MONSTER_EXE_ANALYSIS.md 11, routine
  0x4e2410): the primary course drawn as a road outline, centred on the player's truck (a little right of and below the screen's middle, where the
  game puts it) and turning with its heading, so the truck always points up. Each truck is a small plus with a
  label under it: the Map key cycles off, place numbers, truck names and places, driver names and places
  (game/course-map-labels.js); the player's own label is dark red. The road is the straights' end points joined in order into a closed loop (0x4e1e90),
  with a second outline 48 ft either side of it along each corner's bisector (0x4e2160).
  A Summit Rumble has no course to show: its map is the summit and the scoring zone (6.3) round the trucks.
  Across the world edge (CP4_EXE_ANALYSIS.md 14, beta 0.53's rule; retail and 0.52 drew a line across the world):
  the loop's points are unwrapped in order, each straight is drawn whole at the copy whose midpoint is nearest
  the player, and every mark (a truck, a gate, a point) at its own copy nearest the player.
*/
import { drawText, textWidth } from "./bitmap-text.js";
import { nameTransparency } from "./name-tag-style.js";
import { MAP_OFF, mapLabel, mapLabelColor, mapMode, nextMapMode } from "../game/course-map-labels.js";
import { WORLD_FT, mapWrap } from "../shared/scene-frame.js";

/** Half the road's drawn width, feet (3072 in the map's 1/64 ft units). */
export const MAP_HALF_WIDTH_FT = 48;
/** Map pixels per foot at 480 lines; the game's projection is fixed, so is this. */
export const MAP_PIXELS_PER_FOOT = 0.09;
/** Where the player sits on the screen, as fractions of its width and height: measured in two retail screenshots. */
export const MAP_ORIGIN = Object.freeze([0.75, 0.52]);
const MAX_POINTS = 512;
/** The checkpoints' colours on the map: the rest, and the next one. */
export const CHECKPOINT_COLOR = "rgba(90,170,255,.9)", NEXT_CHECKPOINT_COLOR = "#ffe040";
/** The Map line thickness option (Advanced; the port's own): a multiple of the game's one pixel at 480 lines. */
/** The map's line thickness, times the game's: 1x in the middle, thinner or thicker either side. */
export const MAP_LINE_MIN = 0.25, MAP_LINE_MAX = 1.75;
export const mapLineScale = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(MAP_LINE_MIN, Math.min(MAP_LINE_MAX, n)) : 1; };
/** How see-through the map is (Advanced, OMTM2; the port's): 0 (the game's, solid) to `MAP_TRANSPARENCY_MAX`. */
export const MAP_TRANSPARENCY_MAX = 0.9;
export const mapTransparency = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(MAP_TRANSPARENCY_MAX, n)) : 0; };

/** The world fold (shared/scene-frame.js), here too for the map's callers. */
export { mapWrap };

/** Points `[x, z]` unwrapped in order: the first as stored, each next one the copy nearest the one before it. */
export function unwrapPath(points, worldFt = WORLD_FT) {
  const out = [];
  points.forEach((p, i) => {
    const q = out[i - 1];
    out.push(q ? [q[0] + mapWrap(p[0] - q[0], worldFt), q[1] + mapWrap(p[1] - q[1], worldFt)] : [p[0], p[1]]);
  });
  return out;
}

/** The centre line, `[x, z]` feet: each straight's start then end, in course order, unwrapped across the world edge. */
export function courseLoop(course, worldFt = WORLD_FT) {
  const points = [];
  for (const g of course) {
    if (g.ctype !== undefined && g.ctype !== 1) continue;
    if (!g.startFt || !g.endFt) continue;
    points.push([g.startFt[0], g.startFt[2]], [g.endFt[0], g.endFt[2]]);
    if (points.length >= MAX_POINTS) break;
  }
  return unwrapPath(points, worldFt);
}

/** The copy of world point (x, z) nearest the player at (px, pz). */
export function nearestToPlayer(x, z, px, pz, worldFt = WORLD_FT) {
  return [px + mapWrap(x - px, worldFt), pz + mapWrap(z - pz, worldFt)];
}

/**
 * A path's edges as the map draws them (beta 0.53, 0x1401c7180): each edge i to j (and, `closed`, the last back
 * to the first) runs from point i along the folded difference to j, moved by whole worlds so that its midpoint is
 * the copy nearest the player at (px, pz). Edges that meet are joined into runs; a run is a list of
 * `{ x, z, i }` (`i` the point's index, for its edge offset), drawn as one polyline.
 */
export function wrapRuns(points, closed, px, pz, worldFt = WORLD_FT) {
  const n = points.length, runs = [];
  let run = null;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n, a = points[i], b = points[j];
    const dx = mapWrap(b[0] - a[0], worldFt), dz = mapWrap(b[1] - a[1], worldFt);
    const [mx, mz] = [a[0] + dx / 2, a[1] + dz / 2];
    const [nx, nz] = nearestToPlayer(mx, mz, px, pz, worldFt);
    const A = { x: a[0] + nx - mx, z: a[1] + nz - mz, i }, B = { x: A.x + dx, z: A.z + dz, i: j };
    const last = run?.[run.length - 1];
    if (last && last.i === i && Math.abs(last.x - A.x) < 1e-6 && Math.abs(last.z - A.z) < 1e-6) run.push(B);
    else { run = [A, B]; runs.push(run); }
  }
  // A closed loop drawn in one piece ends where it began.
  if (closed && runs.length > 1) {
    const first = runs[0][0], end = runs[runs.length - 1].at(-1);
    if (end.i === first.i && Math.abs(end.x - first.x) < 1e-6 && Math.abs(end.z - first.z) < 1e-6) runs[0] = [...runs.pop(), ...runs[0].slice(1)];
  }
  return runs;
}

const unit = (x, z) => { const l = Math.hypot(x, z); return l ? [x / l, z / l] : [0, 0]; };

/** Each point's offset vector (length `MAP_HALF_WIDTH_FT`): the bisector of the two edges, or the path's normal when they are almost in line, always on the same side of the path. */
export function edgeOffsets(points, half = MAP_HALF_WIDTH_FT, open = false, worldFt = WORLD_FT) {
  const n = points.length;
  return points.map((p, i) => {
    // Each neighbour is the copy nearest this point (beta 0.53): only a loop closing across the world edge needs it.
    const near = (q) => [p[0] + mapWrap(q[0] - p[0], worldFt), p[1] + mapWrap(q[1] - p[1], worldFt)];
    let prev = near(points[(i + n - 1) % n]), next = near(points[(i + 1) % n]);
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
 * forward is up. Returns offsets in feet `[right, up]`. `wrap`: the point's copy nearest the player (a mark,
 * beta 0.53's truck rule); false for a point already placed near the player (a course edge from `wrapRuns`).
 */
export function toMapFrame(x, z, px, pz, psi, wrap = true, worldFt = WORLD_FT) {
  const dx = wrap ? mapWrap(x - px, worldFt) : x - px, dz = wrap ? mapWrap(z - pz, worldFt) : z - pz;
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
export function createCourseMap(course, { font = null, open = false, areas = null, summit = false, lineScale = 1, worldFt = WORLD_FT } = {}) {
  // `worldFt`: the world the map folds at (8192 ft, or a track format version 6 world's).
  const canvas = document.createElement("canvas");
  canvas.className = "race-minimap";
  canvas.hidden = true;
  const ctx = canvas.getContext("2d");
  // A box with neither shape is left out, so a level whose gates are missing still draws its trucks.
  const usable = (box) => !!(box && (box.pos ?? box.position) && (box.half ?? box.size));
  if (areas) areas = { zone: usable(areas.zone) ? areas.zone : null, summit: usable(areas.summit) ? areas.summit : null };
  const zoneMap = !!(areas?.zone || areas?.summit);
  const loop = zoneMap ? [] : courseLoop(course, worldFt);
  const offsets = loop.length > 2 ? edgeOffsets(loop, MAP_HALF_WIDTH_FT, open, worldFt) : [];
  let mode = MAP_OFF, blink = 0, names = 0;

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
    /** The Map line thickness option, read again each frame so a change shows at once. */
    setLineScale(v) { lineScale = v; },
    /** How see-through the whole map is, 0 to `MAP_TRANSPARENCY_MAX`. */
    setTransparency(v) { const o = String(1 - mapTransparency(v)); if (canvas.style.opacity !== o) canvas.style.opacity = o; },
    /** How see-through the labels are (Name transparency). */
    setNameTransparency(v) { names = nameTransparency(v); },
    /** Stops watching the map's size. */
    dispose() { watching?.disconnect(); watching = null; },
    /**
     * `trucks`: `{ pos, heading, place, truck, driver, color?, marker? }` in game feet; `truck` and `driver` are its
     * names, written as the mode says. `player`: the local player's index, whose label is dark red (-1 for none, a
     * spectator). An extension mode may give a truck
     * a `color` (its team) and a `marker` (`"arrow"`: Tag's It, the robber), drawn larger and kept at the map's edge when
     * the truck is off it. `focus`: the truck the map centres on (the watched one in spectator mode). `state`: on a
     * Rumble, the focused truck's scoring state (2 in the zone). `points`: other things an extension marks
     * (`{ pos, color }`, a ball). `checkpoints`: `{ gates: [{ pos, psi, half }], current }` (`half`: half the box's width, feet), the course's gates and the index of
     * the focused truck's next one (-1 for none), or null.
     */
    set(trucks, dt = 0.016, { focus = 0, player = 0, state = 0, points = [], checkpoints = null } = {}) {
      if (mode === MAP_OFF) return;
      const [w, h] = fit();
      ctx.clearRect(0, 0, w, h);
      const me = trucks[focus] ?? trucks[0];
      if (!me) return;
      const k = (h / 480) * MAP_PIXELS_PER_FOOT, cx = w * MAP_ORIGIN[0], cy = h * MAP_ORIGIN[1];
      const lineWidth = Math.max(1, h / 480) * mapLineScale(lineScale);
      const px = (x, z, wrap = true) => { const [r, u] = toMapFrame(x, z, me.pos[0], me.pos[2], me.heading, wrap, worldFt); return [cx + r * k, cy - u * k]; };
      /** A mark's copy nearest the player, so that a box or a gate is placed whole. */
      const near = (x, z) => nearestToPlayer(x, z, me.pos[0], me.pos[2], worldFt);
      if (zoneMap) {
        ctx.lineWidth = lineWidth;
        const outline = (box) => {
          ctx.beginPath();
          // The Summit Rumble square is drawn as stored in beta 0.53 too; its copy nearest the player keeps it whole.
          const pos = box.pos ?? box.position, [nx, nz] = near(pos[0], pos[2]);
          boxCorners(box).forEach(([x, z], i) => { const [sx, sy] = px(x + nx - pos[0], z + nz - pos[2], false); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
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
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = "rgba(225,225,225,.85)";
        const runs = wrapRuns(loop, !open, me.pos[0], me.pos[2], worldFt);
        for (const sign of [1, -1]) {
          ctx.beginPath();
          for (const run of runs) {
            run.forEach((p, n) => {
              const [x, y] = px(p.x + sign * offsets[p.i][0], p.z + sign * offsets[p.i][1], false);
              if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
          }
          ctx.stroke();
        }
        if (open) {
          // The start and the finish: a line across the road at each end.
          for (const i of [0, loop.length - 1]) {
            const [lx, lz] = near(loop[i][0], loop[i][1]);
            const a = px(lx + offsets[i][0], lz + offsets[i][1], false), b = px(lx - offsets[i][0], lz - offsets[i][1], false);
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
      // The checkpoints (the port's own, Advanced: Checkpoints on the map): a bar across the road at each gate, as long
      // as its box is wide (`half`, half that) and as thick as the map's lines; the next one in its own colour, kept at
      // the map's edge when off it.
      if (checkpoints?.gates?.length) {
        const thick = ctx.lineWidth = lineWidth;
        const halfOf = (g) => (g.half > 0 ? g.half : MAP_HALF_WIDTH_FT);
        ctx.lineCap = "butt";
        checkpoints.gates.forEach((g, i) => {
          if (!g || i === checkpoints.current) return;
          const across = halfOf(g);
          const dx = Math.cos(g.psi) * across, dz = -Math.sin(g.psi) * across;
          const [gx, gz] = near(g.pos[0], g.pos[2]);
          const a = px(gx - dx, gz - dz, false), b = px(gx + dx, gz + dz, false);
          ctx.strokeStyle = CHECKPOINT_COLOR;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        });
        const g = checkpoints.gates[checkpoints.current];
        if (g) {
          const across = halfOf(g);
          const dx = Math.cos(g.psi) * across, dz = -Math.sin(g.psi) * across;
          const [gx, gz] = near(g.pos[0], g.pos[2]);
          let a = px(gx - dx, gz - dz, false), b = px(gx + dx, gz + dz, false);
          let [x, y] = px(g.pos[0], g.pos[2]);
          const edge = across * k + thick;
          if (x < edge || y < edge || x > w - edge || y > h - edge) {
            const ex = x - cx, ey = y - cy;
            const f = Math.min((ex > 0 ? w - edge - cx : cx - edge) / Math.max(1e-6, Math.abs(ex)), (ey > 0 ? h - edge - cy : cy - edge) / Math.max(1e-6, Math.abs(ey)));
            const mx = cx + ex * f - x, my = cy + ey * f - y;
            a = [a[0] + mx, a[1] + my]; b = [b[0] + mx, b[1] + my];
          }
          ctx.strokeStyle = NEXT_CHECKPOINT_COLOR;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
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
        ctx.globalAlpha = 1 - names;
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
        ctx.globalAlpha = 1;
      }
    },
  };
}
