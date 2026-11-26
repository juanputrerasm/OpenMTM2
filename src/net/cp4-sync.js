/*
  Community Patch 4's remote-truck playback (docs/CP4_EXE_ANALYSIS.md 18.2, read from beta 0.54; the CP4 developer
  published no source code), for OpenMTM2's trucks in a CP4 room: a buffer of each remote truck's poses by its
  sender's tick, a clock offset and a playback clock per sender, the 97th-percentile delay, the collision lead, the
  sampler, and the fading correction. Pure: the worker hands it the clock (`now`, seconds) and the packets.

  Times: `now` is this machine's clock. A sample's time is the sender's, its tick x T. The playback clock and the pin
  time are in sender time too.
*/

/** One tick: 0xa3d / 65536 s, 25 a second. */
export const T = 0xa3d / 65536;
export const BUFFER = 32;
const LATE_RING = 128;
const RESYNC_S = 1.0;
const GAP_FLUSH_S = 2.0;
const SAME_S = 0.001;
const INSERT_EPS_S = 0.0005;
const REBASE_S = 1.0, REBASE_MIN = 8;
const WINDOW_S = 2.5, P97 = 0.97, ONE_TICK_S = 0.04, MARGIN_S = 0.010, DELAY_MIN_S = 0.0499933, DELAY_MAX_S = 0.3, DELAY_FEW_S = 0.1;
const SNAP_CLOCK_S = 0.5, SLEW = 0.1;
const LEAD_MAX_S = 0.25;
const EXTRAP_MAX_S = 0.2, ANGLE_EXTRAP_GAP_S = 0.02;
const CORR_MOVE_FT = 0.01, CORR_TURN = 0.001, CORR_MAX_FT = 20, CORR_FADE_S = 0.15;
/** A computer truck with no packet for this long is left to this machine's own driving. */
export const STALE_S = 0.5;
/** The pin's body velocity: the move over one tick x 25.0042, used when under 20 ft and 300 ft/s. */
const PIN_RATE = 25.0042, PIN_MOVE_FT = 20, PIN_SPEED = 300;

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** The shorter way round from a to b, as a fraction f of the way. */
const lerpAngle = (a, b, f) => a + wrapPi(b - a) * f;

/**
 * @param {{ worldFt?: number, interpDelayMs?: number, collideLeadMs?: number }} options `worldFt` the world's width
 *   (a jump over half of it clears a buffer); `interpDelayMs` CP4's InterpDelayMs (0 automatic); `collideLeadMs` its
 *   NetCollideLeadMs (0 automatic).
 */
