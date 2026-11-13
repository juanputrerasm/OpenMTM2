// ---- Constants ----
/** Column spacings tried in order, ft (12.2.2). */
export const FALL_SPACINGS_FT = [2, 3, 4, 6, 8];
/** A spacing with more columns than this has none (12.2.2). */
export const FALL_MAX_COLUMNS = 1100;
/** Floats per vertex (64 bytes). */
export const FALL_VERTEX_FLOATS = 16;
/** Vertex budget of one fall (12.1.5). */
export const FALL_MAX_FALL_VERTICES = 16384;
/** The track's vertex buffer (16 MiB of 64-byte vertices) and index buffer (6 MiB of u32). */
export const FALL_MAX_TRACK_VERTICES = 262144;
export const FALL_MAX_TRACK_INDICES = 1572864;
/** Falls built at most (and records accepted at most). */
export const FALL_MAX_BUILT = 64;
/** Rows a column walk can emit: row 0, 4000 steps, the sink. */
export const FALL_MAX_ROWS = 4002;
/** The walk's constants (12.2.4, 12.2.5, 12.2.7). */
export const FALL_WALK = {
    dt: 1 / 60,
    /** Added to vy each step after the move (-32 ft/s^2 * dt). */
    gravityPerStep: -32 / 60,
    steps: 4000,
    /** The sheet stays this far above the ground when draped. */
    drapeFt: 0.3,
    /** Every component of v, each draped step. */
    drag: 0.98,
    /** Not draped: air 1 when higher than this above the drape height. */
    airGapFt: 0.05,
    /** Comes to rest when draped, the ground normal's y above cos 5 deg and |v| below this. */
    restCos: 0.9961947,
    restSpeedFtPerSec: 2,
    /** The trim's "flat contact": air 0 and the ground normal's y above cos 10 deg. */
    flatCos: 0.9848078,
    /** The trim keeps this much path past where the water got within `trimRiseFt` of its final height. */
    trimPathFt: 8,
    trimRiseFt: 1,
    /** The sink vertex goes this far below the water row. */
    sinkFt: 4,
    /** Speed smoothing: prev * exp(-chord / this). */
    speedDecayFt: 8,
    /** The end fade on a column without a sink: (path left) / this. */
    endFadeFt: 6,
};
/** The vertex layout as the shader reads it (12.0.1, 12.2.7): float offsets. */
export const FALL_VERTEX = {
    posX: 0, posY: 1, posZ: 2, u: 3, tau: 4, speed: 5, air: 6, edge: 7,
    end: 8, kind: 9, fall: 10, drop: 11, normalX: 12, normalY: 13, normalZ: 14, path: 15,
};
/** Vertex positions are in this many units a foot, relative to the fall's anchor. */
export const FALL_VERTEX_UNITS_PER_FT = 256;
/** Column end kinds (12.2.4): 1 water, 2 at rest on the ground, 3 out of steps. */
export const FALL_END_WATER = 1;
export const FALL_END_REST = 2;
export const FALL_END_LIMIT = 3;
/** The record flags (12.1.2). */
export const FALL_FLAG_FREEZE = 1;
export const FALL_FLAG_SPLASH = 2;
export const FALL_FLAG_SOUND = 4;
/** The weather that is Snow (FREEZE stops sound, mist snow bit, droplets, rings; look 3). */
export const FALL_WEATHER_SNOW = 5;
/**
 * The engine's ground for the walk (12.2.3): terrain only, the integer triangle rule. Classic (8 or 16-bit) on the
 * 256 x 256 corners at 32 ft, spline and Full Map on the 1024 x 1024 grid at 8 ft; heights as the engine holds them
 * (v >> 1 at 1/64 ft, times 4), the fraction in 16.16, `(a * b) >> 16` per edge, the parity split. Feet in, feet out.
 */
export function fallGround(heights) {
    const fine = heights.mode === "spline" || heights.mode === "fine";
    const src = fine ? heights.fine : heights.coarse;
    const cells = fine ? 1024 : 256;
    if (!src || src.length !== cells * cells)
        throw new RangeError(`fallGround: needs ${cells} x ${cells} heights`);
    const corners = new Int32Array(src.length);
    for (let i = 0; i < src.length; i++)
        corners[i] = src[i] >> 1;
    return fine ? (x, z) => fallTerrainHeight(corners, 1024, x, z) : (x, z) => fallTerrainHeight(corners, 256, x, z);
}
const fmul = (a, b) => Math.floor((a * b) / 65536);
/**
 * Terrain height in feet at (x, z) on a grid of `cells` x `cells` corner heights in 1/64 ft (rows along z): 256 for
 * the classic 32 ft grid, 1024 for the 8 ft fine grid (12.2.3).
 */
export function fallTerrainHeight(corners, cells, x, z) {
    const shift = cells === 256 ? 13 : 11;
    const cellMask = (1 << shift) - 1;
    const fracMul = 65536 >> shift;
    const m = cells - 1;
    const xi = Math.floor(x * 256) | 0, zi = Math.floor(z * 256) | 0;
    const x1 = (xi >> shift) & m, z1 = (zi >> shift) & m;
    const x2 = (x1 + 1) & m, z2 = (z1 + 1) & m;
    const xf = (xi & cellMask) * fracMul, zf = (zi & cellMask) * fracMul;
    const Y = (tx, tz) => corners[tz * cells + tx] * 4;
    let r;
    if ((x1 & 1) === (z1 & 1)) {
        const y0 = Y(x1, z1);
        if (xf > zf) {
            const y1 = Y(x2, z1), y2 = Y(x2, z2);
            r = y0 + fmul(y1 - y0, xf) + fmul(y2 - y1, zf);
        }
        else {
            const y2 = Y(x2, z2), y3 = Y(x1, z2);
            r = y0 + fmul(y2 - y3, xf) + fmul(y3 - y0, zf);
        }
    }
    else if (0x10000 - xf > zf) {
        const y0 = Y(x1, z1), y1 = Y(x2, z1), y3 = Y(x1, z2);
        r = y1 + fmul(y0 - y1, 0x10000 - xf) + fmul(y3 - y0, zf);
    }
    else {
        const y1 = Y(x2, z1), y2 = Y(x2, z2), y3 = Y(x1, z2);
        r = y1 + fmul(y3 - y2, 0x10000 - xf) + fmul(y2 - y1, zf);
    }
    return r / 256;
}
/**
 * The walk's water (12.2.3): the 32 ft tile's lake, unless the tile is dry or the fall's own source lake, where the
 * track's .LVL water counts instead, and none when that is below 1/256 ft (or absent). `lvlWaterFt` is the .LVL
 * `!waterHeight` in feet (the raw value * 0.5). A tile naming a lake not in `lakes` (one the WTR loader refused) has
 * no water.
 */
