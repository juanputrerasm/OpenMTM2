// Damage knocks a truck's lamps askew (MONSTER_EXE_ANALYSIS.md 11b, 0x5323e0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LAMP_KNOCK_RAD, freshKnock, knockLamp } from "../src/game/truck-lights.js";

const headlight = { pos: [1, 3, 8], coneLength: 75 };
const constant = (v) => () => v;

test("lamps: a lamp within 2 ft of the zone's point turns and moves; one farther is left alone", () => {
  const knock = freshKnock();
  assert.equal(knockLamp(knock, headlight, [1, 3, 9.9], [1, 1, -1], constant(0.75)), true);
  // A step of (0.75 * 2 - 1) * 0.349 either way on heading and pitch; the move rand/65536 = 0.375 ft, a fifth on z.
  assert.ok(Math.abs(knock.heading - 0.5 * LAMP_KNOCK_RAD) < 1e-9);
  assert.ok(Math.abs(knock.pitch - 0.5 * LAMP_KNOCK_RAD) < 1e-9);
  assert.deepEqual(knock.pos.map((v) => +v.toFixed(4)), [0.375, 0.375, -0.075]);
  const far = freshKnock();
  assert.equal(knockLamp(far, headlight, [1, 3, 10.5], [1, 1, -1]), false);
  assert.deepEqual(far, freshKnock());
});

test("lamps: knocks build up but the aim never strays past 20 degrees; a lamp without a cone only moves", () => {
  const knock = freshKnock();
  for (let i = 0; i < 20; i++) knockLamp(knock, headlight, [1, 3, 8], [0, 0, 0], constant(0.999));
  assert.ok(Math.abs(knock.heading - LAMP_KNOCK_RAD) < 1e-9 && Math.abs(knock.pitch - LAMP_KNOCK_RAD) < 1e-9);
  const tail = freshKnock();
  knockLamp(tail, { pos: [0, 3, -8], coneLength: 0 }, [0, 3, -8], [0, 1, 0], constant(0.5));
  assert.equal(tail.heading, 0);
  assert.equal(tail.pos[1], 0.25);
});
