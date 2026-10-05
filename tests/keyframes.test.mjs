import test from "node:test";
import assert from "node:assert/strict";
import { keyframeMorphs, resolveKeyframeModel } from "../src/worker/keyframes.js";

const frame = (positions) => ({
  name: "FRAME.BIN", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, textureNames: ["FRAME.RAW"],
  meshes: [{ positions: new Float32Array(positions), normals: new Float32Array(positions.length), uvs: new Float32Array(positions.length / 3 * 2) }],
});

test("animated BIN controls adopt their named frames and keep compatible morphs", async () => {
  const frames = new Map([["A.BIN", frame([0, 0, 0])], ["B.BIN", frame([1, 2, 3])]]);
  const model = await resolveKeyframeModel(
    { name: "CONTROL.BIN", frameNames: ["A.BIN", "B.BIN"], meshes: [] },
    async (name) => frames.get(name),
  );
  assert.equal(model.name, "CONTROL.BIN");
  assert.equal(model.resolvedFrame, "A.BIN");
  assert.deepEqual(Array.from(model.keyframes[1].meshes[0].positions), [1, 2, 3]);
});

test("frames with different geometry shapes are not used as morph targets", () => {
  assert.equal(keyframeMorphs(frame([0, 0, 0]), [frame([0, 0, 0]), frame([0, 0, 0, 1, 1, 1])]), null);
});