export function fallWater(wtr, lvlWaterFt) {
    const lvl = lvlWaterFt !== null && Math.floor(lvlWaterFt * 256) >= 1 ? lvlWaterFt : null;
    const surface = new Float64Array(256).fill(Number.NaN);
    for (const k of wtr?.lakes ?? [])
        if (k.id >= 1 && k.id <= 255)
            surface[k.id] = k.height * 0.5;
    const map = wtr?.tileMap ?? null;
    return (x, z, source) => {
        const tile = map ? map[((Math.floor(z * 256) >> 13) & 255) * 256 + ((Math.floor(x * 256) >> 13) & 255)] : 0;
        if (tile === 0 || tile === source)
            return lvl;
        const s = surface[tile];
        return Number.isNaN(s) ? null : s;
    };
}
/** The status texts the "damaged (%s)" message names (12.1.3); 0 and 4 have their own messages. */
export const FALL_FILE_STATUS_TEXT = {
    0: "ok",
    1: "empty file",
    2: "not a waterfall file (bad magic)",
    3: "file truncated (header)",
    4: "newer format",
    5: "bad header size or chunk directory runs past the end",
    6: "authored for a different terrain size",
    7: "no usable waterfall list",
};
/**
 * Read a .WFL as the engine's parser does (12.1.2), which differs from Traxx's reader (`parseWfl`) on damaged files:
 * the status codes of the on-screen messages, only the first FALL entry considered, the record count clamped to the
 * chunk (truncated), and bad records left to the record checks instead of refusing the file. Never throws.
 */
export function readFallFile(bytes) {
    const counters = { unknown: 0, duplicate: 0, outOfBounds: 0, badVersion: 0, badStride: 0, truncated: 0 };
    const out = (status, major = 0, minor = 0, stride = 0, falls = []) => ({ status, major, minor, stride, counters, falls });
    const size = bytes.length;
    const r16 = (o) => bytes[o] | (bytes[o + 1] << 8);
    const r32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
    if (size === 0)
        return out(1);
    if (size < 4)
        return out(3);
    if (bytes[0] !== 0x4d || bytes[1] !== 0x57 || bytes[2] !== 0x46 || bytes[3] !== 0x4c)
        return out(2);
    if (size < 0x20)
        return out(3);
    const major = r16(4), minor = r16(6);
    if (major !== 1)
        return out(4, major, minor);
    const dir = r32(8), count = r32(12);
    if (dir < 0x20 || dir + count * 16 > size)
        return out(5, major, minor);
    if (r16(0x10) !== 256 || r16(0x12) !== 256)
        return out(6, major, minor);
    let chunk = null, seen = false;
    for (let i = 0; i < count; i++) {
        const e = dir + i * 16;
        const isFall = bytes[e] === 0x46 && bytes[e + 1] === 0x41 && bytes[e + 2] === 0x4c && bytes[e + 3] === 0x4c;
        if (!isFall) {
            counters.unknown++;
            continue;
        }
        if (seen) {
            counters.duplicate++;
            continue;
        }
        seen = true;
        const version = r32(e + 4), off = r32(e + 8), len = r32(e + 12);
        if (off + len > size)
            counters.outOfBounds++;
        else if (version !== 1)
            counters.badVersion++;
        else
            chunk = [off, len];
    }
    if (!chunk || chunk[1] < 8)
        return out(7, major, minor);
    const [off, len] = chunk;
    let n = r32(off);
    const stride = r16(off + 4);
    if (stride < WFL_RECORD_MIN) {
        counters.badStride++;
        return out(7, major, minor, stride);
    }
    if (n === 0)
        return out(7, major, minor, stride);
    const room = Math.floor((len - 8) / stride);
    if (n > room) {
        n = room;
        counters.truncated++;
    }
    if (n === 0)
        return out(7, major, minor, stride);
    const name = (o) => {
        let s = "";
        for (let i = 0; i < 16; i++) {
            const c = bytes[o + i];
            if (c === 0)
                return s;
            s += String.fromCharCode(c);
        }
        return s; // no NUL: 16 characters, which the record checks call badName
    };
    const falls = [];
    for (let i = 0; i < n; i++) {
        const r = off + 8 + i * stride;
        const np = bytes[r + 2];
        const flags = r16(r + 4), speed = r16(r + 6), height = r32(r + 8);
        const points = np >= 2 && np <= 8
            ? Array.from({ length: np }, (_, k) => ({ x: r32(r + 12 + 8 * k), z: r32(r + 16 + 8 * k) }))
            : Array.from({ length: np }, () => ({ x: 0, z: 0 }));
        const v11 = stride >= 0x84;
        falls.push({
            id: bytes[r], source: bytes[r + 1], flags,
            freeze: (flags & FALL_FLAG_FREEZE) !== 0, splash: (flags & FALL_FLAG_SPLASH) !== 0, sound: (flags & FALL_FLAG_SOUND) !== 0,
            speed, speedFtPerSec: speed * 0.0625, height, heightFt: height * 0.5, points,
            opacity: bytes[r + 0x4c], mist: bytes[r + 0x4d], volume: bytes[r + 0x4e],
            mistDepth: v11 ? bytes[r + 0x80] : 100, mistHeight: v11 ? bytes[r + 0x81] : 100,
            soundName: name(r + 0x50), textureName: name(r + 0x60),
        });
    }
    return out(0, major, minor, stride, falls);
}
/** The engine's smallest record stride (12.1.2). */
const WFL_RECORD_MIN = 0x80;
/**
 * The parser's record checks (12.1.2) in its order: id 1..255, unique (marked used before the later checks), 2..8
 * points, coordinates below 0x20000, speed 16..1600, height 1..4096, no flag above bit 2, names that fit 15
 * characters, at most 64 accepted. parseWfl already refuses a point count outside 2..8 and more than 64 records; a
 * stem without a NUL in its 16 bytes cannot reach here from parseWfl, so badName only catches a longer name passed in.
 */
