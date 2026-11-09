/*
  The tree model's lamps (src/game/drag-tree-face.js), painted as MTM1's 0x41d490 paints TRLFACE.RAW
  (docs/MTM1_MONSTER_EXE_ANALYSIS.md 5.6).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { TREE_FACE_COLOURS, TREE_FACE_SIZE, treeFace } from "../src/game/drag-tree-face.js";
import { LAMP } from "../src/game/drag-race.js";

const at = (face, x, y) => face[y * TREE_FACE_SIZE + x];

test("the tree: cleared to index 0, each lit lamp a rectangle of its colour over its row; slot 0 at x 36-63, slot 1 at x 0-27", () => {
  const face = treeFace([LAMP.PRESTAGE | LAMP.STAGE, LAMP.GO]);
  // Slot 0, prestage (rows 0-6) and stage (rows 9-16), in palette 0x69.
  assert.equal(at(face, 36, 0), 0x69);
  assert.equal(at(face, 63, 6), 0x69);
  assert.equal(at(face, 50, 16), 0x69);
  assert.equal(at(face, 50, 7), 0, "the gap between rows stays unlit");
  assert.equal(at(face, 35, 0), 0, "the middle columns stay unlit");
  assert.equal(at(face, 50, 49), 0, "slot 0's green is off");
  // Slot 1, the green (rows 49-54) in 0xd6.
  assert.equal(at(face, 0, 49), 0xd6);
  assert.equal(at(face, 27, 54), 0xd6);
  assert.equal(at(face, 28, 50), 0);
  assert.equal(at(face, 10, 0), 0, "slot 1's prestage is off");
});

test("the tree: the ambers in 0x6f, the red in 0x9c, nothing lit with no words", () => {
  const face = treeFace([LAMP.AMBER2, LAMP.DQ]);
  assert.equal(at(face, 40, 30), 0x6f);
  assert.equal(at(face, 40, 19), 0, "only the amber asked for");
  assert.equal(at(face, 5, 57), 0x9c);
  assert.equal(at(face, 5, 63), 0x9c);
  assert.deepEqual(TREE_FACE_COLOURS, [0x69, 0x69, 0x6f, 0x6f, 0x6f, 0xd6, 0x9c]);
  assert.ok(treeFace(null).every((v) => v === 0));
});
