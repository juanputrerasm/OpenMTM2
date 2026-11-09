/*
  One drag pass (src/game/drag-race.js, MONSTER_EXE_ANALYSIS.md 6.4): prestaging, staging, the
  tree, red lights, lanes, the timing and the places.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAG_MAX_S, LAMP, MAX_STAGE_SPEED, OUT, PRESTAGE_TIMEOUT_S, REVERSE_S, STAGED, STAGE_TIMEOUT_S, TREE_DELAY_S, TREE_S,
  createDrag, dragCollision, dragLamps, dragOver, dragPlaces, dragResults, dragTick, mirrorCourse, stageSpeed, stagingDistance, stillStaging,
} from "../src/game/drag-race.js";

// DRAG3's strip: trucks run toward -z; lane 0 at x 2055, lane 1 at x 2004. The prestage, stage and start beams
// stand at z 2149, 2148 and 2145, the finish at 1985.
const gate = (x, z, width, psi) => ({ gate: { position: [x, 140, z], size: [width, 40, 1], angles: [0, 0, psi] } });
const STRIP = [
  gate(2033, 2149, 104, Math.PI), gate(2033, 2148, 104, Math.PI), gate(2033, 2145, 104, Math.PI), gate(2033, 1985, 104, Math.PI),
  gate(2033, 2073, 224, -Math.PI / 2), gate(2085, 2073, 224, Math.PI / 2), gate(2033, 2073, 224, Math.PI / 2), gate(1981, 2073, 224, -Math.PI / 2),
];
const DT = 1 / 30;
const X = [2055, 2004];
/** Lane trucks with their front tyres at these z (null: no truck in the lane). */
const at = (zs, more = {}) => zs.map((z, i) => (z === null ? null : { front: [X[i], 126, z], centre: [X[i], 126, z + 6], reversing: false, ...more }));
/** Step the pass with the tyres held at `zs` for `seconds`; returns the events. */
function hold(drag, zs, seconds, more) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) events.push(dragTick(drag, at(zs, more), DT));
  return events.filter(Boolean);
}
/** A pass with both trucks rolled through the prestage and stage beams, waiting for the tree. */
function staged(used) {
  const drag = createDrag(STRIP, used);
  const z = (v) => (used ? used.map((u) => (u ? v : null)) : [v, v]);
  hold(drag, z(2152), DT);
  hold(drag, z(2148.8), DT);
  hold(drag, z(2147.5), DT);
  return { drag, z };
}
/** The same pass run on to the green, the tyres still on the stage beam. */
function green(used) {
  const { drag, z } = staged(used);
  const events = hold(drag, z(2147.5), TREE_DELAY_S + TREE_S + 2 * DT);
  assert.deepEqual(events, ["go"]);
  return { drag, z };
}

test("prestaging and staging: each beam lights its lamp when the front tyre rolls through it", () => {
  const drag = createDrag(STRIP);
  hold(drag, [2152, 2152], DT);
  assert.equal(dragLamps(drag, 0), 0);
  assert.equal(drag.phase, "prestage");
  assert.ok(stillStaging(drag, 0));
  hold(drag, [2148.8, 2152], DT);
  assert.equal(dragLamps(drag, 0), LAMP.PRESTAGE);
  assert.equal(drag.phase, "prestage", "one lane prestaged is not both");
  hold(drag, [2148.8, 2148.8], DT);
  assert.equal(drag.phase, "stage");
  hold(drag, [2147.5, 2147.5], DT);
  assert.equal(drag.lanes[1].state, STAGED.STAGED);
  assert.equal(dragLamps(drag, 1), LAMP.PRESTAGE | LAMP.STAGE);
  assert.ok(!stillStaging(drag, 1));
});

test("a beam is broken only by a tyre passing through it, between its ends", () => {
  const drag = createDrag(STRIP);
  // Past every beam's line, but 100 ft off the strip to the side: nothing is broken.
  dragTick(drag, [{ front: [2200, 126, 2160], centre: [2200, 126, 2166] }, null], DT);
  dragTick(drag, [{ front: [2200, 126, 2100], centre: [2200, 126, 2106] }, null], DT);
  assert.equal(drag.lanes[0].state, STAGED.NONE);
  assert.equal(drag.lanes[0].dq, null);
});

