/*
  Community Patch 4's collision shapes (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 11.2, 11.3; its author published
  no source code): a model's triangle soup in its own frame (the box frame), a 26-direction k-DOP that
  decides whether the model is solid enough for the triangle path, a uniform grid, and the three queries
  the solver makes: the nearest ray hit, the deepest tire cylinder and a point's distance.

  The grid only makes queries faster; its sizing follows CP4 so the same models fall back to classic boxes.
  CP4 also caches hulls and grids on disk (.clsh); that is only speed and is not done here.
*/
const MAX_DIM = 96;
const MAX_CELLS = 32768;
const MAX_ITEMS = 262144;
const MAX_VISITS = 8388608;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function corner(s, t, k) {
    const o = t * 9 + k * 3;
    return [s.tris[o], s.tris[o + 1], s.tris[o + 2]];
}
/* ---------- k-DOP ---------- */
/** The 13 directions of a 26-DOP: 3 axes, 6 edge diagonals, 4 corner diagonals; each gives two planes. */
const KDOP_DIRS = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1],
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1],
];
/** Clip a convex polytope (outward, counter-clockwise faces) by the half space n.p <= d. */
function clipPolytope(faces, n, d) {
    const eps = 1e-9 * Math.max(1, Math.abs(d));
    const out = [];
    const cap = [];
    for (const poly of faces) {
        const res = [];
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const da = dot(n, a) - d, db = dot(n, b) - d;
            if (da <= eps)
                res.push(a);
            if ((da <= eps) !== (db <= eps)) {
                const t = da / (da - db);
                const p = add(a, scale(sub(b, a), t));
                res.push(p);
                cap.push(p);
            }
        }
        if (res.length >= 3)
            out.push(res);
    }
    if (cap.length >= 3) {
        const c = scale(cap.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / cap.length);
        const nn = scale(n, 1 / len(n));
        const ref = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const u = cross(nn, ref);
        const ul = len(u);
        const uu = scale(u, 1 / ul), vv = cross(nn, uu);
        const pts = cap.map((p) => ({ p, a: Math.atan2(dot(sub(p, c), vv), dot(sub(p, c), uu)) })).sort((x, y) => x.a - y.a);
        const ring = [];
        for (const { p } of pts)
            if (!ring.length || len(sub(p, ring[ring.length - 1])) > 1e-9)
                ring.push(p);
        if (ring.length >= 3)
            out.push(ring);
    }
    return out;
}
function polytopeVolume(faces) {
    let v = 0;
    for (const f of faces)
        for (let i = 1; i < f.length - 1; i++)
            v += dot(f[0], cross(f[i], f[i + 1]));
    return Math.abs(v / 6);
}
function polytopeVertices(faces) {
    const seen = new Set();
    for (const f of faces)
        for (const p of f)
            seen.add(p.map((x) => Math.round(x * 1e5)).join(","));
    return seen.size;
}
/** The 26-DOP of a set of points: its volume and vertex count. */
export function kdopHull(points) {
    const n = Math.floor(points.length / 3);
    if (n === 0)
        return { volume: 0, vertices: 0 };
    const lo = new Array(13).fill(Infinity), hi = new Array(13).fill(-Infinity);
    for (let i = 0; i < n; i++) {
        const p = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
        KDOP_DIRS.forEach((d, k) => { const s = dot(d, p); if (s < lo[k])
            lo[k] = s; if (s > hi[k])
            hi[k] = s; });
    }
    const [x0, y0, z0, x1, y1, z1] = [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]];
    if (x1 - x0 <= 0 || y1 - y0 <= 0 || z1 - z0 <= 0)
        return { volume: 0, vertices: n < 4 ? n : 4 };
    let faces = [
        [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
        [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
        [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
        [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
        [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    ];
    for (let k = 3; k < 13; k++) {
        const d = KDOP_DIRS[k];
        faces = clipPolytope(faces, d, hi[k]);
        faces = clipPolytope(faces, scale(d, -1), -lo[k]);
    }
    return { volume: polytopeVolume(faces), vertices: polytopeVertices(faces) };
}
/* ---------- grid ---------- */
function triPlaneBoxOverlap(s, t, centre, cell) {
    const a = corner(s, t, 0), b = corner(s, t, 1), c = corner(s, t, 2);
    const n = cross(sub(b, a), sub(c, a));
    const d = dot(n, a);
    const r = 0.5 * (Math.abs(n[0]) * cell[0] + Math.abs(n[1]) * cell[1] + Math.abs(n[2]) * cell[2]);
    return Math.abs(dot(n, centre) - d) <= r + len(n) * 1e-4 * (cell[0] + cell[1] + cell[2]);
}
function buildGrid(s) {
    const ext = sub(s.max, s.min);
    const maxExt = Math.max(ext[0], ext[1], ext[2]);
    const origin = [0, 0, 0], size = [0, 0, 0];
    const active = [false, false, false];
    let prod = 1, k = 0;
    for (let i = 0; i < 3; i++) {
        const pad = ext[i] * 1e-4 + 1e-3;
        origin[i] = s.min[i] - pad;
        size[i] = ext[i] + 2 * pad;
        if (ext[i] > 0.001 * maxExt) {
            active[i] = true;
            prod *= size[i];
            k++;
        }
    }
    const cellLen = k === 0 ? 1 : Math.pow(prod / Math.max(1, 2 * s.count), 1 / k);
    const dims = [1, 1, 1];
    for (let i = 0; i < 3; i++)
        if (active[i])
            dims[i] = Math.max(1, Math.min(MAX_DIM, Math.ceil(size[i] / cellLen)));
    while (dims[0] * dims[1] * dims[2] > MAX_CELLS) {
        const j = dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : dims[1] >= dims[2] ? 1 : 2;
        dims[j] = Math.max(1, Math.floor((dims[j] * 3) / 4));
    }
    const cell = [0, 0, 0];
    for (let i = 0; i < 3; i++)
        cell[i] = Math.max(0.001, size[i] / dims[i]);
    const nCell = dims[0] * dims[1] * dims[2];
    if (nCell < 1 || nCell > MAX_CELLS)
        return null;
    const counts = new Int32Array(nCell + 1);
    const lists = [];
    let visits = 0, total = 0;
    for (let t = 0; t < s.count; t++) {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 3; c++) {
            const p = corner(s, t, c);
            for (let i = 0; i < 3; i++) {
                if (p[i] < lo[i])
                    lo[i] = p[i];
                if (p[i] > hi[i])
                    hi[i] = p[i];
            }
        }
        const r0 = [], r1 = [];
        for (let i = 0; i < 3; i++) {
            const g = cell[i] * 1e-4;
            r0[i] = Math.max(0, Math.min(dims[i] - 1, Math.floor((lo[i] - g - origin[i]) / cell[i])));
            r1[i] = Math.max(0, Math.min(dims[i] - 1, Math.floor((hi[i] + g - origin[i]) / cell[i])));
        }
        const mine = [];
        for (let z = r0[2]; z <= r1[2]; z++)
            for (let y = r0[1]; y <= r1[1]; y++)
                for (let x = r0[0]; x <= r1[0]; x++) {
                    if (++visits > MAX_VISITS)
                        return null;
                    const centre = [origin[0] + (x + 0.5) * cell[0], origin[1] + (y + 0.5) * cell[1], origin[2] + (z + 0.5) * cell[2]];
                    if (triPlaneBoxOverlap(s, t, centre, cell))
                        mine.push(x + dims[0] * (y + dims[1] * z));
                }
        total += mine.length;
        if (total > MAX_ITEMS)
            return null;
        lists.push(mine);
        for (const c of mine)
            counts[c + 1]++;
    }
    for (let c = 0; c < nCell; c++)
        counts[c + 1] += counts[c];
    const items = new Int32Array(total);
    const fill = counts.slice(0, nCell);
    lists.forEach((mine, t) => { for (const c of mine)
        items[fill[c]++] = t; });
    return { origin, cell, dims, start: counts, items };
}
/** A shape from a soup (nine numbers per triangle, box frame). */
export function buildCollShape(positions, surfaceTypes = null) {
    const count = Math.floor(positions.length / 9);
    const tris = Float64Array.from({ length: count * 9 }, (_, i) => positions[i]);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count * 3; i++) {
        for (let k = 0; k < 3; k++) {
            const v = tris[i * 3 + k];
            if (v < min[k])
                min[k] = v;
            if (v > max[k])
                max[k] = v;
        }
    }
    const hull = kdopHull(tris);
    const shape = {
        tris, count, min, max, degenerate: count === 0 || hull.vertices <= 3 || hull.volume < 1e-4,
        hullVolume: hull.volume, hullVertices: hull.vertices, grid: null, surfaceTypes,
    };
    if (!shape.degenerate)
        shape.grid = buildGrid(shape);
    return shape;
}
/** Whether CP4 would collide with this shape by its triangles (11.2). */
export function shapeUsable(s) {
    return !!s && !s.degenerate && !!s.grid && s.count > 0;
}
/* ---------- queries ---------- */
/** Moller-Trumbore, double-sided, det eps 1e-8: the ray parameter or -1. */
function rayTri(s, t, o, d) {
    const a = corner(s, t, 0), b = corner(s, t, 1), c = corner(s, t, 2);
    const e1 = sub(b, a), e2 = sub(c, a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-8)
        return -1;
    const inv = 1 / det;
    const tv = sub(o, a);
    const u = dot(tv, p) * inv;
    if (u < 0 || u > 1)
        return -1;
    const q = cross(tv, e1);
    const v = dot(d, q) * inv;
    if (v < 0 || u + v > 1)
        return -1;
    return dot(e2, q) * inv;
}
/** Visit the grid cells a segment crosses, in order. */
function walkCells(g, o, d, maxLen, visit) {
    // Clip the segment to the grid box (slab method; a component under 1e-20 is parallel).
    let t0 = 0, t1 = maxLen;
    for (let i = 0; i < 3; i++) {
        const lo = g.origin[i], hi = lo + g.cell[i] * g.dims[i];
        if (Math.abs(d[i]) < 1e-20) {
            if (o[i] < lo || o[i] > hi)
                return;
        }
        else {
            let a = (lo - o[i]) / d[i], b = (hi - o[i]) / d[i];
            if (a > b)
                [a, b] = [b, a];
            if (a > t0)
                t0 = a;
            if (b < t1)
                t1 = b;
            if (t0 > t1)
                return;
        }
    }
    const idx = [], step = [], tMax = [], tDelta = [];
    for (let i = 0; i < 3; i++) {
        const p = o[i] + d[i] * t0;
        idx[i] = Math.max(0, Math.min(g.dims[i] - 1, Math.floor((p - g.origin[i]) / g.cell[i])));
        if (Math.abs(d[i]) < 1e-20) {
            step[i] = 0;
            tMax[i] = Infinity;
            tDelta[i] = Infinity;
            continue;
        }
        step[i] = d[i] > 0 ? 1 : -1;
        const edge = g.origin[i] + (idx[i] + (step[i] > 0 ? 1 : 0)) * g.cell[i];
        tMax[i] = (edge - o[i]) / d[i];
        tDelta[i] = g.cell[i] / Math.abs(d[i]);
    }
    const guard = g.dims[0] + g.dims[1] + g.dims[2] + 3;
    for (let n = 0; n < guard; n++) {
        visit(idx[0] + g.dims[0] * (idx[1] + g.dims[1] * idx[2]));
        const j = tMax[0] <= tMax[1] && tMax[0] <= tMax[2] ? 0 : tMax[1] <= tMax[2] ? 1 : 2;
        if (tMax[j] > t1)
            return;
        idx[j] += step[j];
        if (idx[j] < 0 || idx[j] >= g.dims[j])
            return;
        tMax[j] += tDelta[j];
    }
}
/**
 * The nearest triangle a ray meets within `maxLen` (11.2): `dir` a unit vector, box frame. Ties go to
 * the lower triangle index. Null for none.
 */
export function rayQuery(s, origin, dir, maxLen) {
    if (!s.grid || !(maxLen >= 0))
        return null;
    let best = -1, bestT = Infinity;
    const seen = new Set();
    walkCells(s.grid, origin, dir, maxLen, (c) => {
        const g = s.grid;
        for (let i = g.start[c]; i < g.start[c + 1]; i++) {
            const t = g.items[i];
            if (seen.has(t))
                continue;
            seen.add(t);
            const h = rayTri(s, t, origin, dir);
            if (h < 0 || h > maxLen)
                continue;
            if (h < bestT || (h === bestT && t < best)) {
                bestT = h;
                best = t;
            }
        }
    });
    if (best < 0)
        return null;
    const a = corner(s, best, 0);
    let n = cross(sub(corner(s, best, 1), a), sub(corner(s, best, 2), a));
    const l = len(n);
    n = l === 0 ? [0, 1, 0] : scale(n, 1 / l);
    if (dot(n, dir) > 0)
        n = scale(n, -1);
    return { t: bestT, normal: n, point: add(origin, scale(dir, bestT)), tri: best };
}
/** The closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTriangle(p, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0)
        return a;
    const bp = sub(p, b);
    const d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3)
        return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0)
        return add(a, scale(ab, d1 / (d1 - d3)));
    const cp = sub(p, c);
    const d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6)
        return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0)
        return add(a, scale(ac, d2 / (d2 - d6)));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
        return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
    const den = 1 / (va + vb + vc);
    return add(a, add(scale(ab, vb * den), scale(ac, vc * den)));
}
/** The closest points of segments p1q1 and p2q2 (Ericson 5.1.9). */
function closestSegSeg(p1, q1, p2, q2) {
    const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
    let s, t;
    if (a <= 1e-12 && e <= 1e-12)
        return [p1, p2];
    if (a <= 1e-12) {
        s = 0;
        t = Math.max(0, Math.min(1, f / e));
    }
    else {
        const c = dot(d1, r);
        if (e <= 1e-12) {
            t = 0;
            s = Math.max(0, Math.min(1, -c / a));
        }
        else {
            const b = dot(d1, d2), den = a * e - b * b;
            s = den !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
            t = (b * s + f) / e;
            if (t < 0) {
                t = 0;
                s = Math.max(0, Math.min(1, -c / a));
            }
            else if (t > 1) {
                t = 1;
                s = Math.max(0, Math.min(1, (b - c) / a));
            }
        }
    }
    return [add(p1, scale(d1, s)), add(p2, scale(d2, t))];
}
/** The closest points of segment pq and triangle abc: [on the segment, on the triangle]. */
function closestSegTri(p, q, a, b, c) {
    // Crossing the triangle: distance 0.
    const d = sub(q, p);
    const e1 = sub(b, a), e2 = sub(c, a);
    const h = cross(d, e2), det = dot(e1, h);
    if (Math.abs(det) > 1e-12) {
        const sv = sub(p, a), u = dot(sv, h) / det;
        const qq = cross(sv, e1), v = dot(d, qq) / det, t = dot(e2, qq) / det;
        if (u >= 0 && v >= 0 && u + v <= 1 && t >= 0 && t <= 1) {
            const x = add(p, scale(d, t));
            return [x, x];
        }
    }
    let best = [p, closestOnTriangle(p, a, b, c)];
    let bd = len(sub(best[0], best[1]));
    const consider = (pair) => { const dd = len(sub(pair[0], pair[1])); if (dd < bd) {
        bd = dd;
        best = pair;
    } };
    consider([q, closestOnTriangle(q, a, b, c)]);
    consider(closestSegSeg(p, q, a, b));
    consider(closestSegSeg(p, q, b, c));
    consider(closestSegSeg(p, q, c, a));
    return best;
}
/** Clip a polygon to |(v - c).axis| <= h. */
function clipSlab(poly, c, axis, h) {
    let out = poly;
    for (const sign of [1, -1]) {
        const res = [];
        for (let i = 0; i < out.length; i++) {
            const a = out[i], b = out[(i + 1) % out.length];
            const da = sign * dot(sub(a, c), axis) - h, db = sign * dot(sub(b, c), axis) - h;
            if (da <= 0)
                res.push(a);
            if ((da <= 0) !== (db <= 0))
                res.push(add(a, scale(sub(b, a), da / (da - db))));
        }
        out = res;
        if (out.length < 3)
            return out;
    }
    return out;
}
/**
 * The deepest triangle inside a tire cylinder (11.3): centre `c`, unit `axis`, radius `r`, half width
 * `halfW`, extra reach `slack`; with `treadClip` the cylinder is cut at its sidewalls, otherwise a capsule.
 * Box frame. Ties go to the lower triangle index.
 */
export function cylinderQuery(s, c, axis, r, halfW, slack, treadClip) {
    const g = s.grid;
    if (!g)
        return null;
    const reach = r + halfW + slack;
    const r0 = [], r1 = [];
    for (let i = 0; i < 3; i++) {
        r0[i] = Math.floor((c[i] - reach - g.origin[i]) / g.cell[i]);
        r1[i] = Math.floor((c[i] + reach - g.origin[i]) / g.cell[i]);
        if (r1[i] < 0 || r0[i] >= g.dims[i])
            return null;
        r0[i] = Math.max(0, r0[i]);
        r1[i] = Math.min(g.dims[i] - 1, r1[i]);
    }
    const p = sub(c, scale(axis, halfW)), q = add(c, scale(axis, halfW));
    const seen = new Set();
    let best = null;
    for (let z = r0[2]; z <= r1[2]; z++)
        for (let y = r0[1]; y <= r1[1]; y++)
            for (let x = r0[0]; x <= r1[0]; x++) {
                const cell = x + g.dims[0] * (y + g.dims[1] * z);
                for (let i = g.start[cell]; i < g.start[cell + 1]; i++) {
                    const t = g.items[i];
                    if (seen.has(t))
                        continue;
                    seen.add(t);
                    const a = corner(s, t, 0), b = corner(s, t, 1), cc = corner(s, t, 2);
                    const poly = treadClip ? clipSlab([a, b, cc], c, axis, halfW) : [a, b, cc];
                    if (poly.length < 3)
                        continue;
                    let bestPair = null, bd = Infinity;
                    for (let k = 1; k < poly.length - 1; k++) {
                        const pair = closestSegTri(p, q, poly[0], poly[k], poly[k + 1]);
                        const dd = len(sub(pair[0], pair[1]));
                        if (dd < bd) {
                            bd = dd;
                            bestPair = pair;
                        }
                    }
                    if (!bestPair || !(bd < r + slack))
                        continue;
                    const pen = r - bd;
                    if (best && (pen < best.penetration || (pen === best.penetration && t > best.tri)))
                        continue;
                    let n = cross(sub(b, a), sub(cc, a));
                    const l = len(n);
                    n = l === 0 ? [0, 1, 0] : scale(n, 1 / l);
                    if (dot(n, sub(bestPair[0], bestPair[1])) < 0)
                        n = scale(n, -1);
                    best = { penetration: pen, point: bestPair[1], normal: n, tri: t };
                }
            }
    return best;
}
/** The distance from a point to the nearest triangle (box frame). */
export function pointDistance(s, p) {
    let best = Infinity;
    for (let t = 0; t < s.count; t++) {
        const d = len(sub(p, closestOnTriangle(p, corner(s, t, 0), corner(s, t, 1), corner(s, t, 2))));
        if (d < best)
            best = d;
    }
    return best;
}
/** A shape's triangle normal (unit), box frame. */
export function triangleNormal(s, t) {
    const a = corner(s, t, 0);
    const n = cross(sub(corner(s, t, 1), a), sub(corner(s, t, 2), a));
    const l = len(n);
    return l === 0 ? [0, 1, 0] : scale(n, 1 / l);
}
