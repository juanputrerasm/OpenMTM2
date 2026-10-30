import test from "node:test";
import assert from "node:assert/strict";
import { createReplayGates, crossesGate } from "../src/game/replay-gates.js";

// Gates facing +z (identity matrix), 40 ft wide and 20 high, at z = 0, 100 and 200.
const gate = (z) => ({ gate: { position: [0, 0, z], size: [40, 20, 4], matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] } });
const course = [gate(0), gate(100), gate(200)];

test("a gate is passed going forward through its middle, within its width and height", () => {
  assert.equal(crossesGate(course[0].gate, [0, 0, -2], [0, 0, 2]), true);
  assert.equal(crossesGate(course[0].gate, [0, 0, 2], [0, 0, -2]), false);
  assert.equal(crossesGate(course[0].gate, [30, 0, -2], [30, 0, 2]), false);
});

test("checkpoints are passed in order, and the last one closes a lap", () => {
  const gates = createReplayGates(course);
  gates.reset(true);
  const run = (from, to) => { gates.pass([[0, 0, from]]); return gates.pass([[0, 0, to]])[0]; };
  assert.equal(run(150, 210), null); // the third before the first: out of order
  assert.equal(run(-5, 5), "checkpoint");
  assert.equal(run(95, 105), "checkpoint");
  assert.equal(run(195, 205), "lap");
  assert.equal(run(-5, 5), "checkpoint");
});

test("after a jump the first gate gone through sets the order, silently", () => {
  const gates = createReplayGates(course);
  gates.reset(false);
  gates.pass([[0, 0, 95]]);
  assert.equal(gates.pass([[0, 0, 105]])[0], null);
  gates.pass([[0, 0, 195]]);
  assert.equal(gates.pass([[0, 0, 205]])[0], "lap");
});

test("a paused or rewound film moves the trucks without passing anything", () => {
  const gates = createReplayGates(course);
  gates.reset(true);
  gates.pass([[0, 0, -5]]);
  gates.follow([[0, 0, 50]]);
  assert.equal(gates.pass([[0, 0, 60]])[0], null);
});
