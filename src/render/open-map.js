/*
  The OpenMTM2 map (Options, Advanced, OMTM2: Course map; the port's own, not in the game): a modern course map in
  a tall strip on the right of the screen, in place of MTM2's full-screen one (render/minimap.js). Forward is up and
  the player's truck sits low in the strip. The map is seen at an angle (`tiltProject`), as from above and behind the
  truck, so the road ahead draws smaller toward the top and far more of it fits than on a flat map. It turns with
  the truck but eases after it (`easeAngle`), so a quick yaw swings the player's chevron and the map follows a moment
  later. The Map zoom keys step through `OPEN_MAP_ZOOMS`, easing to each. The course is one soft light line with its
  corners rounded (game/course-shape.js) that fades out toward the strip's ends. Opponents are white dots with a black
  edge, the player a yellow chevron. The Map key cycles no names, driver names and truck
  names, then turns the map off (game/course-map-labels.js `nextOpenMapMode`), each name with its place.
*/
import { drawText, textWidth } from "./bitmap-text.js";
import { CHECKPOINT_COLOR, NEXT_CHECKPOINT_COLOR, MAP_HALF_WIDTH_FT, boxCorners, mapLineScale, mapTransparency, nearestToPlayer, toMapFrame, wrapRuns } from "./minimap.js";
import { nameTagScale, nameTransparency } from "./name-tag-style.js";
import { MAP_OFF, openMapLabel, openMapMode, nextOpenMapMode } from "../game/course-map-labels.js";
import { courseSegments, smoothCoursePath } from "../game/course-shape.js";
import { WORLD_FT, mapWrap } from "../shared/scene-frame.js";

/** Feet of ground over the strip's height at the truck's own scale, at zoom 1 (the tilt fits more ahead). */
export const OPEN_MAP_SPAN_FT = 1100;
/** The Map zoom keys' steps: how much larger the map draws than at zoom 1. */
export const OPEN_MAP_ZOOMS = Object.freeze([0.1, 0.14, 0.2, 0.28, 0.4, 0.5, 0.7, 1, 1.4, 2, 2.8, 4]);
/** The step a race starts in until the player picks one. */
export const OPEN_MAP_DEFAULT_ZOOM = 2;
/** A stored zoom as one of the steps: the nearest, or the default for anything that is not a number. */
export function openMapZoom(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return OPEN_MAP_DEFAULT_ZOOM;
  return OPEN_MAP_ZOOMS.reduce((best, z) => (Math.abs(Math.log(z / n)) < Math.abs(Math.log(best / n)) ? z : best));
}
/** The next step in (`+1`) or out (`-1`), held at the ends. */
export function stepOpenMapZoom(v, dir) {
  const i = OPEN_MAP_ZOOMS.indexOf(openMapZoom(v));
  return OPEN_MAP_ZOOMS[Math.max(0, Math.min(OPEN_MAP_ZOOMS.length - 1, i + Math.sign(dir)))];
}
/** Where the focused truck sits in the strip, as fractions of its width and height. */
export const OPEN_MAP_ORIGIN = Object.freeze([0.62, 0.74]);
/** The view's angle down from straight overhead, radians, and the eye's distance from the truck as a share of the span. */
export const OPEN_MAP_TILT = 1.05, OPEN_MAP_EYE = 1;
/** Seconds the map's turn takes to close about two thirds of the gap to the truck's heading; the same for the zoom. */
export const OPEN_MAP_TURN_S = 0.3, OPEN_MAP_ZOOM_S = 0.2;
/** A move farther than this in one frame (a reset, the helicopter, another truck watched) turns the map at once. */
export const OPEN_MAP_SNAP_FT = 150;
/** The strip's reference height, CSS pixels, at which its marks have their base sizes. */
const BASE_HEIGHT = 475;
export const PLAYER_COLOR = "#ffd21f";
const OPPONENT_COLOR = "#ffffff";

const wrap = (a) => { const t = (a + Math.PI) % (Math.PI * 2); return (t < 0 ? t + Math.PI * 2 : t) - Math.PI; };