export function checkFallRecords(falls) {
    const counters = { badId: 0, dupId: 0, badPoints: 0, badCoord: 0, badSpeed: 0, badHeight: 0, badFlags: 0, badName: 0, over: 0 };
    const accepted = [];
    const rejected = [];
    const used = new Uint8Array(256);
    falls.forEach((f, index) => {
        const reason = recordError(f, used, accepted.length);
        if (reason) {
            counters[reason]++;
            rejected.push({ index, id: f.id, reason });
            return;
        }
        const size = (v) => (v ? Math.min(v, 250) : 100);
        accepted.push({
            index,
            fall: {
                ...f, points: f.points.map((p) => ({ x: p.x, z: p.z })),
                opacity: Math.min(f.opacity, 100), mist: Math.min(f.mist, 200), volume: Math.min(f.volume, 200),
                mistDepth: size(f.mistDepth), mistHeight: size(f.mistHeight),
            },
        });
    });
    return { accepted, rejected, counters };
}
function recordError(f, used, nAccepted) {
    if (!Number.isInteger(f.id) || f.id < 1 || f.id > 255)
        return "badId";
    if (used[f.id])
        return "dupId";
    used[f.id] = 1;
    if (f.points.length < 2 || f.points.length > 8)
        return "badPoints";
    for (const p of f.points)
        if (!(p.x >= 0 && p.x < 0x20000 && p.z >= 0 && p.z < 0x20000))
            return "badCoord";
    if (!(f.speed >= 16 && f.speed <= 1600))
        return "badSpeed";
    if (!(f.height >= 1 && f.height <= 4096))
        return "badHeight";
    if ((f.flags & 0xfff8) !== 0)
        return "badFlags";
    if (f.soundName.length > 15 || f.textureName.length > 15)
        return "badName";
    if (nAccepted >= FALL_MAX_BUILT)
        return "over";
    return null;
}
/** The world wraps at 8192 ft: b - a brought into [-4096, 4096) (12.1.4). */
function wrapDiff(a, b) {
    let d = b - a + 4096;
    d -= Math.floor(d / 8192) * 8192;
    return d - 4096;
}
function crestOf(fall) {
    const n = fall.points.length;
    const px = [fall.points[0].x * 0.0625], pz = [fall.points[0].z * 0.0625];
    for (let k = 1; k < n; k++) {
        px.push(px[k - 1] + wrapDiff(fall.points[k - 1].x * 0.0625, fall.points[k].x * 0.0625));
        pz.push(pz[k - 1] + wrapDiff(fall.points[k - 1].z * 0.0625, fall.points[k].z * 0.0625));
    }
    const cum = [0], ux = [], uz = [], seg = [], sfx = [], sfz = [];
    for (let j = 0; j < n - 1; j++) {
        const dx = px[j + 1] - px[j], dz = pz[j + 1] - pz[j];
        const l = Math.hypot(dx, dz);
        seg.push(l);
        cum.push(cum[j] + l);
        if (l < 1e-12) {
            ux.push(0);
            uz.push(0);
            sfx.push(1);
            sfz.push(0);
        }
        else {
            ux.push(dx / l);
            uz.push(dz / l);
            sfx.push(dz / l);
            sfz.push(-dx / l);
        }
    }
    const pfx = [], pfz = [];
    for (let k = 0; k < n; k++) {
        if (k === 0) {
            pfx.push(sfx[0]);
            pfz.push(sfz[0]);
            continue;
        }
        if (k === n - 1) {
            pfx.push(sfx[n - 2]);
            pfz.push(sfz[n - 2]);
            continue;
        }
        const sx = sfx[k - 1] + sfx[k], sz = sfz[k - 1] + sfz[k];
        const l = Math.hypot(sx, sz);
        if (l < 1e-12) {
            pfx.push(sfx[k]);
            pfz.push(sfz[k]);
        }
        else {
            pfx.push(sx / l);
            pfz.push(sz / l);
        }
    }
    return { px, pz, cum, len: cum[n - 1], ux, uz, seg, sfx, sfz, pfx, pfz };
}
/**
 * The loader's per-fall validation (12.1.4), in its order; null when the fall may be built. Springs (source 0) skip
 * SOURCE, HEIGHT and DIRECTION. `lakes` are the loaded WTR bodies (a refused lake has no entry), `tileMap` the TMAP.
 */
