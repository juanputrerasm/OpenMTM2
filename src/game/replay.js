/*
  Instant replay (MONSTER_EXE_ANALYSIS.md section 11, Demo.c): the recorder that runs through a
  race and the playback that interpolates it. The file format (`.rpl`) is OpenPhotex's
  `parseMtmReplay` and `writeMtmReplay`.

  The game records every 0x4000 ticks (a quarter second) into a ring of 2240 records: a record
  for each truck, and one for each object that moved since the last frame (the trains, which
  always move, are in every frame). Community Patch 3 keeps the same rate in a ring of 524,288.
  The port keeps the last hour (`REPLAY_KEEP_SECONDS`), each frame packed in a typed array, and
  takes the trucks four times as often (`REPLAY_SAMPLE_TICKS`, 16 Hz): every fourth frame is the
  game's record, the three between are samples, which a file carries after its counted records
  where the games never read (OpenPhotex `writeMtmReplay`). An hour of eight trucks is some 40 MB.
  `ringReplay` cuts a replay to the game's 2240 records, for a file MTM2 itself can play.
  Playback runs a smooth curve through the frames (Catmull-Rom: each frame's slope from its
  neighbours), so a jump is an arc, not straight chords. Pure, so it runs under Node.
*/
import { nearestCopy } from "../shared/scene-frame.js";
import { REPLAY_FRAME_TICKS, REPLAY_RING_RECORDS, REPLAY_TICKS_PER_SECOND } from "../vendor/openphotex/mtm/replay.js";
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";

export const FRAME_SECONDS = REPLAY_FRAME_TICKS / REPLAY_TICKS_PER_SECOND;
/** The port's frame interval: 0x1000 ticks, 16 Hz, four frames to a record of the game's. */
export const REPLAY_SAMPLE_TICKS = REPLAY_FRAME_TICKS / 4;
/** How much of a race the recorder keeps, seconds. */
export const REPLAY_KEEP_SECONDS = 3600;

/** A truck record packed: ipos 3, bvel 3, angles 3, rates 3, steering 2, tires 4, throttle, brakes 2, course, damage, gear. */
const VEHICLE_FLOATS = 24;
/** A moved object packed: its number, ipos 3, angles 3. */
const OBJECT_FLOATS = 7;
/** A sample packed: ipos 3, angles 3, steering 2, tires 4, throttle, speed. */
const SAMPLE_FLOATS = 14;

function packSample(c, out, o) {
  out.set(c.pos, o); out.set([c.euler[0], c.euler[1], c.euler[2]], o + 3); out[o + 6] = c.steer ?? 0; out[o + 7] = c.rearSteer ?? 0;
  for (let k = 0; k < 4; k++) out[o + 8 + k] = c.tires?.[k]?.angle ?? 0;
  out[o + 12] = c.throttle ?? 0; out[o + 13] = Math.hypot(...(c.bvel ?? [0, 0, c.forward ?? 0]));
}

function unpackSample(time, number, a, o) {
  const v = (k, n) => Array.from(a.subarray(o + k, o + k + n));
  return { time, number, ipos: v(0, 3), angles: v(3, 3), steering: v(6, 2), tires: v(8, 4), throttle: a[o + 12], speed: a[o + 13] };
}

function packVehicle(record, out, o) {
  out.set(record.ipos, o); out.set(record.bvel, o + 3); out.set(record.angles, o + 6); out.set(record.rates, o + 9);
  out.set(record.steering, o + 12); out.set(record.tires, o + 14);
  out[o + 18] = record.throttle; out[o + 19] = record.brakeFront; out[o + 20] = record.brakeRear;
  out[o + 21] = record.course; out[o + 22] = record.damageCode; out[o + 23] = record.gear;
}

function unpackVehicle(time, number, a, o) {
  const v = (k, n) => Array.from(a.subarray(o + k, o + k + n));
  return {
    type: 0, time, ipos: v(0, 3), bvel: v(3, 3), angles: v(6, 3), rates: v(9, 3), number, steering: v(12, 2), tires: v(14, 4),
    throttle: a[o + 18], brakeFront: a[o + 19], brakeRear: a[o + 20], course: a[o + 21], damageCode: a[o + 22], gear: a[o + 23],
  };
}

/** One truck's replay record from a simulation snapshot (worker/sim-worker.js `snapshot`). */
export function vehicleRecord(ticks, number, c, damageCode = 0) {
  return {
    type: 0, time: ticks, ipos: [...c.pos], bvel: [...(c.bvel ?? [0, 0, c.forward ?? 0])], angles: [c.euler[0], c.euler[1], c.euler[2]],
    rates: [...(c.rates ?? [0, 0, 0])], number,
    steering: [c.steer ?? 0, c.rearSteer ?? 0], tires: [0, 1, 2, 3].map((k) => c.tires?.[k]?.angle ?? 0),
    throttle: c.throttle ?? 0, brakeFront: c.brakeFront ?? 0, brakeRear: c.brakeRear ?? 0, course: c.course ?? 0,
    damageCode, gear: c.gear ?? 0,
  };
}

