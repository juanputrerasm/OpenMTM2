/*
  .BIN models in scene feet (src/worker/models.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { parseBin, parsePod, readPodEntry } from "../src/vendor/openphotex/index.js";
import { binScale, decodeModel, fanTriangles } from "../src/worker/models.js";
import { readStock, skipWithoutStock } from "./helpers/stock.mjs";

test("scale: 1/128 ft per unit at magnify 65536", () => {
  assert.equal(binScale(65536), 1 / 128);
  assert.equal(binScale(32768), 1 / 64);
});

test("every stock truck model face points where the game's stored normal does", { skip: skipWithoutStock("TRUCK2.POD") }, () => {
  const bytes = readStock("TRUCK2.POD");
  let agree = 0, disagree = 0;
  for (const entry of parsePod(bytes).entries.filter((e) => e.title.endsWith(".BIN"))) {
    const bin = parseBin(readPodEntry(bytes, entry));
    if (bin.kind !== "mrgl") continue;
    // Scene-frame vertex, as decodeModel places it (scale does not change directions).
    const at = (i) => [bin.vertices[i * 3] >> 1, bin.vertices[i * 3 + 1] >> 1, -(bin.vertices[i * 3 + 2] >> 1)];
    for (const face of bin.faces) {
      if (face.vertexIndices.length < 3) continue;
      const [a, b, c] = fanTriangles(face.vertexIndices.length)[0].map((k) => at(face.vertexIndices[k]));
      const e1 = b.map((v, k) => v - a[k]), e2 = c.map((v, k) => v - a[k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      // Back to the game frame, against the normal the file stores.
      const d = n[0] * face.storedNormal[0] + n[1] * face.storedNormal[1] - n[2] * face.storedNormal[2];
      if (d > 0) agree++; else if (d < 0) disagree++;
    }
  }
  assert.ok(agree > 10000);
  assert.equal(disagree, 0);
});

test("stock checkpoint and truck models in feet", { skip: skipWithoutStock("TPARK.POD") }, () => {
  const pod = readStock("TPARK.POD");
  const ck = parsePod(pod).entries.find((e) => e.title === "CKBOXN.BIN");
  const gate = decodeModel(readPodEntry(pod, ck), "CKBOXN.BIN");
  assert.deepEqual(gate.bounds.min.map((v) => +v.toFixed(2)), [-43, -16, -16]);
  assert.deepEqual(gate.bounds.max.map((v) => +v.toFixed(2)), [43, 16, 16]);
  const trucks = readStock("TRUCK2.POD");
  const bf = parsePod(trucks).entries.find((e) => e.title === "BIGFOOT.BIN");
  const body = decodeModel(readPodEntry(trucks, bf), "BIGFOOT.BIN");
  // Length along z (forward), height along y.
  assert.ok(body.bounds.max[2] - body.bounds.min[2] > 18);
  assert.ok(body.bounds.max[1] - body.bounds.min[1] < 9);
  assert.ok(body.meshes.length > 0 && body.textureNames.length > 0);
});