export function validateFall(fall, ctx = {}) {
    const c = crestOf(fall);
    const n = fall.points.length;
    for (let j = 0; j < n - 1; j++)
        if (c.seg[j] < 2)
            return "FALL_POINTS";
    for (let j = 0; j + 1 < n - 1; j++)
        if (c.ux[j] * c.ux[j + 1] + c.uz[j] * c.uz[j + 1] < 0)
            return "FALL_TURN";
    if (c.len > 1024)
        return "FALL_WIDTH";
    if (fall.source === 0)
        return null;
    const lake = fall.source >= 1 && fall.source <= 255 ? ctx.lakes?.find((k) => k.id === fall.source) : undefined;
    if (!lake)
        return "FALL_SOURCE";
    if (lake.height !== fall.height)
        return "FALL_HEIGHT";
    const map = ctx.tileMap ?? null;
    for (let k = 0; k < n; k++) {
        const segs = k === 0 ? [0] : k === n - 1 ? [n - 2] : [k - 1, k];
        let pass = false;
        for (const j of segs) {
            const nudge = Math.min(0.5 * c.seg[j], 0.5) * (j === k ? 1 : -1);
            const bx = c.px[k] + nudge * c.ux[j], bz = c.pz[k] + nudge * c.uz[j];
            const tx = Math.floor((bx - c.sfx[j]) / 32) & 255, tz = Math.floor((bz - c.sfz[j]) / 32) & 255;
            if ((map ? map[tz * 256 + tx] : 0) === fall.source) {
                pass = true;
                break;
            }
        }
        if (!pass)
            return "FALL_DIRECTION";
    }
    return null;
}
function columnsOf(c, sp) {
    let n = Math.ceil(c.len / sp - 1e-9);
    let count;
    if (n < 1) {
        n = 1;
        count = 2;
    }
    else {
        count = n + 1;
        if (count > FALL_MAX_COLUMNS)
            return [];
    }
    const np = c.px.length;
    const out = [];
    for (let i = 0; i < count; i++) {
        const s = i < n ? i * sp : c.len;
        let k = 0;
        while (k < np - 2 && !(s <= c.cum[k + 1]))
            k++;
        const l = c.cum[k + 1] - c.cum[k];
        let t = l <= 1e-12 ? 0 : (s - c.cum[k]) / l;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const x = c.px[k] + (c.px[k + 1] - c.px[k]) * t, z = c.pz[k] + (c.pz[k + 1] - c.pz[k]) * t;
        let fx = c.pfx[k] + (c.pfx[k + 1] - c.pfx[k]) * t, fz = c.pfz[k] + (c.pfz[k + 1] - c.pfz[k]) * t;
        const fl = Math.hypot(fx, fz);
        if (fl < 1e-12) {
            fx = c.pfx[k];
            fz = c.pfz[k];
        }
        else {
            fx /= fl;
            fz /= fl;
        }
        out.push({ s, x, z, fx, fz });
    }
    return out;
}
/** The drape normal's x, y, z from the ground 0.5 ft either side (12.2.3). */
function drapeNormal(ground, x, z, out) {
    const a = -(ground(x + 0.5, z) - ground(x - 0.5, z));
    const b = -(ground(x, z + 0.5) - ground(x, z - 0.5));
    const l = Math.hypot(a, 1, b);
    out[0] = a / l;
    out[1] = 1 / l;
    out[2] = b / l;
    return out;
}
function walkColumn(col, crestY, speed, sp, ground, water, source) {
    const W = FALL_WALK;
    const r = { x: [col.x], y: [crestY], z: [col.z], t: [0], spd: [speed], air: [1], path: [0], end: 0 };
    let x = col.x, y = crestY, z = col.z;
    let vx = speed * col.fx, vy = 0, vz = speed * col.fz;
    let px = x, py = y, pz = z, acc = 0;
    const n = [0, 1, 0];
    for (let step = 1; step <= W.steps; step++) {
        x += vx * W.dt;
        y += vy * W.dt;
        z += vz * W.dt;
        vy += W.gravityPerStep;
        const g = ground(x, z);
        let draped = false, ny = 0, air;
        if (y < g + W.drapeFt) {
            y = g + W.drapeFt;
            drapeNormal(ground, x, z, n);
            const vn = vx * n[0] + vy * n[1] + vz * n[2];
            if (vn < 0) {
                vx -= vn * n[0];
                vy -= vn * n[1];
                vz -= vn * n[2];
            }
            vx *= W.drag;
            vy *= W.drag;
            vz *= W.drag;
            air = 0;
            ny = n[1];
            draped = true;
        }
        else {
            air = y - (g + W.drapeFt) > W.airGapFt ? 1 : 0;
        }
        let end = 0;
        const S = water(x, z, source);
        const v = Math.hypot(vx, vy, vz);
        if (S !== null && S > g && S >= y) {
            y = S;
            end = FALL_END_WATER;
        }
        else if (draped && ny > W.restCos && v < W.restSpeedFtPerSec)
            end = FALL_END_REST;
        else if (step === W.steps)
            end = FALL_END_LIMIT;
        const d = Math.hypot(x - px, y - py, z - pz);
        px = x;
        py = y;
        pz = z;
        if (end === 0) {
            acc += d;
            if (acc < sp)
                continue;
        }
        const last = r.x.length - 1;
        r.path.push(r.path[last] + Math.hypot(x - r.x[last], y - r.y[last], z - r.z[last]));
        r.x.push(x);
        r.y.push(y);
        r.z.push(z);
        r.t.push(step / 60);
        r.spd.push(v);
        r.air.push(air);
        acc = 0;
        if (end !== 0) {
            r.end = end;
            return r;
        }
    }
    return r;
}
/** The trailing-flat trim (12.2.5): how many emitted rows a column keeps. */
function trimmedRows(r, ground) {
    const n = r.x.length;
    if (r.end === FALL_END_WATER || n < 2)
        return n;
    const nv = [0, 1, 0];
    const flat = (i) => r.air[i] === 0 && drapeNormal(ground, r.x[i], r.z[i], nv)[1] > FALL_WALK.flatCos;
    let k = n;
    while (k > 0 && flat(k - 1))
        k--;
    if (k === n)
        return n;
    let s = Math.max(k - 1, 0);
    while (s < n && r.y[s] - r.y[n - 1] >= FALL_WALK.trimRiseFt)
        s++;
    if (s >= n - 1 || r.path[n - 1] - r.path[s] <= FALL_WALK.trimPathFt)
        return n;
    let i = s + 1;
    while (r.path[i] - r.path[s] <= FALL_WALK.trimPathFt)
        i++;
    return i + 1;
}
function countPass(c, sp, crestY, speed, ground, water, source) {
    const cols = columnsOf(c, sp);
    if (cols.length === 0)
        return null;
    const rows = [], kept = [], counted = [];
    let maxRows = 0;
    for (const col of cols) {
        const r = walkColumn(col, crestY, speed, sp, ground, water, source);
        const k = trimmedRows(r, ground);
        rows.push(r);
        kept.push(k);
        const m = k + (r.end === FALL_END_WATER ? 1 : 0);
        counted.push(m);
        if (m > maxRows)
            maxRows = m;
    }
    return { cols, rows, kept, counted, maxRows };
}
/** Totals(R) of 12.2.6: vertices and triangles with every column cut at R rows. */
function totals(p, R) {
    let verts = 0, tris = 0, run = 0;
    const n = p.counted.length;
    for (let i = 0; i < n; i++) {
        const m = Math.min(p.counted[i], R);
        verts += m;
        if (i > 0)
            tris += Math.min(p.counted[i - 1], R) + m - 2;
        const foam = p.rows[i].end === FALL_END_WATER && p.counted[i] <= R;
        if (foam)
            run++;
        if (!foam || i === n - 1) {
            if (run >= 2) {
                verts += 3 * run;
                tris += 4 * (run - 1);
            }
            if (!foam)
                run = 0;
        }
    }
    return { verts, tris };
}
/**
 * Re-walk every column of a fall at one spacing (as waterfallDebug does, 12.1.6): the rows of the count pass before
 * the row cut, with the trim's verdict. Null when the spacing has no columns.
 */
