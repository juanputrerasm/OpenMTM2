// A model's parts drawn together (src/shared/part-layers.js): stacks of textures, joined vertices, groups in order.
import test from "node:test";
import assert from "node:assert/strict";
import { groupParts, joinParts, planLayers } from "../src/shared/part-layers.js";

test("textures of one kind share a stack until it is full, each once", () => {
  const items = ["a64", "b64", "c128", "a64", "d64", "e64", "skip"];
  const { stacks, where } = planLayers(items, (name) => (name === "skip" ? null : name.slice(1)), 3);
  assert.deepEqual(stacks.map((s) => [s.kind, s.items]), [["64", ["a64", "b64", "d64"]], ["128", ["c128"]], ["64", ["e64"]]]);
  assert.deepEqual(where.get("d64"), { stack: 0, layer: 2 });
  assert.deepEqual(where.get("e64"), { stack: 2, layer: 0 });
  assert.equal(where.has("skip"), false);
});

test("joined parts keep every vertex in order and name each one's layer", () => {
  const a = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array(9).fill(1), uvs: new Float32Array([0, 0, 1, 0, 0, 1]), layer: 4 };
  const b = { positions: new Float32Array([5, 5, 5, 6, 5, 5, 5, 6, 5]), normals: new Float32Array(9).fill(2), uvs: new Float32Array([0.5, 0.5, 1, 0.5, 0.5, 1]), layer: 7 };
  const joined = joinParts([a, b]);
  assert.deepEqual([...joined.positions], [...a.positions, ...b.positions]);
  assert.deepEqual([...joined.normals], [...a.normals, ...b.normals]);
  assert.deepEqual([...joined.uvs], [...a.uvs, ...b.uvs]);
  assert.deepEqual([...joined.layers], [4, 4, 4, 7, 7, 7]);
});

test("parts group by key where each key first stands; a part without a key stays alone", () => {
  const parts = [{ n: 1, k: "x" }, { n: 2, k: null }, { n: 3, k: "y" }, { n: 4, k: "x" }, { n: 5, k: null }];
  const groups = groupParts(parts, (part) => part.k);
  assert.deepEqual(groups.map((g) => g.parts.map((part) => part.n)), [[1, 4], [2], [3], [5]]);
});
