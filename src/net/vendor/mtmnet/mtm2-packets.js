// Generated from openmtm2-server 0.4.1 protocol/mtm2-packets.js. Do not edit; run its tools/vendor.mjs.
/*
  Monster Truck Madness 2's own network packets, as retail 2.00.42 sends them inside DirectPlay
  player messages (OpenMTM2 docs/MONSTER_EXE_ANALYSIS.md 14.2).

  Every packet starts with a 12-byte header: u8 type, 3 bytes of padding (sent as zero here), u32 0,
  u32 the sender's DPID. The payload starts at +0xC. Little-endian, IEEE floats, ANSI strings
  NUL-terminated in fixed fields, packed.

  `encodePacket(kind or type, fields, senderDpid, profile)` gives the bytes, `decodePacket(bytes, profile)`
  gives `{ type, kind, sender, ...fields }` (`kind` the packet's name here; some packets have a field
  called `name`). Field offsets below are from the start of the packet.

  Profiles: Community Patch 3 and 4 change some packets (OpenMTM2 docs/CP4_EXE_ANALYSIS.md section 9).
  Which layout a peer uses follows from the version it announces in its player info (0x03 at +0x3A,
  the same in every profile): `profileForVersion(version)` gives PROFILES.retail (0x0201), .cp3
  (0x3400) or .cp4 (0x3402). The profile defaults to retail everywhere.
  Browser and Node; no dependencies.
*/

/** Monster Truck Madness 2's DirectPlay application GUID (MONSTER_EXE_ANALYSIS.md 14.1). */
export const MTM2_APPLICATION = "{6CD1C6E0-96FB-11D1-A268-00A024F2C995}";

/** The version every machine announces in its player info (0x03); 2.00.42 sends 0x0201. */
export const MTM2_NET_VERSION = 0x0201;
/** Community Patch 3 (monster.exe 2.0.52.0) announces 0x3400, CP4 beta 0.52 (2.0.52.2) 0x3402 (CP4_EXE_ANALYSIS.md 9). */
export const CP3_NET_VERSION = 0x3400;
export const CP4_NET_VERSION = 0x3402;

/** Barrier codes (packet 0x15 and the 0x18 results): C multi-character constants, 'rslt' = 0x72736c74, sent as u32 LE. */
export const fourCC = (s) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
export const BARRIER = Object.freeze({ SYNC: fourCC("sync"), RESULTS: fourCC("rslt") });

/** Race exit code sent with 0x0e when the host cancels. */
export const EXIT_CANCELLED = 9;

/** Skill levels (0x03, 0x10). */
export const SKILL = Object.freeze({ ROOKIE: 0, INTERMEDIATE: 1, PROFESSIONAL: 2 });

