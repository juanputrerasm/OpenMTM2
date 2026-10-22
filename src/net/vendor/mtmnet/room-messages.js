// Generated from openmtm2-server 0.1.0 protocol/room-messages.js. Do not edit; run its tools/vendor.mjs.
/*
  The online room protocol, version 1 (docs/PROTOCOL.md): what OpenMTM2 and the room server
  (openmtm2d) say to each other over one WebSocket.

  - Text frames hold one JSON object each, with a `type`. A request may carry an `id`; its answer
    is `{ type: "result", id, ... }` or `{ type: "error", id, code, message }`.
  - Binary frames hold truck state (`encodeState` / `decodeState`), 68 bytes, little-endian.

  `checkClient(message)` validates a client's message against the tables below and returns
  `{ ok: true, message }` (unknown fields dropped) or `{ ok: false, code, message }`. The server
  uses it on every frame; a client may use it to test itself.
  Browser and Node; no dependencies.
*/

export const ROOM_PROTOCOL = 1;
/** The WebSocket path on a room server. */
export const ROOM_PATH = "/play";

/** Sizes the server enforces. */
export const LIMITS = Object.freeze({
  playerName: 24, roomName: 40, password: 32, chat: 160, truck: 40, sit: 20, trackName: 80, mode: 32,
  maxPlayers: 16, computers: 15, laps: 99, textFrame: 8192, code: 6,
});

/** Error codes in `{ type: "error", code }`. */
export const ERROR = Object.freeze({
  BAD_REQUEST: "bad-request", PROTOCOL: "protocol", HELLO_FIRST: "hello-first", NOT_FOUND: "not-found", FULL: "full",
  PASSWORD: "password", NOT_OWNER: "not-owner", STATE: "state", NOT_IN_ROOM: "not-in-room", RATE: "rate-limited",
  LIMIT: "limit", SHUTDOWN: "shutting-down",
});

/** WebSocket close codes the server uses (besides 1000 and 1001). */
export const CLOSE = Object.freeze({ PROTOCOL: 4000, BANNED: 4003, KICKED: 4004, RATE: 4008, TOO_MANY: 4009 });

/** Room states. */
export const ROOM_STATE = Object.freeze({ LOBBY: "lobby", LOADING: "loading", RACING: "racing" });

/** Race events a client may send in `{ type: "race", e }`, relayed to the room as `{ type: "race", from, e }`. */
export const RACE_EVENTS = Object.freeze(["positions", "go", "split", "damage", "lights", "horn", "yeehaw", "gone", "mode"]);

/** Room codes: six characters from an alphabet without look-alikes. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function roomCode(random = Math.random) {
  let s = "";
  for (let i = 0; i < LIMITS.code; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return s;
}
export const isRoomCode = (s) => typeof s === "string" && s.length === LIMITS.code && [...s].every((c) => CODE_ALPHABET.includes(c));

// ---- Validation ----
// A field spec is [type, ...args, "?"] where a trailing "?" makes it optional.

const str = (min, max, opt) => ["str", min, max, opt];
const int = (min, max, opt) => ["int", min, max, opt];
const num = (min, max, opt) => ["num", min, max, opt];
const bool = (opt) => ["bool", opt];
const obj = (fields, opt) => ["obj", fields, opt];
const list = (item, max, opt) => ["list", item, max, opt];
const any = (opt) => ["any", opt];
/** Any JSON object, kept whole (its size is bounded by the frame's). */
const freeObj = (opt) => ["freeobj", opt];
const OPT = true;

const TRACK = obj({ sit: str(1, LIMITS.sit), name: str(0, LIMITS.trackName, OPT), crc: int(-1, 0xffffffff) }, OPT);