/** The recorder: `update` on every simulation reply, `build` for the replay to play or save. */
export function createReplayRecorder({ level, weather = 0, detailLevel = 2, vehicles, originals = [], keepSeconds = REPLAY_KEEP_SECONDS }) {
  /**
   * Each frame: `{ time, trucks, full, vehicles: Float32Array, objects: Float32Array }`, oldest first; a `full` one
   * (every 0x4000 ticks) holds the game's records, the others `SAMPLE_FLOATS` a truck and no objects.
   */
  const frames = [];
  const moved = new Map();
  let next = REPLAY_SAMPLE_TICKS, nextFull = REPLAY_FRAME_TICKS;
  const keepTicks = keepSeconds * REPLAY_TICKS_PER_SECOND;
  return {
    get frames() { return frames; },
    /**
     * `time` is the simulation's seconds; `poses` each truck's current snapshot; `boxes` the objects that
     * moved in this reply (`{ sitIndex, pos, euler }`); `damage(i)` a truck's damage code.
     */
    update(time, poses, boxes = [], damage = () => 0) {
      for (const b of boxes) moved.set(b.sitIndex, b);
      const ticks = Math.round(time * REPLAY_TICKS_PER_SECOND);
      if (ticks < next) return;
      next = ticks - (ticks % REPLAY_SAMPLE_TICKS) + REPLAY_SAMPLE_TICKS;
      if (ticks < nextFull) {
        // A sample between the game's records: the trucks only.
        const vehicles = new Float32Array(poses.length * SAMPLE_FLOATS);
        poses.forEach((c, i) => packSample(c, vehicles, i * SAMPLE_FLOATS));
        frames.push({ time: ticks, trucks: poses.length, full: false, vehicles, objects: null });
        return;
      }
      nextFull = ticks - (ticks % REPLAY_FRAME_TICKS) + REPLAY_FRAME_TICKS;
      const frame = { time: ticks, trucks: poses.length, full: true, vehicles: new Float32Array(poses.length * VEHICLE_FLOATS), objects: new Float32Array(moved.size * OBJECT_FLOATS) };
      poses.forEach((c, i) => packVehicle(vehicleRecord(ticks, i, c, damage(i)), frame.vehicles, i * VEHICLE_FLOATS));
      let o = 0;
      for (const b of moved.values()) {
        frame.objects[o] = b.sitIndex;
        frame.objects.set(b.pos, o + 1);
        frame.objects.set(b.euler ?? [0, 0, 0], o + 4);
        o += OBJECT_FLOATS;
      }
      moved.clear();
      frames.push(frame);
      // The oldest frames go once the recording is longer than it keeps.
      while (frames.length > 1 && frame.time - frames[0].time > keepTicks) frames.shift();
    },
    /** The replay; `lastSeconds` keeps only that much of its end (the pause menu's instant replay). */
    build({ lastSeconds = Infinity } = {}) {
      const from = frames.length ? frames[frames.length - 1].time - lastSeconds * REPLAY_TICKS_PER_SECOND : 0;
      let start = 0;
      while (start < frames.length && frames[start].time < from) start++;
      const out = [], samples = [];
      for (let f = start; f < frames.length; f++) {
        const frame = frames[f];
        if (!frame.full) {
          for (let i = 0; i < frame.trucks; i++) samples.push(unpackSample(frame.time, i, frame.vehicles, i * SAMPLE_FLOATS));
          continue;
        }
        for (let i = 0; i < frame.trucks; i++) out.push(unpackVehicle(frame.time, i, frame.vehicles, i * VEHICLE_FLOATS));
        for (let o = 0; o < frame.objects.length; o += OBJECT_FLOATS) {
          out.push({
            type: 1, time: frame.time, ipos: Array.from(frame.objects.subarray(o + 1, o + 4)), bvel: [0, 0, 0],
            angles: Array.from(frame.objects.subarray(o + 4, o + 7)), rates: [0, 0, 0], number: frame.objects[o],
          });
        }
      }
      return { level, weather, detailLevel, vehicles, objects: originals, records: out, ...(samples.length ? { samples } : {}) };
    },
  };
}

/**
 * A replay cut to the game's ring (MONSTER_EXE_ANALYSIS.md section 11): its newest whole frames, no more than
 * 2240 records, so Monster Truck Madness 2 and Community Patch 3 can play the file. The rest is as it was.
 */
