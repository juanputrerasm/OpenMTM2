/*
  Loading a track's files through the VFS (src/worker/level-load.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { loadLevel, loadTextureSource } from "../src/worker/level-load.js";
import { buildCatalog } from "../src/worker/catalog.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("every stock track loads: heightfield, colour grid, textures, types, palette", { skip: skipWithoutStock("POD.INI") }, async () => {
  const vfs = stockVfs();
  const { tracks } = await buildCatalog(vfs);
  assert.equal(tracks.length, 15);
  for (const track of tracks) {
    const level = await loadLevel(vfs, track.path);
    assert.equal(level.heights.length, 65536, track.file);
    assert.ok(level.clr.some((w) => w !== 0), `${track.file} colour grid`);
    assert.ok(level.textureNames.length > 0, `${track.file} textures`);
    assert.ok(level.textureValues.some((v) => v > 0), `${track.file} surface types`);
    assert.equal(level.palette?.length, 768, `${track.file} palette`);
    // Every texture the grid uses is in the list and loads from ART\.
    const used = new Set([...level.clr].map((w) => w & 0xfff));
    for (const slot of used) {
      assert.ok(slot < level.textureNames.length, `${track.file} slot ${slot}`);
      const source = await loadTextureSource(vfs, level.textureNames[slot], level.palette);
      assert.ok(source, `${track.file} ${level.textureNames[slot]}`);
    }
  }
});

test("TPARK: no water, ground boxes present, sky named", { skip: skipWithoutStock("POD.INI") }, async () => {
  const level = await loadLevel(stockVfs(), "WORLD\\TPARK.SIT");
  assert.equal(level.waterLevelFt, null);
  assert.equal(level.groundBoxes.ra0?.length, 65536);
  assert.equal(level.sky.name, "CLOUDY2.RAW");
  assert.equal(level.lte?.length, 458752);
});
