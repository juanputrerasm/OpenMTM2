/*
  WORLD\<stem>.WFL, Community Patch 4 beta 0.53's waterfalls.

  Each fall is a crest line of 2 to 8 points that water pours over, fed by a lake from the .WTR
  (source = lake index + 1) or by nothing (source 0, a "spring" at its own height). The engine
  walks the water from the crest and builds the sheet itself; the file holds only what the author
  set. Up to 64 falls a track.

  Layout, little-endian (Traxx 1.7.1 TrackPODFalls.cpp BuildWFL / ParseWFL):

    0    "MWFL"
    4    u16 major = 1 (0 and a newer major are refused)
    6    u16 minor = 0, or 1 when the records carry the mist size (v1.1)
    8    u32 header size = 32
    12   u32 chunk count = 1
    16   u16 tiles X = 256, u16 tiles Z = 256 (any other size is refused)
    20   12 bytes zero
    32   directory, 16 bytes an entry: id[4], u32 version = 1, u32 offset, u32 size.
         Unknown ids are skipped. The first FALL entry is the one even when it is unusable (past
         the end, or version not 1), and then the file has no falls.

    FALL u32 count (at most 64), u16 stride (128, or 132 in v1.1), u16 0, then per fall:
          0   u8 id (index + 1; readers ignore it)
          1   u8 source (lake index + 1, 0 a spring)
          2   u8 point count (2..8; any other count rejects the whole file)
          3   u8 0
          4   u16 flags (1 freeze in snow, 2 splash: foam and droplets, 4 sound)
          6   u16 flow speed at the crest, 1/16 ft/s
          8   u32 crest height, 0.5 ft units (for a lake-fed fall its lake's height when written;
              the lake's own height wins)
          12  8 x (u32 x, u32 z) crest points, 1/16 ft (0..131071); unused points zero
          76  u8 opacity %, 77 u8 mist %, 78 u8 sound volume %, 79 u8 0
          80  char[16] sound stem (SOUND\<stem>.WAV; empty = no sound of its own), NUL-padded
          96  char[16] texture stem (a pod texture or .ANI base name; empty = the default), NUL-padded
          112 16 bytes zero
          v1.1 only: 128 u8 mist depth %, 129 u8 mist height % (0 means 100, capped at 250), 130 u16 0
*/
export const WFL_MAGIC = "MWFL";
export const WFL_HEADER = 32;
export const WFL_DIRENTRY = 16;
export const WFL_CHUNKHEAD = 8;
export const WFL_STRIDE = 128;
export const WFL_STRIDE_V11 = 132;
export const WFL_MAX_FALLS = 64;
export const WFL_MAX_POINTS = 8;
export const WFL_NAME_LEN = 16;
/** Feet per crest point unit. */
export const WFL_POINT_FT = 1 / 16;
/** Feet per second per flow speed unit. */
export const WFL_SPEED_FT = 1 / 16;
/** Feet per crest height unit (the .WTR / .LVL water scale). */
export const WFL_HEIGHT_FT = 0.5;
export const WFL_FLAG_FREEZE = 1;
export const WFL_FLAG_SPLASH = 2;
export const WFL_FLAG_SOUND = 4;
const r16 = (b, o) => b[o] | (b[o + 1] << 8);
const r32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function readName(b, o) {
    let s = "";
    // Traxx copies the 16 bytes and forces the last to NUL: at most 15 characters.
    for (let i = 0; i < WFL_NAME_LEN - 1; i++) {
        const c = b[o + i];
        if (c === 0)
            break;
        s += String.fromCharCode(c);
    }
    return s;
}
export function isWfl(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x57 && bytes[2] === 0x46 && bytes[3] === 0x4c;
}
/** Read a .WFL with Traxx 1.7.1's rules; a file Traxx would refuse throws a RangeError naming why. */
export function parseWfl(bytes) {
    if (bytes.length < WFL_HEADER || !isWfl(bytes))
        throw new RangeError("WFL: not an MWFL file");
    const major = r16(bytes, 4);
    if (major === 0 || major > 1)
        throw new RangeError(`WFL: major version ${major} is not readable${major > 1 ? " (needs a newer reader)" : ""}`);
    if (r16(bytes, 16) !== 256 || r16(bytes, 18) !== 256)
        throw new RangeError("WFL: authored for another terrain size");
    const headerSize = r32(bytes, 8);
    const count = r32(bytes, 12);
    if (headerSize < WFL_HEADER || headerSize > bytes.length || count > Math.floor((bytes.length - headerSize) / WFL_DIRENTRY))
        throw new RangeError("WFL: bad header");
    let chunk = null;
    for (let i = 0; i < count; i++) {
        const e = headerSize + i * WFL_DIRENTRY;
        if (bytes[e] !== 0x46 || bytes[e + 1] !== 0x41 || bytes[e + 2] !== 0x4c || bytes[e + 3] !== 0x4c)
            continue;
        const v = r32(bytes, e + 4), o = r32(bytes, e + 8), s = r32(bytes, e + 12);
        if (o <= bytes.length && s <= bytes.length - o && v === 1)
            chunk = [o, s];
        break; // the first FALL entry is claimed even when it is unusable
    }
    if (!chunk || chunk[1] < WFL_CHUNKHEAD)
        throw new RangeError("WFL: no usable FALL chunk");
    const [off, size] = chunk;
    const n = r32(bytes, off);
    const stride = r16(bytes, off + 4);
    if (stride < WFL_STRIDE || n > WFL_MAX_FALLS || n * stride > size - WFL_CHUNKHEAD)
        throw new RangeError("WFL: bad FALL chunk");
    const falls = [];
    for (let i = 0; i < n; i++) {
        const r = off + WFL_CHUNKHEAD + i * stride;
        const np = bytes[r + 2];
        if (np < 2 || np > WFL_MAX_POINTS)
            throw new RangeError(`WFL: fall ${i + 1} has ${np} points (2 to 8)`);
        const flags = r16(bytes, r + 4);
        const speed = r16(bytes, r + 6);
        const height = r32(bytes, r + 8);
        const points = [];
        for (let k = 0; k < np; k++)
            points.push({ x: r32(bytes, r + 12 + 8 * k), z: r32(bytes, r + 16 + 8 * k) });
        const size11 = (v) => (v ? Math.min(v, 250) : 100);
        falls.push({
            id: bytes[r], source: bytes[r + 1], flags,
            freeze: (flags & WFL_FLAG_FREEZE) !== 0, splash: (flags & WFL_FLAG_SPLASH) !== 0, sound: (flags & WFL_FLAG_SOUND) !== 0,
            speed, speedFtPerSec: speed * WFL_SPEED_FT, height, heightFt: height * WFL_HEIGHT_FT, points,
            opacity: bytes[r + 76], mist: bytes[r + 77], volume: bytes[r + 78],
            mistDepth: stride >= WFL_STRIDE_V11 ? size11(bytes[r + 128]) : 100,
            mistHeight: stride >= WFL_STRIDE_V11 ? size11(bytes[r + 129]) : 100,
            soundName: readName(bytes, r + 80), textureName: readName(bytes, r + 96),
        });
    }
    return { major, minor: r16(bytes, 6), stride, falls };
}
function putName(out, o, name, what) {
    if (name.length > WFL_NAME_LEN - 1)
        throw new RangeError(`WFL: ${what} "${name}" is longer than 15 characters`);
    for (let i = 0; i < name.length; i++) {
        const c = name.charCodeAt(i);
        if (c === 0 || c > 255)
            throw new RangeError(`WFL: ${what} "${name}" has a character a stem cannot hold`);
        out[o + i] = c;
    }
}
/**
 * Write a .WFL exactly as Traxx 1.7.1 lays one out: v1.0 (128-byte records) unless some fall's mist
 * depth or height is neither 0 nor 100, then v1.1 (132). Fall i gets id i + 1. Validation of the
 * falls themselves (crest shape, source, names in the pod) is the caller's: this checks only what
 * the file cannot hold.
 */
