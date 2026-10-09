/*
  Drag races (src/game/drag-race.js): staging, the tree, red lights, lanes and places.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { AMBER_S, LAMP, createDrag, dragLamps, dragPlaces, dragTick, mirrorCourse, stillStaging } from "../src/game/drag-race.js";

// DRAG3's strip: trucks run toward -z; lane 1 at x 2055, lane 2 at x 2004.
const gate = (x, z, width, psi) => ({ gate: { position: [x, 140, z], size: [width, 40, 1], angles: [0, 0, psi] } });
const STRIP = [
  gate(2033, 2149, 104, Math.PI), gate(2033, 2148, 104, Math.PI), gate(2033, 2145, 104, Math.PI), gate(2033, 1985, 104, Math.PI),
  gate(2033, 2073, 224, -Math.PI / 2), gate(2085, 2073, 224, Math.PI / 2), gate(2033, 2073, 224, Math.PI / 2), gate(1981, 2073, 224, -Math.PI / 2),
];
const DT = 1 / 30;

function staged() {
  const drag = createDrag(STRIP);
  const fronts = [[2055, 126, 2147.5], [2004, 126, 2147.5]];
  dragTick(drag, fronts, fronts, [false, false], [false, false], DT);
  return { drag, fronts };
}

test("staging: the prestage and stage beams light their lamps, then the tree starts", () => {
  const drag = createDrag(STRIP);
  const behind = [[2055, 126, 2160], [2004, 126, 2160]];
  dragTick(drag, behind, behind, [false, false], [false, false], DT);
  assert.equal(dragLamps(drag, 0), 0);
  assert.ok(stillStaging(drag, 0));
  const pre = [[2055, 126, 2148.5], [2004, 126, 2160]];
  dragTick(drag, pre, pre, [false, false], [false, false], DT);
  assert.equal(dragLamps(drag, 0), LAMP.PRESTAGE);
  const { drag: ready } = staged();
  assert.equal(ready.phase, "tree");
  assert.equal(dragLamps(ready, 0) & (LAMP.PRESTAGE | LAMP.STAGE), LAMP.PRESTAGE | LAMP.STAGE);
});

test("the tree: three ambers in turn, then Go", () => {
  const { drag, fronts } = staged();
  const ambers = [];
  let go = null;
  for (let t = 0; t < AMBER_S * 3 + 0.1; t += DT) {
    const event = dragTick(drag, fronts, fronts, [false, false], [false, false], DT);
    ambers.push(dragLamps(drag, 1) & (LAMP.AMBER1 | LAMP.AMBER2 | LAMP.AMBER3));
    if (event === "go") go = t;
  }
  assert.ok(ambers.includes(LAMP.AMBER1) && ambers.includes(LAMP.AMBER2) && ambers.includes(LAMP.AMBER3));
  assert.ok(Math.abs(go - AMBER_S * 3) < 0.1, `green at ${go}`);
  assert.ok(dragLamps(drag, 0) & LAMP.GO);
});

test("crossing the start beam before the green is a red light", () => {
  const { drag } = staged();
  const early = [[2055, 126, 2144], [2004, 126, 2147.5]];
  dragTick(drag, early, early, [false, false], [false, false], DT);
  assert.equal(drag.lanes[0].dq, "red light");
  assert.ok(dragLamps(drag, 0) & LAMP.DQ);
  assert.equal(dragLamps(drag, 0) & LAMP.GO, 0);
});

test("after the green: leaving the lane disqualifies, the reaction time is kept", () => {
  const { drag, fronts } = staged();
  while (drag.phase !== "go") dragTick(drag, fronts, fronts, [false, false], [false, false], DT);
  for (let i = 0; i < 9; i++) dragTick(drag, fronts, fronts, [false, false], [false, false], DT);
  dragTick(drag, fronts, fronts, [false, false], [true, false], DT);
  assert.ok(Math.abs(drag.lanes[0].reaction - 10 * DT) < 1e-9);
  // Lane 1's truck drifts over the centre line into lane 2.
  dragTick(drag, fronts, [[2040, 126, 2073], [2004, 126, 2073]], [false, false], [true, true], DT);
  dragTick(drag, fronts, [[2030, 126, 2070], [2004, 126, 2070]], [false, false], [true, true], DT);
  assert.equal(drag.lanes[0].dq, "out of lane");
  assert.equal(drag.lanes[1].dq, null);
});

test("places: finishers by time, then the rest, then the disqualified", () => {
  assert.deepEqual(dragPlaces([{ finished: true, raceTime: 5.2 }, { finished: true, raceTime: 4.9 }]), [2, 1]);
  assert.deepEqual(dragPlaces([{ finished: true, raceTime: 0, dq: "red light" }, { finished: false }]), [2, 1]);
});

test("an empty lane counts as staged", () => {
  const drag = createDrag(STRIP, [true, false]);
  const fronts = [[2055, 126, 2147.5], null];
  dragTick(drag, fronts, fronts, [false, false], [false, false], DT);
  assert.equal(drag.phase, "tree");
});

test("the other lane's course is the mirror across the strip", () => {
  const [seg] = mirrorCourse([{ startFt: [2056, 120, 2140], endFt: [2055, 120, 1950] }], [2033, 140, 2149], Math.PI);
  assert.ok(Math.abs(seg.startFt[0] - 2010) < 1e-6 && Math.abs(seg.startFt[2] - 2140) < 1e-6);
  assert.ok(Math.abs(seg.endFt[0] - 2011) < 1e-6);
});