/** `current` eased toward `target` (radians) over `dt` seconds, the short way round; time constant `tau`. */
export function easeAngle(current, target, dt, tau = OPEN_MAP_TURN_S) {
  if (!(dt > 0)) return current;
  if (!(tau > 0)) return wrap(target);
  return wrap(current + wrap(target - current) * (1 - Math.exp(-dt / tau)));
}

/**
 * A map point `[right, ahead]` feet from the truck as seen at an angle: the ground tilted `tilt` away from the eye,
 * which looks at the truck from `eye` feet. Returns `[right, up]` in feet at the truck's own scale (a point beside
 * the truck is where a flat map draws it), or null for a point too near the eye or behind it.
 */
export function tiltProject(right, ahead, tilt = OPEN_MAP_TILT, eye = OPEN_MAP_SPAN_FT * OPEN_MAP_EYE) {
  const depth = eye + ahead * Math.sin(tilt);
  if (depth < eye * 0.2) return null;
  const f = eye / depth;
  return [right * f, ahead * f];
}

/** How solid a mark is at `f` (0 to 1 across the strip): 0 at the ends, 1 between `lead` and `1 - tail`. */
export function stripFade(f, lead, tail) {
  if (f <= 0 || f >= 1) return 0;
  if (f < lead) return f / lead;
  if (f > 1 - tail) return (1 - f) / tail;
  return 1;
}
/** The fades along the strip (top, bottom) and across it (each side). */
const FADE_TOP = 0.3, FADE_BOTTOM = 0.12, FADE_SIDE = 0.15;