/** Every message a client may send, by type. */
export const CLIENT_MESSAGES = Object.freeze({
  hello: { protocol: int(1, 0xffff), name: str(1, LIMITS.playerName), client: str(0, 40, OPT) },
  list: {},
  create: { name: str(1, LIMITS.roomName), password: str(0, LIMITS.password, OPT), maxPlayers: int(2, LIMITS.maxPlayers, OPT), public: bool(OPT), classic: bool(OPT) },
  join: { room: str(1, 16), password: str(0, LIMITS.password, OPT) },
  leave: {},
  profile: {
    truck: str(0, LIMITS.truck, OPT), skill: int(0, 2, OPT), location: int(0, 99, OPT), ready: bool(OPT), team: int(0, 15, OPT),
    latency: int(0, 60000, OPT), content: obj({ sit: str(1, LIMITS.sit), crc: int(-1, 0xffffffff) }, OPT),
  },
  chat: { text: str(1, LIMITS.chat), to: int(1, 0x7fffffff, OPT) },
  settings: {
    track: TRACK, laps: int(1, LIMITS.laps, OPT), weather: int(-1, 15, OPT), mode: str(0, LIMITS.mode, OPT),
    computers: int(0, LIMITS.computers, OPT), damage: bool(OPT), collisions: bool(OPT),
  },
  kick: { member: int(1, 0x7fffffff) },
  start: { weather: int(0, 15), computers: list(obj({ name: str(1, LIMITS.playerName), truck: str(0, LIMITS.truck) }), LIMITS.computers, OPT) },
  loaded: {},
  race: { e: any() },
  result: { laps: int(0, 10000), total: num(0, 1e7), best: num(-1e7, 1e7), lapsLed: int(0, 10000, OPT) },
  ping: { t: num(-1e15, 1e15) },
});