test("the tree starts two seconds after the last truck stages and runs half a second", () => {
  const { drag } = staged();
  hold(drag, [2147.5, 2147.5], TREE_DELAY_S - 0.2);
  assert.equal(drag.phase, "stage");
  hold(drag, [2147.5, 2147.5], 0.2 + 2 * DT);
  assert.equal(drag.phase, "tree");
  const ambers = new Set();
  let go = 0;
  for (let t = 0; t < TREE_S + 0.1; t += DT) {
    if (dragTick(drag, at([2147.5, 2147.5]), DT) === "go") go = drag.tree;
    else ambers.add(dragLamps(drag, 1) & (LAMP.AMBER1 | LAMP.AMBER2 | LAMP.AMBER3));
  }
  assert.ok(ambers.has(LAMP.AMBER1) && ambers.has(LAMP.AMBER2) && ambers.has(LAMP.AMBER3));
  assert.ok(Math.abs(go - TREE_S) <= DT, `green after ${go} s`);
  assert.ok(dragLamps(drag, 0) & LAMP.GO);
});

test("a truck that has not prestaged in 30 s, or staged in 30 s, is out (98)", () => {
  const late = createDrag(STRIP);
  hold(late, [2152, 2152], DT);
  hold(late, [2148.8, 2152], PRESTAGE_TIMEOUT_S - 1);
  assert.equal(late.phase, "prestage");
  hold(late, [2148.8, 2152], 1 + DT);
  assert.equal(late.phase, "stage");
  assert.equal(late.lanes[1].dq, "not staged");
  assert.equal(dragResults(late)[1].code, OUT.NOT_STAGED);
  assert.equal(dragLamps(late, 1), 0, "the Disqualify lamp is not for a truck that never staged");

  const drag = createDrag(STRIP);
  hold(drag, [2152, 2152], DT);
  hold(drag, [2148.8, 2148.8], DT);
  hold(drag, [2147.5, 2148.8], STAGE_TIMEOUT_S + DT);
  assert.equal(drag.phase, "tree");
  assert.equal(drag.lanes[1].dq, "not staged");
  assert.equal(drag.lanes[0].dq, null);
});

test("nobody prestaged: the pass waits", () => {
  const drag = createDrag(STRIP);
  hold(drag, [2152, 2152], PRESTAGE_TIMEOUT_S + 5);
  assert.equal(drag.phase, "prestage");
  assert.equal(drag.lanes[0].dq, null);
});

test("the start beam before the green is a red light (99); the other truck runs on", () => {
  const { drag } = staged();
  hold(drag, [2144.5, 2147.5], DT);
  assert.equal(drag.lanes[0].dq, "red light");
  assert.equal(dragResults(drag)[0].code, OUT.RED_LIGHT);
  assert.equal(dragLamps(drag, 0), LAMP.DQ);
  assert.deepEqual(hold(drag, [2144.5, 2147.5], TREE_DELAY_S + TREE_S + 2 * DT), ["go"]);
  assert.equal(drag.lanes[1].dq, null);
  assert.ok(!dragOver(drag));
});

test("the reaction time is the start beam after the green; the elapsed time runs from the green to the finish", () => {
  const { drag } = green();
  hold(drag, [2147.5, 2147.5], 0.3);
  // The tyre crosses the start beam (z 2145) half way through this step.
  const crossedAt = drag.clock + DT / 2 - drag.greenAt;
  dragTick(drag, at([2142.5, 2147.5]), DT);
  assert.equal(drag.lanes[0].state, STAGED.LAUNCHED);
  assert.ok(Math.abs(drag.lanes[0].reaction - crossedAt) < 1e-9);
  hold(drag, [2000, 2147.5], 4);
  const finishedAt = drag.clock + DT * (15 / 30) - drag.greenAt;
  dragTick(drag, at([1970, 2147.5]), DT);
  assert.ok(Math.abs(drag.lanes[0].et - finishedAt) < 1e-9);
  assert.ok(drag.lanes[0].et > drag.lanes[0].reaction, "the reaction time is inside the elapsed time");
});