export function writeWfl(falls) {
    if (falls.length < 1 || falls.length > WFL_MAX_FALLS)
        throw new RangeError("WFL: 1 to 64 falls");
    const custom = (v) => v !== undefined && v !== 0 && v !== 100;
    const stride = falls.some((f) => custom(f.mistDepth) || custom(f.mistHeight)) ? WFL_STRIDE_V11 : WFL_STRIDE;
    const chunkOff = WFL_HEADER + WFL_DIRENTRY;
    const chunkSize = WFL_CHUNKHEAD + falls.length * stride;
    const out = new Uint8Array(chunkOff + chunkSize);
    const v = new DataView(out.buffer);
    out.set([0x4d, 0x57, 0x46, 0x4c]);
    v.setUint16(4, 1, true);
    v.setUint16(6, stride === WFL_STRIDE_V11 ? 1 : 0, true);
    v.setUint32(8, WFL_HEADER, true);
    v.setUint32(12, 1, true);
    v.setUint16(16, 256, true);
    v.setUint16(18, 256, true);
    out.set([0x46, 0x41, 0x4c, 0x4c], WFL_HEADER);
    v.setUint32(WFL_HEADER + 4, 1, true);
    v.setUint32(WFL_HEADER + 8, chunkOff, true);
    v.setUint32(WFL_HEADER + 12, chunkSize, true);
    v.setUint32(chunkOff, falls.length, true);
    v.setUint16(chunkOff + 4, stride, true);
    falls.forEach((f, i) => {
        const p = chunkOff + WFL_CHUNKHEAD + i * stride;
        if (f.points.length < 2 || f.points.length > WFL_MAX_POINTS)
            throw new RangeError(`WFL: fall ${i + 1} needs 2 to 8 points`);
        const byte = (x, what) => {
            if (!Number.isInteger(x) || x < 0 || x > 255)
                throw new RangeError(`WFL: fall ${i + 1} ${what} ${x} is not 0..255`);
            return x;
        };
        out[p] = i + 1;
        out[p + 1] = byte(f.source, "source");
        out[p + 2] = f.points.length;
        v.setUint16(p + 4, f.flags & 0xffff, true);
        v.setUint16(p + 6, f.speed & 0xffff, true);
        v.setUint32(p + 8, f.height >>> 0, true);
        f.points.forEach((pt, k) => { v.setUint32(p + 12 + 8 * k, pt.x >>> 0, true); v.setUint32(p + 16 + 8 * k, pt.z >>> 0, true); });
        out[p + 76] = byte(f.opacity, "opacity");
        out[p + 77] = byte(f.mist, "mist");
        out[p + 78] = byte(f.volume, "volume");
        putName(out, p + 80, f.soundName ?? "", "sound");
        putName(out, p + 96, f.textureName ?? "", "texture");
        if (stride === WFL_STRIDE_V11) {
            out[p + 128] = f.mistDepth ? byte(f.mistDepth, "mist depth") : 100;
            out[p + 129] = f.mistHeight ? byte(f.mistHeight, "mist height") : 100;
        }
    });
    return out;
}
/** A fall's crest points in feet (a point is stored in 1/16 ft). */
export function wflPointsFt(fall) {
    return fall.points.map((p) => [p.x * WFL_POINT_FT, p.z * WFL_POINT_FT]);
}
