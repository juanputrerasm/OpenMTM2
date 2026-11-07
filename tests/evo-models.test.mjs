/*
  4x4 Evolution truck materials (worker/foreign-truck-build.js `evoTruckMaterials`). Synthetic data only.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { evoTruckMaterials } from "../src/worker/foreign-truck-build.js";

const quad = (x, inward) => {
  // Two triangles in the plane x = `x`, facing +x (out) or -x (in).
  const a = [x, 0, 0], b = [x, 1, 0], c = [x, 1, 1], d = [x, 0, 1];
  const tris = inward ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
  return new Float32Array(tris.flat());
};
const mesh = (groupName, positions, extra = {}) => ({
  groupName, textureName: "T.TIF", transparent: false, cutout: false, blended: false, doubleSided: true,
  positions, normals: new Float32Array(positions.length), uvs: new Float32Array((positions.length / 3) * 2), ...extra,
});

test("an Evolution truck's faces are drawn from the front only, its inner lining hidden behind the skin", async () => {
  const skin = mesh("BODY", quad(4, false));
  const lining = mesh("UNDBODY", quad(4, true));
  const glass = mesh("GLASSE", quad(3, false), { transparent: true, cutout: true });
  const parts = { body: { meshes: [skin, lining, glass] }, tireLeft: { meshes: [mesh("TIRE", quad(1, false))] } };
  // An art with an opacity plane: as a track's model every group of it would be a two-sided cutout.
  const view = { read: async () => null };
  const textures = { "T.TIF": { width: 1, height: 1, rgba: new Uint8ClampedArray([0, 0, 0, 255]), hasAlpha: true } };
  await evoTruckMaterials(view, parts, textures);
  for (const m of [skin, lining, glass, parts.tireLeft.meshes[0]]) assert.equal(m.doubleSided, false, m.groupName);
  assert.equal(glass.blended, true, "the glass is still blended");
});