export function createCp4Sync({ worldFt = 8192, interpDelayMs = 0, collideLeadMs = 0 } = {}) {
  const half = worldFt / 2;
  const senders = new Map();
  const trucks = new Map();

  function senderOf(id) {
    let s = senders.get(id);
    if (!s) senders.set(id, (s = { offset: null, late: [], delay: DELAY_FEW_S, clock: null, lead: 0, lastTick: null, trucks: new Set() }));
    return s;
  }
  function truckOf(i) {
    let t = trucks.get(i);
    if (!t) trucks.set(i, (t = { buffer: [], sender: null, lastAt: -Infinity, drawn: null, led: null }));
    return t;
  }
  const far = (a, b) => Math.abs(a.pos[0] - b.pos[0]) > half || Math.abs(a.pos[2] - b.pos[2]) > half;

  /** A resync: the sender's offset taken again, its trucks' buffers and its lateness cleared. */
  function resync(s, offset) {
    s.offset = offset;
    s.late.length = 0;
    s.clock = null;
    s.lastTick = null;
    for (const i of s.trucks) { const t = trucks.get(i); if (t) { t.buffer.length = 0; t.drawn = t.led = null; } }
  }

  /** Append the newest sample (the gap rules), or insert an older one in order; returns whether it was kept. */
  function append(t, sample) {
    const b = t.buffer, newest = b[b.length - 1];
    if (newest && (far(newest, sample) || sample.time - newest.time > GAP_FLUSH_S)) b.length = 0;
    const last = b[b.length - 1];
    if (last && sample.time >= last.time) {
      if (sample.time - last.time < SAME_S) b[b.length - 1] = sample;
      else b.push(sample);
    } else if (!last) b.push(sample);
    else return insert(t, sample);
    if (b.length > BUFFER) b.shift();
    return true;
  }
  function insert(t, sample) {
    const b = t.buffer;
    if (!b.length || b.some((x) => x.tick === sample.tick)) return false;
    if (sample.time <= b[0].time + INSERT_EPS_S || sample.time > b[b.length - 1].time + GAP_FLUSH_S) return false;
    let k = b.findIndex((x) => x.time > sample.time);
    if (k < 0) k = b.length;
    const before = b[k - 1], after = b[k];
    if ((before && Math.abs(sample.time - before.time) < INSERT_EPS_S) || (after && Math.abs(after.time - sample.time) < INSERT_EPS_S)) return false;
    if ((before && far(before, sample)) || (after && far(after, sample))) return false;
    b.splice(k, 0, sample);
    if (b.length > BUFFER) b.shift();
    return true;
  }

  /** The pose at sender time `time` from a buffer: interpolated, held before the oldest, extrapolated after the newest. */
  function sample(buffer, time) {
    const n = buffer.length;
    if (!n) return null;
    const first = buffer[0], last = buffer[n - 1];
    if (time <= first.time) return { pos: [...first.pos], euler: [...first.euler], vel: n > 1 ? velocity(first, buffer[1]) : [0, 0, 0] };
    if (time >= last.time) {
      const prev = buffer[n - 2], gap = prev ? last.time - prev.time : 0;
      const v = prev && gap > SAME_S ? velocity(prev, last) : [0, 0, 0];
      const e = Math.min(time - last.time, EXTRAP_MAX_S);
      const euler = [...last.euler];
      if (prev && gap >= ANGLE_EXTRAP_GAP_S) for (let k = 0; k < 3; k++) euler[k] = last.euler[k] + wrapPi(last.euler[k] - prev.euler[k]) / gap * e;
      euler[0] = wrapPi(euler[0]); euler[1] = wrapPi(euler[1]);
      return { pos: [0, 1, 2].map((k) => last.pos[k] + v[k] * e), euler, vel: v };
    }
    let k = 1;
    while (buffer[k].time < time) k++;
    const a = buffer[k - 1], b = buffer[k], span = b.time - a.time;
    const f = span <= 0.0001 ? 1 : (time - a.time) / span;
    return {
      pos: [0, 1, 2].map((j) => a.pos[j] + (b.pos[j] - a.pos[j]) * f),
      euler: [0, 1, 2].map((j) => lerpAngle(a.euler[j], b.euler[j], f)),
      vel: velocity(a, b),
    };
  }
  const velocity = (a, b) => { const dt = b.time - a.time; return dt > 0 ? [0, 1, 2].map((k) => (b.pos[k] - a.pos[k]) / dt) : [0, 0, 0]; };

  /** A slot's pose (drawn or led) with its fading correction at `now`. */
  function corrected(t, slot, time, now) {
    const raw = sample(t.buffer, time);
    const c = t[slot];
    if (!raw || !c) return raw;
    const w = Math.max(0, Math.min(1, 1 - (now - c.at) / CORR_FADE_S));
    if (w <= 0) return raw;
    return { ...raw, pos: raw.pos.map((v, k) => v + c.pos[k] * w), euler: raw.euler.map((v, k) => v + c.euler[k] * w) };
  }
  /** After a packet: each slot's jump between the pose it showed and the new raw one, kept to fade out. */
  function correct(t, slot, time, before, now) {
    const after = sample(t.buffer, time);
    if (!before || !after) return;
    const dp = before.pos.map((v, k) => v - after.pos[k]), de = before.euler.map((v, k) => wrapPi(v - after.euler[k]));
    const move = Math.hypot(dp[0], dp[1], dp[2]), turn = Math.abs(de[0]) + Math.abs(de[1]) + Math.abs(de[2]);
    if (move < CORR_MOVE_FT && turn < CORR_TURN) return;
    t[slot] = move <= CORR_MAX_FT ? { pos: dp, euler: de, at: now } : null;
  }

  return {
    /**
     * One truck state packet. `truck` the local index, `sender` who sent it, `tick` the sender's tick (0: none),
     * `pos` and `euler` the packet's pose, `poses` its older poses `[{ age, pos, euler }]`, `at` the arrival time.
     * Returns the packet's classification: "ok", "reordered", "stale" (dropped).
     */
    receive({ truck, sender, tick = 0, pos, euler, poses = [] }, at) {
      const s = senderOf(sender), t = truckOf(truck);
      s.trucks.add(truck);
      t.sender = sender;
      t.lastAt = at;
      const drawnTime = this.playback(truck, at), ledTime = drawnTime + s.lead;
      const drawnBefore = corrected(t, "drawn", drawnTime, at), ledBefore = corrected(t, "led", ledTime, at);
      let time;
      if (tick) {
        const ts = tick * T;
        const err = s.offset === null ? Infinity : (at - ts) - s.offset;
        if (s.offset === null || Math.abs(err) > RESYNC_S) resync(s, at - ts);
        else {
          s.offset += err >= 0 ? 0.02 * err : 0.3 * err;
          s.late.push({ err: (at - ts) - s.offset, at });
          if (s.late.length > LATE_RING) s.late.shift();
          retarget(s, at);
        }
        time = ts;
      } else time = at - (s.offset ?? at);
      const last = t.buffer[t.buffer.length - 1];
      if (tick && last && last.tick === tick) return "stale";
      // The older poses fill a lost tick: theta and phi wrapped, psi as it is; no velocity, no controls.
      if (tick && s.offset !== null && t.buffer.length && poses.length <= 2) {
        for (let j = poses.length - 1; j >= 0; j--) {
          const p = poses[j];
          if (!p || !p.age || p.age >= tick) continue;
          insert(t, { time: (tick - p.age) * T, tick: tick - p.age, pos: [...p.pos], euler: [wrapPi(p.euler[0]), wrapPi(p.euler[1]), p.euler[2]] });
        }
      }
      const kept = append(t, { time, tick, pos: [...pos], euler: [...euler] });
      if (!kept) return "stale";
      correct(t, "drawn", drawnTime, drawnBefore, at);
      correct(t, "led", ledTime, ledBefore, at);
      return last && time < last.time ? "reordered" : "ok";
    },

    /** Each frame: every sender's playback clock and collision lead, `dt` the frame's seconds. */
    frame(now, dt) {
      for (const s of senders.values()) {
        if (s.offset === null) continue;
        const want = (now - s.offset) - s.delay;
        if (s.clock === null || Math.abs(want - s.clock) > SNAP_CLOCK_S) s.clock = want;
        else s.clock += dt + Math.max(-SLEW * dt, Math.min(SLEW * dt, want - (s.clock + dt)));
        const applied = (now - s.offset) - s.clock;
        const target = Math.max(0, Math.min(LEAD_MAX_S, collideLeadMs > 0 ? Math.min(collideLeadMs / 1000, applied) : applied));
        s.lead += Math.max(-SLEW * dt, Math.min(SLEW * dt, target - s.lead));
      }
    },

    /** The sender time a truck is drawn at. */
    playback(truck, now) {
      const t = trucks.get(truck), s = t && senders.get(t.sender);
      if (!s || s.offset === null) return now;
      return s.clock ?? (now - s.offset) - DELAY_FEW_S;
    },
    /** The sender's current collision lead, seconds. */
    lead(truck) {
      const t = trucks.get(truck), s = t && senders.get(t.sender);
      return s?.lead ?? 0;
    },
    /** The delay the sender's trucks are played back with, seconds. */
    appliedDelay(truck, now) {
      const t = trucks.get(truck), s = t && senders.get(t.sender);
      return s && s.offset !== null && s.clock !== null ? (now - s.offset) - s.clock : 0;
    },
    /** Whether a truck has samples to play. */
    has: (truck) => !!trucks.get(truck)?.buffer.length,
    /** Seconds since the truck's last packet. */
    age: (truck, now) => now - (trucks.get(truck)?.lastAt ?? -Infinity),

    /** The pose the picture shows: the playback time, with its correction. */
    drawn(truck, now) {
      const t = trucks.get(truck);
      return t ? corrected(t, "drawn", this.playback(truck, now), now) : null;
    },
    /**
     * The pin before a step: the pose at playback + lead with its correction, and the move over the next tick as a
     * world velocity (`pinVel`, null when over 20 ft or 300 ft/s).
     */
    pin(truck, now) {
      const t = trucks.get(truck);
      if (!t || !t.buffer.length) return null;
      const time = this.playback(truck, now) + this.lead(truck);
      // The tick ahead is corrected too, its weight taken a tick later (as read in the binary).
      const p = corrected(t, "led", time, now), q = corrected(t, "led", time + T, now + T);
      const move = [0, 1, 2].map((k) => q.pos[k] - p.pos[k]);
      const dist = Math.hypot(move[0], move[1], move[2]);
      const v = move.map((x) => x * PIN_RATE);
      return { ...p, pinVel: dist <= PIN_MOVE_FT && Math.hypot(v[0], v[1], v[2]) <= PIN_SPEED ? v : null, time };
    },
    /** The raw pose at a sender time (the hit check's), or null. */
    at(truck, time) {
      const t = trucks.get(truck);
      return t ? sample(t.buffer, time) : null;
    },
    /** The oldest and newest sample times, or null. */
    span(truck) {
      const b = trucks.get(truck)?.buffer;
      return b?.length ? [b[0].time, b[b.length - 1].time] : null;
    },
    /** For tests: a sender's state. */
    senderState: (id) => senders.get(id) ?? null,
  };

  /** The sender's delay target from its lateness ring (the rebase first). */
  function retarget(s, now) {
    const recent = s.late.filter((x) => now - x.at <= REBASE_S);
    if (recent.length >= REBASE_MIN) {
      const least = Math.min(...recent.map((x) => x.err));
      if (least > T) { s.offset += least; for (const x of s.late) x.err -= least; }
    }
    if (interpDelayMs > 0) { s.delay = interpDelayMs / 1000; return; }
    const window = s.late.filter((x) => now - x.at <= WINDOW_S).map((x) => x.err).sort((a, b) => a - b);
    if (window.length < REBASE_MIN) { s.delay = DELAY_FEW_S; return; }
    const p97 = window[Math.max(0, Math.ceil(P97 * window.length) - 1)];
    s.delay = Math.max(DELAY_MIN_S, Math.min(DELAY_MAX_S, p97 + ONE_TICK_S + MARGIN_S));
  }
}

