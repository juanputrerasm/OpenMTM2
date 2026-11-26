/*
  Community Patch 4's remote-truck playback and hit rules (src/net/cp4-sync.js; docs/CP4_EXE_ANALYSIS.md 18.2, 18.3,
  read from beta 0.54): the clock offset, the 97th-percentile delay, the older poses, the sampler's limits, the fading
  correction, the pin, the hit check, the caps and the budget.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { T, createCp4Sync, feedHit, hitHistory, judgeHit } from "../src/net/cp4-sync.js";

const pose = (x) => ({ pos: [x, 0, 0], euler: [0, 0, 0] });
/** Packets of a truck moving at 50 ft/s along x, tick k at k x T, arriving `late(k)` after the sender's time. */
function feed(sync, ticks, late = () => 0.03, origin = 100) {
  for (const k of ticks) sync.receive({ truck: 1, sender: 7, tick: k, ...pose(50 * k * T) }, origin + k * T + late(k));
}

test("the clock offset: taken on the first packet, followed slowly upward and quickly downward, retaken past 1 s", () => {
  const sync = createCp4Sync();
  sync.receive({ truck: 1, sender: 7, tick: 10, ...pose(0) }, 100);
  const first = sync.senderState(7).offset;
  assert.ok(Math.abs(first - (100 - 10 * T)) < 1e-9);
  // 0.1 s later than expected: the offset moves by 2% of it.
  sync.receive({ truck: 1, sender: 7, tick: 11, ...pose(1) }, 100 + T + 0.1);
  assert.ok(Math.abs(sync.senderState(7).offset - (first + 0.002)) < 1e-9);
  // Earlier than expected: 30% of it.
  const o = sync.senderState(7).offset;
  sync.receive({ truck: 1, sender: 7, tick: 12, ...pose(2) }, o + 12 * T - 0.05);
  assert.ok(Math.abs(sync.senderState(7).offset - (o - 0.015)) < 1e-9);
  // More than a second off: a resync, the buffer cleared.
  sync.receive({ truck: 1, sender: 7, tick: 13, ...pose(3) }, o + 13 * T + 5);
  assert.deepEqual(sync.span(1), [13 * T, 13 * T]);
});