export function fallDebugColumns(fall, spacing, opts) {
    const p = countPass(crestOf(fall), spacing, fall.height * 0.5, fall.speed * 0.0625, opts.ground, opts.water, fall.source);
    if (!p)
        return null;
    return p.cols.map((c, i) => {
        const r = p.rows[i];
        return {
            s: c.s, x: c.x, z: c.z, fx: c.fx, fz: c.fz, end: r.end, keptRows: p.kept[i],
            rows: r.x.map((x, k) => ({ x, y: r.y[k], z: r.z[k], t: r.t[k], speed: r.spd[k], air: r.air[k], path: r.path[k] })),
        };
    });
}
/**
 * The loader's build (12.1.5, 12.2): the record checks, the validation, then each accepted fall in order into one
 * track vertex and index buffer, at the first spacing that fits its budget, or shortened at the coarsest.
 */
export function buildFallMeshes(falls, opts) {
    const check = checkFallRecords(falls);
    const refused = [];
    const dropped = [];
    const built = [];
    const vb = new Float32Array(FALL_MAX_TRACK_VERTICES * FALL_VERTEX_FLOATS);
    const ib = new Uint32Array(FALL_MAX_TRACK_INDICES);
    let usedV = 0, usedI = 0;
    for (const { index, fall } of check.accepted) {
        if (built.length >= FALL_MAX_BUILT)
            break;
        const reason = validateFall(fall, opts);
        if (reason) {
            refused.push({ index, id: fall.id, reason });
            continue;
        }
        const budget = Math.min(FALL_MAX_FALL_VERTICES, FALL_MAX_TRACK_VERTICES - usedV);
        const room = FALL_MAX_TRACK_INDICES - usedI;
        const b = budget < 1 ? null : buildOne(fall, index, built.length, opts, budget, room, vb, usedV, ib, usedI);
        if (!b) {
            dropped.push({ index, id: fall.id, left: budget });
            continue;
        }
        built.push(b);
        usedV += b.vertexCount;
        usedI += b.indexCount;
    }
    const counted = Object.values(check.counters).some((v) => v !== 0);
    return {
        vertices: vb.slice(0, usedV * FALL_VERTEX_FLOATS), indices: ib.slice(0, usedI), falls: built,
        rejected: check.rejected, counters: check.counters, refused, dropped,
        skipped: counted || refused.length > 0, tooBig: dropped.length > 0,
    };
}
function buildOne(fall, index, slot, opts, budget, room, vb, base, ib, ibase) {
    const { ground, water } = opts;
    const crest = crestOf(fall);
    if (crest.len < 1e-6)
        return null;
    const crestY = fall.height * 0.5, speed = fall.speed * 0.0625;
    const fits = (p, R) => { const t = totals(p, R); return t.verts <= budget && 3 * t.tris <= room; };
    // The first spacing (with columns) that fits uncut; else the last spacing with columns, shortened.
    let pass = null, spacing = 0, R = 0x7fffffff, shortened = false, fitted = false;
    for (const sp of FALL_SPACINGS_FT) {
        const p = countPass(crest, sp, crestY, speed, ground, water, fall.source);
        if (!p)
            continue;
        pass = p;
        spacing = sp;
        if (fits(p, R)) {
            fitted = true;
            break;
        }
    }
    if (!pass)
        return null;
    if (!fitted) {
        if (!fits(pass, 2))
            return null;
        let lo = 2, hi = pass.maxRows;
        while (lo < hi) {
            const mid = lo + Math.floor((hi - lo + 1) / 2);
            if (fits(pass, mid))
                lo = mid;
            else
                hi = mid - 1;
        }
        R = lo;
        shortened = true;
    }
    const F = FALL_VERTEX_FLOATS, U = FALL_VERTEX_UNITS_PER_FT;
    const x0 = crest.px[0], z0 = crest.pz[0];
    const ncols = pass.cols.length;
    const colStart = [], colCount = [], colSink = [];
    let w = base;
    const put = (at, x, y, z, u, tau, spd, air, edge, end, kind, drop, path) => {
        const o = at * F;
        vb[o] = (x - x0) * U;
        vb[o + 1] = (y - crestY) * U;
        vb[o + 2] = (z - z0) * U;
        vb[o + 3] = u;
        vb[o + 4] = tau;
        vb[o + 5] = spd;
        vb[o + 6] = air;
        vb[o + 7] = edge;
        vb[o + 8] = end;
        vb[o + 9] = kind;
        vb[o + 10] = slot;
        vb[o + 11] = drop;
        vb[o + 12] = 0;
        vb[o + 13] = 1;
        vb[o + 14] = 0;
        vb[o + 15] = path;
    };
    for (let c = 0; c < ncols; c++) {
        const col = pass.cols[c], r = pass.rows[c];
        const edge = Math.min(Math.min(c, ncols - 1 - c) / 3, 1);
        const cap = r.end === FALL_END_WATER ? Infinity : pass.kept[c];
        const start = w;
        let sm = speed, sink = false;
        const n = r.x.length;
        for (let i = 0; i < n && i < R && i < cap; i++) {
            if (i > 0)
                sm = Math.max(r.spd[i], sm * Math.exp(-(r.path[i] - r.path[i - 1]) / FALL_WALK.speedDecayFt));
            put(w++, r.x[i], r.y[i], r.z[i], col.s, r.t[i], i === 0 ? speed : sm, r.air[i], edge, r.path[i], 0, crestY - r.y[i], r.path[i]);
            if (i === n - 1 && r.end === FALL_END_WATER && i > 0 && i + 1 < R) {
                const dx = r.x[i] - r.x[i - 1], dy = r.y[i] - r.y[i - 1], dz = r.z[i] - r.z[i - 1];
                const dl = Math.hypot(dx, dy, dz);
                let ox = 0, oz = 0;
                const S = FALL_WALK.sinkFt;
                if (dl > 1e-9 && -dy / dl >= 0.5) {
                    ox = (S / -dy) * dx;
                    oz = (S / -dy) * dz;
                }
                const step = Math.hypot(ox, S, oz);
                put(w++, r.x[i] + ox, r.y[i] - S, r.z[i] + oz, col.s, r.t[i] + S / Math.max(r.spd[i], 0.5), Math.exp(-step / FALL_WALK.speedDecayFt) * sm, r.air[i], edge, 0, 0, crestY - (r.y[i] - S), r.path[i] + step);
                sink = true;
            }
        }
        // The end field: 1 on a water column with its sink (0 on the sink), else the fade over the last 6 ft of path.
        const rowsWritten = w - start - (sink ? 1 : 0);
        const pLast = r.path[rowsWritten - 1];
        for (let k = 0; k < rowsWritten; k++) {
            const o = (start + k) * F;
            if (sink)
                vb[o + 8] = 1;
            else {
                const e = (pLast - r.path[k]) / FALL_WALK.endFadeFt;
                vb[o + 8] = e < 0 ? 0 : e > 1 ? 1 : e;
            }
        }
        colStart.push(start);
        colCount.push(w - start);
        colSink.push(sink);
    }
    const sheetEnd = w;
    // Normals (12.2.8), on the stored positions.
    const pos = (c, r, k) => vb[(colStart[c] + r) * F + k];
    for (let c = 0; c < ncols; c++) {
        const col = pass.cols[c], m = colCount[c];
        for (let r = 0; r < m; r++) {
            const ra = Math.min(r + 1, m - 1), rb = Math.max(r - 1, 0);
            let Dx = pos(c, ra, 0) - pos(c, rb, 0), Dy = pos(c, ra, 1) - pos(c, rb, 1), Dz = pos(c, ra, 2) - pos(c, rb, 2);
            if (Dx * Dx + Dy * Dy + Dz * Dz < 1e-6) {
                Dx = col.fx;
                Dy = 0;
                Dz = col.fz;
            }
            const cn = c + 1 < ncols && colCount[c + 1] > r ? c + 1 : c;
            const cp = c - 1 >= 0 && colCount[c - 1] > r ? c - 1 : c;
            let Ax = pos(cn, r, 0) - pos(cp, r, 0), Ay = pos(cn, r, 1) - pos(cp, r, 1), Az = pos(cn, r, 2) - pos(cp, r, 2);
            if (Ax * Ax + Ay * Ay + Az * Az < 1e-6) {
                Ax = -col.fz;
                Ay = 0;
                Az = col.fx;
            }
            let nx = Dy * Az - Dz * Ay, ny = Dz * Ax - Dx * Az, nz = Dx * Ay - Dy * Ax;
            const l = Math.hypot(nx, ny, nz);
            if (l < 1e-12) {
                nx = 0;
                ny = 1;
                nz = 0;
            }
            else {
                nx /= l;
                ny /= l;
                nz /= l;
            }
            if (nx * col.fx + ny + nz * col.fz < 0) {
                nx = -nx;
                ny = -ny;
                nz = -nz;
            }
            const o = (colStart[c] + r) * F;
            vb[o + 12] = nx;
            vb[o + 13] = ny;
            vb[o + 14] = nz;
        }
    }
    for (let c = 0; c < ncols; c++) {
        if (!colSink[c])
            continue;
        const o = (colStart[c] + colCount[c] - 1) * F;
        vb[o + 12] = vb[o - F + 12];
        vb[o + 13] = vb[o - F + 13];
        vb[o + 14] = vb[o - F + 14];
    }
    // Foam strip (12.2.10): runs of at least 2 kept water columns.
    const keptWater = (c) => pass.rows[c].end === FALL_END_WATER && pass.counted[c] <= R;
    const runs = [];
    for (let c = 0; c < ncols;) {
        if (!keptWater(c)) {
            c++;
            continue;
        }
        const run = [];
        while (c < ncols && keptWater(c))
            run.push(c++);
        if (run.length >= 2)
            runs.push(run);
    }
    const foamStart = w;
    for (const run of runs) {
        for (const c of run) {
            const col = pass.cols[c], r = pass.rows[c];
            const L = r.x.length - 1, Lp = L - 1;
            let fx = col.fx, fz = col.fz;
            if (L >= 1) {
                const hx = r.x[L] - r.x[Lp], hz = r.z[L] - r.z[Lp], hl = Math.hypot(hx, hz);
                if (hl >= 1e-6) {
                    fx = hx / hl;
                    fz = hz / hl;
                }
            }
            const drop = crestY - r.y[L];
            const wd = Math.min(Math.max(1.5 * drop, 4), 40);
            const ax = fz * wd / 2, az = -fx * wd / 2;
            const edge = Math.min(Math.min(c, ncols - 1 - c) / 3, 1);
            const y = r.y[L] + 0.1;
            put(w++, r.x[L] + ax, y, r.z[L] + az, col.s, r.t[L], r.spd[L], 0, edge, 0, 1, drop, 0);
            put(w++, r.x[L], y, r.z[L], col.s, r.t[L], r.spd[L], 0, edge, 1, 1, drop, 0);
            put(w++, r.x[L] - ax, y, r.z[L] - az, col.s, r.t[L], r.spd[L], 0, edge, 0, 1, drop, 0);
        }
    }
    // Indices (12.2.9, 12.2.10), global.
    let q = ibase;
    const tri = (a, b2, c2) => { ib[q++] = a; ib[q++] = b2; ib[q++] = c2; };
    for (let a = 0; a + 1 < ncols; a++) {
        const A = colStart[a], B = colStart[a + 1], ma = colCount[a], mb = colCount[a + 1];
        const m = Math.min(ma, mb);
        for (let i = 0; i <= m - 2; i++) {
            tri(A + i, B + i, B + i + 1);
            tri(A + i, B + i + 1, A + i + 1);
        }
        if (ma < mb)
            for (let i = m - 1; i <= mb - 2; i++)
                tri(A + m - 1, B + i, B + i + 1);
        if (mb < ma)
            for (let i = m - 1; i <= ma - 2; i++)
                tri(A + i, B + m - 1, A + i + 1);
    }
    let fb = foamStart;
    for (const run of runs) {
        for (let i = 0; i + 1 < run.length; i++) {
            const a = fb + 3 * i, b2 = a + 3;
            tri(a, b2, b2 + 1);
            tri(a, b2 + 1, a + 1);
            tri(a + 1, b2 + 1, b2 + 2);
            tri(a + 1, b2 + 2, a + 2);
        }
        fb += 3 * run.length;
    }
    // Bounds, foam included.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let v = base; v < w; v++)
        for (let k = 0; k < 3; k++) {
            const p = vb[v * F + k];
            if (p < min[k])
                min[k] = p;
            if (p > max[k])
                max[k] = p;
        }
    // Landing statistics (12.2.11).
    const ends = { water: 0, rest: 0, limit: 0 };
    for (const r of pass.rows) {
        if (r.end === FALL_END_WATER)
            ends.water++;
        else if (r.end === FALL_END_REST)
            ends.rest++;
        else if (r.end === FALL_END_LIMIT)
            ends.limit++;
    }
    let sdx = 0, sdz = 0;
    for (let k = 0; k < crest.pfx.length; k++) {
        sdx += crest.pfx[k];
        sdz += crest.pfz[k];
    }
    const fallback = () => {
        const l = Math.hypot(sdx, sdz);
        return l > 1e-6 ? [sdx / l, sdz / l] : [0, 1];
    };
    const kept = [];
    for (let c = 0; c < ncols; c++)
        if (keptWater(c))
            kept.push(c);
    let landing;
    if (kept.length > 0) {
        let sy = 0, hx = 0, hz = 0;
        for (const c of kept) {
            const r = pass.rows[c], L = r.x.length - 1;
            sy += r.y[L];
            const dx = r.x[L] - r.x[L - 1], dz = r.z[L] - r.z[L - 1], l = Math.hypot(dx, dz);
            if (l > 1e-6) {
                hx += dx / l;
                hz += dz / l;
            }
        }
        const hl = Math.hypot(hx, hz);
        const [fx, fz] = hl > 1e-6 ? [hx / hl, hz / hl] : fallback();
        let amin = Infinity, amax = -Infinity, sb = 0;
        for (const c of kept) {
            const r = pass.rows[c], L = r.x.length - 1;
            const a = r.z[L] * fx - r.x[L] * fz, b2 = r.x[L] * fx + r.z[L] * fz;
            if (a < amin)
                amin = a;
            if (a > amax)
                amax = a;
            sb += b2;
        }
        const mb = sb / kept.length, ma = (amin + amax) / 2, landY = sy / kept.length;
        landing = { x: mb * fx - ma * fz, y: landY, z: mb * fz + ma * fx, width: amax - amin + spacing, drop: crestY - landY, dirX: fx, dirZ: fz };
    }
    else {
        // No column here has a sink (a sink means kept water), so the last written vertex is row colCount - 1.
        let lowC = 0, lowY = Infinity;
        for (let c = 0; c < ncols; c++) {
            const y = pass.rows[c].y[colCount[c] - 1];
            if (y < lowY) {
                lowY = y;
                lowC = c;
            }
        }
        const r = pass.rows[lowC], L = colCount[lowC] - 1;
        const [fx, fz] = fallback();
        landing = { x: r.x[L], y: lowY, z: r.z[L], width: 0, drop: crestY - lowY, dirX: fx, dirZ: fz };
    }
    let rowsMin = Infinity, rowsMax = 0;
    for (const m of colCount) {
        if (m < rowsMin)
            rowsMin = m;
        if (m > rowsMax)
            rowsMax = m;
    }
    const p0 = fall.points[0];
    return {
        slot, index, id: fall.id, source: fall.source, flags: fall.flags,
        anchorFt: [x0, crestY, z0], anchor: [p0.x * 16, fall.height * 128, p0.z * 16],
        firstVertex: base, vertexCount: w - base, sheetVertexCount: sheetEnd - base, foamVertexCount: w - foamStart,
        firstIndex: ibase, indexCount: q - ibase,
        spacing, shortened, rowLimit: shortened ? R : null, columns: ncols, rowsMin, rowsMax, ends,
        bounds: { min, max }, landing,
        crestLengthFt: crest.len, crestSpeedFtPerSec: speed, crestYFt: crestY,
        opacity: fall.opacity, mist: fall.mist, volume: fall.volume, mistDepth: fall.mistDepth, mistHeight: fall.mistHeight,
        soundName: fall.soundName, textureName: fall.textureName,
        rngSeed: (Math.imul(fall.id, 0x3c6ef362) + 0x9e3779b1) >>> 0,
    };
}
// ---- Mist (12.4) ----
/** Fog volume slots, shared by the .SIT fog volumes (type 14) and the falls' mist. */
export const FOG_VOLUME_SLOTS = 64;
/** All nine weathers, and without Snow (bit 5) for a FREEZE fall. */
export const FALL_MIST_WEATHER_ALL = 0x1ff;
export const FALL_MIST_WEATHER_NO_SNOW = 0x1df;
/** A mist volume may be added while the SIT volumes plus the mist volumes so far are below 64. */
export function fallMistSlotFree(sitFogVolumes, mistVolumes) {
    return sitFogVolumes + mistVolumes < FOG_VOLUME_SLOTS;
}
/** A built fall's mist fog volume (12.4), or null when it has none. `waterfallMistPct` is `[Graphics] waterfallMist`. */
export function fallMist(fall, record = fall, opts = {}) {
    const pct = Math.max(0, opts.waterfallMistPct ?? 100);
    if (!(record.mist > 0) || fall.ends.water <= 0)
        return null;
    const drop = fall.landing.drop;
    const k = fall.crestSpeedFtPerSec * fall.crestLengthFt * drop / 7200;
    const density = (record.mist / 100) * Math.min(Math.max(k, 0.25), 2) * (pct / 100);
    if (!(density > 0))
        return null;
    const lengthFt = Math.max(0.6 * drop, 20) * record.mistDepth / 100;
    const widthFt = Math.max(fall.landing.width + 0.6 * drop, 20);
    const heightFt = Math.min(Math.min(0.7 * drop, 120) * record.mistHeight / 100, 240);
    const { dirX, dirZ } = fall.landing;
    const has = Math.hypot(dirX, dirZ) > 1e-6;
    const wrap = (v) => { const r = v % 8192; return r < 0 ? r + 8192 : r; };
    const cx = wrap(fall.landing.x + (has ? 0.3 * lengthFt * dirX : 0));
    const cz = wrap(fall.landing.z + (has ? 0.3 * lengthFt * dirZ : 0));
    const vis = Math.min(Math.max(120 / density, 20), 1000);
    const wmask = record.flags & FALL_FLAG_FREEZE ? FALL_MIST_WEATHER_NO_SNOW : FALL_MIST_WEATHER_ALL;
    return {
        density, widthFt, lengthFt, heightFt, centre: [cx, cz], floorFt: fall.landing.y - 2,
        axisW: has ? [-dirZ, dirX] : [1, 0], axisL: has ? [dirX, dirZ] : [0, 1],
        fog: {
            w: widthFt, l: lengthFt, h: heightFt, base: 0, vis, color: [0.75, 0.78, 0.82], half: heightFt * 0.5,
            edge: 20, top: 5, bot: 0, maxOp: 1, wmask, round: 1, wisp: 0.6, wsize: 25, wspd: 2,
        },
    };
}
/** Every built fall's mist in build order, with the 64 shared slots: `noSlot` lists falls that found none. */
export function fallMists(falls, opts = {}) {
    const sit = opts.sitFogVolumes ?? 0;
    const mists = [], noSlot = [];
    for (const f of falls) {
        const m = fallMist(f, f, opts);
        if (!m)
            continue;
        if (!fallMistSlotFree(sit, mists.length)) {
            noSlot.push(f.slot);
            continue;
        }
        mists.push({ slot: f.slot, mist: m });
    }
    return { mists, noSlot };
}
// ---- Sound (12.7) ----
/** The track's looping-sound table, shared with the SIT continuous sounds; the room left is the caller's. */
export const FALL_SOUND_LOOP_ROOM = 30;
/** The engine's default sound range (the falloff's R). */
export const FALL_SOUND_RANGE = 1000;
/**
 * A built fall's looping sound (12.7): the landing point, wrapped, its volume and hearing. Silent without the SOUND
 * flag (no log line), with an empty stem (there is no default roar) and, with `snow`, on a FREEZE fall.
 */