test("a J-drag's finish beam faces the other way, across the way out: it counts only on the way back", () => {
  // DRAG5: the finish beam stands 67 ft down the strip from the start beam, facing the trucks as they leave.
  const strip = [...STRIP];
  strip[3] = gate(2033, 2078, 104, 0);
  const drag = createDrag(strip, [true, false]);
  hold(drag, [2152, null], DT);
  hold(drag, [2148.8, null], DT);
  hold(drag, [2147.5, null], TREE_DELAY_S + TREE_S + 3 * DT);
  assert.equal(drag.phase, "go");
  assert.equal(drag.lanes[0].dq, null, "the reversed finish beam is not read as broken from the start line");
  hold(drag, [2144, null], DT);
  hold(drag, [2060, null], 1);
  assert.equal(drag.lanes[0].et, null, "passed from in front on the way out");
  hold(drag, [2090, null], DT);
  assert.ok(drag.lanes[0].et > 0);
  assert.ok(dragOver(drag));
});

test("after the green: each truck is judged against its own lane's lines (97)", () => {
  const { drag } = green();
  const trucks = (x0, z0) => [{ front: [x0, 126, z0 - 6], centre: [x0, 126, z0] }, { front: [2004, 126, z0 - 6], centre: [2004, 126, z0] }];
  dragTick(drag, trucks(2040, 2073), DT);
  // Lane 0's truck drifts over the centre line into lane 1.
  dragTick(drag, trucks(2030, 2070), DT);
  assert.equal(drag.lanes[0].dq, "out of lane");
  assert.equal(dragResults(drag)[0].code, OUT.LANE);
  assert.equal(drag.lanes[1].dq, null);
});

test("after the green: backing up for half a second is out (97), a truck not finished in 33 s is out (96)", () => {
  const { drag } = green();
  hold(drag, [2147.5, 2147.5], REVERSE_S - 2 * DT, { reversing: true });
  assert.equal(drag.lanes[0].dq, null);
  hold(drag, [2147.5, 2147.5], 3 * DT, { reversing: true });
  assert.equal(drag.lanes[0].dq, "reversing");

  const slow = green().drag;
  hold(slow, [2147.5, 2147.5], DRAG_MAX_S - 1);
  assert.equal(slow.lanes[0].dq, null);
  hold(slow, [2147.5, 2147.5], 1 + DT);
  assert.equal(slow.lanes[0].dq, "timeout");
  assert.equal(dragResults(slow)[1].code, OUT.TIMEOUT);
  assert.ok(dragOver(slow));
});

test("backing up while staging is allowed", () => {
  const { drag } = staged();
  hold(drag, [2147.5, 2147.5], 1, { reversing: true });
  assert.equal(drag.lanes[0].dq, null);
});

test("a disqualified truck that hits the clean one spoils its pass: a re-run (95)", () => {
  const { drag } = staged();
  hold(drag, [2144.5, 2147.5], DT);
  dragCollision(drag, 1, 0);
  assert.equal(drag.lanes[1].rerun, true);
  assert.equal(dragResults(drag)[1].code, OUT.RERUN);
  assert.equal(drag.lanes[1].dq, null, "a re-run is not a disqualification");
  assert.ok(dragOver(drag));
  // Two clean trucks touching is nothing.
  const clean = green().drag;
  dragCollision(clean, 0, 1);
  assert.equal(clean.lanes[0].rerun || clean.lanes[1].rerun, false);
});

test("one truck alone: the empty lane is left out, and the pass goes green", () => {
  const { drag } = green([true, false]);
  assert.equal(dragLamps(drag, 1), 0);
  assert.equal(dragResults(drag)[1], null);
});

