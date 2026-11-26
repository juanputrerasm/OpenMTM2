/*
  Community Patch 4 2.0.52.4's race rules (`.CPX`, docs/CP4_ENGINE_UPDATES.md 8) in OpenMTM2: the checks and refusals
  (game/cpx-rules.js), new-style drags (game/drag-race.js), the walls and Parallel penalties (game/cpx-walls.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readCpx, writeCpx } from "../src/vendor/openphotex/mtm/cpx.js";
import { CPX_NOTES, checkCpx, cpxLaps, cpxPresence, cpxTimeoutS } from "../src/game/cpx-rules.js";
import { DQ_RUN_TIME_S, createDrag, dragResults, dragTick, dragWallTouch } from "../src/game/drag-race.js";
import { createPenalties, lostOnPenalties, parallelOrder, pointTouches, wallGrid, wallPieces } from "../src/game/cpx-walls.js";

const rule = (mode, laps = 0, extra = {}) => ({ mode, laps, timeoutMs: 0, penaltyMs: mode === 2 ? 5000 : 0, rearmMs: mode === 2 ? 1000 : 0, ...extra });
/** A checkpoint box at (x, 0, z) facing +z, and its CPBX record. */
const cp = (x, z) => ({ positionFt: [x, 0, z], psi: 0 });
const rec = (slot, role, x, z, split = 0, lane = 0) => ({ slot, role, split, lane, groundLine: 0, psi: 0, x: x * 256, y: 0, z: z * 256 });
const bytes = (input) => writeCpx(input);

test("a drag's rules: pre-stage, stage, launch, gates, finish; one-run or looped; the time-out", () => {
  const cps = [cp(0, 0), cp(0, 10), cp(0, 20), cp(0, 200), cp(0, 400)];
  const boxes = [rec(0, 1, 0, 0), rec(1, 2, 0, 10), rec(2, 3, 0, 20), rec(3, 5, 0, 200), rec(4, 4, 0, 400)];
  const { rules, refused } = checkCpx(readCpx(bytes({ rule: rule(1, 0), boxes })), { checkpoints: cps, trackType: 1 });
  assert.equal(refused, undefined);
  assert.equal(rules.looped, true);
  assert.equal(cpxLaps(rules, 3), 3);
  assert.equal(cpxTimeoutS(rules, 3), 270, "laps x 90 s");
  assert.equal(cpxTimeoutS({ ...rules, timeoutMs: 60000 }, 3), 60);
  const one = checkCpx(readCpx(bytes({ rule: rule(1, 1), boxes })), { checkpoints: cps, trackType: 1 }).rules;
  assert.equal(cpxLaps(one, 5), 1, "a one-run drag is one lap");
});

test("refusals: mismatch, misfit, missing, damaged; COUR defects ignored with a note", () => {
  const cps = [cp(0, 0), cp(0, 10), cp(0, 20), cp(0, 400)];
  const boxes = [rec(0, 1, 0, 0), rec(1, 2, 0, 10), rec(2, 3, 0, 20), rec(3, 4, 0, 400)];
  const ok = (input, trackType = 1, checkpoints = cps) => checkCpx(readCpx(bytes(input)), { checkpoints, trackType });
  assert.equal(ok({ rule: rule(1, 1), boxes }, 2).refused, CPX_NOTES.misfit(), "a drag's rules on a circuit");
  const moved = boxes.map((b, i) => (i === 3 ? { ...b, x: b.x + 17 } : b));
  assert.equal(ok({ rule: rule(1, 1), boxes: moved }).refused, CPX_NOTES.mismatch(), "17 units off the box");
  assert.equal(ok({ rule: rule(1, 1), boxes: moved.map((b, i) => (i === 3 ? { ...b, x: b.x - 2 } : b)) }).refused, undefined, "15 units: within");
  assert.equal(ok({ rule: rule(1, 1), boxes: boxes.slice(0, 3) }, 1, cps).refused, CPX_NOTES.mismatch(), "a box without its record");
  assert.equal(ok({ rule: rule(1, 1), boxes: boxes.map((b, i) => (i === 3 ? { ...b, role: 5 } : b)) }).refused, CPX_NOTES.mismatch(), "no finish");
  assert.deepEqual(cpxPresence("drag", null, "STRIP", readCpx), { refused: "This track's race rules (WORLD\\STRIP.CPX) are missing." });
  assert.equal(cpxPresence(null, null, "STRIP", readCpx).cpx, null, "no key, no file: the old rules");
  assert.equal(cpxPresence("drag", new Uint8Array(40), "STRIP", readCpx).refused, CPX_NOTES.damaged());
  assert.match(cpxPresence(null, bytes({ rule: rule(1, 1), boxes }), "STRIP", readCpx).notes[0], /does not announce/);
  // A lead-in on course 0 is a COUR defect: ignored with a note, the race goes on.
  const bad = ok({ rule: rule(1, 1), boxes, courses: [{ course: 0, flags: 1, thenCourse: 1 }] });
  assert.equal(bad.refused, undefined);
  assert.deepEqual(bad.rules.courses, []);
  assert.equal(bad.notes[0], CPX_NOTES.courses());
  const good = ok({ rule: rule(1, 1), boxes, courses: [{ course: 2, flags: 1, thenCourse: 1 }] });
  assert.deepEqual(good.rules.courses, [{ course: 2, thenCourse: 1 }]);
});