export function fallSound(fall, record = fall, opts = {}) {
    if (!(record.flags & FALL_FLAG_SOUND))
        return { silent: "no-sound-flag" };
    if (record.soundName === "")
        return { silent: "no-stem" };
    if (opts.snow && record.flags & FALL_FLAG_FREEZE)
        return { silent: "frozen" };
    const sl = fall.crestSpeedFtPerSec * fall.crestLengthFt;
    const wrap = (v) => { const r = v % 8192; return r < 0 ? r + 8192 : r; };
    return {
        silent: null, stem: record.soundName, file: `sound\\${record.soundName}.WAV`,
        position: [wrap(fall.landing.x), fall.landing.y, wrap(fall.landing.z)],
        volume: (record.volume / 100) * Math.min(Math.max(sl / 240, 0.3), 1),
        hearing: 1 + Math.min(Math.max((sl - 240) / 960, 0), 1),
    };
}
/** The continuous-sound falloff at distance d: volume * (1 - sqrt(d) / (sqrt(R) * hearing)), 0 from R on. */
export function fallSoundGain(volume, hearing, d, range = FALL_SOUND_RANGE) {
    if (d >= range)
        return 0;
    return volume * (1 - Math.sqrt(Math.sqrt(d * d)) / (Math.sqrt(range) * hearing));
}
// ---- Looks and texture (12.8) ----
/** The four looks (12.0.1, 12.8.3). */
export const FALL_LOOK_ORIGINAL = 0;
export const FALL_LOOK_ENHANCED = 1;
export const FALL_LOOK_REALISTIC = 2;
export const FALL_LOOK_ICE = 3;
/** gpuWaterfallsAvailable bits: 1 draws at all, 4 has the ice look. */
export const FALL_GPU_DRAW = 1;
export const FALL_GPU_ICE = 4;
/**
 * The look of a fall (12.8.3): ice when Snow, FREEZE and the DLL has the ice bit; else the water mode, waterRealism
 * before enhancedWater. Null when the DLL cannot draw falls (bit 0).
 */
