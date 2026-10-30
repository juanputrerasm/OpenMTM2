// Generated from openmtm2-server 0.2.0 protocol/mtm2-packets.js. Do not edit; run its tools/vendor.mjs.
/*
  Monster Truck Madness 2's own network packets, as retail 2.00.42 sends them inside DirectPlay
  player messages (OpenMTM2 docs/MONSTER_EXE_ANALYSIS.md 14.2).

  Every packet starts with a 12-byte header: u8 type, 3 bytes of padding (sent as zero here), u32 0,
  u32 the sender's DPID. The payload starts at +0xC. Little-endian, IEEE floats, ANSI strings
  NUL-terminated in fixed fields, packed.

  `encodePacket(kind or type, fields, senderDpid)` gives the bytes, `decodePacket(bytes)` gives
  `{ type, kind, sender, ...fields }` (`kind` the packet's name here; some packets have a field
  called `name`). Field offsets below are from the start of the packet.
  Browser and Node; no dependencies.
*/

/** Monster Truck Madness 2's DirectPlay application GUID (MONSTER_EXE_ANALYSIS.md 14.1). */
export const MTM2_APPLICATION = "{6CD1C6E0-96FB-11D1-A268-00A024F2C995}";

/** The version every machine announces in its player info (0x03); 2.00.42 sends 0x0201. */
export const MTM2_NET_VERSION = 0x0201;

/** Barrier codes (packet 0x15 and the 0x18 results): C multi-character constants, 'rslt' = 0x72736c74, sent as u32 LE. */
export const fourCC = (s) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
export const BARRIER = Object.freeze({ SYNC: fourCC("sync"), RESULTS: fourCC("rslt") });

/** Race exit code sent with 0x0e when the host cancels. */
export const EXIT_CANCELLED = 9;

/** Skill levels (0x03, 0x10). */
export const SKILL = Object.freeze({ ROOKIE: 0, INTERMEDIATE: 1, PROFESSIONAL: 2 });

// Field kinds: [kind, offset, extra]. char: fixed-size ANSI string; f32x3: three floats; f32xN: N floats.
const PACKETS = [
  [0x01, "ready0", 16, { ready: ["u8", 0x0c] }],
  [0x02, "state", 61, {
    pos: ["f32x3", 0x0c], bvel: ["f32x3", 0x18], theta: ["f32", 0x24], phi: ["f32", 0x28], psi: ["f32", 0x2c],
    steer: ["f32", 0x30], throttle: ["u8", 0x34], brake: ["u8", 0x35], gear: ["u8", 0x36], autoShift: ["u8", 0x37],
    vehicle: ["u8", 0x38], score: ["f32", 0x39],
  }],
  [0x03, "info", 92, {
    truck: ["char", 0x20, 20], unknown1: ["s16", 0x34], unknown2: ["s16", 0x36], status: ["u8", 0x38],
    version: ["u16", 0x3a], location: ["u32", 0x3c], skill: ["u32", 0x40], setup: ["u32x5", 0x44], team: ["u32", 0x58],
  }],
  [0x06, "ridicule", 16, { n: ["u32", 0x0c] }],
  [0x0b, "split", 24, { truck: ["u32", 0x0c], next: ["u32", 0x10], split: ["f32", 0x14] }],
  [0x0d, "quick", 56, { text: ["char", 0x0c, 44] }],
  [0x0e, "exit", 16, { code: ["u32", 0x0c] }],
  [0x0f, "truck", 32, { truck: ["char", 0x0c, 20] }],
  [0x10, "skill", 16, { skill: ["u32", 0x0c] }],
  [0x11, "location", 16, { location: ["u32", 0x0c] }],
  [0x12, "track", 112, { sit: ["char", 0x0c, 20], name: ["char", 0x20, 80] }],
  [0x13, "ready", 16, { ready: ["u8", 0x0c] }],
  [0x14, "start", 36, { sit: ["char", 0x0c, 20], laps: ["s16", 0x20], weather: ["s16", 0x22] }],
  [0x15, "barrier", 16, { code: ["u32", 0x0c] }],
  [0x16, "laps", 16, { laps: ["s16", 0x0c] }],
  [0x17, "positions", 120, { positions: ["f32x3n", 0x0c, 9] }],
  [0x18, "result", 32, { code: ["u32", 0x0c], lapsLed: ["u32", 0x10], laps: ["u32", 0x14], total: ["f32", 0x18], best: ["f32", 0x1c] }],
  [0x19, "go", 16, { zero: ["u32", 0x0c] }],
  [0x1a, "noTrack", 92, { name: ["char", 0x0c, 80] }],
  [0x1b, "weather", 16, { weather: ["s32", 0x0c] }],
  [0x1c, "gone", 12, {}],
  [0x1d, "horn", 16, { truck: ["s32", 0x0c] }],
  [0x1e, "yeehaw", 16, { truck: ["s32", 0x0c] }],
  [0x1f, "lights", 20, { vehicle: ["u32", 0x0c], lamps: ["u32", 0x10] }],
  [0x20, "damage", 20, { vehicle: ["u32", 0x0c], code: ["u32", 0x10] }],
  [0x21, "teamPlay", 16, { on: ["u8", 0x0c] }],
  [0x22, "newTeam", 48, { name: ["char", 0x0c, 32], team: ["u32", 0x2c] }],
  [0x23, "joinTeam", 16, { team: ["u32", 0x0c] }],
  [0x24, "kick", 12, {}],
  [0x25, "checksum", 116, { sit: ["char", 0x0c, 20], name: ["char", 0x20, 80], crc: ["u32", 0x70] }],
  [0x80, "chat", 96, { flag: ["u8", 0x0c], private: ["u8", 0x0d], text: ["char", 0x0e, 82] }],
  // The net layer (0x456740).
  [0x81, "addPlayer", 96, { name: ["char", 0x0c, 80], dpid: ["u32", 0x5c] }],
  [0x82, "activatePlayer", 100, { name: ["char", 0x0c, 80], dpid: ["u32", 0x5c], flag: ["u8", 0x60] }],
  [0x83, "removePlayer", 16, { dpid: ["u32", 0x0c] }],
  [0x84, "ping", 16, { time: ["u32", 0x0c] }],
  [0x85, "pong", 16, { time: ["u32", 0x0c] }],
  [0x86, "rename", 96, { dpid: ["u32", 0x0c], name: ["char", 0x10, 80] }],
  [0x87, "slot", 20, { dpid: ["u32", 0x0c], slot: ["u16", 0x10] }],
  [0x88, "host", 16, { dpid: ["u32", 0x0c] }],
  [0x8a, "listState", 16, { a: ["u8", 0x0c], b: ["u8", 0x0d], c: ["u8", 0x0e] }],
];