test("split checkpoints: any copy needs two or more, per lane exactly lanes 1 and 2; mode 3 takes no per-lane copies", () => {
  const cps = [cp(0, 100), cp(50, 100), cp(0, 300)];
  const anyCopy = [rec(0, 5, 0, 100, 1), rec(0, 5, 50, 100, 1), rec(1, 4, 0, 300)];
  assert.equal(checkCpx(readCpx(bytes({ rule: rule(3), boxes: anyCopy })), { checkpoints: cps, trackType: 2 }).refused, undefined);
  assert.equal(checkCpx(readCpx(bytes({ rule: rule(3), boxes: anyCopy })), { checkpoints: cps, trackType: 3 }).refused, undefined, "a rally too");
  const perLane = [rec(0, 5, 0, 100, 2, 1), rec(0, 5, 50, 100, 2, 2), rec(1, 4, 0, 300)];
  assert.equal(checkCpx(readCpx(bytes({ rule: rule(3), boxes: perLane })), { checkpoints: cps, trackType: 2 }).refused, CPX_NOTES.mismatch());
  assert.equal(checkCpx(readCpx(bytes({ rule: rule(2), boxes: perLane })), { checkpoints: cps, trackType: 2 }).refused, undefined, "Parallel takes lanes");
  const r = checkCpx(readCpx(bytes({ rule: rule(2), boxes: perLane })), { checkpoints: cps, trackType: 2 }).rules;
  assert.deepEqual(r.slots[0].lanes, [1, 2]);
});

test("a new-style drag: per-lane beams, the hub band, gates in order, looped laps, a wall is a DQ, DQ run time 3600 s", () => {
  const gate = (x, z, h = 10) => ({ gate: { position: [x, 5, z], size: [10, h, 1], angles: [0, 0, 0] } });
  // Lane 1 at x 0, lane 2 at x 20: pre-stage 0, stage 2, launch 4, a gate at 100, the finish at 200; all per lane.
  const zs = [0, 2, 4, 100, 200], roles = [1, 2, 3, 5, 4];
  const checkpoints = [], records = [];
  zs.forEach((z, slot) => [0, 20].forEach((x, k) => { checkpoints.push(gate(x, z)); records.push({ slot, role: roles[slot], split: 2, lane: k + 1 }); }));
  const slots = zs.map((_, slot) => ({ role: roles[slot], split: 2, copies: [2 * slot, 2 * slot + 1], lanes: [1, 2] }));
  const rules = { mode: 1, oneRun: false, looped: true, timeoutMs: 0, slots, boxes: records, walls: [], courses: [] };
  const drag = createDrag(checkpoints, [true, true], "cp3", { cpx: rules, laps: 2 });
  assert.equal(drag.laps, 2);
  assert.equal(drag.maxS, 180);
  const at = (x, z, hubY = 5) => ({ front: [x, 0, z], centre: [x, 0, z], reversing: false, hubY });
  const run = (zA, zB, dt = 0.1, hubA = 5) => dragTick(drag, [at(0, zA, hubA), at(20, zB)], dt);
  // Both trucks roll through pre-stage and stage, wait for the tree.
  run(-1, -1); run(1, 1); run(3, 3);
  for (let i = 0; i < 40 && drag.phase !== "go"; i++) run(3, 3);
  assert.equal(drag.phase, "go");
  run(5, 5);
  // Truck A's hub is above the gate's band at 100: the gate does not count, so its finish does not either.
  run(99, 99, 0.1, 50); run(101, 101, 0.1, 50);
  assert.equal(drag.lanes[0].next, 0, "hub above the band");
  assert.equal(drag.lanes[1].next, 1);
  run(199, 199); run(201, 201);
  assert.equal(drag.lanes[1].lapsDone, 1, "lane 2's first lap");
  assert.equal(drag.lanes[0].lapsDone, 0);
  dragWallTouch(drag, 0);
  const results = dragResults(drag);
  assert.equal(results[0].dq, "wall");
  assert.equal(results[0].runTime, DQ_RUN_TIME_S);
});

