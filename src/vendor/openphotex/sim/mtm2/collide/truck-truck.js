/*
  A truck against a truck (MTM2_PHYSICS.md §7.4, §14.20): each truck's hull points against the
  other's hull box, the faster truck pushed out along the axis the relative motion leaves by
  soonest, and the inelastic force law with the lighter truck's mass. As for boxes, each contact
  replaces the pair's forces and only the last one is applied. The wheels against each other
  (§14.20, `0x491950`) are not in yet.
*/
import { INV_G } from "../constants.js";
import { truckWeight } from "../truck/dynamics.js";
import { truckRadius } from "../truck/recovery.js";
const toWorld = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
const toBody = (m, x, y, z) => [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A body point's velocity, `bvel + omega x r` with omega = (q, r, p) on (x, y, z). */
function pointVelocity(s, r) {
    const [p, q, w] = s.rates;
    return [s.bvel[0] + (w * r[2] - p * r[1]), s.bvel[1] + (p * r[0] - q * r[2]), s.bvel[2] + (q * r[1] - w * r[0])];
}
/** Whether `r` (O's axes) is inside O's hull box: two half boxes of its hull points (§14.20). */
function insideHullBox(hull, r) {
    const [P1, P2, P3, , , , , , P9, , P11, P12] = hull;
    if (r[2] >= 0) {
        return r[2] <= P1[2] && P1[0] <= r[0] && r[0] <= P2[0] && P1[1] <= r[1] && r[1] <= P3[1];
    }
    return P11[2] <= r[2] && P11[0] <= r[0] && r[0] <= P12[0] && P11[1] <= r[1] && r[1] <= P9[1];
}
/**
 * The pair test of two trucks (§14.20). `a` is the pair's first truck. Pair forces go to each
 * truck's `extForce` / `extMoment`; the faster truck is moved out of the slower one.
 */
export function collideTrucks(a, b, dt) {
    if (a.s.heliTimer > 0 || b.s.heliTimer > 0)
        return;
    const ra = truckRadius(a.p), rb = truckRadius(b.p);
    const d = Math.hypot(a.s.pos[0] - b.s.pos[0], a.s.pos[1] - b.s.pos[1], a.s.pos[2] - b.s.pos[2]);
    if (d >= ra + rb)
        return;
    const speed = (t) => {
        const v = toWorld(t.s.matrix, t.s.bvel[0], t.s.bvel[1], t.s.bvel[2]);
        return Math.hypot(v[0], v[1], v[2]);
    };
    const [slow, fast] = speed(b) < speed(a) ? [b, a] : [a, b];
    const mEff = Math.min(truckWeight(a.p), truckWeight(b.p)) * INV_G;
    const out = { a: null, b: null };
    pass(fast, slow, slow, mEff, dt, a, out);
    pass(slow, fast, slow, mEff, dt, a, out);
    for (const [t, f] of [[a, out.a], [b, out.b]]) {
        if (!f)
            continue;
        for (let k = 0; k < 3; k++) {
            t.s.extForce[k] += f.f[k];
            t.s.extMoment[k] += f.m[k];
        }
    }
}
/** The points of `T` against the hull box of `O`. */
function pass(O, T, slow, mEff, dt, first, out) {
    const mo = O.s.matrix, mt = T.s.matrix;
    const hull = O.p.scrapePoints;
    const radius = truckRadius(O.p);
    // T's points as world offsets, formed once; the positions are read as they move.
    const offsets = [];
    for (let j = 0; j < 12; j++)
        offsets.push(toWorld(mt, T.s.points[j * 3], T.s.points[j * 3 + 1], T.s.points[j * 3 + 2]));
    for (let j = 0; j < 12; j++) {
        const w = offsets[j];
        const dw = [T.s.pos[0] + w[0] - O.s.pos[0], T.s.pos[1] + w[1] - O.s.pos[1], T.s.pos[2] + w[2] - O.s.pos[2]];
        if (!(dw[0] * dw[0] + dw[1] * dw[1] + dw[2] * dw[2] < radius * radius))
            continue;
        const r = toBody(mo, dw[0], dw[1], dw[2]);
        if (!insideHullBox(hull, r))
            continue;
        const P = [T.s.points[j * 3], T.s.points[j * 3 + 1], T.s.points[j * 3 + 2]];
        respond(O, T, slow, P, r, hull, mEff, dt, first, out);
    }
}
function respond(O, T, slow, P, r, hull, mEff, dt, first, out) {
    const mo = O.s.matrix, mt = T.s.matrix;
    const vtw = toWorld(mt, ...pointVelocity(T.s, P));
    const vt = toBody(mo, vtw[0], vtw[1], vtw[2]);
    const vo = pointVelocity(O.s, r);
    const v = [vo[0] - vt[0], vo[1] - vt[1], vo[2] - vt[2]];
    const [P1, P2, P3, , , , , , P9, , P11, P12] = hull;
    const rear = v[2] <= 0;
    const dx = Math.abs((v[0] <= 0 ? (rear ? P11 : P1)[0] : (rear ? P12 : P2)[0]) - r[0]);
    const dy = Math.abs((v[1] <= 0 ? (rear ? P11 : P1)[1] : (rear ? P9 : P3)[1]) - r[1]);
    const dz = Math.abs((rear ? P11 : P1)[2] - r[2]);
    const t = [v[0] === 0 ? 100 : dx / v[0], v[1] === 0 ? 1e6 : dy / v[1], v[2] === 0 ? 100 : dz / v[2]];
    // The axis the relative motion leaves by soonest (0x48c3d0).
    let k = -1;
    const A = t.map(Math.abs);
    if (A[1] <= A[0]) {
        if (A[2] <= A[1]) {
            if (t[2] !== 0)
                k = 2;
        }
        else if (t[1] !== 0)
            k = 1;
    }
    else if (A[2] <= A[0]) {
        if (t[2] !== 0)
            k = 2;
    }
    else if (t[0] !== 0)
        k = 0;
    if (k < 0)
        return;
    const tk = A[k];
    const push = toWorld(mo, v[0] * tk, v[1] * tk, v[2] * tk);
    // The faster truck moves.
    if (O === slow)
        for (let i = 0; i < 3; i++)
            T.s.pos[i] += push[i];
    else
        for (let i = 0; i < 3; i++)
            O.s.pos[i] -= push[i];
    const e = [0, 0, 0];
    e[k] = Math.sign(t[k]);
    const F = (Math.abs(v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) / dt) * mEff;
    const fo = [-F * e[0], -F * e[1], -F * e[2]];
    const fw = toWorld(mo, F * e[0], F * e[1], F * e[2]);
    const ft = toBody(mt, fw[0], fw[1], fw[2]);
    const forO = { f: fo, m: cross(r, fo) }, forT = { f: ft, m: cross(P, ft) };
    if (O === first) {
        out.a = forO;
        out.b = forT;
    }
    else {
        out.a = forT;
        out.b = forO;
    }
}