export const TYPES = Object.freeze(Object.fromEntries(PACKETS.map(([type, name]) => [name, type])));
const BY_TYPE = new Map(PACKETS.map(([type, name, size, fields]) => [type, { type, name, size, fields }]));
/** The packets DirectPlay must deliver guaranteed (sent with DPSEND_GUARANTEED by the game). */
export const GUARANTEED = new Set([0x03, 0x11, 0x12, 0x14, 0x15, 0x16, 0x18, 0x1b, 0x21, 0x23, 0x24]);

/** The voice radio packet (0x89) is variable length and not decoded. */
export const RADIO = 0x89;

/** The wire size of a packet type, or null when unknown. */
export const packetSize = (type) => BY_TYPE.get(type)?.size ?? null;

function writeString(view, offset, length, text) {
  const s = String(text ?? "");
  for (let i = 0; i < length; i++) view.setUint8(offset + i, i < length - 1 && i < s.length ? s.charCodeAt(i) & 0xff : 0);
}
function readString(view, offset, length) {
  let s = "";
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** The bytes of a packet: `kind` its name or type, `fields` its values, `sender` the sending player's DPID. */
export function encodePacket(kind, fields = {}, sender = 0) {
  const def = BY_TYPE.get(typeof kind === "number" ? kind : TYPES[kind]);
  if (!def) throw new Error(`Unknown MTM2 packet ${kind}`);
  const bytes = new Uint8Array(def.size);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, def.type);
  view.setUint32(4, 0, true);
  view.setUint32(8, sender >>> 0, true);
  for (const [key, [kind2, at, extra]] of Object.entries(def.fields)) {
    const v = fields[key];
    switch (kind2) {
      case "u8": view.setUint8(at, Number(v ?? 0) & 0xff); break;
      case "u16": view.setUint16(at, Number(v ?? 0) & 0xffff, true); break;
      case "s16": view.setInt16(at, Number(v ?? 0), true); break;
      case "u32": view.setUint32(at, Number(v ?? 0) >>> 0, true); break;
      case "s32": view.setInt32(at, Number(v ?? 0), true); break;
      case "f32": view.setFloat32(at, Number(v ?? 0), true); break;
      case "char": writeString(view, at, extra, v); break;
      case "f32x3": for (let k = 0; k < 3; k++) view.setFloat32(at + 4 * k, Number(v?.[k] ?? 0), true); break;
      case "u32x5": for (let k = 0; k < 5; k++) view.setUint32(at + 4 * k, Number(v?.[k] ?? 0) >>> 0, true); break;
      case "f32x3n":
        for (let n = 0; n < extra; n++) for (let k = 0; k < 3; k++) view.setFloat32(at + 12 * n + 4 * k, Number(v?.[n]?.[k] ?? 0), true);
        break;
      default: throw new Error(`Bad field kind ${kind2}`);
    }
  }
  return bytes;
}