test("the delay: the 97th percentile of the lateness + 40 ms + 10 ms, held to 0.05 to 0.3 s; 0.1 s with fewer than 8", () => {
  const sync = createCp4Sync();
  feed(sync, [1, 2, 3, 4, 5]);
  assert.equal(sync.senderState(7).delay, 0.1);
  // Steady arrivals: the lateness is 0 once the offset follows them, so one tick and the margin, 0.05 s.
  feed(sync, Array.from({ length: 40 }, (_, i) => i + 6));
  assert.ok(Math.abs(sync.senderState(7).delay - 0.05) < 1e-6);
  // One packet in ten 150 ms late: the 97th percentile is a late one.
  const jittery = createCp4Sync();
  feed(jittery, Array.from({ length: 60 }, (_, i) => i + 1), (k) => (k % 10 === 0 ? 0.18 : 0.03));
  const d = jittery.senderState(7).delay;
  assert.ok(d > 0.15 && d <= 0.3, `${d}`);
  // InterpDelayMs fixes it.
  const fixed = createCp4Sync({ interpDelayMs: 200 });
  feed(fixed, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(fixed.senderState(7).delay, 0.2);
});

test("the playback clock is slewed by at most 10% of the frame; the collision lead follows the applied delay", () => {
  const sync = createCp4Sync();
  feed(sync, Array.from({ length: 30 }, (_, i) => i + 1));
  let now = 100 + 30 * T + 0.03;
  sync.frame(now, 0.016);
  const p0 = sync.playback(1, now);
  now += 0.016;
  sync.frame(now, 0.016);
  const step = sync.playback(1, now) - p0;
  assert.ok(step >= 0.016 * 0.9 - 1e-9 && step <= 0.016 * 1.1 + 1e-9);
  for (let i = 0; i < 400; i++) { now += 0.016; sync.frame(now, 0.016); }
  assert.ok(Math.abs(sync.lead(1) - sync.appliedDelay(1, now)) < 0.01, "the lead reaches the delay");
  assert.ok(sync.lead(1) <= 0.25);
});

test("older poses fill a lost tick; a repeated tick is dropped; an older one is put in order", () => {
  const sync = createCp4Sync();
  feed(sync, [1, 2]);
  // Tick 3 lost: tick 4 carries it as an older pose of age 1.
  sync.receive({ truck: 1, sender: 7, tick: 4, ...pose(4), poses: [{ age: 1, pos: [3, 0, 0], euler: [0, 0, 0] }] }, 100 + 4 * T + 0.03);
  assert.deepEqual(sync.at(1, 3 * T).pos, [3, 0, 0]);
  assert.equal(sync.receive({ truck: 1, sender: 7, tick: 4, ...pose(9) }, 100 + 4 * T + 0.05), "stale");
  assert.equal(sync.receive({ truck: 1, sender: 7, tick: 3, ...pose(3) }, 100 + 4 * T + 0.06), "stale", "already held");
});

test("the sampler: linear inside, the oldest held before, at most 0.2 s of extrapolation after", () => {
  const sync = createCp4Sync();
  feed(sync, [1, 2]);
  const v = 50;
  assert.ok(Math.abs(sync.at(1, 1.5 * T).pos[0] - v * 1.5 * T) < 1e-9);
  assert.equal(sync.at(1, 0).pos[0], v * T);
  assert.ok(Math.abs(sync.at(1, 2 * T + 0.1).pos[0] - (v * 2 * T + v * 0.1)) < 1e-6);
  assert.ok(Math.abs(sync.at(1, 2 * T + 5).pos[0] - (v * 2 * T + v * 0.2)) < 1e-6, "capped at 0.2 s");
});

test("a jump past half the world clears the buffer; the fading correction is gone after 0.15 s", () => {
  const sync = createCp4Sync({ worldFt: 8192 });
  feed(sync, [1, 2, 3]);
  sync.receive({ truck: 1, sender: 7, tick: 4, pos: [5000, 0, 0], euler: [0, 0, 0] }, 100 + 4 * T + 0.03);
  assert.deepEqual(sync.span(1), [4 * T, 4 * T]);
  // A correction: while the drawn pose is extrapolated, a packet 1 ft off the line does not jump it; 0.15 s later the
  // pose is the buffer's own.
  const c = createCp4Sync();
  feed(c, Array.from({ length: 20 }, (_, i) => i + 1));
  let now = 100 + 20 * T + 0.03;
  for (let i = 0; i < 12; i++) { now += 0.01; c.frame(now, 0.01); }
  const before = c.drawn(1, now).pos[0];
  c.receive({ truck: 1, sender: 7, tick: 21, pos: [50 * 21 * T + 1, 0, 0], euler: [0, 0, 0] }, now);
  assert.ok(Math.abs(c.drawn(1, now).pos[0] - before) < 1e-6, "no jump at once");
  c.frame(now + 0.2, 0.2);
  const raw = c.at(1, c.playback(1, now + 0.2)).pos[0];
  assert.ok(Math.abs(c.drawn(1, now + 0.2).pos[0] - raw) < 1e-6, "faded out");
});

test("the pin's velocity: the move over one tick x 25.0042, none past 300 ft/s", () => {
  const sync = createCp4Sync();
  feed(sync, Array.from({ length: 10 }, (_, i) => i + 1));
  const now = 100 + 10 * T + 0.03;
  sync.frame(now, 0.016);
  const p = sync.pin(1, now);
  assert.ok(Math.abs(p.pinVel[0] - 50 * T * 25.0042) < 1e-6);
  const fast = createCp4Sync();
  for (let k = 1; k <= 12; k++) fast.receive({ truck: 1, sender: 7, tick: k, pos: [400 * k * T, 0, 0], euler: [0, 0, 0] }, 100 + k * T);
  fast.frame(100 + 12 * T, 0.016);
  assert.equal(fast.pin(1, 100 + 12 * T).pinVel, null, "400 ft/s");
});

test("the hit check: gaps over 8 ft rejected, 3 to 8 ft scaled, the closing-speed cap, always 22 ft/s at most", () => {
  const budget = () => ({ used: 0, at: null });
  const base = { linear: [0, 0, 40 * 100], angular: [0, 0, 0], mass: 100, inertia: [5000, 5000, 7500], check: true, now: 10 };
  assert.equal(judgeHit({ ...base, history: { minGap: 9, closing: 30 }, budget: budget() }), null);
  const scaled = judgeHit({ ...base, linear: [0, 0, 10 * 100], history: { minGap: 5.5, closing: 30 }, budget: budget() });
  assert.ok(Math.abs(scaled.dv[2] - 5) < 1e-9, "half at 5.5 ft");
  const capped = judgeHit({ ...base, linear: [0, 0, 20 * 100], history: { minGap: 0, closing: 4 }, budget: budget() });
  assert.ok(Math.abs(capped.dv[2] - 15) < 1e-9, "max(15, 1.25 x 4)");
  const clamped = judgeHit({ ...base, history: null, budget: budget() });
  assert.ok(Math.abs(clamped.dv[2] - 22) < 1e-9, "no history: accepted, the 22 ft/s clamp still");
});

test("the budget: 30 ft/s, drained 25 a second, pitch and roll cost 4 times; spent, a hit is dropped", () => {
  const b = { used: 0, at: null };
  const hit = { linear: [0, 0, 2200], angular: [5000, 0, 0], mass: 100, inertia: [5000, 5000, 7500], history: null, check: true };
  const first = judgeHit({ ...hit, budget: b, now: 0 });
  assert.ok(Math.abs(Math.hypot(...first.dv) - 22) < 1e-9);
  assert.ok(Math.abs(b.used - 26) < 1e-9, "22 + 4 x 1 rad/s");
  const second = judgeHit({ ...hit, budget: b, now: 0 });
  assert.ok(Math.hypot(...second.dv) < 22 && b.used <= 30 + 1e-9, "scaled to what is left");
  assert.equal(judgeHit({ ...hit, budget: b, now: 0 }), null);
  assert.ok(judgeHit({ ...hit, budget: b, now: 1 }), "drained after a second");
  // Yaw is held to 2 rad/s, pitch and roll together to 1.
  const spin = judgeHit({ linear: [0, 0, 0], angular: [0, 7500 * 9, 0], mass: 100, inertia: [5000, 5000, 7500], history: null, check: true, budget: { used: 0, at: null }, now: 0 });
  assert.equal(spin.w[1], 2);
});

test("a received hit is fed in over 0.12 s; the hit history keeps the closest gap and the hardest closing", () => {
  const pending = { dv: [12, 0, 0], w: [0, 0.6, 0] };
  const a = feedHit(pending, 0.06);
  assert.ok(Math.abs(a.dv[0] - 6) < 1e-9);
  const b = feedHit(pending, 0.2);
  assert.ok(b.done);
  const ours = [{ at: 9.9, pos: [0, 0, 0], vel: [0, 0, 0] }, { at: 10, pos: [0, 0, 0], vel: [0, 0, 0] }];
  const attacker = (time) => ({ pos: [12 - (10 - time) * 0, 0, 0], vel: [-20, 0, 0] });
  const h = hitHistory({ ours, attacker, span: [9, 10], now: 10, drawnTime: 10, pinTime: 10.05, delay: 0.1, lead: 0.05, radii: [4, 4] });
  assert.ok(Math.abs(h.minGap - 4) < 1e-9);
  assert.ok(Math.abs(h.closing - 20) < 1e-9);
  assert.equal(hitHistory({ ours: [], attacker, now: 10, drawnTime: 10, pinTime: 10, delay: 0, lead: 0, radii: [4, 4] }), null);
});
