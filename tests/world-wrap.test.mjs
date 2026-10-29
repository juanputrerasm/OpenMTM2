// The world as a torus in a race (docs/CHANGELOG.md Stage 4; MONSTER_EXE_ANALYSIS.md "The wrapping world"): a truck that
// drives out of the world comes in at the other side, and meets there what a truck inside meets.

import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/worker/sim-worker.js";
import { nearestCopy, wrapFt } from "../src/shared/scene-frame.js";

const flat = () => new Uint8Array(65536).fill(50).buffer;
const one = (extra, pos, heading = 0) => createSession({
  heights: flat(), weather: 0, difficulty: 1, boxes: [], ramps: [], course: [], ...extra,
  trucks: [{ truck: {}, start: { pos, heading }, autopilot: false }],
});

test("nearest copy: a point across the seam, across a corner, and one already nearest", () => {
  assert.deepEqual(nearestCopy([5, 10, 100], [8190, 0, 100]), [8197, 10, 100]);
  assert.deepEqual(nearestCopy([8190, 10, 8190], [3, 0, 2]), [-2, 10, -2]);
  const here = [4000, 10, 4000];
  assert.equal(nearestCopy(here, [4100, 0, 3900]), here);
  assert.equal(wrapFt(-8), 8184);
  assert.equal(wrapFt(8200), 8);
});

test("a truck driven off the world's edge comes in at the other side, still moving, and the picture does not cross the world", () => {
  const s = one({}, [100, 106, 8100]);
  for (let i = 0; i < 60; i++) s.step({});
  let wrapped = false;
  for (let i = 0; i < 900 && !wrapped; i++) {
    const before = s.state.pos[2];
    s.step({ accelerate: true });
    if (s.state.pos[2] < before - 4000) {
      wrapped = true;
      assert.ok(s.state.pos[2] >= 0 && s.state.pos[2] < 60, `came in at z ${s.state.pos[2]}`);
      // The state it is drawn from went with it: a step's worth behind, not a world away.
      const previous = s.trucks[0].previous;
      assert.ok(Math.abs(s.state.pos[2] - previous.pos[2]) < 5, `drawn from z ${previous.pos[2]}`);
      assert.ok(s.state.bvel[2] > 20, "still at speed");
    }
  }
  assert.ok(wrapped, "it reached the edge");
  for (let i = 0; i < 120; i++) s.step({ accelerate: true });
  assert.ok(s.state.pos[2] > 60 && s.state.pos[2] < 8192 && s.state.tires.some((t) => t.onGround));
});

test("a box across the seam stops a truck as the same box inside the world does", () => {
  // A wall 40 ft wide, 20 ft high and 8 ft thick, 150 ft ahead of the truck.
  const wall = (z) => ({ positionFt: [1000, 110, z], theta: 0, phi: 0, psi: 0, sizeFt: [8, 40, 20], mass: 0, type: 0, priority: 0, bounds: null, sitIndex: 0, bvel: null });
  const run = (startZ, wallZ) => {
    const s = one({ boxes: [wall(wallZ)] }, [1000, 106, startZ]);
    for (let i = 0; i < 60; i++) s.step({});
    for (let i = 0; i < 480; i++) s.step({ accelerate: true });
    return s.state;
  };
  const inside = run(3000, 3150), across = run(8192 - 100, 50);
  const gapInside = 3150 - inside.pos[2], gapAcross = ((50 - across.pos[2]) % 8192 + 8192) % 8192;
  assert.ok(gapInside > 4 && gapInside < 30, `inside the world it stops ${gapInside} ft short of the wall`);
  assert.ok(Math.abs(gapAcross - gapInside) < 3, `across the seam it stops ${gapAcross} ft short, inside ${gapInside}`);
});

test("two trucks either side of the seam push each other", () => {
  const session = createSession({
    heights: flat(), weather: 0, difficulty: 1, boxes: [], ramps: [], course: [],
    trucks: [
      { truck: {}, start: { pos: [1000, 106, 8170], heading: 0 }, autopilot: false },
      { truck: {}, start: { pos: [1000, 106, 30], heading: 0 }, autopilot: false },
    ],
  });
  for (let i = 0; i < 60; i++) session.step({});
  const ahead = session.trucks[1].state;
  const z0 = ahead.pos[2];
  for (let i = 0; i < 360; i++) session.step({ accelerate: true });
  assert.ok(ahead.pos[2] > z0 + 10, `the truck ahead was pushed on from z ${z0} to ${ahead.pos[2]}`);
});
