/*
  WORLD\<stem>.CPX, the MTM2 race-rules sidecar ("MCPX" v1.0): the checkpoint map of a new-style
  drag, a Parallel race or a race with split checkpoints, and for drag and Parallel the walls and
  the lead-in courses. Traxx 1.8.2 writes it (TrackPOD/TrackPODRaceRules.cpp CpxBuildEx) and reads
  it back (CpxParse); this module is the byte codec only. What a file must say to be applied (the
  modes, the laps, the slot and role rules, the wall bends, the lead-in rules) is the tool's.

  Layout, little-endian, every unwritten byte 0 (Traxx builds into a calloc'd buffer):

    0    "MCPX"
    4    u16 major = 1 (a reader refuses a newer major; the minor is ignored)
    6    u16 minor = 0
    8    u32 header size = 32 (the directory starts here)
    12   u32 chunk count
    16   16 bytes flags and reserved, 0
    32   directory, 16 bytes an entry: id[4], u32 version = 1, u32 offset, u32 size.
         Traxx writes RULE, CPBX, then WALL and WPNT when there are walls, then COUR when there
         are lead-ins, the chunks contiguous in that order right after the directory. A reader
         skips unknown ids, and the first entry of an id is that chunk even when it is unusable.

    RULE (32 bytes)
          0  u16 mode (1 new-style drag, 2 Parallel, 3 a race with split checkpoints)
          2  u16 laps (drag: 0 looped, 1 one run; otherwise 0)
          4  u32 time-out ms (0 = the engine's default)
          8  u32 wall penalty ms (Traxx: 5000, 0 in mode 3)
          12 u32 re-arm ms (Traxx: 1000, 0 in mode 3)
          16 16 bytes flags and reserved, 0

    The other chunks start with a record header: u32 count, u16 record size, u16 0. A reader
    takes the record size from the file, so a later, longer record still reads.

    CPBX  up to 800 records (100 slots of 8 copies) of 24 bytes, one per checkpoint box in the
          .SIT's order:
          0  u16 slot (0-based)    2 u8 role (1 pre-stage, 2 stage, 3 launch, 4 finish, 5 gate)
          3  u8 split (0 none, 1 any copy, 2 per lane)    4 u8 lane (1 or 2 for per lane, else 0)
          5  u8 ground line (1 = the engine paints the checkpoint's line)
          6  u16 psi, 1/65536 turn    8 i32 x, 12 i32 y (height), 16 i32 z, 1/256 ft
          20 u32 0
          The position and heading are a fingerprint of the box as the .SIT states it.

    WALL  up to 64 records of 48 bytes:
          0  char[32] name, NUL-padded (Traxx copies 31 bytes, so byte 31 is always 0)
          32 u32 first point (a running index into WPNT)    36 u16 point count
          38 u8 side (0 none, 1 inside, 2 outside)    39 u8 flags (1 closed, 2 no ground line)
          40 i32 thickness, 44 i32 height, 1/256 ft
    WPNT  up to 8192 records of 24 bytes, the walls' points wall after wall (about one per 8 ft):
          0 i32 x, 4 i32 z, 8 i32 base y (the ground plus `above`), 12 i32 bend, 16 i32 above,
          all 1/256 ft; 20 u8 gap (bit 0: the stretch after this point is open), 21..23 0
          A WPNT with no WALL entry carries no walls.
    COUR  up to 5 records of 8 bytes:
          0 u8 course, 1 u8 flags (bit 0 first pass only), 2 u8 then course, 3..7 0
*/
export const CPX_MAGIC = "MCPX";
export const CPX_HEADER = 32;
export const CPX_DIRENTRY = 16;
export const CPX_RULE_SIZE = 32;
/** The record header every chunk but RULE starts with: count, record size, 0. */
export const CPX_CHUNKHEAD = 8;
export const CPX_BOX_STRIDE = 24;
export const CPX_WALL_STRIDE = 48;
export const CPX_POINT_STRIDE = 24;
export const CPX_COURSE_STRIDE = 8;
/** 100 slots of 8 copies. */
export const CPX_MAX_BOXES = 800;
export const CPX_MAX_WALLS = 64;
export const CPX_MAX_POINTS = 8192;
export const CPX_MAX_COURSES = 5;
export const CPX_WALL_NAME_LEN = 32;
/** Positions, wall lengths and heights are in 1/256 ft. */
export const CPX_UNITS_PER_FT = 256;
/** psi is in 1/65536 of a turn. */
export const CPX_PSI_UNITS = 65536;
export const CPX_MODE_DRAG = 1;
export const CPX_MODE_PARALLEL = 2;
export const CPX_MODE_RACE = 3;
export const CPX_ROLE_PRESTAGE = 1;
export const CPX_ROLE_STAGE = 2;
export const CPX_ROLE_LAUNCH = 3;
export const CPX_ROLE_FINISH = 4;
export const CPX_ROLE_GATE = 5;
export const CPX_SPLIT_NONE = 0;
export const CPX_SPLIT_ANY = 1;
export const CPX_SPLIT_LANE = 2;
export const CPX_WALL_CLOSED = 1;
export const CPX_WALL_NOLINE = 2;
export const CPX_COURSE_FIRST_PASS = 1;
const r16 = (b, o) => b[o] | (b[o + 1] << 8);
const r32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32 = (b, o) => r32(b, o) | 0;
function idAt(b, o) {
    return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}