// ---- The hit check and the budget for a received collision (CP4_EXE_ANALYSIS.md 18.3) ----

export const MIRROR_S = 0.30;
export const SEND_GAP_S = 0.4;
export const SEND_MIN_DV = 0.3;
const ACCEPT_FT = 3, REJECT_FT = 8, CAP_MIN = 15, CAP_MAX = 60, CAP_CLOSING = 1.25, CLAMP_DV = 22;
const BUDGET = 30, BUDGET_DRAIN = 25, BUDGET_TILT = 4, TILT_MAX = 1, YAW_MAX = 2, ANGLE_MAX_OFF = 3.5, SPAN_MAX_S = 0.5, WINDOW_EXTRA_S = 0.2;
/** A received hit is fed into the truck over this long. */
export const APPLY_S = 0.12;
const RESIDUE_LIN = 0.05, RESIDUE_ANG = 0.02;

/**
 * The victim's judgement of a received hit. `ours` is the victim's end-of-tick poses `[{ at, pos, vel }]` (world feet,
 * ft/s, `at` this machine's clock), newest last; `attacker(time)` its pose at a sender time; `drawnTime` and `pinTime`
 * the attacker's now; `delay` and `lead` its applied delay and lead; `rtt` its latency in seconds or 0; radii the two
 * trucks'. Returns `{ minGap, closing }`, or null when there is nothing to judge by.
 */