export function fallLook(o) {
    if (!(o.gpu & FALL_GPU_DRAW))
        return null;
    if (o.weather === FALL_WEATHER_SNOW && o.flags & FALL_FLAG_FREEZE && o.gpu & FALL_GPU_ICE)
        return FALL_LOOK_ICE;
    return o.waterRealism ? FALL_LOOK_REALISTIC : o.enhancedWater ? FALL_LOOK_ENHANCED : FALL_LOOK_ORIGINAL;
}
/** The default texture (12.8.1): the retail ripple, RIPPL100 .. RIPPL800 .. RIPPL200, 14 frames ping-pong. */
export const FALL_RIPPLE_FRAMES = [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2].map((n) => `RIPPL${n}00.RAW`);
/** A ripple frame lasts 16384 ticks (0.25 s); it does not advance in Snow or in the mirror passes. */
export const FALL_RIPPLE_FRAME_TICKS = 16384;
export const FALL_RIPPLE_FRAME_SEC = 0.25;
/** The ripple frame name after `seconds` of advancing clock. */
export function fallRippleFrame(seconds) {
    const n = FALL_RIPPLE_FRAMES.length;
    const i = Math.floor(seconds / FALL_RIPPLE_FRAME_SEC) % n;
    return FALL_RIPPLE_FRAMES[i < 0 ? i + n : i];
}
/** A custom texture stem without a '.' gets ".RAW" (12.8.2). */
export function fallTextureName(stem) {
    return stem.includes(".") ? stem : `${stem}.RAW`;
}
/** The `[Graphics]` keys the falls read, with their defaults (12.0.1, 12.1.1, 12.4, 12.5). */
export const FALL_GRAPHICS_DEFAULTS = {
    waterfalls: 1, waterBodyLog: 0, waterfallDebug: 0, waterfallMist: 100, waterfallDroplets: 100,
    wfRingDecay: 15, wfRingStrength: 100, wfChurn: 100, wfEdge: 100, wfLift: 40, wfDepthPull: 4, wfFoam: 100,
};