export function ringReplay(replay) {
  const times = [...new Set(replay.records.map((r) => r.time))].sort((a, b) => b - a);
  const counts = new Map();
  for (const r of replay.records) counts.set(r.time, (counts.get(r.time) ?? 0) + 1);
  let kept = 0, from = times.length ? times[0] : 0;
  for (const time of times) {
    if (kept + counts.get(time) > REPLAY_RING_RECORDS) break;
    kept += counts.get(time);
    from = time;
  }
  const samples = replay.samples?.filter((p) => p.time >= from);
  return { ...replay, records: replay.records.filter((r) => r.time >= from), ...(samples ? { samples } : {}) };
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerpVec = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
/** The shortest way round from `a` to `b`. */
const lerpAngle = (a, b, k) => a + ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * k;

/**
 * `{ t, record }` lists by vehicle number and by object number, from a parsed replay. A vehicle's samples (the extension
 * block) join its records as records of their own, with what a sample does not carry (course, damage, gear) from the
 * record before it.
 */
function timelines(replay) {
  const vehicles = new Map(), objects = new Map();
  // A loop, not a spread: an hour of records is too many arguments for one call.
  let first = Infinity;
  for (const r of replay.records) if (r.time < first) first = r.time;
  if (first === Infinity) first = 0;
  for (const record of replay.records) {
    const table = record.type === 0 ? vehicles : objects;
    if (!table.has(record.number)) table.set(record.number, []);
    table.get(record.number).push({ t: (record.time - first) / REPLAY_TICKS_PER_SECOND, record });
  }
  for (const p of replay.samples ?? []) {
    if (p.time < first || !vehicles.has(p.number)) continue;
    vehicles.get(p.number).push({ t: (p.time - first) / REPLAY_TICKS_PER_SECOND, sample: p });
  }
  for (const list of [...vehicles.values(), ...objects.values()]) list.sort((a, b) => a.t - b.t);
  for (const list of vehicles.values()) {
    let full = null;
    for (const entry of list) {
      if (!entry.sample) { full = entry.record; continue; }
      const p = entry.sample;
      entry.record = {
        type: 0, time: p.time, number: p.number, ipos: p.ipos, angles: p.angles, steering: p.steering, tires: p.tires, throttle: p.throttle,
        bvel: [0, 0, p.speed], rates: [0, 0, 0], course: full?.course ?? 0, damageCode: full?.damageCode ?? 0, gear: full?.gear ?? 0,
      };
    }
  }
  return { vehicles, objects };
}

/** The two samples around `t` in a sorted timeline, the way between them, and their neighbours (`before`, `after`). */
function between(list, t) {
  if (t <= list[0].t) return { a: list[0], b: list[0], k: 0, before: list[0], after: list[0] };
  if (t >= list.at(-1).t) return { a: list.at(-1), b: list.at(-1), k: 0, before: list.at(-1), after: list.at(-1) };
  let lo = 0, hi = list.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (list[mid].t <= t) lo = mid; else hi = mid; }
  return { a: list[lo], b: list[hi], k: (t - list[lo].t) / (list[hi].t - list[lo].t), before: list[Math.max(0, lo - 1)], after: list[Math.min(list.length - 1, hi + 1)] };
}

/**
 * The curve from `p1` (at `t1`) to `p2` (at `t2`) at the share `k`, a cubic Hermite whose slope at each end is taken
 * from the neighbours either side (`p0` at `t0`, `p3` at `t3`): Catmull-Rom for unevenly spaced frames. At an end of the
 * recording (a neighbour that is the point itself) the slope is the straight line's, so two frames give a straight line.
 */
