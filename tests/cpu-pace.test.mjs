/*
  Computer trucks learning the track (game/cpu-pace.js, an addition): the pace a truck drives each course segment at
  falls where it slides, spins or misses a gate, comes back where it drives cleanly, and reaches the autopilot's
  target speed alone. Pure rules only.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  CPU_PACE, cpuPaceFactor, cpuPaceObserve, createCpuPace, isSliding, isSpun, segmentCurvature, segmentHeading,
} from "../src/game/cpu-pace.js";

/** A course of straights and arcs by `ctype` (1 straight, 2 arc), as the session builds it. */
const course = [
  { ctype: 1, start: [0, 0, 0], end: [0, 0, 300] },
  { ctype: 2, centre: [100, 0, 300], entryAngle: -Math.PI / 2, exitAngle: 0, radius: 100 },
  { ctype: 1, start: [100, 0, 400], end: [400, 0, 400] },
  { ctype: 2, centre: [400, 0, 300], entryAngle: 0, exitAngle: -Math.PI / 2, radius: 100 },
];

test("a slide lowers the segment's pace by the drop, never below the floor; a spin or a miss also the segment before", () => {
  const m = createCpuPace(course.length);
  assert.ok(cpuPaceObserve(m, { segment: 1, slide: true }));
  assert.ok(Math.abs(m.factors[1] - CPU_PACE.drop) < 1e-12);
  assert.equal(m.factors[0], 1, "a slide marks its own segment only");
  for (let k = 0; k < 40; k++) cpuPaceObserve(m, { segment: 1, slide: true });
  assert.ok(Math.abs(m.factors[1] - CPU_PACE.floor) < 1e-12, `floor ${m.factors[1]}`);
  const n = createCpuPace(course.length);
  cpuPaceObserve(n, { segment: 2, spin: true });
  assert.ok(n.factors[2] < 1 && n.factors[1] < 1, "a spin marks the arc before the straight too");
  const o = createCpuPace(course.length);
  cpuPaceObserve(o, { segment: 0, missed: true });
  assert.ok(o.factors[0] < 1 && o.factors[3] < 1, "a miss on the first segment marks the last one before it");
  // The miss is an edge: the race rules hold the flag until the gate is passed.
  assert.equal(cpuPaceObserve(o, { segment: 0, missed: true }), false);
});

test("leaving a segment cleanly gives a little pace back, up to 1; a bad segment gives nothing back", () => {
  const m = createCpuPace(course.length);
  cpuPaceObserve(m, { segment: 1, slide: true });
  cpuPaceObserve(m, { segment: 1, slide: true });
  const after = m.factors[1];
  cpuPaceObserve(m, { segment: 2 });
  assert.equal(m.factors[1], after, "left while bad: no pace back");
  cpuPaceObserve(m, { segment: 1 });
  cpuPaceObserve(m, { segment: 2 });
  assert.ok(Math.abs(m.factors[1] - (after + CPU_PACE.gain)) < 1e-12, "a clean pass gives the gain back");
  for (let k = 0; k < 40; k++) { cpuPaceObserve(m, { segment: 1 }); cpuPaceObserve(m, { segment: 2 }); }
  assert.equal(m.factors[1], 1, "never over 1");
});

test("the factor: an arc's own, a straight's the smaller of its own and the next arc's; 1 off the course", () => {
  const m = createCpuPace(course.length);
  m.factors[1] = 0.8;
  assert.equal(cpuPaceFactor(m, 1, course), 0.8);
  assert.equal(cpuPaceFactor(m, 0, course), 0.8, "the straight brakes toward the arc it has learnt");
  m.factors[0] = 0.7;
  assert.equal(cpuPaceFactor(m, 0, course), 0.7);
  assert.equal(cpuPaceFactor(m, 2, course), 1);
  assert.equal(cpuPaceFactor(m, 9, course), 1);
  assert.equal(cpuPaceFactor(createCpuPace(0), 0, []), 1);
});

test("the course's direction on a segment, and an arc's signed curvature", () => {
  assert.ok(Math.abs(segmentHeading(course[0], [0, 0, 100]) - 0) < 1e-12, "a straight along +z heads 0");
  // Arc 1 turns right (its heading grows from -pi/2 to 0): at its entry the course still runs along +z.
  assert.ok(Math.abs(segmentHeading(course[1], [0, 0, 300]) - 0) < 1e-9);
  assert.ok(Math.abs(segmentHeading(course[1], [100, 0, 400]) - Math.PI / 2) < 1e-9, "at the exit it runs along +x");
  assert.equal(segmentCurvature(course[0]), 0);
  assert.ok(Math.abs(segmentCurvature(course[1]) - 0.01) < 1e-12, "right-hand arc: positive");
  assert.ok(Math.abs(segmentCurvature(course[3]) + 0.01) < 1e-12, "left-hand arc: negative");
  assert.equal(segmentCurvature(null), 0);
  assert.equal(segmentHeading(null, [0, 0, 0]), null);
});

test("a slide is travel over 0.35 rad off the nose at speed with three wheels down; a spin the nose over 1.75 rad off the course", () => {
  const truck = (bvel, down = 4) => ({ bvel, euler: [0, 0, 0], tires: [0, 1, 2, 3].map((i) => ({ onGround: i < down })) });
  assert.ok(isSliding(truck([30, 0, 60])));
  assert.ok(!isSliding(truck([10, 0, 60])), "a little slip is not a slide");
  assert.ok(!isSliding(truck([12, 0, 18])), "nor at low speed");
  assert.ok(!isSliding(truck([30, 0, 60], 2)), "nor on two wheels");
  assert.ok(!isSliding(truck([30, 0, -60])), "nor backing up");
  assert.ok(isSpun({ euler: [0, 0, Math.PI] }, 0));
  assert.ok(!isSpun({ euler: [0, 0, 1.0] }, 0));
  assert.ok(!isSpun({ euler: [0, 0, Math.PI] }, null), "no course direction: no spin");
});