export function hitHistory({ ours, attacker, span: attackerSpan, now, drawnTime, pinTime, delay, lead, rtt = 0, radii, worldFt = 8192 }) {
  const window = Math.max(0, delay) + WINDOW_EXTRA_S;
  const span = Math.min(SPAN_MAX_S, Math.max(0, rtt, 2 * lead));
  const n = Math.ceil((span + T) / T);
  const wrap = (d) => d - Math.round(d / worldFt) * worldFt;
  let minGap = 999, closing = -Infinity, judged = false;
  for (const mine of ours) {
    const a = now - mine.at;
    if (a > window) continue;
    for (let j = 0; j <= n; j++) {
      const b = Math.max(0, a - j * T);
      for (const base of [drawnTime, pinTime]) {
        let time = base - b;
        if (attackerSpan) time = Math.max(attackerSpan[0], Math.min(attackerSpan[1] + EXTRAP_MAX_S, time));
        const theirs = attacker(time);
        if (!theirs) continue;
        judged = true;
        const d = [wrap(theirs.pos[0] - mine.pos[0]), theirs.pos[1] - mine.pos[1], wrap(theirs.pos[2] - mine.pos[2])];
        const dist = Math.hypot(d[0], d[1], d[2]);
        minGap = Math.min(minGap, dist - radii[0] - radii[1]);
        if (dist > 0.01) {
          const rel = [0, 1, 2].map((k) => theirs.vel[k] - mine.vel[k]);
          closing = Math.max(closing, -(rel[0] * d[0] + rel[1] * d[1] + rel[2] * d[2]) / dist);
        }
      }
    }
  }
  return judged ? { minGap, closing: Number.isFinite(closing) ? closing : 0 } : null;
}

