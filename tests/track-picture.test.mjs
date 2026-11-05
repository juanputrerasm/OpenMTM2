import test from "node:test";
import assert from "node:assert/strict";
import { readTrackPicture } from "../src/worker/track-picture.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const BMP = Uint8Array.from([0x42, 0x4d, 9, 9, 9]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]);
/** A 1 x 1 uncompressed 24-bit TGA, top origin: one blue-green-red pixel. */
const TGA = Uint8Array.from([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 0x20, 30, 20, 10]);

const archive = (files) => {
  const asked = [];
  return { asked, read: async (path) => { asked.push(path); return files[path] ?? null; } };
};
const encode = async ({ width, height, rgba }) => Uint8Array.from([0x89, width, height, ...rgba]);

test("the HD PNG beside the BMP is shown first", async () => {
  const a = archive({ "UI\\VALPO4S.PNG": PNG, "UI\\VALPO4S.BMP": BMP });
  assert.deepEqual(await readTrackPicture(a.read, "valpo4s", { encode }), { bytes: PNG, type: "image/png" });
  assert.deepEqual(a.asked, ["UI\\VALPO4S.PNG"]);
});

test("then a TGA, turned into a PNG; then the BMP", async () => {
  const tga = await readTrackPicture(archive({ "UI\\X.TGA": TGA, "UI\\X.BMP": BMP }).read, "X", { encode });
  assert.equal(tga.type, "image/png");
  assert.deepEqual([...tga.bytes], [0x89, 1, 1, 10, 20, 30, 255]);
  // Without a way to encode, the TGA is passed over.
  assert.deepEqual(await readTrackPicture(archive({ "UI\\X.TGA": TGA, "UI\\X.BMP": BMP }).read, "X"), { bytes: BMP, type: "image/bmp" });
  assert.deepEqual(await readTrackPicture(archive({ "UI\\FARM.BMP": BMP }).read, "FARM", { encode }), { bytes: BMP, type: "image/bmp" });
});

test("a file that is not what its name says is passed over, as is a bad name", async () => {
  // A JPEG renamed .PNG, a PNG under .TGA, and a .BMP that is no BMP (CP3's reader wants "BM").
  const a = archive({ "UI\\X.PNG": JPEG, "UI\\X.TGA": PNG, "UI\\X.BMP": JPEG });
  assert.equal(await readTrackPicture(a.read, "X", { encode }), null);
  assert.deepEqual(a.asked, ["UI\\X.PNG", "UI\\X.TGA", "UI\\X.BMP"]);
  // A TGA it cannot read falls through to the BMP.
  assert.deepEqual(await readTrackPicture(archive({ "UI\\X.TGA": Uint8Array.from([1, 2, 3]), "UI\\X.BMP": BMP }).read, "X", { encode }), { bytes: BMP, type: "image/bmp" });
  assert.equal(await readTrackPicture(archive({}).read, "..\\X", { encode }), null);
  assert.equal(await readTrackPicture(archive({}).read, null, { encode }), null);
});