/**
 * A packet from its bytes: `{ type, kind, sender, ...fields }`. Unknown types and short packets come back as
 * `{ type, kind: null, sender, bytes }` so a relay can pass them on.
 */
export function decodePacket(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12) throw new Error("MTM2 packet shorter than its header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint8(0), sender = view.getUint32(8, true);
  const def = BY_TYPE.get(type);
  if (!def || bytes.length < def.size) return { type, kind: null, sender, bytes };
  const out = { type, kind: def.name, sender };
  for (const [key, [kind, at, extra]] of Object.entries(def.fields)) {
    switch (kind) {
      case "u8": out[key] = view.getUint8(at); break;
      case "u16": out[key] = view.getUint16(at, true); break;
      case "s16": out[key] = view.getInt16(at, true); break;
      case "u32": out[key] = view.getUint32(at, true); break;
      case "s32": out[key] = view.getInt32(at, true); break;
      case "f32": out[key] = view.getFloat32(at, true); break;
      case "char": out[key] = readString(view, at, extra); break;
      case "f32x3": out[key] = [0, 1, 2].map((k) => view.getFloat32(at + 4 * k, true)); break;
      case "u32x5": out[key] = [0, 1, 2, 3, 4].map((k) => view.getUint32(at + 4 * k, true)); break;
      case "f32x3n": out[key] = Array.from({ length: extra }, (_, n) => [0, 1, 2].map((k) => view.getFloat32(at + 12 * n + 4 * k, true))); break;
    }
  }
  return out;
}

// ---- The truck state (0x02) in game units ----

const TURN = 2 * Math.PI;
/** An angle as the game sends it: a whole byte value, 256 per turn, carried in a float. */
export function angleToByte(a) {
  const b = Math.trunc(a * (256 / TURN)) % 256;
  return b < 0 ? b + 256 : b;
}
/** The angle back from that byte value, within +-pi. */
export function byteToAngle(b) {
  const a = ((Number(b) % 256) + 256) % 256 * (TURN / 256);
  return a > Math.PI ? a - TURN : a;
}
const unit = (v) => Math.max(0, Math.min(255, Math.trunc(Number(v) * 255)));

/**
 * The 0x02 fields from a truck's state in game units: `{ pos, bvel, euler: [theta, phi, psi], steer, throttle, brakeRear,
 * gear, autoShift, vehicle, score }` (feet, ft/s, radians, pedals 0 to 1, gear 1 P to 6 third).
 */
export function stateFields(s) {
  return {
    pos: s.pos, bvel: s.bvel,
    theta: angleToByte(s.euler[0]), phi: angleToByte(s.euler[1]), psi: angleToByte(s.euler[2]),
    steer: angleToByte(s.steer ?? 0), throttle: unit(s.throttle ?? 0), brake: unit(s.brakeRear ?? 0),
    gear: s.gear ?? 0, autoShift: s.autoShift ? 1 : 0, vehicle: s.vehicle ?? 0, score: s.score ?? 0,
  };
}
/** A decoded 0x02 back in game units (the inverse of stateFields, to the game's precision). */
export function stateFromPacket(p) {
  return {
    vehicle: p.vehicle, pos: p.pos, bvel: p.bvel,
    euler: [byteToAngle(p.theta), byteToAngle(p.phi), byteToAngle(p.psi)],
    steer: byteToAngle(p.steer), throttle: p.throttle / 255, brakeRear: p.brake / 255,
    gear: p.gear, autoShift: !!p.autoShift, score: p.score,
  };
}

// ---- Ping times (0x84, 0x85) ----

/** The game's ping clock: milliseconds times 1179.648, as a u32. */
export const pingTime = (ms) => Math.trunc(ms * 1179.648) >>> 0;
/** The round trip in milliseconds from a ping's echoed time and now (0x120000 ticks a second). */
export const pingMs = (sent, nowTicks) => (((nowTicks - sent) >>> 0) * 1000) / 0x120000;
