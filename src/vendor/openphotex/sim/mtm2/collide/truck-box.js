import { truckRadius } from "../truck/recovery.js";
const toWorld = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
const toBody = (m, x, y, z) => [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
/** The six faces: left (-x), right (+x), bottom, top, front (+z), back (-z). */
const FACES = [
    { axis: 0, sign: -1 }, { axis: 0, sign: 1 },
    { axis: 1, sign: -1 }, { axis: 1, sign: 1 },
    { axis: 2, sign: 1 }, { axis: 2, sign: -1 },
];
/** The order the game tries them in: hull points start with y, wheels with x. */
const HULL_ORDER = [2, 3, 4, 5, 0, 1];
const WHEEL_ORDER = [0, 1, 2, 3, 4, 5];
/**
 * The nearest face a ray crosses inside the face (at most two crossings are counted, as in the
 * game), trying the faces in `order`; later faces win ties. `directional`: only faces ahead of
 * the origin (t > 0) whose outward normal faces the ray count.
 */
function nearestFace(half, origin, dir, directional, order) {
    let best = 999999, face = -1, crossings = 0;
    for (const f of order) {
        const { axis, sign } = FACES[f];
        if (dir[axis] === 0)
            continue;
        if (crossings >= 2)
            continue;
        const t = (sign * half[axis] - origin[axis]) / dir[axis];
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const pu = origin[u] + dir[u] * t, pv = origin[v] + dir[v] * t;
        if (!(pu < half[u] && pu > -half[u] && pv < half[v] && pv > -half[v]))
            continue;
        crossings++;
        const at = Math.abs(t);
        if (directional) {
            const facing = dir[axis] * sign < 0;
            if (!(at <= best && t > 0 && facing))
                continue;
        }
        else if (!(at <= best)) {
            continue;
        }
        best = at;
        face = f;
    }
    return { face };
}
/** A point's depth inside a face (positive inside), box frame. */
function depthInside(half, p, face) {
    const { axis, sign } = FACES[face];
    return sign > 0 ? half[axis] - p[axis] : p[axis] + half[axis];
}
/** The face's outward normal in the box frame. */
function faceNormal(face) {
    const n = [0, 0, 0];
    n[FACES[face].axis] = FACES[face].sign;
    return n;
}
/** The sphere and separating-axis early out (§14.14 step 1). */
export function truckBoxSeparated(s, p, box, dt) {
    const R = truckRadius(p);
    const dx = s.pos[0] - box.pos[0], dy = s.pos[1] - box.pos[1], dz = s.pos[2] - box.pos[2];
    if (dx * dx + dy * dy + dz * dz >= (R + box.radius) ** 2)
        return true;
    const d = toBody(box.matrix, dx, dy, dz);
    const iv = toWorld(s.matrix, s.bvel[0], s.bvel[1], s.bvel[2]);
    const v = toBody(box.matrix, iv[0] - box.vel[0], iv[1] - box.vel[1], iv[2] - box.vel[2]);
    for (let k = 0; k < 3; k++) {
        if (d[k] <= 0) {
            const vk = v[k] < 0 ? 0 : v[k];
            if (d[k] + R + vk * dt < -box.half[k])
                return true;
        }
        else {
            const vk = v[k] > 0 ? 0 : v[k];
            if (d[k] - R + vk * dt > box.half[k])
                return true;
        }
    }
    return false;
}
/**
 * Contacts from an immovable box (§14.14 steps 2 and 3): hull points, wheels and tire contact
 * points. `s.prevPos` is the truck centre before this step's move.
 */
export function collideTruckImmovableBox(s, p, box, dt) {
    if (truckBoxSeparated(s, p, box, dt))
        return;
    const m = s.matrix, bm = box.matrix, half = box.half;
    const iv = toWorld(m, s.bvel[0], s.bvel[1], s.bvel[2]);
    const rel = [s.pos[0] - box.pos[0], s.pos[1] - box.pos[1], s.pos[2] - box.pos[2]];
    // Hull points: rays from last step's reference point through each point now.
    const lift = toWorld(m, 0, s.points[2 * 3 + 1] * 0.5, 0);
    const prevRef = toBody(bm, rel[0] - (iv[0] - box.vel[0]) * dt + lift[0], rel[1] - (iv[1] - box.vel[1]) * dt + lift[1], rel[2] - (iv[2] - box.vel[2]) * dt + lift[2]);
    for (let j = 0; j < 12; j++) {
        const w = toWorld(m, s.points[j * 3], s.points[j * 3 + 1], s.points[j * 3 + 2]);
        const cur = toBody(bm, rel[0] + w[0], rel[1] + w[1], rel[2] + w[2]);
        const dir = unit([cur[0] - prevRef[0], cur[1] - prevRef[1], cur[2] - prevRef[2]]);
        const { face } = nearestFace(half, prevRef, dir, true, HULL_ORDER);
        if (face < 0)
            continue;
        const depth = depthInside(half, cur, face);
        if (depth <= s.depths[j])
            continue;
        s.depths[j] = depth;
        const n = faceNormal(face);
        s.normals.set(toWorld(bm, n[0], n[1], n[2]), j * 3);
    }
    // Wheels, tires 13 to 16 (FR, FL, RR, RL), sides -1, +1, -1, +1.
    const prevCentre = [s.prevPos[0] - box.pos[0], s.prevPos[1] - box.pos[1], s.prevPos[2] - box.pos[2]];
    for (let i = 0; i < 4; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        wheelSuspension(s, p, box, i, side, prevCentre);
        tireContactPoint(s, p, box, i, dt);
    }
}
function unit(v) {
    const l = Math.hypot(v[0], v[1], v[2]);
    return l === 0 ? [0, 1, 0] : [v[0] / l, v[1] / l, v[2] / l];
}
/** The wheel's suspension against the box: driving on its top (§14.14 step 3). */
function wheelSuspension(s, p, box, i, side, prevCentre) {
    const m = s.matrix, bm = box.matrix, half = box.half;
    const t = s.tires[i];
    const [ax, ay, az] = p.hubs[i];
    const r = p.tireRadiusFt, w = p.tireWidthFt;
    // Toward the bottom of the wheel at its static anchor, from last step's centre.
    const bottom = toWorld(m, ax, ay - r, az);
    const toBottom = [
        s.pos[0] + bottom[0] - s.prevPos[0], s.pos[1] + bottom[1] - s.prevPos[1], s.pos[2] + bottom[2] - s.prevPos[2],
    ];
    const dir = unit(toBody(bm, toBottom[0], toBottom[1], toBottom[2]));
    const art = s.axles[i < 2 ? 0 : 1].articulation;
    const off = toWorld(m, Math.cos(art) * w * side * 0.5, Math.sin(art) * w * side * 0.5, 0);
    const origin = toBody(bm, prevCentre[0] + off[0], prevCentre[1] + off[1], prevCentre[2] + off[2]);
    const { face } = nearestFace(half, origin, dir, false, WHEEL_ORDER);
    if (face < 0)
        return;
    const out = faceNormal(face);
    const outWorld = toWorld(bm, out[0], out[1], out[2]);
    const outTruck = toBody(m, outWorld[0], outWorld[1], outWorld[2]);
    // Only a face that is mostly up or down in the truck frame counts; only up gives contact.
    if (Math.abs(outTruck[1]) <= 0.5 || outTruck[1] <= 0.5)
        return;
    const inY = -outTruck[1], inZ = -outTruck[2];
    const l = Math.hypot(inY, inZ);
    const ny = l === 0 ? 1 : inY / l, nz = l === 0 ? 0 : inZ / l;
    const px = w * side * 0.5 + ax;
    const point = [px, ay + r * ny, az + r * nz];
    const pw = toWorld(m, point[0], point[1], point[2]);
    const pb = toBody(bm, s.pos[0] + pw[0] - box.pos[0], s.pos[1] + pw[1] - box.pos[1], s.pos[2] + pw[2] - box.pos[2]);
    const pen = -(depthInside(half, pb, face) / inY);
    if (!(t.penetration < pen))
        return;
    if (pen > 0) {
        t.normal = outWorld;
        t.onGround = true;
    }
    t.penetration = pen;
    t.lever = Math.hypot(r, px);
}
/** A tire contact point (13 to 16) against the box (§14.14 step 3). */
function tireContactPoint(s, p, box, i, dt) {
    const m = s.matrix, bm = box.matrix, half = box.half;
    const t = s.tires[i];
    const hubW = toWorld(m, t.hub[0], t.hub[1], t.hub[2]);
    // From last step's centre, relative to the box's last position, toward the hub now.
    const origin = toBody(bm, s.prevPos[0] - (box.pos[0] - box.vel[0] * dt), s.prevPos[1] - (box.pos[1] - box.vel[1] * dt), s.prevPos[2] - (box.pos[2] - box.vel[2] * dt));
    const ray = toBody(bm, s.pos[0] + hubW[0] - s.prevPos[0], s.pos[1] + hubW[1] - s.prevPos[1], s.pos[2] + hubW[2] - s.prevPos[2]);
    if (ray[0] === 0 && ray[1] === 0 && ray[2] === 0)
        return;
    const { face } = nearestFace(half, origin, unit(ray), false, WHEEL_ORDER);
    if (face < 0)
        return;
    const out = faceNormal(face);
    const outWorld = toWorld(bm, out[0], out[1], out[2]);
    const n = toBody(m, outWorld[0], outWorld[1], outWorld[2]);
    const reach = p.tireRadiusFt * Math.max(Math.abs(Math.sin(Math.atan2(n[2], n[1]))), Math.abs(Math.sin(Math.atan2(n[0], n[1]))));
    const side = -n[0] > 0 ? 1 : -1;
    const l = Math.hypot(n[1], n[2]);
    const ny = l === 0 ? 1 : -n[1] / l, nz = l === 0 ? 0 : -n[2] / l;
    const point = [t.hub[0] + p.tireWidthFt * side * 0.5, t.hub[1] + ny * reach, t.hub[2] + nz * reach];
    const pw = toWorld(m, point[0], point[1], point[2]);
    const pb = toBody(bm, s.pos[0] + pw[0] - box.pos[0], s.pos[1] + pw[1] - box.pos[1], s.pos[2] + pw[2] - box.pos[2]);
    const depth = depthInside(half, pb, face);
    const j = 12 + i;
    if (!(s.depths[j] < depth))
        return;
    s.depths[j] = depth;
    s.normals.set(outWorld, j * 3);
    s.points.set(point, j * 3);
}