test("auto-staging: to the prestage beam, then into the staging gap, at no more than 2 ft/s", () => {
  const drag = createDrag(STRIP);
  hold(drag, [2152, 2152], DT);
  // 3 ft short of the prestage beam, to stop a quarter of a foot past it.
  assert.ok(Math.abs(stagingDistance(drag, 0, [2055, 126, 2152]) - 3.25) < 1e-9);
  hold(drag, [2148.8, 2148.8], DT);
  assert.equal(drag.gap, 3, "the gap is the strip's own: stage beam to start beam");
  // Staging: a quarter of the 3 ft gap past the stage beam (z 2148).
  assert.ok(Math.abs(stagingDistance(drag, 0, [2055, 126, 2148.8]) - 1.55) < 1e-9);
  assert.ok(Math.abs(stagingDistance(drag, 0, [2055, 126, 2148.8], 0.5) - 2.3) < 1e-9);
  hold(drag, [2147.5, 2147.5], DT);
  assert.equal(stagingDistance(drag, 0, [2055, 126, 2147.5]), null, "staged: hold");
  assert.equal(stageSpeed(100), MAX_STAGE_SPEED);
  assert.equal(stageSpeed(0), 0);
  assert.ok(stageSpeed(0.5) < stageSpeed(2) && stageSpeed(2) < MAX_STAGE_SPEED);
});

test("places: finishers by time, then the rest, then those that are out", () => {
  assert.deepEqual(dragPlaces([{ finished: true, raceTime: 5.2 }, { finished: true, raceTime: 4.9 }]), [2, 1]);
  assert.deepEqual(dragPlaces([{ finished: true, raceTime: 0, dq: "red light" }, { finished: false }]), [2, 1]);
});

test("the other lane's course is the mirror across the strip", () => {
  const [seg] = mirrorCourse([{ startFt: [2056, 120, 2140], endFt: [2055, 120, 1950] }], [2033, 140, 2149], Math.PI);
  assert.ok(Math.abs(seg.startFt[0] - 2010) < 1e-6 && Math.abs(seg.startFt[2] - 2140) < 1e-6);
  assert.ok(Math.abs(seg.endFt[0] - 2011) < 1e-6);
});

test("the 1996 rules (MTM1 physics): no backing-up rule, and the Disqualify lamp for a red light only", () => {
  const run = (rules) => {
    const drag = createDrag(STRIP, undefined, rules);
    hold(drag, [2152, 2152], DT);
    hold(drag, [2148.8, 2148.8], DT);
    hold(drag, [2147.5, 2147.5], DT);
    hold(drag, [2147.5, 2147.5], TREE_DELAY_S + TREE_S + 2 * DT);
    return drag;
  };
  const old = run("mtm1");
  assert.equal(old.phase, "go");
  hold(old, [2147.5, 2147.5], 2, { reversing: true });
  assert.equal(old.lanes[0].dq, null);
  // The timeout still puts a truck out, with no lamp for it.
  hold(old, [2147.5, 2147.5], DRAG_MAX_S);
  assert.equal(old.lanes[0].dq, "timeout");
  assert.equal(dragLamps(old, 0), 0);
  old.lanes[1].dq = "red light";
  assert.equal(dragLamps(old, 1), LAMP.DQ);
  // CP3's rules, the default, light it for the timeout too.
  const now = run();
  assert.equal(now.rules, "cp3");
  hold(now, [2147.5, 2147.5], DRAG_MAX_S + 2 * DT);
  assert.equal(dragLamps(now, 0), LAMP.DQ);
});

test("the strip's lines as MTM1 draws them: every checkpoint, along its x when x is the larger size, else along its z", async () => {
  const { dragStripLines } = await import("../src/game/drag-race.js");
  const beam = (z) => ({ gate: { position: [10, 0, z], angles: [0, 0, 0], size: [40, 10, 1] } });
  const lane = (x) => ({ gate: { position: [x, 0, 150], angles: [0, 0, 0], size: [1, 10, 300] } });
  const lines = dragStripLines([beam(0), beam(1.5), beam(4), beam(300), lane(10), lane(-10), lane(10), lane(30)]);
  assert.equal(lines.length, 8);
  assert.deepEqual([lines[2].a, lines[2].b, lines[2].across], [[-10, 4], [30, 4], [0, 1]]);
  assert.deepEqual([lines[5].a, lines[5].b, lines[5].across.map((v) => v + 0)], [[-10, 0], [-10, 300], [1, 0]]);
});