/**
 * What a received hit becomes: `dv` (body ft/s) and `w` (body rad/s, x y z), after the hit check's scaling and caps
 * and the target's budget (`budget` `{ used, at }`, changed in place). `linear` and `angular` the packet's impulses,
 * `mass` slugs, `inertia` [x, y, z]; `history` from `hitHistory` (null: none to judge by), `check` NetHitCheck.
 * Returns null when the hit is rejected or the budget is spent.
 */
export function judgeHit({ linear, angular, mass, inertia, history, check = true, budget, now }) {
  let dv = linear.map((x) => x / mass);
  let scale = 1;
  const length = (v) => Math.hypot(v[0], v[1], v[2]);
  const limit = (v, most) => { const l = length(v); return l > most ? v.map((x) => x * most / l) : v; };
  if (check && history) {
    if (history.minGap > REJECT_FT) return null;
    if (history.minGap > ACCEPT_FT) scale = (REJECT_FT - history.minGap) / (REJECT_FT - ACCEPT_FT);
    dv = limit(dv.map((x) => x * scale), Math.min(CAP_MAX, Math.max(CAP_MIN, CAP_CLOSING * history.closing)));
  }
  dv = limit(dv, CLAMP_DV);
  let w;
  if (check) {
    w = angular.map((x, k) => (scale * x) / inertia[k]);
    const tilt = Math.hypot(w[0], w[2]);
    if (tilt > TILT_MAX) { w[0] *= TILT_MAX / tilt; w[2] *= TILT_MAX / tilt; }
    w[1] = Math.max(-YAW_MAX, Math.min(YAW_MAX, w[1]));
  } else w = angular.map((x, k) => Math.max(-ANGLE_MAX_OFF, Math.min(ANGLE_MAX_OFF, x / inertia[k])));
  budget.used = Math.max(0, budget.used - BUDGET_DRAIN * Math.max(0, now - (budget.at ?? now)));
  budget.at = now;
  const avail = BUDGET - budget.used;
  if (avail <= 0) return null;
  const cost = check ? BUDGET_TILT * Math.hypot(w[0], w[2]) + length(dv) : length(dv);
  if (cost > avail) {
    const k = avail / cost;
    dv = dv.map((x) => x * k);
    if (check) w = w.map((x) => x * k);
  }
  budget.used += Math.min(cost, avail);
  return { dv, w };
}

/** The share of a pending hit fed in this frame, and whether what is left is small enough to drop. */
export function feedHit(pending, dt) {
  const k = Math.min(1, dt / APPLY_S);
  const dv = pending.dv.map((x) => x * k), w = pending.w.map((x) => x * k);
  for (let j = 0; j < 3; j++) { pending.dv[j] -= dv[j]; pending.w[j] -= w[j]; }
  const done = Math.abs(pending.dv[0]) + Math.abs(pending.dv[1]) + Math.abs(pending.dv[2]) < RESIDUE_LIN
    && Math.abs(pending.w[0]) + Math.abs(pending.w[1]) + Math.abs(pending.w[2]) < RESIDUE_ANG;
  return { dv, w, done };
}