export function createOpenMap(course, { font = null, open = false, areas = null, summit = false, lineScale = 1, zoom = OPEN_MAP_DEFAULT_ZOOM, worldFt = WORLD_FT } = {}) {
  // `worldFt`: the world the map folds at (8192 ft, or a track format version 6 world's).
  const canvas = document.createElement("canvas");
  canvas.className = "race-openmap";
  const ctx = canvas.getContext("2d");
  const usable = (box) => !!(box && (box.pos ?? box.position) && (box.half ?? box.size));
  if (areas) areas = { zone: usable(areas.zone) ? areas.zone : null, summit: usable(areas.summit) ? areas.summit : null };
  const zoneMap = !!(areas?.zone || areas?.summit);
  const segments = zoneMap ? [] : courseSegments(course, worldFt);
  const path = smoothCoursePath(segments, !open, worldFt);
  let mode = openMapMode(1), names = 0;
  canvas.hidden = false;
  // The map's eased heading, and the truck and place it was eased for; the zoom asked for and the one drawn.
  let eased = null, lastFocus = -1, lastPos = null;
  let zoomTarget = openMapZoom(zoom), zoomNow = zoomTarget;

  let measured = null, watching = null;
  const measure = () => [canvas.clientWidth || 160, canvas.clientHeight || BASE_HEIGHT];
  function fit() {
    if (!watching && typeof ResizeObserver === "function") {
      watching = new ResizeObserver(() => { measured = null; });
      watching.observe(canvas);
    }
    if (!watching || !measured) measured = measure();
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(measured[0] * ratio)), h = Math.max(1, Math.round(measured[1] * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return [w, h, ratio];
  }

  /** A label beside a dot: to its left (the strip hugs the screen's right edge), to its right when it would not fit. */
  function label(text, x, y, colour, u, ratio, alpha) {
    if (!text || alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const gap = 7 * u;
    if (font) {
      const s = nameTagScale(Math.round((window.innerHeight || 1080) * ratio));
      const width = textWidth(font, text, s), top = Math.round(y - (font.lineHeight * s) / 2);
      let left = Math.round(x - gap - width);
      if (left < s) left = Math.round(x + gap);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawText(ctx, font, text, left + dx * s, top + dy * s, { color: "#000", scale: s });
      drawText(ctx, font, text, left, top, { color: colour, scale: s });
    } else {
      ctx.font = `600 ${Math.round(11 * u)}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      const width = ctx.measureText(text).width;
      let left = x - gap - width;
      if (left < 2) left = x + gap;
      ctx.textAlign = "left";
      ctx.lineWidth = 3 * u; ctx.strokeStyle = "#000"; ctx.lineJoin = "round";
      ctx.strokeText(text, left, y);
      ctx.fillStyle = colour;
      ctx.fillText(text, left, y);
    }
    ctx.globalAlpha = 1;
  }

  return {
    element: canvas,
    get visible() { return mode !== MAP_OFF; },
    get mode() { return mode; },
    get zoom() { return zoomTarget; },
    /** The Map key: the next mode, which is returned. */
    cycle() { return this.setMode(nextOpenMapMode(mode)); },
    setMode(value) { mode = openMapMode(value); canvas.hidden = mode === MAP_OFF; return mode; },
    /** The Map zoom keys: one step in (`+1`) or out (`-1`); the new zoom, to keep, is returned. */
    stepZoom(dir) { zoomTarget = stepOpenMapZoom(zoomTarget, dir); return zoomTarget; },
    setLineScale(v) { lineScale = v; },
    /** How see-through the whole map is, 0 to `MAP_TRANSPARENCY_MAX`. */
    setTransparency(v) { const o = String(1 - mapTransparency(v)); if (canvas.style.opacity !== o) canvas.style.opacity = o; },
    /** How see-through the names on it are (Name transparency). */
    setNameTransparency(v) { names = nameTransparency(v); },
    dispose() { watching?.disconnect(); watching = null; },
    /** As `createCourseMap`'s `set` (render/minimap.js). */
    set(trucks, dt = 0.016, { focus = 0, player = 0, state = 0, points = [], checkpoints = null } = {}) {
      const [w, h, ratio] = fit();
      ctx.clearRect(0, 0, w, h);
      const me = trucks[focus] ?? trucks[0];
      if (!me) return;
      const jumped = lastPos && Math.hypot(me.pos[0] - lastPos[0], me.pos[2] - lastPos[1]) > OPEN_MAP_SNAP_FT;
      if (eased === null || focus !== lastFocus || jumped) eased = me.heading;
      else eased = easeAngle(eased, me.heading, dt);
      lastFocus = focus; lastPos = [me.pos[0], me.pos[2]];
      // The zoom eases by its ratio, so each step takes as long in as out.
      if (dt > 0) zoomNow *= Math.exp(Math.log(zoomTarget / zoomNow) * (1 - Math.exp(-dt / OPEN_MAP_ZOOM_S)));

      const u = h / BASE_HEIGHT;
      const span = OPEN_MAP_SPAN_FT / zoomNow, k = h / span, eye = span * OPEN_MAP_EYE;
      const cx = w * OPEN_MAP_ORIGIN[0], cy = h * OPEN_MAP_ORIGIN[1];
      /** A map-frame point `[right, ahead]` on the canvas, or null where the view cannot show it. */
      const screen = (r, a) => { const p = tiltProject(r, a, OPEN_MAP_TILT, eye); return p ? [cx + p[0] * k, cy - p[1] * k] : null; };
      // A mark is drawn at its copy nearest the player, a course edge where `wrapRuns` placed it (beta 0.53's rule).
      const frame = (x, z, wrap = true) => toMapFrame(x, z, me.pos[0], me.pos[2], eased, wrap, worldFt);
      const px = (x, z, wrap = true) => { const [r, a] = frame(x, z, wrap); return screen(r, a); };
      const near = (x, z) => nearestToPlayer(x, z, me.pos[0], me.pos[2], worldFt);
      /** A polyline of world points `[x, z]`, cut where it runs behind the eye; `wrap` false for points already placed. */
      const polyline = (pts, closed, wrap = true) => {
        const minAhead = (eye * 0.2 - eye) / Math.sin(OPEN_MAP_TILT) + 1e-3;
        const list = pts.map(([x, z]) => frame(x, z, wrap));
        if (closed && list.length) list.push(list[0]);
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < list.length; i++) {
          const b = list[i], a = list[i - 1];
          if (b[1] >= minAhead) {
            if (!pen && a && a[1] < minAhead) {
              const f = (minAhead - a[1]) / (b[1] - a[1]), c = screen(a[0] + (b[0] - a[0]) * f, minAhead);
              ctx.moveTo(c[0], c[1]); pen = true;
            }
            const s = screen(b[0], b[1]);
            if (pen) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]);
            pen = true;
          } else if (pen && a) {
            const f = (minAhead - a[1]) / (b[1] - a[1]), c = screen(a[0] + (b[0] - a[0]) * f, minAhead);
            ctx.lineTo(c[0], c[1]); pen = false;
          }
        }
      };
      const fadeAt = (x, y) => stripFade(y / h, FADE_TOP, FADE_BOTTOM) * stripFade(x / w, FADE_SIDE, FADE_SIDE);
      const line = mapLineScale(lineScale);
      ctx.lineJoin = "round"; ctx.lineCap = "round";

      // The course layer: drawn, then faded toward the strip's ends and sides.
      if (zoneMap) {
        ctx.lineWidth = 2 * u * line;
        const box = (b, fill, stroke) => {
          const pos = b.pos ?? b.position, [nx, nz] = near(pos[0], pos[2]);
          polyline(boxCorners(b).map(([x, z]) => [x + nx - pos[0], z + nz - pos[2]]), true, false);
          ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.stroke();
        };
        if (areas.summit) box(areas.summit, state === 1 ? "rgba(235,235,235,.3)" : "rgba(235,235,235,.14)", "rgba(240,240,240,.9)");
        if (areas.zone) box(areas.zone, state === 2 ? "rgba(255,214,64,.55)" : "rgba(255,214,64,.25)", "rgba(255,214,64,.95)");
      }
      if (path.length > 1) {
        const runs = wrapRuns(path, false, me.pos[0], me.pos[2], worldFt).map((run) => run.map((p) => [p.x, p.z]));
        const stroke = () => { for (const run of runs) { polyline(run, false, false); ctx.stroke(); } };
        ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 5.5 * u * line; stroke();
        ctx.strokeStyle = "rgba(240,240,240,.92)"; ctx.lineWidth = 2.5 * u * line; stroke();
        if (open) {
          // The start and the finish: a short bar across the line at each end.
          for (const [i, j] of [[0, 1], [path.length - 1, path.length - 2]]) {
            const [ax, az] = near(path[i][0], path[i][1]);
            const a = px(ax, az, false), b = px(ax + mapWrap(path[j][0] - path[i][0], worldFt), az + mapWrap(path[j][1] - path[i][1], worldFt), false);
            if (!a || !b) continue;
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l * 6 * u, ny = (b[0] - a[0]) / l * 6 * u;
            ctx.beginPath(); ctx.moveTo(a[0] - nx, a[1] - ny); ctx.lineTo(a[0] + nx, a[1] + ny); ctx.stroke();
          }
        }
      }
      if (checkpoints?.gates?.length) {
        ctx.lineCap = "butt"; ctx.lineWidth = 2.5 * u * line;
        checkpoints.gates.forEach((g, i) => {
          if (!g) return;
          const across = Math.min(g.half > 0 ? g.half : MAP_HALF_WIDTH_FT, 60 * u / k);
          const dx = Math.cos(g.psi) * across, dz = -Math.sin(g.psi) * across;
          const [gx, gz] = near(g.pos[0], g.pos[2]);
          const a = px(gx - dx, gz - dz, false), b = px(gx + dx, gz + dz, false);
          if (!a || !b) return;
          ctx.strokeStyle = i === checkpoints.current ? NEXT_CHECKPOINT_COLOR : CHECKPOINT_COLOR;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        });
        ctx.lineCap = "round";
      }
      ctx.globalCompositeOperation = "destination-in";
      const along = ctx.createLinearGradient(0, 0, 0, h);
      along.addColorStop(0, "rgba(0,0,0,0)"); along.addColorStop(FADE_TOP, "#000"); along.addColorStop(1 - FADE_BOTTOM, "#000"); along.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = along; ctx.fillRect(0, 0, w, h);
      const across = ctx.createLinearGradient(0, 0, w, 0);
      across.addColorStop(0, "rgba(0,0,0,0)"); across.addColorStop(FADE_SIDE, "#000"); across.addColorStop(1 - FADE_SIDE, "#000"); across.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = across; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";

      // What an extension marks (a ball): small dots in their colour.
      for (const p of points ?? []) {
        const s = px(p.pos[0], p.pos[2]);
        if (!s) continue;
        const [x, y] = s, alpha = fadeAt(x, y);
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x, y, 3.5 * u, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.color ?? "#fff"; ctx.beginPath(); ctx.arc(x, y, 2.4 * u, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // The trucks, the focused one last so it stays on top.
      const order = trucks.map((_, i) => i).filter((i) => i !== focus && trucks[i]);
      if (trucks[focus]) order.push(focus);
      const nameAlpha = 1 - names;
      for (const i of order) {
        const t = trucks[i];
        const text = openMapLabel(mode, { truck: t.truck, driver: t.driver, place: t.place, summit });
        const colour = i === player ? PLAYER_COLOR : OPPONENT_COLOR;
        if (i === focus) {
          // The chevron points the truck's way; the map's lag shows as its swing.
          ctx.save();
          ctx.translate(cx, cy); ctx.rotate(wrap(t.heading - eased));
          ctx.beginPath(); ctx.moveTo(0, -8 * u); ctx.lineTo(6 * u, 6 * u); ctx.lineTo(0, 2.5 * u); ctx.lineTo(-6 * u, 6 * u); ctx.closePath();
          ctx.fillStyle = t.color ?? PLAYER_COLOR; ctx.fill();
          ctx.lineWidth = 1.5 * u; ctx.strokeStyle = "#000"; ctx.stroke();
          ctx.restore();
          label(text, cx, cy, colour, u, ratio, nameAlpha);
          continue;
        }
        const s = px(t.pos[0], t.pos[2]);
        if (t.marker === "arrow") {
          // A marked truck is never lost: off the strip (or behind the view) it stays at the edge, on its bearing.
          let x, y;
          if (s) [x, y] = s;
          else { const [r, a] = frame(t.pos[0], t.pos[2]); x = cx + r * k; y = cy - a * k; }
          const edge = 10 * u;
          if (x < edge || y < edge || x > w - edge || y > h - edge) {
            const ex = x - cx, ey = y - cy;
            const f = Math.min((ex > 0 ? w - edge - cx : cx - edge) / Math.max(1e-6, Math.abs(ex)), (ey > 0 ? h - edge - cy : cy - edge) / Math.max(1e-6, Math.abs(ey)));
            x = cx + ex * f; y = cy + ey * f;
          }
          const alpha = Math.max(fadeAt(x, y), 0.75), r = 5 * u;
          ctx.globalAlpha = alpha;
          ctx.beginPath(); ctx.moveTo(x, y - r - u); ctx.lineTo(x + r + u, y); ctx.lineTo(x, y + r + u); ctx.lineTo(x - r - u, y); ctx.closePath();
          ctx.fillStyle = "#000"; ctx.fill();
          ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
          ctx.fillStyle = t.color ?? "#ffa21f"; ctx.fill();
          ctx.globalAlpha = 1;
          label(text, x, y, colour, u, ratio, nameAlpha * alpha);
          continue;
        }
        if (!s) continue;
        const [x, y] = s, alpha = fadeAt(x, y);
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x, y, 4.5 * u, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = t.color ?? OPPONENT_COLOR; ctx.beginPath(); ctx.arc(x, y, 3 * u, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        label(text, x, y, colour, u, ratio, nameAlpha * alpha);
      }
    },
  };
}