export function curve(p0, t0, p1, t1, p2, t2, p3, t3, k) {
  const h = t2 - t1;
  if (!(h > 0)) return p1;
  const m1 = t2 > t0 ? (p2 - p0) / (t2 - t0) : (p2 - p1) / h;
  const m2 = t3 > t1 ? (p3 - p1) / (t3 - t1) : (p2 - p1) / h;
  const k2 = k * k, k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * p1 + (k3 - 2 * k2 + k) * h * m1 + (-2 * k3 + 3 * k2) * p2 + (k3 - k2) * h * m2;
}
/** The short way from `ref` to `a`: `a` moved by whole turns to lie within half a turn of `ref`. */
const nearAngle = (a, ref) => ref + ((((a - ref) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);

/**
 * Playback of a parsed replay. `duration` is its length in seconds. `at(t)` gives the trucks' poses
 * (the shape `render/truck-object.js` takes, the axles at `restTravel`), their damage codes, and the
 * poses of the objects that have moved by then.
 */
export function createPlayback(replay, { restTravel = [-4, -4] } = {}) {
  const { vehicles, objects } = timelines(replay);
  const count = Math.max(replay.vehicles.length, vehicles.size ? Math.max(...vehicles.keys()) + 1 : 0);
  const last = [...vehicles.values(), ...objects.values()].reduce((m, list) => Math.max(m, list.at(-1).t), 0);
  const matrix = new Array(9).fill(0);
  const pose = (r) => {
    mtm2Sim.eulerToMatrix(r.angles[0], r.angles[1], r.angles[2], matrix);
    return { matrix: [...matrix], euler: [...r.angles] };
  };
  return {
    duration: last,
    vehicleCount: count,
    at(t) {
      const trucks = [], damage = [];
      for (let i = 0; i < count; i++) {
        const list = vehicles.get(i);
        if (!list) { trucks.push(null); damage.push(0); continue; }
        const { a, b, k, before, after } = between(list, t);
        const ra = a.record, rb = b.record, r0 = before.record, r3 = after.record;
        // Either side of the world's seam two frames are a world apart: each is taken as the copy beside the later one.
        const p0 = nearestCopy(r0.ipos, rb.ipos), p1 = nearestCopy(ra.ipos, rb.ipos), p3 = nearestCopy(r3.ipos, rb.ipos);
        const pos = [0, 1, 2].map((n) => curve(p0[n], before.t, p1[n], a.t, rb.ipos[n], b.t, p3[n], after.t, k));
        // Angles the same way, each frame turned to lie the short way round from the next.
        const angles = [0, 1, 2].map((n) => {
          const a1 = nearAngle(ra.angles[n], rb.angles[n]);
          return curve(nearAngle(r0.angles[n], a1), before.t, a1, a.t, rb.angles[n], b.t, nearAngle(r3.angles[n], rb.angles[n]), after.t, k);
        });
        mtm2Sim.eulerToMatrix(angles[0], angles[1], angles[2], matrix);
        // The wheels turn the short way between frames (the simulation keeps their angles within half a turn).
        const tires = (ra.tires ?? [0, 0, 0, 0]).map((v, n) => ({ angle: lerpAngle(v, rb.tires?.[n] ?? v, k), onGround: true }));
        trucks.push({
          pos, matrix: [...matrix], euler: angles,
          tires, steer: lerp(ra.steering?.[0] ?? 0, rb.steering?.[0] ?? 0, k), rearSteer: lerp(ra.steering?.[1] ?? 0, rb.steering?.[1] ?? 0, k),
          axles: [{ articulation: 0, travel: restTravel[0] }, { articulation: 0, travel: restTravel[1] }],
          gear: ra.gear ?? 0, course: ra.course ?? 0, speed: Math.hypot(...lerpVec(ra.bvel, rb.bvel, k)), throttle: lerp(ra.throttle ?? 0, rb.throttle ?? 0, k),
        });
        damage.push(ra.damageCode ?? 0);
      }
      const moved = [];
      for (const [number, list] of objects) {
        if (t < list[0].t) continue;
        const { a, b, k } = between(list, t);
        // An object that stopped and was hit again much later waits, then moves over the last frame.
        const gap = b.t - a.t > FRAME_SECONDS * 1.5;
        const kk = gap ? Math.max(0, 1 - (b.t - t) / FRAME_SECONDS) : k;
        const angles = [0, 1, 2].map((n) => lerpAngle(a.record.angles[n], b.record.angles[n], kk));
        mtm2Sim.eulerToMatrix(angles[0], angles[1], angles[2], matrix);
        moved.push({ sitIndex: number, pos: lerpVec(nearestCopy(a.record.ipos, b.record.ipos), b.record.ipos, kk), matrix: [...matrix] });
      }
      return { trucks, damage, objects: moved };
    },
  };
}

/** The playback speeds the VCR steps through: slow, normal, then fast, forward and back. */
export const RATES = Object.freeze([0.25, 0.5, 1, 2, 4, 8]);
/** A damage the replay shows is pushed in this many times when it appears (the game pushes on every contact step). */
export const DENT_STEPS = 6;

/** The zones and levels in a damage code (two bits a zone, zones 1 to 12) as `[zone, level]` pairs. */
export function damageZones(code) {
  const out = [];
  for (let zone = 1; zone <= mtm2Sim.DAMAGE_ZONES; zone++) {
    const level = mtm2Sim.zoneLevel(code, zone);
    if (level > 0) out.push([zone, level]);
  }
  return out;
}

/** The track path a replay's `demoLevel` names. */
export const levelPath = (level) => `WORLD\\${String(level).split(/[\\/]/).pop().toUpperCase()}`;
