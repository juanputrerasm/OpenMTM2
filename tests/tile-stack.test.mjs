/*
  The ground's tiles at their own size (worker/terrain-mesh.js `planTileStacks`, `buildTileStacks`, render/ground-detail.js):
  one stack for each tile width, so a track's 1024 px building fronts do not make every ground tile 1024.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { buildTileStack, buildTileStacks, inSlotOrder, mergeTileStacks, planTileStacks, slotsInUse } from "../src/worker/terrain-mesh.js";

const solid = (side, value) => ({ width: side, height: side, rgba: new Uint8ClampedArray(side * side * 4).fill(value) });

test("each tile keeps its own width; a missing one goes with the narrowest; none without HD art", () => {
  const legacy = [solid(64, 1), solid(64, 2)];
  assert.equal(planTileStacks(legacy, { minSide: 64 }), null, "nothing wider than the atlas: no stacks of its own");
  const plan = planTileStacks([solid(1024, 1), solid(512, 2), solid(64, 3), null, solid(2048, 4), solid(300, 5)], { minSide: 256 });
  assert.deepEqual(plan.sides, [64, 256, 512, 1024]);
  assert.deepEqual(plan.slotSide, [1024, 512, 64, 64, 1024, 256], "2048 is cut to 1024, 300 rounded down to 256");
});

test("over the budget the widest are halved; over four widths the narrowest go up", () => {
  // 40 tiles of 1024 and 200 of 512: 160 + 200 MB. With 256 MB the 1024s become 512s, and 240 of 512 (240 MB) fit.
  const images = [...Array.from({ length: 40 }, () => solid(1024, 1)), ...Array.from({ length: 200 }, () => solid(512, 2))];
  const plan = planTileStacks(images, { minSide: 256, budgetBytes: 256 * 1024 * 1024 });
  assert.deepEqual(plan.sides, [512]);
  const five = planTileStacks([solid(32, 1), solid(64, 1), solid(128, 1), solid(256, 1), solid(512, 1)], { minSide: 64 });
  assert.deepEqual(five.sides, [64, 128, 256, 512]);
  assert.deepEqual(five.slotSide, [64, 64, 128, 256, 512]);
});

test("the stacks hold each slot at its place: its stack, then its layer there", () => {
  const built = buildTileStacks([solid(512, 10), solid(1024, 20), solid(512, 30), solid(64, 40)], { minSide: 256 });
  assert.deepEqual(built.stacks.map((s) => [s.side, s.slots]), [[64, 1], [512, 2], [1024, 1]]);
  const place = (slot) => Array.from(built.place.subarray(slot * 4, slot * 4 + 3));
  assert.deepEqual([place(0), place(1), place(2), place(3)], [[1, 0, 0], [2, 0, 0], [1, 1, 0], [0, 0, 0]]);
  const red = (stack, layer) => built.stacks[stack].data[layer * built.stacks[stack].side ** 2 * 4];
  assert.deepEqual([red(1, 0), red(1, 1), red(2, 0), red(0, 0)], [10, 30, 20, 40]);
  // A layer past 255 says so in its high byte.
  const many = buildTileStacks([solid(512, 1), ...Array.from({ length: 300 }, () => solid(64, 2))], { minSide: 256 });
  assert.deepEqual(Array.from(many.place.subarray(300 * 4, 300 * 4 + 3)), [0, 299 & 255, 1]);
});
test("each layer holds its tile at the stack's size: wider ones filtered down, narrower ones scaled up, a missing one a checker", () => {
  // A 4 px tile, its left half 0 and its right half 200, and a 1 px one of 50.
  const halves = { width: 4, height: 4, rgba: new Uint8ClampedArray(64) };
  for (let i = 0; i < 16; i++) halves.rgba.fill(i % 4 < 2 ? 0 : 200, i * 4, i * 4 + 3);
  const stack = buildTileStack([halves, solid(1, 50), null], 2);
  assert.equal(stack.side, 2);
  assert.equal(stack.slots, 3);
  assert.equal(stack.data.length, 2 * 2 * 4 * 3);
  const red = (slot, x, y) => stack.data[(slot * 4 + y * 2 + x) * 4];
  assert.deepEqual([red(0, 0, 0), red(0, 1, 0), red(0, 1, 1)], [0, 200, 200], "2 x 2 texels averaged into one");
  assert.deepEqual([red(1, 0, 0), red(1, 1, 1)], [50, 50]);
  assert.ok([100, 150].includes(red(2, 0, 0)), "a missing tile is the atlas's grey checker");
  for (let i = 3; i < stack.data.length; i += 4) assert.equal(stack.data[i], 255);
  // Scaled up with smooth textures, a tile is blended between its texels.
  const ramp = { width: 2, height: 1, rgba: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
  const smooth = buildTileStack([ramp], 8, { smooth: true });
  const row = Array.from({ length: 8 }, (_, x) => smooth.data[x * 4]);
  for (let x = 1; x < 8; x++) assert.ok(row[x] >= row[x - 1], `${row} rises`);
  assert.ok(row.some((v) => v > 0 && v < 255), `${row} blends`);
});

test("a slot no cell and no box face names takes no room", () => {
  const clr = Uint16Array.from([3, 3 | (1 << 12) | (2 << 14), 5]);
  assert.deepEqual([...slotsInUse(clr, [9])].sort((a, b) => a - b), [3, 5, 9], "the word's mirror and turn are not part of its slot");
});

test("two widths made one when the graphics card cannot take a texture for each: the pair that grows least, at the wider side", () => {
  // Valparaiso's mix: many narrow tiles, fewer middle ones, a few wide ones. Joining the middle with the wide grows least.
  const built = buildTileStacks([solid(64, 1), solid(64, 2), solid(64, 3), solid(64, 4), solid(64, 5), solid(128, 6), solid(256, 7)], { minSide: 32 });
  assert.deepEqual(built.stacks.map((s) => [s.side, s.slots]), [[64, 5], [128, 1], [256, 1]]);
  const merged = mergeTileStacks(built);
  assert.deepEqual(merged.stacks.map((s) => [s.side, s.slots]), [[64, 5], [256, 2]]);
  const at = (slot) => { const p = merged.place.subarray(slot * 4, slot * 4 + 3); return [p[0], p[1] | (p[2] << 8)]; };
  const red = ([stack, layer]) => merged.stacks[stack].data[layer * merged.stacks[stack].side ** 2 * 4];
  for (let slot = 0; slot < 7; slot++) assert.equal(red(at(slot)), slot + 1, `slot ${slot} still reads its own tile`);
  assert.deepEqual([at(5), at(6)], [[1, 0], [1, 1]], "the narrower's layers first, then the wider's");
  // Again: one stack, and then nothing more to give.
  const one = mergeTileStacks(merged);
  assert.deepEqual(one.stacks.map((s) => [s.side, s.slots]), [[256, 7]]);
  for (let slot = 0; slot < 7; slot++) assert.equal(one.stacks[0].data[slot * 256 * 256 * 4], slot + 1);
  assert.equal(mergeTileStacks(one), null);
});

test("past the budget the two widest are joined at the narrower side", () => {
  const built = buildTileStacks([solid(64, 1), solid(128, 2), solid(256, 3)], { minSide: 32 });
  const merged = mergeTileStacks(built, { budgetBytes: 1 });
  assert.deepEqual(merged.stacks.map((s) => [s.side, s.slots]), [[64, 1], [128, 2]]);
  assert.equal(merged.stacks[1].data[128 * 128 * 4], 3, "the wide tile, filtered down");
});

test("one stack is read without its table: its layers are put in slot order", () => {
  const built = buildTileStacks([solid(64, 1), solid(128, 2), solid(64, 3)], { minSide: 32 });
  const one = mergeTileStacks(built);
  assert.equal(one.stacks.length, 1);
  const ordered = inSlotOrder(one.stacks[0], one.place);
  const side = ordered.side;
  assert.deepEqual([0, 1, 2].map((slot) => ordered.data[slot * side * side * 4]), [1, 2, 3]);
  // Already in order: the same stack back.
  const identity = { data: new Uint8Array(2 * 4), side: 1, slots: 2 };
  assert.equal(inSlotOrder(identity, new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0])), identity);
});

test("joined past the budget, the two widest keep the widest side that fits", () => {
  // Valparaiso's last step: 321 tiles of 256 and 80 of 1024 as one stack. At 1024 that is 1.6 GB; at 512, 401 MB.
  const stacks = [{ side: 256, slots: 321 }, { side: 1024, slots: 80 }];
  const bytes = (side) => side * side * 4 * 401;
  assert.ok(bytes(1024) > 512 * 1024 * 1024 && bytes(512) <= 512 * 1024 * 1024);
  // The same choice at a small scale: 3 tiles of 4 and 1 of 16 under a budget that holds 4 tiles of 8 but not of 16.
  const small = buildTileStacks([solid(4, 1), solid(4, 2), solid(4, 3), solid(16, 4)], { minSide: 2 });
  const merged = mergeTileStacks(small, { budgetBytes: 4 * 8 * 8 * 4 });
  assert.deepEqual(merged.stacks.map((s) => [s.side, s.slots]), [[8, 4]]);
  assert.equal(stacks.length, 2);
});
