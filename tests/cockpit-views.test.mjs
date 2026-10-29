// The cockpit's look round the cab and the View keys (MONSTER_EXE_ANALYSIS.md 11, "Looking round the cab").
import { test } from "node:test";
import assert from "node:assert/strict";
import { panelForLook } from "../src/render/cockpit.js";
import { COCKPIT_SHADE, shadeIndices, shadeRow } from "../src/worker/cockpit-art.js";
import { ACTIONS, DEFAULT_BINDINGS } from "../src/game/input/bindings.js";

test("cockpit: a head turn shows that side's panel (0x4000 right, 0x8000 back, 0xc000 left)", () => {
  assert.equal(panelForLook(0), "front");
  assert.equal(panelForLook(0x4000), "right");
  assert.equal(panelForLook(0x8000), "back");
  assert.equal(panelForLook(0xc000), "left");
  assert.equal(panelForLook(0x1234), "front");
});

test("cockpit: the View keys are the game's (Insert, Delete, keypad minus forward, keypad plus back)", () => {
  assert.deepEqual([...DEFAULT_BINDINGS.viewLeft], ["Insert"]);
  assert.deepEqual([...DEFAULT_BINDINGS.viewRight], ["Delete"]);
  assert.ok(DEFAULT_BINDINGS.cameraUp.includes("NumpadSubtract"));
  assert.ok(DEFAULT_BINDINGS.cameraDown.includes("NumpadAdd"));
  for (const id of ["viewLeft", "viewRight", "cameraUp", "cameraDown"]) assert.ok(ACTIONS.some((a) => a.id === id), id);
  // No key does two of the View actions.
  const keys = ["viewLeft", "viewRight", "cameraUp", "cameraDown"].flatMap((id) => DEFAULT_BINDINGS[id]);
  assert.equal(new Set(keys).size, keys.length);
});

test("cockpit: the weather's shade levels and the table's rows (0x4ec530, FOG\\VGA.LTE)", () => {
  assert.deepEqual([...COCKPIT_SHADE], [null, 13, 14, 12, 13, 14, 11, 8, 5]);
  const lte = new Uint8Array(32 * 256);
  for (let r = 0; r < 32; r++) for (let i = 0; i < 256; i++) lte[r * 256 + i] = (i + r) & 0xff;
  // Level n is the file's row n - 1.
  assert.equal(shadeRow(lte, 8)[10], 17);
  assert.equal(shadeRow(lte, 1)[10], 10);
  assert.equal(shadeRow(new Uint8Array(10), 8), null);
  // Index 0, the cutout, stays 0.
  assert.deepEqual([...shadeIndices(new Uint8Array([0, 1, 2]), shadeRow(lte, 5))], [0, 5, 6]);
});