// Field kinds: [kind, offset, extra]. char: fixed-size ANSI string; f32x3: three floats; u32x5: five u32;
// f32x3n: `extra` points of three floats; f32xn, u8xn: `extra` values.
/** The truck state's first 61 bytes, in every profile. Retail codes the angles and steering as byte values. */
const STATE_FIELDS = {
  pos: ["f32x3", 0x0c], bvel: ["f32x3", 0x18], theta: ["f32", 0x24], phi: ["f32", 0x28], psi: ["f32", 0x2c],
  steer: ["f32", 0x30], throttle: ["u8", 0x34], brake: ["u8", 0x35], gear: ["u8", 0x36], autoShift: ["u8", 0x37],
  vehicle: ["u8", 0x38], score: ["f32", 0x39],
};
const START_FIELDS = { sit: ["char", 0x0c, 20], laps: ["s16", 0x20], weather: ["s16", 0x22] };
const PACKETS = [
  [0x01, "ready0", 16, { ready: ["u8", 0x0c] }],
  [0x02, "state", 61, STATE_FIELDS],
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
  [0x14, "start", 36, START_FIELDS],
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

/**
 * Community Patch 3 (CP4_EXE_ANALYSIS.md 9): 0x02 grows to 65 bytes, the angles and steering are f32 radians (the
 * truck's own values, not byte-coded) and a u32 sender tick follows; 0x26 and 0x27 are new.
 */
const CP3_PACKETS = [
  [0x02, "state", 65, { ...STATE_FIELDS, tick: ["u32", 0x3d] }],
  // The owner's race progress: truck index, segments passed, total time (applied when > 0).
  [0x26, "progress", 24, { truck: ["u32", 0x0c], segments: ["u32", 0x10], total: ["f32", 0x14] }],
  // A hit on another machine's truck: target truck index, source vehicle (0..9), linear and angular impulse.
  [0x27, "collision", 44, { target: ["u32", 0x0c], source: ["u32", 0x10], linear: ["f32x3", 0x14], angular: ["f32x3", 0x20] }],
];
/**
 * CP4 beta 0.52 (CP4_EXE_ANALYSIS.md 9): 0x02 is 116 bytes, CP3's plus up to two older poses ({ x, y, z }, theta, phi,
 * psi, each `poseAges[i]` ticks before `tick`); 0x14 carries a raceId; 0x28 and 0x29 are the post-load barrier.
 */
const CP4_PACKETS = [
  [0x02, "state", 116, {
    ...STATE_FIELDS, tick: ["u32", 0x3d], poseCount: ["u8", 0x41], poseAges: ["u8xn", 0x42, 2], posePos: ["f32x3n", 0x44, 2],
    poseTheta: ["f32xn", 0x5c, 2], posePhi: ["f32xn", 0x64, 2], posePsi: ["f32xn", 0x6c, 2],
  }],
  [0x14, "start", 40, { ...START_FIELDS, raceId: ["u32", 0x24] }],
  ...CP3_PACKETS.filter(([type]) => type !== 0x02),
  [0x28, "raceLoaded", 16, { raceId: ["u32", 0x0c] }],
  [0x29, "raceRelease", 16, { raceId: ["u32", 0x0c] }],
];
/** CP4's 0x02 carries at most two older poses; its receiver drops a packet that claims more. */
export const CP4_MAX_POSES = 2;
/** CP3 and CP4 count the sender tick at 25 Hz: 0xa3d / 65536 s a tick. */
export const CP_TICK_S = 0xa3d / 65536;

const asDefs = (list) => list.map(([type, name, size, fields]) => [type, Object.freeze({ type, name, size, fields })]);
function makeProfile(name, version, list, guaranteed) {
  return Object.freeze({ name, version, byType: new Map(asDefs(list)), guaranteed: new Set(guaranteed) });
}
/** The packets DirectPlay must deliver guaranteed (sent with DPSEND_GUARANTEED by the game). */
export const GUARANTEED = new Set([0x03, 0x11, 0x12, 0x14, 0x15, 0x16, 0x18, 0x1b, 0x21, 0x23, 0x24]);
const RETAIL = makeProfile("retail", MTM2_NET_VERSION, PACKETS, GUARANTEED);
const overlay = (list) => [...new Map([...PACKETS, ...list].map((p) => [p[0], p])).values()];
/**
 * The packet layouts by game version. `byType` the definitions, `guaranteed` the types sent reliably. (Over CP3's
 * direct connect the transport decides: everything but 0x02 goes reliable by default, MONSTER_EXE_ANALYSIS.md 14.5.
 * CP4 sends 0x28 reliably; 0x29 is listed with it so a release cannot be lost.)
 */
export const PROFILES = Object.freeze({
  retail: RETAIL,
  cp3: makeProfile("cp3", CP3_NET_VERSION, overlay(CP3_PACKETS), GUARANTEED),
  cp4: makeProfile("cp4", CP4_NET_VERSION, overlay(CP4_PACKETS), [...GUARANTEED, 0x28, 0x29]),
});
/** The profile for a version from a player's 0x03: CP3's or CP4's exactly, anything else retail's. */
export function profileForVersion(version) {
  if (version === CP4_NET_VERSION) return PROFILES.cp4;
  if (version === CP3_NET_VERSION) return PROFILES.cp3;
  return PROFILES.retail;
}
/** A profile from its object or name, retail when none is given. */
function resolveProfile(profile) {
  if (!profile) return RETAIL;
  if (typeof profile === "string") {
    const p = PROFILES[profile];
    if (!p) throw new Error(`Unknown MTM2 packet profile ${profile}`);
    return p;
  }
  return profile;
}

export const TYPES = Object.freeze(Object.fromEntries([...PACKETS, ...CP3_PACKETS, ...CP4_PACKETS].map(([type, name]) => [name, type])));

/** The voice radio packet (0x89) is variable length (20 bytes and its data) and not decoded. */
export const RADIO = 0x89;
const RADIO_MIN = 20;

/** The wire size of a packet type in a profile (retail by default), or null when unknown. */
export const packetSize = (type, profile) => resolveProfile(profile).byType.get(type)?.size ?? null;

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

/**
 * The bytes of a packet: `kind` its name or type, `fields` its values, `sender` the sending player's DPID, `profile`
 * the layout (PROFILES entry or its name; retail by default).
 */
export function encodePacket(kind, fields = {}, sender = 0, profile) {
  const prof = resolveProfile(profile);
  const def = prof.byType.get(typeof kind === "number" ? kind : TYPES[kind]);
  if (!def) throw new Error(`Unknown MTM2 packet ${kind} in the ${prof.name} profile`);
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
      case "f32xn": for (let n = 0; n < extra; n++) view.setFloat32(at + 4 * n, Number(v?.[n] ?? 0), true); break;
      case "u8xn": for (let n = 0; n < extra; n++) view.setUint8(at + n, Number(v?.[n] ?? 0) & 0xff); break;
      default: throw new Error(`Bad field kind ${kind2}`);
    }
  }
  return bytes;
}

/**
 * A packet from its bytes in a profile (retail by default): `{ type, kind, sender, ...fields }`. The size must be the
 * profile's exactly. Unknown types, wrong sizes and the voice radio come back as
 * `{ type, kind: null, sender, bytes, reason }` so a relay can pass them on.
 */