function checkValue(spec, v, path) {
  const [kind] = spec;
  const opt = spec[spec.length - 1] === true;
  if (v === undefined || v === null) return opt ? { ok: true, value: undefined } : { ok: false, why: `${path} is missing` };
  switch (kind) {
    case "str": {
      if (typeof v !== "string") return { ok: false, why: `${path} must be text` };
      const t = v.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
      if (t.length < spec[1] || t.length > spec[2]) return { ok: false, why: `${path} must be ${spec[1]} to ${spec[2]} characters` };
      return { ok: true, value: t };
    }
    case "int":
      if (!Number.isInteger(v) || v < spec[1] || v > spec[2]) return { ok: false, why: `${path} must be a whole number from ${spec[1]} to ${spec[2]}` };
      return { ok: true, value: v };
    case "num":
      if (typeof v !== "number" || !Number.isFinite(v) || v < spec[1] || v > spec[2]) return { ok: false, why: `${path} must be a number` };
      return { ok: true, value: v };
    case "bool":
      if (typeof v !== "boolean") return { ok: false, why: `${path} must be true or false` };
      return { ok: true, value: v };
    case "obj": {
      if (typeof v !== "object" || Array.isArray(v)) return { ok: false, why: `${path} must be an object` };
      const out = {};
      for (const [k, s] of Object.entries(spec[1])) {
        const r = checkValue(s, v[k], `${path}.${k}`);
        if (!r.ok) return r;
        if (r.value !== undefined) out[k] = r.value;
      }
      return { ok: true, value: out };
    }
    case "list": {
      if (!Array.isArray(v) || v.length > spec[2]) return { ok: false, why: `${path} must be a list of at most ${spec[2]}` };
      const out = [];
      for (let i = 0; i < v.length; i++) {
        const r = checkValue(spec[1], v[i], `${path}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case "any":
      return { ok: true, value: v };
    case "freeobj":
      if (typeof v !== "object" || Array.isArray(v)) return { ok: false, why: `${path} must be an object` };
      return { ok: true, value: v };
    default:
      return { ok: false, why: `${path}: unknown spec` };
  }
}

/** Validate one message from a client (already parsed JSON). */
export function checkClient(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, code: ERROR.BAD_REQUEST, message: "A message is a JSON object." };
  const fields = Object.hasOwn(CLIENT_MESSAGES, m.type) ? CLIENT_MESSAGES[m.type] : null;
  if (!fields) return { ok: false, code: ERROR.BAD_REQUEST, message: `Unknown message type ${String(m.type).slice(0, 20)}.` };
  if (m.id !== undefined && !(Number.isInteger(m.id) && m.id >= 0 && m.id <= 0x7fffffff)) return { ok: false, code: ERROR.BAD_REQUEST, message: "id must be a whole number." };
  const r = checkValue(["obj", fields], m, m.type);
  if (!r.ok) return { ok: false, code: ERROR.BAD_REQUEST, message: r.why };
  if (m.type === "race") {
    const e = checkRaceEvent(m.e);
    if (!e.ok) return { ok: false, code: ERROR.BAD_REQUEST, message: e.why };
    r.value.e = e.value;
  }
  return { ok: true, message: { type: m.type, ...(m.id !== undefined ? { id: m.id } : {}), ...r.value } };
}

const RACE_EVENT_FIELDS = {
  positions: { positions: list(["list", num(-1e7, 1e7), 3, true], LIMITS.maxPlayers + 1) },
  go: {},
  split: { vehicle: int(1, LIMITS.maxPlayers), next: int(0, 1000), split: num(0, 1e6) },
  damage: { vehicle: int(1, LIMITS.maxPlayers), code: int(0, 0xffffffff) },
  lights: { vehicle: int(1, LIMITS.maxPlayers), lamps: int(0, 0xffffffff) },
  horn: { vehicle: int(1, LIMITS.maxPlayers) },
  yeehaw: { vehicle: int(1, LIMITS.maxPlayers) },
  gone: { vehicle: int(1, LIMITS.maxPlayers) },
  // An extension mode's state, from the room owner (docs/PROTOCOL.md "Extension modes"); its shape is the mode's.
  mode: { data: freeObj() },
};
/** Validate one race event (the `e` of a `race` message). */
export function checkRaceEvent(e) {
  if (!e || typeof e !== "object" || !RACE_EVENTS.includes(e.kind)) return { ok: false, why: "race.e.kind is not a race event" };
  const r = checkValue(["obj", RACE_EVENT_FIELDS[e.kind]], e, `race.e(${e.kind})`);
  if (!r.ok) return r;
  if (e.kind === "positions" && r.value.positions.some((p) => p && p.length !== 3)) return { ok: false, why: "positions are [x, y, z]" };
  return { ok: true, value: { kind: e.kind, ...r.value } };
}

// ---- Truck state, binary ----

/** The state frame's kind byte, and its size. */
export const STATE_FRAME = 1;
export const STATE_SIZE = 68;
/** The most state frames a client may send per second for each truck it owns. */
export const STATE_MAX_HZ = 30;

/**
 * One truck's state as 68 bytes (docs/PROTOCOL.md "Truck state"):
 *
 *   0 u8 kind (1)   1 u8 vehicle   2 u16 seq   4 u32 sender clock (ms, wraps)
 *   8 f32 x3 position (ft)   20 f32 x3 body velocity (ft/s)   32 f32 x3 angles (rad: theta, phi, psi as packet 0x02; psi the heading)
 *   44 f32 steer (rad)   48 f32 throttle   52 f32 rear brake   56 f32 front brake (0 to 1)
 *   60 s8 gear (1 P, 2 R, 3 N, 4 and up forward)   61 u8 flags (bit 0 automatic gearbox)   62 u16 reserved (0)   64 f32 score (Summit)
 */
export function encodeState(s) {
  const bytes = new Uint8Array(STATE_SIZE);
  const v = new DataView(bytes.buffer);
  v.setUint8(0, STATE_FRAME);
  v.setUint8(1, s.vehicle & 0xff);
  v.setUint16(2, (s.seq ?? 0) & 0xffff, true);
  v.setUint32(4, Math.trunc(s.time ?? 0) >>> 0, true);
  const f3 = (at, a) => { for (let i = 0; i < 3; i++) v.setFloat32(at + 4 * i, Number(a?.[i] ?? 0), true); };
  f3(8, s.pos);
  f3(20, s.bvel);
  f3(32, s.euler);
  v.setFloat32(44, s.steer ?? 0, true);
  v.setFloat32(48, s.throttle ?? 0, true);
  v.setFloat32(52, s.brakeRear ?? 0, true);
  v.setFloat32(56, s.brakeFront ?? 0, true);
  v.setInt8(60, Math.max(-128, Math.min(127, Math.trunc(s.gear ?? 0))));
  v.setUint8(61, s.autoShift ? 1 : 0);
  v.setUint16(62, 0, true);
  v.setFloat32(64, s.score ?? 0, true);
  return bytes;
}

/** The fields of a state frame, or null when it is not one. Non-finite numbers make it invalid. */
export function decodeState(bytes) {
  if (!bytes || bytes.byteLength !== STATE_SIZE) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== STATE_FRAME) return null;
  const f = (at) => v.getFloat32(at, true);
  const f3 = (at) => [f(at), f(at + 4), f(at + 8)];
  const s = {
    vehicle: v.getUint8(1), seq: v.getUint16(2, true), time: v.getUint32(4, true),
    pos: f3(8), bvel: f3(20), euler: f3(32), steer: f(44), throttle: f(48), brakeRear: f(52), brakeFront: f(56),
    gear: v.getInt8(60), autoShift: !!(v.getUint8(61) & 1), score: f(64),
  };
  const nums = [...s.pos, ...s.bvel, ...s.euler, s.steer, s.throttle, s.brakeRear, s.brakeFront, s.score];
  return nums.every(Number.isFinite) ? s : null;
}

/** Whether sequence number `a` is newer than `b` (u16, wrapping). */
export const seqNewer = (a, b) => ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;