export function isCpx(bytes) {
    return bytes.length >= 4 && idAt(bytes, 0) === CPX_MAGIC;
}
/**
 * Read a .CPX. Never throws: what cannot be read is listed in `errors` (stable codes) and its part
 * is null. Unknown chunks are skipped, the first entry of an id wins, record sizes come from the
 * file, and a defect in one chunk does not stop the others being read. Whether the map is valid for
 * its mode is not checked here.
 */
export function readCpx(bytes) {
    const out = {
        major: 0, minor: 0, headerSize: 0, directory: [], rule: null, boxes: null, boxStride: 0,
        walls: null, wallStride: 0, points: null, pointStride: 0, courses: null, courseStride: 0, errors: [],
    };
    const fail = (code, chunk, message, value = null) => {
        out.errors.push({ code, chunk, value, message });
    };
    const len = bytes.length;
    if (len < CPX_HEADER || !isCpx(bytes)) {
        fail("NOT_CPX", null, "CPX: not an MCPX file");
        return out;
    }
    out.major = r16(bytes, 4);
    out.minor = r16(bytes, 6);
    if (out.major > 1) {
        fail("NEWER_MAJOR", null, `CPX: major version ${out.major} needs a newer reader`, out.major);
        return out;
    }
    const headerSize = r32(bytes, 8);
    const count = r32(bytes, 12);
    out.headerSize = headerSize;
    if (headerSize < CPX_HEADER || headerSize > len || count > Math.floor((len - headerSize) / CPX_DIRENTRY)) {
        fail("DIRECTORY_CUT", null, "CPX: the chunk directory does not fit the file");
        return out;
    }
    const first = new Map();
    for (let i = 0; i < count; i++) {
        const e = headerSize + i * CPX_DIRENTRY;
        const entry = { id: idAt(bytes, e), version: r32(bytes, e + 4), offset: r32(bytes, e + 8), size: r32(bytes, e + 12) };
        out.directory.push(entry);
        if (!first.has(entry.id))
            first.set(entry.id, entry);
    }
    // A chunk's place in the file: usable when it is version 1 and lies inside the file, at least `min` bytes long.
    const usable = (id, min) => {
        const e = first.get(id);
        if (!e)
            return null;
        if (e.version !== 1) {
            fail(`${id}_VERSION`, id, `CPX: ${id} chunk version ${e.version} is not readable`, e.version);
            return null;
        }
        if (e.offset > len || e.size > len - e.offset || e.size < min) {
            fail(`${id}_CUT`, id, `CPX: the ${id} chunk runs past the end of the file or is too small`);
            return null;
        }
        return e;
    };
    // A record list: its count and stride, or null with the defect.
    const list = (e, cap, stride, over, cut, what) => {
        const n = r32(bytes, e.offset);
        const s = r16(bytes, e.offset + 4);
        if (n > cap) {
            fail(over, e.id, `CPX: ${n} ${what}, more than the ${cap} the format allows`, n);
            return null;
        }
        if (s < stride || n > Math.floor((e.size - CPX_CHUNKHEAD) / s)) {
            fail(cut, e.id, `CPX: the ${e.id} records do not fit their chunk`);
            return null;
        }
        return { n, s, at: e.offset + CPX_CHUNKHEAD };
    };
    if (!first.has("RULE"))
        fail("NO_RULE", null, "CPX: no RULE chunk");
    if (!first.has("CPBX"))
        fail("NO_CPBX", null, "CPX: no CPBX chunk");
    const rule = usable("RULE", CPX_RULE_SIZE);
    if (rule) {
        const o = rule.offset;
        out.rule = { mode: r16(bytes, o), laps: r16(bytes, o + 2), timeoutMs: r32(bytes, o + 4), penaltyMs: r32(bytes, o + 8), rearmMs: r32(bytes, o + 12) };
    }
    const cpbx = usable("CPBX", CPX_CHUNKHEAD);
    const boxes = cpbx && list(cpbx, CPX_MAX_BOXES, CPX_BOX_STRIDE, "BOXES_OVER_CAP", "BOX_LIST_CUT", "checkpoint boxes");
    if (boxes) {
        out.boxStride = boxes.s;
        out.boxes = [];
        for (let i = 0; i < boxes.n; i++) {
            const r = boxes.at + i * boxes.s;
            out.boxes.push({
                slot: r16(bytes, r), role: bytes[r + 2], split: bytes[r + 3], lane: bytes[r + 4], groundLine: bytes[r + 5],
                psi: r16(bytes, r + 6), x: i32(bytes, r + 8), y: i32(bytes, r + 12), z: i32(bytes, r + 16),
            });
        }
    }
    if (first.has("WALL") && !first.has("WPNT"))
        fail("WALL_WITHOUT_WPNT", "WALL", "CPX: a WALL chunk without a WPNT chunk");
    const wall = usable("WALL", CPX_CHUNKHEAD);
    const wpnt = usable("WPNT", CPX_CHUNKHEAD);
    const walls = wall && list(wall, CPX_MAX_WALLS, CPX_WALL_STRIDE, "WALLS_OVER_CAP", "WALL_LIST_CUT", "walls");
    if (walls) {
        out.wallStride = walls.s;
        out.walls = [];
        for (let i = 0; i < walls.n; i++) {
            const r = walls.at + i * walls.s;
            let name = "";
            // 31 bytes: the 32nd is always the terminator.
            for (let k = 0; k < CPX_WALL_NAME_LEN - 1 && bytes[r + k] !== 0; k++)
                name += String.fromCharCode(bytes[r + k]);
            const flags = bytes[r + 39];
            out.walls.push({
                name, first: r32(bytes, r + 32), count: r16(bytes, r + 36), side: bytes[r + 38], flags,
                thickness: i32(bytes, r + 40), height: i32(bytes, r + 44),
                closed: (flags & CPX_WALL_CLOSED) !== 0, noline: (flags & CPX_WALL_NOLINE) !== 0,
            });
        }
    }
    const points = wpnt && list(wpnt, CPX_MAX_POINTS, CPX_POINT_STRIDE, "POINTS_OVER_CAP", "POINT_LIST_CUT", "wall points");
    if (points) {
        out.pointStride = points.s;
        out.points = [];
        for (let i = 0; i < points.n; i++) {
            const r = points.at + i * points.s;
            out.points.push({
                x: i32(bytes, r), z: i32(bytes, r + 4), baseY: i32(bytes, r + 8), bend: i32(bytes, r + 12), above: i32(bytes, r + 16), gap: bytes[r + 20],
            });
        }
    }
    const cour = usable("COUR", CPX_CHUNKHEAD);
    const courses = cour && list(cour, CPX_MAX_COURSES, CPX_COURSE_STRIDE, "COURSES_OVER_CAP", "COURSE_LIST_CUT", "lead-in courses");
    if (courses) {
        out.courseStride = courses.s;
        out.courses = [];
        for (let i = 0; i < courses.n; i++) {
            const r = courses.at + i * courses.s;
            const flags = bytes[r + 1];
            out.courses.push({ course: bytes[r], flags, thenCourse: bytes[r + 2], firstPassOnly: (flags & CPX_COURSE_FIRST_PASS) !== 0 });
        }
    }
    return out;
}
/**
 * Write a .CPX exactly as Traxx 1.8.2 lays one out: RULE, CPBX, then WALL and WPNT when `walls` is
 * not empty, then COUR when `courses` is not empty, contiguous after the directory, every other
 * byte 0. The records are written as given (the caller sorts, ranks and validates them); this
 * throws a RangeError only for what the file cannot hold.
 */
