/*
  Instant replay (MONSTER_EXE_ANALYSIS.md section 11, Demo.c): the recorder that runs through a
  race and the playback that interpolates it. The file format (`.rpl`) is OpenPhotex's
  `parseMtmReplay` and `writeMtmReplay`.

  The game records every 0x4000 ticks (a quarter second) into a ring of 2240 records: a record
  for each truck, and one for each object that moved since the last frame (the trains, which
  always move, are in every frame). Playback shows the state between two frames by interpolating.
  Pure, so it runs under Node.
*/
import { REPLAY_FRAME_TICKS, REPLAY_RING_RECORDS, REPLAY_TICKS_PER_SECOND, mtm2Sim } from "../vendor/openphotex/index.js";

export const FRAME_SECONDS = REPLAY_FRAME_TICKS / REPLAY_TICKS_PER_SECOND;

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
export function createReplayRecorder({ level, weather = 0, detailLevel = 2, vehicles, originals = [] }) {
  const frames = [];
  const moved = new Map();
  let next = REPLAY_FRAME_TICKS, records = 0;
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
      next = ticks - (ticks % REPLAY_FRAME_TICKS) + REPLAY_FRAME_TICKS;
      const frame = { time: ticks, records: [] };
      poses.forEach((c, i) => frame.records.push(vehicleRecord(ticks, i, c, damage(i))));
      for (const b of moved.values()) {
        frame.records.push({ type: 1, time: ticks, ipos: [...b.pos], bvel: [0, 0, 0], angles: [...(b.euler ?? [0, 0, 0])], rates: [0, 0, 0], number: b.sitIndex });
      }
      moved.clear();
      frames.push(frame);
      records += frame.records.length;
      // The ring holds 2240 records: the oldest frames go first.
      while (records > REPLAY_RING_RECORDS && frames.length > 1) records -= frames.shift().records.length;
    },
    build() {
      return { level, weather, detailLevel, vehicles, objects: originals, records: frames.flatMap((f) => f.records) };
    },
  };
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerpVec = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
/** The shortest way round from `a` to `b`. */
const lerpAngle = (a, b, k) => a + ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * k;

/** `{ t, record }` lists by vehicle number and by object number, from a parsed replay. */
function timelines(replay) {
  const vehicles = new Map(), objects = new Map();
  const first = replay.records.length ? Math.min(...replay.records.map((r) => r.time)) : 0;
  for (const record of replay.records) {
    const table = record.type === 0 ? vehicles : objects;
    if (!table.has(record.number)) table.set(record.number, []);
    table.get(record.number).push({ t: (record.time - first) / REPLAY_TICKS_PER_SECOND, record });
  }
  for (const list of [...vehicles.values(), ...objects.values()]) list.sort((a, b) => a.t - b.t);
  return { vehicles, objects };
}

/** The two samples around `t` in a sorted timeline and the way between them. */
function between(list, t) {
  if (t <= list[0].t) return { a: list[0], b: list[0], k: 0 };
  if (t >= list.at(-1).t) return { a: list.at(-1), b: list.at(-1), k: 0 };
  let lo = 0, hi = list.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (list[mid].t <= t) lo = mid; else hi = mid; }
  return { a: list[lo], b: list[hi], k: (t - list[lo].t) / (list[hi].t - list[lo].t) };
}

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
        const { a, b, k } = between(list, t);
        const ra = a.record, rb = b.record;
        const angles = [lerpAngle(ra.angles[0], rb.angles[0], k), lerpAngle(ra.angles[1], rb.angles[1], k), lerpAngle(ra.angles[2], rb.angles[2], k)];
        mtm2Sim.eulerToMatrix(angles[0], angles[1], angles[2], matrix);
        const tires = (ra.tires ?? [0, 0, 0, 0]).map((v, n) => ({ angle: lerp(v, rb.tires?.[n] ?? v, k), onGround: true }));
        trucks.push({
          pos: lerpVec(ra.ipos, rb.ipos, k), matrix: [...matrix], euler: angles,
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
        moved.push({ sitIndex: number, pos: lerpVec(a.record.ipos, b.record.ipos, kk), matrix: [...matrix] });
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