export function decodePacket(input, profile) {
  const prof = resolveProfile(profile);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12) throw new Error("MTM2 packet shorter than its header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint8(0), sender = view.getUint32(8, true);
  const def = prof.byType.get(type);
  const reject = (reason) => ({ type, kind: null, sender, bytes, reason });
  if (type === RADIO) return reject(bytes.length < RADIO_MIN ? `radio shorter than ${RADIO_MIN} bytes` : "radio is not decoded");
  if (!def) return reject(`type 0x${type.toString(16)} is not in the ${prof.name} profile`);
  if (bytes.length !== def.size) return reject(`${def.name} is ${bytes.length} bytes, the ${prof.name} profile has ${def.size}`);
  if (def.fields.poseCount && view.getUint8(def.fields.poseCount[1]) > CP4_MAX_POSES) return reject(`more than ${CP4_MAX_POSES} older poses`);
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
      case "f32xn": out[key] = Array.from({ length: extra }, (_, n) => view.getFloat32(at + 4 * n, true)); break;
      case "u8xn": out[key] = Array.from({ length: extra }, (_, n) => view.getUint8(at + n)); break;
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
 * gear, autoShift, vehicle, score }` (feet, ft/s, radians, pedals 0 to 1, gear 1 P to 6 third). Retail codes the angles
 * and steering as byte values. CP3 and CP4 send them as radians and add `tick` (the sender's 25 Hz tick); CP4 also
 * takes `poses`, up to two older `{ age, pos, euler }` (age in ticks before `tick`, newest first).
 */
export function stateFields(s, profile) {
  const prof = resolveProfile(profile);
  const base = {
    pos: s.pos, bvel: s.bvel, throttle: unit(s.throttle ?? 0), brake: unit(s.brakeRear ?? 0),
    gear: s.gear ?? 0, autoShift: s.autoShift ? 1 : 0, vehicle: s.vehicle ?? 0, score: s.score ?? 0,
  };
  if (prof === RETAIL) {
    return { ...base, theta: angleToByte(s.euler[0]), phi: angleToByte(s.euler[1]), psi: angleToByte(s.euler[2]), steer: angleToByte(s.steer ?? 0) };
  }
  const out = { ...base, theta: s.euler[0], phi: s.euler[1], psi: s.euler[2], steer: s.steer ?? 0, tick: (s.tick ?? 0) >>> 0 };
  if (prof.byType.get(0x02).fields.poseCount) {
    const poses = (s.poses ?? []).slice(0, CP4_MAX_POSES);
    Object.assign(out, {
      poseCount: poses.length, poseAges: poses.map((q) => q.age), posePos: poses.map((q) => q.pos),
      poseTheta: poses.map((q) => q.euler[0]), posePhi: poses.map((q) => q.euler[1]), posePsi: poses.map((q) => q.euler[2]),
    });
  }
  return out;
}
/** Within +-pi, as CP3's and CP4's receivers wrap theta and phi. */
const wrapPi = (a) => {
  const t = ((a + Math.PI) % TURN + TURN) % TURN - Math.PI;
  return Number.isFinite(t) ? t : 0;
};
/**
 * A decoded 0x02 back in game units (the inverse of stateFields, to the game's precision), in the profile it was
 * decoded with. The pose is the newest one, the packet's own. CP3 and CP4 add `tick`; CP4 adds `poses` as stateFields
 * takes them.
 */
export function stateFromPacket(p, profile) {
  const prof = resolveProfile(profile);
  const base = { vehicle: p.vehicle, pos: p.pos, bvel: p.bvel, throttle: p.throttle / 255, brakeRear: p.brake / 255, gear: p.gear, autoShift: !!p.autoShift, score: p.score };
  if (prof === RETAIL) {
    return {
      vehicle: p.vehicle, pos: p.pos, bvel: p.bvel,
      euler: [byteToAngle(p.theta), byteToAngle(p.phi), byteToAngle(p.psi)],
      steer: byteToAngle(p.steer), throttle: p.throttle / 255, brakeRear: p.brake / 255,
      gear: p.gear, autoShift: !!p.autoShift, score: p.score,
    };
  }
  // CP4's receiver wraps theta and phi and takes psi as it is (CP4_EXE_ANALYSIS.md 9).
  const out = { ...base, euler: [wrapPi(p.theta), wrapPi(p.phi), p.psi], steer: p.steer, tick: p.tick };
  if (p.poseCount !== undefined) {
    out.poses = Array.from({ length: Math.min(p.poseCount, CP4_MAX_POSES) }, (_, i) => ({
      age: p.poseAges[i], pos: p.posePos[i], euler: [wrapPi(p.poseTheta[i]), wrapPi(p.posePhi[i]), p.posePsi[i]],
    }));
  }
  return out;
}

// ---- Ping times (0x84, 0x85) ----

/** The game's ping clock: milliseconds times 1179.648, as a u32. */
export const pingTime = (ms) => Math.trunc(ms * 1179.648) >>> 0;
/** The round trip in milliseconds from a ping's echoed time and now (0x120000 ticks a second). */
export const pingMs = (sent, nowTicks) => (((nowTicks - sent) >>> 0) * 1000) / 0x120000;