export function writeCpx(input) {
    const walls = input.walls ?? [];
    const points = walls.length > 0 ? (input.points ?? []) : [];
    const courses = input.courses ?? [];
    const boxes = input.boxes;
    if (boxes.length > CPX_MAX_BOXES)
        throw new RangeError(`CPX: ${boxes.length} checkpoint boxes (at most ${CPX_MAX_BOXES})`);
    if (walls.length > CPX_MAX_WALLS)
        throw new RangeError(`CPX: ${walls.length} walls (at most ${CPX_MAX_WALLS})`);
    if (points.length > CPX_MAX_POINTS)
        throw new RangeError(`CPX: ${points.length} wall points (at most ${CPX_MAX_POINTS})`);
    if (courses.length > CPX_MAX_COURSES)
        throw new RangeError(`CPX: ${courses.length} lead-in courses (at most ${CPX_MAX_COURSES})`);
    const nchunks = (walls.length > 0 ? 4 : 2) + (courses.length > 0 ? 1 : 0);
    const ruleOff = CPX_HEADER + nchunks * CPX_DIRENTRY;
    const cpbxOff = ruleOff + CPX_RULE_SIZE;
    const cpbxSize = CPX_CHUNKHEAD + boxes.length * CPX_BOX_STRIDE;
    let total = cpbxOff + cpbxSize;
    const wallOff = total;
    const wallSize = CPX_CHUNKHEAD + walls.length * CPX_WALL_STRIDE;
    const wpntOff = wallOff + wallSize;
    const wpntSize = CPX_CHUNKHEAD + points.length * CPX_POINT_STRIDE;
    if (walls.length > 0)
        total = wpntOff + wpntSize;
    const courOff = total;
    const courSize = CPX_CHUNKHEAD + courses.length * CPX_COURSE_STRIDE;
    if (courses.length > 0)
        total = courOff + courSize;
    const out = new Uint8Array(total);
    const v = new DataView(out.buffer);
    const u8 = (o, x, what) => {
        if (!Number.isInteger(x) || x < 0 || x > 255)
            throw new RangeError(`CPX: ${what} ${x} is not 0..255`);
        out[o] = x;
    };
    const u16 = (o, x, what) => {
        if (!Number.isInteger(x) || x < 0 || x > 0xffff)
            throw new RangeError(`CPX: ${what} ${x} is not 0..65535`);
        v.setUint16(o, x, true);
    };
    // A 32-bit field: a signed or an unsigned value, stored as its 32 bits.
    const w32 = (o, x, what) => {
        if (!Number.isInteger(x) || x < -0x80000000 || x > 0xffffffff)
            throw new RangeError(`CPX: ${what} ${x} does not fit 32 bits`);
        v.setUint32(o, x >>> 0, true);
    };
    const id = (o, s) => { for (let i = 0; i < 4; i++)
        out[o + i] = s.charCodeAt(i); };
    const dir = (k, s, off, size) => {
        const e = CPX_HEADER + k * CPX_DIRENTRY;
        id(e, s);
        v.setUint32(e + 4, 1, true);
        v.setUint32(e + 8, off, true);
        v.setUint32(e + 12, size, true);
    };
    id(0, CPX_MAGIC);
    v.setUint16(4, 1, true);
    v.setUint16(6, 0, true);
    v.setUint32(8, CPX_HEADER, true);
    v.setUint32(12, nchunks, true);
    dir(0, "RULE", ruleOff, CPX_RULE_SIZE);
    dir(1, "CPBX", cpbxOff, cpbxSize);
    if (walls.length > 0) {
        dir(2, "WALL", wallOff, wallSize);
        dir(3, "WPNT", wpntOff, wpntSize);
    }
    if (courses.length > 0)
        dir(nchunks - 1, "COUR", courOff, courSize);
    const r = input.rule;
    u16(ruleOff, r.mode, "mode");
    u16(ruleOff + 2, r.laps, "laps");
    w32(ruleOff + 4, r.timeoutMs, "time-out");
    w32(ruleOff + 8, r.penaltyMs, "wall penalty");
    w32(ruleOff + 12, r.rearmMs, "re-arm time");
    v.setUint32(cpbxOff, boxes.length, true);
    v.setUint16(cpbxOff + 4, CPX_BOX_STRIDE, true);
    boxes.forEach((b, i) => {
        const o = cpbxOff + CPX_CHUNKHEAD + i * CPX_BOX_STRIDE;
        const what = `checkpoint box ${i + 1}`;
        u16(o, b.slot, `${what} slot`);
        u8(o + 2, b.role, `${what} role`);
        u8(o + 3, b.split, `${what} split`);
        u8(o + 4, b.lane, `${what} lane`);
        u8(o + 5, b.groundLine, `${what} ground line`);
        u16(o + 6, b.psi, `${what} psi`);
        w32(o + 8, b.x, `${what} x`);
        w32(o + 12, b.y, `${what} y`);
        w32(o + 16, b.z, `${what} z`);
    });
    if (walls.length > 0) {
        v.setUint32(wallOff, walls.length, true);
        v.setUint16(wallOff + 4, CPX_WALL_STRIDE, true);
        walls.forEach((w, i) => {
            const o = wallOff + CPX_CHUNKHEAD + i * CPX_WALL_STRIDE;
            const what = `wall ${i + 1}`;
            if (w.name.length > CPX_WALL_NAME_LEN - 1)
                throw new RangeError(`CPX: ${what} name "${w.name}" is longer than 31 characters`);
            for (let k = 0; k < w.name.length; k++) {
                const c = w.name.charCodeAt(k);
                if (c === 0 || c > 255)
                    throw new RangeError(`CPX: ${what} name "${w.name}" has a character the file cannot hold`);
                out[o + k] = c;
            }
            w32(o + 32, w.first, `${what} first point`);
            if (w.first < 0)
                throw new RangeError(`CPX: ${what} first point ${w.first} is negative`);
            u16(o + 36, w.count, `${what} point count`);
            u8(o + 38, w.side, `${what} side`);
            u8(o + 39, w.flags, `${what} flags`);
            w32(o + 40, w.thickness, `${what} thickness`);
            w32(o + 44, w.height, `${what} height`);
        });
        v.setUint32(wpntOff, points.length, true);
        v.setUint16(wpntOff + 4, CPX_POINT_STRIDE, true);
        points.forEach((p, i) => {
            const o = wpntOff + CPX_CHUNKHEAD + i * CPX_POINT_STRIDE;
            const what = `wall point ${i + 1}`;
            w32(o, p.x, `${what} x`);
            w32(o + 4, p.z, `${what} z`);
            w32(o + 8, p.baseY, `${what} base y`);
            w32(o + 12, p.bend, `${what} bend`);
            w32(o + 16, p.above, `${what} above`);
            u8(o + 20, p.gap, `${what} gap`);
        });
    }
    if (courses.length > 0) {
        v.setUint32(courOff, courses.length, true);
        v.setUint16(courOff + 4, CPX_COURSE_STRIDE, true);
        courses.forEach((c, i) => {
            const o = courOff + CPX_CHUNKHEAD + i * CPX_COURSE_STRIDE;
            const what = `lead-in ${i + 1}`;
            u8(o, c.course, `${what} course`);
            u8(o + 1, c.flags, `${what} flags`);
            u8(o + 2, c.thenCourse, `${what} then course`);
        });
    }
    return out;
}