test("walls: a point inside the ribbon or crossing the path between base and top touches; a gap stretch has no wall", () => {
  const wall = { name: "W", closed: false, side: 0, thicknessFt: 2, heightFt: 4, points: [{ x: 0, z: 0, baseFt: 0, bendFt: 0, gap: false }, { x: 100, z: 0, baseFt: 0, bendFt: 0, gap: true }, { x: 200, z: 0, baseFt: 0, bendFt: 0, gap: false }] };
  const grid = wallGrid(wallPieces([wall]));
  const touches = (from, to) => [...pointTouches(grid, from, to)];
  assert.deepEqual(touches([50, 1, 5], [50, 1, 0.5]), [0], "inside the ribbon");
  assert.deepEqual(touches([50, 1, 5], [50, 1, -5]), [0], "swept through it");
  assert.deepEqual(touches([50, 6, 5], [50, 6, 0.5]), [], "over the top");
  assert.deepEqual(touches([150, 1, 5], [150, 1, 0]), [], "the gap stretch");
  // A bent stretch: its middle pushed 10 ft toward (-dz, +dx) = +z.
  const bent = { ...wall, points: [{ x: 0, z: 0, baseFt: 0, bendFt: 10, gap: false }, { x: 100, z: 0, baseFt: 0, bendFt: 0, gap: false }] };
  const g2 = wallGrid(wallPieces([bent]));
  assert.deepEqual([...pointTouches(g2, [50, 1, 15], [50, 1, 10])], [0]);
  assert.deepEqual([...pointTouches(g2, [50, 1, 3], [50, 1, 0.5])], [], "the chord itself is clear");
});

test("Parallel: 5 s a wall touch, re-armed after 1 s clear, results by time plus penalties", () => {
  const p = createPenalties(2, { penaltyMs: 5000, rearmMs: 1000 });
  p.touch(0, new Set([3]), 0);
  p.touch(0, new Set([3]), 500);
  p.touch(0, new Set(), 900);
  p.touch(0, new Set([3]), 1200);
  assert.equal(p.totals[0], 5000, "touching again within 1 s clear does not count");
  p.touch(0, new Set(), 2300);
  p.touch(0, new Set([3]), 3400);
  assert.equal(p.totals[0], 10000);
  p.set(1, 5000); p.set(1, 5000);
  assert.equal(p.totals[1], 5000, "a remote total is set, never added");
  const rows = [{ i: 0, finished: true, time: 60, penaltyMs: 10000 }, { i: 1, finished: true, time: 65, penaltyMs: 0 }];
  assert.deepEqual(parallelOrder(rows).map((r) => r.i), [1, 0]);
  assert.equal(lostOnPenalties(rows, rows[0]), true);
  assert.equal(lostOnPenalties(rows, rows[1]), false);
});

test("walls drawn as the contact test sees them: a box a piece, base to top, a gap stretch left out", async () => {
  const { wallGeometry } = await import("../src/game/cpx-walls.js");
  const wall = { name: "W", closed: false, side: 0, thicknessFt: 2, heightFt: 4, points: [{ x: 0, z: 0, baseFt: 10, bendFt: 0, gap: false }, { x: 100, z: 0, baseFt: 10, bendFt: 0, gap: true }, { x: 200, z: 0, baseFt: 10, bendFt: 0, gap: false }] };
  const { positions, index } = wallGeometry([wall]);
  assert.equal(positions.length / 3, 8, "one piece: eight corners");
  assert.equal(index.length, 30, "four sides and a top");
  const ys = positions.filter((_, i) => i % 3 === 1), zs = positions.filter((_, i) => i % 3 === 2);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [10, 14]);
  assert.deepEqual([Math.min(...zs), Math.max(...zs)].map(Math.abs).sort(), [1, 1], "the thickness, z mirrored");
  assert.equal(wallGeometry([]).index.length, 0);
});
